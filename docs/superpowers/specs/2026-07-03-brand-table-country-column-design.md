# Brand Tables — Country Column, Filter, and Sort

**Date:** 2026-07-03
**Status:** Approved

## Problem

Brand tab tables (`/brands/:tab`) don't show a Country column, even though Country data is already synced from the Google Sheet into every entry's `data` bag (`entries.data['Country']`). Users have no way to see or filter by country on any tab.

## Goal

Every brand tab shows a Country column immediately after Account, sortable like any other column, with a dropdown filter to narrow the table by country.

## Design

### Approach

Country is a schema-less field already flowing through `entries.data` — this is purely a whitelist + filter-wiring change in `BrandGroup.tsx` / `tab-configs.ts`, no data-plumbing or migration work.

### Changes

**`src/lib/tab-configs.ts`**
Insert `'Country'` immediately after `'Account'` in every tab's array in `TAB_COLUMN_CONFIGS` (10 tabs). For `'Wizard of Odds'`, where `Account` is the 2nd entry, `Country` goes 3rd (still directly after `Account`).

If a tab's live Google Sheet doesn't have a `Country` header, the existing whitelist ∩ real-headers intersection logic (`BrandGroup.tsx:706-729`) silently drops the column for that tab — no risk of a broken/empty column.

**Sorting — no code change needed.**
`Country` isn't a link/status column and isn't in the `isNoSortCol` blacklist (`BrandGroup.tsx:45-48`), so it becomes clickable-sortable automatically via the existing generic `localeCompare` comparator (`BrandGroup.tsx:1217-1260`).

**`src/pages/BrandGroup.tsx` — Country filter**
Mirrors the existing Agent/Proxy filter pattern exactly:
- New state: `const [countryFilter, setCountryFilter] = useState('')` (alongside `agentFilter`/`proxyFilter`, ~line 594-595)
- Reset on tab change, alongside `setAgentFilter('')`/`setProxyFilter('')` (~line 690-691)
- Derive unique values, case-insensitively de-duped (mirrors `uniqueProxies`, ~line 1072-1084):
  ```ts
  const uniqueCountries = (() => {
    const seen = new Map<string, string>();
    for (const e of entries) {
      const v = e.data['Country'];
      if (v && v.trim()) {
        const key = v.trim().toLowerCase();
        if (!seen.has(key)) seen.set(key, v.trim());
      }
    }
    return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  })();
  ```
- New `countryFiltered` step inserted into the filter chain after `proxyFiltered`, before `platformFiltered`:
  ```ts
  const countryFiltered = countryFilter
    ? proxyFiltered.filter((e) => e.data['Country']?.trim().toLowerCase() === countryFilter.toLowerCase())
    : proxyFiltered;
  const platformFiltered = countryFiltered; // was: proxyFiltered
  ```
- Render `<BrandFilterDropdown noun="countrie" value={countryFilter} onChange={...} brands={uniqueCountries} />` in the toolbar right after the Proxy filter (~line 1559-1566), gated on `uniqueCountries.length > 1` (same gating as Agent/Proxy). `noun="countrie"` mirrors the existing `noun="proxie"` quirk — the component naively appends `"s"` to the noun for its plural label ("All countries" / "Search countries…").

### Out of scope

- No changes to column width heuristics (`colWidthClass`) — Country falls through to the default `w-32`, same as most non-special columns.
- No sticky-column treatment — only `Account`/`Account Name` are sticky.
- No changes to search-all-columns behavior — it already iterates all visible headers, so Country is automatically included once whitelisted.
- No schema, migration, or Edge Function changes — Country data is already synced.
