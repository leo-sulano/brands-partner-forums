# AG/CG Scrape-Based Status Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the email-based AG/CG status detection with Selenium web scraping — visit each brand's AskGamblers and CasinoGuru review pages, search player reviews for the reviewer's username, and write back Published/Removed status + star rating.

**Architecture:** Two new Python scripts (`check_ag_status.py`, `check_cg_status.py`) follow the exact TP pattern from `check_review_status.py`. Two new Flask routes (`/check-ag-status`, `/check-cg-status`) are added to `status_server.py`. The frontend's existing "Check Status" button is updated in `BrandGroup.tsx` to call all applicable platform checkers concurrently (TP + AG + CG), aggregating results into one toast. The email-based Apps Script path is left untouched — it remains a parallel path for accounts where forwarding is configured.

**Tech Stack:** Python 3 · Selenium/undetected-chromedriver · BeautifulSoup4 (already installed as bs4) · Flask · TypeScript/React

## Global Constraints

- Python scripts run from `scripts/` and must import from `check_review_status.py` (already on `sys.path` via `sys.path.insert(0, os.path.dirname(__file__))`).
- Sheet column names are exact: `AG Review Status`, `AG Review Link`, `AG User`, `AG Score added`, `CG Review Status`, `CG Review Link`, `CG User`, `CG Score added`. The score columns display as `AG Score` / `CG Score` in the dashboard via `COLUMN_LABELS` in `tab-configs.ts` (added in Task 4).
- `CHECKABLE_STATUSES = {"done", "pending", "published"}` — same as TP. Removed/Refused entries are skipped.
- Blank `AG Review Link` or `AG User` on any row → skip silently (no error).
- Username not found after all pages:
  - Current DB status == `"Published"` → set `"Removed"`.
  - Anything else → `(None, None)` — no write, no error counted.
- `build_driver()` version pin is `version_main=149` — do not change.
- `npm run build` is the verification step for frontend changes (not `tsc --noEmit`).
- Star rating write to a `Yes/No` boolean column must be skipped — check `is_boolean_col` guard (same as TP).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `scripts/check_ag_status.py` | AG scraper — load entries, Selenium visit, username search, rating extraction, write back |
| Create | `scripts/check_cg_status.py` | CG scraper — identical pattern, CG column names and domain |
| Modify | `scripts/status_server.py` | Add `/check-ag-status` and `/check-cg-status` routes (lines 29-33 imports + append routes) |
| Modify | `src/lib/queries.ts` | Add `triggerAgStatusCheck` and `triggerCgStatusCheck` exports (after line 577) |
| Modify | `src/pages/BrandGroup.tsx` | Update `handleCheckStatus` (line 1094) to call all platforms concurrently |

---

### Task 1: AG scraper — `scripts/check_ag_status.py`

**Files:**
- Create: `scripts/check_ag_status.py`

**Interfaces:**
- Produces: `load_ag_entries(tab, include_published) → list[dict]`, `check_ag_for_tab(tab, include_published, headless) → dict`
- Consumed by Task 3 (Flask route)

- [ ] **Step 1: Create the file with all imports and config**

```python
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
```

- [ ] **Step 2: Add column helper functions**

```python
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
```

- [ ] **Step 3: Add `load_ag_entries`**

```python
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
```

- [ ] **Step 4: Add rating extraction helper**

```python
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
```

- [ ] **Step 5: Add "load more" click helper**

```python
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
```

- [ ] **Step 6: Add `fetch_ag_review`**

```python
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
```

- [ ] **Step 7: Add `check_ag_for_tab` (Flask-callable entry point)**

```python
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
```

- [ ] **Step 8: Add `main()` for standalone CLI use**

```python
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
```

- [ ] **Step 9: Smoke test — run against one tab with `--headless` off to watch it work**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard/scripts"
python check_ag_status.py --tab "Rooster Partners" --headless
```

Expected: Chrome opens, visits AG casino review pages, prints username search results. No Python errors. If `load_ag_entries` returns 0 entries, either the tab name is wrong or no rows have `AG Review Link` + `AG User` populated with checkable statuses.

- [ ] **Step 10: Commit**

```bash
git add scripts/check_ag_status.py
git commit -m "feat: add AskGamblers Selenium scrape status checker"
```

---

### Task 2: CG scraper — `scripts/check_cg_status.py`

**Files:**
- Create: `scripts/check_cg_status.py`

**Interfaces:**
- Produces: `load_cg_entries(tab, include_published) → list[dict]`, `check_cg_for_tab(tab, include_published, headless) → dict`
- Consumed by Task 3 (Flask route)

This script is identical in structure to `check_ag_status.py` with three changes:
1. Column names use `CG_*` prefixes
2. `fetch_cg_review` checks `casino.guru` is in `driver.current_url` after redirect (same safety as TP's trustpilot domain check)
3. Print labels say `[CG ...]`

- [ ] **Step 1: Create `scripts/check_cg_status.py` with all imports, config, and helpers**

```python
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
    SUPABASE_URL,
    BATCH_SIZE,
    DELAY_BETWEEN_BATCHES,
)

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

def load_cg_entries(tab: Optional[str] = None, include_published: bool = True) -> list:
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
        if not _val(data, CG_LINK_COLS) or not _val(data, CG_USER_COLS):
            continue
        status_col = _col(data, CG_STATUS_COLS)
        if not status_col:
            continue
        current = (data.get(status_col) or "").strip().lower()
        if current not in statuses:
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


def fetch_cg_review(
    driver: uc.Chrome, cg_link: str, cg_user: str, current_status: str = ""
) -> tuple:
    """Visit the CG casino review page and search player reviews for cg_user.

    Returns (status, rating):
      ('Published', 1-5 or None)  — username found in reviews
      ('Removed', None)           — not found, current status was 'published'
      (None, None)                — not found, status was not published (no write)
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

    cg_user_lower = cg_user.lower()

    for page_num in range(MAX_LOAD_MORE + 1):
        html = driver.page_source
        html_lower = html.lower()

        if cg_user_lower in html_lower:
            idx = html_lower.find(cg_user_lower)
            context = html[max(0, idx - 500) : idx + 1500]
            rating = _extract_rating_from_context(context)
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
) -> dict:
    entries = load_cg_entries(tab, include_published)
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
    ap = argparse.ArgumentParser(description="Selenium stealth CasinoGuru status checker")
    ap.add_argument("--tab", help="Restrict to a specific tab name")
    ap.add_argument("--headless", action="store_true")
    args = ap.parse_args()

    scope = f"tab: {args.tab}" if args.tab else "all tabs"
    print(f"Loading CG entries ({scope})...")
    result = check_cg_for_tab(args.tab, include_published=True, headless=args.headless)
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke test CG against one tab**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard/scripts"
python check_cg_status.py --tab "Rooster Partners" --headless
```

Expected: same as AG smoke test — visits CG casino review pages and prints results.

- [ ] **Step 3: Commit**

```bash
git add scripts/check_cg_status.py
git commit -m "feat: add CasinoGuru Selenium scrape status checker"
```

---

### Task 3: Flask routes — modify `scripts/status_server.py`

**Files:**
- Modify: `scripts/status_server.py`

**Interfaces:**
- Consumes: `check_ag_for_tab` from `check_ag_status`, `check_cg_for_tab` from `check_cg_status`
- Produces: `POST /check-ag-status` and `POST /check-cg-status` — same request/response shape as `/check-status`

- [ ] **Step 1: Add imports at the top of the existing import block (after line 33)**

Current import block (lines 29-33):
```python
from check_review_status import (
    load_entries, build_driver, fetch_status,
    find_status_col, find_score_col, update_entry,
    BATCH_SIZE, DELAY_BETWEEN_BATCHES,
)
```

Add immediately after:
```python
from check_ag_status import check_ag_for_tab
from check_cg_status import check_cg_for_tab
```

- [ ] **Step 2: Add `/check-ag-status` route — insert after the `/check-status` route definition (after line 153)**

```python
@app.route('/check-ag-status', methods=['POST', 'OPTIONS'])
def check_ag_status_route():
    if request.method == 'OPTIONS':
        return '', 204

    if not _is_authorized():
        return jsonify({'error': 'Unauthorized — missing or invalid token'}), 401

    body = request.get_json(silent=True) or {}
    tab: str | None = body.get('tab')
    include_published: bool = bool(body.get('include_published', False))
    tab_key = f'ag__{tab or "__all__"}'

    lock = _get_tab_lock(tab_key)
    if not lock.acquire(blocking=False):
        return jsonify({'error': 'A check is already running for this brand — wait and retry'}), 409

    _active_tabs.add(tab_key)
    try:
        headless: bool = app.config.get('HEADLESS', False)
        scope = f'tab: {tab}' if tab else 'all tabs'
        print(f'\n[server] AG check started ({scope})')
        result = check_ag_for_tab(tab, include_published=include_published, headless=headless)
        print(f'[server] AG done. {result}')
        return jsonify(result)
    finally:
        _active_tabs.discard(tab_key)
        lock.release()
```

- [ ] **Step 3: Add `/check-cg-status` route — insert after the AG route**

```python
@app.route('/check-cg-status', methods=['POST', 'OPTIONS'])
def check_cg_status_route():
    if request.method == 'OPTIONS':
        return '', 204

    if not _is_authorized():
        return jsonify({'error': 'Unauthorized — missing or invalid token'}), 401

    body = request.get_json(silent=True) or {}
    tab: str | None = body.get('tab')
    include_published: bool = bool(body.get('include_published', False))
    tab_key = f'cg__{tab or "__all__"}'

    lock = _get_tab_lock(tab_key)
    if not lock.acquire(blocking=False):
        return jsonify({'error': 'A check is already running for this brand — wait and retry'}), 409

    _active_tabs.add(tab_key)
    try:
        headless: bool = app.config.get('HEADLESS', False)
        scope = f'tab: {tab}' if tab else 'all tabs'
        print(f'\n[server] CG check started ({scope})')
        result = check_cg_for_tab(tab, include_published=include_published, headless=headless)
        print(f'[server] CG done. {result}')
        return jsonify(result)
    finally:
        _active_tabs.discard(tab_key)
        lock.release()
```

- [ ] **Step 4: Test routes with curl (server must be running in another terminal)**

Start the server:
```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard/scripts"
python status_server.py --no-headless
```

Curl the AG route:
```bash
curl -s -X POST http://localhost:5001/check-ag-status \
  -H "Content-Type: application/json" \
  -d '{"tab": "Rooster Partners", "include_published": false}'
```

Expected: JSON like `{"checked": N, "updated": M, "errors": 0, "sheet_errors": 0, "total": N}` — no Python tracebacks in the server terminal.

Curl the CG route:
```bash
curl -s -X POST http://localhost:5001/check-cg-status \
  -H "Content-Type: application/json" \
  -d '{"tab": "Rooster Partners", "include_published": false}'
```

Expected: same JSON shape.

- [ ] **Step 5: Commit**

```bash
git add scripts/status_server.py
git commit -m "feat: add /check-ag-status and /check-cg-status Flask routes"
```

---

### Task 4: Frontend integration — `queries.ts` + `BrandGroup.tsx`

**Files:**
- Modify: `src/lib/queries.ts` (after line 577, the end of `triggerStatusCheck`)
- Modify: `src/pages/BrandGroup.tsx` (line 1094 `handleCheckStatus`, line 13 imports)

**Interfaces:**
- Consumes: `CHECK_STATUS_BASE_URL`, `CHECK_STATUS_TOKEN`, `SUPABASE_ANON_KEY` from `./supabase` (already imported)
- Consumes: `getTabPlatforms` from `../lib/tab-configs`
- Produces: `triggerAgStatusCheck(tab, includePublished)`, `triggerCgStatusCheck(tab, includePublished)` — same return type as `triggerStatusCheck`

- [ ] **Step 1: Add `triggerAgStatusCheck` to `queries.ts` after the `triggerStatusCheck` function (after line 577)**

```typescript
export async function triggerAgStatusCheck(
  tab: string,
  includePublished = false,
): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number }> {
  const url = CHECK_STATUS_BASE_URL ? `${CHECK_STATUS_BASE_URL}/check-ag-status` : '';
  if (!url) throw new Error('VITE_CHECK_STATUS_URL is not configured — check .env');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CHECK_STATUS_TOKEN || SUPABASE_ANON_KEY}`,
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ tab, include_published: includePublished }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 2: Add `triggerCgStatusCheck` immediately after `triggerAgStatusCheck`**

```typescript
export async function triggerCgStatusCheck(
  tab: string,
  includePublished = false,
): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number }> {
  const url = CHECK_STATUS_BASE_URL ? `${CHECK_STATUS_BASE_URL}/check-cg-status` : '';
  if (!url) throw new Error('VITE_CHECK_STATUS_URL is not configured — check .env');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CHECK_STATUS_TOKEN || SUPABASE_ANON_KEY}`,
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ tab, include_published: includePublished }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 3: Add `AG Score added` and `CG Score added` display labels to `src/lib/tab-configs.ts`**

Find the `COLUMN_LABELS` object (line 129) and add two entries inside it, after the `'CG Review Link'` line (line 143):

```typescript
  'AG Score added':                                   'AG Score',
  'CG Score added':                                   'CG Score',
```

Result — the relevant portion of `COLUMN_LABELS` should look like:
```typescript
  'AG Review Status':                                 'AG Status',
  'AG Review Link':                                   'AG Link',
  'CG Review Status':                                 'CG Status',
  'CG Review Link':                                   'CG Link',
  'AG Score added':                                   'AG Score',
  'CG Score added':                                   'CG Score',
```

- [ ] **Step 5: Update queries import in `BrandGroup.tsx` (line 13)**

Current line 13:
```typescript
import { fetchRawEntriesByTab, fetchTabHeaders, updateEntryData, triggerStatusCheck, insertEntry, deleteEntries } from '../lib/queries';
```

Replace with:
```typescript
import { fetchRawEntriesByTab, fetchTabHeaders, updateEntryData, triggerStatusCheck, triggerAgStatusCheck, triggerCgStatusCheck, insertEntry, deleteEntries } from '../lib/queries';
```

- [ ] **Step 6: Add `getTabPlatforms` to the existing `tab-configs` import in `BrandGroup.tsx` (line 15)**

Current line 15:
```typescript
import { getTabColumns, getColLabel, COLUMN_LABELS, TAB_DEFAULT_BRAND } from '../lib/tab-configs';
```

Replace with:
```typescript
import { getTabColumns, getColLabel, COLUMN_LABELS, TAB_DEFAULT_BRAND, getTabPlatforms } from '../lib/tab-configs';
```

- [ ] **Step 7: Add `checkDropdownOpen` state and `checkDropdownRef` — insert near the other state declarations (around line 589 where `checkingStatus` is declared)**

Insert these two lines immediately after the `const [checkingStatus, setCheckingStatus] = useState(false);` line:

```typescript
const [checkDropdownOpen, setCheckDropdownOpen] = useState(false);
const checkDropdownRef = useRef<HTMLDivElement>(null);
```

Then add this `useEffect` to close the dropdown when clicking outside — insert it after the existing `useEffect` that loads `lastStatusCheck` from localStorage (around line 604):

```typescript
useEffect(() => {
  function handleOutside(e: MouseEvent) {
    if (checkDropdownRef.current && !checkDropdownRef.current.contains(e.target as Node)) {
      setCheckDropdownOpen(false);
    }
  }
  document.addEventListener('mousedown', handleOutside);
  return () => document.removeEventListener('mousedown', handleOutside);
}, []);
```

- [ ] **Step 8: Replace `handleCheckStatus` in `BrandGroup.tsx` (lines 1094–1132)**

The function now accepts an explicit `platforms` parameter so each dropdown option can pass its own platform list. Replace the entire function:

```typescript
async function handleCheckStatus(platforms: ('tp' | 'ag' | 'cg')[]) {
  setCheckingStatus(true);
  setCheckDropdownOpen(false);
  try {
    const promises: Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number }>[] = [];
    if (platforms.includes('tp')) promises.push(triggerStatusCheck(decodedTab));
    if (platforms.includes('ag')) promises.push(triggerAgStatusCheck(decodedTab));
    if (platforms.includes('cg')) promises.push(triggerCgStatusCheck(decodedTab));

    const settled = await Promise.allSettled(promises);

    let totalUpdated = 0;
    let totalErrors = 0;
    let totalSheetErrors = 0;
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        totalUpdated     += r.value.updated ?? 0;
        totalErrors      += r.value.errors  ?? 0;
        totalSheetErrors += r.value.sheet_errors ?? 0;
      } else {
        totalErrors += 1;
      }
    }

    const now = new Date().toLocaleString();
    localStorage.setItem(`lastStatusCheck_${decodedTab}`, now);
    setLastChecked(now);

    let msg: string;
    let kind: ToastKind;
    if (totalErrors > 0 && totalUpdated === 0) {
      msg = `${totalErrors} check${totalErrors !== 1 ? 's' : ''} failed — server may not be running`;
      kind = 'error';
    } else if (totalUpdated > 0 && totalErrors > 0 && totalSheetErrors > 0) {
      msg = `${totalUpdated} updated, ${totalErrors} checks failed, ${totalSheetErrors} sheet sync failed`;
      kind = 'error';
    } else if (totalUpdated > 0 && totalSheetErrors > 0) {
      msg = `${totalUpdated} updated in dashboard but ${totalSheetErrors} failed to sync to Google Sheet`;
      kind = 'error';
    } else if (totalUpdated > 0 && totalErrors > 0) {
      msg = `${totalUpdated} updated, ${totalErrors} failed`;
      kind = 'success';
    } else if (totalUpdated > 0) {
      msg = `${totalUpdated} review${totalUpdated !== 1 ? 's' : ''} updated`;
      kind = 'success';
    } else {
      msg = 'All reviews up to date';
      kind = 'success';
    }
    setToast({ message: msg, kind });
    reloadRef.current();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    setToast({ message: `Check failed: ${detail}`, kind: 'error' });
    console.error(err);
  } finally {
    setCheckingStatus(false);
  }
}
```

- [ ] **Step 9: Replace the Check Status button in the JSX (lines 1358–1366) with a split-button dropdown**

Current (lines 1358–1366):
```tsx
<button
  type="button"
  onClick={handleCheckStatus}
  disabled={checkingStatus}
  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
>
  <RefreshCw className={`size-3.5 ${checkingStatus ? 'animate-spin' : ''}`} />
  {checkingStatus ? 'Checking…' : 'Check Status'}
</button>
```

Replace with:
```tsx
<div className="relative" ref={checkDropdownRef}>
  <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
    <button
      type="button"
      onClick={() => handleCheckStatus(getTabPlatforms(decodedTab))}
      disabled={checkingStatus}
      className="inline-flex items-center gap-1.5 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <RefreshCw className={`size-3.5 ${checkingStatus ? 'animate-spin' : ''}`} />
      {checkingStatus ? 'Checking…' : 'Check Status'}
    </button>
    <button
      type="button"
      onClick={() => setCheckDropdownOpen((o) => !o)}
      disabled={checkingStatus}
      className="border-l border-slate-200 bg-white px-1.5 py-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      aria-label="Select platform to check"
    >
      <ChevronDown className="size-3.5" />
    </button>
  </div>
  {checkDropdownOpen && (
    <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-md border border-slate-200 bg-white shadow-lg py-1">
      <button
        type="button"
        onClick={() => handleCheckStatus(getTabPlatforms(decodedTab))}
        className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
      >
        Check All
      </button>
      {getTabPlatforms(decodedTab).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => handleCheckStatus([p])}
          className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Check {p.toUpperCase()}
        </button>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 10: Verify build passes**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
npm run build
```

Expected: build completes with no TypeScript errors. Fix any type errors before committing.

- [ ] **Step 11: Commit**

```bash
git add src/lib/tab-configs.ts src/lib/queries.ts src/pages/BrandGroup.tsx
git commit -m "feat: per-platform Check Status dropdown (TP / AG / CG)"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| Scrape AG review page for username | Task 1 `fetch_ag_review` |
| Scrape CG review page for username | Task 2 `fetch_cg_review` |
| Published → username found | Tasks 1–2, both `fetch_*` functions |
| Removed → was Published, now gone | Tasks 1–2, `current_status.lower() == "published"` branch |
| Pending → skip (no write) | Tasks 1–2, `(None, None)` return |
| Star rating capture | Tasks 1–2, `_extract_rating_from_context` |
| Blank link/user → skip silently | Tasks 1–2, `load_*_entries` filter |
| Per-platform dropdown (Check All / TP / AG / CG) | Task 4, Steps 7–9 — split button + dropdown |
| "Done" status entries also checked (AG/CG) | Tasks 1–2, `CHECKABLE_STATUSES = {"done", "pending", "published"}` |
| AG Score / CG Score display labels | Task 4 Step 3, `COLUMN_LABELS` in tab-configs.ts |
| Pagination (load more) | Tasks 1–2, `_try_load_more` loop |
| Existing email path untouched | No changes to `apps-script/` |
| `npm run build` verification | Task 4 Step 6 |

### Placeholder scan

None — every step contains actual code.

### Type consistency

- `triggerAgStatusCheck` and `triggerCgStatusCheck` in `queries.ts` match return type `Promise<{ checked, updated, errors, sheet_errors? }>` — same as `triggerStatusCheck`.
- `handleCheckStatus` aggregates via `Promise.allSettled`, so a single platform failure doesn't abort the others.
- `getTabPlatforms` returns `('tp' | 'ag' | 'cg')[]` — checked with `.includes('ag')` and `.includes('cg')`.
- `check_ag_for_tab` / `check_cg_for_tab` return `{checked, updated, errors, sheet_errors, total}` — matches Flask `jsonify(result)` in Task 3.

### Open items to verify before/during build

1. **`getTabPlatforms` import in BrandGroup.tsx** — check if the file already imports from `../lib/tab-configs`. If yes, add `getTabPlatforms` to the existing import rather than creating a duplicate import line.
2. **Rating extraction** — after the first real run, check if `_extract_rating_from_context` finds ratings. If it consistently returns `None`, open DevTools on an AG/CG review page and inspect the review card HTML to identify the correct pattern, then add that pattern to the `patterns` list in `_extract_rating_from_context`.
3. **File map update** — add `src/lib/tab-configs.ts` to the file map as Modify (COLUMN_LABELS addition in Task 4 Step 3).
