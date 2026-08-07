# Overview Country & Proxy Filter + Breakdown Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Country and Proxy as global filters on the Overview page, plus two new "Country Breakdown" / "Proxy Breakdown" donut-card sections mirroring the existing "Platform Breakdown" section.

**Architecture:** `computeTabKpisFromEntries` (`src/lib/queries.ts`) gains optional `countryFilter`/`proxyFilter` params that pre-filter entries before all existing counting (so every existing Overview number — KPI cards, per-tab tiles, Platform Breakdown — automatically respects them), plus new `byCountry`/`byProxy` breakdown maps and unfiltered `countries`/`proxies` distinct-value lists, all returned on `TabKpis`. `Overview.tsx` merges these across tabs with new pure helpers in `src/lib/overviewBreakdown.ts`, renders a new filter row using a `BrandFilterDropdown` component extracted from `BrandGroup.tsx`, and renders the two new sections via a new shared `BreakdownDonutCard` component (also used to de-duplicate the existing Platform Breakdown cards). The existing platform slice-detail modal is generalized to a dimension-agnostic `SliceBreakdownModal` so Platform/Country/Proxy sections all reuse one modal instead of three near-identical copies.

**Tech Stack:** Vite 6 · React 19 · TypeScript · Tailwind v4 · React Router v7 · Recharts · Vitest

## Global Constraints

- TypeScript strict mode. No `any` unless commented why.
- Verify with `npm run build` (`tsc -b && vite build`) — plain `tsc --noEmit` checks nothing in this repo (root tsconfig is references-only).
- Run `npm test` (`vitest run`) after every task that touches tested logic.
- Country/Proxy filter matching is case-insensitive, exact-match, trimmed (matches `BrandGroup.tsx`'s existing Country/Proxy filter behavior).
- Blank/unresolvable Country or Proxy values are excluded from their own breakdown map, not bucketed as "Unknown" — they still count toward every other existing total.
- Dropdown option lists (`countries`/`proxies`) are built from unfiltered entries — they never shrink/reorder as other filters are applied.
- No schema changes. No behavior change to `BrandGroup.tsx`'s own Country/Proxy filtering beyond extracting `BrandFilterDropdown` into a shared, non-behavioral component.

Spec: `docs/superpowers/specs/2026-08-07-overview-country-proxy-filter-design.md`

---

## File Structure

- **Create** `src/components/BrandFilterDropdown.tsx` — extracted from `BrandGroup.tsx`, no behavior change.
- **Modify** `src/pages/BrandGroup.tsx` — remove local `BrandFilterDropdown`, import the shared one.
- **Modify** `src/types/brand-entry.ts` — add `CountBreakdown`, extend `TabKpis`.
- **Modify** `src/lib/queries.ts` — `computeTabKpisFromEntries` + `fetchTabKpis` gain filtering/breakdown support.
- **Modify** `src/lib/queries.test.ts` — new tests for the above.
- **Create** `src/lib/overviewBreakdown.ts` — pure cross-tab merge/grouping helpers.
- **Create** `src/lib/overviewBreakdown.test.ts` — tests for the above.
- **Create** `src/components/BreakdownDonutCard.tsx` — shared donut card, extracted from Overview's existing Platform Breakdown card markup.
- **Modify** `src/pages/Overview.tsx` — filter row, generalized modal, Platform Breakdown refactored onto the shared card, two new sections.

---

### Task 1: Extract `BrandFilterDropdown` into a shared component

**Files:**
- Create: `src/components/BrandFilterDropdown.tsx`
- Modify: `src/pages/BrandGroup.tsx:388-476` (delete), `src/pages/BrandGroup.tsx:1-7` (import)
- Test: none new — this is a behavior-preserving refactor, verified via existing build/test suite

**Interfaces:**
- Produces: `export default function BrandFilterDropdown({ value, onChange, brands, noun }: { value: string; onChange: (v: string) => void; brands: string[]; noun?: string })` — used by Task 4.

- [ ] **Step 1: Create the shared component file**

Create `src/components/BrandFilterDropdown.tsx` with exactly this content (copied verbatim from `BrandGroup.tsx:388-476`, with its own imports):

```tsx
import { useState, useRef, useEffect } from 'react';
import { Search, X, Check, ChevronDown } from 'lucide-react';

export default function BrandFilterDropdown({ value, onChange, brands, noun = 'brand' }: {
  value: string; onChange: (v: string) => void; brands: string[]; noun?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const visible = search.trim()
    ? brands.filter((b) => b.toLowerCase().includes(search.toLowerCase()))
    : brands;

  const active = !!value;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
          active
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50'
        }`}
      >
        {active && <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />}
        <span className="max-w-[9rem] truncate">{active ? value : `All ${noun}s`}</span>
        {active ? (
          <span onClick={(e) => { e.stopPropagation(); onChange(''); }} className="ml-0.5 text-blue-400 hover:text-blue-600 transition-colors">
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className={`size-3 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
            <Search className="size-3.5 shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${noun}s…`}
              className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none"
            />
            {search && <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600"><X className="size-3" /></button>}
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${!value ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-600'}`}
            >
              <span className="flex-1">{`All ${noun}s`}</span>
              {!value && <Check className="size-3 text-blue-500" />}
            </button>
            {visible.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">No {noun}s match</div>
            )}
            {visible.map((brand) => (
              <button
                key={brand}
                type="button"
                onClick={() => { onChange(brand); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${brand === value ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-600'}`}
              >
                <span className="flex-1 truncate">{brand}</span>
                {brand === value && <Check className="size-3 text-blue-500" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Remove the local definition from `BrandGroup.tsx`**

Delete lines 388-476 of `src/pages/BrandGroup.tsx` (the `function BrandFilterDropdown({ ... }) { ... }` block you just copied — it ends right before the `const PLATFORM_FAVICON` constant).

- [ ] **Step 3: Import the shared component in `BrandGroup.tsx`**

Add this import near the other component imports (after the `AccountUsageBadges` import, `src/pages/BrandGroup.tsx:15`):

```tsx
import BrandFilterDropdown from '../components/BrandFilterDropdown';
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (in particular, no "BrandFilterDropdown is declared but never used" or missing-import errors).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (this is a pure move, no behavior change).

- [ ] **Step 6: Commit**

```bash
git add src/components/BrandFilterDropdown.tsx src/pages/BrandGroup.tsx
git commit -m "refactor: extract BrandFilterDropdown into a shared component"
```

---

### Task 2: Extend `TabKpis` with Country/Proxy filtering and breakdown data

**Files:**
- Modify: `src/types/brand-entry.ts`
- Modify: `src/lib/queries.ts` (imports near line 5, `computeTabKpisFromEntries` at line 339, `fetchTabKpis` at line 459)
- Modify: `src/pages/Overview.tsx` (`EMPTY_KPIS` at line 50)
- Test: `src/lib/queries.test.ts` (append to the `describe('computeTabKpisFromEntries', ...)` block starting at line 149)

**Interfaces:**
- Produces: `CountBreakdown { label: string; live: number; removed: number }` (exported from `src/types/brand-entry.ts`), and `TabKpis.byCountry`, `TabKpis.byProxy`, `TabKpis.countries`, `TabKpis.proxies`. `computeTabKpisFromEntries(entries, rawHeaders, tab, brandCol, dateFrom, dateTo, removedPlatformBrands, countryFilter?, proxyFilter?)`. `fetchTabKpis(tab, dateFrom?, dateTo?, removedPlatformBrands?, countryFilter?, proxyFilter?)`. Used by Task 3 (`CountBreakdown` type) and Task 4 (the two new `fetchTabKpis` params, and `TabKpis.countries`/`.proxies`/`.byCountry`/`.byProxy`).

- [ ] **Step 1: Write the failing tests**

Append these tests inside the existing `describe('computeTabKpisFromEntries', ...)` block in `src/lib/queries.test.ts` (right before its closing `});` at line 223):

```ts
  it('countryFilter narrows results to only entries whose Country matches, case-insensitively', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'germany' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'France' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), 'Germany');
    expect(kpis.live).toBe(2);
    expect(kpis.removed).toBe(0);
  });

  it('proxyFilter narrows results to only entries whose Proxy Used matches, case-insensitively and trimmed', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': ' Enigma-US1 ' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'enigma-us1' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Proxy Used': 'Enigma-US2' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, 'Enigma-US1');
    expect(kpis.live).toBe(2);
    expect(kpis.removed).toBe(0);
  });

  it('countryFilter and proxyFilter compose (AND), same as with dateFrom/dateTo', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany', 'Proxy Used': 'Enigma-US2' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'France', 'Proxy Used': 'Enigma-US1' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), 'Germany', 'Enigma-US1');
    expect(kpis.live).toBe(1);
  });

  it('byCountry buckets live/removed per country case-insensitively, keeping first-seen display casing, and skips entries with no resolvable country (they still count toward the tab total)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'germany' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': '' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    expect(kpis.byCountry).toEqual({ germany: { label: 'Germany', live: 1, removed: 1 } });
    expect(kpis.live).toBe(2);
    expect(kpis.removed).toBe(1);
  });

  it('byProxy buckets live/removed per proxy and skips entries with a blank Proxy Used value', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Proxy Used': '' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    expect(kpis.byProxy).toEqual({ 'enigma-us1': { label: 'Enigma-US1', live: 1, removed: 0 } });
  });

  it('countries and proxies distinct lists are built from unfiltered entries, independent of any active country/proxy filter', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'France', 'Proxy Used': 'Enigma-US2' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), 'Germany');
    expect(kpis.countries).toEqual(['France', 'Germany']);
    expect(kpis.proxies).toEqual(['Enigma-US1', 'Enigma-US2']);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: FAIL — `computeTabKpisFromEntries` doesn't yet accept a `countryFilter`/`proxyFilter` argument and `TabKpis` has no `byCountry`/`byProxy`/`countries`/`proxies` (TypeScript compile errors and/or `undefined` assertions).

- [ ] **Step 3: Add `CountBreakdown` and extend `TabKpis` in `src/types/brand-entry.ts`**

Replace the file's `TabKpis` interface (currently lines 17-30) with:

```ts
export interface CountBreakdown {
  label: string;
  live: number;
  removed: number;
}

export interface TabKpis {
  total: number;
  live: number;
  removed: number;
  done: number;
  pending: number;
  onPause: number;
  notDone: number;
  tp: PlatformKpis;
  ag: PlatformKpis;
  cg: PlatformKpis;
  wo: PlatformKpis;
  activePlatforms: ('tp' | 'ag' | 'cg' | 'wo')[];
  byCountry: Record<string, CountBreakdown>;
  byProxy: Record<string, CountBreakdown>;
  countries: string[];
  proxies: string[];
}
```

- [ ] **Step 4: Import `getEntryCountry` and `CountBreakdown` in `src/lib/queries.ts`**

In the import block at the top of `src/lib/queries.ts`, change line 5:

```ts
import { getTabColumns, getBrandNameCol } from './tab-configs.ts';
```
to:
```ts
import { getTabColumns, getBrandNameCol, getEntryCountry } from './tab-configs.ts';
```

And change line 11:
```ts
import type { BrandEntry, TabKpis } from '../types/brand-entry.ts';
```
to:
```ts
import type { BrandEntry, TabKpis, CountBreakdown } from '../types/brand-entry.ts';
```

- [ ] **Step 5: Add helper functions above `computeTabKpisFromEntries`**

Immediately above `export function computeTabKpisFromEntries(` (`src/lib/queries.ts:339`), add:

```ts
function uniqueDisplayValues(raw: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const v of raw) {
    const trimmed = (v ?? '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

function addToBreakdown(map: Record<string, CountBreakdown>, rawValue: string | null | undefined, kind: 'live' | 'removed') {
  const trimmed = (rawValue ?? '').trim();
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  if (!map[key]) map[key] = { label: trimmed, live: 0, removed: 0 };
  map[key][kind]++;
}
```

- [ ] **Step 6: Update `computeTabKpisFromEntries`'s signature and body**

Change the signature (`src/lib/queries.ts:339-347`):

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
```
to:
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
): TabKpis {
```

Right after the `resolveHeader`/column-resolution block and before the counters (`let live = 0, removed = 0, ...` at line 364), insert:

```ts
  const filteredEntries = (countryFilter || proxyFilter)
    ? entries.filter((e) => {
        if (countryFilter && getEntryCountry(e.data, tab).toLowerCase() !== countryFilter.toLowerCase()) return false;
        if (proxyFilter && (e.data['Proxy Used'] ?? '').trim().toLowerCase() !== proxyFilter.toLowerCase()) return false;
        return true;
      })
    : entries;

  const countries = uniqueDisplayValues(entries.map((e) => getEntryCountry(e.data, tab)));
  const proxies = uniqueDisplayValues(entries.map((e) => e.data['Proxy Used']));
  const byCountry: Record<string, CountBreakdown> = {};
  const byProxy: Record<string, CountBreakdown> = {};
```

Change the main loop line (`for (const entry of entries) {` at line 370) to:

```ts
  for (const entry of filteredEntries) {
```

Change the live/removed classification block (`src/lib/queries.ts:427-434`):

```ts
    if (statuses.length > 0) {
      if (statuses.some(isLiveStatus)) live++;
      else if (statuses.some(isRemovedStatus)) removed++;
      else if (statuses.some(isDoneStatus)) done++;
      else if (statuses.some(isPendingStatus)) pending++;
      else if (statuses.some(isOnPauseStatus)) onPause++;
      else if (statuses.some(isNotDoneStatus)) notDone++;
    }
```
to:
```ts
    if (statuses.length > 0) {
      if (statuses.some(isLiveStatus)) {
        live++;
        addToBreakdown(byCountry, getEntryCountry(d, tab), 'live');
        addToBreakdown(byProxy, d['Proxy Used'], 'live');
      } else if (statuses.some(isRemovedStatus)) {
        removed++;
        addToBreakdown(byCountry, getEntryCountry(d, tab), 'removed');
        addToBreakdown(byProxy, d['Proxy Used'], 'removed');
      }
      else if (statuses.some(isDoneStatus)) done++;
      else if (statuses.some(isPendingStatus)) pending++;
      else if (statuses.some(isOnPauseStatus)) onPause++;
      else if (statuses.some(isNotDoneStatus)) notDone++;
    }
```

Finally, add the four new fields to the return object (`src/lib/queries.ts:443-456`):

```ts
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
    byCountry,
    byProxy,
    countries,
    proxies,
  };
```

- [ ] **Step 7: Update `fetchTabKpis`**

Change (`src/lib/queries.ts:459-471`):

```ts
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
to:
```ts
export async function fetchTabKpis(
  tab: string,
  dateFrom?: string,
  dateTo?: string,
  removedPlatformBrands: Set<string> = new Set(),
  countryFilter?: string,
  proxyFilter?: string,
): Promise<TabKpis> {
  const [allEntries, rawHeaders] = await Promise.all([
    fetchAllTabEntries(tab),
    fetchTabHeaders(tab),
  ]);
  const brandCol = getBrandNameCol(tab);
  return computeTabKpisFromEntries(allEntries, rawHeaders, tab, brandCol, dateFrom, dateTo, removedPlatformBrands, countryFilter, proxyFilter);
}
```

- [ ] **Step 8: Update `Overview.tsx`'s `EMPTY_KPIS`**

Change (`src/pages/Overview.tsx:50-57`):

```ts
const EMPTY_KPIS: TabKpis = {
  total: 0, live: 0, removed: 0, done: 0, pending: 0, onPause: 0, notDone: 0,
  tp: { live: 0, removed: 0 },
  ag: { live: 0, removed: 0 },
  cg: { live: 0, removed: 0 },
  wo: { live: 0, removed: 0 },
  activePlatforms: [],
};
```
to:
```ts
const EMPTY_KPIS: TabKpis = {
  total: 0, live: 0, removed: 0, done: 0, pending: 0, onPause: 0, notDone: 0,
  tp: { live: 0, removed: 0 },
  ag: { live: 0, removed: 0 },
  cg: { live: 0, removed: 0 },
  wo: { live: 0, removed: 0 },
  activePlatforms: [],
  byCountry: {},
  byProxy: {},
  countries: [],
  proxies: [],
};
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: PASS (all tests in the file, including the 6 new ones).

- [ ] **Step 10: Verify the full build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 11: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no regressions in `scoreSummary.test.ts` or elsewhere that construct a `TabKpis` literal — if any do, add the same 4 empty-default fields there too).

- [ ] **Step 12: Commit**

```bash
git add src/types/brand-entry.ts src/lib/queries.ts src/lib/queries.test.ts src/pages/Overview.tsx
git commit -m "feat: add country/proxy filtering and breakdown data to computeTabKpisFromEntries"
```

---

### Task 3: Add pure cross-tab merge/grouping helpers

**Files:**
- Create: `src/lib/overviewBreakdown.ts`
- Test: Create `src/lib/overviewBreakdown.test.ts`

**Interfaces:**
- Consumes: `CountBreakdown` from `src/types/brand-entry.ts` (Task 2).
- Produces: `mergeBreakdownMaps(maps: Record<string, CountBreakdown>[]): Record<string, CountBreakdown>`, `interface BreakdownCard { key: string; label: string; live: number; removed: number; isOther: boolean }`, `topNWithOther(merged: Record<string, CountBreakdown>, topN: number): BreakdownCard[]`, `mergeDistinctValues(lists: string[][]): string[]` — all used by Task 6 (`mergeBreakdownMaps`/`topNWithOther`) and Task 4 (`mergeDistinctValues`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/overviewBreakdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeBreakdownMaps, topNWithOther, mergeDistinctValues } from './overviewBreakdown';
import type { CountBreakdown } from '../types/brand-entry';

describe('mergeBreakdownMaps', () => {
  it('sums live/removed across maps that share a key, keeping the first label seen', () => {
    const a: Record<string, CountBreakdown> = { germany: { label: 'Germany', live: 2, removed: 1 } };
    const b: Record<string, CountBreakdown> = { germany: { label: 'germany', live: 3, removed: 0 } };
    const merged = mergeBreakdownMaps([a, b]);
    expect(merged).toEqual({ germany: { label: 'Germany', live: 5, removed: 1 } });
  });

  it('keeps disjoint keys from different tabs separate', () => {
    const a: Record<string, CountBreakdown> = { germany: { label: 'Germany', live: 1, removed: 0 } };
    const b: Record<string, CountBreakdown> = { france: { label: 'France', live: 0, removed: 2 } };
    const merged = mergeBreakdownMaps([a, b]);
    expect(merged).toEqual({
      germany: { label: 'Germany', live: 1, removed: 0 },
      france: { label: 'France', live: 0, removed: 2 },
    });
  });

  it('returns an empty object for an empty input list', () => {
    expect(mergeBreakdownMaps([])).toEqual({});
  });
});

describe('topNWithOther', () => {
  it('returns all cards, no "Other", when there are fewer than or equal to topN distinct values', () => {
    const merged: Record<string, CountBreakdown> = {
      germany: { label: 'Germany', live: 5, removed: 1 },
      france: { label: 'France', live: 2, removed: 0 },
    };
    const cards = topNWithOther(merged, 8);
    expect(cards).toEqual([
      { key: 'germany', label: 'Germany', live: 5, removed: 1, isOther: false },
      { key: 'france', label: 'France', live: 2, removed: 0, isOther: false },
    ]);
  });

  it('sorts by total volume descending', () => {
    const merged: Record<string, CountBreakdown> = {
      small: { label: 'Small', live: 1, removed: 0 },
      big: { label: 'Big', live: 10, removed: 5 },
    };
    const cards = topNWithOther(merged, 8);
    expect(cards.map((c) => c.key)).toEqual(['big', 'small']);
  });

  it('collapses the remainder past topN into a single non-"Other"-flagged-false-elsewhere "Other" card, summed correctly', () => {
    const merged: Record<string, CountBreakdown> = {
      a: { label: 'A', live: 10, removed: 0 },
      b: { label: 'B', live: 9, removed: 0 },
      c: { label: 'C', live: 1, removed: 1 },
      d: { label: 'D', live: 1, removed: 0 },
    };
    const cards = topNWithOther(merged, 2);
    expect(cards).toEqual([
      { key: 'a', label: 'A', live: 10, removed: 0, isOther: false },
      { key: 'b', label: 'B', live: 9, removed: 0, isOther: false },
      { key: '__other__', label: 'Other', live: 2, removed: 1, isOther: true },
    ]);
  });

  it('returns an empty array for an empty input map', () => {
    expect(topNWithOther({}, 8)).toEqual([]);
  });
});

describe('mergeDistinctValues', () => {
  it('dedupes case-insensitively across lists, keeping first-seen casing, sorted alphabetically', () => {
    const merged = mergeDistinctValues([['Germany', 'France'], ['germany', 'Spain']]);
    expect(merged).toEqual(['France', 'Germany', 'Spain']);
  });

  it('returns an empty array when given no lists or only empty lists', () => {
    expect(mergeDistinctValues([])).toEqual([]);
    expect(mergeDistinctValues([[], []])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/overviewBreakdown.test.ts`
Expected: FAIL — `./overviewBreakdown` does not exist yet.

- [ ] **Step 3: Implement `src/lib/overviewBreakdown.ts`**

```ts
import type { CountBreakdown } from '../types/brand-entry';

export function mergeBreakdownMaps(maps: Record<string, CountBreakdown>[]): Record<string, CountBreakdown> {
  const merged: Record<string, CountBreakdown> = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      if (!merged[key]) merged[key] = { label: value.label, live: 0, removed: 0 };
      merged[key].live += value.live;
      merged[key].removed += value.removed;
    }
  }
  return merged;
}

export interface BreakdownCard {
  key: string;
  label: string;
  live: number;
  removed: number;
  isOther: boolean;
}

export function topNWithOther(merged: Record<string, CountBreakdown>, topN: number): BreakdownCard[] {
  const all: BreakdownCard[] = Object.entries(merged)
    .map(([key, v]) => ({ key, label: v.label, live: v.live, removed: v.removed, isOther: false }))
    .sort((a, b) => (b.live + b.removed) - (a.live + a.removed));

  const top = all.slice(0, topN);
  const rest = all.slice(topN);
  if (rest.length === 0) return top;

  const other: BreakdownCard = {
    key: '__other__',
    label: 'Other',
    live: rest.reduce((s, r) => s + r.live, 0),
    removed: rest.reduce((s, r) => s + r.removed, 0),
    isOther: true,
  };
  return [...top, other];
}

export function mergeDistinctValues(lists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const v of list) {
      const trimmed = v.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) seen.set(key, trimmed);
    }
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/overviewBreakdown.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/overviewBreakdown.ts src/lib/overviewBreakdown.test.ts
git commit -m "feat: add pure cross-tab breakdown merge/grouping helpers"
```

---

### Task 4: Add Country/Proxy filter controls to Overview.tsx

**Files:**
- Modify: `src/pages/Overview.tsx` (imports at line 1-13, `loadData`/state near lines 293-320, JSX near line 359)

**Interfaces:**
- Consumes: `BrandFilterDropdown` (Task 1), `mergeDistinctValues` (Task 3), `fetchTabKpis`'s new `countryFilter`/`proxyFilter` params (Task 2).
- Produces: URL search params `country`/`proxy`, consumed by nothing else yet — Task 6 will read `countryFilter`/`proxyFilter` local variables this task introduces.

- [ ] **Step 1: Update imports**

Change line 1 of `src/pages/Overview.tsx`:
```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
```
to:
```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
```

Add two new import lines after the existing `import { fetchTabKpis, fetchRemovedPlatformBrands } from '../lib/queries';` (line 10):
```tsx
import BrandFilterDropdown from '../components/BrandFilterDropdown';
import { mergeDistinctValues } from '../lib/overviewBreakdown';
```

(The `type ReactNode` import is unused until Task 5 — that's expected and will not cause a build error, since it's a type-only import.)

- [ ] **Step 2: Read country/proxy from the URL and pass them into the fetch**

Change (`src/pages/Overview.tsx:293-318`):

```tsx
export default function Overview() {
  const [state, setState] = useState<State>(initial);
  const [kpiModal, setKpiModal] = useState<KpiModalState | null>(null);
  const [platformSliceModal, setPlatformSliceModal] = useState<PlatformSliceModalState | null>(null);
  const [searchParams] = useSearchParams();
  const dateFrom = searchParams.get('from') ?? '';
  const dateTo   = searchParams.get('to')   ?? '';

  const loadData = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const removedPlatformBrands = await fetchRemovedPlatformBrands()
        .then(buildRemovedPlatformBrandSet)
        .catch(() => new Set<string>());
      const tabResults = await Promise.all(
        OPERATIONAL_TABS.map((tab) =>
          fetchTabKpis(tab, dateFrom || undefined, dateTo || undefined, removedPlatformBrands)
            .then((kpis): TabSummary => ({ tab, kpis }))
            .catch((): TabSummary => ({ tab, kpis: EMPTY_KPIS }))
        )
      );
      setState({ loading: false, error: null, tabs: tabResults });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, [dateFrom, dateTo]);
```
to:
```tsx
export default function Overview() {
  const [state, setState] = useState<State>(initial);
  const [kpiModal, setKpiModal] = useState<KpiModalState | null>(null);
  const [platformSliceModal, setPlatformSliceModal] = useState<PlatformSliceModalState | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const dateFrom = searchParams.get('from') ?? '';
  const dateTo   = searchParams.get('to')   ?? '';
  const countryFilter = searchParams.get('country') ?? '';
  const proxyFilter   = searchParams.get('proxy')   ?? '';

  const loadData = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const removedPlatformBrands = await fetchRemovedPlatformBrands()
        .then(buildRemovedPlatformBrandSet)
        .catch(() => new Set<string>());
      const tabResults = await Promise.all(
        OPERATIONAL_TABS.map((tab) =>
          fetchTabKpis(tab, dateFrom || undefined, dateTo || undefined, removedPlatformBrands, countryFilter || undefined, proxyFilter || undefined)
            .then((kpis): TabSummary => ({ tab, kpis }))
            .catch((): TabSummary => ({ tab, kpis: EMPTY_KPIS }))
        )
      );
      setState({ loading: false, error: null, tabs: tabResults });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, [dateFrom, dateTo, countryFilter, proxyFilter]);
```

- [ ] **Step 3: Compute merged dropdown option lists**

Directly after the `const totalRemoved = ...` line (`src/pages/Overview.tsx:332`), add:

```tsx
  const allCountries = mergeDistinctValues(state.tabs.map((t) => t.kpis.countries));
  const allProxies   = mergeDistinctValues(state.tabs.map((t) => t.kpis.proxies));

  function updateFilterParam(key: 'country' | 'proxy', value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  }

  function clearCountryProxyFilters() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('country');
      next.delete('proxy');
      return next;
    }, { replace: true });
  }
```

- [ ] **Step 4: Render the filter row**

In the JSX, change the opening of the returned `<div>` (`src/pages/Overview.tsx:358-360`):

```tsx
  return (
    <div className="space-y-8">

      {/* Global KPIs */}
```
to:
```tsx
  return (
    <div className="space-y-8">

      {(allCountries.length > 1 || allProxies.length > 1) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Filters</span>
          {allCountries.length > 1 && (
            <BrandFilterDropdown
              noun="countrie"
              value={countryFilter}
              onChange={(v) => updateFilterParam('country', v)}
              brands={allCountries}
            />
          )}
          {allProxies.length > 1 && (
            <BrandFilterDropdown
              noun="proxie"
              value={proxyFilter}
              onChange={(v) => updateFilterParam('proxy', v)}
              brands={allProxies}
            />
          )}
          {(countryFilter || proxyFilter) && (
            <button
              type="button"
              onClick={clearCountryProxyFilters}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Global KPIs */}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Overview.tsx
git commit -m "feat: add Country/Proxy filter row to Overview"
```

---

### Task 5: Generalize the platform slice modal into a dimension-agnostic `SliceBreakdownModal`

**Files:**
- Modify: `src/pages/Overview.tsx` (`PlatformSliceModalState`/`PlatformBreakdownModal` at lines 88-101 and 192-287, its state/usage at lines 296, 391, 557, 567, 591-596)

**Interfaces:**
- Produces: `interface SliceModalState { title: string; headerIcon: ReactNode; rowIcon: ReactNode; kind: 'live' | 'removed'; rows: { tab: string; count: number }[]; linkFor: (tab: string) => string }` and `function SliceBreakdownModal({ modal, onClose }: { modal: SliceModalState; onClose: () => void })` — used by Task 6 for the Country/Proxy sections, and by this task's own updated Platform Breakdown click handlers.

- [ ] **Step 1: Replace `PlatformSliceModalState` with `SliceModalState`**

Change (`src/pages/Overview.tsx:97-101`):
```tsx
interface PlatformSliceModalState {
  platform: string;
  platformKey: PlatformKey;
  kind: 'live' | 'removed';
}
```
to:
```tsx
interface SliceModalState {
  title: string;
  headerIcon: ReactNode;
  rowIcon: ReactNode;
  kind: 'live' | 'removed';
  rows: { tab: string; count: number }[];
  linkFor: (tab: string) => string;
}
```

- [ ] **Step 2: Replace `PlatformBreakdownModal` with `SliceBreakdownModal`**

Replace the entire `PlatformBreakdownModal` function (`src/pages/Overview.tsx:192-287`) with:

```tsx
function SliceBreakdownModal({
  modal,
  onClose,
}: {
  modal: SliceModalState;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = modal.rows
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const grandTotal = rows.reduce((s, r) => s + r.count, 0);
  const isLive = modal.kind === 'live';
  const barColor = isLive ? 'bg-emerald-500' : 'bg-rose-500';
  const valueColor = isLive ? 'text-emerald-600' : 'text-rose-600';
  const kindLabel = isLive ? 'Published' : 'Removed';

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl mx-4">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {modal.headerIcon}
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                {modal.title} — {kindLabel}
              </p>
            </div>
            <p className={`text-2xl font-bold font-mono tabular-nums ${valueColor}`}>{grandTotal.toLocaleString()}</p>
            <p className="mt-1 text-xs text-slate-400">{kindLabel} reviews by brand tab</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
          {rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No data</p>
          ) : rows.map((r) => {
            const pct = grandTotal > 0 ? (r.count / grandTotal) * 100 : 0;
            return (
              <Link
                key={r.tab}
                to={modal.linkFor(r.tab)}
                onClick={onClose}
                className="group -mx-3 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-blue-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 min-w-0">
                      {modal.rowIcon}
                      <span className="truncate text-sm font-medium text-slate-700 transition-colors group-hover:text-blue-700">{tabDisplayName(r.tab)}</span>
                    </span>
                    <span className={`ml-2 shrink-0 text-sm font-bold font-mono tabular-nums ${valueColor}`}>{r.count.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100">
                    <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update the component's state, add an `openPlatformSlice` helper, and rewire the Pie/legend click handlers to use it**

Change the state declaration (`src/pages/Overview.tsx:296`):
```tsx
  const [platformSliceModal, setPlatformSliceModal] = useState<PlatformSliceModalState | null>(null);
```
to:
```tsx
  const [sliceModal, setSliceModal] = useState<SliceModalState | null>(null);
```

Add this helper function right after `updateFilterParam`/`clearCountryProxyFilters` (added in Task 4, Step 3) — it builds the modal state once so the Pie's `onClick` and both legend buttons can share it instead of repeating the same object construction three times:
```tsx
  function openPlatformSlice(platformName: string, kind: 'live' | 'removed') {
    const platformKey = PLATFORM_KEY[platformName];
    const displayName = platformName === 'WizardOfOdds' ? 'Wizard of Odds' : platformName;
    setSliceModal({
      title: displayName,
      headerIcon: <img src={PLATFORM_LOGOS[platformName]} alt={platformName} className="size-4 rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />,
      rowIcon: <img src={PLATFORM_LOGOS[platformName]} alt={platformName} className="size-3.5 shrink-0 rounded-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />,
      kind,
      rows: state.tabs.map((t) => ({ tab: t.tab, count: t.kpis[platformKey][kind] })),
      linkFor: (tab) => `/brands/${tabToSlug(tab)}?platform=${platformKey}&status=${kind}`,
    });
  }
```

Change the Pie's `onClick` handler (`src/pages/Overview.tsx:529-534`):
```tsx
                            onClick={(data) => {
                              if (total === 0 || data.label === 'No data') return;
                              const platformKey = PLATFORM_KEY[p.name];
                              const kind: 'live' | 'removed' = data.label === 'Published' ? 'live' : 'removed';
                              setPlatformSliceModal({ platform: p.name, platformKey, kind });
                            }}
```
to:
```tsx
                            onClick={(data) => {
                              if (total === 0 || data.label === 'No data') return;
                              openPlatformSlice(p.name, data.label === 'Published' ? 'live' : 'removed');
                            }}
```

Change the two legend buttons (`src/pages/Overview.tsx:554-563` and `564-573`):
```tsx
                      <button
                        type="button"
                        disabled={total === 0}
                        onClick={() => setPlatformSliceModal({ platform: p.name, platformKey: PLATFORM_KEY[p.name], kind: 'live' })}
                        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-blue-50 disabled:cursor-default"
                      >
                        <span className="size-2.5 shrink-0 rounded-full bg-emerald-500" />
                        <span className="text-slate-500">Published</span>
                        <span className="ml-auto font-semibold text-slate-800">{livePct}%</span>
                      </button>
                      <button
                        type="button"
                        disabled={total === 0}
                        onClick={() => setPlatformSliceModal({ platform: p.name, platformKey: PLATFORM_KEY[p.name], kind: 'removed' })}
                        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-blue-50 disabled:cursor-default"
                      >
                        <span className="size-2.5 shrink-0 rounded-full bg-rose-400" />
                        <span className="text-slate-500">Removed</span>
                        <span className="ml-auto font-semibold text-slate-800">{removedPct}%</span>
                      </button>
```
to:
```tsx
                      <button
                        type="button"
                        disabled={total === 0}
                        onClick={() => openPlatformSlice(p.name, 'live')}
                        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-blue-50 disabled:cursor-default"
                      >
                        <span className="size-2.5 shrink-0 rounded-full bg-emerald-500" />
                        <span className="text-slate-500">Published</span>
                        <span className="ml-auto font-semibold text-slate-800">{livePct}%</span>
                      </button>
                      <button
                        type="button"
                        disabled={total === 0}
                        onClick={() => openPlatformSlice(p.name, 'removed')}
                        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-blue-50 disabled:cursor-default"
                      >
                        <span className="size-2.5 shrink-0 rounded-full bg-rose-400" />
                        <span className="text-slate-500">Removed</span>
                        <span className="ml-auto font-semibold text-slate-800">{removedPct}%</span>
                      </button>
```

- [ ] **Step 4: Update the modal render at the bottom of the component**

Change (`src/pages/Overview.tsx:591-596`):
```tsx
      {platformSliceModal && (
        <PlatformBreakdownModal
          modal={platformSliceModal}
          tabs={state.tabs}
          onClose={() => setPlatformSliceModal(null)}
        />
      )}
```
to:
```tsx
      {sliceModal && (
        <SliceBreakdownModal
          modal={sliceModal}
          onClose={() => setSliceModal(null)}
        />
      )}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors, and no remaining references to `PlatformSliceModalState`, `PlatformBreakdownModal`, or `platformSliceModal`/`setPlatformSliceModal`.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Overview.tsx
git commit -m "refactor: generalize PlatformBreakdownModal into a dimension-agnostic SliceBreakdownModal"
```

---

### Task 6: Add "Country Breakdown" and "Proxy Breakdown" sections

**Files:**
- Create: `src/components/BreakdownDonutCard.tsx`
- Modify: `src/pages/Overview.tsx` (icon imports at line 4-7, Platform Breakdown's card JSX at lines 482-579, new sections appended after it)

**Interfaces:**
- Consumes: `mergeBreakdownMaps`, `topNWithOther`, `BreakdownCard` (Task 3); `SliceModalState`, `setSliceModal` (Task 5).
- Produces: `export default function BreakdownDonutCard(props: BreakdownDonutCardProps)` — a self-contained donut card, reusable by any future breakdown dimension.

- [ ] **Step 1: Create `BreakdownDonutCard`**

Create `src/components/BreakdownDonutCard.tsx`:

```tsx
import type { ReactNode } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

export interface BreakdownDonutCardProps {
  title: string;
  icon: ReactNode;
  iconBgClass?: string;
  accentColor: string;
  live: number;
  removed: number;
  onSliceClick?: (kind: 'live' | 'removed') => void;
}

export default function BreakdownDonutCard({
  title,
  icon,
  iconBgClass = 'bg-slate-100 ring-1 ring-slate-200',
  accentColor,
  live,
  removed,
  onSliceClick,
}: BreakdownDonutCardProps) {
  const total = live + removed;
  const slices = total > 0
    ? [
        { label: 'Published', value: live,    fill: '#10b981' },
        { label: 'Removed',   value: removed, fill: '#f43f5e' },
      ]
    : [{ label: 'No data', value: 1, fill: '#e2e8f0' }];
  const livePct    = total > 0 ? ((live    / total) * 100).toFixed(1) : '0.0';
  const removedPct = total > 0 ? ((removed / total) * 100).toFixed(1) : '0.0';

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2.5">
        <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${iconBgClass}`}>
          {icon}
        </div>
        <span className="truncate text-sm font-semibold text-slate-800">{title}</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <ResponsiveContainer width={120} height={120}>
            <PieChart>
              <Pie
                data={slices}
                cx="50%"
                cy="50%"
                innerRadius={38}
                outerRadius={56}
                dataKey="value"
                startAngle={90}
                endAngle={-270}
                stroke="#fff"
                strokeWidth={2}
                labelLine={false}
                style={{ cursor: total > 0 && onSliceClick ? 'pointer' : 'default' }}
                onClick={(data) => {
                  if (total === 0 || data.label === 'No data' || !onSliceClick) return;
                  onSliceClick(data.label === 'Published' ? 'live' : 'removed');
                }}
              >
                {slices.map((s) => (
                  <Cell key={s.label} fill={s.fill} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [value.toLocaleString(), name]}
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base font-bold font-mono tabular-nums leading-tight" style={{ color: accentColor }}>{livePct}%</span>
            <span className="text-[10px] font-medium text-slate-400">published</span>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2.5 text-xs">
          <button
            type="button"
            disabled={total === 0 || !onSliceClick}
            onClick={() => onSliceClick?.('live')}
            className="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-blue-50 disabled:cursor-default"
          >
            <span className="size-2.5 shrink-0 rounded-full bg-emerald-500" />
            <span className="text-slate-500">Published</span>
            <span className="ml-auto font-semibold text-slate-800">{livePct}%</span>
          </button>
          <button
            type="button"
            disabled={total === 0 || !onSliceClick}
            onClick={() => onSliceClick?.('removed')}
            className="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-blue-50 disabled:cursor-default"
          >
            <span className="size-2.5 shrink-0 rounded-full bg-rose-400" />
            <span className="text-slate-500">Removed</span>
            <span className="ml-auto font-semibold text-slate-800">{removedPct}%</span>
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `Globe`/`Network` icon imports to `Overview.tsx`**

Change (`src/pages/Overview.tsx:3-7`):
```tsx
import {
  Users, CheckCircle2, XCircle, X,
  Syringe, Link2, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart, Star,
  type LucideIcon,
} from 'lucide-react';
```
to:
```tsx
import {
  Users, CheckCircle2, XCircle, X,
  Syringe, Link2, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart, Star,
  Globe, Network,
  type LucideIcon,
} from 'lucide-react';
```

Add the import for the new card component and the two remaining helpers from Task 3, right after the `BrandFilterDropdown` import added in Task 4:
```tsx
import BreakdownDonutCard from '../components/BreakdownDonutCard';
```
And change the Task 3 import line (added in Task 4, Step 1) from:
```tsx
import { mergeDistinctValues } from '../lib/overviewBreakdown';
```
to:
```tsx
import { mergeDistinctValues, mergeBreakdownMaps, topNWithOther } from '../lib/overviewBreakdown';
```

- [ ] **Step 3: Refactor Platform Breakdown's cards onto `BreakdownDonutCard`**

Replace the per-platform card block (`src/pages/Overview.tsx:495-577`, i.e. everything from `<div key={p.name} className="rounded-xl border ...">` through its matching closing `</div>`, leaving the surrounding `return (` / `);` untouched) with:

```tsx
              <BreakdownDonutCard
                key={p.name}
                title={p.name === 'WizardOfOdds' ? 'Wizard of Odds' : p.name}
                icon={
                  <img
                    src={PLATFORM_LOGOS[p.name]}
                    alt={p.name}
                    className="size-5 rounded-sm object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                }
                iconBgClass={PLATFORM_ICON_BG[p.name] ?? 'bg-slate-100 ring-1 ring-slate-200'}
                accentColor={PLATFORM_COLORS[p.name as keyof typeof PLATFORM_COLORS]}
                live={p.Live}
                removed={p.Removed}
                onSliceClick={(kind) => openPlatformSlice(p.name, kind)}
              />
```

This removes the need for the `total`/`color`/`slices`/`livePct`/`removedPct` local variables that previously lived inside that `.map()` callback (`src/pages/Overview.tsx:484-493`) — delete those five lines too, since `BreakdownDonutCard` now computes them internally. The surrounding `{platformData.map((p) => { ... return ( ... ); })}` structure stays; only its body changes to the block above.

- [ ] **Step 4: Compute Country/Proxy breakdown cards**

Add this near the other page-level computed values, right after the `allCountries`/`allProxies` lines added in Task 4, Step 3:

```tsx
  const BREAKDOWN_TOP_N = 8;
  const countryCards = topNWithOther(mergeBreakdownMaps(state.tabs.map((t) => t.kpis.byCountry)), BREAKDOWN_TOP_N);
  const proxyCards   = topNWithOther(mergeBreakdownMaps(state.tabs.map((t) => t.kpis.byProxy)),   BREAKDOWN_TOP_N);

  function openDimensionSlice(
    card: { key: string; label: string; isOther: boolean },
    dimension: 'country' | 'proxy',
    kind: 'live' | 'removed',
  ) {
    if (card.isOther) return;
    const icon = dimension === 'country'
      ? <Globe className="size-4 text-slate-500" />
      : <Network className="size-4 text-slate-500" />;
    const rowIcon = dimension === 'country'
      ? <Globe className="size-3.5 shrink-0 text-slate-400" />
      : <Network className="size-3.5 shrink-0 text-slate-400" />;
    setSliceModal({
      title: card.label,
      headerIcon: icon,
      rowIcon,
      kind,
      rows: state.tabs.map((t) => ({
        tab: t.tab,
        count: (dimension === 'country' ? t.kpis.byCountry[card.key] : t.kpis.byProxy[card.key])?.[kind] ?? 0,
      })),
      linkFor: (tab) => `/brands/${tabToSlug(tab)}`,
    });
  }
```

- [ ] **Step 5: Render the two new sections**

Add this right after the closing `</section>` of the existing "Platform Breakdown" section (`src/pages/Overview.tsx`, immediately before the `{kpiModal && (` block):

```tsx
      {/* Country breakdown */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-800">Country Breakdown</h2>
          <p className="mt-0.5 text-xs text-slate-400">Published vs. removed by country</p>
        </div>
        {state.loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : countryCards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">No country data</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {countryCards.map((card) => (
              <BreakdownDonutCard
                key={card.key}
                title={card.label}
                icon={<Globe className="size-5 text-slate-500" />}
                accentColor="#6366f1"
                live={card.live}
                removed={card.removed}
                onSliceClick={card.isOther ? undefined : (kind) => openDimensionSlice(card, 'country', kind)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Proxy breakdown */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-800">Proxy Breakdown</h2>
          <p className="mt-0.5 text-xs text-slate-400">Published vs. removed by proxy</p>
        </div>
        {state.loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : proxyCards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">No proxy data</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {proxyCards.map((card) => (
              <BreakdownDonutCard
                key={card.key}
                title={card.label}
                icon={<Network className="size-5 text-slate-500" />}
                accentColor="#0891b2"
                live={card.live}
                removed={card.removed}
                onSliceClick={card.isOther ? undefined : (kind) => openDimensionSlice(card, 'proxy', kind)}
              />
            ))}
          </div>
        )}
      </section>
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, open the Overview page in a browser.
Expected: the Filters row (Country/Proxy dropdowns) appears once data loads; selecting a Country/Proxy value updates the URL and re-scopes the 3 top KPI cards, "Brands Performance" tiles, and "Platform Breakdown"; "Country Breakdown" and "Proxy Breakdown" sections render below "Platform Breakdown" with the same donut-card visual style; clicking a non-"Other" slice opens a modal listing per-tab contribution with working links to `/brands/<tab>`; the existing Platform Breakdown click-through still works exactly as before.

Note: this app is login-gated (Supabase Auth) — if no test credentials are available in the execution environment, skip this step and say so explicitly rather than claiming it was verified.

- [ ] **Step 9: Commit**

```bash
git add src/components/BreakdownDonutCard.tsx src/pages/Overview.tsx
git commit -m "feat: add Country Breakdown and Proxy Breakdown sections to Overview"
```
