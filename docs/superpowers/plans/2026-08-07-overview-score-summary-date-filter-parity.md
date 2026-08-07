# Overview / Score Summary Date-Filter Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Overview dashboard's per-tab Live/Removed/Total counts agree with Score Summary's Published/Removed/Total counts for the same tab, platform, and date range, by replacing Overview's single cross-platform date filter with the same per-platform date-key check Score Summary already uses.

**Architecture:** Add one new exported function, `passesPlatformDateFilter`, to `src/lib/scoreSummary.ts` (the file that already owns `PLATFORM_DATE_KEYS` and the "undated rows are always included" policy). Extract `fetchTabKpis`'s counting logic in `src/lib/queries.ts` into a pure, directly-testable `computeTabKpisFromEntries` function and rewrite it to gate each platform's (tp/ag/cg/wo) live/removed tally — and the tab-level aggregate — using that shared function instead of one row-level date picked from an unrelated cross-platform fallback chain. Then point `src/pages/BrandGroup.tsx`'s own per-platform KPI cards at the same shared function so all three surfaces (Overview, Score Summary, Brand Tabs) can never diverge again.

**Tech Stack:** TypeScript, Vitest, React 19, Supabase (Postgres), Deno (this repo's `queries.ts` is also imported directly by the `generate-weekly-schedule` Supabase Edge Function — see Global Constraints).

## Global Constraints

- Every cross-file import inside `src/lib/queries.ts` must use an explicit `.ts` extension (e.g. `from './scoreSummary.ts'`, not `from './scoreSummary'`) — this file is imported unbundled by a Deno Edge Function (`supabase/functions/generate-weekly-schedule/index.ts`), and Deno resolves relative imports literally, with no bundler to paper over a missing extension.
- Do not change `removedPlatformBrands` exclusion behavior, `isLiveStatus`/`isRemovedStatus`/`isDoneStatus`/`isPendingStatus`/`isOnPauseStatus`/`isNotDoneStatus` classification, or any status-column resolution (`tpCol`/`agCol`/`cgCol`/`woCol`/`genericCol`) — only the date-range gating changes in this plan.
- Preserve `TabKpis`'s existing shape (`src/types/brand-entry.ts`) — no new/renamed fields.
- Run the full suite (`npm test`) after every task; it must stay green throughout.

---

### Task 1: Add `passesPlatformDateFilter` to scoreSummary.ts

**Files:**
- Modify: `src/lib/scoreSummary.ts` (add exported function after `passesDateFilter`, around line 214)
- Test: `src/lib/scoreSummary.test.ts`

**Interfaces:**
- Consumes: existing private `passesDateFilter(data, dateKeys, fromBound, toBound)` (scoreSummary.ts:200), existing private `startOfDay`/`endOfDay` (scoreSummary.ts:185-190), existing exported `PLATFORM_DATE_KEYS` (scoreSummary.ts:72-77), existing exported `isoToDate(s: string): Date | null` (scoreSummary.ts:543-546), existing exported `Platform` type.
- Produces: `export function passesPlatformDateFilter(data: Record<string, string | null>, platform: Platform, fromISO?: string, toISO?: string): boolean` — later tasks (fetchTabKpis, BrandGroup.tsx) import this exact name and signature from `'./scoreSummary.ts'` / `'../lib/scoreSummary'`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scoreSummary.test.ts` (find the existing `describe` blocks and add a new one; import `passesPlatformDateFilter` alongside whatever is already imported from `'./scoreSummary'` at the top of the file):

```ts
import { passesPlatformDateFilter } from './scoreSummary';

describe('passesPlatformDateFilter', () => {
  it('includes a row whose platform-specific date falls inside the range', () => {
    const data = { 'Trust Pilot': '10/06/2026' };
    expect(passesPlatformDateFilter(data, 'tp', '2026-05-01', '2026-07-31')).toBe(true);
  });

  it('excludes a row whose platform-specific date falls outside the range', () => {
    const data = { 'Trust Pilot': '10/01/2026' };
    expect(passesPlatformDateFilter(data, 'tp', '2026-05-01', '2026-07-31')).toBe(false);
  });

  it('always includes a row with no date for that platform, even when the range would otherwise exclude it', () => {
    const data: Record<string, string | null> = { 'Trust Pilot': null };
    expect(passesPlatformDateFilter(data, 'tp', '2026-05-01', '2026-07-31')).toBe(true);
  });

  it('checks only the requested platform\'s own date key, not another platform\'s', () => {
    // Ask Gambler's date is outside the range, but we're asking about 'cg',
    // whose own key ('Casino Guru review added') is unset on this row — must
    // not fall back to AG's value or any other column.
    const data = {
      'Ask Gambler review added': '10/01/2026',
      'Casino Guru review added': null,
    };
    expect(passesPlatformDateFilter(data, 'cg', '2026-05-01', '2026-07-31')).toBe(true);
  });

  it('includes everything when no range is set', () => {
    const data = { 'Trust Pilot': '10/01/2020' };
    expect(passesPlatformDateFilter(data, 'tp', undefined, undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run scoreSummary`
Expected: FAIL — `passesPlatformDateFilter` is not exported from `./scoreSummary`.

- [ ] **Step 3: Implement `passesPlatformDateFilter`**

In `src/lib/scoreSummary.ts`, immediately after the closing brace of `passesDateFilter` (the function ending just before `export function computeScoreSummary` at line 216), add:

```ts
// Ranged, ISO-string-based sibling of passesDateFilter, for callers that hold
// plain 'YYYY-MM-DD' strings (Overview's fetchTabKpis, BrandGroup.tsx's KPI
// cards) rather than pre-parsed Date bounds — the single source of truth for
// "is this row, for THIS platform, inside the selected date range", so
// Overview/BrandGroup/Score Summary can no longer each answer that question
// their own slightly-different way.
export function passesPlatformDateFilter(
  data: Record<string, string | null>,
  platform: Platform,
  fromISO?: string,
  toISO?: string,
): boolean {
  const fromDate = fromISO ? isoToDate(fromISO) : null;
  const toDate = toISO ? isoToDate(toISO) : null;
  const fromBound = fromDate ? startOfDay(fromDate) : null;
  const toBound = toDate ? endOfDay(toDate) : null;
  return passesDateFilter(data, PLATFORM_DATE_KEYS[platform], fromBound, toBound);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run scoreSummary`
Expected: PASS (all `scoreSummary.test.ts` tests, including the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoreSummary.ts src/lib/scoreSummary.test.ts
git commit -m "feat: add passesPlatformDateFilter, a shared per-platform date-range check"
```

---

### Task 2: Rewrite fetchTabKpis to gate each platform by its own date key

**Files:**
- Modify: `src/lib/queries.ts:338-436` (the `fetchTabKpis` function)
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `passesPlatformDateFilter` from Task 1 (`'./scoreSummary.ts'`), existing `platformRemovedKey`/`Platform` (already imported in queries.ts from `'./removedPlatformBrands.ts'`), existing `TabKpis` type, existing local `isLiveStatus`/`isRemovedStatus`/`isDoneStatus`/`isPendingStatus`/`isOnPauseStatus`/`isNotDoneStatus` (queries.ts:326-336, unchanged), existing `inDateRange` from `'./dateUtils.ts'` (kept for one narrow fallback — see Step 3).
- Produces: `export function computeTabKpisFromEntries(entries: Entry[], rawHeaders: string[], tab: string, brandCol: string, dateFrom: string | undefined, dateTo: string | undefined, removedPlatformBrands: Set<string>): TabKpis` — a new pure export, callable directly from tests without mocking Supabase. `fetchTabKpis`'s existing public signature (`fetchTabKpis(tab, dateFrom?, dateTo?, removedPlatformBrands?): Promise<TabKpis>`) is unchanged — Overview.tsx needs no changes.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/queries.test.ts`. This file currently only mocks `./supabase` for a different test group — add a new, self-contained `describe` block that imports the new pure function directly (no Supabase mocking needed, since `computeTabKpisFromEntries` takes entries/headers as plain arguments):

```ts
import { computeTabKpisFromEntries } from './queries';
import { computeTabSuccessRates } from './scoreSummary';
import type { Entry } from '../types/entry';

function entry(id: string, data: Record<string, string | null>): Entry {
  return { id, tab: 'TP Affiliate', sheet_row_id: id, data, updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard', last_sync_tag: null };
}

describe('computeTabKpisFromEntries', () => {
  const rawHeaders = ['URL PAGE', 'Trust Pilot', 'TP Review Status'];

  it('excludes a row whose TP date falls outside the range, and includes one whose TP date falls inside it', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
      entry('2', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': '10/01/2026', 'TP Review Status': 'Removed' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    expect(kpis.tp).toEqual({ live: 1, removed: 0 });
    expect(kpis).toMatchObject({ live: 1, removed: 0, total: 1 });
  });

  it('always counts a Removed row with no TP date at all, regardless of the selected range (regression: previously dropped entirely)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': null, 'TP Review Status': 'Removed' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    expect(kpis.tp).toEqual({ live: 0, removed: 1 });
    expect(kpis.removed).toBe(1);
  });

  it('agrees with Score Summary\'s computeTabSuccessRates on the same entries, platform, and range', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
      entry('2', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': '10/01/2026', 'TP Review Status': 'Removed' }),
      entry('3', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': null, 'TP Review Status': 'Removed' }),
      entry('4', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': '15/07/2026', 'TP Review Status': 'Live' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());

    const rates = computeTabSuccessRates(
      entries.map((e) => ({ tab: e.tab, data: e.data })) as Parameters<typeof computeTabSuccessRates>[0],
      'tp',
      new Set(),
      { from: new Date(2026, 4, 1), to: new Date(2026, 6, 31) },
    );
    const scoreSummaryTp = rates.get('TP Affiliate') ?? { live: 0, removed: 0 };

    // Entry 2's TP date (Jan) is genuinely outside the range, so both
    // implementations correctly exclude it — only entry 3 (undated) and
    // entries 1/4 (in-range) should count: live 2 (entries 1, 4), removed 1
    // (entry 3 only; entry 2 is excluded, not counted as removed).
    expect(kpis.tp).toEqual({ live: scoreSummaryTp.live, removed: scoreSummaryTp.removed });
    expect(kpis.tp).toEqual({ live: 2, removed: 1 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run queries`
Expected: FAIL — `computeTabKpisFromEntries` is not exported from `./queries`.

- [ ] **Step 3: Implement `computeTabKpisFromEntries` and rewrite `fetchTabKpis`**

In `src/lib/queries.ts`:

1. Add to the top-of-file imports (near the existing `import { inDateRange } from './dateUtils.ts';` on line 3):

```ts
import { passesPlatformDateFilter } from './scoreSummary.ts';
```

2. Replace the entire body of `fetchTabKpis` (queries.ts:338-436) with:

```ts
export function computeTabKpisFromEntries(
  entries: Entry[],
  rawHeaders: string[],
  tab: string,
  brandCol: string,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  removedPlatformBrands: Set<string>,
): TabKpis {
  // Resolve the actual sheet column name case-insensitively so minor casing
  // differences between tabs don't cause zeroed-out counts.
  function resolveHeader(...variants: string[]): string | null {
    for (const v of variants) {
      const found = rawHeaders.find((h) => h.toLowerCase() === v.toLowerCase());
      if (found) return found;
    }
    return null;
  }

  const tpCol = resolveHeader('TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status');
  const agCol = resolveHeader('AG Review Status');
  const cgCol = resolveHeader('CG Review Status');
  const woCol = resolveHeader('WoO Review Status');
  const genericCol = resolveHeader('Review Status', 'status', 'Status');

  let live = 0, removed = 0, done = 0, pending = 0, onPause = 0, notDone = 0;
  let tpLive = 0, tpRemoved = 0;
  let agLive = 0, agRemoved = 0;
  let cgLive = 0, cgRemoved = 0;
  let woLive = 0, woRemoved = 0;

  for (const entry of entries) {
    const d = entry.data;
    const tp = tpCol ? (d[tpCol] ?? '').toLowerCase() : '';
    const ag = agCol ? (d[agCol] ?? '').toLowerCase() : '';
    const cg = cgCol ? (d[cgCol] ?? '').toLowerCase() : '';
    const wo = woCol ? (d[woCol] ?? '').toLowerCase() : '';
    const generic = (!tp && !ag && !cg && !wo && genericCol) ? (d[genericCol] ?? '').toLowerCase() : '';

    // A brand whose page on a given platform has been delisted entirely
    // shouldn't count toward that platform's Live/Removed total — matches the
    // same exclusion applied in Score Summary and BrandGroup's platform KPI
    // cards, independently per platform (a TP-removed brand can still count
    // normally toward AG/CG/WO, and vice versa).
    const brand = (d[brandCol] ?? '').trim();
    const isPlatformFlagged = (platform: Platform) =>
      brand !== '' && removedPlatformBrands.has(platformRemovedKey(tab, brand, platform));

    // Each platform's status is only tallied — for that platform's own
    // breakdown AND for the tab-level aggregate below — when it falls inside
    // the selected range according to THAT platform's own date column
    // (passesPlatformDateFilter), exactly like Score Summary. A row with no
    // date for a platform still counts (undated rows are always included —
    // same reasoning as scoreSummary.ts's passesDateFilter). This replaces the
    // old behavior of picking one date per row from an unrelated cross-tab
    // fallback chain (dateUtils.ts's inDateRange) and using it to gate every
    // platform's tally at once, which is what let Overview and Score Summary
    // disagree on the same tab/platform/range.
    const tpInRange = !!tp && !isPlatformFlagged('tp') && passesPlatformDateFilter(d, 'tp', dateFrom, dateTo);
    const agInRange = !!ag && !isPlatformFlagged('ag') && passesPlatformDateFilter(d, 'ag', dateFrom, dateTo);
    const cgInRange = !!cg && !isPlatformFlagged('cg') && passesPlatformDateFilter(d, 'cg', dateFrom, dateTo);
    const woInRange = !!wo && !isPlatformFlagged('wo') && passesPlatformDateFilter(d, 'wo', dateFrom, dateTo);
    // No per-platform date key exists for a bare/unresolved generic status
    // column (genericCol only fires when none of tp/ag/cg/wo resolved on this
    // tab at all) — keep the old cross-platform-fallback behavior for this one
    // narrow, currently-unused-by-any-real-tab case rather than inventing a
    // new policy for it.
    const genericInRange = !!generic && ((!dateFrom && !dateTo) || inDateRange(d, dateFrom ?? '', dateTo ?? ''));

    if (tpInRange) { if (isLiveStatus(tp)) tpLive++; else if (isRemovedStatus(tp)) tpRemoved++; }
    if (agInRange) { if (isLiveStatus(ag)) agLive++; else if (isRemovedStatus(ag)) agRemoved++; }
    if (cgInRange) { if (isLiveStatus(cg)) cgLive++; else if (isRemovedStatus(cg)) cgRemoved++; }
    if (woInRange) { if (isLiveStatus(wo)) woLive++; else if (isRemovedStatus(wo)) woRemoved++; }

    const statuses = [
      tpInRange ? tp : '',
      agInRange ? ag : '',
      cgInRange ? cg : '',
      woInRange ? wo : '',
      genericInRange ? generic : '',
    ].filter(Boolean);

    if (statuses.length > 0) {
      if (statuses.some(isLiveStatus)) live++;
      else if (statuses.some(isRemovedStatus)) removed++;
      else if (statuses.some(isDoneStatus)) done++;
      else if (statuses.some(isPendingStatus)) pending++;
      else if (statuses.some(isOnPauseStatus)) onPause++;
      else if (statuses.some(isNotDoneStatus)) notDone++;
    }
  }

  const activePlatforms: ('tp' | 'ag' | 'cg' | 'wo')[] = [];
  if (tpCol) activePlatforms.push('tp');
  if (agCol) activePlatforms.push('ag');
  if (cgCol) activePlatforms.push('cg');
  if (woCol) activePlatforms.push('wo');

  return {
    total: live + removed,
    live,
    removed,
    done,
    pending,
    onPause,
    notDone,
    tp: { live: tpLive, removed: tpRemoved },
    ag: { live: agLive, removed: agRemoved },
    cg: { live: cgLive, removed: cgRemoved },
    wo: { live: woLive, removed: woRemoved },
    activePlatforms,
  };
}

export async function fetchTabKpis(
  tab: string,
  dateFrom?: string,
  dateTo?: string,
  removedPlatformBrands: Set<string> = new Set(),
): Promise<TabKpis> {
  const [allEntries, rawHeaders] = await Promise.all([
    fetchAllTabEntries(tab),
    fetchTabHeaders(tab),
  ]);
  const brandCol = getBrandNameCol(tab);
  return computeTabKpisFromEntries(allEntries, rawHeaders, tab, brandCol, dateFrom, dateTo, removedPlatformBrands);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run queries`
Expected: PASS (all `queries.test.ts` tests, including the 3 new ones).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, all files (no other file references `fetchTabKpis`'s internals, so this should not affect other suites).

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "fix: gate fetchTabKpis's per-platform tallies by each platform's own date key"
```

---

### Task 3: Point BrandGroup.tsx's platform KPI cards at the same shared check

**Files:**
- Modify: `src/pages/BrandGroup.tsx` (imports near the top, and `countPlatform` at lines 1470-1490)

**Interfaces:**
- Consumes: `passesPlatformDateFilter` from Task 1 (`'../lib/scoreSummary'`).
- Produces: no new exports — `displayKpis`'s `tp`/`ag`/`cg` counts (BrandGroup.tsx:1489) now use the same per-platform date policy as Overview and Score Summary, closing the last of the three divergent implementations for the values that actually get compared against Score Summary. (Wizard of Odds has no platform-filter dropdown option and no card in `PLATFORM_CARDS`, so `countPlatform` is never called with `'wo'` today — out of scope, unchanged.)

**Why this task is still needed after Task 2:** `displayKpis.tp/ag/cg` (BrandGroup's own on-page KPI cards) are computed from `kpiBase`, which is date-filtered once per row by `applyDateFilter` (BrandGroup.tsx:1448-1463). That function already checks a single platform's own date column when `platformFilter !== 'all'` — but when `platformFilter === 'all'` (the default view, and the only view on a single-platform tab, which has no platform dropdown at all) it falls back to `inDateRangeInclusive`, a per-row cross-platform date pick identical in kind to the one just removed from `fetchTabKpis`. On a multi-platform tab's default ('all') view, that one shared date can gate all three platform cards even though the CG card should really be judged by the row's Casino Guru date, not whichever column `inDateRangeInclusive`'s fallback chain happened to pick.

- [ ] **Step 1: Add the import**

In `src/pages/BrandGroup.tsx`, find the existing import block at the top of the file (it already imports several helpers from `'../lib/scoreSummary'` — search for `from '../lib/scoreSummary'`) and add `passesPlatformDateFilter` to that same import statement's named list.

- [ ] **Step 2: Rewrite `countPlatform` to date-filter per platform directly**

Locate `countPlatform` inside the `displayKpis` block (BrandGroup.tsx:1471-1490):

```ts
  const displayKpis = (() => {
    function countPlatform(key: 'tp' | 'ag' | 'cg') {
      const statusCol = key === 'tp'
        ? (headers.find((h) => TP_STATUS_VARIANTS.has(h)) ?? null)
        : (headers.find((h) => h.toLowerCase() === PLATFORM_STATUS_COL[key].toLowerCase()) ?? null);
      if (!statusCol) return { live: 0, removed: 0 };
      let live = 0, removed = 0;
      for (const e of kpiBase) {
        // A brand whose page on THIS platform has been delisted entirely
        // shouldn't count toward this card's Live/Removed totals — independent
        // per platform, matching the same exclusion applied in Score Summary.
        if (brandCol && isPlatformRemoved(e.data[brandCol], key)) continue;
        const v = (e.data[statusCol] ?? '').toLowerCase();
        if (isLive(v)) live++;
        else if (isRemoved(v)) removed++;
      }
      return { live, removed };
    }
    return { tp: countPlatform('tp'), ag: countPlatform('ag'), cg: countPlatform('cg') };
  })();
```

Replace it with a version that runs over `ratingFiltered` (the pre-date-filtered row set — the same input `kpiBase` itself is derived from, see BrandGroup.tsx:1467) and applies `passesPlatformDateFilter` for that specific platform, instead of relying on `kpiBase`'s single shared per-row date decision:

```ts
  const displayKpis = (() => {
    function countPlatform(key: 'tp' | 'ag' | 'cg') {
      const statusCol = key === 'tp'
        ? (headers.find((h) => TP_STATUS_VARIANTS.has(h)) ?? null)
        : (headers.find((h) => h.toLowerCase() === PLATFORM_STATUS_COL[key].toLowerCase()) ?? null);
      if (!statusCol) return { live: 0, removed: 0 };
      let live = 0, removed = 0;
      for (const e of ratingFiltered) {
        // A brand whose page on THIS platform has been delisted entirely
        // shouldn't count toward this card's Live/Removed totals — independent
        // per platform, matching the same exclusion applied in Score Summary.
        if (brandCol && isPlatformRemoved(e.data[brandCol], key)) continue;
        if (dateActive && !passesPlatformDateFilter(e.data, key, dateFrom, dateTo)) continue;
        const v = (e.data[statusCol] ?? '').toLowerCase();
        if (isLive(v)) live++;
        else if (isRemoved(v)) removed++;
      }
      return { live, removed };
    }
    return { tp: countPlatform('tp'), ag: countPlatform('ag'), cg: countPlatform('cg') };
  })();
```

(`ratingFiltered`, `dateActive`, `dateFrom`, `dateTo` are all already in scope at this point in the component — `ratingFiltered` is defined above at BrandGroup.tsx:~1420, `dateActive` at BrandGroup.tsx:1446, `dateFrom`/`dateTo` are the component's existing date-range state.)

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS. (BrandGroup.tsx has no dedicated unit test file today, so this step relies on the full suite not regressing elsewhere — this is a pre-existing gap in this file's coverage, not one this plan is scoped to close.)

- [ ] **Step 4: Run the build**

Run: `npm run build`
Expected: PASS with no new TypeScript errors (this repo's root `tsconfig.json` is references-only, so `npm run build` — not `tsc --noEmit` — is the real type-check).

- [ ] **Step 5: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "fix: gate Brand Tabs' per-platform KPI cards by each platform's own date key"
```

---

### Task 4: Deno safety check and final whole-branch review

**Files:** none modified — verification only.

- [ ] **Step 1: Confirm the Deno Edge Function that imports queries.ts still type-checks**

Run from the repo root:

```bash
deno check --no-lock --node-modules-dir=none --config supabase/functions/generate-weekly-schedule/deno.json supabase/functions/generate-weekly-schedule/index.ts
```

Expected: no errors. (This edge function imports `src/lib/queries.ts` unbundled — Task 2 added a new same-repo import to that file, so this confirms the new `from './scoreSummary.ts'` import and everything it pulls in transitively still resolve and type-check under Deno, not just under Vite/tsc.)

- [ ] **Step 2: Run the full test suite one more time**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 3: Run the build one more time**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manually sanity-check the numbers this plan exists to fix**

This repo has no Supabase credentials available in most implementer sessions (see `CLAUDE.md`'s recurring "no DB credential available" notes) — if this session has one, load the app, set the Overview date range to match a Score Summary query for the same tab (e.g. FTP / TrustPilot, 01/05/2026–31/07/2026, the exact case that motivated this plan), and confirm the Overview card's live/removed now match Score Summary's Published/Removed. If no credential is available, state that explicitly rather than claiming this was verified live — the unit tests in Tasks 1-2 are the evidence in that case.

- [ ] **Step 5: Final commit (if any cleanup was needed) and hand back**

If Steps 1-4 required no code changes, there is nothing further to commit — report the branch (`fix-date-filter-mismatch`) and worktree path (`.worktrees/fix-date-filter-mismatch`) ready for the user to review and merge.
