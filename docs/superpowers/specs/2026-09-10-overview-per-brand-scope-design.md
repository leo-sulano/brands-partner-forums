# Overview Per-Brand Scope — Design

## Problem

Overview (`src/pages/Overview.tsx`) always aggregates across every operational
tab. Its "Brands" view lists individual brands' basic live/removed/platform
counts, but the rest of the page — Global KPIs, Platform Breakdown, Country
Breakdown, Proxy Breakdown, and the Country×Proxy Matrix — always stays
aggregated across all tabs and brands regardless of that view toggle. There is
no way to see "this one brand's" version of the whole Overview page.

## Goal

Let a user pick a single brand (across any tab) and have the *entire*
Overview page re-scope to that brand's data only — Global KPIs, the
tab/brand summary section, Platform Breakdown, Country Breakdown, Proxy
Breakdown, and the Country×Proxy Matrix — composable with the existing
Date/Country/Proxy/Platform filters, and persisted in the URL like every
other Overview filter.

## Non-goals

- No change to `BrandGroup.tsx` (the per-tab Brand Tabs page) or its own
  `?brand=` deep-link filter — that is a separate, pre-existing mechanism
  with its own (looser) brand-matching semantics and is out of scope here.
- No change to `getBrandGroup`/brand-alias grouping — this feature groups
  brand rows the same way Overview's existing "Brands" view already does
  (`normalizeBrandKey`, case/whitespace-insensitive), not via alias groups.
- Score Summary, Schedule Planner, and Ask AI are untouched.

## Design

### 1. Data layer (`src/lib/queries.ts`)

Add an optional `brandFilter?: string` parameter (raw brand string, matched
via the existing `normalizeBrandKey`) to `computeTabKpisFromEntries` and
`fetchTabKpis`, as the new last positional parameter (after `platformFilter`).

Inside `computeTabKpisFromEntries`, brand-scope `entries` to just the rows
matching `brandFilter` as the very first step — before deriving
`countries`/`proxies` and before `filterByCountryAndProxy` — so every
returned field (KPI counts, `byCountry`/`byProxy`/`byCountryProxy`,
`customPlatforms`, and even the `countries`/`proxies` lists that drive the
Country/Proxy filter dropdowns) is scoped to that one brand. This reuses the
exact same classification pipeline as the whole-tab case, so a brand-scoped
result can never disagree with the tab-level numbers it's drawn from.

`computeBrandKpisFromEntries`/`fetchBrandKpis` (which power the existing
"Brands" view and, new in this feature, the brand picker's directory) are
unchanged.

### 2. Brand picker

A new brand-picker dropdown in Overview's filter bar, built on the existing
`MultiSelectDropdown` component used single-select style: its `onChange`
wrapper always collapses the selection down to the most-recently-toggled
value (0 or 1), so `values` passed to the component is always length 0 or 1.

Options are `{ value: '<tabSlug>::<brandRawName>', label: '<brand> — <tab display name>' }`
across every active operational tab. The composite key is needed since brand
names aren't guaranteed unique across tabs (`tabToSlug`/`slugToTab`, already
used elsewhere for URL-safe tab identifiers, round-trip it).

The option list is lazy-loaded — fetched once, the first time the dropdown
is opened, not on initial page load (matching the existing "Brands" view's
own lazy-fetch precedent, and avoiding doubling Overview's initial per-tab
fetch cost). Fetched via the existing `fetchBrandKpis(tab)` called with no
filters (dateFrom/dateTo/country/proxy/platform all omitted) for every
active tab in parallel, flattened to `{ tab, brand }[]` — this is a pure
reuse of the existing brand-bucketing logic, not a new duplicate query.
`MultiSelectDropdown` gains one new optional prop, `onOpen?: () => void`,
fired the first time its menu opens, so Overview can trigger this fetch
lazily without a bespoke dropdown component.

The picker's option list is deliberately unfiltered by the current
Date/Country/Proxy/Platform filters — it should never look like a brand
"disappeared" from the picker just because an unrelated filter happens to
exclude all of its current rows.

### 3. URL param & scoping

New `?brand=<tabSlug>::<brandRawName>` query param (brand name
URL-encoded), read/written the same way every other Overview filter already
is (`useSearchParams`). Decoded via `slugToTab` for the tab half.

When present, `loadData`'s tab list becomes just that one tab (instead of
`getActiveOperationalTabs()`), and its `fetchTabKpis` call passes the
decoded brand name as `brandFilter`. `state.tabs` then holds exactly one
already brand-scoped `TabSummary` — every section that derives from
`state.tabs` (Global KPI totals, `platformData`, `countryMerged`/
`proxyMerged`/`countryProxyMerged`, the Country×Proxy Matrix) is therefore
automatically brand-scoped with no further changes to that logic.

The "Brands" per-brand-list fetch (`loadBrandData`/`view === 'brands'`) is
skipped while a brand is selected — a per-brand breakdown of an
already-single-brand scope has nothing to show.

### 4. UI changes (`Overview.tsx`)

- New brand dropdown in the filter bar, placed first (before
  Country/Proxy/Platform) as the primary scope control.
- While a brand is selected:
  - The "Brand Tabs / Brands" view toggle and its card grid are replaced by
    a single summary card for that brand: brand name as the title, the tab's
    display name as a subtitle, total/live/removed, and the same
    `PlatformRow`/`CustomPlatformRow` rows the existing cards already use —
    linking to that brand's row on its own Brand Tab page
    (`brandRowHref`, already defined).
  - Global KPI card hints (`"across all brand tabs"` etc.) and the Platform/
    Country/Proxy Breakdown and Matrix section subtitles swap to name the
    selected brand instead.
- The existing filter-bar "Clear" button and its `anyFilterActive` check are
  extended to also clear/include `brand`.
- Composes with Date/Country/Proxy/Platform filters exactly like today —
  they're independent params passed alongside `brandFilter` into the same
  `fetchTabKpis` call.

### 5. Testing

- Unit tests for `computeTabKpisFromEntries`'s new `brandFilter` param:
  case/whitespace-insensitive matching, scoping every returned field
  (including `countries`/`proxies` and `byCountryProxy`), and a
  non-matching brand producing an all-zero result rather than `null` (a tab
  is never truly excluded by `brandFilter` the way `platformFilter` can
  exclude it — an unmatched brand is just an empty result for that tab).
- `npm run build`.
- Manual verification in the browser: select a brand, confirm every section
  (KPIs, summary card, Platform/Country/Proxy Breakdown, Matrix) updates to
  that brand's real data; confirm it composes correctly with an existing
  Country or Platform filter; confirm Clear restores the full multi-tab
  view; confirm the URL round-trips (reload with `?brand=...` present lands
  back on the same scoped view).

## Open questions

None — both key UX decisions (full-page re-scope vs. list-only, and a
single cross-tab searchable brand picker) were confirmed directly with the
user during brainstorming.
