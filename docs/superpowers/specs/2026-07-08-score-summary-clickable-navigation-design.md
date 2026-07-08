# Clickable Score Summary navigation into the Brands tab

PMS task: [Make Score Summary and Star Counts Clickable with Contextual
Navigation](https://pms-nu-eight.vercel.app/projects/cmpe8l7f1000004l7ytcbmxhb)
(`cmrc5xm7z000l04jl6gdlr9fv`)

## Problem

Score Summary (`ScoreSummaryPanel.tsx`) shows, per brand, a count of
Published reviews at each star value for the active platform (e.g. "AG
10⭐: 4"). Both the brand name and every star-count cell are plain text today
— there is no way to jump from "this brand has 4 published AG-10 reviews" to
actually seeing those 4 rows. The only related precedent in the app is
`Overview.tsx`'s `PlatformBreakdownModal`, which links to `/brands/:tab` with
a `platform` query param but nothing brand- or rating-specific.

Separately, Wizard of Odds (WO) is entirely absent from Score Summary — its
`Platform` type only covers `tp | ag | cg`, and WO's data lives under
differently-named raw columns (`Wizard of OddsScore added`, `WoO Review
Status`, `Wizard of Odds` for date) that don't match any of the existing
`PLATFORM_*_KEYS` maps. Since this feature is meant to make "every star count
value" clickable, WO needs to be a real platform in Score Summary first, or
it would remain the one platform this feature doesn't cover.

## Goal

1. Clicking a brand name on Score Summary navigates to that brand's Brands
   tab, filtered to just that brand, with the currently-active Score Summary
   platform carried over.
2. Clicking a star-count cell (when count > 0) does the same, plus filters to
   rows matching that exact score **and** Published status for the active
   platform — matching exactly what the count represented.
3. Navigating between two star-count links while already on the destination
   tab (e.g. AG-10 → AG-9) re-applies filters correctly; it doesn't silently
   no-op because the page didn't re-mount.
4. Wizard of Odds becomes a fourth platform in Score Summary (1-5 scale, same
   shape as TP/CG), so the feature above covers all four platforms uniformly.

## Design

### 1. Add WO to Score Summary (`src/lib/scoreSummary.ts`)

- `Platform` type: `'tp' | 'ag' | 'cg'` → `'tp' | 'ag' | 'cg' | 'wo'`.
- `PLATFORM_MAX_SCORE.wo = 5`.
- `PLATFORM_SCORE_KEYS.wo = ['Wizard of OddsScore added']`.
- `PLATFORM_STATUS_KEYS.wo = ['WoO Review Status']`.
- `PLATFORM_DATE_KEYS.wo = ['Wizard of Odds']`.

These are WO's actual raw column names, per `TAB_COLUMN_CONFIGS['Wizard of
Odds']` in `tab-configs.ts`. No change needed to `BRAND_KEYS` — WO's brand
column (`'Brand Name'`) is already covered. `parseScore()`, `computeScoreSummary()`,
and `summarizeCounts()` are all already platform-generic and need no changes
beyond the new map entries.

### 2. WO platform toggle (`src/components/ScoreSummaryPanel.tsx`)

Add a fourth `PlatformFilter` option, `wo` = "Wizard of Odds" (lines 42-46),
reusing the WO icon/favicon already defined for `BrandGroup.tsx`'s
`PLATFORM_FAVICON`. No other change to the toggle's behavior — it already
just threads `platform` into `computeScoreSummary`.

### 3. Clickable brand name and star-count cells (`SummaryTable`, `ScoreSummaryPanel.tsx`)

Both become React Router `<Link>`s instead of plain `<td>` content, built with
the existing `tabToSlug()` helper (`src/lib/tabs.ts`):

- **Brand name** → `/brands/${tabToSlug(row.tab)}?platform=${platform}&brand=${encodeURIComponent(row.brand)}`
- **Star-count cell, count > 0** → same, plus `&rating=${starValue}`
- **Star-count cell, count === 0** → stays plain text (nothing to navigate to)

### 4. New URL-driven filters on the Brands tab (`src/pages/BrandGroup.tsx`)

| Param | Current state | Change |
|---|---|---|
| `platform` | URL-synced, type `'all'\|'tp'\|'ag'\|'cg'` | Extend type to include `'wo'` (line 583) and its `searchParams` init check (line 714). `'wo'` is already a recognized platform elsewhere in this file (`handleCheckStatus`, `PLATFORM_FAVICON`) — this closes the one remaining gap. |
| `brand` | Local-only `brandFilter` state, reset on every tab change | Becomes URL-sourced from `searchParams.get('brand')`, mirroring how `platform` already works. |
| `rating` | Doesn't exist | New `ratingFilter` state, sourced from `searchParams.get('rating')`. |

**New filter step**, inserted after the existing platform/column resolution
in the row-filtering pipeline: when `ratingFilter` is set, keep only rows
where the active platform's score column (via the same
`PLATFORM_SCORE_KEYS`/`parseScore` logic already in `scoreSummary.ts`, reused
rather than re-derived) parses to exactly `ratingFilter`, **and** that
platform's status column reads Published. This matches the confirmed
behavior: the destination always shows exactly what the clicked count
represented, not a superset that includes since-removed rows.

**Reactivity fix:** the filter-sync `useEffect` (`BrandGroup.tsx:696-855`) is
currently keyed only on `[decodedTab, reloadSeq]`, so it doesn't re-run when
only `searchParams` changes on an already-mounted tab. Add `searchParams` (or
`location.search`) to its dependencies so that clicking between two
star-count links for the same brand-group tab re-applies `platform`, `brand`,
and `rating` correctly instead of no-op'ing.

**Active-filter indicator:** a small "Filtered by: `<brand>` · `<platform>` ·
Rating `<n>` ✕" chip near the table header when `brand` and/or `rating` are
set via URL, with a clear action that resets those params. Nothing like this
exists yet — it's new, but small, and needed so the applied context is
visible and reversible without hand-editing the URL.

## Edge cases

- Zero matches after filtering falls through to BrandGroup's existing empty
  state — no new empty-state UI required.
- A brand/rating combination from a stale link (e.g. bookmarked) that no
  longer matches any row behaves the same as any other filter yielding zero
  rows — not treated as an error.

## Out of scope

- No change to Score Summary's brand-identity resolution (`BRAND_KEYS`) or
  its existing published-only, integer-only score parsing — WO reuses that
  logic as-is.
- No new rating-filter UI control (dropdown, etc.) on the Brands tab beyond
  what's driven by the URL and the clear-filter chip — this feature is about
  arriving pre-filtered from Score Summary, not manual rating filtering.
- Check Status / WO scraping behavior is untouched; this is a display and
  navigation feature only.

## Testing

No frontend test suite exists to extend for this. Verification is manual in
the browser: click a brand name, click a star-count cell, click between two
star-count cells on the same brand-group tab (confirms the reactivity fix),
and confirm the WO platform toggle shows correct counts. `npm run build` for
the type-check gate.
