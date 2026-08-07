# Schedule Planner — Updated Per-Platform Posting Rules & Manual Override

**PMS task:** "Update and Enhance Schedule Planner Logic as a Daily Task Manager" (`cmsg95m8i000a04la6krrqhse`, Backlog)

**Scope note:** this is a logic-only change. No new views, no redesign of the weekly
calendar grid. The only UI touches are the minimal controls required for the new
data this introduces — a checkbox and a pause/resume control — in the same places
equivalent existing flags already live.

## Current behavior (for reference)

- `PLATFORM_RULES` (`src/lib/scheduler/schedulerRules.ts`) sets one global posting
  frequency per platform, applied identically on every tab that has that platform:
  `tp: 2/wk (Mon+Thu or Tue+Fri)`, `ag: 2/wk`, `cg: 1/wk`, `wo: 3/wk (Mon/Wed/Fri)`.
- `recalculatePauses` (`src/lib/scheduler/schedulerService.ts`) auto-pauses a
  brand+platform for one week when either:
  1. its two most recent posts are both Removed/Refused, or
  2. its **all-time** success rate is below 40%, with at least 5 decided posts.
- A pause auto-expires after its `paused_week_start` is in the past — no manual
  control exists today.
- `removed_platform_brands` — an existing, unrelated flag: marks a brand's page on
  one platform as permanently delisted, excluding it from scheduling entirely.
  Not touched by this change.
- Runs from two places: the page-visit effect in `SchedulePlanner.tsx`, and the
  `generate-weekly-schedule` Edge Function (Monday cron). Both call the same
  `recalculatePauses`/`ensureWeekGenerated` functions, so any logic change here
  applies to both automatically.

## New rules

### 1. Frequency change

`PLATFORM_RULES.wo`: `postsPerWeek` 3 → 1, `preferredDays` removed (load-balanced
across the week the same way `cg` already is at 1/wk — no fixed preferred day).
`ag` (2/wk) and `cg` (1/wk) are unchanged; they already match the stated rules.
`tp`'s cadence (2/wk, day-paired) is unchanged — only its pause conditions change
(below).

### 2. Pause conditions — unified, all platforms

Applies uniformly to every platform on every tab (TP/AG/CG/WO alike) — this
generalizes what today only runs for TP conceptually, and matches the "general
per-platform" decision made for the flag toggle below. A brand+platform
auto-pauses for the week if **any** of the following hold, re-evaluated every
week exactly as today's check already is:

1. Its two most recent posts are both Removed/Refused (**unchanged** — still
   exactly 2 consecutive).
2. Its success rate over the **current calendar month to date** (not all-time) is
   below 40%, with at least 5 decided posts in that window. Reuses
   `resolvePreset('this-month')` (`scoreSummary.ts`, already exists) as the
   `DateRange` passed into `computeSuccessRates`.
3. **New:** it has an active row in `flagged_platform_brands` (below).

Pause duration stays 1 week, auto-expiring exactly as today, *except* when a
manual override is in effect (below) — a manual override is checked first and
skips this auto-detection entirely for that combo.

### 3. New: "flagged via email" flag

There's no automated email parsing in this system, so this is a manual toggle —
same shape and UX as the existing "`<platform>` page removed" checkbox.

- New table `flagged_platform_brands`, identical shape to `removed_platform_brands`
  (`tab`, `brand`, generated `brand_key`, `platform`, `flagged_by`, `flagged_at`,
  same 4 RLS policies). One row = "ops received an email saying this brand+platform
  was flagged."
- New checkbox per active platform in the Edit Entry modal, next to the existing
  "`<platform>` page removed" checkbox, e.g. "TP flagged via email" — general
  per-platform (TP/AG/CG/WO), even though only TP has a stated rule today.
- Checking it is one of the three OR-conditions in rule #2 above. Unchecking it
  removes that condition on the next weekly re-evaluation (it does not force an
  immediate resume mid-week — same "re-evaluated weekly" cadence as the other two
  triggers).

### 4. New: manual override (pause / force-active)

Ops needs to override auto-detection in both directions: force-pause something
auto-detection hasn't caught, or force-continue something auto-detection would
otherwise pause (e.g. a client explicitly wants a review pushed despite a low
score). This sits above rule #2 and wins whenever it's set.

- New table `brand_platform_override`: `tab`, `brand`, generated `brand_key`,
  `platform`, `override_state` (`'pause' | 'active'`), `set_by`, `created_at`.
  Same 4 RLS policies as the other flag tables. A row's mere existence is the
  override; no row means "auto" (today's behavior).
- Effective state per combo, each week:
  ```
  override row with state 'pause'  → paused, unconditionally, no auto-expiry
  override row with state 'active' → active, unconditionally, auto-detection skipped
  no override row                  → today's behavior: auto-detection (rule #2) decides
  ```
- `recalculatePauses` checks `brand_platform_override` for a combo **before**
  running the existing consecutive-removed/success-rate/flagged checks. `'pause'`
  ensures a `brand_platform_pause` row exists for the current week (reason:
  "Manually paused") without evaluating anything else. `'active'` skips pause
  evaluation entirely and deletes any existing auto-pause row for that combo if
  one is present (an override always wins over a pause that was already in
  effect).
- Overrides persist until someone clears them (deletes the row) — they do not
  auto-expire after a week, unlike an auto-detected pause.
- Removed-platform-flagged combos (`removed_platform_brands`) are still checked
  first and skip all of this, same as today — a delisted page has nothing to
  pause, resume, or override.
- UI: a small pause/resume control on the Schedule Planner grid, scoped to one
  brand+platform combo — not a new page or view, just the minimal control needed
  to set/clear the override row. Exact placement (e.g. on the existing
  hover-revealed platform-chip affordance) is an implementation detail, not a
  redesign.

## Out of scope

- No new "daily task list" / checklist view — confirmed with the user, logic
  changes only.
- No automated email detection — the flag stays a manual toggle.
- No change to `removed_platform_brands` semantics.
- No change to carryover (`CARRYOVER_RULES.completionThreshold` stays disabled —
  unrelated to this task).
- No change to how legacy (pre-platform) weeks render.

## Data model summary

Two new tables, both modeled directly on `removed_platform_brands` /
`brand_platform_pause`'s existing shape (generated `brand_key`, same 4 RLS
policies: anyone can read, approved users can insert/update/delete):

- `flagged_platform_brands (tab, brand, brand_key, platform, flagged_by, flagged_at)`
- `brand_platform_override (tab, brand, brand_key, platform, override_state, set_by, created_at)`

## Code touch points

- `src/lib/scheduler/schedulerRules.ts` — WO frequency change; update `PAUSE_RULES`
  doc comments (the existing comment block explicitly warns not to change the
  windowing without a product conversation — this spec is that conversation).
- `src/lib/scoreSummary.ts` — no change needed; `computeSuccessRates` already
  accepts a `DateRange`, and `resolvePreset('this-month')` already exists.
- `src/lib/scheduler/schedulerService.ts` — `recalculatePauses` restructured to
  check overrides before the existing three-condition auto-detection; monthly
  `DateRange` passed into the existing `computeSuccessRates` call.
- `src/lib/queries.ts` — new `fetchFlaggedPlatformBrands`/`setBrandPlatformFlagged`
  (mirroring `fetchRemovedPlatformBrands`/`setBrandPlatformRemoved`) and
  `fetchBrandPlatformOverrides`/`setBrandPlatformOverride`/`clearBrandPlatformOverride`
  (mirroring the existing pause query functions).
- `src/pages/BrandGroup.tsx` — new per-platform "flagged via email" checkboxes in
  the Edit Entry modal, alongside the existing "page removed" checkboxes.
- `src/pages/SchedulePlanner.tsx` / `src/lib/scheduler/calendarRenderer.tsx` — new
  minimal pause/resume control per platform chip.
- New migration: both tables + RLS policies.
- `supabase/functions/generate-weekly-schedule/` — no code change expected; it
  already calls the shared `recalculatePauses`/`ensureWeekGenerated`, so the cron
  path picks up all of the above automatically. Worth a regression check in that
  function's existing test suite.

## Testing approach

Follows this codebase's existing pattern (TDD, per-unit test files):

- `schedulerRules.test.ts` (or equivalent) — WO frequency assertion.
- `schedulerService.test.ts` — extend existing pause tests: monthly-window
  success rate (a brand with a bad all-time rate but a good current-month rate
  should *not* pause, and vice versa), flagged-via-email triggering a pause,
  override `'pause'` forcing a pause despite good stats, override `'active'`
  clearing/preventing an auto-pause despite bad stats, and override precedence
  over `removed_platform_brands` (removed still wins — no scheduling either way).
- `queries.test.ts` (or wherever the existing flag/pause query tests live) — new
  fetch/set/clear functions for both new tables.
- Existing `generate-weekly-schedule` tests — rerun to confirm no regression;
  extend only if the shared logic change surfaces a gap that file's tests don't
  already cover.

## Assumptions carried over from clarification

- The unified pause-condition rule (#2) applies to AG/CG/WO as well as TP, not
  just TP — the user's rules text only described TP's conditions explicitly, but
  confirmed answers (general per-platform flagging; override framed generically
  as "even it has low score or flagged," not TP-specific) point to one uniform
  rule rather than a TP-only special case. Flagged as an assumption here since it
  wasn't asked as its own explicit question.
- "Monthly" success-rate window = calendar month to date (confirmed), computed
  from the wall-clock time of whichever process runs the check (browser or the
  Monday-cron Edge Function) — same accepted timezone tradeoff already documented
  for the cron's Monday-morning trigger time, not a new one introduced here.
