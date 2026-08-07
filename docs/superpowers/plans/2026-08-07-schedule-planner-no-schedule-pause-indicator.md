# Schedule Planner: "No Schedule This Week" Pause Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third trigger to the Schedule Planner's Paused column: for the current week only,
per platform, show the same `⛔ Paused` badge when a brand's platform has nothing scheduled at
all this week (every one of the 5 weekday columns is blank — no `'active'`, no `'paused'`).

**Architecture:** Purely additive, read-only derivation from data already fetched into
`SchedulePlanner.tsx`'s state — no new table, query, or write path. A new pure helper
(`hasNoScheduleThisWeek`) detects the all-blank case; `PausedPlatformIndicator`
(`calendarRenderer.tsx`) gains a third discriminated-union arm; `SchedulePlanner.tsx` computes a
current-week gate and a third per-row platform list, excluding platforms already claimed by the
two existing Paused-column sources (system pause, manual trailing-pause run).

**Tech Stack:** Vite + React 19 + TypeScript (strict), Tailwind v4, Vitest for unit tests.

## Global Constraints
- TypeScript strict mode. No `any` unless commented why.
- No schema/DB changes.
- Click-to-cycle behavior (`handleCellClick`/`handleSetDayStatus` in `SchedulePlanner.tsx`) is
  unchanged — do not touch it.
- Trigger rule (exact, from the design spec): applies **only when the displayed week is the
  actual current week** (`weekStartISO === toISODate(mondayOf(new Date()))`). Per platform, not
  per brand row. "No schedule" means the platform's `brand_schedule` row for this week is either
  missing entirely, or present with all 5 weekday fields (`monday`..`friday`) `null` — a row with
  even one `'paused'` day does NOT qualify (that's the existing manual-trailing-pause badge's
  territory or simply not a 2-day run yet).
- Badge appearance is identical across all three sources (same `⛔` icon, favicon, "Paused" text,
  same `bg-slate-100 text-slate-500` pill). Only the `title` tooltip differs. The new source's
  tooltip is the fixed string `Reason: No schedule this week` (no day list, no resume line).
- A platform already covered by the system-pause or manual-trailing-pause badge must never also
  get the no-schedule badge (no duplicate badge for the same platform) — though by construction
  these three states cannot actually overlap.
- Verify every task with `npm run build` (TypeScript project-reference build — `tsc --noEmit`
  alone checks nothing in this repo) and `npm test` (Vitest).

---

### Task 1: Add `hasNoScheduleThisWeek` helper with unit tests

**Files:**
- Modify: `src/lib/scheduler/scheduleUtils.ts` (add function, directly after
  `trailingManualPauseDays`, i.e. after its closing `}`)
- Test: `src/lib/scheduler/scheduleUtils.test.ts` (add `describe('hasNoScheduleThisWeek', ...)`
  block)

**Interfaces:**
- Consumes: `WEEKDAYS: Weekday[]` (already imported in this file from `../scheduleBrands.ts`),
  `BrandScheduleRow` (already imported).
- Produces: `hasNoScheduleThisWeek(row: BrandScheduleRow | undefined): boolean` — exported from
  `src/lib/scheduler/scheduleUtils.ts`. Task 3 (`SchedulePlanner.tsx`) imports and calls this per
  platform.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scheduler/scheduleUtils.test.ts`. First add `hasNoScheduleThisWeek` to the
existing import from `./scheduleUtils`:

```ts
import { leastLoadedDay, weeklyCompletion, completedBrandPlatformKey, PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms, buildDateStatusIndex, trailingManualPauseDays, hasNoScheduleThisWeek } from './scheduleUtils';
```

Then add this new `describe` block (e.g. directly after the `trailingManualPauseDays` block):

```ts
describe('hasNoScheduleThisWeek', () => {
  const row = (days: Partial<Record<Weekday, 'active' | 'paused'>>): BrandScheduleRow => ({
    tab: 'BITP', brand_key: 'x', week_start: '2026-08-03', platform: 'tp',
    monday: days.monday ?? null, tuesday: days.tuesday ?? null, wednesday: days.wednesday ?? null,
    thursday: days.thursday ?? null, friday: days.friday ?? null,
  });

  it('returns true when all 5 days are null', () => {
    expect(hasNoScheduleThisWeek(row({}))).toBe(true);
  });

  it('returns true for an undefined row', () => {
    expect(hasNoScheduleThisWeek(undefined)).toBe(true);
  });

  it('returns false when a single day is active', () => {
    expect(hasNoScheduleThisWeek(row({ wednesday: 'active' }))).toBe(false);
  });

  it('returns false when a single day is paused', () => {
    expect(hasNoScheduleThisWeek(row({ friday: 'paused' }))).toBe(false);
  });

  it('returns false for a fully active week', () => {
    expect(hasNoScheduleThisWeek(row({
      monday: 'active', tuesday: 'active', wednesday: 'active', thursday: 'active', friday: 'active',
    }))).toBe(false);
  });

  it('returns false for a fully paused week (this is the manual-trailing-pause case, not no-schedule)', () => {
    expect(hasNoScheduleThisWeek(row({
      monday: 'paused', tuesday: 'paused', wednesday: 'paused', thursday: 'paused', friday: 'paused',
    }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- scheduleUtils`
Expected: FAIL — `hasNoScheduleThisWeek is not exported` / `not a function` (it doesn't exist yet).

- [ ] **Step 3: Implement `hasNoScheduleThisWeek`**

In `src/lib/scheduler/scheduleUtils.ts`, add this function directly after the closing `}` of
`trailingManualPauseDays`:

```ts
// True when a platform has nothing scheduled at all this week: the row is
// missing entirely, or every one of its 5 weekday fields is null. A row
// with even one 'paused' day does NOT qualify — that's either the
// trailingManualPauseDays case (2+ trailing paused days) or simply not a
// run yet; "no schedule" is specifically the fully-blank case, distinct
// from both the active and the paused states.
export function hasNoScheduleThisWeek(row: BrandScheduleRow | undefined): boolean {
  if (!row) return true;
  return WEEKDAYS.every((day) => row[day] == null);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- scheduleUtils`
Expected: PASS, all 6 new cases plus every pre-existing case in this file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/scheduleUtils.ts src/lib/scheduler/scheduleUtils.test.ts
git commit -m "feat: add hasNoScheduleThisWeek helper for the no-schedule pause indicator"
```

---

### Task 2: Add a third `'no-schedule'` source to `PausedPlatformIndicator`

**Files:**
- Modify: `src/lib/scheduler/calendarRenderer.tsx:145-176` (union type + `titleFor`)

**Interfaces:**
- Produces: `PausedPlatformIndicator` now accepts a third discriminated-union arm:
  `{ platform: Platform; source: 'no-schedule' }` (no extra payload). Task 3 passes this from
  `SchedulePlanner.tsx`.

This task must fully handle all three arms in `titleFor` within this same commit — leaving the
`'no-schedule'` arm unhandled would make TypeScript reject accessing `.days` in the fallback
branch (`props` narrows to `'manual' | 'no-schedule'` outside the `'system'` check, and
`'no-schedule'` has no `.days` field), so this task's own `npm run build` step is a real
verification, not a formality.

- [ ] **Step 1: Extend the union type and `titleFor`**

In `src/lib/scheduler/calendarRenderer.tsx`, replace this block (currently lines 145-176):
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
    // "Manually paused" (Task 7) and "Flagged via email notification" (Task 6)
    // both persist for as long as the override/flag stays set -- their
    // paused_week_start gets re-upserted to the current week on every
    // recalculatePauses run, so unlike a real auto-detected pause they don't
    // actually auto-resume next week. Showing "Resumes week of ..." for them
    // would be misleading.
    const autoExpires = pause.reason !== PERSISTENT_PAUSE_REASONS.manual && pause.reason !== PERSISTENT_PAUSE_REASONS.flagged;
    return autoExpires
      ? `Reason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}`
      : `Reason: ${pause.reason}\nStays paused until manually cleared`;
  }
  return `Reason: Manually paused (${props.days.map((d) => WEEKDAY_LABELS[d]).join(', ')})`;
}
```

with:
```ts
type PausedPlatformIndicatorProps =
  | { platform: Platform; source: 'system'; pause: BrandPlatformPause }
  | { platform: Platform; source: 'manual'; days: Weekday[] }
  | { platform: Platform; source: 'no-schedule' };

function resumeWeekLabel(pausedWeekStart: string): string {
  const [y, m, d] = pausedWeekStart.split('-').map(Number);
  const resume = new Date(y, m - 1, d);
  resume.setDate(resume.getDate() + 7);
  return resume.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// The manual and no-schedule branches are both deliberately terse with no
// resume/expiry line: unlike a brand_platform_pause row, neither is a
// tracked, auto-expiring state — they're just this week's brand_schedule
// row. A future week starts fresh with its own independently-clicked or
// freshly-generated days, so there's nothing accurate to claim about when
// either "ends."
function titleFor(props: PausedPlatformIndicatorProps): string {
  if (props.source === 'system') {
    const { pause } = props;
    // "Manually paused" (Task 7) and "Flagged via email notification" (Task 6)
    // both persist for as long as the override/flag stays set -- their
    // paused_week_start gets re-upserted to the current week on every
    // recalculatePauses run, so unlike a real auto-detected pause they don't
    // actually auto-resume next week. Showing "Resumes week of ..." for them
    // would be misleading.
    const autoExpires = pause.reason !== PERSISTENT_PAUSE_REASONS.manual && pause.reason !== PERSISTENT_PAUSE_REASONS.flagged;
    return autoExpires
      ? `Reason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}`
      : `Reason: ${pause.reason}\nStays paused until manually cleared`;
  }
  if (props.source === 'manual') {
    return `Reason: Manually paused (${props.days.map((d) => WEEKDAY_LABELS[d]).join(', ')})`;
  }
  return 'Reason: No schedule this week';
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors. This confirms `titleFor` genuinely handles all
three arms (if the `'no-schedule'` branch were missing, this step would fail with a type error
on `props.days` inside the old fallback branch).

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (this task adds no new tests of its own — there is no
component test harness in this repo, and the type-level exhaustiveness is what `npm run build`
verifies).

- [ ] **Step 4: Commit**

```bash
git add src/lib/scheduler/calendarRenderer.tsx
git commit -m "feat: add a no-schedule source to PausedPlatformIndicator"
```

---

### Task 3: Wire "no schedule this week" detection into `SchedulePlanner.tsx`

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx:23` (import), `:104` (add `currentWeekStartISO`),
  `:413-416` (add `isCurrentWeek` after `isLegacyWeek`), `:533-539` (per-row computation),
  `:589-600` (last-column render)

**Interfaces:**
- Consumes: `hasNoScheduleThisWeek` (Task 1, from `src/lib/scheduler/scheduleUtils.ts`),
  `PausedPlatformIndicator`'s third `'no-schedule'` arm (Task 2).

- [ ] **Step 1: Import `hasNoScheduleThisWeek`**

Change line 23 of `src/pages/SchedulePlanner.tsx` from:
```ts
import { unscheduledPlatforms, buildDateStatusIndex, trailingManualPauseDays, PLATFORM_BADGE, PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
```
to:
```ts
import { unscheduledPlatforms, buildDateStatusIndex, trailingManualPauseDays, hasNoScheduleThisWeek, PLATFORM_BADGE, PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
```

- [ ] **Step 2: Add `isCurrentWeek`, computed once on mount and compared per render**

Find this block (currently lines 413-416):
```ts
  const isLegacyWeek = useMemo(
    () => scheduleRows.length > 0 && scheduleRows.every((r) => r.platform == null),
    [scheduleRows],
  );
```
Add directly after it:
```ts
  // Computed once on mount, same reasoning as todayISO further up — this
  // only needs to gate the "no schedule this week" badge below to the
  // actual current week, not track a live-updating clock across a
  // long-lived tab. A future week is legitimately blank until it becomes
  // current and the scheduler generates it, so this trigger must never
  // fire for a past or future week.
  const currentWeekStartISO = useMemo(() => toISODate(mondayOf(new Date())), []);
  const isCurrentWeek = weekStartISO === currentWeekStartISO;
```

- [ ] **Step 3: Compute `noSchedulePlatforms` alongside the existing two lists**

Find this block (currently lines 533-539):
```ts
                filteredBrands.map((brand) => {
                  const { rowsByPlatform, pausesByPlatform } = computeCellData(brand);
                  const pausedPlatforms = activePlatforms.filter((p) => pausesByPlatform[p]);
                  const manualPausedPlatforms = brandPlatforms(brand)
                    .filter((p) => !pausesByPlatform[p])
                    .map((p) => ({ platform: p, days: trailingManualPauseDays(rowsByPlatform[p]) }))
                    .filter((x) => x.days.length > 0);
```
Change it to:
```ts
                filteredBrands.map((brand) => {
                  const { rowsByPlatform, pausesByPlatform } = computeCellData(brand);
                  const pausedPlatforms = activePlatforms.filter((p) => pausesByPlatform[p]);
                  const manualPausedPlatforms = brandPlatforms(brand)
                    .filter((p) => !pausesByPlatform[p])
                    .map((p) => ({ platform: p, days: trailingManualPauseDays(rowsByPlatform[p]) }))
                    .filter((x) => x.days.length > 0);
                  const manuallyPausedPlatformSet = new Set(manualPausedPlatforms.map((x) => x.platform));
                  const noSchedulePlatforms = isCurrentWeek
                    ? brandPlatforms(brand).filter(
                        (p) => !pausesByPlatform[p] && !manuallyPausedPlatformSet.has(p) && hasNoScheduleThisWeek(rowsByPlatform[p]),
                      )
                    : [];
```

- [ ] **Step 4: Render the third list in the last column**

Find this block (currently lines 589-600):
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
Replace it with:
```tsx
                      <td className="px-3 py-2 text-left">
                        {(pausedPlatforms.length > 0 || manualPausedPlatforms.length > 0 || noSchedulePlatforms.length > 0) && (
                          <div className="flex flex-wrap gap-1">
                            {pausedPlatforms.map((p) => (
                              <PausedPlatformIndicator key={p} platform={p} source="system" pause={pausesByPlatform[p] as BrandPlatformPause} />
                            ))}
                            {manualPausedPlatforms.map(({ platform, days }) => (
                              <PausedPlatformIndicator key={platform} platform={platform} source="manual" days={days} />
                            ))}
                            {noSchedulePlatforms.map((platform) => (
                              <PausedPlatformIndicator key={platform} platform={platform} source="no-schedule" />
                            ))}
                          </div>
                        )}
                      </td>
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including Task 1's new `hasNoScheduleThisWeek` cases.

- [ ] **Step 7: Commit**

```bash
git add src/pages/SchedulePlanner.tsx
git commit -m "feat: flag platforms with no schedule this week in the Paused column"
```

---

## Manual Verification (recommended, not automated)

No React component test harness exists in this repo. Before considering this done, load the
running app (`npm run dev`) against real Supabase data, on the actual current week:
1. Find or create a brand+platform combo with every day this week blank (never scheduled, or
   click every day back to blank via the existing cycle) — confirm the Paused column now shows
   a badge for that platform, tooltip "Reason: No schedule this week".
2. Click one day to `active` — confirm the badge disappears immediately (no longer "no schedule").
3. Set that day back to blank, then instead click two trailing days (e.g. Thu+Fri) to `paused` —
   confirm the badge switches to showing the manual-trailing-pause tooltip, not the no-schedule
   one (the two must never show together for the same platform).
4. Navigate to a past or future week where a platform is genuinely blank — confirm NO badge
   appears there (the current-week gate is working).
5. Confirm a platform with an existing system pause (`brand_platform_pause` row) never also gets
   a no-schedule badge, even though its days are also blank by construction.

## Self-Review Notes

- **Spec coverage:** Current-week-only gate (Task 3 Step 2), per-platform scope (Task 3 Step 3
  iterates `brandPlatforms(brand)`, not a whole-row flag), "entirely blank" definition excluding
  any-paused rows (Task 1's `hasNoScheduleThisWeek` and its "fully paused week → false" test
  case), identical badge appearance with tooltip-only difference (Task 2), no duplicate badge
  across sources (Task 3's `manuallyPausedPlatformSet` exclusion plus the `!pausesByPlatform[p]`
  filter already used for the system exclusion). All covered.
- **Placeholder scan:** No TBD/TODO markers; every step has literal code.
- **Type consistency:** `hasNoScheduleThisWeek(row: BrandScheduleRow | undefined): boolean`
  (Task 1) is called identically in Task 3 as `hasNoScheduleThisWeek(rowsByPlatform[p])`, where
  `rowsByPlatform[p]` is `BrandScheduleRow | undefined` (matches `computeCellData`'s existing
  return type, same pattern the prior task's `trailingManualPauseDays` call already established).
  `PausedPlatformIndicatorProps`'s new `{ platform, source: 'no-schedule' }` arm (Task 2) matches
  exactly what Task 3 spreads as props (`platform={platform} source="no-schedule"`, no `days` or
  `pause` field needed or passed).
