# Manual brand+platform pauses editable from the Schedule Planner's Schedule Status column

**Date:** 2026-09-04
**Status:** Approved (design), pending spec review

## Problem

Tasks 320/321 removed all manual-pause management from the Schedule Planner. Today a
manual pause (`brand_platform_override` with `state === 'pause'`) is *hidden* from the
Schedule Planner grid entirely:

- `overridePausedComboKeys` (every materialized `brand_platform_pause` row whose
  `brand_platform_override` is `state === 'pause'`) is subtracted from
  `activeBrandPlatforms()` in `src/components/TabScheduleSection.tsx`.
- That feeds `visibleBrandPlatforms` (day-cell chips), `platformCounts` (the "TP 24"
  strip), and `filteredBrands` (drop a brand when `activeBrandPlatforms(b).length === 0`).
- Net effect: a manually-paused platform draws no chip in any day cell and no icon in
  the Schedule Status column, and an all-manually-paused brand is dropped from the grid.

Only *auto-detected* underperformance pauses (a `brand_platform_pause` row with **no**
override) stay visible — as the `source="system"` `⛔ Paused` indicator in the Schedule
Status column, tooltip carrying the underperformance reason.

Manual pauses are currently created/edited only from **Edit Brand Tab → "Paused brands"**
(`src/components/TabPausedBrandsSection.tsx`), which opens `PlatformPauseModal` (reason +
optional resume date). The Schedule Status column's icons currently all open
`PauseDaysModal` — a *different* tool that toggles which weekdays of the current week a
platform is paused, not a durable platform pause.

The user wants manual pauses visible again on the Schedule Planner and editable directly
from the Schedule Status column, with both surfaces staying in sync.

## Decisions (from brainstorming)

1. **Grid visibility:** a manually-paused platform gets the *full* auto-pause treatment —
   dimmed "paused" chips in the day cells **and** the `⛔ Paused` pill in the Schedule
   Status column. A brand whose every platform is manually paused keeps its row (today
   it's dropped). **Correction (final-review pass, 2026-09-04):** this is only fully true
   once the affected week is (re)generated with the pause already in place — i.e. from the
   *next* Monday onward. On a week that was already generated before the pause was set,
   the day-cell chips stay full-opacity/"active" (the override pause does not retroactively
   clear existing `brand_schedule` day rows — `calendarRenderer.tsx`'s
   `effectivePaused = isPaused && status == null`), while the `⛔ Paused` pill + "Manually
   paused" tooltip in the Schedule Status column DO appear immediately (within ~1s, per
   Risk "Immediacy of a fresh pause" below). Grid-vs-PMS window: PMS moves the affected
   card(s) to Project Paused immediately on the same save, so for the remainder of an
   already-generated week the grid's day chips can look active while PMS already shows
   Project Paused — this self-corrects at the next Monday regeneration and is accepted,
   not a bug.
2. **Status-column click on a manual pause:** opens the reason + resume-date editor
   (`PlatformPauseModal`), the same one Edit Brand Tab uses — edit reason, change/clear
   the resume date, or resume (unpause).
3. **Create from the grid:** yes — you can create a brand-new durable pause on a
   currently-active platform from the Schedule Planner (parity with Edit Brand Tab).
4. **Per-weekday pause tool (`PauseDaysModal`):** route by state.
   - manual/override pause → `PlatformPauseModal` (decision 2).
   - **active** platform → keep `PauseDaysModal`, plus a new "Pause this platform (with
     reason)…" button inside it that switches to `PlatformPauseModal`.
   - auto-detected pause / cancelled / no-schedule → `PauseDaysModal`, unchanged.
5. **Auto-detected pause click:** unchanged — keeps opening `PauseDaysModal`. Only
   manual (override) pauses get the reason/resume editor on click.
6. **Visual distinction:** tooltip wording only. Same `⛔ Paused` pill, same color, for
   both manual and auto. The tooltip forks:
   - auto-detected → `Auto-paused` · `Reason: <reason>` · `Resumes week of <date>`
   - override, permanent → `Manually paused` · `Reason: <reason>` · `Stays paused until
     manually cleared`
   - override, dated → `Manually paused` · `Reason: <reason>` · `Resumes <date>`

## Design

### A. Remove the override-pause exclusion — `src/components/TabScheduleSection.tsx`

- Delete the `overridePausedComboKeys` memo (lines ~709–719) and the
  `activeBrandPlatforms()` function (lines ~721–733).
- Repoint the three consumers back at `brandPlatforms()`:
  - `visibleBrandPlatforms(brand)` → `filterVisiblePlatforms(brandPlatforms(brand), visiblePlatforms)`
  - `platformCounts` → `countActivePlatformSlots(scheduleRows, tab, filteredBrands, brandPlatforms, columns, dateStatusIndex, todayISO)` and drop `overridePausedComboKeys` from its dep array.
  - `filteredBrands` → drop-when-`brandPlatforms(b).length === 0`; drop `overridePausedComboKeys` from its dep array.
- No other reference to `activeBrandPlatforms`/`overridePausedComboKeys` remains (grep to
  confirm). `brandPlatforms()` already excludes flagged-removed / hidden / restricted via
  `resolveBrandPlatforms` — that behavior is unchanged.

**Result:** once `recalculatePauses` has materialized the override into a
`brand_platform_pause` row (it runs on every Schedule Planner tab visit, and again after
every write per section E), `computeCellData` populates `pausesByPlatform` /
`pausedByPlatform` / `resumeAtByPlatform` for that combo exactly as it does for an
auto-pause, and the existing render path draws the dimmed chips + `source="system"` pill
with no further change.

### B. Tooltip wording — `src/lib/scheduler/calendarRenderer.tsx` `titleFor`

The `source: 'system'` branch already forks on `pauseResumeAt`
(`undefined` = auto-detected, `null` = override/permanent, ISO date = override/periodic).
Only the returned strings change:

```
undefined → `Auto-paused\nReason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}`
null      → `Manually paused\nReason: ${pause.reason}\nStays paused until manually cleared`
<date>    → `Manually paused\nReason: ${pause.reason}\nResumes ${resumeAtLabel(pauseResumeAt)}`
```

`ScheduleStatusIcon` renders `line1` / `line2` from a `\n` split; the first line now
carries the "Auto-paused" / "Manually paused" label and the reason moves to line 2, so
`titleFor` returns three `\n`-joined lines for this branch. Update `ScheduleStatusIcon`
to render all lines it receives (map over `split('\n')`) rather than assuming exactly
two, so the extra line isn't dropped. `pausedBy` ("Paused by: …") and `agent` lines are
unaffected. Other `source` branches (`manual` / `cancelled` / `no-schedule` / `active`)
are untouched.

### C. Status-column click routing — `src/components/TabScheduleSection.tsx` (render, ~1435–1468)

New modal-target state alongside `pauseDaysTarget`:

```ts
const [platformPauseTarget, setPlatformPauseTarget] = useState<{ brand: string } | null>(null);
```

At the per-platform icon render, compute whether this combo is override-driven:

```ts
const isOverridePaused =
  !!weekPausesByPlatform[platform] &&
  tabCtx?.overrideMap.get(overrideKey(tab, brandKey, platform))?.state === 'pause';
```

- `isOverridePaused` → `onClick = () => setPlatformPauseTarget({ brand })`
  (`PlatformPauseModal` is brand-scoped — lists every eligible platform with the
  currently-override-paused ones checked, matching Edit Brand Tab). Icon variant stays
  `source="system"` with `pause` / `pausedBy` / `pauseResumeAt` as today.
- everything else (`weekPausesByPlatform` set but no override / `cancelled` / `manual` /
  `no-schedule` / `active`) → `onClick = () => setPauseDaysTarget({ brand, platform })`,
  unchanged.

`clickable` gating (`canEditWeek(weekStartISO) && !isLegacyWeekAt(weekStartISO)`) is
unchanged and applies to both targets.

### D. "Pause this platform (with reason)…" button — `src/components/PauseDaysModal.tsx`

Add an optional prop:

```ts
onRequestPlatformPause?: () => void;
```

When set, render a button in the modal footer (or below the day checkboxes) labelled
**"Pause this platform (with reason)…"**. Its handler closes `PauseDaysModal` and calls
`onRequestPlatformPause`. `TabScheduleSection` passes it only when the target platform is
currently **active** (no `weekPausesByPlatform[platform]`, not cancelled, not
manually-per-day-paused) — i.e. the case where creating a durable pause is the meaningful
next step — wiring it to `setPlatformPauseTarget({ brand })` (and clearing
`pauseDaysTarget`). Omit the prop (button hidden) for auto-detected-pause and
no-schedule targets.

### E. Shared save/resume path — new `src/lib/platformPauseActions.ts`

`TabPausedBrandsSection.handleSavePause` / `handleResume` are lifted verbatim (minus
React state) into two exported async functions:

```ts
export async function savePlatformPause(params: {
  tab: string;
  brand: string;
  eligiblePlatforms: Platform[];       // resolveBrandPlatforms(...) for this brand
  checkedPlatforms: Platform[];         // from PlatformPauseModal onSave
  reason: string;
  resumeAt: string | null;
  overrideMap: Map<string, OverrideDetails>;
}): Promise<void>;

export async function resumePlatformPause(tab: string, brandKey: string, platform: Platform): Promise<void>;
```

- `savePlatformPause` iterates `eligiblePlatforms`: for a newly/again-checked platform
  whose `(reason, resumeAt)` differs from the existing override, call
  `setBrandPlatformOverride(tab, brand, platform, 'pause', { reason, resumeAt })`; for a
  platform unchecked that was paused, `clearBrandPlatformOverride(...)` **and**
  `deleteBrandPlatformPause(...)` (a resume clears the materialized weekly cache row so
  it's immediate — same rule as `TabPausedBrandsSection`, and the reason the Edit Brand
  Tab section already deviates from the plan's "never write `brand_platform_pause`" line).
- `resumePlatformPause` = `clearBrandPlatformOverride` + `deleteBrandPlatformPause`.

Both `TabPausedBrandsSection` and `TabScheduleSection` call these. Error handling (the
`try/catch` → visible error line) stays in each component; only the write sequence is
shared. This is required by CLAUDE.md's cross-dashboard-consistency rule — a second copy
is exactly the divergence class that rule exists to prevent.

### F. Refresh after a Schedule-Planner write — `src/components/TabScheduleSection.tsx`

Re-introduce a `refreshPauseState()` helper (Task 321 deleted the prior one):

- run `recalculatePauses(tab, ...)` scoped to the **current week only**
  (`isCurrentWeekStart(weekStartISO)` guard — the Task 311 Critical: an unguarded
  recalc on a navigated non-current week can sweep/rewrite every other brand's pause row
  on the tab),
- refetch `pauses` and `overrideRows` (the two states that drive
  `weekPausesByPlatform` / `overrideMap`).

Called after `handleSavePlatformPause` (the `PlatformPauseModal` `onSave` wrapper) and
after any resume. `PlatformPauseModal`'s own `busy` state is driven by a local
`platformPauseBusy` flag.

### G. `PlatformPauseModal` wiring in `TabScheduleSection`

Mirror `TabPausedBrandsSection`'s render block:

- `platforms={brandPlatforms(platformPauseTarget.brand)}`
- `initialCheckedPlatforms` = those with `overrideMap … state === 'pause'`
- `initialReason` / `initialResumeAt` from the first override-paused platform (same
  `pauseModalInitial` shape; extract that helper too if convenient, else duplicate the
  ~10 lines — it's pure and already spec-sanctioned as "seed from first platform")
- `autoPauseReasonByPlatform` = `{}` (or the real auto-pause reasons for unchecked
  auto-paused platforms, so the "currently auto-paused" note shows — nice-to-have,
  low priority)
- `minResumeAt={toISODate(addDays(mondayOf(new Date()), 7))}` (identical to
  `TabPausedBrandsSection`)
- `overlayZClass` — default `z-40` is fine here (no parent modal, unlike Edit Brand Tab)
- `onSave` → `handleSavePlatformPause` → `savePlatformPause(...)` then `refreshPauseState()`
  then `setPlatformPauseTarget(null)`
- `onClose` → `setPlatformPauseTarget(null)`

Re-add imports removed by Task 320/321: `PlatformPauseModal`, `setBrandPlatformOverride`,
`clearBrandPlatformOverride`, `deleteBrandPlatformPause`, `mondayOf`/`addDays`/`toISODate`
(check which are already imported).

### H. Unaffected / explicitly out of scope

- **PMS "Project Paused" sync** — reads `brandPlatforms()` + `brand_platform_pause`
  already; a manual pause already materializes and syncs. No change.
- **CSV/Excel export** (`src/lib/scheduler/scheduleExport.ts`) — already iterates
  `brandPlatforms()` and marks `Paused This Week = Y`. No change. (Confirm it does not
  reference `activeBrandPlatforms`.)
- **Ask AI** — `get_paused_combos` reads `brand_platform_pause` (`supabase/functions/
  ai-assistant/tools.ts` ~line 1474), not `brand_platform_override` directly; `get_schedule`
  filters via `resolveBrandPlatforms` and does not subtract override pauses. Either way,
  neither tool ever subtracted override pauses from what it returns, so the conclusion is
  unchanged: no `tools.ts` change, no redeploy.
- **Auto-pause detection / expiry** (`recalculatePauses`, `schedulerRules.ts`) — untouched.
- **`EditBrandTabModal` / `TabPausedBrandsSection` behavior** — unchanged except the
  internal refactor to call the shared `platformPauseActions.ts` helpers.
- **Migration / edge-function deploy** — none. Frontend only: `git push origin main`.

## Testing

- **TDD** the shared `savePlatformPause` / `resumePlatformPause` (mock the `queries.ts`
  writers): new-pause path, edit-existing (reason/date change), uncheck→resume also
  deletes the cache row, no-op when unchanged.
- **Unit** `titleFor` (`calendarRenderer` test, if present) — the three `source:'system'`
  wordings; `ScheduleStatusIcon` renders 3 body lines.
- **Build** clean; full suite green.
- **Live Playwright pass** on a real multi-platform tab: from the Schedule Status column,
  pause an active platform (with reason) → its day-cell chips dim, tooltip reads
  "Manually paused…" → edit the reason → resume → confirm the same change is reflected in
  Edit Brand Tab → "Paused brands", and a pause/resume done from Edit Brand Tab shows up
  on the Schedule Planner after a refresh.

## Risks

- **The `activeBrandPlatforms` removal is the cross-surface-sensitive edit.** Three
  consumers (`visibleBrandPlatforms`, `platformCounts`, `filteredBrands`) must all move
  together; a miss leaves the strip count disagreeing with the grid. Covered by the
  build + live pass.
- **Immediacy of a fresh pause.** A brand-new override pause is only *fully* drawn (dimmed
  chips) once `brand_platform_pause` is materialized; `refreshPauseState()` runs
  `recalculatePauses` right after the write so this happens within the same interaction.
  Until that returns, the row shows active — acceptable, self-corrects in ~1s.
