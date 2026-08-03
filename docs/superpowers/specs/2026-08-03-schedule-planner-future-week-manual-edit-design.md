# Schedule Planner: Manual Editing in Future Weeks

## Purpose
Future weeks in the Schedule Planner are currently fully read-only in the UI — no
click-to-cycle, no "+ Add Platform" — so a brand's schedule can only be set once
auto-generation runs for that week (which only happens once it becomes the current week).
This lets users manually pre-fill a future week's schedule ahead of time, for any week the
grid can already navigate to (no added horizon limit).

## Decisions (confirmed with user)
1. **Auto-generation still fills in everything else.** When a future week with manual edits
   becomes the current week, auto-generation runs as normal for every brand+platform combo
   that has no existing row yet, and skips only the combo(s) the user already touched.
   Manual edits act as a pre-fill, not a full override of the week.
2. **No horizon limit.** Editing is allowed on any future week reachable via
   Prev/Next/Today — same navigation that already exists.
3. **Full interaction parity with the current week.** Future weeks get the same
   click-to-cycle (blank → active → paused → blank) and "+ Add Platform" modal as the
   current week. The only remaining difference is that auto-generation/pause-recalculation
   never runs against a future week — that stays gated to the actual current week, exactly
   as today.

## The bug this surfaces (and fixes)
`ensureWeekGenerated` and `recalculatePauses` (`src/lib/scheduler/schedulerService.ts`) both
guard against re-running for an already-generated week by asking, week-wide: "does *any*
platform-tagged `brand_schedule` row already exist for this (tab, weekStart)?" That guard
is safe today only because the sole way such a row can exist before generation runs is
generation itself — future weeks are locked in the UI specifically so a stray manual row
can never trigger this false-positive (documented at `SchedulePlanner.tsx:330-337`).

Once future weeks become editable, that assumption breaks: a single manual edit to one
brand+platform would make the week-wide guard true and silently block generation (and
pause-detection) for every *other* brand and platform that week, once it goes live.

**Fix:** change both guards from week-level to per-combo (brand+platform):
- `ensureWeekGenerated`: compute the set of `(brandKey, platform)` combos that already have
  a row for that week and pass them into `generateWeekSchedule` as `pinnedBrandPlatforms` —
  an existing `SchedulerInput` field (`schedulerEngine.ts`), currently always passed `[]`.
  Pinned combos are skipped entirely by the generator, so a manually-set row is never
  touched by `bulkUpsertBrandSchedule`. Every other combo generates normally.
- `recalculatePauses`: replace the week-wide `weekAlreadyGenerated` short-circuit (line 107,
  gating line 129) with the same per-combo check, so a manual row for Brand A no longer
  blocks pause-detection for Brand B on the week Brand A was touched.

**Granularity note (accepted, not a bug):** protection is per `(brand, platform, week)`,
not per exact day — the data model is one `brand_schedule` row per combo per week.
`setBrandScheduleDay` upserts a row for that combo on the very first click and never
deletes it (even cycling a day back to blank leaves the row in place with that day column
null), so "a row already exists for this combo" is a reliable, persistent signal that it
was manually touched. If a user sets only Monday for Brand X on TrustPilot, the *whole* TP
row for Brand X that week is skipped by auto-generation — it will not also fill in X's
normal Thursday slot. This is a direct consequence of the existing one-row-per-combo model,
not something worth restructuring for.

## UI changes (`SchedulePlanner.tsx`)
- Remove the `isFutureWeek` early-return in `handleSetDayStatus` (line 313).
- Remove `!isFutureWeek` from the `isApproved` prop passed to `ScheduleCell` (line 501) —
  only `isLegacyWeek` continues to force it read-only.
- `isFutureWeek` and its defining comment become fully unused after the above — delete both.
- `isCurrentWeek` (in the schedule-loading effect) is untouched: `recalculatePauses` /
  `ensureWeekGenerated` still only run for the actual current week. Editing a future week
  never triggers a write based on today's status data — it just won't be blocked by its own
  earlier manual edits once that week becomes current.

## Out of Scope
- No schema change — `brand_schedule` and `brand_platform_pause` are unchanged.
- No new UI affordance distinguishing "this future week has manual pre-fills" from a normal
  future week (e.g. no banner or badge) — out of scope unless requested later.
- Completion-based carryover stays disabled (`CARRYOVER_RULES.completionThreshold = 0`,
  per the existing 2026-07-31 decision) — unaffected either way by this change.

## Testing
- `schedulerService.test.ts`: new cases asserting combo-level (not week-level) skipping in
  both `ensureWeekGenerated` and `recalculatePauses` — an existing row for Brand A/Platform P
  must not prevent generation or pause-detection for Brand B/Platform Q in the same week.
- `SchedulePlanner` test coverage: existing "future week is read-only" assertions get
  updated to assert click-to-cycle and "+ Add Platform" work identically to the current
  week, while confirming no scheduler call fires for a future week.
