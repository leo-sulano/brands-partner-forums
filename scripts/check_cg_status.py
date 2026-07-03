#!/usr/bin/env python3
"""
check_cg_status.py — Selenium stealth CasinoGuru review status checker.

Visits each entry's CasinoGuru casino review page, searches player reviews
for the account username, and writes back Published/Removed status + star rating.

Usage:
    python check_cg_status.py [--tab "Tab Name"] [--headless]

Required env vars (shared with check_review_status.py via .env):
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import os
import re
import sys
import time
from typing import Optional

import requests
from dotenv import load_dotenv
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By

sys.path.insert(0, os.path.dirname(__file__))
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from check_review_status import (
    build_driver,
    update_entry,
    _headers,
    _fetch_all,
    SUPABASE_URL,
    BATCH_SIZE,
    DELAY_BETWEEN_BATCHES,
    CHROME_RESTART_EVERY,
    proxy_for_entry,
    log_check_error,
    page_blocked,
)
from geo_proxy import geo_proxy_for_entry, country_code_for_entry, detect_exit_country
from geo_bridge import ensure_bridges, ensure_display

# ─── Config ──────────────────────────────────────────────────────────────────

POST_LOAD_SLEEP = 2.5
LOAD_MORE_SLEEP = 1.5
MAX_LOAD_MORE   = 10

CG_STATUS_COLS = ["CG Review Status"]
CG_LINK_COLS   = ["CG Review Link", "CG Link"]
CG_USER_COLS   = ["CG User"]
# VERIFY: check the actual column name in the Sheet; update if different
CG_SCORE_COLS  = ["CG Score added"]

CHECKABLE_STATUSES = {"done", "pending", "published"}


# ─── Column helpers (same as check_ag_status.py) ─────────────────────────────

def _col(data: dict, candidates: list) -> Optional[str]:
    return next((c for c in candidates if c in data), None)


def _val(data: dict, candidates: list) -> Optional[str]:
    for c in candidates:
        v = data.get(c)
        if v and str(v).strip():
            return str(v).strip()
    return None


# ─── Supabase ────────────────────────────────────────────────────────────────

def load_cg_entries(tab: Optional[str] = None, include_published: bool = True, country: Optional[str] = None) -> list:
    params: dict = {"select": "id,tab,sheet_row_id,data"}
    if tab:
        params["tab"] = f"eq.{tab}"
    rows: list = _fetch_all(params)

    statuses = CHECKABLE_STATUSES if include_published else {"done", "pending"}
    out = []
    for row in rows:
        data: dict = row.get("data") or {}
        if not _val(data, CG_LINK_COLS) or not _val(data, CG_USER_COLS):
            continue
        status_col = _col(data, CG_STATUS_COLS)
        if not status_col:
            continue
        current = (data.get(status_col) or "").strip().lower()
        if current not in statuses:
            continue
        out.append(row)
    if country:
        target_cc = country_code_for_entry({"Country": country})
        out = [r for r in out if country_code_for_entry(r.get("data") or {}) == target_cc]
        print(f"  [load] filtered to country={country!r} (cc={target_cc!r}): {len(out)} entries")
    out.sort(key=lambda r: geo_proxy_for_entry(r.get("data") or {}))
    return out


# ─── Scraping helpers ─────────────────────────────────────────────────────────

def _extract_rating_from_context(context_html: str) -> Optional[int]:
    patterns = [
        r'"rating"\s*:\s*"?(\d)"?',
        r'"stars"\s*:\s*"?(\d)"?',
        r'data-score="(\d)"',
        r'data-rating="(\d)"',
        r'alt="(\d)\s*out of 5',
        r'rated\s+(\d)\s+out of 5',
        r'(\d)\s*/\s*5\s*stars?',
    ]
    for pat in patterns:
        m = re.search(pat, context_html, re.IGNORECASE)
        if m:
            try:
                n = int(m.group(1))
                if 1 <= n <= 5:
                    return n
            except (ValueError, IndexError):
                continue
    return None


def _try_load_more(driver: uc.Chrome) -> bool:
    try:
        buttons = driver.find_elements(By.TAG_NAME, "button")
        for btn in buttons:
            try:
                text = (btn.text or "").strip().lower()
                if any(kw in text for kw in ("load more", "show more", "more reviews", "see more")):
                    driver.execute_script("arguments[0].scrollIntoView(true);", btn)
                    time.sleep(0.3)
                    btn.click()
                    return True
            except Exception:
                continue
    except Exception:
        pass
    return False


# CasinoGuru embeds a hidden "users who found this helpful" tooltip (class
# tooltip-user-row) on every review, reusing the exact same author-name markup as a
# real review's byline. A plain substring search over page_source matches a username
# there even though it's never rendered as visible text and that user never posted a
# review on the page — confirmed live: two "Published" false positives (Serenity9 on
# olympusbet-casino-review, Lincoln4 on lucknation-casino-review) traced to this tooltip.
_LIKER_TOOLTIP_MARKER = "tooltip-user-row"
_LIKER_LOOKBACK = 1000  # chars to scan backward from a match for the tooltip wrapper


def _find_authored_context(html: str, html_lower: str, user_lower: str) -> Optional[str]:
    """Return HTML context around the first occurrence of user_lower that isn't
    inside a liker tooltip, for star-rating extraction. None if every occurrence is."""
    start = 0
    while True:
        idx = html_lower.find(user_lower, start)
        if idx == -1:
            return None
        lookback = html_lower[max(0, idx - _LIKER_LOOKBACK):idx]
        if _LIKER_TOOLTIP_MARKER not in lookback:
            return html[max(0, idx - 500) : idx + 1500]
        start = idx + 1


def fetch_cg_review(
    driver: uc.Chrome, cg_link: str, cg_user: str, current_status: str = ""
) -> tuple:
    """Visit the CG casino review page and search player reviews for cg_user.

    Returns (status, rating):
      ('Published', 1-5 or None)  — username found in reviews
      ('Removed', None)           — not found, current status was 'published'
      (None, None)                — not found, status was not published (no write)
      ('__skip__', None)          — page blocked/CAPTCHA; skip without changing status
    """
    url = cg_link.strip()
    if not url.startswith("http"):
        url = f"https://{url}"
    try:
        driver.get(url)
    except Exception:
        pass

    time.sleep(POST_LOAD_SLEEP)

    # Safety: if redirected completely off casino.guru, treat as Removed
    current_url = driver.current_url.lower()
    if "casino.guru" not in current_url:
        print(f"    redirected off-site -> {driver.current_url}")
        return ("Removed", None)

    # Scroll down to trigger lazy-loaded reviews section
    try:
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight / 2);")
        time.sleep(1.5)
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(1.5)
    except Exception:
        pass

    cg_user_lower = cg_user.lower()

    for page_num in range(MAX_LOAD_MORE + 1):
        html = driver.page_source

        # First page only: check for CAPTCHA / bot-block before drawing conclusions.
        # Must happen before any "not found" conclusion — otherwise a blocked page
        # reads identically to a genuinely-removed review.
        if page_num == 0 and page_blocked(html, driver.title):
            print(f"    -> page blocked/CAPTCHA — skipping (no status change)")
            return ("__skip__", None)

        # Only the rendered visible text proves an authored review exists — the
        # hidden liker tooltip never appears here, unlike in raw page_source.
        try:
            visible_text = driver.find_element(By.TAG_NAME, "body").text.lower()
        except Exception:
            visible_text = ""

        if cg_user_lower in visible_text:
            context = _find_authored_context(html, html.lower(), cg_user_lower)
            rating = _extract_rating_from_context(context) if context else None
            return ("Published", rating)

        if page_num >= MAX_LOAD_MORE:
            break

        clicked = _try_load_more(driver)
        if not clicked:
            break
        time.sleep(LOAD_MORE_SLEEP)

    if current_status.strip().lower() == "published":
        return ("Removed", None)
    return (None, None)


# ─── Main check loop ──────────────────────────────────────────────────────────

def check_cg_for_tab(
    tab: Optional[str] = None,
    include_published: bool = True,
    headless: bool = True,
    country: Optional[str] = None,
) -> dict:
    ensure_bridges()
    if ensure_display():
        headless = False  # run non-headless under Xvfb so Cloudflare's challenge clears
    entries = load_cg_entries(tab, include_published, country)
    total = len(entries)
    if not total:
        return {"checked": 0, "updated": 0, "errors": 0, "sheet_errors": 0, "total": 0}

    checked = updated = errors = sheet_errors = 0
    driver = None
    current_proxy = None
    try:
        for i in range(0, total, BATCH_SIZE):
            batch = entries[i : i + BATCH_SIZE]
            for entry in batch:
                checked += 1
                _edata = entry.get("data") or {}
                entry_proxy = geo_proxy_for_entry(_edata) or proxy_for_entry(_edata)

                restart = (
                    driver is None
                    or entry_proxy != current_proxy
                    or (checked > 1 and (checked - 1) % CHROME_RESTART_EVERY == 0)
                )
                if restart:
                    if driver:
                        print(f"  ... restarting Chrome at entry {checked}/{total} (proxy={entry_proxy or 'none'})\n")
                        try:
                            driver.quit()
                        except Exception:
                            pass
                    driver = build_driver(headless=headless, proxy=entry_proxy)
                    current_proxy = entry_proxy
                    expected_cc = country_code_for_entry(_edata)
                    if expected_cc and entry_proxy:
                        got = detect_exit_country(driver)
                        if got and got != expected_cc:
                            print(f"  [geo] WARNING expected {expected_cc!r} but proxy exited {got!r}")
                        else:
                            print(f"  [geo] exit country {got or 'unknown'!r} (target {expected_cc!r})")

                data: dict = entry["data"]
                status_col  = _col(data, CG_STATUS_COLS)
                score_col   = _col(data, CG_SCORE_COLS)
                cg_link     = _val(data, CG_LINK_COLS) or ""
                cg_user     = _val(data, CG_USER_COLS) or ""
                current     = (data.get(status_col, "") or "").strip()
                current_score = str(data.get(score_col, "") or "") if score_col else ""

                print(f"  [CG {checked}/{total}] {cg_link} (@{cg_user})")
                try:
                    new_status, new_rating = fetch_cg_review(driver, cg_link, cg_user, current)
                except Exception as exc:
                    print(f"    -> ERROR: {exc}")
                    log_check_error("CG", cg_link, exc)
                    errors += 1
                    continue

                if new_status == "__skip__":
                    continue

                if new_status is None:
                    print(f"    -> not found / no status change needed")
                    continue

                updates: dict = {}
                if new_status != current:
                    updates[status_col] = new_status
                new_score_str = str(new_rating) if new_rating is not None else None
                is_boolean_col = current_score.strip().lower() in {"yes", "no", ""}
                if score_col and new_score_str and new_score_str != current_score and not is_boolean_col:
                    updates[score_col] = new_score_str

                if not updates:
                    print(f"    -> {current!r} *{current_score or '-'} (no change)")
                    continue

                sheet_ok = update_entry(
                    entry["id"], data, updates,
                    tab=entry.get("tab"), sheet_row_id=entry.get("sheet_row_id"),
                )
                if not sheet_ok:
                    sheet_errors += 1
                print(f"    -> {current!r} -> {new_status!r} *{new_rating or '-'} (sheet: {'ok' if sheet_ok else 'FAILED'})")
                updated += 1

            remaining = total - (i + len(batch))
            if remaining > 0:
                time.sleep(DELAY_BETWEEN_BATCHES)
    finally:
        if driver:
            driver.quit()

    return {"checked": checked, "updated": updated, "errors": errors, "sheet_errors": sheet_errors, "total": total}


def main() -> None:
    ap = argparse.ArgumentParser(description="Selenium stealth CasinoGuru status checker")
    ap.add_argument("--tab", help="Restrict to a specific tab name")
    ap.add_argument("--country", help="Restrict to one country (full name or ISO-2, e.g. Germany or de)")
    ap.add_argument("--no-headless", dest="headless", action="store_false", help="Show Chrome browser window")
    ap.set_defaults(headless=True)
    args = ap.parse_args()

    scope = f"tab: {args.tab}" if args.tab else "all tabs"
    if args.country:
        scope += f", country: {args.country}"
    print(f"Loading CG entries ({scope})...")
    result = check_cg_for_tab(args.tab, include_published=True, headless=args.headless, country=args.country)
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']}")


if __name__ == "__main__":
    main()
