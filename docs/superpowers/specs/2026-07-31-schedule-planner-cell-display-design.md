# Schedule Planner: Empty-Day Display, Labeled Chips, Manual Add Modal

## Problem

The Schedule Planner grid (`SchedulePlanner.tsx` + `ScheduleCell` in
`src/lib/scheduler/calendarRenderer.tsx`) currently renders a chip for every
active platform in every day cell, always — even when that platform has no
schedule for that day (e.g. TrustPilot only runs Mon+Thu or Tue+Fri, so every
other weekday shows a faint dashed placeholder chip today). Each chip shows
only the platform favicon, with no text label. This makes the grid visually
noisy (every cell is "full" regardless of what's actually scheduled) and
makes it hard to tell platforms apart at a glance without hovering for the
tooltip.

We want: unscheduled platform+day combos to render nothing, existing chips to
show both icon and short label (TP/AG/CG/WO), and a way to manually add a
platform to a specific day via a small modal, since there's no longer a
placeholder chip to click for that purpose.

## Non-goals

- No backend/schema changes. `brand_schedule` writes are unchanged.
- No change to the existing direct-click cycle behavior on already-scheduled
  chips (active → paused → cleared).
- No change to legacy (platform-null) weeks or future-week read-only
  behavior — both keep their current gating untouched.
- No change to scheduler-paused (whole-week) platform handling beyond
  carrying the new label+icon chip style — those still render read-only,
  dimmed, in every day cell, exactly as today.

## Design

### 1. `ScheduleCell` — hide unset chips, add label to existing chips

In `src/lib/scheduler/calendarRenderer.tsx`, `ScheduleCell` currently maps
over every entry in `platforms` unconditionally. It changes to only render a
chip for a platform when:

- it is scheduler-paused for the week (`pausesByPlatform[platform]` is set), or
- that day's status is `'active'` or `'paused'` (i.e. `row?.[day] != null`).

A platform with no row for that day, and no scheduler-level pause, renders no
chip at all — not even a placeholder.

Each rendered chip's content changes from icon-only to icon + short label,
e.g. a small favicon next to the text "TP", "AG", "CG", or "WO", using the
platform's existing color-coded background from `PLATFORM_BADGE` (no new
colors). The three visual states (solid = active, dimmed = manually paused,
extra-dimmed read-only = scheduler-paused) and the existing `title` tooltip
are unchanged.

### 2. `ScheduleCell` — hover-only "+" add affordance

`ScheduleCell` additionally computes `addablePlatforms` = the subset of
`platforms` with no chip rendered this day (i.e. not scheduler-paused, and
`row?.[day] == null`). When `addablePlatforms.length > 0` and the cell is
editable (`isApproved` prop, already gated by the caller for
future/legacy weeks), it renders a small "+" element that is invisible by
default and fades in on hover of that specific cell (a per-cell Tailwind
group, e.g. `group/cell` on the cell's wrapping `div`, `opacity-0
group-hover/cell:opacity-100` on the "+"). Clicking it calls a new
`onAddPlatform: () => void` prop — no arguments, since the parent already
knows which brand/day this cell is for via closure.

### 3. `AddPlatformModal` (new component)

New file `src/components/AddPlatformModal.tsx`, styled after the existing
`BrandTabsModal.tsx` pattern (centered card, backdrop click to close, X
button, a `document`-level `keydown` Escape listener — not a
focus-dependent one, avoiding the known bug in `EditEntryModal`/
`AddReviewAccountModal`/`TotalBreakdownModal` noted in project memory).

Props:

```ts
interface Props {
  brand: string;
  dayLabel: string; // e.g. "Monday, Jul 27"
  platforms: Platform[]; // already filtered to "addable" by the caller
  onSetStatus: (platform: Platform, status: 'active' | 'paused') => void;
  onClose: () => void;
}
```

Body: one row per platform in `platforms`, showing its favicon and full name
(`PLATFORM_FULL_LABEL`, moved from `calendarRenderer.tsx` into
`scheduleUtils.ts` so both files can import it without a new circular
dependency) plus two buttons, "Active" and "Paused". Clicking either calls
`onSetStatus` immediately — no intermediate confirm step, matching the
existing chip-click's immediate-save behavior.

The modal does not keep its own copy of `platforms` — its list comes from
the parent's live `addablePlatforms` computation (re-derived each render from
current schedule state), so a platform disappears from the modal the instant
it's added, without the modal needing to manage that state itself. If
`platforms` is empty (everything for that day has been added), the modal
shows a plain message: "All platforms already scheduled for this day." The
modal stays open regardless — the user closes it explicitly.

### 4. `SchedulePlanner.tsx` wiring

- New state: `const [addPlatformTarget, setAddPlatformTarget] = useState<{ brand: string; day: Weekday } | null>(null)`.
- The existing inline per-brand computation of `rowsByPlatform` /
  `pausesByPlatform` (currently inside the `filteredBrands.map(...)` body)
  is extracted into a small helper, `computeCellData(brand: string)`,
  returning `{ rowsByPlatform, pausesByPlatform }`. The table row-map calls
  it once per brand as before; when `addPlatformTarget` is set, the same
  helper is called again for `addPlatformTarget.brand` to derive that one
  brand's data for the modal, and `addablePlatforms` for the modal is
  filtered from it exactly as `ScheduleCell` filters its own (not scheduler-
  paused, and `row?.[addPlatformTarget.day] == null`).
- New handler `handleSetDayStatus(brand, platform, day, status: 'active' |
  'paused')`, mirroring `handleCellClick` exactly (optimistic
  `withDayStatus` update, `setBrandScheduleDay` call, rollback + error toast
  on failure) but taking the target status as a parameter instead of
  deriving it from `nextStatus(currentStatus)`.
- `ScheduleCell`'s new `onAddPlatform` prop is wired to
  `() => setAddPlatformTarget({ brand, day })`, passed only where the cell
  is already editable (same `isApproved && !isFutureWeek` condition as
  `onToggle` today) — for legacy weeks, `ScheduleCell` isn't rendered at all
  today and that's unchanged.
- `AddPlatformModal` renders conditionally when `addPlatformTarget != null`,
  passing the brand, a formatted day label (reusing the existing
  `formatWeekdayDate`/`WEEKDAY_LABELS` helpers already in this file), the
  live `addablePlatforms` list, `onSetStatus={(platform, status) =>
  handleSetDayStatus(addPlatformTarget.brand, platform, addPlatformTarget.day, status)}`,
  and `onClose={() => setAddPlatformTarget(null)}`.

## Error handling

Unchanged from today's pattern: a failed `setBrandScheduleDay` call rolls
back the optimistic UI update and shows the existing error `Toast`. The
modal itself does not need its own error state — errors surface via the same
toast used elsewhere on the page, visible whether or not the modal is still
open.

## Testing

- `scheduleBrands.test.ts` / `scheduleUtils.test.ts` are unaffected (no
  changes to their exported functions' behavior).
- Manual/browser verification (per project convention for this page): open
  Schedule Planner, confirm a day with no scheduled platforms shows no chips
  and a hover-visible "+", click it, confirm the modal lists only unscheduled
  platforms for that day with icon + full name, click Active on one, confirm
  it disappears from the modal and a labeled chip appears in the cell, and
  that clicking that chip afterward still cycles active → paused → cleared
  as before. Also verify: future-week and legacy-week cells show no "+".
