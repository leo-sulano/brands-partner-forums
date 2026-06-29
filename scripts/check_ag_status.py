#!/usr/bin/env python3
"""
check_ag_status.py — Selenium stealth AskGamblers review status checker.

Visits each entry's AskGamblers casino review page, searches player reviews
for the account username, and writes back Published/Removed status + star rating.

Status values: Published | Removed
  (no write when username not found and status was not previously Published)

Usage:
    python check_ag_status.py [--tab "Tab Name"] [--headless]

Required env vars (shared with check_review_status.py via .env):
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
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
    proxy_for_entry,
    SUPABASE_URL,
    BATCH_SIZE,
    DELAY_BETWEEN_BATCHES,
    CHROME_RESTART_EVERY,
)

# ─── Config ──────────────────────────────────────────────────────────────────

POST_LOAD_SLEEP    = 5.0   # seconds after page load for JS to render reviews
LOAD_MORE_SLEEP    = 1.5   # seconds after clicking "load more"
MAX_LOAD_MORE      = 10    # max "load more" clicks before giving up

AG_STATUS_COLS = ["AG Review Status"]
AG_LINK_COLS   = ["AG Review Link", "AG Link"]
AG_USER_COLS   = ["AG User"]
AG_DATE_COLS   = ["AG Added"]
# VERIFY: check the actual column name in the Sheet; update if different
AG_SCORE_COLS  = ["AG Score added"]

CHECKABLE_STATUSES = {"done", "pending", "published"}

# ─── Column helpers ───────────────────────────────────────────────────────────

def _col(data: dict, candidates: list) -> Optional[str]:
    """Return the first candidate key that exists in data, or None."""
    return next((c for c in candidates if c in data), None)


def _val(data: dict, candidates: list) -> Optional[str]:
    """Return the value of the first candidate key that has a non-empty value."""
    for c in candidates:
        v = data.get(c)
        if v and str(v).strip():
            return str(v).strip()
    return None


def _older_than_one_day(date_str: str) -> bool:
    """Return True if date_str represents a date more than 24 h ago."""
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            dt = datetime.strptime(date_str.strip(), fmt).replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - dt) > timedelta(days=1)
        except ValueError:
            continue
    return True  # unparseable → treat as old

# ─── Supabase ────────────────────────────────────────────────────────────────

def load_ag_entries(tab: Optional[str] = None, include_published: bool = True) -> list:
    params: dict = {"select": "id,tab,sheet_row_id,data"}
    if tab:
        params["tab"] = f"eq.{tab}"
    rows: list = _fetch_all(params)

    statuses = CHECKABLE_STATUSES if include_published else {"done", "pending"}
    out = []
    for row in rows:
        data: dict = row.get("data") or {}
        ag_link = _val(data, AG_LINK_COLS)
        ag_user = _val(data, AG_USER_COLS)
        if not ag_link or not ag_user:
            continue
        status_col = _col(data, AG_STATUS_COLS)
        if not status_col:
            continue
        current = (data.get(status_col) or "").strip().lower()
        if current not in statuses:
            continue
        print(f"  [load] id={row['id']} status={current!r} user={ag_user!r} link={ag_link[:40]!r}")
        out.append(row)
    print(f"  [load] {len(out)} eligible AG entries (from {len(rows)} total in tab)")
    return out

# ─── Scraping helpers ─────────────────────────────────────────────────────────

_BLOCK_KEYWORDS = {
    "captcha", "i am not a robot", "ddos protection",
    "bot detection", "unusual traffic", "human verification",
}

def _page_blocked(html: str) -> bool:
    """Return True if the page looks like a CAPTCHA/bot-block rather than real content."""
    if len(html) < 2000:  # truly empty/minimal page only
        return True
    lower = html.lower()
    blocked = any(kw in lower for kw in _BLOCK_KEYWORDS)
    if blocked:
        print(f"    [blocked] page length={len(html)}, matched block keyword")
    return blocked


def _extract_rating_from_context(context_html: str) -> Optional[int]:
    """Look for a 1-5 star rating in a chunk of HTML surrounding a username."""
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
    """Scroll to and click any 'Load more reviews' button. Returns True if clicked."""
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


def fetch_ag_review(
    driver: uc.Chrome, ag_link: str, ag_user: str, current_status: str = ""
) -> tuple:
    """Visit the AG casino review page and search player reviews for ag_user.

    Returns (status, rating):
      ('Published', 1-5 or None)  — username found in reviews
      ('Removed', None)           — not found, current status was 'published'
      (None, None)                — not found, status was not published (no write needed)
      ('__skip__', None)          — page blocked/CAPTCHA; skip without changing status
    """
    url = ag_link.strip()
    if not url.startswith("http"):
        url = f"https://{url}"
    try:
        driver.get(url)
    except Exception:
        pass  # page load timeout — JS content usually still renders

    time.sleep(POST_LOAD_SLEEP)

    current_url = driver.current_url.lower()
    if "askgamblers.com" not in current_url:
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

    ag_user_lower = ag_user.lower()

    for page_num in range(MAX_LOAD_MORE + 1):
        html = driver.page_source

        # First page only: check for CAPTCHA / bot-block before drawing conclusions
        if page_num == 0:
            print(f"    [page] length={len(html)}, url={driver.current_url[:60]}")
            if _page_blocked(html):
                print(f"    -> page blocked/CAPTCHA — skipping (no status change)")
                return ("__skip__", None)

        html_lower = html.lower()

        if ag_user_lower in html_lower:
            idx = html_lower.find(ag_user_lower)
            # Extract rating from surrounding HTML context
            context = html[max(0, idx - 500) : idx + 1500]
            rating = _extract_rating_from_context(context)
            return ("Published", rating)

        if page_num >= MAX_LOAD_MORE:
            break

        clicked = _try_load_more(driver)
        if not clicked:
            break
        time.sleep(LOAD_MORE_SLEEP)

    # Username not found after all pages — caller decides next status
    return (None, None)

# ─── Main check loop ──────────────────────────────────────────────────────────

def check_ag_for_tab(
    tab: Optional[str] = None,
    include_published: bool = True,
    headless: bool = True,
) -> dict:
    """Run AG status check for all eligible entries in `tab`.
    Returns {checked, updated, errors, sheet_errors, total}."""
    entries = load_ag_entries(tab, include_published)
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
                entry_proxy = proxy_for_entry(entry.get("data") or {})

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

                data: dict = entry["data"]
                status_col  = _col(data, AG_STATUS_COLS)
                score_col   = _col(data, AG_SCORE_COLS)
                ag_link     = _val(data, AG_LINK_COLS) or ""
                ag_user     = _val(data, AG_USER_COLS) or ""
                current     = (data.get(status_col, "") or "").strip()
                current_score = str(data.get(score_col, "") or "") if score_col else ""

                print(f"  [AG {checked}/{total}] {ag_link} (@{ag_user})")
                try:
                    new_status, new_rating = fetch_ag_review(driver, ag_link, ag_user, current)
                except Exception as exc:
                    print(f"    -> ERROR: {exc}")
                    errors += 1
                    continue

                if new_status == "__skip__":
                    continue

                if new_status is None:
                    current_lower = current.strip().lower()
                    if current_lower == "pending":
                        new_status = "Refused"
                    elif current_lower == "done":
                        ag_added = _val(data, AG_DATE_COLS) or ""
                        new_status = "Refused" if (not ag_added or _older_than_one_day(ag_added)) else "Pending"
                    else:
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
        driver.quit()

    return {"checked": checked, "updated": updated, "errors": errors, "sheet_errors": sheet_errors, "total": total}


def main() -> None:
    ap = argparse.ArgumentParser(description="Selenium stealth AskGamblers status checker")
    ap.add_argument("--tab", help="Restrict to a specific tab name")
    ap.add_argument("--no-headless", dest="headless", action="store_false", help="Show Chrome browser window")
    ap.set_defaults(headless=True)
    args = ap.parse_args()

    scope = f"tab: {args.tab}" if args.tab else "all tabs"
    print(f"Loading AG entries ({scope})...")
    result = check_ag_for_tab(args.tab, include_published=True, headless=args.headless)
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']}")


if __name__ == "__main__":
    main()
