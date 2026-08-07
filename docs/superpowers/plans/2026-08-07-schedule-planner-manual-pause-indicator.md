# Schedule Planner: Manual Pause Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Schedule Planner's last "Paused" column also show a `⛔ Paused` badge when a
platform has been manually clicked to `paused` for a trailing run of 2+ days ending on Friday,
matching the existing badge already shown for system-detected (auto or override) pauses.

**Architecture:** Purely additive, read-only derivation from data already fetched into
`SchedulePlanner.tsx`'s state (`scheduleRows`) — no new table, query, or write path. A new pure
helper (`trailingManualPauseDays`) computes the qualifying day run from an already-loaded
`BrandScheduleRow`; `PausedPlatformIndicator` (`calendarRenderer.tsx`) becomes a discriminated
union so the same visual badge can be driven by either a system pause row or a manual day run;
`SchedulePlanner.tsx` computes both lists per brand row and renders them together in the last
column.

**Tech Stack:** Vite + React 19 + TypeScript (strict), Tailwind v4, Vitest for unit tests.

## Global Constraints
- TypeScript strict mode. No `any` unless commented why (spec has no `any` usage).
- No schema/DB changes — this reads only fields already present in `BrandScheduleRow`
  (`monday`..`friday` day-status columns), already fetched for the currently-displayed week.
- Click-to-cycle behavior (`handleCellClick`/`handleSetDayStatus` in `SchedulePlanner.tsx`) is
  unchanged — do not touch it.
- Trigger rule (exact, from the design spec): walking backward from Friday, count consecutive
  `'paused'` days. Badge shows only if that count is **2 or more**. A lone paused Friday (count
  1) or a run that doesn't reach Friday does **not** trigger it.
- Badge appearance is identical between system and manual sources (same `⛔` icon, favicon,
  "Paused" text, same `bg-slate-100 text-slate-500` pill). Only the `title` tooltip differs.
- If a platform has both a system pause and a qualifying manual run in the same week, only the
  system badge renders (no duplicate for the same platform).
- Verify every task with `npm run build` (TypeScript project-reference build — `tsc --noEmit`
  alone checks nothing in this repo, since the root `tsconfig.json` is references-only) and
  `npm test` (Vitest).

---

### Task 1: Share `WEEKDAY_LABELS` between `SchedulePlanner.tsx` and `calendarRenderer.tsx`

**Files:**
- Modify: `src/lib/scheduleBrands.ts:30` (add export, right after `WEEKDAYS`)
- Modify: `src/pages/SchedulePlanner.tsx:17` (import), `src/pages/SchedulePlanner.tsx:32-39` (remove local const)

**Interfaces:**
- Produces: `WEEKDAY_LABELS: Record<Weekday, string>` exported from `src/lib/scheduleBrands.ts`,
  mapping `monday`→`'Mon'`, `tuesday`→`'Tue'`, `wednesday`→`'Wed'`, `thursday`→`'Thu'`,
  `friday`→`'Fri'`. Task 3 (`calendarRenderer.tsx`) imports this directly.

This is a pure move (no behavior change) so `SchedulePlanner.tsx` and `calendarRenderer.tsx` can
share one source for weekday abbreviations instead of `SchedulePlanner.tsx` privately owning the
only copy — needed because Task 3 will need the same labels inside `calendarRenderer.tsx` to
build a manual-pause tooltip.

- [ ] **Step 1: Add `WEEKDAY_LABELS` to `scheduleBrands.ts`**

In `src/lib/scheduleBrands.ts`, immediately after the existing line:
```ts
export const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
```
add:
```ts
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
};
```

- [ ] **Step 2: Import it in `SchedulePlanner.tsx` and delete the local copy**

Change the import on line 17 of `src/pages/SchedulePlanner.tsx` from:
```ts
import { WEEKDAYS, scheduleFor, nextStatus, withDayStatus, toISODate, mondayOf, type BrandScheduleRow, type DayStatus, type Weekday } from '../lib/scheduleBrands';
```
to:
```ts
import { WEEKDAYS, WEEKDAY_LABELS, scheduleFor, nextStatus, withDayStatus, toISODate, mondayOf, type BrandScheduleRow, type DayStatus, type Weekday } from '../lib/scheduleBrands';
```

Then delete this block (currently lines 32-39):
```ts
const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
};

```
(Delete the whole block including the blank line that follows it — the next line after it is
`const TAB_STORAGE_KEY = ...`.)

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (confirms `WEEKDAY_LABELS` is no longer
double-declared and every existing usage in `SchedulePlanner.tsx` still resolves via the new
import).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (this step touches no logic, only where a constant is
declared).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleBrands.ts src/pages/SchedulePlanner.tsx
git commit -m "refactor: share WEEKDAY_LABELS between SchedulePlanner and calendarRenderer"
```

---

### Task 2: Add `trailingManualPauseDays` helper with unit tests

**Files:**
- Modify: `src/lib/scheduler/scheduleUtils.ts` (add function, after `unscheduledPlatforms`, i.e.
  after the line `}` that closes it around line 38)
- Test: `src/lib/scheduler/scheduleUtils.test.ts` (add `describe('trailingManualPauseDays', ...)`
  block)

**Interfaces:**
- Consumes: `WEEKDAYS: Weekday[]` (already imported in this file from `../scheduleBrands.ts`),
  `BrandScheduleRow` (already imported), `Weekday` (already imported).
- Produces: `trailingManualPauseDays(row: BrandScheduleRow | undefined): Weekday[]` — exported
  from `src/lib/scheduler/scheduleUtils.ts`. Task 4 (`SchedulePlanner.tsx`) imports and calls
  this per platform.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scheduler/scheduleUtils.test.ts`. First update the two import lines at the top:

```ts
import { leastLoadedDay, weeklyCompletion, completedBrandPlatformKey, PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms, buildDateStatusIndex, trailingManualPauseDays } from './scheduleUtils';
import type { BrandScheduleRow, Weekday } from '../scheduleBrands';
```

Then add this new `describe` block (e.g. after the `unscheduledPlatforms` block, before
`buildDateStatusIndex`):

```ts
describe('trailingManualPauseDays', () => {
  const row = (days: Partial<Record<Weekday, 'active' | 'paused'>>): BrandScheduleRow => ({
    tab: 'BITP', brand_key: 'x', week_start: '2026-08-03', platform: 'tp',
    monday: days.monday ?? null, tuesday: days.tuesday ?? null, wednesday: days.wednesday ?? null,
    thursday: days.thursday ?? null, friday: days.friday ?? null,
  });

  it('returns the full week when all 5 days are paused', () => {
    expect(trailingManualPauseDays(row({
      monday: 'paused', tuesday: 'paused', wednesday: 'paused', thursday: 'paused', friday: 'paused',
    }))).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  });

  it('returns the trailing run when Wed-Fri are paused and Mon/Tue are active', () => {
    expect(trailingManualPauseDays(row({
      monday: 'active', tuesday: 'active', wednesday: 'paused', thursday: 'paused', friday: 'paused',
    }))).toEqual(['wednesday', 'thursday', 'friday']);
  });

  it('returns the trailing run when only Thu-Fri are paused', () => {
    expect(trailingManualPauseDays(row({ thursday: 'paused', friday: 'paused' }))).toEqual(['thursday', 'friday']);
  });

  it('returns empty when only Friday is paused (run length 1)', () => {
    expect(trailingManualPauseDays(row({ friday: 'paused' }))).toEqual([]);
  });

  it('returns empty when Mon+Tue are paused but the run does not reach Friday', () => {
    expect(trailingManualPauseDays(row({ monday: 'paused', tuesday: 'paused' }))).toEqual([]);
  });

  it('returns empty for a scattered/alternating pause pattern', () => {
    expect(trailingManualPauseDays(row({ monday: 'paused', wednesday: 'paused', friday: 'active' }))).toEqual([]);
  });

  it('returns empty for an undefined row', () => {
    expect(trailingManualPauseDays(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- scheduleUtils`
Expected: FAIL — `trailingManualPauseDays is not exported` / `not a function` (it doesn't exist
yet in `scheduleUtils.ts`).

- [ ] **Step 3: Implement `trailingManualPauseDays`**

In `src/lib/scheduler/scheduleUtils.ts`, add this function directly after the closing `}` of
`unscheduledPlatforms`:

```ts
// Walks a week's day statuses backward from Friday, collecting the
// consecutive trailing run of 'paused' days. A run shorter than 2 days
// (including a lone paused Friday) doesn't count — it reads as an ordinary
// single clicked-then-reconsidered day, not "the team decided to stop for
// the rest of the week." Used to flag a manually-paused platform in the
// Paused column even when no system-detected brand_platform_pause row
// exists for it.
export function trailingManualPauseDays(row: BrandScheduleRow | undefined): Weekday[] {
  if (!row) return [];
  const days: Weekday[] = [];
  for (let i = WEEKDAYS.length - 1; i >= 0; i--) {
    const day = WEEKDAYS[i];
    if (row[day] !== 'paused') break;
    days.unshift(day);
  }
  return days.length >= 2 ? days : [];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- scheduleUtils`
Expected: PASS, all 7 new cases plus every pre-existing case in this file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/scheduleUtils.ts src/lib/scheduler/scheduleUtils.test.ts
git commit -m "feat: add trailingManualPauseDays helper for the manual-pause column indicator"
```

---

### Task 3: Extend `PausedPlatformIndicator` to a system/manual discriminated union

**Files:**
- Modify: `src/lib/scheduler/calendarRenderer.tsx:1` (imports), `:144-176` (interface + component)

**Interfaces:**
- Consumes: `WEEKDAY_LABELS` from `src/lib/scheduleBrands.ts` (Task 1), `Weekday` type (already
  imported in this file).
- Produces: `PausedPlatformIndicator` now takes a discriminated-union prop:
  `{ platform: Platform; source: 'system'; pause: BrandPlatformPause }` (existing behavior,
  unchanged output) or `{ platform: Platform; source: 'manual'; days: Weekday[] }` (new). Task 4
  passes one or the other from `SchedulePlanner.tsx`.

- [ ] **Step 1: Add the `WEEKDAY_LABELS` import**

In `src/lib/scheduler/calendarRenderer.tsx`, after the existing line:
```ts
import type { Weekday, BrandScheduleRow, DayStatus } from '../scheduleBrands';
```
add:
```ts
import { WEEKDAY_LABELS } from '../scheduleBrands';
```

- [ ] **Step 2: Replace the props interface and component**

Replace this block (currently lines 144-176):
```ts
interface PausedPlatformIndicatorProps {
  platform: Platform;
  pause: BrandPlatformPause;
}

function resumeWeekLabel(pausedWeekStart: string): string {
  const [y, m, d] = pausedWeekStart.split('-').map(Number);
  const resume = new Date(y, m - 1, d);
  resume.setDate(resume.getDate() + 7);
  return resume.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function PausedPlatformIndicator({ platform, pause }: PausedPlatformIndicatorProps) {
  const autoExpires = pause.reason !== PERSISTENT_PAUSE_REASONS.manual && pause.reason !== PERSISTENT_PAUSE_REASONS.flagged;
  const title = autoExpires
    ? `Reason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}`
    : `Reason: ${pause.reason}\nStays paused until manually cleared`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500"
      title={title}
    >
      ⛔
      <img
        src={PLATFORM_FAVICON[platform]}
        alt={PLATFORM_BADGE[platform].label}
        className="size-3 rounded-sm"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      Paused
    </span>
  );
}
```

with:
```ts
type PausedPlatformIndicatorProps =
  | { platform: Platform; source: 'system'; pause: BrandPlatformPause }
  | { platform: Platform; source: 'manual'; days: Weekday[] };

function resumeWeekLabel(pausedWeekStart: string): string {
  const [y, m, d] = pausedWeekStart.split('-').map(Number);
  const resume = new Date(y, m - 1, d);
  resume.setDate(resume.getDate() + 7);
  return resume.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// The manual branch is deliberately terse with no resume/expiry line: unlike
// a brand_platform_pause row, a manual per-day pause isn't a tracked,
// auto-expiring state — it's just this week's brand_schedule row. A future
// week starts fresh with its own independently-clicked or freshly-generated
// days, so there's nothing accurate to claim about when it "ends."
function titleFor(props: PausedPlatformIndicatorProps): string {
  if (props.source === 'system') {
    const { pause } = props;
    const autoExpires = pause.reason !== PERSISTENT_PAUSE_REASONS.manual && pause.reason !== PERSISTENT_PAUSE_REASONS.flagged;
    return autoExpires
      ? `Reason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}`
      : `Reason: ${pause.reason}\nStays paused until manually cleared`;
  }
  return `Reason: Manually paused (${props.days.map((d) => WEEKDAY_LABELS[d]).join(', ')})`;
}

export function PausedPlatformIndicator(props: PausedPlatformIndicatorProps) {
  const { platform } = props;
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500"
      title={titleFor(props)}
    >
      ⛔
      <img
        src={PLATFORM_FAVICON[platform]}
        alt={PLATFORM_BADGE[platform].label}
        className="size-3 rounded-sm"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      Paused
    </span>
  );
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: fails at this step ONLY if `SchedulePlanner.tsx` (Task 4, not yet done) still calls
`<PausedPlatformIndicator platform={p} pause={...} />` without a `source` prop — TypeScript will
reject it since the union no longer has an implicit/optional `source`. Confirm the error is
exactly that (a missing `source` property on the existing call site in
`src/pages/SchedulePlanner.tsx`), not something else. This is expected and resolved by Task 4 —
do not attempt to fix `SchedulePlanner.tsx` in this task.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scheduler/calendarRenderer.tsx
git commit -m "feat: support a manual-pause source in PausedPlatformIndicator"
```

(Committing here is safe even though the build doesn't fully pass yet — `SchedulePlanner.tsx`'s
existing call site is fixed in the very next task, and each task's commit should stand on its own
diff. If your workflow requires every commit to build clean, do Task 3 and Task 4 as one combined
commit instead.)

---

### Task 4: Wire manual-pause detection into `SchedulePlanner.tsx`'s Paused column

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx:23` (import), `:541-543` (per-row computation),
  `:593-601` (last-column render)

**Interfaces:**
- Consumes: `trailingManualPauseDays` (Task 2, from `src/lib/scheduler/scheduleUtils.ts`),
  `PausedPlatformIndicator`'s new discriminated-union props (Task 3).

- [ ] **Step 1: Import `trailingManualPauseDays`**

Change line 23 of `src/pages/SchedulePlanner.tsx` from:
```ts
import { unscheduledPlatforms, buildDateStatusIndex, PLATFORM_BADGE, PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
```
to:
```ts
import { unscheduledPlatforms, buildDateStatusIndex, trailingManualPauseDays, PLATFORM_BADGE, PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
```

- [ ] **Step 2: Compute `manualPausedPlatforms` alongside the existing `pausedPlatforms`**

Find this block (currently lines 541-543):
```ts
                filteredBrands.map((brand) => {
                  const { rowsByPlatform, pausesByPlatform } = computeCellData(brand);
                  const pausedPlatforms = activePlatforms.filter((p) => pausesByPlatform[p]);
```
Change it to:
```ts
                filteredBrands.map((brand) => {
                  const { rowsByPlatform, pausesByPlatform } = computeCellData(brand);
                  const pausedPlatforms = activePlatforms.filter((p) => pausesByPlatform[p]);
                  const manualPausedPlatforms = activePlatforms
                    .filter((p) => !pausesByPlatform[p])
                    .map((p) => ({ platform: p, days: trailingManualPauseDays(rowsByPlatform[p]) }))
                    .filter((x) => x.days.length > 0);
```

- [ ] **Step 3: Render both lists in the last column**

Find this block (currently lines 593-601):
```tsx
                      <td className="px-3 py-2 text-left">
                        {pausedPlatforms.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {pausedPlatforms.map((p) => (
                              <PausedPlatformIndicator key={p} platform={p} pause={pausesByPlatform[p] as BrandPlatformPause} />
                            ))}
                          </div>
                        )}
                      </td>
```
Replace it with:
```tsx
                      <td className="px-3 py-2 text-left">
                        {(pausedPlatforms.length > 0 || manualPausedPlatforms.length > 0) && (
                          <div className="flex flex-wrap gap-1">
                            {pausedPlatforms.map((p) => (
                              <PausedPlatformIndicator key={p} platform={p} source="system" pause={pausesByPlatform[p] as BrandPlatformPause} />
                            ))}
                            {manualPausedPlatforms.map(({ platform, days }) => (
                              <PausedPlatformIndicator key={platform} platform={platform} source="manual" days={days} />
                            ))}
                          </div>
                        )}
                      </td>
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (this resolves the expected Task-3 build error —
the `PausedPlatformIndicator` call site now passes `source="system"`).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `trailingManualPauseDays` cases from Task 2.

- [ ] **Step 6: Commit**

```bash
git add src/pages/SchedulePlanner.tsx
git commit -m "feat: show manually-paused trailing days in Schedule Planner's Paused column"
```

---

## Manual Verification (recommended, not automated)

No React component test harness exists in this repo (`src/lib/scheduler/*.test.ts` covers only
pure functions — see `scheduleUtils.test.ts`, `schedulerEngine.test.ts`,
`schedulerService.test.ts`). Before considering this done, load the running app
(`npm run dev`) against real Supabase data and, on any brand tab (e.g. BITP from the screenshot
in the original request):
1. Click a day chip to cycle it to `paused` for Thu and Fri only (2-day trailing run) — confirm
   the last column now shows a `⛔ Paused` badge for that platform, and hovering it shows
   "Reason: Manually paused (Thu, Fri)".
2. Click Friday back to blank, leaving only Thu paused — confirm the badge disappears (run length
   dropped to 1).
3. Re-pause Fri, then also pause Wed — confirm the tooltip updates to list all three days.
4. On a row already showing a system-pause badge (e.g. Nomini Kasino / TP in the original
   screenshot), manually pause that same platform's trailing days too — confirm only one badge
   renders (system wins), not two.
5. Confirm a scattered pattern (e.g. only Monday paused, or Monday + Wednesday paused with
   Thursday/Friday active) never shows the column badge, while the individual paused day cell(s)
   still show their existing dimmed chip.

## Self-Review Notes

- **Spec coverage:** Trigger rule (Task 2 tests cover all 6 documented examples exactly), badge
  appearance/tooltip differentiation (Task 3), precedence when both sources apply (Task 4's
  `.filter((p) => !pausesByPlatform[p])` before the manual check), no schema change (confirmed —
  no task touches `supabase/`), click-to-cycle unchanged (no task modifies `handleCellClick` or
  `handleSetDayStatus`). All covered.
- **Placeholder scan:** No TBD/TODO markers; every step has literal code.
- **Type consistency:** `trailingManualPauseDays(row: BrandScheduleRow | undefined): Weekday[]`
  (Task 2) is called identically in Task 4 as `trailingManualPauseDays(rowsByPlatform[p])` where
  `rowsByPlatform[p]` is `BrandScheduleRow | undefined` (matches `computeCellData`'s existing
  return type). `PausedPlatformIndicatorProps`'s `source: 'manual'; days: Weekday[]` (Task 3)
  matches the `{ platform, days }` shape Task 4 maps `manualPausedPlatforms` into and spreads as
  props.
