# Unify AG/CG Status Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AG's date-based Pending/Refused escalation and CG's missing escalation with one shared, self-correcting rule: found → Published; not-found-from-Published → Removed; not-found-from-anything-else → Refused — with Refused now perpetually re-checkable instead of a dead end.

**Architecture:** A single pure function `resolve_status(found: bool, current_status: str) -> str` lives in `check_review_status.py` (alongside the existing shared `page_blocked()`), imported and called identically by `check_ag_status.py` and `check_cg_status.py`. No new files.

**Tech Stack:** Python 3.14, pytest.

## Global Constraints

- `resolve_status` must be case-insensitive on `current_status` (matches existing codebase convention of `.strip().lower()` comparisons — see `page_blocked`, `load_ag_entries`).
- `Removed` stays excluded from `CHECKABLE_STATUSES` in both files — not part of this change.
- No changes to `check_wo_status.py` or TP's own loop in `check_review_status.py`.
- No data migration — this is a live, check-time decision.

---

### Task 1: Add shared `resolve_status()` with tests

**Files:**
- Modify: `scripts/check_review_status.py` (insert after `page_blocked`, currently ending at line 132)
- Test: `scripts/test_check_review_status.py`

**Interfaces:**
- Produces: `resolve_status(found: bool, current_status: str) -> str` — importable from `check_review_status` by both `check_ag_status.py` and `check_cg_status.py`.

- [ ] **Step 1: Write the failing tests**

Add to the end of `scripts/test_check_review_status.py`:

```python
def test_resolve_status_found_is_always_published():
    assert crs.resolve_status(found=True, current_status='Done') == 'Published'
    assert crs.resolve_status(found=True, current_status='Pending') == 'Published'
    assert crs.resolve_status(found=True, current_status='Refused') == 'Published'
    assert crs.resolve_status(found=True, current_status='Published') == 'Published'


def test_resolve_status_not_found_from_published_is_removed():
    assert crs.resolve_status(found=False, current_status='Published') == 'Removed'
    assert crs.resolve_status(found=False, current_status='published') == 'Removed'
    assert crs.resolve_status(found=False, current_status='  Published  ') == 'Removed'


def test_resolve_status_not_found_from_done_pending_or_refused_is_refused():
    assert crs.resolve_status(found=False, current_status='Done') == 'Refused'
    assert crs.resolve_status(found=False, current_status='Pending') == 'Refused'
    assert crs.resolve_status(found=False, current_status='Refused') == 'Refused'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scripts && python -m pytest test_check_review_status.py -k resolve_status -v`
Expected: FAIL with `AttributeError: module 'check_review_status' has no attribute 'resolve_status'`

- [ ] **Step 3: Implement `resolve_status`**

In `scripts/check_review_status.py`, insert immediately after the `page_blocked` function (after the line `    return False` that closes it, before the blank lines leading into `TP_STATUS_COLS`):

```python


# ─── Status resolution (shared by AG/CG) ──────────────────────────────────────

def resolve_status(found: bool, current_status: str) -> str:
    """Decide the next status from a scrape result. `found` is whether the
    username was located on the review page; `current_status` is the status
    before this check. Shared by AG and CG so they can't drift apart:
      found                              -> Published
      not found, current was Published   -> Removed
      not found, current was anything else (Done/Pending/Refused) -> Refused
    Refused is not a dead end — it's re-checked on every future run, so a
    review misjudged as Refused before moderation catches up simply flips to
    Published once it's actually found live."""
    if found:
        return "Published"
    if current_status.strip().lower() == "published":
        return "Removed"
    return "Refused"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scripts && python -m pytest test_check_review_status.py -k resolve_status -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `cd scripts && python -m pytest test_check_review_status.py test_geo_proxy.py -q`
Expected: `26 passed` (23 existing + 3 new)

- [ ] **Step 6: Commit**

```bash
git add scripts/check_review_status.py scripts/test_check_review_status.py
git commit -m "feat: add shared resolve_status() for AG/CG status decisions"
```

---

### Task 2: Wire `resolve_status` into `check_ag_status.py`, remove date-based logic

**Files:**
- Modify: `scripts/check_ag_status.py`

**Interfaces:**
- Consumes: `resolve_status(found: bool, current_status: str) -> str` from Task 1.

- [ ] **Step 1: Update the import block**

In `scripts/check_ag_status.py`, change:

```python
from check_review_status import (
    build_driver,
    update_entry,
    _headers,
    _fetch_all,
    proxy_for_entry,
    log_check_error,
    page_blocked,
    SUPABASE_URL,
    BATCH_SIZE,
    DELAY_BETWEEN_BATCHES,
    CHROME_RESTART_EVERY,
)
```

to:

```python
from check_review_status import (
    build_driver,
    update_entry,
    _headers,
    _fetch_all,
    proxy_for_entry,
    log_check_error,
    page_blocked,
    resolve_status,
    SUPABASE_URL,
    BATCH_SIZE,
    DELAY_BETWEEN_BATCHES,
    CHROME_RESTART_EVERY,
)
```

- [ ] **Step 2: Remove the now-unused `datetime` import**

Change:

```python
from datetime import datetime, timedelta, timezone
from typing import Optional
```

to:

```python
from typing import Optional
```

- [ ] **Step 3: Remove `AG_DATE_COLS` and update `CHECKABLE_STATUSES`**

Change:

```python
AG_STATUS_COLS = ["AG Review Status"]
AG_LINK_COLS   = ["AG Review Link", "AG Link"]
AG_USER_COLS   = ["AG User"]
AG_DATE_COLS   = ["AG Added"]
# VERIFY: check the actual column name in the Sheet; update if different
AG_SCORE_COLS  = ["AG Score added"]

CHECKABLE_STATUSES = {"done", "pending", "published"}
```

to:

```python
AG_STATUS_COLS = ["AG Review Status"]
AG_LINK_COLS   = ["AG Review Link", "AG Link"]
AG_USER_COLS   = ["AG User"]
# VERIFY: check the actual column name in the Sheet; update if different
AG_SCORE_COLS  = ["AG Score added"]

CHECKABLE_STATUSES = {"done", "pending", "published", "refused"}
```

- [ ] **Step 4: Remove `_older_than_one_day`**

Delete this whole function (it becomes unused once Step 6 lands):

```python
def _older_than_one_day(date_str: str) -> bool:
    """Return True if date_str represents a date more than 24 h ago."""
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            dt = datetime.strptime(date_str.strip(), fmt).replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - dt) > timedelta(days=1)
        except ValueError:
            continue
    return True  # unparseable → treat as old
```

- [ ] **Step 5: Make Refused always-eligible regardless of `include_published`**

In `load_ag_entries`, change:

```python
    statuses = CHECKABLE_STATUSES if include_published else {"done", "pending"}
```

to:

```python
    statuses = CHECKABLE_STATUSES if include_published else {"done", "pending", "refused"}
```

(This keeps `published` gated by the existing `include_published` flag — unchanged, pre-existing behavior — while `refused` now behaves like `done`/`pending`: always eligible.)

- [ ] **Step 6: Replace the date-based decision branch**

In `check_ag_for_tab`, change:

```python
                if new_status is None:
                    current_lower = current.strip().lower()
                    if current_lower in ("pending", "done"):
                        ag_added = _val(data, AG_DATE_COLS) or ""
                        new_status = "Refused" if (not ag_added or _older_than_one_day(ag_added)) else "Pending"
                    else:
                        print(f"    -> not found / no status change needed")
                        continue
```

to:

```python
                if new_status is None:
                    new_status = resolve_status(found=False, current_status=current)
```

- [ ] **Step 7: Fix `fetch_ag_review`'s stale docstring**

This docstring already claimed `fetch_ag_review` itself returns `'Removed'` for a not-found Published entry — it never actually did (that logic lived in the caller, and now lives in `resolve_status`). Fix it while touching this exact behavior. Change:

```python
    Returns (status, rating):
      ('Published', 1-5 or None)  — username found in reviews
      ('Removed', None)           — not found, current status was 'published'
      (None, None)                — not found, status was not published (no write needed)
      ('__skip__', None)          — page blocked/CAPTCHA; skip without changing status
    """
```

to:

```python
    Returns (status, rating):
      ('Published', 1-5 or None)  — username found in reviews
      (None, None)                — not found; caller resolves the next status via resolve_status()
      ('__skip__', None)          — page blocked/CAPTCHA; skip without changing status
    """
```

- [ ] **Step 8: Update the module docstring**

Change:

```python
Status values: Published | Removed
  (no write when username not found and status was not previously Published)
```

to:

```python
Status values: Published | Refused | Removed
  (Refused when not found and not previously Published; Removed when not
  found and previously Published)
```

- [ ] **Step 9: Run the full test suite**

Run: `cd scripts && python -m pytest test_check_review_status.py test_geo_proxy.py -q`
Expected: `26 passed`

- [ ] **Step 10: Sanity-check the file has no leftover references to removed symbols**

Run: `cd scripts && grep -n "AG_DATE_COLS\|_older_than_one_day\|timedelta\|timezone" check_ag_status.py`
Expected: no output (empty — confirms nothing was missed)

- [ ] **Step 11: Commit**

```bash
git add scripts/check_ag_status.py
git commit -m "refactor: replace AG's date-based Refused escalation with shared resolve_status"
```

---

### Task 3: Wire `resolve_status` into `check_cg_status.py`

**Files:**
- Modify: `scripts/check_cg_status.py`

**Interfaces:**
- Consumes: `resolve_status(found: bool, current_status: str) -> str` from Task 1.

- [ ] **Step 1: Update the import block**

Change:

```python
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
```

to:

```python
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
    resolve_status,
)
```

- [ ] **Step 2: Update `CHECKABLE_STATUSES`**

Change:

```python
CHECKABLE_STATUSES = {"done", "pending", "published"}
```

to:

```python
CHECKABLE_STATUSES = {"done", "pending", "published", "refused"}
```

- [ ] **Step 3: Make Refused always-eligible regardless of `include_published`**

In `load_cg_entries`, change:

```python
    statuses = CHECKABLE_STATUSES if include_published else {"done", "pending"}
```

to:

```python
    statuses = CHECKABLE_STATUSES if include_published else {"done", "pending", "refused"}
```

- [ ] **Step 4: Replace `fetch_cg_review`'s tail decision**

Change:

```python
    if current_status.strip().lower() == "published":
        return ("Removed", None)
    return (None, None)
```

to:

```python
    return (resolve_status(found=False, current_status=current_status), None)
```

- [ ] **Step 5: Update `fetch_cg_review`'s docstring**

Change:

```python
    Returns (status, rating):
      ('Published', 1-5 or None)  — username found in reviews
      ('Removed', None)           — not found, current status was 'published'
      (None, None)                — not found, status was not published (no write)
      ('__skip__', None)          — page blocked/CAPTCHA; skip without changing status
    """
```

to:

```python
    Returns (status, rating):
      ('Published', 1-5 or None)  — username found in reviews
      ('Removed', None)           — not found, current status was 'published'
      ('Refused', None)           — not found, current status was not 'published'
      ('__skip__', None)          — page blocked/CAPTCHA; skip without changing status
    """
```

- [ ] **Step 6: Remove the now-dead "not found" branch in `check_cg_for_tab`**

`fetch_cg_review` no longer returns `(None, None)` — it always returns a concrete status (or `"__skip__"`). Change:

```python
                if new_status == "__skip__":
                    continue

                if new_status is None:
                    print(f"    -> not found / no status change needed")
                    continue

                updates: dict = {}
```

to:

```python
                if new_status == "__skip__":
                    continue

                updates: dict = {}
```

- [ ] **Step 7: Run the full test suite**

Run: `cd scripts && python -m pytest test_check_review_status.py test_geo_proxy.py -q`
Expected: `26 passed`

- [ ] **Step 8: Commit**

```bash
git add scripts/check_cg_status.py
git commit -m "feat: add Refused escalation to CG via shared resolve_status"
```

---

### Task 4: Live verification and production deployment

**Files:** none (verification only)

**Interfaces:** none — this task exercises Tasks 1–3's code against real data.

- [ ] **Step 1: Local dry-run against a known Refused entry (read-only, no writes)**

Confirm a currently-Refused CG entry gets a real page-load and a decision from `resolve_status` (not a silent no-op like before). Run from `scripts/`:

```bash
python -c "
from check_review_status import build_driver
from check_cg_status import fetch_cg_review

d = build_driver(headless=False, proxy='')
try:
    status, rating = fetch_cg_review(d, 'https://casino.guru/dachbet-casino-review', 'VidarP9', 'Refused')
    print('RESULT:', status, rating)
finally:
    d.quit()
"
```

Expected: `RESULT: Published <rating>` or `RESULT: Refused None` — either is correct (both are real decisions now); the important thing is it's not silently skipped.

- [ ] **Step 2: Confirm the entry is now loadable at all**

Before this change, a Refused entry was excluded from `CHECKABLE_STATUSES` and would never appear in `load_cg_entries`. Confirm it now does:

```bash
python -c "
from check_cg_status import load_cg_entries
entries = load_cg_entries('Hanan', include_published=True)
matches = [e for e in entries if e['data'].get('CG User') == 'VidarP9']
print('found in eligible set:', len(matches) == 1)
"
```

Expected: `found in eligible set: True`

- [ ] **Step 3: Deploy to EC2**

Production AG/CG checks run on EC2 (confirmed in Task 100), not locally. Deploy the three modified files:

```bash
scp -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" scripts/check_review_status.py scripts/check_ag_status.py scripts/check_cg_status.py scripts/test_check_review_status.py ec2-user@54.179.186.205:~/
```

- [ ] **Step 4: Run tests on EC2**

```bash
ssh -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" ec2-user@54.179.186.205 "cd ~ && python3 -m pytest test_check_review_status.py -k resolve_status -v"
```

Expected: `3 passed`

- [ ] **Step 5: Restart EC2's `status_server.py` to load the new code**

A running Python process doesn't reload changed files on disk — find the current PID and restart it:

```bash
ssh -i "C:\Users\Leo\OneDrive\Documents\leoscraper\leoscraper.pem" ec2-user@54.179.186.205 "pkill -f 'python3 status_server.py'; sleep 2; cd ~ && nohup python3 status_server.py --port 5001 > ~/status_server.log 2>&1 & disown; sleep 3; curl -s http://127.0.0.1:5001/health"
```

Expected: `{"ok":true}`

- [ ] **Step 6: Verify through the real production path**

Trigger a real CG check for Hanan (the tab containing the `VidarP9` Refused entry) through the actual Supabase Edge Function → EC2 path:

```bash
cd scripts && export $(grep -m1 '^CHECK_STATUS_TOKEN=' .env) && curl -s -m 300 -X POST "https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/proxy-check-status" -H "Content-Type: application/json" -H "Authorization: Bearer $CHECK_STATUS_TOKEN" -d '{"tab":"Hanan","include_published":true,"platform":"cg"}'
```

Expected: valid JSON with `"errors":0` and a `"checked"` count that now includes the previously-excluded Refused entry (compare against the tab's total eligible count from Step 2's style of query — the count should be higher than a pre-change run would have shown, since Refused entries are now included).

- [ ] **Step 7: Confirm `VidarP9`'s status reflects a real decision, not a stale value**

```bash
python3 -c "
from check_review_status import _fetch_all
rows = _fetch_all({'select': 'id,tab,data,updated_at,last_edited_by', 'tab': 'eq.Hanan'})
for row in rows:
    d = row.get('data') or {}
    if d.get('CG User') == 'VidarP9':
        print(d.get('CG Review Status'), row.get('updated_at'), row.get('last_edited_by'))
"
```

Expected: either `Published` (if the review is now live) or `Refused` (unchanged, if still genuinely not found) — both are correct outcomes of this change. What would indicate a problem: an error, a crash, or the entry still being silently skipped.

---

## Notes for the implementer

- Tasks 1–3 are pure code changes with fast local test cycles — no Selenium/network needed until Task 4.
- Do not run Task 4 until Tasks 1–3's commits are in place; Task 4 deploys and restarts the actual production server.
- If Step 6 of Task 4 takes a long time (multiple minutes) — that's expected. Real Selenium checks against a full tab, non-headless, take time. Do not interrupt it.
