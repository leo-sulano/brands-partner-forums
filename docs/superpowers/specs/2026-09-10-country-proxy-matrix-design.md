# Country × Proxy Performance Matrix — Design

**Date:** 2026-09-10
**Status:** Approved (chat design), pending implementation plan.

## Problem

Overview's Country Breakdown and Proxy Breakdown are both single-dimension views (published-vs-removed per country, published-vs-removed per proxy). There is no way to see how the two dimensions interact — e.g. "is Germany doing worse specifically on Proxy X, or across all proxies?" This is exactly the kind of question that only a cross-tabulation answers.

## Goal

Add a new Overview section, **Country × Proxy Performance**, directly after the existing Proxy Breakdown section, showing a success-rate matrix: one row per country, one column per proxy, one cell = that combination's published/removed performance across all 11 tabs (respecting the page's existing date/country/proxy/platform filters, same as every other Overview section).

Per direct user confirmation, both axes are **uncapped** — every distinct country and every distinct proxy gets its own row/column, no top-N folding into "Other" (unlike Proxy Breakdown's existing top-8-plus-Other cap).

## Data Layer

### `src/types/brand-entry.ts`
Add:
```ts
export interface CountBreakdownPair {
  countryLabel: string;
  proxyLabel: string;
  live: number;
  removed: number;
}
```
Add `byCountryProxy: Record<string, CountBreakdownPair>` to `TabKpis`, alongside the existing `byCountry`/`byProxy`. Key shape: `` `${countryKey}::${proxyKey}` `` using the same `canonicalCountryKey`/`canonicalProxyKey` functions already used for `byCountry`/`byProxy`'s own keys.

### `src/lib/queries.ts`
`computeTabKpisFromEntries` already has one loop over `filteredEntries` that classifies each entry (`classifyEntry`) and, on `c.overall === 'live' | 'removed'`, calls `addToBreakdown(byCountry, ...)` and `addToBreakdown(byProxy, ...)`. Add a third call in the same two branches building `byCountryProxy`, using a small new helper:

```ts
function addToPairBreakdown(
  map: Record<string, CountBreakdownPair>,
  countryLabel: string,
  proxyLabel: string,
  kind: 'live' | 'removed',
) {
  const key = `${canonicalCountryKey(countryLabel)}::${canonicalProxyKey(proxyLabel)}`;
  if (!map[key]) {
    map[key] = { countryLabel: canonicalCountryName(countryLabel), proxyLabel: canonicalProxyName(proxyLabel), live: 0, removed: 0 };
  }
  map[key][kind]++;
}
```

Called at each existing `addToBreakdown(byCountry, resolveCountryLabel(d, tab), ...)` / `addToBreakdown(byProxy, resolveProxyLabel(d['Proxy Used']), ...)` site with the exact same two already-resolved label strings (`resolveCountryLabel(d, tab)`, `resolveProxyLabel(d['Proxy Used'])`) — never re-derived — so the pair map can never disagree with the two single-dimension maps for the same entry. Returned in `TabKpis` alongside `byCountry`/`byProxy`.

No new query, no new Supabase call — this rides the same entries array and the same live/removed classification `byCountry`/`byProxy` already use, so it can't drift from them (the entries counted per cell always sum correctly across the row/column to match the existing single-dimension totals).

## Aggregation Layer

### `src/lib/overviewBreakdown.ts`
New function, mirroring `mergeBreakdownMaps`:
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

## Overview.tsx Wiring

- `countryProxyMerged = mergePairBreakdownMaps(state.tabs.map((t) => t.kpis.byCountryProxy))`
- Row axis: reuse the already-computed `countryCards` (`topNWithOther(countryMerged, Infinity, undefined, countrySortMode)`) — same list, same order, same sort toggle as Country Breakdown above it.
- Column axis: `proxyMatrixCards = topNWithOther(proxyMerged, Infinity, canonicalProxyKey(NO_PROXY_LABEL), proxySortMode)` — same function Proxy Breakdown uses, just `topN = Infinity` instead of `BREAKDOWN_TOP_N`, so every proxy gets its own column and "No Proxy" still pins last.
- Cell lookup: `countryProxyMerged[`${row.key}::${col.key}`] ?? { live: 0, removed: 0 }`.
- No new component state — the matrix's row/column order tracks `countrySortMode`/`proxySortMode`, which already exist for the two sections above it.

## Component: `src/components/CountryProxyMatrix.tsx`

Props:
```ts
interface CountryProxyMatrixProps {
  countries: BreakdownCard[];
  proxies: BreakdownCard[];
  getCell: (countryKey: string, proxyKey: string) => { live: number; removed: number };
  onCellClick: (country: BreakdownCard, proxy: BreakdownCard) => void;
}
```

- Renders a `<table>` inside an `overflow-auto` container. First column (country label + flag/globe icon, same icon resolution `BreakdownRankedList`'s rows already use) is `sticky left-0`; header row (proxy label + shield/proxy icon) is `sticky top-0`, matching the sticky-both-axes pattern already established in `SchedulePlanner.tsx`.
- Cell: if `live + removed === 0`, render a muted `—`, not interactive. Otherwise render `<SuccessRateBadge live={cell.live} removed={cell.removed} size="sm" />` inside a `<button>` calling `onCellClick(country, proxy)` — `SuccessRateBadge` is reused unmodified, including its own hover tooltip (exact live/removed counts).
- Column headers truncate long proxy names with a `Tooltip` (existing component), matching the width-constrained truncation `BreakdownRankedList` already applies to its row labels.

## Interaction

Clicking a populated cell opens the **existing** `SliceBreakdownModal` (no new modal type) — mirrors `openDimensionSlice`, just scoped to a pair instead of one dimension:

```ts
function openCountryProxySlice(country: BreakdownCard, proxy: BreakdownCard) {
  const key = `${country.key}::${proxy.key}`;
  setSliceModal({
    title: `${country.label} — ${proxy.label}`,
    headerIcon: <flag icon for country.label>,
    rowIcon: <flag icon for country.label>,
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

Defaults to `kind: 'live'`, matching `BreakdownStatGrid`'s existing "whole-tile click defaults to live" convention — the badge shown on the cell already reads as a published/live rate, so this is the expected outcome of clicking it. (This does not change the existing single-dimension `openDimensionSlice`, which still fixes `kind` from which live/removed bar segment the user clicked in Country/Proxy Breakdown.)

## Section Placement & Empty/Loading States

New `<section>` in `Overview.tsx`, directly after the Proxy Breakdown `<section>` (between it and the modal-render block at the end of the component):
- Header: "Country × Proxy Performance", subtext "Success rate for every country/proxy combination — click a cell to see it by brand tab."
- Loading: skeleton block, same `animate-pulse` treatment as the two sections above it.
- Empty (`countryCards.length === 0 || proxyMatrixCards.length === 0`): same dashed-border "No data" placeholder text used elsewhere on this page.
- No new top-level filter controls — respects the page's existing date/country/proxy/platform filters for free, since it's built from the same already-filtered `state.tabs`.

## Non-Goals

- No schema/migration change — purely a client-side computed cross-tab of data already fetched for Country/Proxy Breakdown.
- No changes to Score Summary, Brand Tabs, Ask AI, or Schedule Planner — this is an Overview-only, additive section.
- No new sort/filter UI — row/column order is driven by the existing `countrySortMode`/`proxySortMode` toggles.
- Does not touch the existing `openDimensionSlice`/single-dimension Country or Proxy Breakdown behavior.

## Testing Plan

- `src/lib/queries.test.ts`: a handful of entries with known country+proxy+status combinations, asserting `computeTabKpisFromEntries(...).byCountryProxy` has the correct composite-keyed counts, and that per-cell sums roll up to match `byCountry`/`byProxy` totals for the same entries (the anti-drift guarantee).
- `src/lib/overviewBreakdown.test.ts`: `mergePairBreakdownMaps` merges two tabs' maps correctly, including the case where the same pair key appears in both.
- Manual/browser verification: open Overview with real data, confirm the matrix renders, sort toggles reorder rows/columns in sync with the two sections above, a populated cell opens the modal with the correct per-tab counts and working links, an empty cell is a non-interactive dash, and the whole page still works with date/country/proxy/platform filters applied.

## Tier Classification (per this project's CLAUDE.md)

Touches `computeTabKpisFromEntries` (`queries.ts`) — explicitly named as a Tier 3 trigger ("KPI computation"). Full pipeline: this spec → plan → implementation → self/whole-branch review → browser verification, per standing project rule. Given this is one self-contained, non-decomposable feature (not several independent subsystems), direct implementation with a careful final review pass is appropriate rather than a multi-agent fan-out — but the review and live-verification steps are not skipped.
