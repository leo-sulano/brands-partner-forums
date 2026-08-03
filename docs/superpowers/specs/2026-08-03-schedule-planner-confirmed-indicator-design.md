# Schedule Planner: Confirmed-Post Indicator

## Purpose
The removed-post indicator (2026-08-03, Task 165) showed when a scheduled day's post was
later found Removed/Refused. This adds the positive counterpart: a visual mark showing that
a real review was actually added on a brand's platform on that exact calendar day, reusing
the same entry status/date fields — independent of whatever the separately-toggled/
auto-generated `brand_schedule` plan says for that day. This is the mechanism requested to
"connect the calendar to the Brand Tabs data" — the grid now reads and reflects real
add-dates, not just the intended schedule.

## Decisions (confirmed with user)
1. **Additive, not a replacement**: the existing `brand_schedule` plan (manual toggle,
   scheduler auto-generation, pause/resume) is untouched and still the source of the
   click-to-cycle behavior. This indicator is a read-only overlay on top of it, exactly like
   the removed indicator.
2. **A confirmed date creates its own chip.** If a real entry's add-date matches a day that
   has no corresponding `brand_schedule` row at all (nobody ever toggled it), the day still
   shows a chip — the calendar must reflect what really happened, not just what was planned.

## Matching Logic
Same exact-date match as the removed indicator: brand + platform + entry's "added" date
(`PLATFORM_DATE_KEYS`, parsed via `parsePostDate`) must equal the exact calendar day. The
qualifying status is Live/Published (`isLiveStatus`, newly exported from `scoreSummary.ts`),
mutually exclusive with the removed indicator's Removed/Refused (`isRemovedStatus`) — a
status that is neither (e.g. Pending) contributes to neither set.

## Implementation
- `buildRemovedOnDateIndex` (`src/lib/scheduler/scheduleUtils.ts`) is generalized into
  `buildDateStatusIndex`, which scans entries once and returns both
  `{ removed: Set<string>; confirmed: Set<string> }` (same `brandKey::platform::date` key
  shape), rather than scanning entries twice for two near-identical indices.
- `SchedulePlanner.tsx` computes a per-day `confirmedByPlatform` map alongside the existing
  `removedByPlatform`, passed into `ScheduleCell` as a new prop.
- `ScheduleCell`'s render guard changes from "render only if scheduled or scheduler-paused"
  to "render if scheduled, scheduler-paused, **or confirmed**." A confirmed day with no real
  schedule row is styled the same as an 'active' chip (full badge color) and gets a small
  emerald ✓ corner badge (bottom-right — the removed indicator's ✕ stays top-right, so the
  two can never visually collide even though they're already mutually exclusive by
  construction) plus a "— Confirmed" tooltip suffix.
- Click-to-cycle is unchanged: `onToggle` still reads the real `brand_schedule` status
  independently of the confirmed overlay, so clicking a confirmed-only chip creates a real
  `active` row for that day like any other click would.

## Out of Scope
- No change to `brand_schedule`, the scheduler's auto-generation/pause logic, or the
  "+ Add platform" button's addable-platform list (a platform can still show both a
  confirmed chip and a "+" option simultaneously if no real row exists yet for that day —
  accepted as a minor, low-impact UX nuance rather than added complexity).
- No new schema.

## Testing
`buildDateStatusIndex` test suite (`scheduleUtils.test.ts`): Removed status → `removed` only;
Live status → `confirmed` only; a status that is neither → neither set; unparseable/missing
date → no crash, no entry in either set; multiple entries land in the correct set
independently.
