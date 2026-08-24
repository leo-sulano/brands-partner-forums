#!/usr/bin/env python3
"""
check_wo_status.py — Selenium stealth Wizard of Odds review status checker.

Visits each entry's Wizard of Odds casino review page, searches player reviews
for the account username, and writes back Published/Removed status + star rating.

Usage:
    python check_wo_status.py [--tab "Tab Name"] [--headless]

Required env vars (shared with check_review_status.py via .env):
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import os
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

from dotenv import load_dotenv
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By

sys.path.insert(0, os.path.dirname(__file__))
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from check_review_status import (
    build_driver,
    update_entry,
    _fetch_all,
    BATCH_SIZE,
    DELAY_BETWEEN_BATCHES,
    log_check_error,
    status_filter_matches,
    matches_scope_filters,
    filter_by_active_group,
    extract_review_card_text,
    split_review_header,
    REVIEW_TEXT_KEYS,
)
from geo_bridge import ensure_display

# ─── Config ──────────────────────────────────────────────────────────────────

POST_LOAD_SLEEP = 2.5
LOAD_MORE_SLEEP = 1.5

WO_STATUS_COLS = ["WoO Review Status"]
WO_LINK_COLS   = ["Link to the profile"]
WO_USER_COLS   = ["WoO User", "WO User", "User Name", "Username"]
WO_SCORE_COLS  = ["Wizard of OddsScore added", "WO Score added"]
WO_DATE_COLS   = ["Wizard of Odds"]

CHECKABLE_STATUSES = {"done", "pending", "published"}
REFUSED_AFTER_DAYS = 1


# ─── Column helpers ───────────────────────────────────────────────────────────

def _col(data: dict, candidates: list) -> Optional[str]:
    return next((c for c in candidates if c in data), None)


def _val(data: dict, candidates: list) -> Optional[str]:
    for c in candidates:
        v = data.get(c)
        if v and str(v).strip():
            return str(v).strip()
    return None


def _older_than(date_str: str, days: int) -> bool:
    """Return True if date_str is more than `days` days in the past."""
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            dt = datetime.strptime(date_str.strip(), fmt).replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - dt) > timedelta(days=days)
        except ValueError:
            continue
    return False  # unparseable — don't auto-refuse


# ─── Supabase ────────────────────────────────────────────────────────────────

def load_wo_entries(
    tab: Optional[str] = None,
    include_published: bool = True,
    status_filters: Optional[list[str]] = None,
    brands: Optional[list] = None,
    agents: Optional[list[str]] = None,
    proxies: Optional[list[str]] = None,
    countries: Optional[list[str]] = None,
) -> list:
    params: dict = {"select": "id,tab,sheet_row_id,data"}
    if tab:
        params["tab"] = f"eq.{tab}"
    # _fetch_all paginates with a deterministic order — a single unpaginated
    # request here would silently truncate at Supabase's 1000-row cap for any
    # tab with more entries (same class of bug fixed for TP/AG/CG's loaders).
    rows: list = _fetch_all(params)

    # status_filters (driven by the dashboard's status-filter dropdown) narrows to
    # exactly those status(es) — the opt-in path for re-checking Published/Removed/
    # On Pause/Not Done, which CHECKABLE_STATUSES/include_published never cover
    # on their own.
    default_statuses = CHECKABLE_STATUSES if include_published else {"done", "pending"}
    brand_set = set(brands) if brands else None
    out = []
    for row in rows:
        data: dict = row.get("data") or {}
        if not _val(data, WO_LINK_COLS) or not _val(data, WO_USER_COLS):
            continue
        status_col = _col(data, WO_STATUS_COLS)
        if not status_col:
            continue
        current = (data.get(status_col) or "").strip().lower()
        if not status_filter_matches(current, status_filters, default_statuses):
            continue
        # Mirrors the dashboard's Brand/Agent/Proxy/Country filter dropdowns —
        # a Check Status run can be scoped to exactly what's currently filtered.
        if not matches_scope_filters(data, brands=brand_set, agents=agents, proxies=proxies, countries=countries):
            continue
        out.append(row)
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


def fetch_wo_review(
    driver: uc.Chrome, wo_link: str, wo_user: str, current_status: str = ""
) -> tuple:
    """Visit the WO casino review page and search player reviews for wo_user.

    Returns (status, rating, review_text, review_date):
      ('Published', 1-5 or None, text or None, date or None) — username found in reviews
      ('Removed', None, None, None)                          — not found, current status was 'published'
      (None, None, None, None)                                — not found, status was not published (no write)

    `review_text` is body-only — the card's own username/date/rating header
    (if present) is stripped via `split_review_header` and, when found there,
    `review_date`/`rating` are the site-truth values read straight off the
    card rather than duplicated inside the stored text.
    """
    url = wo_link.strip()
    if not url.startswith("http"):
        url = f"https://{url}"
    try:
        driver.get(url)
    except Exception:
        pass

    time.sleep(POST_LOAD_SLEEP)

    current_url = driver.current_url.lower()
    if "wizardofodds.com" not in current_url:
        print(f"    redirected off-site -> {driver.current_url}")
        return ("Removed", None, None, None)

    wo_user_lower = wo_user.lower()

    # No page cap — page all the way to the true last "Load More" before
    # concluding not-found, same reasoning as AG/CG (see check_ag_status.py):
    # a fixed cap can wrongly call a review "not found" when it's really just
    # further back in a long review list.
    while True:
        html = driver.page_source
        html_lower = html.lower()

        if wo_user_lower in html_lower:
            idx = html_lower.find(wo_user_lower)
            context = html[max(0, idx - 500) : idx + 1500]
            rating = _extract_rating_from_context(context)
            review_date = None
            try:
                review_text = extract_review_card_text(driver, wo_user_lower)
                if review_text:
                    review_text, review_date, card_rating = split_review_header(review_text, wo_user)
                    if card_rating is not None:
                        rating = card_rating
            except Exception as exc:
                print(f"    [text] extraction error: {exc}")
                review_text = None
            return ("Published", rating, review_text, review_date)

        clicked = _try_load_more(driver)
        if not clicked:
            break
        time.sleep(LOAD_MORE_SLEEP)

    if current_status.strip().lower() == "published":
        return ("Removed", None, None, None)
    return (None, None, None, None)


# ─── Main check loop ──────────────────────────────────────────────────────────

def check_wo_for_tab(
    tab: Optional[str] = None,
    include_published: bool = True,
    headless: bool = True,
    status_filters: Optional[list[str]] = None,
    brands: Optional[list] = None,
    agents: Optional[list[str]] = None,
    proxies: Optional[list[str]] = None,
    countries: Optional[list[str]] = None,
    dry_run: bool = False,
) -> dict:
    entries = load_wo_entries(tab, include_published, status_filters, brands, agents, proxies, countries)
    entries, skipped_group = filter_by_active_group(entries)
    total = len(entries)
    if not total:
        return {"checked": 0, "updated": 0, "errors": 0, "sheet_errors": 0, "total": 0, "skipped_group": skipped_group}

    # WO runs non-headless (see PLATFORM_HEADLESS in status_server.py), same as AG/CG,
    # but has no display to render into on a headless Linux box — Chrome fails to start
    # (SessionNotCreatedException: chrome not reachable) without a virtual one. Starting
    # it here, not just relying on AG/CG having already started theirs, means a WO-only
    # run works on its own.
    if ensure_display():
        headless = False

    checked = updated = errors = sheet_errors = 0
    driver = build_driver(headless=headless)
    try:
        for i in range(0, total, BATCH_SIZE):
            batch = entries[i : i + BATCH_SIZE]
            for entry in batch:
                checked += 1
                data: dict = entry["data"]
                status_col  = _col(data, WO_STATUS_COLS)
                score_col   = _col(data, WO_SCORE_COLS)
                date_col    = _col(data, WO_DATE_COLS)
                wo_link     = _val(data, WO_LINK_COLS) or ""
                wo_user     = _val(data, WO_USER_COLS) or ""
                current     = (data.get(status_col, "") or "").strip()
                current_score = str(data.get(score_col, "") or "") if score_col else ""
                current_date = str(data.get(date_col, "") or "") if date_col else ""

                print(f"  [WO {checked}/{total}] {wo_link} (@{wo_user})")
                try:
                    new_status, new_rating, new_review_text, new_review_date = fetch_wo_review(driver, wo_link, wo_user, current)
                except Exception as exc:
                    print(f"    -> ERROR: {exc}")
                    log_check_error("WO", wo_link, exc)
                    errors += 1
                    continue

                if new_status is None:
                    # Username not found on WO page.
                    # If status is "Done" and >= 1 day old → mark Refused.
                    if current.strip().lower() == "done":
                        wo_date = _val(data, WO_DATE_COLS)
                        if wo_date and _older_than(wo_date, REFUSED_AFTER_DAYS):
                            new_status = "Refused"
                            print(f"    -> Done for >{REFUSED_AFTER_DAYS}d, not found -> Refused")
                        else:
                            age = f"date={wo_date}" if wo_date else "no date"
                            print(f"    -> Done but too recent ({age}) — skipping")
                            continue
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
                # Site-truth date read straight off the review card, overwriting
                # whatever was previously tracked in this column.
                if date_col and new_review_date and new_review_date != current_date:
                    updates[date_col] = new_review_date
                current_review_text = data.get(REVIEW_TEXT_KEYS["wo"]) or ""
                if new_review_text and new_review_text != current_review_text:
                    updates[REVIEW_TEXT_KEYS["wo"]] = new_review_text

                if not updates:
                    print(f"    -> {current!r} *{current_score or '-'} (no change)")
                    continue

                if dry_run:
                    sheet_ok = True
                    print(f"    -> {current!r} -> {new_status!r} *{new_rating or '-'} (dry run)")
                else:
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

    return {"checked": checked, "updated": updated, "errors": errors, "sheet_errors": sheet_errors, "total": total, "skipped_group": skipped_group}


def main() -> None:
    ap = argparse.ArgumentParser(description="Selenium stealth Wizard of Odds status checker")
    ap.add_argument("--tab", help="Restrict to a specific tab name")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="Print changes without writing to Supabase")
    args = ap.parse_args()

    scope = f"tab: {args.tab}" if args.tab else "all tabs"
    print(f"Loading WO entries ({scope})...")
    result = check_wo_for_tab(args.tab, include_published=True, headless=args.headless, dry_run=args.dry_run)
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']} skipped_group={result.get('skipped_group', 0)}")
    if args.dry_run:
        print("(dry-run — no writes made)")


if __name__ == "__main__":
    main()
