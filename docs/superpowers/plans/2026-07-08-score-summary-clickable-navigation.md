# Score Summary Clickable Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Score Summary's brand names and star-count cells clickable, deep-linking into the Brands tab with brand/platform/rating filters pre-applied, and add Wizard of Odds as a fourth Score Summary platform so the feature covers all four platforms.

**Architecture:** Two small, independently-testable pure-logic additions (`scoreSummary.ts` gains a `wo` platform; `tab-configs.ts` gains a shared score-column resolver), followed by two UI changes: `ScoreSummaryPanel.tsx` renders brand names and star counts as React Router `<Link>`s carrying `platform`/`brand`/`rating` query params, and `BrandGroup.tsx` reads those params to filter its rows, including a reactivity fix so navigating between two such links on the same tab re-applies filters.

**Tech Stack:** Vite · React 19 · TypeScript · React Router v7 · Tailwind v4 · Vitest (existing unit tests for `scoreSummary.ts` and `tab-configs.ts`; `BrandGroup.tsx`/`ScoreSummaryPanel.tsx` have no component test suite today — verified manually in the browser, consistent with how every other feature in this codebase's UI layer is verified).

## Global Constraints

- WO score scale is 1-5, same shape as TP/CG (`docs/superpowers/specs/2026-07-08-score-summary-clickable-navigation-design.md`).
- Rating-filter matches must be Published-status only, exactly mirroring what Score Summary counted — not "any status with that score."
- Brand-name clicks (no specific rating) carry the currently-active Score Summary platform toggle into the Brands tab.
- Star-count cells with a count of 0 are not clickable (nothing to navigate to).
- Navigating between two Score-Summary-originated links for the *same* Brands tab (e.g. AG-10 → AG-9) must re-apply filters — not silently no-op.
- Verify with `npm run build` (not `tsc --noEmit` — the root tsconfig is references-only and checks nothing).

---

### Task 1: Add Wizard of Odds as a platform in `scoreSummary.ts`

**Files:**
- Modify: `src/lib/scoreSummary.ts:5,8,36-52`
- Test: `src/lib/scoreSummary.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Platform` type now includes `'wo'`; `PLATFORM_MAX_SCORE.wo === 5`; `computeScoreSummary(entries, range, [], 'wo')` correctly buckets Wizard of Odds published reviews. Tasks 2-4 rely on `Platform` including `'wo'` and on `PLATFORM_MAX_SCORE`/`parseScore` (already exported) covering it.

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('computeScoreSummary', ...)` block in `src/lib/scoreSummary.test.ts`, right after the `'reads CG scores on a 1-5 scale'` test:

```ts
  it('reads WO scores on a 1-5 scale', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Wizard of Odds', { 'Brand Name': 'ZodiacBet.com', 'WoO Review Status': 'Published', 'Wizard of OddsScore added': '4' }),
      makeEntry('2', 'Wizard of Odds', { 'Brand Name': 'ZodiacBet.com', 'WoO Review Status': 'Published', 'Wizard of OddsScore added': '3' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'wo');
    const [brand] = result.brands;
    expect(brand.counts[4]).toBe(1);
    expect(brand.counts[3]).toBe(1);
    expect(brand.average).toBe(3.5);
    expect(brand.label).toBe('Average');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/scoreSummary.test.ts`
Expected: FAIL — TypeScript error / runtime `undefined` because `'wo'` isn't a valid `Platform` yet and `PLATFORM_MAX_SCORE.wo`, `PLATFORM_STATUS_KEYS.wo`, `PLATFORM_SCORE_KEYS.wo` don't exist.

- [ ] **Step 3: Implement the platform additions**

In `src/lib/scoreSummary.ts`, change line 5:

```ts
export type Platform = 'tp' | 'ag' | 'cg';
```
to:
```ts
export type Platform = 'tp' | 'ag' | 'cg' | 'wo';
```

Change line 8:
```ts
export const PLATFORM_MAX_SCORE: Record<Platform, number> = { tp: 5, ag: 10, cg: 5 };
```
to:
```ts
export const PLATFORM_MAX_SCORE: Record<Platform, number> = { tp: 5, ag: 10, cg: 5, wo: 5 };
```

Change lines 36-40:
```ts
const PLATFORM_STATUS_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status', 'Review Status'],
  ag: ['AG Review Status'],
  cg: ['CG Review Status'],
};
```
to:
```ts
const PLATFORM_STATUS_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status', 'Review Status'],
  ag: ['AG Review Status'],
  cg: ['CG Review Status'],
  wo: ['WoO Review Status'],
};
```

Change lines 42-46:
```ts
const PLATFORM_DATE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['Trust Pilot'],
  ag: ['Ask Gambler review added'],
  cg: ['Casino Guru review added'],
};
```
to:
```ts
const PLATFORM_DATE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['Trust Pilot'],
  ag: ['Ask Gambler review added'],
  cg: ['Casino Guru review added'],
  wo: ['Wizard of Odds'],
};
```

Change lines 48-52:
```ts
const PLATFORM_SCORE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Score added', 'Score added', 'Score Added', 'Score'],
  ag: ['AG Score added'],
  cg: ['CG Score added'],
};
```
to:
```ts
const PLATFORM_SCORE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Score added', 'Score added', 'Score Added', 'Score'],
  ag: ['AG Score added'],
  cg: ['CG Score added'],
  wo: ['Wizard of OddsScore added'],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/scoreSummary.test.ts`
Expected: PASS — all tests in the file, including the new WO one.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoreSummary.ts src/lib/scoreSummary.test.ts
git commit -m "feat: add Wizard of Odds as a Score Summary platform"
```

---

### Task 2: Add a shared score-column resolver to `tab-configs.ts`

**Files:**
- Modify: `src/lib/tab-configs.ts` (insert after the `getBrandNameCol` function, currently ending at line 231)
- Test: `src/lib/tab-configs.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PLATFORM_SCORE_COLS: Record<'tp' | 'ag' | 'cg' | 'wo', readonly string[]>` and `getScoreCol(platform: 'tp' | 'ag' | 'cg' | 'wo', headers: string[]): string | null`. Task 4 (`BrandGroup.tsx`) imports and calls `getScoreCol` to resolve which loaded column holds a given platform's score before applying the rating filter.

- [ ] **Step 1: Write the failing test**

Add this to `src/lib/tab-configs.test.ts`. First update the import at the top of the file:

```ts
import { TAB_COLUMN_CONFIGS, getEntryCountry, getCountryForAccount, getBrandGroup, getScoreCol } from './tab-configs';
```

Then add this new `describe` block (anywhere at the top level of the file, e.g. after the `getEntryCountry` block):

```ts
describe('getScoreCol', () => {
  it('resolves the first matching TP score column variant present in headers', () => {
    expect(getScoreCol('tp', ['Brands', 'Score added'])).toBe('Score added');
    expect(getScoreCol('tp', ['Brands', 'TP Score added'])).toBe('TP Score added');
  });

  it('resolves AG, CG, and WO score columns exactly', () => {
    expect(getScoreCol('ag', ['Brands', 'AG Score added'])).toBe('AG Score added');
    expect(getScoreCol('cg', ['Brands', 'CG Score added'])).toBe('CG Score added');
    expect(getScoreCol('wo', ['Brand Name', 'Wizard of OddsScore added'])).toBe('Wizard of OddsScore added');
  });

  it('returns null when the tab has none of the known score columns', () => {
    expect(getScoreCol('ag', ['Brands', 'TP Score added'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tab-configs.test.ts`
Expected: FAIL — `getScoreCol` is not exported from `./tab-configs`.

- [ ] **Step 3: Implement `getScoreCol`**

In `src/lib/tab-configs.ts`, insert this immediately after the `getBrandNameCol` function (after the line `}` closing it, currently line 231):

```ts

// Score-value column candidates per platform, in priority order. TP has
// historically inconsistent naming across tabs (hence the fallback list);
// AG/CG/WO each have exactly one known raw column name.
export const PLATFORM_SCORE_COLS: Record<'tp' | 'ag' | 'cg' | 'wo', readonly string[]> = {
  tp: ['TP Score added', 'Score added', 'Score Added', 'Score'],
  ag: ['AG Score added'],
  cg: ['CG Score added'],
  wo: ['Wizard of OddsScore added'],
};

// The actual header present in `headers` for a given platform's score column,
// or null if this tab has none of the known candidates.
export function getScoreCol(platform: 'tp' | 'ag' | 'cg' | 'wo', headers: string[]): string | null {
  return PLATFORM_SCORE_COLS[platform].find((c) => headers.includes(c)) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tab-configs.test.ts`
Expected: PASS — all tests in the file, including the new `getScoreCol` block.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tab-configs.ts src/lib/tab-configs.test.ts
git commit -m "feat: add getScoreCol platform score-column resolver"
```

---

### Task 3: Make brand names and star-count cells clickable in `ScoreSummaryPanel.tsx`

**Files:**
- Modify: `src/components/ScoreSummaryPanel.tsx`

**Interfaces:**
- Consumes: `Platform` type and `PLATFORM_MAX_SCORE` from `../lib/scoreSummary` (Task 1, already imported here); `tabToSlug` from `../lib/tabs` (new import).
- Produces: brand-name and star-count table cells are now `<Link>`s to `/brands/${tabToSlug(tab)}?platform=...&brand=...[&rating=...]`. Task 4 (`BrandGroup.tsx`) reads these exact query param names (`platform`, `brand`, `rating`).

- [ ] **Step 1: Add the new imports**

At the top of `src/components/ScoreSummaryPanel.tsx`, change:

```ts
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Star, X } from 'lucide-react';
import DatePicker from './DatePicker';
```
to:
```ts
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Star, X } from 'lucide-react';
import DatePicker from './DatePicker';
import { tabToSlug } from '../lib/tabs';
```

- [ ] **Step 2: Add Wizard of Odds to the platform toggle**

Change (lines 42-52):

```ts
const PLATFORM_OPTS: { value: Platform; label: string; icon: string }[] = [
  { value: 'tp', label: 'TrustPilot',  icon: 'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=32' },
  { value: 'ag', label: 'AskGamblers', icon: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=32' },
  { value: 'cg', label: 'CasinoGuru',  icon: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=32' },
];

const PLATFORM_DATE_LABEL: Record<Platform, string> = {
  tp: 'Trust Pilot date',
  ag: 'AskGamblers date',
  cg: 'CasinoGuru date',
};
```
to:
```ts
const PLATFORM_OPTS: { value: Platform; label: string; icon: string }[] = [
  { value: 'tp', label: 'TrustPilot',  icon: 'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=32' },
  { value: 'ag', label: 'AskGamblers', icon: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=32' },
  { value: 'cg', label: 'CasinoGuru',  icon: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=32' },
  { value: 'wo', label: 'Wizard of Odds', icon: 'https://www.google.com/s2/favicons?domain=wizardofodds.com&sz=32' },
];

const PLATFORM_DATE_LABEL: Record<Platform, string> = {
  tp: 'Trust Pilot date',
  ag: 'AskGamblers date',
  cg: 'CasinoGuru date',
  wo: 'Wizard of Odds date',
};
```

- [ ] **Step 3: Thread `platform` down to `SummaryTable`**

Change (line 141):
```tsx
            <GroupedSummary rows={filteredBrands} maxScore={maxScore} />
```
to:
```tsx
            <GroupedSummary rows={filteredBrands} maxScore={maxScore} platform={platform} />
```

Change (line 275):
```tsx
function GroupedSummary({ rows, maxScore }: { rows: BrandSummary[]; maxScore: number }) {
```
to:
```tsx
function GroupedSummary({ rows, maxScore, platform }: { rows: BrandSummary[]; maxScore: number; platform: Platform }) {
```

Change (line 324):
```tsx
            {!isCollapsed && <SummaryTable rows={brands} maxScore={maxScore} />}
```
to:
```tsx
            {!isCollapsed && <SummaryTable rows={brands} maxScore={maxScore} platform={platform} />}
```

Change (line 446):
```tsx
function SummaryTable({ rows, maxScore }: { rows: BrandSummary[]; maxScore: number }) {
```
to:
```tsx
function SummaryTable({ rows, maxScore, platform }: { rows: BrandSummary[]; maxScore: number; platform: Platform }) {
```

- [ ] **Step 4: Make the brand-name cell a link**

In `SummaryTable`, change (line 485):
```tsx
              <td className="px-3 py-1.5 font-medium text-slate-800 truncate" title={r.brand}>{r.brand}</td>
```
to:
```tsx
              <td className="px-3 py-1.5 truncate" title={r.brand}>
                <Link
                  to={`/brands/${tabToSlug(r.tab)}?platform=${platform}&brand=${encodeURIComponent(r.brand)}`}
                  className="font-medium text-slate-800 hover:text-violet-600 hover:underline"
                >
                  {r.brand}
                </Link>
              </td>
```

- [ ] **Step 5: Make non-zero star-count cells links**

Change (lines 486-495):
```tsx
              {stars.map((s) => (
                <td
                  key={s}
                  className={`px-2 py-1.5 text-right tabular-nums ${
                    r.counts[s] > 0 ? 'text-slate-800' : 'text-slate-300'
                  }`}
                >
                  {r.counts[s].toLocaleString()}
                </td>
              ))}
```
to:
```tsx
              {stars.map((s) => (
                <td
                  key={s}
                  className={`px-2 py-1.5 text-right tabular-nums ${
                    r.counts[s] > 0 ? 'text-slate-800' : 'text-slate-300'
                  }`}
                >
                  {r.counts[s] > 0 ? (
                    <Link
                      to={`/brands/${tabToSlug(r.tab)}?platform=${platform}&brand=${encodeURIComponent(r.brand)}&rating=${s}`}
                      className="hover:text-violet-600 hover:underline"
                    >
                      {r.counts[s].toLocaleString()}
                    </Link>
                  ) : (
                    r.counts[s].toLocaleString()
                  )}
                </td>
              ))}
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 7: Manually verify in the browser**

Start the dev server (`npm run dev`), open Score Summary, and confirm:
- Every brand name is underlined/colored on hover and links to `/brands/<slug>?platform=<active>&brand=<name>`.
- Every star-count cell with a value > 0 is clickable; cells showing `0` are not (no hover/link styling).
- Switching the platform toggle to "Wizard of Odds" shows a WO column set (1-5 stars) with data for the Wizard of Odds tab's published reviews.

- [ ] **Step 8: Commit**

```bash
git add src/components/ScoreSummaryPanel.tsx
git commit -m "feat: make Score Summary brand names and star counts clickable"
```

---

### Task 4: Filter the Brands tab from `brand`/`platform`/`rating` URL params

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `getScoreCol` from `../lib/tab-configs` (Task 2); `parseScore`, `PLATFORM_MAX_SCORE` from `../lib/scoreSummary` (Task 1); the `platform`/`brand`/`rating` query params written by `ScoreSummaryPanel.tsx` (Task 3).
- Produces: the Brands tab table now reflects those three params on load and on subsequent same-tab navigations between different Score-Summary-originated links.

- [ ] **Step 1: Add new imports**

Change (line 15):
```ts
import { getTabColumns, getColLabel, COLUMN_LABELS, TAB_DEFAULT_BRAND, getTabPlatforms, getTabSequence, getTabSequenceCol, hasMultiPlatform, getBrandTpUrl, getEntryCountry, getCountryForAccount, getBrandGroup, BRAND_COLS, TABLE_HIDDEN_COLS } from '../lib/tab-configs';
```
to:
```ts
import { getTabColumns, getColLabel, COLUMN_LABELS, TAB_DEFAULT_BRAND, getTabPlatforms, getTabSequence, getTabSequenceCol, hasMultiPlatform, getBrandTpUrl, getEntryCountry, getCountryForAccount, getBrandGroup, BRAND_COLS, TABLE_HIDDEN_COLS, getScoreCol } from '../lib/tab-configs';
```

Change (line 16):
```ts
import { slugToTab, OPERATIONAL_TABS } from '../lib/tabs';
```
to:
```ts
import { slugToTab, OPERATIONAL_TABS } from '../lib/tabs';
import { parseScore, PLATFORM_MAX_SCORE } from '../lib/scoreSummary';
```

- [ ] **Step 2: Add a `wo` entry to the local platform column maps**

Change (lines 174-184):
```ts
const PLATFORM_DATE_COLS = {
  tp: 'Trust Pilot',
  ag: 'Ask Gambler review added',
  cg: 'Casino Guru review added',
} as const;

const PLATFORM_STATUS_COL = {
  tp: 'TP Review Status',
  ag: 'AG Review Status',
  cg: 'CG Review Status',
} as const;
```
to:
```ts
const PLATFORM_DATE_COLS = {
  tp: 'Trust Pilot',
  ag: 'Ask Gambler review added',
  cg: 'Casino Guru review added',
  wo: 'Wizard of Odds',
} as const;

const PLATFORM_STATUS_COL = {
  tp: 'TP Review Status',
  ag: 'AG Review Status',
  cg: 'CG Review Status',
  wo: 'WoO Review Status',
} as const;
```

- [ ] **Step 3: Widen `platformFilter` and add `ratingFilter` state**

Change (lines 583-585):
```ts
  const [platformFilter, setPlatformFilter] = useState<'all' | 'tp' | 'ag' | 'cg'>(
    (['tp', 'ag', 'cg'].includes(searchParams.get('platform') ?? '') ? searchParams.get('platform') as 'tp' | 'ag' | 'cg' : 'all')
  );
```
to:
```ts
  const [platformFilter, setPlatformFilter] = useState<'all' | 'tp' | 'ag' | 'cg' | 'wo'>(
    (['tp', 'ag', 'cg', 'wo'].includes(searchParams.get('platform') ?? '') ? searchParams.get('platform') as 'tp' | 'ag' | 'cg' | 'wo' : 'all')
  );
  const [ratingFilter, setRatingFilter] = useState<number | null>(() => {
    const r = Number(searchParams.get('rating'));
    return Number.isInteger(r) && r > 0 ? r : null;
  });
```

- [ ] **Step 4: Read `brand` and `rating` from the URL on tab change too**

Change (lines 705-723, inside the tab-change effect):
```ts
    if (isTabChange) {
      setLoading(true);
      setEntries([]);
      setHeaders([]);
      setFullHeaders([]);
      setError(null);
      setSearch('');
      setBrandFilter('');
      setStatusFilter('all');
      setPlatformFilter((['tp', 'ag', 'cg'].includes(searchParams.get('platform') ?? '') ? searchParams.get('platform') as 'tp' | 'ag' | 'cg' : 'all'));
      setAgentFilter('');
      setProxyFilter('');
      setCountryFilter('');
      setDateFrom('');
      setDateTo('');
      setPage(1);
      setJumpInput('');
      setSelectedIds(new Set());
    }
```
to:
```ts
    if (isTabChange) {
      setLoading(true);
      setEntries([]);
      setHeaders([]);
      setFullHeaders([]);
      setError(null);
      setSearch('');
      setBrandFilter(searchParams.get('brand') ?? '');
      setStatusFilter('all');
      setPlatformFilter((['tp', 'ag', 'cg', 'wo'].includes(searchParams.get('platform') ?? '') ? searchParams.get('platform') as 'tp' | 'ag' | 'cg' | 'wo' : 'all'));
      setRatingFilter((() => {
        const r = Number(searchParams.get('rating'));
        return Number.isInteger(r) && r > 0 ? r : null;
      })());
      setAgentFilter('');
      setProxyFilter('');
      setCountryFilter('');
      setDateFrom('');
      setDateTo('');
      setPage(1);
      setJumpInput('');
      setSelectedIds(new Set());
    }
```

- [ ] **Step 5: Fix the same-tab reactivity gap**

Immediately after the tab-change effect's closing (currently `}, [decodedTab, reloadSeq]);` at line 855), add a new effect:

```ts

  // Re-sync platform/brand/rating from the URL whenever the query string changes on an
  // already-mounted tab — e.g. clicking from one Score Summary star-count link to another
  // for the same brand-group tab. The effect above only re-derives these on an actual tab
  // change; without this, such same-tab navigations would silently keep the old filters.
  useEffect(() => {
    const p = searchParams.get('platform');
    setPlatformFilter(['tp', 'ag', 'cg', 'wo'].includes(p ?? '') ? (p as 'tp' | 'ag' | 'cg' | 'wo') : 'all');
    setBrandFilter(searchParams.get('brand') ?? '');
    const r = Number(searchParams.get('rating'));
    setRatingFilter(Number.isInteger(r) && r > 0 ? r : null);
  }, [searchParams]);
```

- [ ] **Step 6: Add the rating filter to the row-filtering pipeline**

Change (lines 1163-1174):
```ts
  // Platform filter only affects visible columns, not row filtering.
  const platformFiltered = countryFiltered;

  const statusCols = headers.filter(isStatusCol);
  // When a platform card is selected, only check that platform's status column(s).
  const activeStatusCols = platformFilter === 'all'
    ? statusCols
    : platformFilter === 'tp'
      ? statusCols.filter((h) => TP_STATUS_VARIANTS.has(h))
      : statusCols.filter((h) => h.toLowerCase() === PLATFORM_STATUS_COL[platformFilter].toLowerCase());
  const statusFiltered = statusFilter === 'all'
    ? platformFiltered
    : platformFiltered.filter((e) =>
```
to:
```ts
  // Platform filter only affects visible columns, not row filtering.
  const platformFiltered = countryFiltered;

  const statusCols = headers.filter(isStatusCol);
  // When a platform card is selected, only check that platform's status column(s).
  const activeStatusCols = platformFilter === 'all'
    ? statusCols
    : platformFilter === 'tp'
      ? statusCols.filter((h) => TP_STATUS_VARIANTS.has(h))
      : statusCols.filter((h) => h.toLowerCase() === PLATFORM_STATUS_COL[platformFilter].toLowerCase());

  // Rating filter (arrives via Score Summary star-count links): only meaningful when a
  // specific platform is active, since a rating value is only comparable within one
  // platform's score column. Matches Published-status rows only, exactly mirroring what
  // Score Summary counted — not "any status with that score."
  const activePlatformForRating = platformFilter !== 'all' ? platformFilter : null;
  const ratingFiltered = (() => {
    if (ratingFilter == null || !activePlatformForRating) return platformFiltered;
    const scoreCol = getScoreCol(activePlatformForRating, headers);
    if (!scoreCol) return platformFiltered;
    const maxScore = PLATFORM_MAX_SCORE[activePlatformForRating];
    return platformFiltered.filter((e) =>
      activeStatusCols.some((h) => (e.data[h] ?? '').trim().toLowerCase() === 'published') &&
      parseScore(e.data[scoreCol], maxScore) === ratingFilter,
    );
  })();

  const statusFiltered = statusFilter === 'all'
    ? ratingFiltered
    : ratingFiltered.filter((e) =>
```

- [ ] **Step 7: Scope the KPI totals to the rating filter too**

Change (line 1209):
```ts
  const kpiBase = applyDateFilter(platformFiltered);
```
to:
```ts
  const kpiBase = applyDateFilter(ratingFiltered);
```

- [ ] **Step 8: Add an active-filter chip with a clear action**

Change (lines 1627-1631):
```tsx
          {!loading && (search || brandFilter || statusFilter !== 'all' || platformFilter !== 'all') && (
            <span className="text-xs text-slate-400 whitespace-nowrap">
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
```
to:
```tsx
          {!loading && (search || brandFilter || statusFilter !== 'all' || platformFilter !== 'all') && (
            <span className="text-xs text-slate-400 whitespace-nowrap">
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
          {(brandFilter || ratingFilter != null) && (
            <div className="flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs text-violet-700 whitespace-nowrap">
              <span>
                Filtered by:
                {brandFilter ? ` ${brandFilter}` : ''}
                {platformFilter !== 'all' ? ` · ${platformFilter.toUpperCase()}` : ''}
                {ratingFilter != null ? ` · Rating ${ratingFilter}` : ''}
              </span>
              <button
                type="button"
                onClick={() => {
                  setBrandFilter('');
                  setRatingFilter(null);
                  setPlatformFilter('all');
                  setSearchParams({});
                  setPage(1);
                }}
                className="text-violet-500 hover:text-violet-700 transition-colors"
                aria-label="Clear brand/rating filter"
              >
                <X className="size-3" />
              </button>
            </div>
          )}
```

- [ ] **Step 9: Verify the build**

Run: `npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 10: Manually verify in the browser**

With the dev server running:
1. From Score Summary, click a brand name → confirm the Brands tab opens filtered to just that brand, with the previously-active platform toggle carried over, and the "Filtered by" chip shown.
2. Click a star-count cell (e.g. AG-10) → confirm the Brands tab shows only rows with AG score exactly 10 and AG status Published, and the chip reads `... · AG · Rating 10`.
3. While still on that tab, go back to Score Summary and click a *different* star-count cell for the *same* brand-group tab (e.g. AG-9) → confirm the table updates to the new rating instead of staying on the old filter.
4. Click the chip's clear (✕) button → confirm brand/platform/rating filters reset and the chip disappears.
5. Repeat step 2 for the Wizard of Odds tab/platform.

- [ ] **Step 11: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: filter Brands tab from Score Summary brand/platform/rating links"
```

---

### Task 5: Final integration pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including the new ones from Tasks 1 and 2.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: builds cleanly with no TypeScript errors.

- [ ] **Step 3: End-to-end manual click-through**

Repeat the full scenario from Task 4 Step 10 once more after all four tasks are merged together, since Task 4's manual check happened before this final integration state. Confirm no regressions to the existing platform-only deep link from `Overview.tsx`'s `PlatformBreakdownModal` (click a platform breakdown row there and confirm it still opens the Brands tab correctly with just `platform` set, no `brand`/`rating`).
