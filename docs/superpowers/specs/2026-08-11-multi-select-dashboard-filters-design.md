# Multi-Select Dashboard Filters — Design

**Date:** 2026-08-11
**Status:** Approved (pending spec review)
**PMS task:** "Enable multi-select on all dashboard filters" (`cmsj4nx55004x04ibzsmnhhti`)

## Problem

Every filter dropdown across the dashboard — Platform, Country, Proxy, Status, Agent, Brand, Tab — is single-select today: picking a new value replaces whatever was picked before. A user who wants "TP or AG" or "US or UK" has no way to express that; they have to run the same view twice and add the numbers themselves. The PMS task asks for all of them to become multi-select, plus any filter added in the future.

## Scope

**In scope** (every category-dropdown filter that exists today):
- Overview (`src/pages/Overview.tsx`): Country, Proxy, Platform.
- Brand Tabs (`src/pages/BrandGroup.tsx`): Brand, Agent, Proxy, Country, Status, Platform.
- Score Summary (`src/components/ScoreSummaryPanel.tsx`): Platform, Tab.
- Ask AI (`supabase/functions/ai-assistant/tools.ts`): `get_score_summary`'s and `get_success_rate_by_field`'s `platform` param, so the assistant's answers stay aligned with the dashboard's new multi-platform semantics (per this project's standing cross-dashboard-consistency rule).

**Out of scope, with reasons:**
- **Date Range** (all three pages) — a continuous from/to range, not a category dropdown; multi-select doesn't map onto it. Confirmed with you directly.
- **BrandGroup's Rating filter** (`ratingFilter`, `BrandGroup.tsx:602-608`) — this isn't a dropdown a user opens; it's a single value that only ever arrives via a Score Summary star-count deep link (`?rating=`) and is only meaningful paired with exactly one platform (a "4" means nothing without knowing which platform's score scale it's on). There's no UI control to convert. If you want a real multi-select rating *control* added to BrandGroup, that's a new feature, not this task — flag it separately if wanted.
- **`SelectDropdown` usages that aren't filters** — `EditEntryModal`/`AddReviewAccountModal`'s use of `SelectDropdown`/`BrandSelectDropdown` to set one field's value on one entry (inherently single-valued data), and `SchedulePlanner.tsx`'s tab picker (`SelectDropdown`, `SchedulePlanner.tsx:454-459` — chooses which one tab's schedule to load, a navigation control, not a filter over already-loaded data, the same role `/brands/:tab` routing plays elsewhere). Converting either to multi-select would change what the control *means*, not just how it's picked.

## Shared component: `MultiSelectDropdown`

New `src/components/MultiSelectDropdown.tsx`, replacing every existing filter usage of `BrandFilterDropdown.tsx` (used only by Overview's and BrandGroup's Country/Proxy/Platform/Brand filters — confirmed via a repo-wide search, so it can be deleted outright once replaced), BrandGroup's inline `FilterDropdown<T>` (`BrandGroup.tsx:303-349`), and ScoreSummaryPanel's inline `PlatformFilter`/`TabFilterDropdown` (`ScoreSummaryPanel.tsx:299-390`). This is the one piece that makes "any filter added in the future" true by default — a new filter just uses this component and gets multi-select for free, instead of another hand-rolled dropdown joining the pile that exists today.

**`SelectDropdown.tsx` is untouched** — a repo-wide search confirms its only call sites are `EditEntryModal.tsx`, `AddReviewAccountModal.tsx`, and `SchedulePlanner.tsx`'s tab picker, all out of scope above (single-entry field editing or navigation, not a category filter). Only its already-solved portal-positioning *technique* is reused (borrowed, not imported) by the new component, per the clipping note below.

```ts
interface MultiSelectOption { value: string; label: string; dot?: string }

interface MultiSelectDropdownProps {
  values: string[];                 // selected values; [] means "All"
  onChange: (values: string[]) => void;
  options: MultiSelectOption[];
  noun?: string;                    // e.g. "platform" -> "All platforms" / "2 platforms"
  searchable?: boolean;              // show a search box (long lists: Brand, Country)
  placeholder?: string;              // override the default "All {noun}s" label
}
```

Behavior:
- Trigger button label: `""` selected → `placeholder ?? "All {noun}s"`; exactly one → that option's label; two or more → `"{n} {noun}s"`.
- Clicking the "All {noun}s" row clears to `[]` and keeps the menu open (consistent with every other row toggling rather than closing).
- Clicking any other row **toggles** membership (checkbox indicator) rather than replacing the selection and closing the menu — this is the one real interaction change from every existing dropdown, all of which close-on-select today.
- Menu stays open until an outside click (existing pattern, reused) or Escape.
- Trigger shows an inline "×" clear-all whenever `values.length > 0`, and a small filled dot when active — same visual language as today's single-select pill controls.
- Rendered via `createPortal` to `document.body` with position computed from the trigger's `getBoundingClientRect()` (`SelectDropdown.tsx:36-53`'s already-solved approach), not `BrandFilterDropdown`/BrandGroup's inline `FilterDropdown`'s plain `absolute` positioning — this repo has hit dropdown-clipping issues inside scrollable containers before (`BrandGroup`'s filter row sits above its own self-scrolling table panel), so all filter dropdowns should use the version of this that's already proven not to clip, not the version that hasn't been tested against that layout.
- `searchable` recreates the search-box UI pattern already implemented in `BrandFilterDropdown.tsx:52-63` (that file is deleted once every call site moves to `MultiSelectDropdown`, so this is a reference for the port, not a live import); used for Brand and Country (long lists), omitted for Platform/Status/Agent/Proxy/Tab (short, fixed lists).

## State & serialization contract

Every in-scope filter's React state becomes `string[]` instead of `string`. `[]` means "All" (no filtering on that field) — confirmed with you directly, so clearing a filter can never look like a silently-broken empty table.

**URL params:** comma-separated, e.g. `?platform=tp,ag`. Two small shared helpers (new, `src/lib/filterParams.ts`):
```ts
export function readArrayParam(searchParams: URLSearchParams, key: string): string[] {
  const raw = searchParams.get(key);
  return raw ? raw.split(',').filter(Boolean) : [];
}
export function writeArrayParam(next: URLSearchParams, key: string, values: string[]) {
  if (values.length > 0) next.set(key, values.join(',')); else next.delete(key);
}
```
A pre-existing bare single value (`?platform=tp`, whether typed, bookmarked, or built by one of the deep-link builders below) round-trips through `readArrayParam` as `['tp']` with zero code changes at the call site — this is what makes the "auto-migrate transparently" behavior you asked for fall out for free, including every existing single-value deep link Overview/Score Summary already build into BrandGroup URLs (`Overview.tsx:514,554`, and the Task-190 country-breakdown drill-down) — **none of those builder call sites need to change**, since they only ever emit one value per param today and will keep doing so.

**localStorage** (`BrandGroup.tsx`'s `StoredBrandFilters`, `filterStorageKey`/`readFiltersFromStorage`/`writeFiltersToStorage`, `BrandGroup.tsx:544-576`): each filter field's stored type becomes `string[]`. On read, a legacy plain string (from before this change shipped) is wrapped as `[value]` if truthy, `[]` if empty — same rule as the URL case, applied once at the `readFiltersFromStorage` call site rather than duplicated at every filter.

## Filtering semantics

- **Within one filter:** OR — a row matches if its value is *any* of the selected values (`selected.length === 0 || selected.includes(rowValue)`, or the canonical-key equivalent for Country/Proxy).
- **Across different filters:** AND — unchanged from today (each filter's `.filter()` narrows what the next one sees).
- **Empty selection = "All"** — confirmed with you directly.

## Per-surface changes

### Overview.tsx + `src/lib/queries.ts`

- `countryFilter`/`proxyFilter`/`platformFilter` (`Overview.tsx:433-436`) become `string[]`, read via `readArrayParam`.
- `updateFilterParam`/`setPlatformFilter` (`Overview.tsx:522-536`) take `string[]` and call `writeArrayParam`.
- `computeTabKpisFromEntries` (`queries.ts:370-522`) and `fetchTabKpis` (`queries.ts:524-539`): `countryFilter?: string`, `proxyFilter?: string`, `platformFilter?: Platform` become `countryFilter?: string[]`, `proxyFilter?: string[]`, `platformFilter?: Platform[]` (all still optional/omittable — an omitted or empty array is "no filter", identical to today's omitted-string behavior, so this is non-breaking for any caller that doesn't pass these).
  - Country/proxy row gate (`queries.ts:414-419`): `canonicalCountryKey(...) !== canonicalCountryKey(countryFilter)` becomes `!countryFilter.some(cf => canonicalCountryKey(...) === canonicalCountryKey(cf))` (only when `countryFilter.length > 0`); proxy identically.
  - Platform "does this tab track any requested platform" gate (`queries.ts:404-406`): `platformFilter && !activePlatforms.includes(platformFilter)` becomes `platformFilter?.length && !platformFilter.some(p => activePlatforms.includes(p))` — a tab is excluded (`return null`) only if it tracks **none** of the selected platforms; it's included, filtered to just the tracked subset, if it tracks at least one. This is the "combined total" rule applied at the per-tab gate.
  - Per-row status assembly (`queries.ts:477-485`): the `platformFilter ? [singlePlatformValue] : [all four platforms' values]` branch becomes `platformFilter?.length ? platformFilter.map(p => platformValue[p]).filter(...) : [all four]` — i.e. union the selected platforms' own date/flag-gated status values into the same `statuses` array that already feeds the `live`/`removed`/`done`/etc. counters below it (`queries.ts:487-501`), unchanged. This is what makes TP+AG "combined total": a row counts as live if *either* selected platform's status says so, exactly the same OR logic the existing `platformFilter` omitted (all-platform) branch already uses today, just scoped to the selected subset instead of all four.
  - `tp`/`ag`/`cg`/`wo` sub-counts and `activePlatforms` on the return value (`queries.ts:504-521`) stay computed unconditionally, same as today — needed for the Platform Breakdown donut and per-tab platform badges.

### BrandGroup.tsx

- `brandFilter`, `agentFilter`, `proxyFilter`, `countryFilter`, `statusFilter`, `platformFilter` (`BrandGroup.tsx:592,596-601,617-619`) all become `string[]` (`statusFilter`/`platformFilter` become `('live'|'removed'|...)[]`/`('tp'|'ag'|'cg'|'wo')[]` — dropping the `'all'` sentinel value entirely in favor of `[]`, consistent with every other filter).
- Filter chain (`BrandGroup.tsx:1296-1318`): each `x && xCol ? filter(e => e.data[xCol] === x) : ...` becomes `x.length > 0 && xCol ? filter(e => x.includes(e.data[xCol] ?? '')) : ...`; Proxy/Country's canonical-key equality checks become canonical-key membership checks (`x.some(v => canonicalKey(...) === canonicalKey(v))`); Brand's group-aware match (`BrandGroup.tsx:1296-1303`) becomes "row matches if it matches *any* selected brand's own group-or-exact rule."
- `activeStatusCols` (`BrandGroup.tsx:1320-1326`, "which status column(s) does a platform-scoped view check") becomes the **union** of status columns across every selected platform, instead of one platform's column — `platformFilter.length === 0 ? statusCols : statusCols.filter(h => platformFilter.some(p => p === 'tp' ? TP_STATUS_VARIANTS.has(h) : h.toLowerCase() === PLATFORM_STATUS_COL[p].toLowerCase()))`.
- `relevantPlatforms` (`BrandGroup.tsx:1348`) becomes `platformFilter.length > 0 ? platformFilter : getTabPlatforms(decodedTab)`.
- `matchesPlatform` (`BrandGroup.tsx:1361-1375`): the per-platform status comparison (`statusFilter === 'live'` etc.) becomes a membership check against the array — `statusFilter.length === 0 ? true : statusFilter.some(sf => matchesOneStatus(sf, v))` (factor the five `isLive`/`isRemoved`/... branches into a small `matchesOneStatus(status, v)` helper so both the single- and multi-status paths call the same logic). The **per-platform coupling this function exists to enforce is untouched** — a row still only counts for a given platform if that same platform's own date+status line up; multi-select only widens *which* platforms and *which* statuses are checked, not the row-level coupling between them.
- `activePlatformForRating` (`BrandGroup.tsx:1333`, gates the Rating deep-link filter, out of scope above): becomes `platformFilter.length === 1 ? platformFilter[0] : null` — the rating filter (score-scale-dependent, same reason as Score Summary's star histogram below) only applies when the platform filter has narrowed to exactly one platform; selecting 2+ platforms silently stops applying whatever rating deep-link was in effect, same "don't merge across scales" principle applied consistently.
- `displayKpis`' per-platform cards (`BrandGroup.tsx:1382-1399+`) are **unaffected** — they already show all platforms' own Live/Removed counts unconditionally, independent of `platformFilter`; nothing there compares against `platformFilter`.
- Deep-link URL sync (`BrandGroup.tsx:770-968`) and localStorage read/write: apply `readArrayParam`/legacy-string-wrapping as described above; `hasDeepLinkParams` (`BrandGroup.tsx:771`) is unaffected (still just checks param *presence*, not shape).
- The existing platform-check-status trigger (`handleCheckStatus`, `BrandGroup.tsx:1557`) already takes `('tp'|'ag'|'cg'|'wo')[]` today and is driven by `getTabPlatforms`/explicit per-platform buttons, not by `platformFilter` — no change needed there.

### ScoreSummaryPanel.tsx + `src/lib/scoreSummary.ts`

- `platform` (`ScoreSummaryPanel.tsx:256`, currently a single `Platform`) and `tabFilter` (`ScoreSummaryPanel.tsx:275`, currently a single tab name) become `string[]` (`Platform[]` / `string[]`), both rendered via the new `MultiSelectDropdown` in place of the inline `PlatformFilter` button-group and `TabFilterDropdown` (`ScoreSummaryPanel.tsx:299-390`, both deleted).
- `computeScoreSummary` (`scoreSummary.ts:246-353`), `computeSuccessRates` (`scoreSummary.ts:380+`), `computeTabSuccessRates` (`scoreSummary.ts:433+`): each currently takes one `platform: Platform` and looks up `PLATFORM_STATUS_KEYS[platform]`/`PLATFORM_DATE_KEYS[platform]` once. Each becomes `platform: Platform[]` and, for the **Live/Removed/Success-Rate math only**, unions the per-platform status/date lookups the same way `queries.ts` does above (a row counts once toward a brand's live/removed bucket if *any* selected platform's own status+date line up) — the combined-total rule applied identically to this surface.
- **Star-rating histogram** (`computeScoreSummary`'s `counts: Record<Star, number>`/`unrated`, `scoreKeys`/`maxScore` lookups, `scoreSummary.ts:258-259,316-321`): confirmed with you directly, refined once during implementation planning — the histogram only ever computes/shows when **exactly one** platform is selected. Even platforms that share a `PLATFORM_MAX_SCORE` (TP/CG/WO are all 5) still have independent review-text/date columns per platform, so merging their histograms would combine different platforms' reviews into one bucket with no way to tell them apart — the same underlying problem as a scale mismatch (TP vs AG's 1-10), just not surfaced by the score number itself. So: 2+ platforms selected → histogram hidden, Live/Removed/Success-Rate still shown combined; exactly 1 platform → histogram computes and renders exactly as today. `ScoreSummaryPanel.tsx`'s render (around `result.excludedRows`/`GroupedSummary`, `ScoreSummaryPanel.tsx:278-292`) gains this check.
- `tabFilter` becoming multi-select changes `filteredBrands` (wherever it currently does `b.tab === tabFilter`) to `tabFilter.length === 0 || tabFilter.includes(b.tab)`.

### `supabase/functions/ai-assistant/tools.ts`

- `get_score_summary` and `get_success_rate_by_field`'s `platform` parameter (`tools.ts:489,529`, currently `{ type: 'string', enum: ['tp','ag','cg','wo'] }`) becomes `{ type: 'array', items: { type: 'string', enum: ['tp','ag','cg','wo'] } }`. Both tool descriptions (`tools.ts:478-491,514-531`) are updated to state the combined-total semantics explicitly (matching this project's own history of assistant/dashboard divergence — see the Known Issues entry on `get_score_summary`'s `pick()`/rounding gaps — so this doesn't add a third undocumented mismatch).
- Handlers (`tools.ts:652+,668+`) thread `args.platform` (now an array, or `undefined`/`[]` meaning all platforms — same "omitted = no filter" convention as everywhere else) into the same shared computation the frontend uses conceptually, applying the identical union rule.
- The star-histogram scale-mismatch rule does **not** apply here — `get_score_summary`'s tool response is numeric fields, not a rendered histogram; if this surfaces per-score counts, apply the same "omit/null when scales don't match, computed when they do" rule at the data level, documented in the tool's own description so the model doesn't silently misinterpret a combined figure across mismatched scales.

## Testing & verification

- **Unit tests**, extending each surface's existing suite:
  - `queries.test.ts` (or wherever `computeTabKpisFromEntries` is tested today): multi-platform selection returns the union/combined counts described above; a tab tracking only one of two selected platforms is included and scoped to that one, not excluded; empty array behaves identically to the current "platform filter omitted" path (regression lock, byte-for-byte).
  - `scoreSummary.test.ts`: multi-platform `computeScoreSummary`/`computeSuccessRates`/`computeTabSuccessRates` combined-count cases; histogram omitted when `PLATFORM_MAX_SCORE` differs across the selection, present when it doesn't or when exactly one platform is selected.
  - New `filterParams.test.ts`: `readArrayParam`/`writeArrayParam` round-trip, including the legacy bare-single-value migration case.
  - `BrandGroup`-side filter-chain logic, if any of it is already unit-testable outside the component (check current coverage before assuming a gap here).
- **Build:** `npm run build` (per standing project knowledge, `tsc --noEmit` alone checks nothing here — root tsconfig is references-only).
- **Live verification** (browser, real Supabase data), per surface:
  - Overview: select 2 platforms, confirm combined KPI/country/proxy numbers, confirm the Platform Breakdown donut's existing single-platform-hides-donut behavior still triggers correctly (now on "1 selected" rather than "not `'all'`").
  - BrandGroup: multi-select each of Brand/Agent/Proxy/Country/Status/Platform independently and in combination; confirm table rows, per-platform cards, and the status-check trigger all stay consistent; confirm a saved multi-select view survives a tab-away-and-back and a page reload (localStorage + URL).
  - Score Summary: select 2 same-scale platforms (histogram shows, combined) and 2 different-scale platforms (histogram hidden, Live/Removed/Success-Rate still shown); multi-select Tab.
  - Ask AI: ask a combined-platform question ("what's my TP+AG success rate for X") and confirm the number matches the dashboard's own combined figure for the same selection.
- Per this project's standing cross-dashboard-consistency requirement, a **final whole-branch review** should specifically re-check that Overview's `queries.ts` combined-total logic, BrandGroup's independent filter chain, and Score Summary's `scoreSummary.ts` combined-total logic didn't drift from each other for the same underlying rule (three separate call sites implementing "OR across selected platforms, AND across filters" is exactly the shape of prior real bugs in this codebase — Task 180 in particular).

## Out of scope

- Date Range (all pages) — stays a single continuous range.
- BrandGroup's Rating filter — no dropdown exists to convert; flag separately if a real multi-select rating control is wanted.
- `SelectDropdown`/`BrandSelectDropdown` usages that set a single field's value on one entry (`EditEntryModal.tsx`, `AddReviewAccountModal.tsx`) or that navigate to one tab (`SchedulePlanner.tsx`'s tab picker) — not filters over already-loaded data.
- No new filters are being added by this task — only the existing ones, converted.
