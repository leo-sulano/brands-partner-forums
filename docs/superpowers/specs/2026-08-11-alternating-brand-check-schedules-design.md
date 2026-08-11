# Design: Divide Brands into Alternating Schedules

**Date:** 2026-08-11

## Problem

The automatic review-status checker currently processes **every brand, on every platform, in
one run** — no grouping, no load-spreading. As of [Task 201](../../task-history.md)
(2026-08-10/11), this is a single weekly cron (`~/run_weekly_all_platforms.sh`, Mondays 01:00
UTC) that sequentially runs TP → AG → CG → WO across all ~60-90 brands with no `--tab`/brand
restriction at all. The task asks for this to be split into alternating groups so each run only
processes a subset, distributing load across runs instead of hitting everything at once.

## Current state (confirmed by reading the code, not assumed)

- **The one live automatic trigger** is the EC2 crontab entry `0 1 * * 1
  /home/ec2-user/run_weekly_all_platforms.sh`, which runs TP (`check_review_status.py
  --headless`) → AG (`check_ag_status.py --no-headless`) → CG (`check_cg_status.py
  --no-headless`) → WO (`check_wo_status.py`) sequentially (never concurrently — concurrent
  Chrome instances have crashed this box before, Task 128). No brand/tab scoping is applied by
  the script.
  - An earlier, since-decommissioned path — a Supabase `pg_cron` job calling the
    `supabase/functions/check-review-status` Edge Function every 3 days — was removed
    2026-07-09 and is **not** part of this design. That Edge Function still exists in the repo
    but is dead code relative to the live path; out of scope here.
- **All four checker scripts share one scope-filter function**: `matches_scope_filters(data,
  brands=..., agent=..., proxy=..., country=...)`, defined once in `check_review_status.py`
  and imported by `check_ag_status.py`/`check_cg_status.py`/`check_wo_status.py`. Each script's
  main loop calls it once per candidate row before deciding whether to check that entry. This
  is the single hook point — fixing it here reaches all four platforms without duplicating
  logic four times.
- **The manual "Check Status" button** (dashboard → `proxy-check-status` Edge Function → EC2's
  `status_server.py`, a Flask app) calls the *same* `load_entries()` /
  `check_ag_for_tab()`/`check_cg_for_tab()`/`check_wo_for_tab()` functions in-process, already
  passing through an optional `brands` list sourced from the dashboard's own Brand filter
  (`BrandGroup.tsx`). It ends up at the same `matches_scope_filters()` call.
- `load_entries()`'s row shape is `{id, tab, sheet_row_id, data}` — `tab` is available
  alongside `data` at every call site, even though `matches_scope_filters()` today only
  receives `data`.
- No existing grouping/batching-by-brand concept exists anywhere in this pipeline. `BATCH_SIZE`
  constants that exist (e.g. `check-review-status/index.ts`'s dead-code `BATCH_SIZE = 3`) are
  Selenium/concurrency throttles within a single run, not a scheduling mechanism.
- Brand identity elsewhere in this codebase (`removed_platform_brands`, `brand_schedule`) is
  normalized as `(tab, lower+trim(brand))` — this design reuses that same convention rather
  than inventing a new one.

## Decisions

**Target system:** the EC2 automatic checker pipeline (`check_review_status.py` +
`check_ag_status.py` + `check_cg_status.py` + `check_wo_status.py`, invoked by both the weekly
cron and the manual dashboard button) — not the Schedule Planner (a different feature, posting
cadence, already has its own unrelated scheduling engine) and not the decommissioned Supabase
Edge Function.

**Group count:** 3 fixed groups (Group 0/1/2), hardcoded. With the cron now weekly (post-Task
201), this means a full rotation — every brand checked at least once — takes 3 weeks. Confirmed
with the user as an accepted trade-off on top of Task 201's daily→weekly change for TP; not
revisited further in this design.

**Assignment mechanism — stateless, deterministic, no new table:**
- Each `(tab, brand)` pair (normalized the same way as `removed_platform_brands`: lowercase +
  trim) maps to a group via `int(hashlib.sha256(key.encode()).hexdigest(), 16) % 3`.
  - Must use `hashlib`, **not** Python's built-in `hash()` — `hash()` on strings is
    randomized per-process (`PYTHONHASHSEED`) unless explicitly disabled, which would silently
    reassign every brand's group on every single script invocation. This is the one sharp edge
    in this design and must be called out explicitly in the implementation.
- No persisted brand→group table. A brand added tomorrow is automatically assigned a group
  the instant it's queried — satisfies "should continue automatically without requiring manual
  assignment each time."

**Active-group-this-run — also stateless:**
- Computed purely from the current date (e.g. ISO week number, anchored to a fixed epoch,
  mod 3). No stored cursor/counter.
- Self-healing: if a run fails, is skipped, or the cron misses a week, the next run just
  computes whichever group the date formula says — no drift, no manual recovery step, no
  "catch-up" logic needed.

**Enforcement scope:** applies to **both** the weekly cron and the manual "Check Status"
button, with **no override/escape hatch** — a brand outside the current run's active group is
skipped unconditionally, regardless of trigger source. This matches the task's literal
requirement ("a brand should only be processed according to its assigned schedule") and was
confirmed with the user over a proposed "ignore schedule" override, which was rejected in favor
of strict enforcement.

**Single source of truth:** all group-assignment and active-group logic lives in one new
Python module (e.g. `scripts/schedule_groups.py`), imported only by `check_review_status.py`
(which the other three scripts already import shared helpers from). No JavaScript/dashboard-side
reimplementation of the hash or date logic — this project has previously shipped real bugs from
independently-written logic silently diverging (Tasks 173/174/180, documented in
`CLAUDE.md`'s standing cross-dashboard-consistency rule), and computing this once, server-side,
in the one place that already gatekeeps every checker run avoids repeating that mistake here.

**Manual-button skip visibility:** `status_server.py`'s JSON response gains a skip count (e.g.
`skipped_not_in_group`). The dashboard's existing Check Status result toast gains one extra
line surfacing it, e.g. "Checked 14 — 31 skipped (not scheduled this week)." No per-row badges,
no new UI surface beyond the existing toast — confirmed with the user as sufficient.

**Data safety:** grouping only decides which rows a run *visits*. A brand outside the active
group is never queried this run — its stored status/data is left exactly as-is. No schema
change to `entries`; no change to any displayed KPI, Score Summary, Overview, or Brand Tabs
computation — this only changes *when* a re-check happens, not what's shown once it has.

## Explicitly out of scope

- Any change to the Schedule Planner (`src/lib/scheduler/`) — unrelated feature, not touched.
- Any change to the decommissioned `supabase/functions/check-review-status` Edge Function.
- A UI surface for viewing/overriding a specific brand's assigned group — rejected in favor of
  strict, override-free enforcement (see Decisions above).
- Revisiting the 3-week full-rotation cadence — accepted as-is; a follow-up could reconsider if
  real staleness turns out to be a problem in practice, but that's a future decision, not this
  one.

## Testing approach

The two pure functions this design introduces — group-of-a-brand (hash mod 3) and
active-group-this-week (date mod 3) — are ordinary Python functions with no I/O, so they're
directly unit-testable without touching Selenium, Supabase, or the EC2 box. Implementation
should follow whatever test convention `scripts/` already uses (check for an existing
`scripts/tests/` or `pytest` setup before introducing a new one) and add:
- Determinism: same `(tab, brand)` always yields the same group across repeated calls/processes
  (guards against the `hash()`-randomization pitfall above).
- Rotation: consecutive weeks cycle through all 3 groups in order and wrap correctly.
- A rough distribution check across the real brand roster (not a hard balance assertion, just
  a sanity check that no single group ends up wildly larger than the others).

Live verification (actually running a checker script against real Supabase data with the group
filter active) requires EC2 SSH access — note in the implementation plan whether that's
available in the implementing session, and if not, flag it as a pending manual verification
step the same way several recent EC2-touching tasks have (e.g. Task 178's cron deploy).
