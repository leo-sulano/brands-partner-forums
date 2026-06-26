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
    SUPABASE_URL,
    BATCH_SIZE,
    DELAY_BETWEEN_BATCHES,
)

# ─── Config ──────────────────────────────────────────────────────────────────

POST_LOAD_SLEEP    = 2.5   # seconds after page load for JS to render reviews
LOAD_MORE_SLEEP    = 1.5   # seconds after clicking "load more"
MAX_LOAD_MORE      = 10    # max "load more" clicks before giving up

AG_STATUS_COLS = ["AG Review Status"]
AG_LINK_COLS   = ["AG Review Link", "AG Link"]
AG_USER_COLS   = ["AG User"]
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

# ─── Supabase ────────────────────────────────────────────────────────────────

def load_ag_entries(tab: Optional[str] = None, include_published: bool = True) -> list:
    params: dict = {"select": "id,tab,sheet_row_id,data"}
    if tab:
        params["tab"] = f"eq.{tab}"
    r = requests.get(f"{SUPABASE_URL}/rest/v1/entries", headers=_headers(), params=params)
    r.raise_for_status()
    rows: list = r.json()

    statuses = CHECKABLE_STATUSES if include_published else {"done", "pending"}
    out = []
    for row in rows:
        data: dict = row.get("data") or {}
        if not _val(data, AG_LINK_COLS) or not _val(data, AG_USER_COLS):
            continue
        status_col = _col(data, AG_STATUS_COLS)
        if not status_col:
            continue
        current = (data.get(status_col) or "").strip().lower()
        if current not in statuses:
            continue
        out.append(row)
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
      ('Removed', None)           — not found, current status was 'published'
      (None, None)                — not found, status was not published (no write needed)
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

    ag_user_lower = ag_user.lower()

    for page_num in range(MAX_LOAD_MORE + 1):
        html = driver.page_source
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

    # Username not found after all pages
    if current_status.strip().lower() == "published":
        return ("Removed", None)
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
    driver = build_driver(headless=headless)
    try:
        for i in range(0, total, BATCH_SIZE):
            batch = entries[i : i + BATCH_SIZE]
            for entry in batch:
                checked += 1
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
        driver.quit()

    return {"checked": checked, "updated": updated, "errors": errors, "sheet_errors": sheet_errors, "total": total}


def main() -> None:
    ap = argparse.ArgumentParser(description="Selenium stealth AskGamblers status checker")
    ap.add_argument("--tab", help="Restrict to a specific tab name")
    ap.add_argument("--headless", action="store_true", help="Run Chrome headless")
    args = ap.parse_args()

    scope = f"tab: {args.tab}" if args.tab else "all tabs"
    print(f"Loading AG entries ({scope})...")
    result = check_ag_for_tab(args.tab, include_published=True, headless=args.headless)
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']}")


if __name__ == "__main__":
    main()
