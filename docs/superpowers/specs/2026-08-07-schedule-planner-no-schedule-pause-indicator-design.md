# Schedule Planner: "No Schedule This Week" Pause Indicator

## Purpose
The Paused column (last column) already shows a `⛔ Paused` badge for two sources: a
system-detected/override pause (`brand_platform_pause` table) and, as of the prior task, a
manually-clicked trailing run of 2+ paused days ending on Friday. Neither covers a third real
case: a brand's platform has **nothing at all** scheduled this week — no `'active'` day, no
`'paused'` day, every one of the 5 weekday columns is blank (either the row doesn't exist, or it
exists with all-null days, e.g. because someone clicked every previously-scheduled day all the
way back to blank). Today that renders as a silently empty row with no signal at all, unlike an
explicit pause. This adds a badge for that case too.

## Decisions (confirmed with user)
1. **Current week only.** Applies only when the displayed week is the actual current week
   (`weekStartISO === toISODate(mondayOf(new Date()))`). Future weeks are legitimately blank
   until `ensureWeekGenerated` runs for them once they become current — flagging those would mark
   almost every combo in every future week as "paused," which isn't true, it just hasn't
   happened yet. Past weeks are historical and out of scope.
2. **Per-platform**, matching how the existing two Paused-column sources already work — one
   badge per platform that qualifies, not one flag for the whole brand row.
3. **"No schedule" means entirely blank**, not merely "zero `'active'` days." A row with any
   `'paused'` day is excluded from this trigger (it's already the manual-trailing-pause badge's
   territory, or simply not yet a 2-day trailing run — either way, "some paused days exist" is a
   different signal than "nothing was ever scheduled at all"). Only a row that is missing
   entirely, or exists with all 5 days `null`, qualifies.

## Trigger Logic
For a platform not already covered by the system-pause or manual-trailing-pause sources, and
only when `isCurrentWeek` is true: qualifies if its `brand_schedule` row for this week is either
absent, or present with `monday`/`tuesday`/`wednesday`/`thursday`/`friday` all `null`.

The three sources are mutually exclusive by construction — a system pause always has a real
`brand_platform_pause` row; a manual trailing-pause run requires at least 2 days actually set to
`'paused'`; "no schedule" requires zero non-null days. No platform can satisfy two of these at
once, so there is no new precedence ambiguity beyond what already exists (system beats manual,
established previously) — this task additionally excludes any platform already claimed by
either of the first two before checking "no schedule," as a defensive guard rather than because
overlap is actually possible.

## Badge Appearance
Identical `⛔ Paused` pill (same icon, favicon, text, styling) to the other two sources — no new
visual treatment. Tooltip: `Reason: No schedule this week` — no day list (the whole week is
empty, there's nothing more specific to enumerate) and no resume/expiry line (matching the
manual-trailing-pause badge's precedent: this isn't a tracked, auto-expiring state).

## Implementation
- New pure helper in `src/lib/scheduler/scheduleUtils.ts`: `hasNoScheduleThisWeek(row:
  BrandScheduleRow | undefined): boolean` — `true` if `row` is `undefined`, or every one of its
  5 weekday fields is `null`.
- `PausedPlatformIndicatorProps` (`calendarRenderer.tsx`) grows a third discriminated-union arm:
  `{ platform: Platform; source: 'no-schedule' }` (no extra payload needed — the message is
  generic). `titleFor` gets a third branch returning the fixed string above.
- `SchedulePlanner.tsx` computes `isCurrentWeek` once per render (comparing `weekStartISO`
  against a `currentWeekStartISO` computed once on mount, the same "compute once, don't
  re-derive live clock time per render" pattern `todayISO` already uses). Per brand row, a new
  `noSchedulePlatforms` list is computed from `brandPlatforms(brand)`, excluding platforms
  already in `pausedPlatforms` or `manualPausedPlatforms`, gated on `isCurrentWeek`, and filtered
  through `hasNoScheduleThisWeek(rowsByPlatform[platform])`. Rendered in the same last `<td>`
  alongside the other two lists.

## Out of Scope
- No change to click-to-cycle behavior, `brand_schedule` writes, the scheduler's
  auto-generation/pause logic, or `brand_platform_pause`/`brand_platform_override`.
- No schema change — reads only fields already fetched into `scheduleRows` for the
  currently-displayed week, plus one new client-side "is this the current week" comparison.
- Does not affect legacy (platform-null) weeks in practice — a legacy week is always well in the
  past relative to any real usage of this page, so `isCurrentWeek` is always false for one; no
  explicit legacy-week guard is added since it would be unreachable dead code today.

## Testing
`hasNoScheduleThisWeek` unit tests (`scheduleUtils.test.ts`): all 5 days null → `true`; any single
day non-null (active or paused) → `false`; a fully active week → `false`; a fully paused week
(5/5) → `false` (this row isn't "no schedule," it's the manual-trailing-pause case); an
`undefined` row → `true`.
