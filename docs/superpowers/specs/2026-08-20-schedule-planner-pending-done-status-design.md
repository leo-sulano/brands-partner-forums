# Schedule Planner: Pending/Done Status Overlay

## Problem

Schedule Planner's day cells already overlay real entry evidence onto the
scheduler's plan for two statuses: a chip gets a green ✓ corner badge when a
real entry's status is Live/Published on that exact calendar date, and a red
✕ badge when it's Removed/Refused on that exact date (`buildDateStatusIndex`,
`src/lib/scheduler/scheduleUtils.ts`, Tasks 165/168). Every other status —
notably Pending and Done, both real values in `EditEntryModal`'s status
dropdown — is silently ignored: `buildDateStatusIndex` explicitly skips
anything that isn't Live/Published or Removed/Refused/Rejected.

Reported gap: after Check Status (or a manual edit) updates an entry's status
to Published, Removed, Pending, or Done, Schedule Planner should automatically
reflect that on the relevant day cell without any manual step. Published and
Removed already work. Pending and Done don't show anywhere on the calendar
today.

## Why Pending/Done can't reuse the existing exact-date matching

`buildDateStatusIndex` matches by comparing a real entry's own date column
(`PLATFORM_DATE_KEYS`, e.g. "Trust Pilot") against the exact calendar day of
the cell. That works for Published/Removed because those statuses are
recorded once something has actually happened on a specific date. Pending has
no such date — it means "not yet decided," so there's nothing to compare
against a specific day. Done's date semantics are likewise not used anywhere
in Schedule Planner today (the one existing "Done" concept, weekly-completion
carryover in `schedulerService.ts`, is a totally separate, currently-disabled
computation).

## Design

### 1. A new current-status index, not a date index

Add `buildCurrentStatusIndex(entries: Entry[])` to `src/lib/scheduler/scheduleUtils.ts`,
returning `{ pending: Set<string>; done: Set<string> }` keyed by
`` `${brandKey}::${platform}` `` (no date component). For each entry, for each
platform, read that platform's status column (`PLATFORM_STATUS_KEYS`) and keep
the most-recently-updated entry's status per (brand, platform) — the same
"most-recently-updated entry wins" resolution rule already used by
`buildAgentIndex`/`buildCountryIndex` in the same file, just applied
per-platform instead of per-brand (a brand's platforms can each have
independently current statuses). The winning status is classified via two new
pure helpers added to `src/lib/scoreSummary.ts`:

```ts
export function isPendingStatus(s: string): boolean {
  return s.includes('pending') || s === 'not published';
}
export function isDoneStatus(s: string): boolean {
  return s === 'done';
}
```

These mirror `src/lib/queries.ts`'s existing `isPendingStatus`/`isDoneStatus`
exactly (kept in sync by hand, matching the file's existing
`isLiveStatus`/`isRemovedStatus` duplication pattern — `scoreSummary.ts` is a
pure module `queries.ts`'s Supabase-coupled code can't be imported from).
`queries.ts`'s own two functions are unchanged; `scheduleUtils.ts` imports the
new copies from `scoreSummary.ts` alongside the ones it already imports from
there.

If a (brand, platform)'s latest-updated entry's status is neither pending nor
done (e.g. it's Live, Removed, On Pause, Not Done, or blank), that key is
simply absent from both sets — no entry is forced into a bucket.

### 2. Attachment rule: current week only, onto an existing plan slot

`TabScheduleSection.tsx` builds `dateStatusIndex` once per tab load
(`useMemo`); it will similarly build `currentStatusIndex` once per tab load,
off the same `tabCtx.entries`.

Per day cell, a new `computeCurrentStatusByPlatform(brand, day, rowsByPlatform)`
helper returns `pendingByPlatform`/`doneByPlatform` maps, gated by two
conditions:

- **Real current week only** (`isCurrentWeek`, the same flag
  `TabScheduleSection.tsx` already computes via `isCurrentWeekStart`). Pending
  and Done describe "what's true right now" — they have no date to anchor
  them to a specific week, so showing them while browsing a past or future
  week would misrepresent today's status as if it were that week's outcome.
  Published/Removed's existing exact-date matching is unaffected by this and
  keeps working on any week, past or future, exactly as today.
- **Only onto a day that already has a plan slot** — `rowsByPlatform[platform]?.[day] != null`
  (i.e. that exact brand+platform+day is already `active` or `paused` in
  `brand_schedule`). This never creates a chip where none exists today; it
  only changes what an *existing* chip says. A platform with a live
  Pending/Done status but nothing scheduled this week shows nothing new,
  same as today.

Where both an exact-date Published/Removed match AND a Pending/Done overlay
would apply to the same cell (only possible if a same-week day happens to
carry an old dated entry's exact date while a separate, newer entry is the
brand+platform's current Pending/Done status — an edge case, not the common
path), the exact-date match wins: it's a stronger, date-verified signal,
while Pending/Done is an approximation with no date attached.

### 3. Visual treatment

Extends `ScheduleCell`/`PlatformChip` (`src/lib/scheduler/calendarRenderer.tsx`)
with two more corner-badge states, alongside the existing green ✓
(Confirmed/Published) and red ✕ (Removed):

| State | Corner badge | Ring | Label |
|---|---|---|---|
| Confirmed (existing) | green ✓ | none | "Published" |
| Removed (existing) | red ✕ | rose | "Removed" |
| Pending (new) | amber "P" | none | "Pending" |
| Done (new) | blue "D" | none | "Done" |

No ring on Pending/Done, matching Confirmed's existing style — only Removed
gets a ring, since it's the one state signaling a problem worth a stronger
visual flag. Colors match `EditEntryModal`'s own status-dot colors for these
two values (`bg-amber-400` for Pending, `bg-blue-500` for Done), so the
vocabulary is consistent with how the same statuses already look in the Edit
Entry modal.

`ScheduleCell`'s existing past-day "ghosting" (an unverified plan-only chip on
an already-elapsed day is invisible until hover/focus/touch — Task 173) is
extended so a Pending/Done overlay also counts as real evidence and exempts
the chip from ghosting, the same way Confirmed/Removed already do — it's real
data from an entry, not just an unconfirmed plan.

Tooltip text needs no separate change — it already renders whatever `label`
resolves to underneath the platform's full name.

### Out of scope (matches existing precedent)

- **CSV/Excel export** (`scheduleExport.ts`) doesn't reflect Confirmed/Removed
  evidence today either (a documented, deliberate gap — see Known Issues in
  `CLAUDE.md`). Pending/Done won't be added there either, for the same
  reason: adding it only for these two statuses while Confirmed/Removed stay
  unexported would be a new, narrower inconsistency, not a fix.
- **Landing-grid mini-calendars** (`SchedulePlanner.tsx`'s per-tab preview
  cards) show only the raw `active` plan status today, with no
  Confirmed/Removed overlay at all. Pending/Done stays off them too, for the
  same consistency reason.
- **`weeklyCompletion`'s existing, currently-disabled `isDoneStatus` usage**
  (`schedulerService.ts`, the carryover feature) is unrelated machinery and is
  not touched by this work.

## Testing

- Unit tests for `buildCurrentStatusIndex` (`scheduleUtils.test.ts`): picks
  the most-recently-updated entry per (brand, platform); classifies
  pending/done correctly; a non-pending/done latest status yields no entry in
  either set; a blank status is skipped in favor of an older non-blank one
  (mirroring `buildAgentIndex`'s existing test coverage shape).
- Unit tests for the new `isPendingStatus`/`isDoneStatus` in
  `scoreSummary.test.ts`, confirming parity with `queries.ts`'s existing
  versions on the same inputs.
- `ScheduleCell`/`calendarRenderer` tests (if/where they exist) or a
  `TabScheduleSection` integration-level test covering: Pending overlay shows
  only on an already-scheduled day in the current week; disappears when
  viewing a past/future week; is superseded by an exact-date Removed/Confirmed
  match when both apply to the same cell.
