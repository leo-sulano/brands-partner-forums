# Country × Proxy Performance Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Country × Proxy Performance" section to the Overview page, directly after Proxy Breakdown, showing a success-rate matrix (every country as a row, every proxy as a column) built from the same entry-classification pass that already powers Country Breakdown and Proxy Breakdown.

**Architecture:** Extend `computeTabKpisFromEntries` (`src/lib/queries.ts`) to also bucket each live/removed entry into a new composite `byCountryProxy` map (keyed by `${countryKey}::${proxyKey}`), merge it across tabs in `Overview.tsx` the same way `byCountry`/`byProxy` are merged today, and render it via a new presentational `CountryProxyMatrix` component reusing `SuccessRateBadge` for cells and the existing `SliceBreakdownModal` for drill-down.

**Tech Stack:** React 19 + TypeScript, Vite, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-country-proxy-matrix-design.md`

## Global Constraints

- Both axes are uncapped — every distinct country and every distinct proxy gets its own row/column (per direct user decision; no top-N/"Other" folding on the matrix itself, unlike Proxy Breakdown's own top-8 cap).
- No schema/migration change — purely computed client-side from entries already fetched for Country/Proxy Breakdown.
- No changes to Score Summary, Brand Tabs, Ask AI, or Schedule Planner.
- Row order must track `countrySortMode`, column order must track `proxySortMode` — the same two toggles Country Breakdown/Proxy Breakdown already use, no new sort UI.
- `byCountryProxy` must be built from the exact same resolved `resolveCountryLabel(d, tab)` / `resolveProxyLabel(d['Proxy Used'])` values already passed into the existing `byCountry`/`byProxy` `addToBreakdown` calls, so per-cell sums can never disagree with the two single-dimension breakdowns.

---

## Task 1: `CountBreakdownPair` type + `byCountryProxy` field on `TabKpis`

**Files:**
- Modify: `src/types/brand-entry.ts`

**Interfaces:**
- Produces: `CountBreakdownPair { countryLabel: string; proxyLabel: string; live: number; removed: number }`, and `TabKpis.byCountryProxy: Record<string, CountBreakdownPair>`.

- [ ] **Step 1: Add the new type and field**

In `src/types/brand-entry.ts`, add the new interface right after `CountBreakdown` (currently lines 19-23), and add the new field to `TabKpis` right after `byProxy` (currently line 40):

```ts
export interface CountBreakdown {
  label: string;
  live: number;
  removed: number;
}

// One cell of the Overview Country x Proxy matrix — carries both labels
// (unlike CountBreakdown's single label) since the composite key encodes
// two independent dimensions.
export interface CountBreakdownPair {
  countryLabel: string;
  proxyLabel: string;
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
  customPlatforms: { platform: CustomPlatformConfig; total: number; live: number; removed: number; successRate: number | null }[];
  byCountry: Record<string, CountBreakdown>;
  byProxy: Record<string, CountBreakdown>;
  // Composite country+proxy breakdown for Overview's Country x Proxy matrix —
  // key is `${canonicalCountryKey}::${canonicalProxyKey}`. Built from the same
  // classification pass as byCountry/byProxy in computeTabKpisFromEntries, so
  // it can never disagree with those two maps for the same entries.
  byCountryProxy: Record<string, CountBreakdownPair>;
  countries: string[];
  proxies: string[];
}
```

- [ ] **Step 2: Verify the project still typechecks**

This step alone will fail — `computeTabKpisFromEntries`'s return object and `Overview.tsx`'s `EMPTY_KPIS` constant don't populate the new required field yet. That's expected; Task 2 and Task 4 fix it. Just confirm the error is exactly the expected "missing byCountryProxy" shape, not something unrelated:

Run: `npm run build`
Expected: FAIL, with TS errors naming `byCountryProxy` as missing on the object literals in `src/lib/queries.ts` and `src/pages/Overview.tsx` only.

- [ ] **Step 3: Commit**

```bash
git add src/types/brand-entry.ts
git commit -m "Add CountBreakdownPair type and byCountryProxy field to TabKpis"
```

---

## Task 2: Populate `byCountryProxy` in `computeTabKpisFromEntries`

**Files:**
- Modify: `src/lib/queries.ts:678-758` (`computeTabKpisFromEntries`)
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `CountBreakdownPair` from `../types/brand-entry.ts` (Task 1); existing `canonicalCountryKey`/`canonicalCountryName` (`./countryFlags.ts`), `canonicalProxyKey`/`canonicalProxyName`/`resolveProxyLabel` (`./proxyAliases.ts`), `resolveCountryLabel` (`./countryFlags.ts`) — all already imported at the top of `queries.ts`.
- Produces: `TabKpis.byCountryProxy`, populated for every classified entry.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/queries.test.ts`, inside the existing `describe('computeTabKpisFromEntries', ...)` block (after the `byProxy and proxies fold a redacted...` test, i.e. after line 739's closing of that `it`):

```ts
  it('byCountryProxy buckets live/removed per country+proxy pair, keyed by composite canonical key, with both display labels attached', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'Germany', 'Proxy Used': 'Enigma-US2' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byCountryProxy).toEqual({
      'DE::enigma-us1': { countryLabel: 'Germany', proxyLabel: 'Enigma-US1', live: 1, removed: 0 },
      'DE::enigma-us2': { countryLabel: 'Germany', proxyLabel: 'Enigma-US2', live: 0, removed: 1 },
    });
  });

  it('byCountryProxy merges every recognized spelling of the same country+proxy pair onto one bucket', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'UK', 'Proxy Used': 'enigma-us1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'United Kingdom', 'Proxy Used': ' Enigma-US1 ' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byCountryProxy).toEqual({
      'GB::enigma-us1': { countryLabel: 'United Kingdom', proxyLabel: 'Enigma-US1', live: 2, removed: 0 },
    });
  });

  it('byCountryProxy buckets a blank Country and blank Proxy Used under Unknown/No Proxy, same as byCountry/byProxy individually', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': '', 'Proxy Used': '' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byCountryProxy).toEqual({
      'unknown::no proxy': { countryLabel: 'Unknown', proxyLabel: 'No Proxy', live: 1, removed: 0 },
    });
  });

  it('byCountryProxy cells sum back to the same per-country and per-proxy totals as byCountry/byProxy (anti-drift guarantee)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Country': 'Germany', 'Proxy Used': 'Enigma-US2' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'France', 'Proxy Used': 'Enigma-US1' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;

    const pairs = Object.values(kpis.byCountryProxy);
    const germanyFromPairs = pairs.filter((p) => p.countryLabel === 'Germany').reduce((s, p) => s + p.live + p.removed, 0);
    const enigmaUs1FromPairs = pairs.filter((p) => p.proxyLabel === 'Enigma-US1').reduce((s, p) => s + p.live + p.removed, 0);

    expect(germanyFromPairs).toBe(kpis.byCountry['DE'].live + kpis.byCountry['DE'].removed);
    expect(enigmaUs1FromPairs).toBe(kpis.byProxy['enigma-us1'].live + kpis.byProxy['enigma-us1'].removed);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/queries.test.ts -t "byCountryProxy"`
Expected: FAIL — `kpis.byCountryProxy` is `undefined` (the field doesn't exist on the returned object yet).

- [ ] **Step 3: Implement `addToPairBreakdown` and wire it in**

In `src/lib/queries.ts`, add a new helper directly after the existing `addToBreakdown` function (currently ends at line 536):

```ts
function addToPairBreakdown(
  map: Record<string, CountBreakdownPair>,
  countryLabelRaw: string,
  proxyLabelRaw: string,
  kind: 'live' | 'removed',
) {
  const countryLabel = canonicalCountryName(countryLabelRaw);
  const proxyLabel = canonicalProxyName(proxyLabelRaw);
  const key = `${canonicalCountryKey(countryLabel)}::${canonicalProxyKey(proxyLabel)}`;
  if (!map[key]) map[key] = { countryLabel, proxyLabel, live: 0, removed: 0 };
  map[key][kind]++;
}
```

Add the `CountBreakdownPair` type to the existing type-only import from `../types/brand-entry.ts` at the top of the file (currently `import type { BrandEntry, TabKpis, BrandKpis, CountBreakdown } from '../types/brand-entry.ts';` at line 15):

```ts
import type { BrandEntry, TabKpis, BrandKpis, CountBreakdown, CountBreakdownPair } from '../types/brand-entry.ts';
```

In `computeTabKpisFromEntries`, declare the new map alongside `byCountry`/`byProxy` (currently lines 711-712):

```ts
  const byCountry: Record<string, CountBreakdown> = {};
  const byProxy: Record<string, CountBreakdown> = {};
  const byCountryProxy: Record<string, CountBreakdownPair> = {};
```

Populate it in both branches of the classification loop (currently lines 723-731), immediately after each existing pair of `addToBreakdown` calls:

```ts
    if (c.overall === 'live') {
      live++;
      addToBreakdown(byCountry, resolveCountryLabel(d, tab), 'live', canonicalCountryKey, canonicalCountryName);
      addToBreakdown(byProxy, resolveProxyLabel(d['Proxy Used']), 'live', canonicalProxyKey, canonicalProxyName);
      addToPairBreakdown(byCountryProxy, resolveCountryLabel(d, tab), resolveProxyLabel(d['Proxy Used']), 'live');
    } else if (c.overall === 'removed') {
      removed++;
      addToBreakdown(byCountry, resolveCountryLabel(d, tab), 'removed', canonicalCountryKey, canonicalCountryName);
      addToBreakdown(byProxy, resolveProxyLabel(d['Proxy Used']), 'removed', canonicalProxyKey, canonicalProxyName);
      addToPairBreakdown(byCountryProxy, resolveCountryLabel(d, tab), resolveProxyLabel(d['Proxy Used']), 'removed');
    }
```

Add `byCountryProxy` to the function's return object (currently line 757):

```ts
    activePlatforms: visiblePlatforms, customPlatforms, byCountry, byProxy, byCountryProxy, countries, proxies,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/queries.test.ts -t "byCountryProxy"`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full `queries.test.ts` suite to check for regressions**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: PASS, same total count as before plus 4.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "Populate byCountryProxy breakdown in computeTabKpisFromEntries"
```

---

## Task 3: `mergePairBreakdownMaps` in `overviewBreakdown.ts`

**Files:**
- Modify: `src/lib/overviewBreakdown.ts`
- Test: `src/lib/overviewBreakdown.test.ts`

**Interfaces:**
- Consumes: `CountBreakdownPair` from `../types/brand-entry.ts` (Task 1).
- Produces: `mergePairBreakdownMaps(maps: Record<string, CountBreakdownPair>[]): Record<string, CountBreakdownPair>`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/overviewBreakdown.test.ts`, after the closing of the `describe('mergeBreakdownMaps', ...)` block (after line 26):

```ts
import type { CountBreakdown, CountBreakdownPair } from '../types/brand-entry';
```

(Update the existing type-only import at line 3 to include `CountBreakdownPair` instead of adding a second import statement — final line 3 should read:)

```ts
import { mergeBreakdownMaps, mergePairBreakdownMaps, topNWithOther, mergeDistinctValues } from './overviewBreakdown';
import type { CountBreakdown, CountBreakdownPair } from '../types/brand-entry';
```

Then add the new describe block, right after `describe('mergeBreakdownMaps', ...)` closes (after line 26):

```ts
describe('mergePairBreakdownMaps', () => {
  it('sums live/removed across maps that share a composite key, keeping the first labels seen', () => {
    const a: Record<string, CountBreakdownPair> = { 'DE::enigma-us1': { countryLabel: 'Germany', proxyLabel: 'Enigma-US1', live: 2, removed: 1 } };
    const b: Record<string, CountBreakdownPair> = { 'DE::enigma-us1': { countryLabel: 'germany', proxyLabel: 'enigma-us1', live: 3, removed: 0 } };
    const merged = mergePairBreakdownMaps([a, b]);
    expect(merged).toEqual({ 'DE::enigma-us1': { countryLabel: 'Germany', proxyLabel: 'Enigma-US1', live: 5, removed: 1 } });
  });

  it('keeps disjoint composite keys from different tabs separate', () => {
    const a: Record<string, CountBreakdownPair> = { 'DE::enigma-us1': { countryLabel: 'Germany', proxyLabel: 'Enigma-US1', live: 1, removed: 0 } };
    const b: Record<string, CountBreakdownPair> = { 'FR::enigma-us2': { countryLabel: 'France', proxyLabel: 'Enigma-US2', live: 0, removed: 2 } };
    const merged = mergePairBreakdownMaps([a, b]);
    expect(merged).toEqual({
      'DE::enigma-us1': { countryLabel: 'Germany', proxyLabel: 'Enigma-US1', live: 1, removed: 0 },
      'FR::enigma-us2': { countryLabel: 'France', proxyLabel: 'Enigma-US2', live: 0, removed: 2 },
    });
  });

  it('returns an empty object for an empty input list', () => {
    expect(mergePairBreakdownMaps([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/overviewBreakdown.test.ts -t "mergePairBreakdownMaps"`
Expected: FAIL — `mergePairBreakdownMaps` is not exported from `./overviewBreakdown`.

- [ ] **Step 3: Implement `mergePairBreakdownMaps`**

In `src/lib/overviewBreakdown.ts`, add the import and new function right after `mergeBreakdownMaps` (currently ends at line 13):

Update line 1's import:
```ts
import type { CountBreakdown, CountBreakdownPair } from '../types/brand-entry';
```

Add after `mergeBreakdownMaps`:
```ts
export function mergePairBreakdownMaps(
  maps: Record<string, CountBreakdownPair>[],
): Record<string, CountBreakdownPair> {
  const merged: Record<string, CountBreakdownPair> = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      if (!merged[key]) merged[key] = { countryLabel: value.countryLabel, proxyLabel: value.proxyLabel, live: 0, removed: 0 };
      merged[key].live += value.live;
      merged[key].removed += value.removed;
    }
  }
  return merged;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/overviewBreakdown.test.ts`
Expected: PASS, full file (all pre-existing tests plus the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/overviewBreakdown.ts src/lib/overviewBreakdown.test.ts
git commit -m "Add mergePairBreakdownMaps for the Overview country x proxy matrix"
```

---

## Task 4: `CountryProxyMatrix` presentational component

**Files:**
- Create: `src/components/CountryProxyMatrix.tsx`

**Interfaces:**
- Consumes: `BreakdownCard` type from `../lib/overviewBreakdown` (already defined — see `src/lib/overviewBreakdown.ts:15-25`); `SuccessRateBadge` default export from `./SuccessRateBadge`; default `Tooltip` from `./Tooltip`; `countryFlagImageUrl` from `../lib/countryFlags`; `proxyIconUrl` from `../lib/proxyIcons`; `categoricalColorForKey` from `../lib/categoricalColor`; `NO_PROXY_LABEL` from `../lib/proxyAliases`; `Globe`, `Shield` icons from `lucide-react`.
- Produces: default export `CountryProxyMatrix(props: CountryProxyMatrixProps)`, with:
  ```ts
  interface CountryProxyMatrixProps {
    countries: BreakdownCard[];
    proxies: BreakdownCard[];
    getCell: (countryKey: string, proxyKey: string) => { live: number; removed: number };
    onCellClick: (country: BreakdownCard, proxy: BreakdownCard) => void;
  }
  ```
  This is what Task 5 (`Overview.tsx`) wires up.

- [ ] **Step 1: Write the component**

Create `src/components/CountryProxyMatrix.tsx`:

```tsx
import { Globe, Shield } from 'lucide-react';
import SuccessRateBadge from './SuccessRateBadge';
import Tooltip from './Tooltip';
import { countryFlagImageUrl } from '../lib/countryFlags';
import { proxyIconUrl } from '../lib/proxyIcons';
import { categoricalColorForKey } from '../lib/categoricalColor';
import { NO_PROXY_LABEL } from '../lib/proxyAliases';
import type { BreakdownCard } from '../lib/overviewBreakdown';

export interface CountryProxyMatrixProps {
  countries: BreakdownCard[];
  proxies: BreakdownCard[];
  getCell: (countryKey: string, proxyKey: string) => { live: number; removed: number };
  onCellClick: (country: BreakdownCard, proxy: BreakdownCard) => void;
}

// Full country x proxy grid (both axes uncapped, per direct user decision —
// unlike Proxy Breakdown's own top-8-plus-Other cap) with a sticky first
// column and sticky header row so identity stays visible while scrolling a
// grid that can be both wide (many proxies) and tall (many countries).
export default function CountryProxyMatrix({ countries, proxies, getCell, onCellClick }: CountryProxyMatrixProps) {
  return (
    <div className="max-h-[32rem] overflow-auto rounded-xl border border-slate-200 bg-white">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium text-slate-500">
              Country \ Proxy
            </th>
            {proxies.map((proxy) => {
              const isNoProxy = proxy.label === NO_PROXY_LABEL;
              const muted = proxy.isOther || isNoProxy;
              const color = muted ? '#64748b' : categoricalColorForKey(proxy.key);
              const iconUrl = muted ? null : proxyIconUrl(proxy.label);
              return (
                <th
                  key={proxy.key}
                  className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-2 py-2 text-left font-medium text-slate-500"
                >
                  <Tooltip content={proxy.label} className="flex max-w-[6rem] items-center gap-1 truncate">
                    {iconUrl
                      ? <img src={iconUrl} alt={proxy.label} className="size-3.5 shrink-0 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      : <Shield className="size-3.5 shrink-0" style={{ color }} />}
                    <span className="truncate">{proxy.label}</span>
                  </Tooltip>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {countries.map((country) => {
            const isUnknown = country.key === 'unknown';
            const countryMuted = country.isOther || isUnknown;
            const countryColor = countryMuted ? '#64748b' : categoricalColorForKey(country.key);
            const flagUrl = countryMuted ? null : countryFlagImageUrl(country.label);
            return (
              <tr key={country.key} className="border-b border-slate-100 last:border-b-0">
                <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    {flagUrl
                      ? <img src={flagUrl} alt={country.label} className="size-3.5 shrink-0 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      : <Globe className="size-3.5 shrink-0" style={{ color: countryColor }} />}
                    <span className="max-w-[9rem] truncate" title={country.label}>{country.label}</span>
                  </div>
                </td>
                {proxies.map((proxy) => {
                  const cell = getCell(country.key, proxy.key);
                  const total = cell.live + cell.removed;
                  return (
                    <td key={proxy.key} className="px-2 py-1.5 text-center">
                      {total === 0 ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onCellClick(country, proxy)}
                          className="rounded transition-transform hover:scale-105"
                        >
                          <SuccessRateBadge live={cell.live} removed={cell.removed} size="sm" />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Verify the file compiles in isolation**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep CountryProxyMatrix`
Expected: no output (no errors referencing this new file). It's fine if this command also can't run in isolation depending on the project's tsconfig references — if so, skip straight to Task 5's full `npm run build`, which will cover this file too.

- [ ] **Step 3: Commit**

```bash
git add src/components/CountryProxyMatrix.tsx
git commit -m "Add CountryProxyMatrix presentational component"
```

---

## Task 5: Wire into `Overview.tsx`

**Files:**
- Modify: `src/pages/Overview.tsx`

**Interfaces:**
- Consumes: `mergePairBreakdownMaps` (Task 3), `CountryProxyMatrix` (Task 4), `TabKpis.byCountryProxy` (Task 2).

- [ ] **Step 1: Update `EMPTY_KPIS`**

In `src/pages/Overview.tsx`, add `byCountryProxy: {}` to the `EMPTY_KPIS` constant (currently lines 74-86), immediately after `byProxy: {},`:

```ts
const EMPTY_KPIS: TabKpis = {
  total: 0, live: 0, removed: 0, done: 0, pending: 0, onPause: 0, notDone: 0,
  tp: { live: 0, removed: 0 },
  ag: { live: 0, removed: 0 },
  cg: { live: 0, removed: 0 },
  wo: { live: 0, removed: 0 },
  activePlatforms: [],
  customPlatforms: [],
  byCountry: {},
  byProxy: {},
  byCountryProxy: {},
  countries: [],
  proxies: [],
};
```

- [ ] **Step 2: Add the import**

Update the existing `overviewBreakdown` import (currently line 15) to include `mergePairBreakdownMaps`:

```ts
import { mergeDistinctValues, mergeBreakdownMaps, mergePairBreakdownMaps, topNWithOther, type BreakdownCard, type BreakdownSortMode } from '../lib/overviewBreakdown';
```

Add a new import for the component, alongside the other component imports near the top (after the `BreakdownStatGrid` import on line 14):

```ts
import CountryProxyMatrix from '../components/CountryProxyMatrix';
```

- [ ] **Step 3: Compute the merged pair map and matrix axes**

In the render body, immediately after the existing `proxyCoverage` computation (currently lines 656-657, right before `function openDimensionSlice(...)`), add:

```ts
  const countryProxyMerged = mergePairBreakdownMaps(state.tabs.map((t) => t.kpis.byCountryProxy));
  // Both axes uncapped (topN=Infinity), per direct user decision — unlike
  // Proxy Breakdown's own top-8-plus-Other cap. Reuses the exact same
  // sort-mode toggles as Country/Proxy Breakdown above, so this matrix's
  // row/column order always tracks those two sections.
  const matrixProxyCards = topNWithOther(proxyMerged, Infinity, canonicalProxyKey(NO_PROXY_LABEL), proxySortMode);

  function getCountryProxyCell(countryKey: string, proxyKey: string): { live: number; removed: number } {
    const pair = countryProxyMerged[`${countryKey}::${proxyKey}`];
    return pair ? { live: pair.live, removed: pair.removed } : { live: 0, removed: 0 };
  }
```

(Note: row axis reuses the existing `countryCards` computed above at line 651 — no new variable needed for that.)

- [ ] **Step 4: Add the drill-down handler**

Immediately after the existing `openDimensionSlice` function (currently ends at line 685), add:

```ts
  function openCountryProxySlice(country: BreakdownCard, proxy: BreakdownCard) {
    const key = `${country.key}::${proxy.key}`;
    const flagUrl = countryFlagImageUrl(country.label);
    const icon = flagUrl
      ? <img src={flagUrl} alt={country.label} className="size-4 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      : <Globe className="size-4 text-slate-500" />;
    const rowIcon = flagUrl
      ? <img src={flagUrl} alt={country.label} className="size-3.5 shrink-0 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      : <Globe className="size-3.5 shrink-0 text-slate-400" />;
    setSliceModal({
      title: `${country.label} — ${proxy.label}`,
      headerIcon: icon,
      rowIcon,
      kind: 'live',
      rows: state.tabs.map((t) => ({
        tab: t.tab,
        count: t.kpis.byCountryProxy[key]?.live ?? 0,
      })),
      linkFor: (tab) =>
        `/brands/${tabToSlug(tab)}?status=live&country=${encodeURIComponent(country.label)}&proxy=${encodeURIComponent(proxy.label)}${platformFilter.length > 0 ? `&platform=${platformFilter.join(',')}` : ''}`,
    });
  }
```

- [ ] **Step 5: Add the new section to the JSX**

In the JSX, immediately after the Proxy Breakdown `</section>` (currently line 1200, right before the `{kpiModal && (` block), add:

```tsx
      {/* Country x Proxy performance matrix */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-800">Country × Proxy Performance</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Success rate for every country/proxy combination — click a cell to see it by brand tab.
          </p>
        </div>
        {state.loading ? (
          <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
        ) : countryCards.length === 0 || matrixProxyCards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">No country/proxy data</p>
        ) : (
          <CountryProxyMatrix
            countries={countryCards}
            proxies={matrixProxyCards}
            getCell={getCountryProxyCell}
            onCellClick={openCountryProxySlice}
          />
        )}
      </section>
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: PASS, no TypeScript errors (per this project's own established rule, `tsc --noEmit` alone is insufficient here — `npm run build` is the real check).

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, same or higher total than before this plan started (7 new tests added across Tasks 2 and 3: 4 in `queries.test.ts`, 3 in `overviewBreakdown.test.ts`).

- [ ] **Step 8: Manual browser verification**

Start the dev server (`npm run dev`) and open Overview with real data logged in:
- Confirm the new "Country × Proxy Performance" section renders below Proxy Breakdown, with a sticky first column and sticky header row when scrolling the grid in both directions.
- Confirm a cell with data shows a colored success-rate badge; an empty combination shows a muted dash and is not clickable.
- Click a populated cell; confirm the modal opens with the correct title (`<Country> — <Proxy>`), correct per-tab counts, and that its "View" links navigate to that tab's Brand Tabs page pre-filtered by both country and proxy.
- Toggle Country Breakdown's and Proxy Breakdown's own sort-mode pills; confirm the matrix's row/column order updates in sync.
- Apply a date range and/or the page's country/proxy/platform filters; confirm the matrix's numbers change consistently with Country Breakdown/Proxy Breakdown above it (no drift).
- Confirm no console errors.

- [ ] **Step 9: Commit**

```bash
git add src/pages/Overview.tsx
git commit -m "Add Country x Proxy Performance matrix section to Overview"
```

---

## Self-Review Notes (already applied above)

- **Spec coverage:** Data layer (Task 1-2), aggregation (Task 3), component (Task 4), wiring + interaction + placement + empty/loading states (Task 5) — all spec sections have a corresponding task.
- **Type consistency:** `CountBreakdownPair` (Task 1) is the type threaded through Task 2's `addToPairBreakdown`, Task 3's `mergePairBreakdownMaps`, and consumed only via `BreakdownCard`/plain `{live, removed}` objects by Task 4/5 — no renamed fields across tasks.
- **Placeholder scan:** no TBD/TODO placeholders remain in any step's code blocks.
