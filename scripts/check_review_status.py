#!/usr/bin/env python3
"""
check_review_status.py — Selenium stealth Trustpilot review status checker.

Reads entries from Supabase, visits each Trustpilot review URL with an
undetected-chromedriver (stealth), extracts the review status, and writes
updates back to Supabase.

Status values: Published | Pending | Refused | Removed

Usage:
    python check_review_status.py [--tab "Tab Name"] [--dry-run] [--headless]

Required env vars (copy .env.example -> .env and fill in):
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Optional

import requests
from dotenv import load_dotenv
import undetected_chromedriver as uc

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

# ─── Config ──────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

BATCH_SIZE = 3
DELAY_BETWEEN_BATCHES = 2.5
PAGE_LOAD_TIMEOUT = 25
POST_LOAD_SLEEP = 1.5

TP_STATUS_COLS = [
    "TP Review Status",
    "Trust Pilot Review Status",
    "Trustpilot Review Status",
    "Trust pilot Review Status",
    "Review Status",
]

# Only entries with these statuses are eligible for a status check.
# "Done"    = review was just posted by the agent; TP hasn't processed it yet.
# "Pending" = TP received the review but moderation hasn't resolved it yet.
CHECKABLE_STATUSES = {"done", "pending"}

# ─── Status Parsing (mirrors parser.ts) ──────────────────────────────────────

STATE_MAP: dict[str, str] = {
    "published": "Published",
    "pending":   "Pending",
    "refused":   "Refused",
    "archived":  "Removed",
    "flagged":   "Removed",
    "removed":   "Removed",
}

TEXT_SIGNALS: list[tuple[str, str]] = [
    # ── Removed ──────────────────────────────────────────────────────────────
    ("review removed",              "Removed"),
    ("bewertung entfernt",          "Removed"),
    ("beoordeling verwijderd",      "Removed"),
    ("avis supprimé",               "Removed"),
    ("opinión eliminada",           "Removed"),
    ("recensione rimossa",          "Removed"),
    ("anmeldelse fjernet",          "Removed"),
    ("recension borttagen",         "Removed"),
    ("arvostelu poistettu",         "Removed"),
    ("recenzja usunięta",           "Removed"),
    ("avaliação removida",          "Removed"),
    ("отзыв удалён",                "Removed"),
    ("レビューが削除されました",        "Removed"),
    ("리뷰가 삭제되었습니다",           "Removed"),
    ("yorum kaldırıldı",            "Removed"),
    ("تمت إزالة المراجعة",          "Removed"),
    # ── Refused ──────────────────────────────────────────────────────────────
    ("review not published",                  "Refused"),
    ("nicht veröffentlicht",                  "Refused"),
    ("niet gepubliceerd",                     "Refused"),
    ("avis non publié",                       "Refused"),
    ("opinión no publicada",                  "Refused"),
    ("recensione non pubblicata",             "Refused"),
    ("anmeldelse ikke publisert",             "Refused"),
    ("anmeldelse ikke publiceret",            "Refused"),
    ("recension inte publicerad",             "Refused"),
    ("arvostelua ei julkaistu",               "Refused"),
    ("recenzja nie została opublikowana",     "Refused"),
    ("avaliação não publicada",               "Refused"),
    ("отзыв не опубликован",                  "Refused"),
    ("レビューは公開されていません",             "Refused"),
    ("리뷰가 게시되지 않았습니다",              "Refused"),
    ("yorum yayınlanmadı",                    "Refused"),
    ("لم يتم نشر المراجعة",                  "Refused"),
    # ── Pending ───────────────────────────────────────────────────────────────
    ("review is pending",                    "Pending"),
    ("wartet auf die veröffentlichung",      "Pending"),
    ("wacht op publicatie",                  "Pending"),
    ("avis en attente",                      "Pending"),
    ("opinión pendiente",                    "Pending"),
    ("recensione in attesa",                 "Pending"),
    ("anmeldelse venter",                    "Pending"),
    ("recension väntar",                     "Pending"),
    ("arvostelu odottaa",                    "Pending"),
    ("recenzja oczekuje",                    "Pending"),
    ("avaliação pendente",                   "Pending"),
    ("отзыв ожидает",                        "Pending"),
    ("レビューが審査中",                       "Pending"),
    ("리뷰가 검토 중입니다",                   "Pending"),
    ("yorum beklemede",                      "Pending"),
    ("المراجعة قيد المراجعة",               "Pending"),
    # ── Published (fallback) ──────────────────────────────────────────────────
    ("thanks for your review",              "Published"),
    ("thank you for your review",           "Published"),
    ("ihre bewertung zählt",                "Published"),
    ("bedankt voor uw beoordeling",         "Published"),
    ("merci pour votre avis",               "Published"),
    ("gracias por tu opinión",              "Published"),
    ("grazie per la tua recensione",        "Published"),
    ("takk for din anmeldelse",             "Published"),
    ("tak for din anmeldelse",              "Published"),
    ("tack för din recension",              "Published"),
    ("kiitos arvostelustasi",               "Published"),
    ("dziękujemy za recenzję",              "Published"),
    ("obrigado pela sua avaliação",         "Published"),
    ("спасибо за ваш отзыв",                "Published"),
    ("レビューをありがとうございます",           "Published"),
    ("리뷰를 남겨주셔서 감사합니다",             "Published"),
    ("yorumunuz için teşekkürler",          "Published"),
    ("شكراً على مراجعتك",                   "Published"),
]


def _from_next_data(html: str) -> Optional[str]:
    match = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.+?)</script>',
        html, re.DOTALL,
    )
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    page_props = data.get("props", {}).get("pageProps", {})
    review = (
        page_props.get("review")
        or page_props.get("correlatedReview")
        or page_props.get("reviewData")
    )
    if review:
        # isPending takes precedence — state/status can say "published" (meaning
        # "submitted") while isPending:true means it's still awaiting moderation.
        if review.get("isPending") is True:
            return "Pending"
        raw_state: Optional[str] = review.get("state") or review.get("status")
        if raw_state:
            return STATE_MAP.get(raw_state.lower())
    return None


def _strip_scripts(html: str) -> str:
    # Remove <script>...</script> blocks so i18n bundles don't pollute signal matching
    return re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)


def _from_text_signals(html: str) -> Optional[str]:
    lower = _strip_scripts(html).lower()
    for signal, status in TEXT_SIGNALS:
        if signal in lower:
            return status
    return None


def parse_review_status(html: str) -> Optional[str]:
    return _from_next_data(html) or _from_text_signals(html)


# ─── Supabase REST helpers (no heavy SDK needed) ─────────────────────────────

def _headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def find_status_col(data: dict) -> Optional[str]:
    for col in TP_STATUS_COLS:
        if col in data:
            return col
    return None


def load_entries(tab: Optional[str] = None) -> list[dict]:
    params: dict = {"select": "id,tab,sheet_row_id,data"}
    if tab:
        params["tab"] = f"eq.{tab}"
    r = requests.get(f"{SUPABASE_URL}/rest/v1/entries", headers=_headers(), params=params)
    r.raise_for_status()
    rows: list[dict] = r.json()

    out = []
    for row in rows:
        data: dict = row.get("data") or {}
        profile_url: str = data.get("Link to the profile", "") or ""
        if not profile_url.strip():
            continue
        status_col = find_status_col(data)
        if not status_col:
            continue
        current = (data.get(status_col) or "").strip().lower()
        if current not in CHECKABLE_STATUSES:
            continue
        out.append(row)
    return out


def update_entry(entry_id: str, data: dict, status_col: str, new_status: str,
                 tab: Optional[str] = None, sheet_row_id: Optional[str] = None) -> bool:
    """Returns True if the sheet sync succeeded (or was skipped), False on failure."""
    updated_data = {**data, status_col: new_status}
    payload = {"data": updated_data, "updated_at": datetime.now(timezone.utc).isoformat()}
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/entries",
        headers=_headers(),
        params={"id": f"eq.{entry_id}"},
        json=payload,
    )
    r.raise_for_status()

    if not (tab and sheet_row_id):
        return True

    # Push status change to Google Sheet via the push-to-sheet edge function
    try:
        push_headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        }
        push_payload = {
            "tab": tab,
            "sheet_row_id": sheet_row_id,
            "fields": {status_col: new_status},
        }
        pr = requests.post(
            f"{SUPABASE_URL}/functions/v1/push-to-sheet",
            headers=push_headers,
            json=push_payload,
            timeout=15,
        )
        if not pr.ok:
            print(f"    [sheet push failed] HTTP {pr.status_code}: {pr.text}")
            return False
        return True
    except Exception as exc:
        print(f"    [sheet push error] {exc}")
        return False


# ─── Selenium ────────────────────────────────────────────────────────────────

def build_driver(headless: bool = False) -> uc.Chrome:
    options = uc.ChromeOptions()
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1280,900")
    options.add_argument("--lang=en-US")
    if headless:
        options.add_argument("--headless=new")
    driver = uc.Chrome(options=options, version_main=148)
    driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT)
    return driver


def fetch_status(driver: uc.Chrome, raw_url: str) -> Optional[str]:
    url = raw_url.strip()
    if not url.startswith("http"):
        url = f"https://{url}"
    try:
        driver.get(url)
    except Exception:
        # Page load timeout — main content is usually already in the DOM, so continue
        pass
    try:
        time.sleep(POST_LOAD_SLEEP)
        if "trustpilot.com" not in driver.current_url:
            print(f"    redirected off-site -> {driver.current_url}")
            return "Removed"
        return parse_review_status(driver.page_source) or "Published"
    except Exception as exc:
        print(f"    ERROR: {exc}")
        return None


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="Selenium stealth Trustpilot status checker")
    ap.add_argument("--tab", help="Restrict to a specific tab name")
    ap.add_argument("--dry-run", action="store_true", help="Print changes without writing to Supabase")
    ap.add_argument("--headless", action="store_true", help="Run Chrome headless (may reduce stealth)")
    args = ap.parse_args()

    scope = f"tab: {args.tab}" if args.tab else "all tabs"
    print(f"Loading entries ({scope})...")
    entries = load_entries(args.tab)
    total = len(entries)
    print(f"  -> {total} entries to check\n")

    if not total:
        print("Nothing to do.")
        return

    driver = build_driver(headless=args.headless)
    try:
        checked = updated = errors = 0

        for i in range(0, total, BATCH_SIZE):
            batch = entries[i : i + BATCH_SIZE]
            for entry in batch:
                checked += 1
                data: dict = entry["data"]
                status_col = find_status_col(data)
                current = data.get(status_col, "") or ""
                url: str = data["Link to the profile"]

                print(f"[{checked}/{total}] {url}")
                new_status = fetch_status(driver, url)

                if new_status is None:
                    print(f"    -> could not determine status (skipped)")
                    errors += 1
                elif new_status == current:
                    print(f"    -> {current!r} (no change)")
                else:
                    tag = " (dry run)" if args.dry_run else ""
                    print(f"    -> {current!r} -> {new_status!r}{tag}")
                    if not args.dry_run:
                        update_entry(entry["id"], data, status_col, new_status,
                                     tab=entry.get("tab"), sheet_row_id=entry.get("sheet_row_id"))
                    updated += 1

            remaining = total - (i + len(batch))
            if remaining > 0:
                print(f"  ... sleeping {DELAY_BETWEEN_BATCHES}s ({remaining} left)\n")
                time.sleep(DELAY_BETWEEN_BATCHES)

    finally:
        driver.quit()

    print(f"\n{'-'*40}")
    print(f"Done.  checked={checked}  updated={updated}  errors={errors}")
    if args.dry_run:
        print("(dry-run — no writes made)")


if __name__ == "__main__":
    main()
