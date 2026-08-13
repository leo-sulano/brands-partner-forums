# Brand Tabs — Real Counts for Flagged-Removed Brand/Platform on Brand Filter

## Requirement (from user conversation)

`removed_platform_brands` flags a (tab, brand, platform) as having its page
delisted — e.g. "TrustPilot page removed" for a specific brand. Score
Summary, Overview, and Brand Tabs' own KPI cards all currently exclude a
flagged brand's rows from that platform's Live/Removed counting entirely,
so a flagged brand's card reads 0 wherever it's shown.

Global/aggregate counting (Score Summary, Overview KPIs) is intentional and
stays unchanged — confirmed with user. The gap: on Brand Tabs, once you
filter down to view that specific flagged brand's own page, the exclusion
still applies and its card still reads 0 — even though real historical
entries exist for it. The user wants that specific-brand view to show the
real count instead.

Confirmed with user across several rounds:
- Scope is Brand Tabs (`BrandGroup.tsx`) only — Score Summary, Overview, and
  `scoreSummary.ts`'s shared compute functions are untouched.
- Trigger is the Brand filter (the multi-select dropdown, or the `?brand=`
  deep link, which sets the same state) being non-empty — not limited to
  exactly one brand. Selecting 1, 3, or any number of brands all show real
  counts for the platforms flagged on those specific selected brands.
- An empty Brand filter (default whole-tab view) keeps today's exclusion
  behavior unchanged.

## Current behavior (for reference)

`BrandGroup.tsx` computes its own KPI numbers locally — it does not go
through `scoreSummary.ts`'s `computeScoreSummary`/`computeSuccessRates`
(those power Score Summary/Overview/Ask AI instead). The relevant filter
chain (all `useMemo`/plain `const`, computed in this order) is:

```
searchFiltered → brandFiltered → agentFiltered → proxyFiltered
  → countryFiltered → platformFiltered → ratingFiltered → filtered
```

`brandFiltered` (line 1319) already narrows to only rows whose brand
matches one of the selected `brandFilter` entries. Everything downstream of
it — including `ratingFiltered`, which both KPI computations below read —
therefore already only contains rows from explicitly-selected brands
whenever `brandFilter.length > 0`. No additional per-row brand check is
needed to know "is this row's brand one the user explicitly selected" —
that's already guaranteed by the time `ratingFiltered` exists.

Two local computations currently apply the same `isPlatformRemoved` skip
unconditionally, regardless of `brandFilter`:

- **`displayKpis`** (lines ~1409-1429) — feeds the per-platform TP/AG/CG
  cards on multi-platform tabs (Rooster Partners, Revolution Casino,
  SilverPlay, Hanan). Its `countPlatform(key)` helper iterates
  `ratingFiltered` and does `if (brandCol && isPlatformRemoved(e.data[brandCol], key)) continue;`
  before tallying live/removed.
- **`displayTotals`** (lines ~1458-1479) — feeds the aggregate
  Total/Live/Removed/Success Rate cards shown on every tab, including
  single-platform tabs (e.g. BITP) where this is the *only* totals row.
  Its loop does
  `.filter((p) => !(brandCol && isPlatformRemoved(e.data[brandCol], p)))`
  when building each row's list of relevant platform statuses.

`isPlatformRemoved(brandName, platform)` (line 1040) checks
`removedPlatformBrandSet.has(platformRemovedKey(decodedTab, brandName, platform))`
— purely a lookup against the flags table, independent of any filter state.

## Change

Both `countPlatform()` and the `displayTotals` loop gain a
`brandFilter.length > 0` guard around their existing `isPlatformRemoved`
checks: skip the exclusion (i.e. count the row normally) when true.

```ts
const brandScoped = brandFilter.length > 0;

// inside countPlatform(key):
if (!brandScoped && brandCol && isPlatformRemoved(e.data[brandCol], key)) continue;

// inside displayTotals' per-row platform list:
.filter((p) => brandScoped || !(brandCol && isPlatformRemoved(e.data[brandCol], p)))
```

Net effect:
- `brandFilter` empty (default tab view) — identical to today; flagged
  brand/platform rows stay excluded from every card.
- `brandFilter` non-empty (any brand(s) explicitly selected, via the
  dropdown or `?brand=` deep link) — rows for those selected brands are no
  longer excluded on their flagged platform(s), so the relevant card(s)
  show real Live/Removed counts (and the Success Rate badges derived from
  them) instead of 0.

No other read of `isPlatformRemoved` in this file changes:
- `matchesPlatform` (line 1397, gates the status-filter buttons/table rows
  when a status like "Removed" is active) is untouched — this task is about
  the KPI card *numbers*, not which table rows render. Out of scope, not
  requested.
- `flaggedRemovedPlatforms`/`PlatformRemovedBadge` rendering (the red pill
  next to a brand's name showing e.g. "TP") is untouched — the badge still
  correctly indicates the page is flagged removed even while its card now
  shows real historical numbers underneath.

No schema change, no change to `removed_platform_brands`, no change to
`scoreSummary.ts`, Score Summary, Overview, or Ask AI.

## Out of scope

- Score Summary, Overview, Ask AI (`get_score_summary` and friends) — all
  keep excluding flagged brands from aggregate counting unconditionally,
  confirmed with user.
- Table row visibility / status-filter interaction (`matchesPlatform`).
- Any UI change to `PlatformRemovedBadge` or the Edit Entry modal's
  "page removed" checkboxes.
- The free-text search box (`search` state) is a separate filter from the
  structured `brandFilter` dropdown; this task only keys off `brandFilter`,
  matching the deep-link mechanism (`?brand=`) that already sets it.

## Testing approach

`BrandGroup.tsx` has no dedicated test file for `displayKpis`/`displayTotals`
today (confirmed via search) — matching this project's existing pattern for
page-level presentational logic in this file (see Task 180's write-up:
`BrandGroup.tsx`/`Overview.tsx` changes are verified via build + live
Playwright check, not unit tests, since the computation lives inline in the
page component rather than an importable pure function). Verification:

1. `npm run build` and `deno check` both pass.
2. Live Playwright check against real Supabase data: pick a tab with a
   known flagged brand (e.g. a Hanan or TP Brand Injection brand from the
   `removed_platform_brands` seed data), confirm its card reads 0 for the
   flagged platform with no brand filter applied, then select that brand
   via the Brand filter dropdown and confirm the same card now shows a
   non-zero real count. Also check the `?brand=` deep-link path directly
   (matches Task 167's existing deep-link mechanism). Then select that
   brand plus one or two unflagged brands together and confirm all
   selected brands' real platforms count correctly with no double-counting
   or regression for the unflagged brands.
