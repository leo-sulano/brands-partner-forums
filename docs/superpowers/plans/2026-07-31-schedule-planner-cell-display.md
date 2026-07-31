# Schedule Planner Cell Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide unscheduled-platform placeholders in the Schedule Planner grid, label existing chips with both icon and short code, and let users manually add a platform to a specific day via a small modal.

**Architecture:** Pure filtering/label logic goes in `src/lib/scheduler/scheduleUtils.ts` (unit-testable). `ScheduleCell` (presentational) consumes it to decide what renders and exposes a hover-only "+" affordance. A new `AddPlatformModal` component (styled after the existing `BrandTabsModal` pattern) lists only the platforms missing from that day and writes through the same `setBrandScheduleDay` path `SchedulePlanner.tsx` already uses for its existing click-to-cycle handler.

**Tech Stack:** Vite · React 19 · TypeScript · Tailwind v4 · Vitest (node environment — no DOM/component test runner in this project; JSX changes are verified via `npm run build` for type-correctness plus manual browser verification, matching this project's established pattern for UI-only changes).

## Global Constraints

- No backend/schema changes — every write still goes through the existing `setBrandScheduleDay(tab, brand, weekStart, platform, day, status)` in `src/lib/queries.ts`.
- No change to legacy (platform-null) week rendering or future-week read-only gating.
- No change to the existing direct-click cycle behavior on already-scheduled chips.
- `tsc --noEmit` does not meaningfully check this repo (root tsconfig is references-only) — always verify with `npm run build`.
- This project has no component/JSX test runner (`vitest.config.ts` uses `environment: 'node'`, no `@testing-library/react`/jsdom installed) — do not attempt to add one for this plan. Pure-logic additions get real unit tests; JSX changes are verified by `npm run build` + a manual browser walkthrough.

---

### Task 1: Shared platform-label and unscheduled-platform-filter logic

**Files:**
- Modify: `src/lib/scheduler/scheduleUtils.ts`
- Test: `src/lib/scheduler/scheduleUtils.test.ts`

**Interfaces:**
- Consumes: existing `Weekday`, `BrandScheduleRow` from `../scheduleBrands`; `Platform` from `../removedPlatformBrands`.
- Produces: `PLATFORM_FULL_LABEL: Record<Platform, string>` and `unscheduledPlatforms(platforms: Platform[], day: Weekday, rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>, pausedPlatforms: Partial<Record<Platform, unknown>>): Platform[]`, both exported from `src/lib/scheduler/scheduleUtils.ts` — later tasks import both from this exact path.

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `src/lib/scheduler/scheduleUtils.test.ts`:

```ts
import { PLATFORM_FULL_LABEL, unscheduledPlatforms } from './scheduleUtils';

describe('PLATFORM_FULL_LABEL', () => {
  it('has a full display name for all four platforms', () => {
    expect(PLATFORM_FULL_LABEL).toEqual({
      tp: 'Trustpilot',
      ag: 'AskGamblers',
      cg: 'CasinoGuru',
      wo: 'Wizard of Odds',
    });
  });
});

describe('unscheduledPlatforms', () => {
  const rowWith = (platform: 'tp' | 'ag', days: Partial<Record<'monday' | 'tuesday', 'active' | 'paused'>>): BrandScheduleRow => ({
    tab: 'BITP', brand_key: 'x', week_start: '2026-07-27', platform,
    monday: days.monday ?? null, tuesday: days.tuesday ?? null, wednesday: null, thursday: null, friday: null,
  });

  it('excludes a platform with a non-null status for that day', () => {
    const rowsByPlatform = { tp: rowWith('tp', { monday: 'active' }) };
    expect(unscheduledPlatforms(['tp', 'ag'], 'monday', rowsByPlatform, {})).toEqual(['ag']);
  });

  it('includes a platform whose row exists but that day is null', () => {
    const rowsByPlatform = { tp: rowWith('tp', { monday: 'active' }) };
    expect(unscheduledPlatforms(['tp'], 'tuesday', rowsByPlatform, {})).toEqual(['tp']);
  });

  it('includes a platform with no row at all for that brand/week', () => {
    expect(unscheduledPlatforms(['tp', 'ag'], 'monday', {}, {})).toEqual(['tp', 'ag']);
  });

  it('excludes a platform that is scheduler-paused for the week regardless of day status', () => {
    expect(unscheduledPlatforms(['tp'], 'monday', {}, { tp: { reason: 'x' } })).toEqual([]);
  });
});
```

Add this import alongside the existing ones at the top of the file (the existing `import type { BrandScheduleRow } from '../scheduleBrands';` stays; `rowWith` above needs no new import):

```ts
import { describe, it, expect } from 'vitest';
import { leastLoadedDay, weeklyCompletion, completedBrandPlatformKey, PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms } from './scheduleUtils';
import type { BrandScheduleRow } from '../scheduleBrands';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- scheduleUtils` (or `npx vitest run src/lib/scheduler/scheduleUtils.test.ts`)
Expected: FAIL — `PLATFORM_FULL_LABEL`/`unscheduledPlatforms` are not exported yet.

- [ ] **Step 3: Implement `PLATFORM_FULL_LABEL` and `unscheduledPlatforms`**

Add to `src/lib/scheduler/scheduleUtils.ts`, after the existing `PLATFORM_BADGE` export (leave `PLATFORM_BADGE`, `leastLoadedDay`, `completedBrandPlatformKey`, `weeklyCompletion` exactly as they are):

```ts
// Full display name for tooltips and the Add Platform modal — the short
// TP/AG/CG/WO code lives in PLATFORM_BADGE above, this is the human-readable
// version shown alongside it.
export const PLATFORM_FULL_LABEL: Record<Platform, string> = {
  tp: 'Trustpilot',
  ag: 'AskGamblers',
  cg: 'CasinoGuru',
  wo: 'Wizard of Odds',
};

// A platform counts as "scheduled" for a given day if it's scheduler-paused
// for the whole week (pausedPlatforms[platform] truthy — a paused combo has
// zero day rows by design, so it would otherwise look unscheduled every day)
// or that day's status is non-null. Shared by ScheduleCell (to decide which
// chips to render/which platforms are addable) and SchedulePlanner (to
// compute the Add Platform modal's live addable list) so the two can never
// disagree about what counts as "already there."
export function unscheduledPlatforms(
  platforms: Platform[],
  day: Weekday,
  rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>,
  pausedPlatforms: Partial<Record<Platform, unknown>>,
): Platform[] {
  return platforms.filter((p) => !pausedPlatforms[p] && rowsByPlatform[p]?.[day] == null);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/scheduleUtils.test.ts`
Expected: PASS, all tests including the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/scheduleUtils.ts src/lib/scheduler/scheduleUtils.test.ts
git commit -m "feat: add PLATFORM_FULL_LABEL and unscheduledPlatforms to scheduleUtils"
```

---

### Task 2: Update `ScheduleCell` — hide unset chips, label+icon, hover "+" affordance

**Files:**
- Modify: `src/lib/scheduler/calendarRenderer.tsx`

**Interfaces:**
- Consumes: `PLATFORM_FULL_LABEL`, `unscheduledPlatforms` from `./scheduleUtils` (Task 1).
- Produces: `ScheduleCellProps` gains `onAddPlatform: () => void` (required prop) — `SchedulePlanner.tsx` (Task 4) must pass it at the `<ScheduleCell>` call site.

- [ ] **Step 1: Replace the top of the file (imports, local `PLATFORM_FULL_LABEL`, `ScheduleCellProps`) and the entire `ScheduleCell` function**

Replace lines 1–103 of `src/lib/scheduler/calendarRenderer.tsx` (everything from the top of the file through the closing `}` of `ScheduleCell`, i.e. up to but not including `interface PausedPlatformIndicatorProps`) with:

```tsx
import type { Weekday, BrandScheduleRow, DayStatus } from '../scheduleBrands';
import { PLATFORM_FAVICON, type Platform } from '../removedPlatformBrands';
import type { BrandPlatformPause } from '../queries';
import { PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms } from './scheduleUtils';

function statusLabel(status: DayStatus): string {
  if (status === 'active') return 'Scheduled';
  if (status === 'paused') return 'Paused (manual)';
  return 'Not scheduled';
}

interface ScheduleCellProps {
  brand: string;
  day: Weekday;
  platforms: Platform[];
  rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>;
  pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>>;
  isApproved: boolean;
  onToggle: (platform: Platform) => void;
  onAddPlatform: () => void;
}

// Each day cell renders a chip only for platforms actually scheduled that
// day (status !== null) or scheduler-paused for the week
// (pausesByPlatform[platform] truthy) — an unset platform+day renders
// nothing, not even a placeholder. Earlier versions of this component
// rendered every active platform in every cell unconditionally, including a
// dashed "unset" placeholder chip, so every cell always had a click target
// to create the first row for a brand/week the scheduler hadn't touched
// yet. That's superseded here: the per-cell "+" button (visible on hover,
// rendered whenever unscheduledPlatforms(...) is non-empty) is the click
// target for an otherwise-empty cell now, opening AddPlatformModal (wired
// in SchedulePlanner.tsx) instead of relying on a placeholder chip.
// Existing scheduled chips keep their original single-click-to-cycle
// behavior via onToggle, unchanged.
export function ScheduleCell({ brand, day, platforms, rowsByPlatform, pausesByPlatform, isApproved, onToggle, onAddPlatform }: ScheduleCellProps) {
  const addable = unscheduledPlatforms(platforms, day, rowsByPlatform, pausesByPlatform);
  return (
    <div className="group/cell flex flex-wrap items-center gap-1" role="group" aria-label={`${brand} schedule for ${day}`}>
      {platforms.map((platform) => {
        const isPaused = !!pausesByPlatform[platform];
        const row = rowsByPlatform[platform];
        const status: DayStatus = row?.[day] ?? null;
        if (!isPaused && status == null) return null;
        const badge = PLATFORM_BADGE[platform];
        const stateClassName = isPaused
          ? `${badge.className} opacity-30`
          : status === 'active'
            ? badge.className
            : `${badge.className} opacity-40`;
        const clickable = isApproved && !isPaused;
        return (
          <span
            key={platform}
            onClick={clickable ? () => onToggle(platform) : undefined}
            title={`${PLATFORM_FULL_LABEL[platform]}: ${isPaused ? 'Paused (scheduler)' : statusLabel(status)}`}
            className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium ${stateClassName} ${clickable ? 'cursor-pointer' : ''}`}
          >
            <img
              src={PLATFORM_FAVICON[platform]}
              alt={badge.label}
              className="size-3 rounded-sm"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            {badge.label}
          </span>
        );
      })}
      {isApproved && addable.length > 0 && (
        <button
          type="button"
          onClick={onAddPlatform}
          title="Add a platform for this day"
          aria-label={`Add a platform for ${brand} on ${day}`}
          className="inline-flex size-4 items-center justify-center rounded border border-dashed border-slate-300 text-slate-400 opacity-0 transition-opacity group-hover/cell:opacity-100 hover:border-slate-400 hover:text-slate-600"
        >
          +
        </button>
      )}
    </div>
  );
}
```

Leave the rest of the file (`PausedPlatformIndicatorProps`, `PausedPlatformIndicator`, `resumeWeekLabel`, `SuccessRateBadgeProps`, `SuccessRateBadge`) exactly as-is.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: Fails at this point — `SchedulePlanner.tsx`'s `<ScheduleCell>` call site doesn't pass the new required `onAddPlatform` prop yet. Confirm the error is specifically about the missing `onAddPlatform` prop on `ScheduleCell` (proves the new prop is correctly required) — this will be resolved in Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scheduler/calendarRenderer.tsx
git commit -m "feat: hide unscheduled platform chips, add icon+label, add hover + affordance to ScheduleCell"
```

(Committing here is safe even with the build red — Task 4 fixes the call site next; this keeps each task's diff isolated and reviewable on its own, per this plan's task boundaries.)

---

### Task 3: `AddPlatformModal` component

**Files:**
- Create: `src/components/AddPlatformModal.tsx`

**Interfaces:**
- Consumes: `Platform`, `PLATFORM_FAVICON` from `../lib/removedPlatformBrands`; `PLATFORM_FULL_LABEL` from `../lib/scheduler/scheduleUtils` (Task 1).
- Produces: default export `AddPlatformModal` from `src/components/AddPlatformModal.tsx`, props `{ brand: string; dayLabel: string; platforms: Platform[]; onSetStatus: (platform: Platform, status: 'active' | 'paused') => void; onClose: () => void }` — `SchedulePlanner.tsx` (Task 4) imports and renders it with these exact prop names.

- [ ] **Step 1: Create the component**

Create `src/components/AddPlatformModal.tsx`:

```tsx
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';

interface Props {
  brand: string;
  dayLabel: string;
  platforms: Platform[];
  onSetStatus: (platform: Platform, status: 'active' | 'paused') => void;
  onClose: () => void;
}

export default function AddPlatformModal({ brand, dayLabel, platforms, onSetStatus, onClose }: Props) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Add platform</h2>
            <p className="text-xs text-slate-400 mt-0.5">{brand} — {dayLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-4 pb-4 space-y-1.5">
          {platforms.length === 0 ? (
            <p className="px-1 pb-2 text-sm text-slate-400">All platforms already scheduled for this day.</p>
          ) : (
            platforms.map((platform) => (
              <div
                key={platform}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <img
                    src={PLATFORM_FAVICON[platform]}
                    alt={platform}
                    className="size-3.5 rounded-sm"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  {PLATFORM_FULL_LABEL[platform]}
                </span>
                <span className="flex items-center gap-1.5 shrink-0 ml-2">
                  <button
                    type="button"
                    onClick={() => onSetStatus(platform, 'active')}
                    className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetStatus(platform, 'paused')}
                    className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
                  >
                    Paused
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: Still fails on the same pre-existing `ScheduleCell` `onAddPlatform` error from Task 2 (this new file itself introduces no errors — it isn't imported anywhere yet). Confirm no NEW errors reference `AddPlatformModal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/AddPlatformModal.tsx
git commit -m "feat: add AddPlatformModal component"
```

---

### Task 4: Wire `SchedulePlanner.tsx`

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx`

**Interfaces:**
- Consumes: `unscheduledPlatforms` from `../lib/scheduler/scheduleUtils` (Task 1); `ScheduleCell`'s new `onAddPlatform` prop (Task 2); `AddPlatformModal` (Task 3).
- Produces: nothing new consumed by later tasks — this is the final integration point.

- [ ] **Step 1: Add the new imports**

In `src/pages/SchedulePlanner.tsx`, change line 17 from:

```ts
import { ScheduleCell, PausedPlatformIndicator, SuccessRateBadge } from '../lib/scheduler/calendarRenderer';
```

to:

```ts
import { ScheduleCell, PausedPlatformIndicator, SuccessRateBadge } from '../lib/scheduler/calendarRenderer';
import { unscheduledPlatforms } from '../lib/scheduler/scheduleUtils';
import AddPlatformModal from '../components/AddPlatformModal';
```

- [ ] **Step 2: Add `addPlatformTarget` state**

Immediately after the existing `const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);` line (line 101), add:

```ts
const [addPlatformTarget, setAddPlatformTarget] = useState<{ brand: string; day: Weekday } | null>(null);
```

- [ ] **Step 3: Extract `computeCellData` and add `handleSetDayStatus`**

Immediately before the existing `async function handleCellClick(...)` (currently line 270), insert:

```ts
function computeCellData(brand: string): {
  rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>;
  pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>>;
} {
  const brandKey = normalizeBrandKey(brand);
  const rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>> = {};
  const pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>> = {};
  for (const platform of tabCtx?.activePlatforms ?? []) {
    const r = scheduleFor(scheduleRows, tab, brand, weekStartISO, platform);
    if (r) rowsByPlatform[platform] = r;
    const p = pauses.find(
      (x) => x.brand_key === brandKey && x.platform === platform && x.paused_week_start === weekStartISO,
    );
    if (p) pausesByPlatform[platform] = p;
  }
  return { rowsByPlatform, pausesByPlatform };
}

```

Then, immediately after the existing `handleCellClick` function's closing `}` (currently ending at line 282), insert:

```ts

async function handleSetDayStatus(brand: string, platform: Platform, day: Weekday, status: 'active' | 'paused') {
  if (!isApproved) return;
  const currentStatus: DayStatus = scheduleFor(scheduleRows, tab, brand, weekStartISO, platform)?.[day] ?? null;

  setScheduleRows((prev) => withDayStatus(prev, tab, brand, weekStartISO, platform, day, status));
  try {
    await setBrandScheduleDay(tab, brand, weekStartISO, platform, day, status);
  } catch (err) {
    setScheduleRows((prev) => withDayStatus(prev, tab, brand, weekStartISO, platform, day, currentStatus));
    setToast({ message: err instanceof Error ? err.message : 'Failed to save', kind: 'error' });
  }
}
```

`BrandScheduleRow` needs to be an imported type here — change line 14 from:

```ts
import { WEEKDAYS, scheduleFor, nextStatus, withDayStatus, toISODate, type BrandScheduleRow, type DayStatus, type Weekday } from '../lib/scheduleBrands';
```

Check first: this import already includes `type BrandScheduleRow` and `type DayStatus` — no change needed to this line. `BrandPlatformPause` is already imported (line 12, from `../lib/queries`). No import changes needed beyond Step 1.

- [ ] **Step 4: Replace the inline per-brand computation in the render map with `computeCellData`**

Find this block inside the `filteredBrands.map((brand) => { ... })` body (currently lines 407–432):

```ts
                  const legacyRow = isLegacyWeek ? scheduleFor(scheduleRows, tab, brand, weekStartISO) : undefined;
                  const brandKey = normalizeBrandKey(brand);
                  const rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>> = {};
                  const pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>> = {};
                  for (const platform of activePlatforms) {
                    const r = scheduleFor(scheduleRows, tab, brand, weekStartISO, platform);
                    if (r) rowsByPlatform[platform] = r;
                    // Matched by brandKey computed from `brand` directly, not
                    // from `r?.brand_key` — a paused platform has ZERO
                    // schedule rows this week by design (the engine skips
                    // assigning any days to a paused combo), so `r` would be
                    // undefined for exactly the case this needs to detect.
                    // Also scoped to the currently viewed week via
                    // paused_week_start: a pause row only governs the week it
                    // was created for (matching schedulerService.ts's own
                    // `paused_week_start === weekStart` check) — without this,
                    // a pause created for one week would make that platform's
                    // chip non-interactive on every other week, including
                    // legacy history and future weeks it has nothing to do
                    // with.
                    const p = pauses.find(
                      (x) => x.brand_key === brandKey && x.platform === platform && x.paused_week_start === weekStartISO,
                    );
                    if (p) pausesByPlatform[platform] = p;
                  }
                  const pausedPlatforms = activePlatforms.filter((p) => pausesByPlatform[p]);
```

Replace it with:

```ts
                  const legacyRow = isLegacyWeek ? scheduleFor(scheduleRows, tab, brand, weekStartISO) : undefined;
                  const { rowsByPlatform, pausesByPlatform } = computeCellData(brand);
                  const pausedPlatforms = activePlatforms.filter((p) => pausesByPlatform[p]);
```

(The detailed rationale comment moves to `computeCellData`'s call sites collectively via this plan/spec rather than being repeated per call site — the underlying matching logic is unchanged, just extracted.)

- [ ] **Step 5: Pass `onAddPlatform` to `ScheduleCell` and compute the modal's live data**

Find the `<ScheduleCell>` call (currently lines 456–475):

```tsx
                            <ScheduleCell
                              brand={brand}
                              day={day}
                              platforms={activePlatforms}
                              rowsByPlatform={rowsByPlatform}
                              pausesByPlatform={pausesByPlatform}
                              isApproved={isApproved && !isFutureWeek}
                              onToggle={(platform) => handleCellClick(brand, platform, day)}
                            />
```

Add `onAddPlatform`:

```tsx
                            <ScheduleCell
                              brand={brand}
                              day={day}
                              platforms={activePlatforms}
                              rowsByPlatform={rowsByPlatform}
                              pausesByPlatform={pausesByPlatform}
                              isApproved={isApproved && !isFutureWeek}
                              onToggle={(platform) => handleCellClick(brand, platform, day)}
                              onAddPlatform={() => setAddPlatformTarget({ brand, day })}
                            />
```

Then, find `const activePlatforms = tabCtx?.activePlatforms ?? [];` (currently line 301) and add the modal's derived data right after it:

```ts
  const activePlatforms = tabCtx?.activePlatforms ?? [];

  const addPlatformModalData = addPlatformTarget
    ? (() => {
        const { rowsByPlatform, pausesByPlatform } = computeCellData(addPlatformTarget.brand);
        const dayIndex = WEEKDAYS.indexOf(addPlatformTarget.day);
        return {
          platforms: unscheduledPlatforms(activePlatforms, addPlatformTarget.day, rowsByPlatform, pausesByPlatform),
          dayLabel: `${WEEKDAY_LABELS[addPlatformTarget.day]} ${formatWeekdayDate(weekStart, dayIndex)}`,
        };
      })()
    : null;
```

- [ ] **Step 6: Render the modal**

Find the final line of the component's JSX, `{toast && <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />}` (currently line 497), and add the modal render right after it:

```tsx
      {toast && <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />}
      {addPlatformTarget && addPlatformModalData && (
        <AddPlatformModal
          brand={addPlatformTarget.brand}
          dayLabel={addPlatformModalData.dayLabel}
          platforms={addPlatformModalData.platforms}
          onSetStatus={(platform, status) => handleSetDayStatus(addPlatformTarget.brand, platform, addPlatformTarget.day, status)}
          onClose={() => setAddPlatformTarget(null)}
        />
      )}
```

- [ ] **Step 7: Type-check and run the full test suite**

Run: `npm run build`
Expected: PASS — the `onAddPlatform` prop error from Task 2 is now resolved, no new errors.

Run: `npm run test`
Expected: PASS — full suite, including the new `scheduleUtils.test.ts` cases from Task 1.

- [ ] **Step 8: Manual browser verification**

Start the dev server (`npm run dev`) and, signed in as an approved user, on `/schedule-planner`:

1. Select a brand tab and confirm a day with no scheduled platforms for a given brand shows no chips.
2. Hover that empty cell — confirm a small "+" fades in.
3. Click it — confirm `AddPlatformModal` opens, titled with the correct brand and day, listing only platforms not yet scheduled that day (each with favicon + full name + Active/Paused buttons).
4. Click "Active" on one platform — confirm it disappears from the modal's list and a labeled chip (icon + short code, e.g. "TP") appears in the grid cell immediately.
5. Click that new chip directly — confirm it still cycles active → paused → cleared exactly as before.
6. Navigate to a future week — confirm no "+" appears anywhere (read-only, as before).
7. If the tab has any legacy (platform-null) weeks, confirm those are unaffected (still the old ✓/Pause rendering, no "+").
8. Reload the page and confirm the newly-added platform's status persisted.

- [ ] **Step 9: Commit**

```bash
git add src/pages/SchedulePlanner.tsx
git commit -m "feat: wire Add Platform modal into Schedule Planner grid"
```
