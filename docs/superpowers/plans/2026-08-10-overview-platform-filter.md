# Overview Platform Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Platform filter (TP / AG / CG / WO) to Overview's top filter row so its KPI cards, "Brands Performance" grid, Platform Breakdown donut, and Country/Proxy breakdowns can all be scoped to a single review platform.

**Architecture:** `computeTabKpisFromEntries` (`src/lib/queries.ts`) gains an optional `platformFilter?: Platform` parameter. When set, it returns `null` for any tab that doesn't track that platform (checked via its own locally-resolved `activePlatforms`, not the static `getTabPlatforms`), and otherwise recomputes `live`/`removed`/`total`/`byCountry`/`byProxy` using only that platform's status/date columns instead of today's OR-across-all-platforms logic. `Overview.tsx` adds a `platformFilter` URL-param-backed state, threads it into every `fetchTabKpis` call, drops `null` results before rendering, renders a `BrandFilterDropdown` pill for it (first in the filter row), and hides the Platform Breakdown donut section whenever a specific platform is selected.

**Tech Stack:** React 19, TypeScript strict mode, Vitest, Supabase.

## Global Constraints

- TypeScript strict mode; no `any` without a comment explaining why (project standard).
- Verify with `npm run build`, not `tsc --noEmit` alone — this repo's root tsconfig is references-only and `tsc --noEmit` checks nothing meaningful.
- `platformFilter` omitted from any call must produce byte-for-byte identical output to the current (pre-change) behavior — every existing caller of `computeTabKpisFromEntries`/`fetchTabKpis` must keep working with zero changes.
- No localStorage persistence for this filter — Overview's existing Country/Proxy/Date Range filters are URL-param-only with no localStorage restore behavior, and Platform should match that, not Score Summary's separate localStorage pattern.
- Spec: `docs/superpowers/specs/2026-08-10-overview-platform-filter-design.md`.

---

### Task 1: `computeTabKpisFromEntries` / `fetchTabKpis` — platform scoping

**Files:**
- Modify: `src/lib/queries.ts:370-528`
- Test: `src/lib/queries.test.ts` (append to the existing `describe('computeTabKpisFromEntries', ...)` block, which currently ends at line 316)

**Interfaces:**
- Consumes: `Platform` type (already imported in `queries.ts:8` from `./removedPlatformBrands.ts`); `passesPlatformDateFilter` (already imported `queries.ts:4`); `platformRemovedKey` (already imported `queries.ts:8`, used in tests via `./removedPlatformBrands.ts`).
- Produces: `computeTabKpisFromEntries(entries, rawHeaders, tab, brandCol, dateFrom, dateTo, removedPlatformBrands, countryFilter?, proxyFilter?, platformFilter?: Platform): TabKpis | null` — new 10th parameter, new nullable return type. `fetchTabKpis(tab, dateFrom?, dateTo?, removedPlatformBrands?, countryFilter?, proxyFilter?, platformFilter?: Platform): Promise<TabKpis | null>` — same new param, same new return type. Task 2 depends on both of these exact signatures.

- [ ] **Step 1: Write the failing tests**

Open `src/lib/queries.test.ts` and add these four tests immediately before the closing `});` of the `describe('computeTabKpisFromEntries', ...)` block (currently line 316):

```ts
  it('returns null when platformFilter names a platform the tab has no column for', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
    ];
    // `rawHeaders` (line 123) has no CG column at all -- this tab structurally
    // can't track CasinoGuru.
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, 'cg');
    expect(kpis).toBeNull();
  });

  it('platformFilter scopes live/removed/total to only that platform, ignoring other platforms on the same row', () => {
    const rawHeadersMulti = ['Brands', 'Trust Pilot', 'TP Review Status', 'Casino Guru review added', 'CG Review Status'];
    const multiEntry = {
      id: '1', tab: 'Rooster Partners', sheet_row_id: '1',
      data: {
        'Brands': 'Multi Brand',
        'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed',
        'Casino Guru review added': '15/06/2026', 'CG Review Status': 'Published',
      },
      updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard' as const, last_sync_tag: null,
    };

    // No filter: today's existing OR-across-platforms aggregate counts the
    // row once as live, because CG's live status wins over TP's removed
    // status on the same row -- this is the exact ambiguity the filter
    // exists to resolve.
    const unfiltered = computeTabKpisFromEntries([multiEntry], rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', new Set());
    expect(unfiltered).not.toBeNull();
    expect(unfiltered!.live).toBe(1);
    expect(unfiltered!.removed).toBe(0);

    // Filtered to TP only: the row's true TP status (Removed) surfaces.
    const tpOnly = computeTabKpisFromEntries([multiEntry], rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, 'tp');
    expect(tpOnly).not.toBeNull();
    expect(tpOnly!.live).toBe(0);
    expect(tpOnly!.removed).toBe(1);
    expect(tpOnly!.total).toBe(1);

    // Filtered to CG only: the row's true CG status (Published/live) surfaces.
    const cgOnly = computeTabKpisFromEntries([multiEntry], rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, 'cg');
    expect(cgOnly).not.toBeNull();
    expect(cgOnly!.live).toBe(1);
    expect(cgOnly!.removed).toBe(0);
    expect(cgOnly!.total).toBe(1);
  });

  it('platformFilter scopes byCountry/byProxy to only rows that have a value on that platform', () => {
    const rawHeadersMulti = ['Brands', 'Trust Pilot', 'TP Review Status', 'Casino Guru review added', 'CG Review Status', 'Country'];
    const entries = [
      {
        id: '1', tab: 'Rooster Partners', sheet_row_id: '1',
        data: { 'Brands': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'Germany' },
        updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard' as const, last_sync_tag: null,
      },
      {
        id: '2', tab: 'Rooster Partners', sheet_row_id: '2',
        data: { 'Brands': 'B', 'Casino Guru review added': '15/06/2026', 'CG Review Status': 'Published', 'Country': 'France' },
        updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard' as const, last_sync_tag: null,
      },
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, 'cg');
    expect(kpis).not.toBeNull();
    // Only entry 2 (France) has a CG value -- entry 1 (Germany) is TP-only
    // and must not appear in a CG-scoped breakdown at all.
    expect(kpis!.byCountry).toEqual({ FR: { label: 'France', live: 1, removed: 0 } });
    expect(kpis!.live).toBe(1);
    expect(kpis!.removed).toBe(0);
  });

  it('platformFilter still respects the per-platform removed-brand flag', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Flagged Brand', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed' }),
    ];
    const flagged = new Set([platformRemovedKey('TP Affiliate', 'Flagged Brand', 'tp')]);
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', flagged, undefined, undefined, 'tp');
    expect(kpis).not.toBeNull();
    expect(kpis!.live).toBe(0);
    expect(kpis!.removed).toBe(0);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/queries.test.ts`
Expected: the 4 new tests FAIL (TypeScript will also complain that `computeTabKpisFromEntries` doesn't accept a 10th argument, and that the return value can't be compared to `null` since the current return type is `TabKpis`, not `TabKpis | null`) — every other test in the file still passes.

- [ ] **Step 3: Implement `platformFilter` in `computeTabKpisFromEntries`**

In `src/lib/queries.ts`, make these edits:

1. Change the function signature (currently lines 370-380) to add the parameter and nullable return type:

```ts
export function computeTabKpisFromEntries(
  entries: Entry[],
  rawHeaders: string[],
  tab: string,
  brandCol: string,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  removedPlatformBrands: Set<string>,
  countryFilter?: string,
  proxyFilter?: string,
  platformFilter?: Platform,
): TabKpis | null {
```

2. Immediately after the four `resolveHeader(...)` calls (currently lines 391-395, resolving `tpCol`/`agCol`/`cgCol`/`woCol`/`genericCol`), insert the `activePlatforms` computation (moved up from its current location at the end of the function, lines 488-492) and the new early-exit check:

```ts
  const activePlatforms: ('tp' | 'ag' | 'cg' | 'wo')[] = [];
  if (tpCol) activePlatforms.push('tp');
  if (agCol) activePlatforms.push('ag');
  if (cgCol) activePlatforms.push('cg');
  if (woCol) activePlatforms.push('wo');

  if (platformFilter && !activePlatforms.includes(platformFilter)) {
    return null;
  }
```

3. Delete the now-duplicate `activePlatforms` block that currently sits at the end of the function (lines 488-492, right before the `return` statement) — it's been moved up in step 2 above. The `return` object's `activePlatforms,` field (currently line 506) stays as-is, now referencing the earlier-computed variable.

4. Replace the `statuses` construction (currently lines 463-469, the array literal built from `tpDateOk && !isPlatformFlagged('tp') ? tp : ''` etc.) with a branch that scopes to a single platform when `platformFilter` is set:

```ts
    const platformValue: Record<'tp' | 'ag' | 'cg' | 'wo', string> = { tp, ag, cg, wo };
    const platformDateOk: Record<'tp' | 'ag' | 'cg' | 'wo', boolean> = { tp: tpDateOk, ag: agDateOk, cg: cgDateOk, wo: woDateOk };

    const statuses: string[] = platformFilter
      ? (platformDateOk[platformFilter] && !isPlatformFlagged(platformFilter) ? [platformValue[platformFilter]] : [])
      : [
          tpDateOk && !isPlatformFlagged('tp') ? tp : '',
          agDateOk && !isPlatformFlagged('ag') ? ag : '',
          cgDateOk && !isPlatformFlagged('cg') ? cg : '',
          woDateOk && !isPlatformFlagged('wo') ? wo : '',
          genericInRange ? generic : '',
        ].filter(Boolean);
```

The `if (statuses.length > 0) { ... }` block right after this (currently lines 471-485) is untouched — it already just consumes the `statuses` array generically.

- [ ] **Step 4: Update `fetchTabKpis`**

In `src/lib/queries.ts`, change the wrapper (currently lines 514-528):

```ts
export async function fetchTabKpis(
  tab: string,
  dateFrom?: string,
  dateTo?: string,
  removedPlatformBrands: Set<string> = new Set(),
  countryFilter?: string,
  proxyFilter?: string,
  platformFilter?: Platform,
): Promise<TabKpis | null> {
  const [allEntries, rawHeaders] = await Promise.all([
    fetchAllTabEntries(tab),
    fetchTabHeaders(tab),
  ]);
  const brandCol = getBrandNameCol(tab);
  return computeTabKpisFromEntries(allEntries, rawHeaders, tab, brandCol, dateFrom, dateTo, removedPlatformBrands, countryFilter, proxyFilter, platformFilter);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/lib/queries.test.ts`
Expected: PASS — all tests in the file, including the 4 new ones and every pre-existing one (the pre-existing ones call the function without a 10th argument, so `platformFilter` is `undefined` and they exercise the unchanged `else` branch of the new `statuses` logic — this is the regression lock proving `platformFilter` omitted behaves identically to before).

- [ ] **Step 6: Full-suite check and commit**

Run: `npm test`
Expected: PASS (no test outside `queries.test.ts` calls either function, so nothing else should be affected, but confirm).

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: scope computeTabKpisFromEntries/fetchTabKpis to a single platform"
```

---

### Task 2: Overview.tsx — Platform filter UI and wiring

**Files:**
- Modify: `src/pages/Overview.tsx`

**Interfaces:**
- Consumes: `fetchTabKpis(tab, dateFrom?, dateTo?, removedPlatformBrands?, countryFilter?, proxyFilter?, platformFilter?: Platform): Promise<TabKpis | null>` from Task 1. `Platform` type from `../lib/removedPlatformBrands` (not yet imported in this file). `BrandFilterDropdown` component (already imported, `Overview.tsx:11`) — signature `{ value: string; onChange: (v: string) => void; brands: string[]; noun?: string }`.
- Produces: nothing consumed by other tasks — this is the final task in the feature.

- [ ] **Step 1: Add the `Platform` type import and a validation set**

In `src/pages/Overview.tsx`, change line 20 from:

```ts
import { buildRemovedPlatformBrandSet } from '../lib/removedPlatformBrands';
```

to:

```ts
import { buildRemovedPlatformBrandSet, type Platform } from '../lib/removedPlatformBrands';
```

Then, right after the `EMPTY_KPIS` constant (currently ending at line 71), add:

```ts
const PLATFORM_VALUES = new Set<string>(['tp', 'ag', 'cg', 'wo']);
```

- [ ] **Step 2: Add `platformFilter` state, backed by the URL**

In `src/pages/Overview.tsx`, right after the existing filter reads (currently lines 418-421: `dateFrom`/`dateTo`/`countryFilter`/`proxyFilter`), add:

```ts
  const platformParam = searchParams.get('platform');
  const platformFilter: 'all' | Platform = PLATFORM_VALUES.has(platformParam ?? '') ? (platformParam as Platform) : 'all';
```

- [ ] **Step 3: Thread `platformFilter` into `loadData` and drop tabs that don't track it**

In `src/pages/Overview.tsx`, change the `loadData` callback (currently lines 423-440):

```ts
  const loadData = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const removedPlatformBrands = await fetchRemovedPlatformBrands()
        .then(buildRemovedPlatformBrandSet)
        .catch(() => new Set<string>());
      const tabResults = (await Promise.all(
        OPERATIONAL_TABS.map((tab) =>
          fetchTabKpis(
            tab,
            dateFrom || undefined,
            dateTo || undefined,
            removedPlatformBrands,
            countryFilter || undefined,
            proxyFilter || undefined,
            platformFilter === 'all' ? undefined : platformFilter,
          )
            .then((kpis): TabSummary | null => (kpis ? { tab, kpis } : null))
            .catch((): TabSummary => ({ tab, kpis: EMPTY_KPIS }))
        )
      )).filter((r): r is TabSummary => r !== null);
      setState({ loading: false, error: null, tabs: tabResults });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, [dateFrom, dateTo, countryFilter, proxyFilter, platformFilter]);
```

(Only the `Promise.all(...)` assignment, the added `.filter(...)`, the new `platformFilter` argument, and the dependency array changed — the `try`/`catch` structure and the error path are unchanged.)

- [ ] **Step 4: Add a `setPlatformFilter` helper**

In `src/pages/Overview.tsx`, right after the existing `updateFilterParam` function (currently lines 499-505), add:

```ts
  function setPlatformFilter(v: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set('platform', v); else next.delete('platform');
      return next;
    }, { replace: true });
  }
```

- [ ] **Step 5: Render the Platform dropdown, first in the filter row**

In `src/pages/Overview.tsx`, the filter row currently opens like this (lines 566-567):

```tsx
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 shrink-0">Date Range</span>
```

Change it to insert the Platform control and a divider before the Date Range label:

```tsx
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 shrink-0">Platform</span>
        <BrandFilterDropdown
          noun="platform"
          value={platformFilter === 'all' ? '' : platformFilter.toUpperCase()}
          onChange={(v) => setPlatformFilter(v.toLowerCase())}
          brands={['TP', 'AG', 'CG', 'WO']}
        />
        <span className="mx-1 hidden sm:inline text-xs font-medium text-slate-300">|</span>

        <span className="text-xs font-medium text-slate-500 shrink-0">Date Range</span>
```

- [ ] **Step 6: Extend the Clear button**

In `src/pages/Overview.tsx`, the Clear button's visibility condition and handler (currently lines 607-615) are:

```tsx
        {(dateActive || countryFilter || proxyFilter) && (
          <button
            type="button"
            onClick={() => { setDateFrom(''); setDateTo(''); clearCountryProxyFilters(); }}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50"
          >
            Clear
          </button>
        )}
```

Change to:

```tsx
        {(dateActive || countryFilter || proxyFilter || platformFilter !== 'all') && (
          <button
            type="button"
            onClick={() => { setDateFrom(''); setDateTo(''); clearCountryProxyFilters(); setPlatformFilter(''); }}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50"
          >
            Clear
          </button>
        )}
```

- [ ] **Step 7: Hide the Platform Breakdown donut section when a platform is selected**

In `src/pages/Overview.tsx`, the donut section currently starts and ends like this (lines 726-761):

```tsx
      {/* Platform breakdown chart */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-800">Platform Breakdown</h2>
          <p className="mt-0.5 text-xs text-slate-400">Published vs. removed per platform</p>
        </div>
        {state.loading ? (
          ...
        ) : (
          ...
        )}
      </section>
```

Wrap the whole `<section>...</section>` in a condition:

```tsx
      {/* Platform breakdown chart -- redundant once scoped to one platform */}
      {platformFilter === 'all' && (
        <section>
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-800">Platform Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-400">Published vs. removed per platform</p>
          </div>
          {state.loading ? (
            ...
          ) : (
            ...
          )}
        </section>
      )}
```

(Indent the section's existing inner contents by two spaces to stay valid JSX; contents are otherwise unchanged.)

- [ ] **Step 8: Build check**

Run: `npm run build`
Expected: succeeds with no TypeScript errors. (This repo's `tsc --noEmit` alone doesn't check anything meaningful — the build is the real check.)

- [ ] **Step 9: Commit**

```bash
git add src/pages/Overview.tsx
git commit -m "feat: add Platform filter to Overview tab"
```

---

### Task 3: Full verification pass

**Files:** none (verification only).

**Interfaces:** none — this task only runs checks, it doesn't produce anything for another task.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, full suite (no regressions anywhere else in the app).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Live verification**

In the running app (`npm run dev`), on the Overview page:
- Confirm the Platform dropdown renders first in the filter row, defaulting to "All platforms".
- Select TP, then AG, then CG, then WO in turn: confirm the "Brands Performance" grid only shows tabs whose platform badges (already rendered per tab, `Overview.tsx:697-702`) include the selected platform; confirm the 3 global KPI cards and Country/Proxy breakdown numbers change accordingly; confirm the Platform Breakdown donut section disappears while any specific platform is selected.
- Select "All platforms" again (or hit Clear): confirm every tab reappears, the donut section reappears, and the numbers return to their pre-filter values.
- Reload the page with `?platform=cg` in the URL directly: confirm it opens already scoped to CasinoGuru.
- Confirm Country/Proxy dropdown option lists stay full (not narrowed) regardless of the Platform selection.

- [ ] **Step 4: Cross-dashboard consistency check**

Per this project's standing requirement, confirm this change didn't touch or regress Score Summary's (`ScoreSummaryPanel.tsx`) or Brand Tabs' (`BrandGroup.tsx`) own independent platform filters — `git diff main` should show changes only in `src/lib/queries.ts`, `src/lib/queries.test.ts`, and `src/pages/Overview.tsx`.
