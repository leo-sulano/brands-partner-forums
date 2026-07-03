# Unify AG/CG Status Resolution — Design

**Date:** 2026-07-03
**Status:** Approved (design); pending implementation plan

## Problem

AG and CG currently decide the next status differently, and both have gaps:

- **AG**: when the username isn't found, and current status is `Pending`/`Done`,
  it checks the `AG Added` date — older than 1 day → `Refused`, else stays
  `Pending`. If current status is `Published` and the username stops being
  found, AG makes **no change at all** (never flips to `Removed`).
- **CG**: when the username isn't found and current status is `Published`, it
  flips to `Removed`. If current status is `Pending`/`Done`, CG makes **no
  change at all** — no escalation logic exists.
- Once an entry reaches `Refused`, it's excluded from all future checks
  (`CHECKABLE_STATUSES` doesn't include `refused`) — a dead end.

Moderation time on both sites varies — sometimes a submitted review takes
several days longer than usual to actually go live. AG's fixed 1-day cutoff
can mark a review `Refused` before moderation has caught up, and because
`Refused` is a dead end, that misjudgment is never corrected.

## Goal

One rule, shared by AG and CG, that self-corrects instead of relying on a
time cutoff:

- Re-check any entry currently `Done`, `Pending`, `Refused`, or `Published`.
- Username **found** → `Published`.
- Username **not found**, current status **was `Published`** → `Removed`.
- Username **not found**, current status was anything else (`Done` /
  `Pending` / `Refused`) → `Refused`.

Because `Refused` is now re-checked on every future run (no cutoff, per
user's explicit choice), a review that gets marked `Refused` too early simply
flips to `Published` the next time it's actually found live — no date math
required.

## Non-Goals

- `Removed` stays excluded from re-checks — once genuinely removed, it isn't
  expected to reappear, unlike a slow-to-moderate submission. No change to
  this.
- No changes to Wizard of Odds (`check_wo_status.py`) or TP
  (`check_review_status.py`'s own TP loop). Same-shaped bug may exist there
  (flagged in Task 98) but is out of scope here.
- No backfill/migration of existing data — this is a live, check-time
  decision based on whatever status is currently stored plus this run's
  scrape result. Nothing needs to be recomputed retroactively.

## Design

### Shared decision function

New pure function in `check_review_status.py` (same module `page_blocked()`
already lives in, for the same reason — AG and CG must not be able to drift
apart on this logic again):

```python
def resolve_status(found: bool, current_status: str) -> str:
    """Decide the next status from a scrape result. `found` is whether the
    username was located on the review page; `current_status` is the status
    before this check. Shared by AG and CG so they can't drift apart."""
    if found:
        return "Published"
    if current_status.strip().lower() == "published":
        return "Removed"
    return "Refused"
```

### Call sites

- `check_ag_status.py`: `CHECKABLE_STATUSES` gains `"refused"`. The existing
  date-based branch (lines ~315-322, `if new_status is None: ... current_lower
  in ("pending", "done") ... _older_than_one_day(...)`) is replaced with a call
  to `resolve_status(found=False, current_status=current)` (the `found=True`
  path already returns `"Published"` directly from `fetch_ag_review` and is
  unchanged).
- `check_cg_status.py`: `CHECKABLE_STATUSES` gains `"refused"`. `fetch_cg_review`'s
  tail (`if current_status.strip().lower() == "published": return ("Removed",
  None) / return (None, None)`) is replaced with a call to `resolve_status`,
  and `check_cg_for_tab`'s `if new_status is None: ... continue` (the old
  "not found → no change" branch) is removed since `resolve_status` always
  returns a concrete status now.
- Dead code removed: `AG_DATE_COLS` and `_older_than_one_day()` in
  `check_ag_status.py` — confirmed unused anywhere else in the file once this
  lands.
- Block detection (`page_blocked` → `__skip__`) is unaffected and still takes
  priority — a blocked page never reaches `resolve_status` at all, exactly as
  today.

### Testing

`resolve_status` is a pure function (no Selenium/network), so it gets direct
unit tests in `test_check_review_status.py` covering every combination:
found from each starting status, and not-found from each of `Done`/`Pending`/
`Refused`/`Published`.

## Operational note

The first check run on any tab after this ships will include every entry
currently sitting at `Refused` (previously excluded, now back in scope) —
expect a larger-than-usual batch, and correspondingly longer run time, the
first time each tab is checked post-deploy. Steady-state runs after that are
unaffected in size.
