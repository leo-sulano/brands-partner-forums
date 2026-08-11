# Divide Brands into Alternating Schedules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the EC2 automatic status-check pipeline (TP/AG/CG/WO) into 3 deterministic, stateless brand groups so each run — the weekly cron and the manual "Check Status" button alike — only processes one group's brands instead of every brand at once.

**Architecture:** A new pure Python module (`scripts/schedule_groups.py`) computes, with no persisted state anywhere, (a) which of 3 groups a given `(tab, brand)` belongs to via a stable hash, and (b) which group is "active" this week from the calendar date alone. One new function in `check_review_status.py` (`filter_by_active_group`) applies that check and is reused, unmodified, by all four platform scripts and both trigger paths (cron CLI, Flask manual-button route) — so the logic lives in exactly one place.

**Tech Stack:** Python 3 (pytest), Flask (`status_server.py`), TypeScript/React (`src/lib/queries.ts`, `src/pages/BrandGroup.tsx`).

## Global Constraints

- Exactly 3 groups, hardcoded (`NUM_GROUPS = 3`) — not configurable, per the approved design.
- Group assignment MUST use `hashlib` (e.g. `sha256`), never Python's built-in `hash()` — `hash()` on strings is randomized per-process (`PYTHONHASHSEED`) and would silently reassign every brand's group on every invocation.
- No new database table and no persisted rotation cursor of any kind — both the brand→group mapping and the active-group-this-run value are pure functions computed fresh every call (of `(tab, brand)` and of the current date, respectively).
- The group filter applies unconditionally to both the weekly EC2 cron path and the manual dashboard "Check Status" button — no override/escape-hatch flag anywhere.
- Skipped-brand visibility is a toast/summary count only — no per-row UI badge, no new page/route.
- Do not modify `entries` schema, Score Summary, Overview, Brand Tabs KPI computation, the Schedule Planner (`src/lib/scheduler/`), or the already-decommissioned `supabase/functions/check-review-status` Edge Function — all out of scope per the design spec.
- Existing `load_entries`/`load_ag_entries`/`load_cg_entries`/`load_wo_entries` functions and their existing tests (`test_check_review_status.py`, `test_check_ag_status.py`, `test_check_cg_status.py`, `test_check_wo_status.py`) must be left behaviorally unchanged — the group filter is applied as a separate step *after* these loaders return, never inside them (inside them, every existing test that asserts an exact returned count would become flaky depending on which week it's run).

Spec: `docs/superpowers/specs/2026-08-11-alternating-brand-check-schedules-design.md`

---

### Task 1: `schedule_groups.py` — deterministic group assignment and rotation

**Files:**
- Create: `scripts/schedule_groups.py`
- Create: `scripts/test_schedule_groups.py`

**Interfaces:**
- Produces: `NUM_GROUPS: int = 3`; `brand_group_index(tab: str, brand: str) -> int`; `active_group_index(today: Optional[date] = None) -> int`; `in_active_group(tab: str, brand: str, today: Optional[date] = None) -> bool`. These four names are imported by Task 2 (`from schedule_groups import in_active_group`) — do not rename.

- [ ] **Step 1: Write the failing tests**

Create `scripts/test_schedule_groups.py`:

```python
from datetime import date, timedelta

import schedule_groups as sg


def test_brand_group_index_is_deterministic_across_calls():
    a = sg.brand_group_index('Rooster Partners', 'Rocketspin')
    b = sg.brand_group_index('Rooster Partners', 'Rocketspin')
    assert a == b


def test_brand_group_index_is_case_and_whitespace_insensitive():
    a = sg.brand_group_index('Rooster Partners', 'Rocketspin')
    b = sg.brand_group_index(' rooster partners ', ' ROCKETSPIN ')
    assert a == b


def test_brand_group_index_in_range():
    for brand in ['Rocketspin', 'Lucky7even', 'Trybet.com', 'Boho Casino', '']:
        idx = sg.brand_group_index('Some Tab', brand)
        assert 0 <= idx < sg.NUM_GROUPS


def test_brand_group_index_differs_across_tabs_for_same_brand_name():
    # Not a hard requirement, just documents that (tab, brand) is the key,
    # not brand alone -- two tabs sharing a brand name aren't forced together.
    a = sg.brand_group_index('Rooster Partners', 'Rollero')
    b = sg.brand_group_index('Wizard of Odds', 'Rollero')
    # They *can* coincide by chance (1-in-3), so just assert both are valid
    # rather than asserting inequality (which would be flaky).
    assert 0 <= a < sg.NUM_GROUPS
    assert 0 <= b < sg.NUM_GROUPS


def test_active_group_index_cycles_through_all_groups_weekly():
    day0 = sg._EPOCH
    groups = [sg.active_group_index(date.fromordinal(day0.toordinal() + 7 * i)) for i in range(6)]
    assert groups == [0, 1, 2, 0, 1, 2]


def test_active_group_index_is_stable_within_the_same_week():
    base = sg.active_group_index(sg._EPOCH)
    mid_week = sg.active_group_index(sg._EPOCH + timedelta(days=3))
    assert base == mid_week


def test_in_active_group_matches_brand_and_active_group():
    day0 = sg._EPOCH
    assert sg.active_group_index(day0) == 0
    matching = None
    non_matching = None
    for name in ['brand-a', 'brand-b', 'brand-c', 'brand-d', 'brand-e', 'brand-f']:
        idx = sg.brand_group_index('Tab', name)
        if idx == 0 and matching is None:
            matching = name
        elif idx != 0 and non_matching is None:
            non_matching = name
    assert matching is not None
    assert non_matching is not None
    assert sg.in_active_group('Tab', matching, today=day0) is True
    assert sg.in_active_group('Tab', non_matching, today=day0) is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scripts && python -m pytest test_schedule_groups.py -v`
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'schedule_groups'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `scripts/schedule_groups.py`:

```python
"""Deterministic, stateless brand-group assignment for spreading the
automatic status-check workload across multiple runs instead of hitting
every brand every time.

No brand -> group table is persisted anywhere: a brand's group is a pure
function of its own (tab, brand) name, and which group is "active" for a
given run is a pure function of the current date. Both recompute the same
way every time, so a failed or skipped cron run never leaves stale state
to clean up, and a brand added tomorrow is assigned a group automatically
the first time it's ever queried -- no manual registration step, ever.
"""
import hashlib
from datetime import date
from typing import Optional

NUM_GROUPS = 3

# Any fixed Monday works as the anchor for the weekly rotation -- it only
# has to be stable across runs, not meaningful. Chosen arbitrarily.
_EPOCH = date(2026, 1, 5)


def brand_group_index(tab: str, brand: str) -> int:
    """Deterministic group (0..NUM_GROUPS-1) for a (tab, brand) pair.

    Uses hashlib, not Python's built-in hash() -- hash() on strings is
    randomized per-process (PYTHONHASHSEED) unless explicitly disabled,
    which would silently reassign every brand's group on every single
    script invocation instead of keeping it stable run to run.
    """
    key = f"{(tab or '').strip().lower()}::{(brand or '').strip().lower()}"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return int(digest, 16) % NUM_GROUPS


def active_group_index(today: Optional[date] = None) -> int:
    """Which group (0..NUM_GROUPS-1) is due to run, computed purely from
    the current date -- no stored cursor, so a missed or failed run just
    resumes on the correct group next time with no recovery step."""
    d = today or date.today()
    weeks_since_epoch = (d - _EPOCH).days // 7
    return weeks_since_epoch % NUM_GROUPS


def in_active_group(tab: str, brand: str, today: Optional[date] = None) -> bool:
    """True if this (tab, brand) pair's assigned group is the one active
    for `today` (defaults to the real current date)."""
    return brand_group_index(tab, brand) == active_group_index(today)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scripts && python -m pytest test_schedule_groups.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/schedule_groups.py scripts/test_schedule_groups.py
git commit -m "feat: add deterministic brand-group assignment for status-check rotation"
```

---

### Task 2: `filter_by_active_group()` in `check_review_status.py` + wire into TP's cron path

**Files:**
- Modify: `scripts/check_review_status.py` (add function near `find_brand_col`, ~line 674; wire into `main()`, ~lines 887-889 and ~960-962)
- Test: `scripts/test_check_review_status.py`

**Interfaces:**
- Consumes: `schedule_groups.in_active_group(tab, brand, today=None) -> bool` (Task 1).
- Produces: `filter_by_active_group(entries: list[dict]) -> tuple[list[dict], int]` — returns `(kept_entries, skipped_count)`. Imported by Tasks 3-6 as `from check_review_status import filter_by_active_group`. Do not rename.

- [ ] **Step 1: Write the failing test**

Add to `scripts/test_check_review_status.py` (near the existing `find_brand_col`/`load_entries` tests, reusing the file's existing `_row` helper):

```python
def test_filter_by_active_group_splits_kept_and_skipped(monkeypatch):
    monkeypatch.setattr(crs, 'in_active_group', lambda tab, brand, today=None: brand == 'Boho Casino')
    rows = [
        _row('Brand / TP URL PAGE', 'Boho Casino'),
        _row('Brand / TP URL PAGE', '7Bit Casino crypto'),
    ]

    kept, skipped = crs.filter_by_active_group(rows)

    assert len(kept) == 1
    assert kept[0]['data']['Brand / TP URL PAGE'] == 'Boho Casino'
    assert skipped == 1


def test_filter_by_active_group_treats_missing_brand_col_as_blank_brand(monkeypatch):
    monkeypatch.setattr(crs, 'in_active_group', lambda tab, brand, today=None: brand == '')
    rows = [{'id': 'row-1', 'tab': 'TP Brand Injection', 'sheet_row_id': 'sr-1', 'data': {'Link to the profile': 'x'}}]

    kept, skipped = crs.filter_by_active_group(rows)

    assert len(kept) == 1
    assert skipped == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scripts && python -m pytest test_check_review_status.py -v -k filter_by_active_group`
Expected: FAIL — `AttributeError: module 'check_review_status' has no attribute 'filter_by_active_group'` (and `in_active_group` doesn't exist there to monkeypatch yet).

- [ ] **Step 3: Write the implementation**

Add this import near the top of `scripts/check_review_status.py`, alongside the existing `from geo_proxy import country_code_for_entry` line (~line 35):

```python
from schedule_groups import in_active_group
```

Add this function directly after `find_brand_col` (after line 674):

```python
def filter_by_active_group(entries: list[dict]) -> tuple[list[dict], int]:
    """Keep only entries whose (tab, brand) hashes into this run's active
    schedule group (see schedule_groups.py). Entries that are skipped here
    are left completely untouched -- this only decides whether they're
    visited this run, never anything about their stored status/data."""
    kept: list[dict] = []
    skipped = 0
    for entry in entries:
        data = entry.get("data") or {}
        brand_col = find_brand_col(data)
        brand_val = (data.get(brand_col) or "").strip() if brand_col else ""
        if in_active_group(entry.get("tab") or "", brand_val):
            kept.append(entry)
        else:
            skipped += 1
    return kept, skipped
```

Then wire it into `main()`. Change (~line 887-889):

```python
    entries = load_entries(args.tab)
    total = len(entries)
    print(f"  -> {total} entries to check\n")
```

to:

```python
    entries = load_entries(args.tab)
    entries, skipped_group = filter_by_active_group(entries)
    total = len(entries)
    print(f"  -> {total} entries to check ({skipped_group} skipped -- not in this run's schedule group)\n")
```

And change the final summary print (~line 961):

```python
    print(f"Done.  checked={checked}  updated={updated}  errors={errors}")
```

to:

```python
    print(f"Done.  checked={checked}  updated={updated}  errors={errors}  skipped_group={skipped_group}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scripts && python -m pytest test_check_review_status.py -v`
Expected: PASS — all existing tests in this file still pass (they don't touch `filter_by_active_group` or the real `in_active_group`), plus the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add scripts/check_review_status.py scripts/test_check_review_status.py
git commit -m "feat: apply active-group filter to TP's weekly cron path"
```

---

### Task 3: Wire the group filter into `status_server.py`'s manual TP check

**Files:**
- Modify: `scripts/status_server.py` (import ~line 29-34, TP branch ~lines 156-230)

**Interfaces:**
- Consumes: `filter_by_active_group` (Task 2).
- Produces: the `/check-status` route's JSON response gains a `skipped_group` integer field, consumed by Task 7's frontend changes.

There is no existing `test_status_server.py` in this repo (the Flask routes aren't covered by automated tests today) — this task is a direct code edit, verified by re-reading the edited block, matching the codebase's existing test-coverage boundary for this file.

- [ ] **Step 1: Add the import**

In `scripts/status_server.py`, change the import block (~line 29-34):

```python
from check_review_status import (
    load_entries, build_driver, fetch_status,
    find_status_col, find_score_col, update_entry,
    BATCH_SIZE, DELAY_BETWEEN_BATCHES, CHROME_RESTART_EVERY,
    REVIEW_TEXT_KEYS,
)
```

to:

```python
from check_review_status import (
    load_entries, build_driver, fetch_status,
    find_status_col, find_score_col, update_entry,
    BATCH_SIZE, DELAY_BETWEEN_BATCHES, CHROME_RESTART_EVERY,
    REVIEW_TEXT_KEYS, filter_by_active_group,
)
```

- [ ] **Step 2: Apply the filter and thread `skipped_group` through both TP response paths**

In the `check_status()` route's TP branch, change (~line 156-163):

```python
        # Default: TP Selenium check.
        entries = load_entries(tab, include_published=include_published, brands=brands,
                                status_filter=status_filter, agent=agent, proxy=proxy, country=country)
        total = len(entries)
        print(f'\n[server] TP check started — {total} entries ({scope})')

        if not total:
            return jsonify({'checked': 0, 'updated': 0, 'errors': 0, 'total': 0})
```

to:

```python
        # Default: TP Selenium check.
        entries = load_entries(tab, include_published=include_published, brands=brands,
                                status_filter=status_filter, agent=agent, proxy=proxy, country=country)
        entries, skipped_group = filter_by_active_group(entries)
        total = len(entries)
        print(f'\n[server] TP check started — {total} entries ({scope}, {skipped_group} skipped — not in this run\'s schedule group)')

        if not total:
            return jsonify({'checked': 0, 'updated': 0, 'errors': 0, 'total': 0, 'skipped_group': skipped_group})
```

And the final return (~line 230):

```python
        return jsonify({'checked': checked, 'updated': updated, 'errors': errors, 'sheet_errors': sheet_errors, 'total': total})
```

to:

```python
        return jsonify({'checked': checked, 'updated': updated, 'errors': errors, 'sheet_errors': sheet_errors, 'total': total, 'skipped_group': skipped_group})
```

- [ ] **Step 3: Verify by reading the edited block back**

Re-read `scripts/status_server.py` lines 98-235 and confirm: `filter_by_active_group` is called exactly once, right after `load_entries(...)`, `total` is computed from the *filtered* list, and both the early-return (`not total`) and the final `jsonify(...)` include `skipped_group`.

- [ ] **Step 4: Commit**

```bash
git add scripts/status_server.py
git commit -m "feat: apply active-group filter to manual TP Check Status route"
```

---

### Task 4: Wire the group filter into `check_ag_status.py`

**Files:**
- Modify: `scripts/check_ag_status.py` (import ~line 38-56, `check_ag_for_tab` ~lines 290-293 and 387, `main()` print ~line 405)

**Interfaces:**
- Consumes: `filter_by_active_group` (Task 2). `check_ag_for_tab` is called both by `status_server.py`'s `/check-ag-status` route (manual button) and by this file's own `main()` (the weekly cron's AG step) — one edit here covers both, no changes needed in `status_server.py` for AG/CG/WO.

- [ ] **Step 1: Add the import**

Change the `from check_review_status import (...)` block (~line 38-56) to add `filter_by_active_group,` to the list (alphabetical placement doesn't matter — match the file's existing ad-hoc ordering, add it next to `matches_scope_filters`).

- [ ] **Step 2: Apply the filter in `check_ag_for_tab`**

Change (~line 290-293):

```python
    entries = load_ag_entries(tab, include_published, country, status_filter, brands, agent, proxy)
    total = len(entries)
    if not total:
        return {"checked": 0, "updated": 0, "errors": 0, "sheet_errors": 0, "total": 0}
```

to:

```python
    entries = load_ag_entries(tab, include_published, country, status_filter, brands, agent, proxy)
    entries, skipped_group = filter_by_active_group(entries)
    total = len(entries)
    if not total:
        return {"checked": 0, "updated": 0, "errors": 0, "sheet_errors": 0, "total": 0, "skipped_group": skipped_group}
```

And the final return (~line 387):

```python
    return {"checked": checked, "updated": updated, "errors": errors, "sheet_errors": sheet_errors, "total": total}
```

to:

```python
    return {"checked": checked, "updated": updated, "errors": errors, "sheet_errors": sheet_errors, "total": total, "skipped_group": skipped_group}
```

- [ ] **Step 3: Update the CLI summary print**

Change (~line 405):

```python
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']}")
```

to:

```python
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']} skipped_group={result.get('skipped_group', 0)}")
```

- [ ] **Step 4: Run the existing AG test suite to confirm nothing broke**

Run: `cd scripts && python -m pytest test_check_ag_status.py -v`
Expected: PASS — these tests call `load_ag_entries` directly, not `check_ag_for_tab`, so they're unaffected by this change.

- [ ] **Step 5: Commit**

```bash
git add scripts/check_ag_status.py
git commit -m "feat: apply active-group filter to AskGamblers status check"
```

---

### Task 5: Wire the group filter into `check_cg_status.py`

**Files:**
- Modify: `scripts/check_cg_status.py` (import ~line 38-56, `check_cg_for_tab` ~lines 303-306 and its final return, `main()` print ~line 415)

**Interfaces:**
- Consumes: `filter_by_active_group` (Task 2). Same reasoning as Task 4 — `check_cg_for_tab` serves both the manual button and the weekly cron's CG step.

- [ ] **Step 1: Add the import**

Add `filter_by_active_group,` to the `from check_review_status import (...)` block (~line 38-56), next to `matches_scope_filters`.

- [ ] **Step 2: Apply the filter in `check_cg_for_tab`**

Change (~line 303-306):

```python
    entries = load_cg_entries(tab, include_published, country, status_filter, brands, agent, proxy)
    total = len(entries)
    if not total:
        return {"checked": 0, "updated": 0, "errors": 0, "sheet_errors": 0, "total": 0}
```

to:

```python
    entries = load_cg_entries(tab, include_published, country, status_filter, brands, agent, proxy)
    entries, skipped_group = filter_by_active_group(entries)
    total = len(entries)
    if not total:
        return {"checked": 0, "updated": 0, "errors": 0, "sheet_errors": 0, "total": 0, "skipped_group": skipped_group}
```

Find `check_cg_for_tab`'s final `return {"checked": checked, ...}` statement (mirrors `check_ag_for_tab`'s, at the end of the function) and add `, "skipped_group": skipped_group` before the closing brace, same as Task 4 Step 2.

- [ ] **Step 3: Update the CLI summary print**

Change (~line 415):

```python
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']}")
```

to:

```python
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']} skipped_group={result.get('skipped_group', 0)}")
```

- [ ] **Step 4: Run the existing CG test suite to confirm nothing broke**

Run: `cd scripts && python -m pytest test_check_cg_status.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/check_cg_status.py
git commit -m "feat: apply active-group filter to CasinoGuru status check"
```

---

### Task 6: Wire the group filter into `check_wo_status.py`

**Files:**
- Modify: `scripts/check_wo_status.py` (import ~line 31-42, `check_wo_for_tab` ~lines 242-245 and its final return, `main()` print ~line 342)

**Interfaces:**
- Consumes: `filter_by_active_group` (Task 2). Same reasoning as Tasks 4/5.

- [ ] **Step 1: Add the import**

Add `filter_by_active_group,` to the `from check_review_status import (...)` block (~line 31-42), next to `matches_scope_filters`.

- [ ] **Step 2: Apply the filter in `check_wo_for_tab`**

Change (~line 242-245):

```python
    entries = load_wo_entries(tab, include_published, status_filter, brands, agent, proxy, country)
    total = len(entries)
    if not total:
        return {"checked": 0, "updated": 0, "errors": 0, "sheet_errors": 0, "total": 0}
```

to:

```python
    entries = load_wo_entries(tab, include_published, status_filter, brands, agent, proxy, country)
    entries, skipped_group = filter_by_active_group(entries)
    total = len(entries)
    if not total:
        return {"checked": 0, "updated": 0, "errors": 0, "sheet_errors": 0, "total": 0, "skipped_group": skipped_group}
```

Find `check_wo_for_tab`'s final `return {"checked": checked, ...}` statement and add `, "skipped_group": skipped_group` before the closing brace.

- [ ] **Step 3: Update the CLI summary print**

Change (~line 342):

```python
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']}")
```

to:

```python
    print(f"\nDone. checked={result['checked']} updated={result['updated']} errors={result['errors']} skipped_group={result.get('skipped_group', 0)}")
```

- [ ] **Step 4: Run the existing WO test suite to confirm nothing broke**

Run: `cd scripts && python -m pytest test_check_wo_status.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/check_wo_status.py
git commit -m "feat: apply active-group filter to Wizard of Odds status check"
```

---

### Task 7: Surface the skip count in the dashboard's Check Status toast

**Files:**
- Modify: `src/lib/queries.ts` (4 return-type annotations: `triggerStatusCheck`, `triggerAgStatusCheck`, `triggerCgStatusCheck`, `triggerWoStatusCheck`)
- Modify: `src/pages/BrandGroup.tsx` (`handleCheckStatus`, ~lines 1524-1622)

**Interfaces:**
- Consumes: the `skipped_group?: number` field now present in every `/check-*-status` JSON response (Tasks 3-6).
- Produces: no new exports — this is the final consumer of the field.

There is no `BrandGroup.test.tsx` in this repo today (this component isn't unit-tested) — this task is a direct code edit, verified via `npm run build` (per this project's standing rule that `tsc --noEmit` alone doesn't catch real errors here) and a self-review of the edited block.

- [ ] **Step 1: Add `skipped_group` to the 4 trigger function return types**

In `src/lib/queries.ts`, for each of `triggerStatusCheck`, `triggerAgStatusCheck`, `triggerCgStatusCheck`, `triggerWoStatusCheck`, change:

```typescript
): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number }> {
```

to:

```typescript
): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number; skipped_group?: number }> {
```

(4 occurrences — one per function signature.)

- [ ] **Step 2: Aggregate and display the skip count in `BrandGroup.tsx`**

In `handleCheckStatus` (`src/pages/BrandGroup.tsx`), change the `results`/`r` type annotations (~lines 1552 and 1559) to add `skipped_group?: number`:

```typescript
      const results: { checked?: number; updated: number; errors: number; sheet_errors?: number; skipped_group?: number }[] = [];
```

```typescript
          let r: { checked: number; updated: number; errors: number; sheet_errors?: number; skipped_group?: number };
```

Add a `totalSkippedGroup` accumulator next to the existing `totalSheetErrors` one (~line 1574-1580):

```typescript
      let totalChecked = 0;
      let totalUpdated = 0;
      let totalErrors = 0;
      let totalSheetErrors = 0;
      let totalSkippedGroup = 0;
      for (const r of results) {
        totalChecked      += r.checked ?? 0;
        totalUpdated      += r.updated ?? 0;
        totalErrors       += r.errors  ?? 0;
        totalSheetErrors  += r.sheet_errors ?? 0;
        totalSkippedGroup += r.skipped_group ?? 0;
      }
```

Then, right before `setToast({ message: msg, kind });` (~line 1612), append the skip note to whatever message was already built:

```typescript
      if (totalSkippedGroup > 0) {
        msg += ` — ${totalSkippedGroup} skipped (not scheduled this week)`;
      }
      setToast({ message: msg, kind });
```

- [ ] **Step 3: Verify with a real build**

Run: `npm run build`
Expected: builds cleanly with no new TypeScript errors (this project's `tsc --noEmit` alone is not sufficient here — the root tsconfig is references-only).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries.ts src/pages/BrandGroup.tsx
git commit -m "feat: show skipped-brand count in Check Status toast"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/ec2-scraper-runbook.md` (append a subsection under "Weekly All-Platform Cron Job", ~after line 143)
- Modify: `docs/task-history.md` (append new Task 202 entry)

**Interfaces:** None — documentation only, no code.

- [ ] **Step 1: Add a "Brand Schedule Groups" subsection to the runbook**

In `docs/ec2-scraper-runbook.md`, insert immediately after the existing "Weekly All-Platform Cron Job" section's closing `---` (currently at line 145, right before "## Updating the Script"):

```markdown
## Brand Schedule Groups

Added 2026-08-11 to spread the weekly all-platform run's load: every brand is deterministically
split into 3 groups (`scripts/schedule_groups.py`, `brand_group_index(tab, brand)` — a stable
hash of the tab + brand name, no database table involved), and each Monday's run only checks
whichever group is "active" that week (`active_group_index()`, computed purely from the
calendar date — no stored cursor). A brand not in this week's active group is skipped
entirely by all four platform checkers, and also by the manual dashboard "Check Status"
button — there is no override. Full rotation (every brand checked at least once) takes
3 weeks.

`filter_by_active_group()` in `check_review_status.py` is the one place this is enforced;
`check_ag_status.py`/`check_cg_status.py`/`check_wo_status.py`'s `check_*_for_tab()` functions
and `status_server.py`'s TP branch all call it right after loading entries, so both the cron
path and the manual-button path are covered by the same code.

**To check which group is active this week without SSH-ing in and reading logs**, run this
on the EC2 box (or anywhere with the repo checked out and no dependencies beyond the
standard library):

```bash
cd ~/scripts   # or wherever check_review_status.py lives on this box
python3 -c "import schedule_groups as sg; from datetime import date; print(sg.active_group_index(date.today()))"
```

**Known trade-off:** stacked on top of this same runbook's earlier TP daily-\>weekly cadence
change, a brand can now go up to 3 weeks between checks on any given platform. Accepted
deliberately when this was designed — revisit only if real-world staleness turns out to be a
problem in practice.

---
```

- [ ] **Step 2: Append a Task entry to `docs/task-history.md`**

Add a new task at the top of the file's task list. As of this plan being written, the most
recent entry is Task 202 ("Multi-Select Dashboard Filters", landed concurrently in another
worktree) — **before appending, check `grep -oE "^## Task [0-9]+" docs/task-history.md | tail -1`
to confirm the actual current highest number and use the next integer**, renumbering the
heading below if it's no longer 202. Follow this repo's existing entry format (see Task
201/200 for the exact style — date line, bullet-point body, `### Known Issues / Backlog`
subsection if applicable):

```markdown
## Task 203: Divide Brands into Alternating Schedules

**Date:** 2026-08-11

Split the EC2 automatic status-check pipeline into 3 deterministic, stateless brand groups so
neither the weekly all-platform cron (Task 201) nor the manual "Check Status" button processes
every brand at once. A brand's group (`schedule_groups.py`'s `brand_group_index(tab, brand)`) is
a stable hash of its own tab + name — no new table, no manual assignment step, a brand added
tomorrow is grouped automatically the instant it's first queried. Which group is active for a
given run (`active_group_index()`) is computed purely from the calendar date, with no persisted
cursor — a failed or skipped run self-corrects on the next one with no recovery step needed.

- Enforced in exactly one place, `check_review_status.py`'s new `filter_by_active_group()`,
  called by all four platform checkers' entry points (`check_ag_for_tab`/`check_cg_for_tab`/
  `check_wo_for_tab`, plus TP's own `main()` and `status_server.py`'s TP branch) — both the
  weekly cron and the manual dashboard button go through the same function, so they can't
  drift from each other.
- Deliberately no override: a brand outside the current run's active group is skipped
  unconditionally regardless of how the check was triggered, per an explicit decision during
  design over adding an "ignore schedule" escape hatch.
- 3 groups was kept even after confirming, during design, that it means a 3-week full rotation
  on top of Task 201's daily-\>weekly cadence change for TP — an accepted trade-off, not
  revisited further.
- Dashboard's Check Status result toast gains a skip count (e.g. "Checked 14 — 31 skipped (not
  scheduled this week)") sourced from the checker's own response — no per-row badge, no new
  page.
- No schema change; no change to Score Summary/Overview/Brand Tabs KPI computation or the
  Schedule Planner (an unrelated feature/scheduling engine).
- Spec: `docs/superpowers/specs/2026-08-11-alternating-brand-check-schedules-design.md`. Plan:
  `docs/superpowers/plans/2026-08-11-alternating-brand-check-schedules.md`.

### Known Issues / Backlog (added by this task)
- Live verification against the real EC2 box (confirming a real weekly-cron invocation
  actually skips the expected brands) was not performed if no EC2 SSH access was available in
  the implementing session — check `docs/ec2-scraper-runbook.md`'s "Brand Schedule Groups"
  section for the no-SSH way to at least confirm which group is active, and flag here whether
  a real SSH-based end-to-end check still needs to happen.
- No dashboard-side visibility into *which* brands are in which group ahead of time (only a
  post-run skip count) — same category of gap as the weekly cron's own health visibility,
  noted in Task 201's Known Issues. Worth a joint follow-up if either becomes a real pain
  point.
```

(Replace `[date]` with today's date when this task is actually executed; renumber if Task 201 is no longer the most recent task by the time this executes.)

- [ ] **Step 3: Commit**

```bash
git add docs/ec2-scraper-runbook.md docs/task-history.md
git commit -m "docs: document alternating brand check schedules"
```
