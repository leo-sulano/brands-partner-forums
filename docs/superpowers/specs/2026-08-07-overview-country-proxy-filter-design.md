# Overview — Country & Proxy Filter + Breakdown Sections

## Purpose

The Overview page (`src/pages/Overview.tsx`) currently supports a Date Range
filter (Topbar, backed by `from`/`to` URL params) that scopes the 3 top KPI
cards, the per-tab "Brands Performance" grid, and the "Platform Breakdown"
donut section. `BrandGroup.tsx` (the per-tab brand view) already has working
Country and Proxy filters — Country derived via `getEntryCountry()`
(`src/lib/tab-configs.ts`), Proxy read directly from each entry's
`data['Proxy Used']`. Overview has no equivalent: no way to scope the whole
page to a Country or Proxy, and no visibility into how Live/Removed breaks
down by either dimension across all 11 tabs.

This adds Country and Proxy as a second and third global filter on Overview
(alongside Date Range), plus two new donut-card sections — "Country
Breakdown" and "Proxy Breakdown" — mirroring the existing "Platform
Breakdown" section's visual style.

## Current behavior (for reference)

- `Overview.tsx` calls `fetchTabKpis(tab, dateFrom, dateTo,
  removedPlatformBrands)` once per operational tab, getting back a `TabKpis`
  aggregate (total/live/removed/done/pending/onPause/notDone, plus
  per-platform live/removed for tp/ag/cg/wo). It does not retain or see
  individual entries.
- `fetchTabKpis` (`src/lib/queries.ts`) fetches that tab's full entry set and
  headers, then calls the pure `computeTabKpisFromEntries`, which does all
  date-gating and status classification in one pass over the entries.
- Date Range's controls live in `Topbar.tsx`, gated on `pathname === '/'`,
  reading/writing `from`/`to` URL search params directly — Topbar does no
  data fetching of its own.
- `BrandGroup.tsx` has a reusable `BrandFilterDropdown` component (search +
  select, "All <noun>s" default state) used for its own Brand/Agent/Proxy/
  Country filters. It is defined locally in that file, not exported.
- `getEntryCountry(data, tab)` can return `''` if no Country column, no
  derivable Account-embedded country, and no tab default exists.
  `data['Proxy Used']` is frequently blank (TP-only tabs don't use a proxy at
  all; only tabs whose AG/CG/WO checks route through a proxy populate it).

## New behavior

### 1. Filtering

`computeTabKpisFromEntries` gains two new optional parameters,
`countryFilter?: string` and `proxyFilter?: string`. Before the existing
per-entry loop runs, entries are pre-filtered:

- Country match: `getEntryCountry(entry.data, tab).toLowerCase() ===
  countryFilter.toLowerCase()` (only applied if `countryFilter` is set).
- Proxy match: `(entry.data['Proxy Used'] ?? '').trim().toLowerCase() ===
  proxyFilter.toLowerCase()` (only applied if `proxyFilter` is set).

Both filters compose with each other and with the existing `dateFrom`/
`dateTo` gating (all are AND'd together, same as adding another WHERE
clause). Every existing output of `computeTabKpisFromEntries` — the tab
aggregate, the per-platform live/removed counts — is computed from this same
filtered subset, so Country/Proxy filtering automatically flows through to
the 3 top KPI cards, the "Brands Performance" tile grid, and "Platform
Breakdown", exactly the way Date Range already does today. No separate
filtering logic is added at the Overview page level.

`fetchTabKpis` gains the same two parameters and passes them straight
through.

### 2. Breakdown maps (Country Breakdown / Proxy Breakdown sections)

Within the same per-entry loop that already classifies each (filtered) entry
as live/removed/done/pending/onPause/notDone (the existing `statuses`-based
classification used for the tab-level `live`/`removed` counters — *not* the
per-platform tp/ag/cg/wo counters, which apply the separate
platform-removed-brand exclusion), two new maps are populated whenever an
entry classifies as live or removed:

```ts
interface CountBreakdown { label: string; live: number; removed: number }
byCountry: Record<string, CountBreakdown>  // key = country value, lowercased+trimmed
byProxy:   Record<string, CountBreakdown>  // key = proxy value, lowercased+trimmed
```

- `label` holds the first-seen display casing for that key (so "USA" from
  one entry and "usa" from another merge into a single bucket, keeping
  whichever casing was encountered first).
- An entry with a blank/unresolvable Country, or a blank Proxy Used value,
  is skipped for that specific map — it still counts toward every other
  existing total, it just doesn't contribute a bucket to Country Breakdown
  or Proxy Breakdown. This matches how Platform Breakdown already only
  tallies non-blank per-platform statuses; there's no "Unknown" or "No
  Proxy" bucket.
- Because these maps are built from the *already-filtered* entries, a
  Country Breakdown reflects the active Date Range + Proxy filter (and
  trivially, the active Country filter, if one is set — the section then
  just shows the single selected country). Same relationship in reverse for
  Proxy Breakdown.

### 3. Distinct value lists (dropdown options)

Separately, `computeTabKpisFromEntries` also computes `countries: string[]`
and `proxies: string[]` — the full distinct display values found in that
tab's entries, deduplicated case-insensitively (first-seen casing kept),
sorted alphabetically. These are built from the tab's **unfiltered** entries
(no date/country/proxy filtering applied), matching the precedent set by
`BrandGroup.tsx`'s own `uniqueCountries`/`uniqueProxies` — so the dropdown's
available options never shrink or reorder as filters are applied elsewhere
on the page.

### 4. `TabKpis` type

`src/types/brand-entry.ts`'s `TabKpis` gains:

```ts
byCountry: Record<string, CountBreakdown>;
byProxy: Record<string, CountBreakdown>;
countries: string[];
proxies: string[];
```

`Overview.tsx`'s `EMPTY_KPIS` fallback is updated with empty defaults for
all four.

### 5. Overview page: filter row

A new filter row is added inside `Overview.tsx`'s own render, near the top
of the page (above the "Global KPIs" cards) — not in `Topbar.tsx`. Topbar's
Date Range control is presentation-only (reads/writes URL params, no data
fetching); populating Country/Proxy dropdowns needs the distinct-value lists
Overview already computes as a side effect of its existing per-tab fetch, so
keeping the new controls in Overview avoids a second, duplicate fetch of all
entries across all tabs from Topbar.

- Two dropdowns (Country, Proxy) using the `BrandFilterDropdown` component,
  extracted from `BrandGroup.tsx` into `src/components/BrandFilterDropdown.tsx`
  (currently defined locally there; made reusable with no behavior change).
- Options come from merging every tab's `countries`/`proxies` arrays
  (case-insensitive merge, first-seen casing wins), deduped and sorted.
- Selecting a value writes it to the URL (`country` / `proxy` search
  params), matching the existing `from`/`to` pattern — shareable/bookmarkable
  URLs, consistent with Date Range.
- A "Clear" button appears when either filter is active, clearing both (same
  UX as Date Range's Clear button).
- `loadData`'s dependency array/effect picks up `country`/`proxy` alongside
  `dateFrom`/`dateTo`, re-fetching on change.

### 6. Overview page: new sections

Two new sections are added after the existing "Platform Breakdown" section,
in the same visual style (donut card grid, live/removed slices, center
percentage, click-through legend):

- **Country Breakdown** — one card per country, from the merged `byCountry`
  totals across all tabs.
- **Proxy Breakdown** — one card per proxy, from the merged `byProxy`
  totals across all tabs.

For each section: sort merged entries by total volume (`live + removed`)
descending, show the top 8 as individual cards, and if more than 8 distinct
values exist, collapse the remainder into one additional "Other" card
(summed live/removed, not individually broken out). "Other" is
non-interactive (no click-through) — matching the existing disabled-when-
`total === 0` pattern already used elsewhere on this page, since there's no
single tab-by-tab breakdown that would make sense to show for an aggregate
bucket. If a section computes zero total entries (e.g. no tab has a Proxy
Used value at all, or the active filter combination excludes everything),
it renders a small empty state ("No proxy data" / "No country data") instead
of an empty grid.

Clicking a Live/Removed slice on a Country or Proxy card opens a modal
listing per-tab contribution to that slice — reusing the existing
`PlatformBreakdownModal` component, generalized to take a label/icon pair
instead of being hardcoded to `PLATFORM_LOGOS`/platform names, so the same
modal component serves all three sections (Platform, Country, Proxy) without
duplicating ~90 lines three times. `KpiBreakdownModal` (the Total/Live/
Removed drill-down) is untouched — it isn't dimension-specific.

## Testing

Unit tests (co-located with `computeTabKpisFromEntries`'s existing tests)
covering:

- `countryFilter`/`proxyFilter` each narrow the returned aggregate counts
  correctly, and compose correctly with each other and with `dateFrom`/
  `dateTo`.
- `byCountry`/`byProxy` bucket entries case-insensitively, keep first-seen
  display casing, and exclude blank values.
- `countries`/`proxies` distinct lists are unaffected by any active filter
  (built from unfiltered entries).
- Top-8-plus-"Other" grouping math in the Overview-level merge (sorts
  correctly, sums the remainder correctly, omits "Other" when there are ≤8
  distinct values).

No schema change — Country/Proxy are existing per-entry `data` fields, not
new columns. No changes to `BrandGroup.tsx`'s own Country/Proxy filtering
behavior beyond extracting `BrandFilterDropdown` into a shared component (a
non-behavioral refactor).

## Out of scope

- Multi-select filtering (single-select only, matching Date Range's
  simplicity).
- Faceting the distinct-value dropdown lists by other active filters (they
  stay static/unfiltered, matching `BrandGroup.tsx` precedent).
- Any change to the known, pre-existing `BrandGroup.tsx` table-row date
  filter gap (documented separately in `docs/task-history.md`'s Known
  Issues) — unrelated to this feature.
