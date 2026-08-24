# Schedule Planner Landing-Grid Executed-Only Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Schedule Planner's landing-grid preview cards and platform-count strip reflect real executed activity (Removed/Published/Pending/Done) for past dates, instead of the raw plan, while leaving today/future days and the detailed per-tab calendar untouched.

**Architecture:** Reuse the existing `DateStatusIndex` (`buildDateStatusIndex`) that `TabScheduleSection.tsx` already builds for its own Confirmed/Removed/Pending/Done badges. Add one small pure helper (`hasDateEvidence`) and extend the one function already shared between overview-mode and specific-tab-mode counting (`countActivePlatformSlots`) so both modes gain evidence-gating for past days by construction. The landing-grid preview cards get their own three-way per-cell resolution (executed / missed / none) built from the same index.

**Tech Stack:** React 19 + TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-schedule-planner-executed-only-preview-design.md`

## Global Constraints

- Past days are evidence-gated (any of Removed/Confirmed(Published)/Pending/Done from `DateStatusIndex`); today/future days stay plan-only (`status === 'active'`) — never invert this.
- Do not modify `TabScheduleSection.tsx`'s own per-cell rendering (`ScheduleCell` / `src/lib/scheduler/calendarRenderer.tsx`) — its ghosting and Confirmed/Removed/Pending/Done badges stay exactly as shipped. Only the *count* it reports up changes.
- Do not modify CSV/Excel export (`src/lib/scheduler/scheduleExport.ts`) or the PMS sync pipeline (`resolvePmsSyncStatus`, `pmsSync.ts`) — out of scope, per spec.
- `countActivePlatformSlots` is shared between overview mode (`SchedulePlanner.tsx`) and specific-tab mode (`TabScheduleSection.tsx`) — change its signature/behavior once; both callers must be updated together so they can't drift.

---

### Task 1: Add `hasDateEvidence` helper

**Files:**
- Modify: `src/lib/scheduler/scheduleUtils.ts`
- Test: `src/lib/scheduler/scheduleUtils.test.ts`

**Interfaces:**
- Produces: `hasDateEvidence(index: DateStatusIndex, brandKey: string, platform: Platform, iso: string): boolean` — true if `brandKey::platform::iso` is present in any of `index.removed` / `index.confirmed` / `index.pending` / `index.done`.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `src/lib/scheduler/scheduleUtils.test.ts`, directly after the existing `describe('buildDateStatusIndex', ...)` block (around line 264):

```ts
describe('hasDateEvidence', () => {
  const index: DateStatusIndex = {
    removed: new Set(['winmega::tp::2026-08-20']),
    confirmed: new Set(['winmega::ag::2026-08-20']),
    pending: new Set(['winmega::cg::2026-08-20']),
    done: new Set(['winmega::wo::2026-08-20']),
  };

  it('returns true when the key is in removed', () => {
    expect(hasDateEvidence(index, 'winmega', 'tp', '2026-08-20')).toBe(true);
  });

  it('returns true when the key is in confirmed', () => {
    expect(hasDateEvidence(index, 'winmega', 'ag', '2026-08-20')).toBe(true);
  });

  it('returns true when the key is in pending', () => {
    expect(hasDateEvidence(index, 'winmega', 'cg', '2026-08-20')).toBe(true);
  });

  it('returns true when the key is in done', () => {
    expect(hasDateEvidence(index, 'winmega', 'wo', '2026-08-20')).toBe(true);
  });

  it('returns false when the key is in none of the four sets', () => {
    expect(hasDateEvidence(index, 'winmega', 'tp', '2026-08-21')).toBe(false);
  });

  it('returns false for a different brand on the same platform+date', () => {
    expect(hasDateEvidence(index, 'otherbrand', 'tp', '2026-08-20')).toBe(false);
  });

  it('returns false against a completely empty index', () => {
    const empty: DateStatusIndex = { removed: new Set(), confirmed: new Set(), pending: new Set(), done: new Set() };
    expect(hasDateEvidence(empty, 'winmega', 'tp', '2026-08-20')).toBe(false);
  });
});
```

Also add `hasDateEvidence` and `type DateStatusIndex` to the existing import line at the top of the test file (currently line 2):

```ts
import { leastLoadedDay, weeklyCompletion, completedBrandPlatformKey, PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms, buildDateStatusIndex, hasDateEvidence, resolvePmsSyncStatus, buildAgentIndex, trailingManualPauseDays, hasNoScheduleThisWeek, buildAgentAssignmentMap, resolveAgentForPlatform, resolveAgentForBrand, buildResolvedAgentIndex, weekdayColumnsInRange, columnsForWeek, currentWeekColumns, countActivePlatformSlots, type DateStatusIndex } from './scheduleUtils';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scheduler/scheduleUtils.test.ts`
Expected: FAIL — `hasDateEvidence is not exported` / `is not a function`.

- [ ] **Step 3: Implement `hasDateEvidence`**

In `src/lib/scheduler/scheduleUtils.ts`, add this function directly after the `buildDateStatusIndex` function (after its closing brace, around line 143):

```ts
// True if a real entry's status gives brandKey+platform+iso evidence of
// something actually happening on that exact day — any of
// Removed/Confirmed(Published)/Pending/Done. Shared by the landing-grid
// preview cards and countActivePlatformSlots below so "executed" can't mean
// two different things in two places.
export function hasDateEvidence(index: DateStatusIndex, brandKey: string, platform: Platform, iso: string): boolean {
  const key = `${brandKey}::${platform}::${iso}`;
  return index.removed.has(key) || index.confirmed.has(key) || index.pending.has(key) || index.done.has(key);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/scheduleUtils.test.ts`
Expected: PASS (all tests in the file, including the 7 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/scheduleUtils.ts src/lib/scheduler/scheduleUtils.test.ts
git commit -m "feat: add hasDateEvidence helper for schedule evidence lookups"
```

---

### Task 2: Extend `countActivePlatformSlots` with past-day evidence gating

**Files:**
- Modify: `src/lib/scheduler/scheduleUtils.ts`
- Test: `src/lib/scheduler/scheduleUtils.test.ts`

**Interfaces:**
- Consumes: `hasDateEvidence` (Task 1), `DateStatusIndex` (existing type), `normalizeBrandKey` (already imported in this file from `../removedPlatformBrands.ts`).
- Produces: `countActivePlatformSlots(rows, tab, brands, brandPlatformsFn, columns, dateStatusIndex: DateStatusIndex, todayISO: string): Partial<Record<Platform, number>>` — new required 6th/7th params. Both existing call sites (Task 3, Task 4) must be updated to match.

- [ ] **Step 1: Update the existing tests to the new signature, and write new failing tests for evidence gating**

Replace the entire `describe('countActivePlatformSlots', ...)` block (currently the last block in the file, starting around line 503) with:

```ts
describe('countActivePlatformSlots', () => {
  const row = (brand: string, platform: 'tp' | 'ag', weekStart: string, days: Partial<Record<Weekday, 'active' | 'paused'>>): BrandScheduleRow => ({
    tab: 'BITP', brand_key: brand, week_start: weekStart, platform,
    monday: days.monday ?? null, tuesday: days.tuesday ?? null, wednesday: days.wednesday ?? null,
    thursday: days.thursday ?? null, friday: days.friday ?? null,
  });
  const allPlatforms = () => ['tp', 'ag'] as const;
  const emptyIndex: DateStatusIndex = { removed: new Set(), confirmed: new Set(), pending: new Set(), done: new Set() };
  // Before every date used in the plan-only tests below, so those columns
  // are always "today or future" and behave exactly as they did before the
  // evidence-gating change.
  const FUTURE_TODAY = '2026-01-01';

  it('counts one per active (brand, day) cell, per platform', () => {
    const rows = [
      row('a', 'tp', '2026-08-17', { monday: 'active', thursday: 'active' }),
      row('b', 'ag', '2026-08-17', { tuesday: 'active' }),
    ];
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const counts = countActivePlatformSlots(rows, 'BITP', ['a', 'b'], () => [...allPlatforms()], cols, emptyIndex, FUTURE_TODAY);
    expect(counts).toEqual({ tp: 2, ag: 1 });
  });

  it('does not count paused or null days', () => {
    const rows = [row('a', 'tp', '2026-08-17', { monday: 'paused' })];
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const counts = countActivePlatformSlots(rows, 'BITP', ['a'], () => ['tp'], cols, emptyIndex, FUTURE_TODAY);
    expect(counts).toEqual({ tp: 0 });
  });

  it('reports 0 (not omitted) for a platform with no active cells, as long as brandPlatformsFn returns it', () => {
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const counts = countActivePlatformSlots([], 'BITP', ['a'], () => ['tp', 'ag'], cols, emptyIndex, FUTURE_TODAY);
    expect(counts).toEqual({ tp: 0, ag: 0 });
  });

  it('only counts platforms brandPlatformsFn actually returns for that brand (respects exclusion)', () => {
    const rows = [row('a', 'tp', '2026-08-17', { monday: 'active' })];
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const counts = countActivePlatformSlots(rows, 'BITP', ['a'], () => ['ag'], cols, emptyIndex, FUTURE_TODAY);
    expect(counts).toEqual({ ag: 0 });
  });

  it('sums across multiple weeks when columns span more than one week_start', () => {
    const rows = [
      row('a', 'tp', '2026-08-17', { friday: 'active' }),
      row('a', 'tp', '2026-08-24', { monday: 'active' }),
    ];
    const cols = weekdayColumnsInRange('2026-08-21', '2026-08-24');
    const counts = countActivePlatformSlots(rows, 'BITP', ['a'], () => ['tp'], cols, emptyIndex, FUTURE_TODAY);
    expect(counts).toEqual({ tp: 2 });
  });

  it('for a past day, counts only when real evidence exists, ignoring the plan entirely', () => {
    const rows = [row('a', 'tp', '2026-08-17', { monday: 'active' })]; // planned, but no evidence
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00')); // Mon 2026-08-17 .. Fri 2026-08-21
    const todayISO = '2026-08-24'; // the whole displayed week is now in the past
    const counts = countActivePlatformSlots(rows, 'BITP', ['a'], () => ['tp'], cols, emptyIndex, todayISO);
    expect(counts).toEqual({ tp: 0 });
  });

  it('for a past day, counts a brand+platform+day with evidence even when the plan has no row for it at all', () => {
    const index: DateStatusIndex = { removed: new Set(), confirmed: new Set(['a::tp::2026-08-17']), pending: new Set(), done: new Set() };
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const todayISO = '2026-08-24';
    const counts = countActivePlatformSlots([], 'BITP', ['a'], () => ['tp'], cols, index, todayISO);
    expect(counts).toEqual({ tp: 1 });
  });

  it('for a past day, counts each of the four evidence types (removed/confirmed/pending/done) equally', () => {
    const index: DateStatusIndex = {
      removed: new Set(['a::tp::2026-08-17']),
      confirmed: new Set(['a::tp::2026-08-18']),
      pending: new Set(['a::tp::2026-08-19']),
      done: new Set(['a::tp::2026-08-20']),
    };
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const todayISO = '2026-08-24';
    const counts = countActivePlatformSlots([], 'BITP', ['a'], () => ['tp'], cols, index, todayISO);
    expect(counts).toEqual({ tp: 4 });
  });

  it('treats today/future days as plan-only even when unrelated evidence exists for them', () => {
    const rows = [row('a', 'tp', '2026-08-17', {})]; // no plan for Monday
    const index: DateStatusIndex = { removed: new Set(), confirmed: new Set(['a::tp::2026-08-17']), pending: new Set(), done: new Set() };
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const todayISO = '2026-08-17'; // Monday itself is "today"
    const counts = countActivePlatformSlots(rows, 'BITP', ['a'], () => ['tp'], cols, index, todayISO);
    expect(counts).toEqual({ tp: 0 }); // evidence present but ignored -- no plan, and not past yet
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scheduler/scheduleUtils.test.ts`
Expected: FAIL — TypeScript arity errors (too few arguments) on the 5 pre-existing calls, and `tp: 2`/etc mismatches on the 3 new evidence-gating tests since the implementation doesn't gate yet.

- [ ] **Step 3: Update the implementation**

In `src/lib/scheduler/scheduleUtils.ts`, replace the existing `countActivePlatformSlots` function (the last function in the file) with:

```ts
// Counts, per platform, how many (brand, day) cells across `columns` count
// as "scheduled" -- the shared computation behind the Schedule Planner
// toolbar's platform-count strip in both overview mode (landing-grid cards,
// summed across tabs) and specific-tab mode (one TabScheduleSection's own
// count, reported up to the shared toolbar). `brandPlatformsFn` is whatever
// per-brand active-platform resolution the caller already has (it already
// accounts for hidden/restricted/removed-platform exclusion), so this
// function never needs its own copy of that logic.
//
// A day strictly before `todayISO` only counts with real evidence
// (hasDateEvidence against `dateStatusIndex`) -- the plan is ignored
// entirely for a past day, in either direction: a planned-but-unconfirmed
// past day doesn't count, and a real post on a day the plan didn't cover
// still does. A day on or after `todayISO` counts purely on the plan
// (`status === 'active'`), unchanged from before this evidence gating was
// added -- the day hasn't happened yet, so there's nothing to have executed.
export function countActivePlatformSlots(
  rows: BrandScheduleRow[],
  tab: string,
  brands: string[],
  brandPlatformsFn: (brand: string) => Platform[],
  columns: ScheduleColumn[],
  dateStatusIndex: DateStatusIndex,
  todayISO: string,
): Partial<Record<Platform, number>> {
  const counts: Partial<Record<Platform, number>> = {};
  for (const brand of brands) {
    const brandKey = normalizeBrandKey(brand);
    const platforms = brandPlatformsFn(brand);
    for (const platform of platforms) {
      counts[platform] = counts[platform] ?? 0;
      for (const col of columns) {
        const counted = col.iso < todayISO
          ? hasDateEvidence(dateStatusIndex, brandKey, platform, col.iso)
          : scheduleFor(rows, tab, brand, col.weekStartISO, platform)?.[col.weekday] === 'active';
        if (counted) counts[platform] = (counts[platform] ?? 0) + 1;
      }
    }
  }
  return counts;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/scheduleUtils.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/scheduleUtils.ts src/lib/scheduler/scheduleUtils.test.ts
git commit -m "feat: gate countActivePlatformSlots past-day counts on real evidence"
```

---

### Task 3: Wire the new params into `TabScheduleSection.tsx`

**Files:**
- Modify: `src/components/TabScheduleSection.tsx:626-638`

**Interfaces:**
- Consumes: `countActivePlatformSlots`'s new signature (Task 2). This component already has both new values available: `dateStatusIndex` (built at line 431 via `useMemo(() => buildDateStatusIndex(liveEntries), [liveEntries])`) and `todayISO` (an existing prop).

- [ ] **Step 1: Update the call site**

In `src/components/TabScheduleSection.tsx`, replace:

```ts
  const platformCounts = useMemo(
    () => countActivePlatformSlots(scheduleRows, tab, filteredBrands, brandPlatforms, columns),
    // brandPlatforms is a plain function closing over tabCtx/activePlatforms
    // (both re-derived fresh every render) rather than a memoized value —
    // included here via tabCtx itself so this recomputes whenever the
    // exclusion sets it reads from actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheduleRows, tab, filteredBrands, columns, tabCtx],
  );
```

with:

```ts
  const platformCounts = useMemo(
    () => countActivePlatformSlots(scheduleRows, tab, filteredBrands, brandPlatforms, columns, dateStatusIndex, todayISO),
    // brandPlatforms is a plain function closing over tabCtx/activePlatforms
    // (both re-derived fresh every render) rather than a memoized value —
    // included here via tabCtx itself so this recomputes whenever the
    // exclusion sets it reads from actually change. Past days now only count
    // with real evidence (dateStatusIndex) rather than the plan alone — see
    // countActivePlatformSlots' own doc comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheduleRows, tab, filteredBrands, columns, tabCtx, dateStatusIndex, todayISO],
  );
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — no test file directly exercises `TabScheduleSection.tsx` (verified: none exists), so this step confirms no other suite broke.

- [ ] **Step 3: Type-check via build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (this project's root `tsconfig` is references-only — `tsc --noEmit` alone proves nothing here; `npm run build` is the real check).

- [ ] **Step 4: Commit**

```bash
git add src/components/TabScheduleSection.tsx
git commit -m "feat: gate specific-tab-mode platform counts on real evidence for past days"
```

---

### Task 4: Wire evidence-gating into the landing-grid preview (`SchedulePlanner.tsx`)

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx`

**Interfaces:**
- Consumes: `hasDateEvidence`, `buildDateStatusIndex`, `type DateStatusIndex` (Task 1/existing), `countActivePlatformSlots`'s new signature (Task 2).

- [ ] **Step 1: Import the new helpers**

In `src/pages/SchedulePlanner.tsx`, update the existing `scheduler/scheduleUtils` import (currently line 10):

```ts
import { PLATFORM_BADGE, buildResolvedAgentIndex, columnsForWeek, weekdayColumnsInRange, countActivePlatformSlots, type ScheduleColumn } from '../lib/scheduler/scheduleUtils';
```

to:

```ts
import { PLATFORM_BADGE, buildResolvedAgentIndex, buildDateStatusIndex, hasDateEvidence, columnsForWeek, weekdayColumnsInRange, countActivePlatformSlots, type ScheduleColumn, type DateStatusIndex } from '../lib/scheduler/scheduleUtils';
```

- [ ] **Step 2: Add `dateStatusIndex` to `TabPreview` and `EMPTY_PREVIEW`**

Update the `TabPreview` interface (currently lines 32-49) by adding a new field after `agentIndex`:

```ts
interface TabPreview {
  // ...existing fields unchanged...
  agentIndex: Map<string, string>;
  // Real Removed/Confirmed(Published)/Pending/Done evidence for this tab's
  // entries, built once alongside the other per-tab derived state above —
  // lets a past day's chip and the platform-count strip both check "did this
  // actually happen" instead of only reading the plan. Same DateStatusIndex
  // shape/keying TabScheduleSection.tsx already builds for its own badges.
  dateStatusIndex: DateStatusIndex;
}
```

Update `EMPTY_PREVIEW` (currently lines 51-59) by adding:

```ts
const EMPTY_PREVIEW: TabPreview = {
  brands: [],
  activePlatforms: [],
  hiddenSet: new Set(),
  restrictionMap: new Map(),
  removedSet: new Set(),
  scheduleRows: [],
  agentIndex: new Map(),
  dateStatusIndex: buildDateStatusIndex([]),
};
```

- [ ] **Step 3: Build `dateStatusIndex` in the preview-fetch effect**

In the `useEffect` that builds `previewByTab` (currently lines 279-319), find this line (currently line 301):

```ts
            const agentIndex = buildResolvedAgentIndex(rawEntries, agentAssignmentRows, activePlatforms);
```

and add directly after it:

```ts
            const dateStatusIndex = buildDateStatusIndex(rawEntries);
```

Then update the `preview` object construction (currently line 305) from:

```ts
            const preview: TabPreview = { brands, activePlatforms, hiddenSet, restrictionMap, removedSet, scheduleRows: scheduleRowsPerWeek.flat(), agentIndex };
```

to:

```ts
            const preview: TabPreview = { brands, activePlatforms, hiddenSet, restrictionMap, removedSet, scheduleRows: scheduleRowsPerWeek.flat(), agentIndex, dateStatusIndex };
```

- [ ] **Step 4: Pass the new params into `overviewPlatformCounts`**

Update the `overviewPlatformCounts` useMemo (currently lines 338-356) from:

```ts
  const overviewPlatformCounts = useMemo(() => {
    const totals: Partial<Record<Platform, number>> = {};
    for (const t of getActiveOperationalTabs()) {
      const preview = previewByTab[t] ?? EMPTY_PREVIEW;
      const brands = previewBrandsFor(t);
      const tabCounts = countActivePlatformSlots(
        preview.scheduleRows,
        t,
        brands,
        (brand) => resolveBrandPlatforms(t, brand, preview.activePlatforms, preview.hiddenSet, preview.restrictionMap, preview.removedSet),
        allRangeColumns,
      );
      for (const platform of Object.keys(tabCounts) as Platform[]) {
        totals[platform] = (totals[platform] ?? 0) + (tabCounts[platform] ?? 0);
      }
    }
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewByTab, agentFilter, allRangeColumns]);
```

to:

```ts
  const overviewPlatformCounts = useMemo(() => {
    const totals: Partial<Record<Platform, number>> = {};
    for (const t of getActiveOperationalTabs()) {
      const preview = previewByTab[t] ?? EMPTY_PREVIEW;
      const brands = previewBrandsFor(t);
      const tabCounts = countActivePlatformSlots(
        preview.scheduleRows,
        t,
        brands,
        (brand) => resolveBrandPlatforms(t, brand, preview.activePlatforms, preview.hiddenSet, preview.restrictionMap, preview.removedSet),
        allRangeColumns,
        preview.dateStatusIndex,
        todayISO,
      );
      for (const platform of Object.keys(tabCounts) as Platform[]) {
        totals[platform] = (totals[platform] ?? 0) + (tabCounts[platform] ?? 0);
      }
    }
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewByTab, agentFilter, allRangeColumns, todayISO]);
```

- [ ] **Step 5: Render executed vs. missed chips per day cell**

In the card-rendering JSX (currently lines 546-586), find the brand-row block:

```tsx
                          previewBrands.map((brand) => {
                            const brandPlatforms = resolveBrandPlatforms(
                              t, brand, preview.activePlatforms, preview.hiddenSet, preview.restrictionMap, preview.removedSet,
                            );
                            return (
                              <tr key={brand} className="border-t border-slate-100">
                                <td className="max-w-[90px] truncate px-1.5 py-1 text-[12px] text-slate-600">
                                  <Tooltip content={brand} block className="truncate">
                                    {brand}
                                  </Tooltip>
                                </td>
                                {allRangeColumns.map((col) => {
                                  const activeToday = brandPlatforms.filter(
                                    (p) => scheduleFor(preview.scheduleRows, t, brand, col.weekStartISO, p)?.[col.weekday] === 'active',
                                  );
                                  return (
                                    <td key={col.iso} className="px-0.5 py-1 text-center">
                                      <span className="flex flex-wrap items-center justify-center gap-0.5">
                                        {activeToday.map((p) => (
                                          <span
                                            key={p}
                                            className={`inline-flex items-center gap-0.5 rounded-[2px] px-0.5 text-[7px] font-bold leading-tight ${PLATFORM_BADGE[p].className}`}
                                          >
                                            <img
                                              src={PLATFORM_FAVICON[p]}
                                              alt={PLATFORM_BADGE[p].label}
                                              className="size-2 rounded-[1px]"
                                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                            {PLATFORM_BADGE[p].label}
                                          </span>
                                        ))}
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })
```

Replace it with:

```tsx
                          previewBrands.map((brand) => {
                            const brandPlatforms = resolveBrandPlatforms(
                              t, brand, preview.activePlatforms, preview.hiddenSet, preview.restrictionMap, preview.removedSet,
                            );
                            const brandKey = normalizeBrandKey(brand);
                            return (
                              <tr key={brand} className="border-t border-slate-100">
                                <td className="max-w-[90px] truncate px-1.5 py-1 text-[12px] text-slate-600">
                                  <Tooltip content={brand} block className="truncate">
                                    {brand}
                                  </Tooltip>
                                </td>
                                {allRangeColumns.map((col) => {
                                  const isPast = col.iso < todayISO;
                                  const planActive = (p: Platform) =>
                                    scheduleFor(preview.scheduleRows, t, brand, col.weekStartISO, p)?.[col.weekday] === 'active';
                                  // Past days require real evidence to show a normal chip at all
                                  // (regardless of what the plan said); today/future days stay
                                  // plan-only, since the day hasn't happened yet.
                                  const executed = brandPlatforms.filter((p) =>
                                    isPast ? hasDateEvidence(preview.dateStatusIndex, brandKey, p, col.iso) : planActive(p),
                                  );
                                  // A past day the plan called active but no entry ever confirmed —
                                  // a real operational miss, shown distinctly rather than silently
                                  // dropped (a day with no plan and no evidence renders nothing, same
                                  // as it always has).
                                  const missed = isPast
                                    ? brandPlatforms.filter((p) => planActive(p) && !hasDateEvidence(preview.dateStatusIndex, brandKey, p, col.iso))
                                    : [];
                                  return (
                                    <td key={col.iso} className="px-0.5 py-1 text-center">
                                      <span className="flex flex-wrap items-center justify-center gap-0.5">
                                        {executed.map((p) => (
                                          <span
                                            key={p}
                                            className={`inline-flex items-center gap-0.5 rounded-[2px] px-0.5 text-[7px] font-bold leading-tight ${PLATFORM_BADGE[p].className}`}
                                          >
                                            <img
                                              src={PLATFORM_FAVICON[p]}
                                              alt={PLATFORM_BADGE[p].label}
                                              className="size-2 rounded-[1px]"
                                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                            {PLATFORM_BADGE[p].label}
                                          </span>
                                        ))}
                                        {missed.map((p) => (
                                          <Tooltip key={p} content="Planned — no confirmed activity found">
                                            <span className="inline-flex items-center rounded-[2px] border border-dashed border-slate-300 px-0.5 text-[7px] font-bold leading-tight text-slate-400">
                                              {PLATFORM_BADGE[p].label}
                                            </span>
                                          </Tooltip>
                                        ))}
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })
```

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Type-check via build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/pages/SchedulePlanner.tsx
git commit -m "feat: show executed-only chips and a missed-day marker in the Schedule Planner landing grid"
```

---

### Task 5: Manual/browser verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (leave running).

- [ ] **Step 2: Sign in and open Schedule Planner**

Use the credentials already in this repo's `.env` (`CAPTURE_EMAIL` / `CAPTURE_PASSWORD` — see `feedback_no_login_credentials_this_env` memory: these work and have been used successfully before) to log in, then navigate to `/schedule-planner` with no tab selected (landing-grid view).

- [ ] **Step 3: Verify past-day evidence gating on the count strip**

Pick a past date range (the From/To date pickers in the toolbar) that you know contains real logged activity for at least one brand on at least one platform (check `docs/task-history.md` or any tab's entries for a Live/Removed/Pending/Done status with a date in that range). Confirm the platform-count strip's numbers reflect only that real activity — not the full raw plan count for that range.

- [ ] **Step 4: Verify the "missed" chip**

Within that same past range, find (or set up, then revert) a brand/day where `brand_schedule` has an `active` plan entry but no matching Live/Removed/Pending/Done evidence exists for that exact date. Confirm its cell shows the greyed/dashed "missed" chip (not the normal colored chip, not blank), and that hovering it shows the tooltip "Planned — no confirmed activity found."

- [ ] **Step 5: Verify today/future days are unaffected**

With no date filter set (default "this week" view) or a future date range selected, confirm chips render exactly as they did before this change — plan-only, no "missed" markers.

- [ ] **Step 6: Verify the detailed per-tab calendar is untouched**

Click into any brand tab (leaving landing-grid mode). Confirm `ScheduleCell`'s existing ghosting/Confirmed/Removed/Pending/Done badge behavior looks exactly as it did before this change.

- [ ] **Step 7: Record the result**

Note the outcome (pass/fail, and what was checked) in `docs/task-history.md` per this project's standing PMS/task-history workflow.
