# Schedule Planner: Legacy Week Platform Chips

## Purpose
The confirmed/removed indicator (2026-08-03, Task 168/165) already reflects a brand's real
per-platform Added-dates on the calendar — but only for weeks rendered through the current
`ScheduleCell` path. Weeks predating platform-tagged `brand_schedule` rows ("legacy" weeks,
~1,133 rows imported from the old spreadsheet, `platform = null`) bypass `ScheduleCell`
entirely and render a single plain checkmark per brand+day, with no TP/AG/CG/WO breakdown at
all. This closes that gap: every week, oldest to newest, shows real per-platform activity
consistently, the same way current weeks already do.

## Decisions (confirmed with user)
1. **Applies to legacy weeks too**, not just current/recent weeks — the confirmed/removed
   overlay already spans a brand's full entry history (`dateStatusIndex` is built once per
   tab load off *all* fetched entries, not scoped to the displayed week); the only real gap
   is that legacy weeks never render through the code path that consumes it.
2. **Stays a read-only overlay, no new writes.** No backfill of real `brand_schedule` rows
   for historical weeks — legacy weeks are not being turned into editable data, only
   rendered more accurately.
3. **Replaces the plain checkmark**, not layered alongside it. A legacy week's old
   single-checkmark rendering is retired; what displays instead is 0–N platform chips (only
   the platforms `getTabPlatforms(tab)` says that tab tracks), each confirmed (green ✓) or
   removed (red ✕) exactly where a real Added-date lines up with that day, and nothing where
   it doesn't.
4. **Stays fully read-only.** No click-to-cycle, no "+ Add Platform" button, on legacy
   weeks — this is a visual-accuracy fix, not a data-editing feature.
5. **Applies uniformly to all 11 tabs**, gated per-tab by the existing `getTabPlatforms(tab)`
   whitelist — no special-casing.

## Architecture
No new data fetching, matching logic, or schema changes. `SchedulePlanner.tsx` already
fetches every entry for the tab (`fetchRawEntriesByTab`) and builds `dateStatusIndex` (via
`buildDateStatusIndex`) off the full history, so the index already spans a brand's entire
date range regardless of which week is displayed. The actual gap is a rendering fork: legacy
weeks currently render through a separate, platform-blind block instead of `ScheduleCell`.

The fix retires that separate block. Every week — legacy or current — renders through
`ScheduleCell`. For a legacy week, no real per-platform `brand_schedule` data exists, so
`rowsByPlatform` is passed empty; every chip that appears is driven entirely by the existing
`confirmedByPlatform`/`removedByPlatform` overlay, computed exactly as it already is for
current weeks.

## Implementation
- `src/pages/SchedulePlanner.tsx`: delete the legacy-week special-case render block. Every
  day cell — legacy or current — calls `ScheduleCell` with the same props it already
  receives (`confirmedByPlatform`, `removedByPlatform`, `getTabPlatforms(tab)`-gated platform
  list), plus a new `readOnly` flag set true when the week's `brand_schedule` row is
  platform-null or absent for a non-current week. `rowsByPlatform` for these weeks is
  empty/all-null since no real per-platform status exists.
- `src/lib/scheduler/calendarRenderer.tsx` (`ScheduleCell`): add a `readOnly` prop. When
  true, no `onClick`/`onToggle` handler is wired, no hover-revealed "+" button renders, and
  no keyboard-focus affordance for adding a platform is reachable. Chip appearance itself
  (badge, confirmed ✓, removed ✕, tooltip text) is unchanged — only interactivity is
  suppressed.
- `src/lib/scheduler/scheduleUtils.ts`, `scoreSummary.ts`, `schedulerEngine.ts`,
  `schedulerRules.ts`: untouched. The brand/platform/date matching logic already works
  correctly across the full history range; this is a rendering unification only.

## Out of Scope
- No backfill/materialization of real `brand_schedule` rows for historical weeks.
- No change to current (non-legacy) week behavior — confirmed/removed/active/paused chips
  and the `+ Add Platform` modal continue to work exactly as before, since `readOnly` is
  only ever true for legacy weeks.
- No change to the plain-checkmark legacy `brand_schedule` rows themselves (still in the
  DB, just no longer read for display) — they are not deleted or migrated.
- No live/manual Supabase verification required — this is a pure computed-rendering feature
  over already-fetched data.

## Testing
- A legacy week (platform-null `brand_schedule` row, or no row at all) with a brand that has
  a real Live/Published TP entry on one of its weekdays renders a confirmed TP chip on that
  day, and no chip on days with no matching entry.
- Same setup on a TP-only tab (e.g. `TP Brand Injection`) vs. a 3-platform tab (e.g.
  `Rooster Partners`) confirms only tab-applicable platforms ever render.
- `ScheduleCell` in `readOnly` mode renders no "+" button and fires no `onToggle` on
  click/keyboard interaction.
- Regression: non-legacy weeks are unaffected — existing chip/interactivity behavior is
  unchanged.
- A legacy week with zero matching entries anywhere in range renders a fully blank row for
  that brand (no chip at all — the old plain checkmark signal is intentionally dropped, per
  decision 3 above).
