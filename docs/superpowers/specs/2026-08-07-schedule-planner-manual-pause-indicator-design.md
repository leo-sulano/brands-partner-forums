# Schedule Planner: Manual Pause Indicator in the Paused Column

## Purpose
Clicking a platform chip in a day cell already cycles that day's status blank → active →
`paused` → blank, and it already persists (this mechanic is unchanged by this task). The gap:
the last column ("Paused") only renders a badge when a platform is paused via the *system*
path — auto-detected by `recalculatePauses` (success-rate threshold) or a manual
`brand_platform_override` — sourced from the `brand_platform_pause` table. A brand whose team
manually clicked several of this week's remaining days to `paused` (e.g. TP posted Mon/Tue,
then the team decided to stop for the rest of the week) gets no equivalent signal in that
column, unlike a system-paused row, even though individual day cells already show it dimmed.

This adds a second, additive source for that column's badge: a manually-paused trailing run of
days within the currently-displayed week's `brand_schedule` row.

## Decision (confirmed with user)
**Trigger condition:** for a platform not already system-paused, walk the week's
`monday`..`friday` day statuses backward from Friday and count the consecutive `'paused'` days
ending at Friday. If that count is **2 or more**, the platform gets the badge.

- Wed+Thu+Fri paused → triggers, tooltip lists "Wed, Thu, Fri"
- Thu+Fri paused → triggers, tooltip lists "Thu, Fri"
- Only Fri paused (Mon–Thu active/blank) → does **not** trigger (run length 1)
- Mon+Tue paused, Wed–Fri active → does **not** trigger (run doesn't reach Friday)
- Scattered/alternating (e.g. Mon paused, Wed paused, Fri active) → does **not** trigger

A single isolated paused day — anywhere, including a lone Friday — never shows in the last
column. It stays visible only as the existing dimmed chip (`opacity-40`, "Paused (manual)"
tooltip) in that specific day's own cell, unchanged from today.

**Badge appearance:** identical to the existing system-pause badge — same `⛔` icon, platform
favicon, "Paused" text, same slate pill styling. Only the tooltip differs:
- System (unchanged): `Reason: <reason>` + `Resumes week of ...` or `Stays paused until
  manually cleared`
- Manual (new): `Reason: Manually paused (Wed, Thu, Fri)` — lists only the qualifying trailing
  days, no resume/expiry line (a manual per-day pause isn't a tracked, auto-expiring state —
  it's just this week's row; a future week starts fresh with its own independently-clicked or
  freshly-generated days).

**Precedence:** if a platform has both a system pause and a qualifying manual trailing run in
the same week, only the system-pause badge renders (matches the existing single-badge-per-
platform pattern in that column; system pause already dominates the day cells' own styling via
`isPaused`).

## Implementation
- New pure helper in `src/lib/scheduler/scheduleUtils.ts`: `trailingManualPauseDays(row:
  BrandScheduleRow | undefined): Weekday[]` — returns the qualifying trailing run (empty array
  if the row is undefined, has fewer than 2 trailing paused days, or Friday itself isn't
  `'paused'`). Unit-tested directly (`scheduleUtils.test.ts`) rather than only through the page.
- `WEEKDAY_LABELS` (`Mon`/`Tue`/`Wed`/`Thu`/`Fri`), currently a private const in
  `SchedulePlanner.tsx`, moves to `src/lib/scheduleBrands.ts` (next to `WEEKDAYS`/`Weekday`) so
  both `SchedulePlanner.tsx` and `calendarRenderer.tsx` can build the same day-list tooltip text
  from one shared source instead of duplicating the label map.
- `calendarRenderer.tsx`'s `PausedPlatformIndicatorProps` becomes a discriminated union on a new
  `source` field: `{ platform; source: 'system'; pause: BrandPlatformPause }` (today's existing
  behavior, unchanged) or `{ platform; source: 'manual'; days: Weekday[] }` (new). Same JSX
  shell (`⛔` + favicon + "Paused"), tooltip branches on `source`.
- `SchedulePlanner.tsx`'s row render: after computing today's `pausedPlatforms` (system, from
  `pausesByPlatform`), additionally compute `manualPausedPlatforms` — for each platform in
  `brandPlatforms(brand)` not already in `pausedPlatforms`, call `trailingManualPauseDays` on
  `rowsByPlatform[platform]`; include it if the result has length ≥ 2. Render both lists' badges
  together in the last `<td>` (system first, then manual, each keyed by platform — a platform
  only ever appears in one of the two lists per the precedence rule above).

## Out of Scope
- No change to click-to-cycle behavior, `brand_schedule` writes, the scheduler's
  auto-generation/pause logic, or `brand_platform_pause`/`brand_platform_override`.
- No schema change — this reads only fields already fetched into `scheduleRows` for the
  currently-displayed week.
- Does not affect legacy (platform-null) weeks — `brandPlatforms`/`rowsByPlatform` already
  yield no per-platform row there, so `trailingManualPauseDays` naturally returns empty.

## Testing
`trailingManualPauseDays` unit tests (`scheduleUtils.test.ts`): all 5 days paused → full list;
Wed+Thu+Fri paused (Mon/Tue active) → `['wednesday','thursday','friday']`; Thu+Fri paused →
`['thursday','friday']`; only Friday paused → `[]`; Mon+Tue paused only → `[]`; scattered
(Mon+Wed paused, others active) → `[]`; undefined row → `[]`.
