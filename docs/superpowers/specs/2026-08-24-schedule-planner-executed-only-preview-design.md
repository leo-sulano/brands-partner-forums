# Schedule Planner Landing-Grid: Executed-Only Past Days

## Problem

The Schedule Planner's landing-grid preview (the multi-tab card view shown when no tab is
selected) and its platform-count strip (TP/AG/CG/WO totals above the cards) both currently read
purely from the plan (`brand_schedule`'s `active` status via `scheduleFor`/`countActivePlatformSlots`
in `src/lib/scheduler/scheduleUtils.ts`). A past day that was scheduled but never actually posted
looks identical to one that really happened — the count and the chip both just say "active."

The detailed per-tab calendar (`TabScheduleSection.tsx` → `ScheduleCell`) already solved this for
its own cells years' worth of tasks ago: it overlays real evidence (Confirmed/Removed/Pending/Done,
via `buildDateStatusIndex`) on top of the plan, and ghosts a past day's plan-only chip when no
evidence backs it. The landing-grid preview and count strip never got the equivalent treatment —
reported live, since it makes reviewing what a team actually executed vs. what was merely scheduled
look identical for any past date range.

## Design

### 1. Shared evidence check (`src/lib/scheduler/scheduleUtils.ts`)

New pure helper:

```ts
export function hasDateEvidence(index: DateStatusIndex, brandKey: string, platform: Platform, iso: string): boolean
```

Returns true if `brandKey::platform::iso` is present in any of `index.removed` / `index.confirmed` /
`index.pending` / `index.done` — i.e. any of the four "this really happened" statuses (Removed,
Published/Live, Pending, Done). This is the exact same `DateStatusIndex` `TabScheduleSection`
already builds via `buildDateStatusIndex(liveEntries)` for its own Confirmed/Removed/Pending/Done
badges — reusing it means the landing-grid preview can never disagree with the detailed calendar
about what counts as "executed."

### 2. Count strip (`countActivePlatformSlots`)

This function is already the single shared computation behind the platform-count strip in *both*
overview mode (landing-grid, summed across tabs) and specific-tab mode (`TabScheduleSection`'s own
count, reported up via `onPlatformCounts`) — see its existing doc comment. Extending it in one place
keeps both modes consistent by construction, rather than requiring two synchronized edits.

New signature: `countActivePlatformSlots(rows, tab, brands, brandPlatformsFn, columns, dateStatusIndex, todayISO)`.

For each `(brand, platform, column)`:
- `column.iso >= todayISO` (today or future): unchanged — counts if the plan says `active`. The day
  hasn't happened yet, so there's nothing to have executed.
- `column.iso < todayISO` (past): counts if `hasDateEvidence(dateStatusIndex, brandKey, platform,
  column.iso)` is true — **regardless of what the plan says**. A real post on a day the plan didn't
  cover still counts; a planned day with no matching evidence does not.

Both call sites pass their existing `dateStatusIndex` (`TabScheduleSection` already has one at
line ~431; the landing-grid preview gains one per Section 3 below) and `todayISO` (already computed
at the page level as `todayISO` in `SchedulePlanner.tsx`, already a prop into `TabScheduleSection`).

### 3. Landing-grid preview cards (`SchedulePlanner.tsx`)

The preview-building effect (the `useEffect` around line 279) already fetches each tab's raw entries
via `fetchRawEntriesByTab(t)` to derive brands/agents. It gains one more derived field on `TabPreview`:

```ts
dateStatusIndex: DateStatusIndex; // buildDateStatusIndex(rawEntries)
```

No new fetch — this is built from data already in memory.

Per-cell rendering (the `activeToday` computation around line 559) changes from a single boolean
("plan says active") to a three-way resolution per platform, for a given brand/platform/column:

- **`column.iso >= todayISO`**: unchanged. Plan `active` → normal chip; otherwise nothing.
- **`column.iso < todayISO`**:
  - `hasDateEvidence(...)` true → normal chip (same TP/AG/CG/WO style as today — evidence is
    evidence regardless of which of the four statuses it is; this is a compact preview, not the
    detailed calendar, so no further per-status color-coding is added here).
  - No evidence, but the plan for that day was `active` → a **missed** chip: same platform label,
    greyed/outlined style (visually distinct from both the normal chip and a blank cell), with a
    tooltip reading "Planned — no confirmed activity found."
  - No evidence, plan was blank or `paused` → nothing rendered (identical to a day nothing was ever
    scheduled — a paused day not being posted isn't an operational miss).

Brand-key resolution for the `dateStatusIndex` lookup uses `normalizeBrandKey(brand)` (already
imported in this file), matching exactly how `buildDateStatusIndex` itself keys its sets.

### 4. Explicitly not touched

- `TabScheduleSection.tsx`'s own per-cell rendering (`ScheduleCell` / `calendarRenderer.tsx`) —
  its ghosting and Confirmed/Removed/Pending/Done badge overlay stay exactly as shipped. Only the
  *count* it reports up (via the shared `countActivePlatformSlots` change in Section 2) changes.
- CSV/Excel export (`src/lib/scheduler/scheduleExport.ts`) — already a known, documented gap
  (CLAUDE.md Known Issues) that this task doesn't address.
- `resolvePmsSyncStatus` and the PMS sync pipeline — unrelated read of the same `DateStatusIndex`
  type, untouched.

## Testing

- Unit tests for `hasDateEvidence` (`scheduleUtils.test.ts`): each of the four evidence types
  matches, a non-evidence status/blank doesn't, wrong brand/platform/date doesn't match.
- Unit tests for `countActivePlatformSlots`'s new past/future branching: a past day counts only with
  evidence (plan-active-but-no-evidence excluded; evidence-without-a-plan-row included), a
  today/future day still counts on plan alone regardless of evidence.
- Manual/browser check: open Schedule Planner's landing grid for a past week with known real
  activity, confirm the count strip drops to match logged activity rather than the raw plan count,
  and confirm at least one "missed" chip renders where a plan existed with no matching entry.

## Out of scope

- Changing how "missed" is computed or displayed in the detailed per-tab calendar (explicitly
  declined during design — that view keeps its existing ghosting behavior).
- Any change to what counts as "executed" for PMS sync, Score Summary, or any other surface that
  reads `DateStatusIndex`-equivalent evidence today.
