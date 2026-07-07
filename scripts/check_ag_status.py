#!/usr/bin/env python3
"""
check_ag_status.py — Selenium stealth AskGamblers review status checker.

Visits each entry's AskGamblers casino review page, searches player reviews
for the account username, and writes back Published/Pending/Refused/Removed
status + star rating.

Status values: Published | Pending | Refused | Removed
  (found -> Published; not found and previously Published -> Removed;
  not found, not previously Published, added within REFUSED_AFTER_DAYS ->
  Pending; not found and older than that -> Refused. Published/Removed
  entries are not re-checked on future runs.)

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
    log_check_error,
    page_blocked,
    resolve_status,
    normalize_review_list_url,
    STATUS_FILTER_MAP,
    matches_scope_filters,
    SUPABASE_URL,
    BATCH_SIZE,
    DELAY_BETWEEN_BATCHES,
    CHROME_RESTART_EVERY,
)
from geo_proxy import geo_proxy_for_entry, country_code_for_entry, detect_exit_country
from geo_bridge import ensure_bridges, ensure_display

# ─── Config ──────────────────────────────────────────────────────────────────

POST_LOAD_SLEEP    = 5.0   # seconds after page load for JS to render reviews
LOAD_MORE_SLEEP    = 1.5   # seconds after clicking "load more"

AG_STATUS_COLS = ["AG Review Status"]
AG_LINK_COLS   = ["AG Review Link", "AG Link"]
AG_USER_COLS   = ["AG User"]
AG_DATE_COLS   = ["Ask Gambler review added"]
# VERIFY: check the actual column name in the Sheet; update if different
AG_SCORE_COLS  = ["AG Score added"]

# "published" is intentionally excluded — once an entry is confirmed Published
# (or Removed), it's left alone rather than re-checked on future runs.
CHECKABLE_STATUSES = {"done", "pending", "refused"}

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


# ─── Supabase ────────────────────────────────────────────────────────────────

def load_ag_entries(
    tab: Optional[str] = None,
    include_published: bool = True,
    country: Optional[str] = None,
    status_filter: Optional[str] = None,
    brands: Optional[list[str]] = None,
    agent: Optional[str] = None,
    proxy: Optional[str] = None,
) -> list:
    params: dict = {"select": "id,tab,sheet_row_id,data"}
    if tab:
        params["tab"] = f"eq.{tab}"
    rows: list = _fetch_all(params)

    # include_published is now a no-op here since CHECKABLE_STATUSES never
    # contains "published" — kept for signature compatibility with status_server.py.
    # status_filter (driven by the dashboard's status-filter dropdown) narrows to
    # exactly that status instead — the opt-in path for re-checking Published/Removed.
    statuses = STATUS_FILTER_MAP.get(status_filter, set()) if status_filter else CHECKABLE_STATUSES
    brand_set = set(brands) if brands else None
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
        # Mirrors the dashboard's Brand/Agent/Proxy/Country filter dropdowns —
        # a Check Status run can be scoped to exactly what's currently filtered.
        if not matches_scope_filters(data, brands=brand_set, agent=agent, proxy=proxy, country=country):
            continue
        print(f"  [load] id={row['id']} status={current!r} user={ag_user!r} link={ag_link[:40]!r}")
        out.append(row)
    print(f"  [load] {len(out)} eligible AG entries (from {len(rows)} total in tab)")
    # Group brands by their resolved geo proxy so each country = one Chrome launch.
    out.sort(key=lambda r: geo_proxy_for_entry(r.get("data") or {}))
    return out

# ─── Scraping helpers ─────────────────────────────────────────────────────────

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
      (None, None)                — not found; caller resolves the next status via resolve_status()
      ('__skip__', None)          — page blocked/CAPTCHA; skip without changing status
    """
    url = normalize_review_list_url(ag_link.strip())
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

    # No page cap — page all the way to the true last "Load More" before
    # concluding not-found. A fixed cap previously stopped at page 10, which
    # could wrongly call a review "not found" (and mark it Refused/Removed)
    # when it was really just further back in a long review list.
    page_num = 0
    while True:
        html = driver.page_source

        # First page only: check for CAPTCHA / bot-block before drawing conclusions
        if page_num == 0:
            print(f"    [page] length={len(html)}, url={driver.current_url[:60]}")
            if page_blocked(html, driver.title):
                print(f"    -> page blocked/CAPTCHA — skipping (no status change)")
                return ("__skip__", None)

        # Only the rendered visible text proves an authored review exists — a raw
        # HTML match can come from a hidden widget reusing review markup (confirmed
        # on CasinoGuru's "found this helpful" tooltip; hardened here too as a
        # precaution, though no live AG false positive has been observed).
        try:
            visible_text = driver.find_element(By.TAG_NAME, "body").text.lower()
        except Exception:
            visible_text = ""

        if ag_user_lower in visible_text:
            html_lower = html.lower()
            idx = html_lower.find(ag_user_lower)
            # Extract rating from surrounding HTML context
            context = html[max(0, idx - 500) : idx + 1500]
            rating = _extract_rating_from_context(context)
            return ("Published", rating)

        clicked = _try_load_more(driver)
        page_num += 1
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
    country: Optional[str] = None,
    status_filter: Optional[str] = None,
    brands: Optional[list] = None,
    agent: Optional[str] = None,
    proxy: Optional[str] = None,
) -> dict:
    """Run AG status check for all eligible entries in `tab`.
    Returns {checked, updated, errors, sheet_errors, total}."""
    ensure_bridges()
    if ensure_display():
        headless = False  # run non-headless under Xvfb so Cloudflare's challenge clears
    entries = load_ag_entries(tab, include_published, country, status_filter, brands, agent, proxy)
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
                    log_check_error("AG", ag_link, exc)
                    errors += 1
                    continue

                if new_status == "__skip__":
                    continue

                if new_status is None:
                    ag_date = _val(data, AG_DATE_COLS)
                    new_status = resolve_status(found=False, current_status=current, added_date=ag_date)

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
    ap = argparse.ArgumentParser(description="Selenium stealth AskGamblers status checker")
    ap.add_argument("--tab", help="Restrict to a specific tab name")
    ap.add_argument("--country", help="Restrict to one country (full name or ISO-2, e.g. Germany or de)")
    ap.add_argument("--no-headless", dest="headless", action="store_false", help="Show Chrome browser window")
    ap.set_defaults(headless=True)
    args = ap.parse_args()

    scope = f"tab: {args.tab}" if args.tab else "all tabs"
    if args.country:
        scope += f", country: {args.country}"
    print(f"Loading AG entries ({scope})...")
    result = check_ag_for_tab(args.tab, include_published=True, headless=args.headless, country=args.country)
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']}")


if __name__ == "__main__":
    main()
