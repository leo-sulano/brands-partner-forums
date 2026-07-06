# TP Affiliate: merge two brands into one for counts + filtering

## Problem

On the **TP Affiliate** tab, two brand rows are actually the same underlying
campaign submitted under two different page titles:

- `Top10 Casinos Review Ca 2026`
- `Best Online Casino in Canada 2026 | Top Rated Online Casinos`

Today the KPI cards (Total / Live / Removed) and the Brand filter treat them
as fully independent brands — e.g. the Brand filter pill for one shows only
its own rows and its own Total/Live/Removed counts, with no way to see them
combined.

Confirmed via a direct read of the `entries` table: 26 rows currently carry
the `Best Online Casino in Canada 2026 | Top Rated Online Casinos` brand text
(with a trailing space) and 12 rows carry `Top10 Casinos Review Ca 2026`
(also with a trailing space) — matching the two screenshots that prompted
this request.

## Goal

Treat these two brand values as one combined brand for:
1. **KPI counts** — Total / Live / Removed on the TP Affiliate tab.
2. **Brand filter row matching** — selecting either brand in the filter
   dropdown shows rows from **both** brands in the table.

The Brand filter **dropdown itself keeps listing both brand names as
separate, individually-selectable options** — only the row-matching and
resulting counts are merged. Row display (the brand text shown per row) is
unchanged.

## Design

### Config: `TAB_BRAND_GROUPS` (`src/lib/tab-configs.ts`)

A new per-tab map, following the same pattern as the existing
`TAB_BRAND_SEQUENCE` / `TAB_DEFAULT_BRAND` maps in this file:

```ts
const TAB_BRAND_GROUPS: Record<string, string[][]> = {
  'TP Affiliate': [
    ['Top10 Casinos Review Ca 2026', 'Best Online Casino in Canada 2026 | Top Rated Online Casinos'],
  ],
};

export function getBrandGroup(tab: string, brand: string): string[] | null {
  const groups = TAB_BRAND_GROUPS[tab];
  if (!groups) return null;
  const trimmed = brand.trim();
  return groups.find((g) => g.some((v) => v.trim() === trimmed)) ?? null;
}
```

Matching trims both the config strings and the live cell value before
comparing, so the trailing whitespace observed in the current sheet data
(and any future inconsistency in that whitespace) doesn't break the match.
Each inner array is one merged group; the shape supports adding more merged
pairs (or larger groups) later, on this tab or others, without code changes
beyond adding an entry.

### Row filtering (`src/pages/BrandGroup.tsx`)

`brandFiltered` currently does exact equality:

```ts
const brandFiltered = brandFilter && brandCol
  ? searchFiltered.filter((e) => e.data[brandCol] === brandFilter)
  : searchFiltered;
```

Change to check the brand group when one exists for the selected filter
value, falling back to today's exact-match behavior otherwise (so every
other tab/brand is untouched):

```ts
const brandFiltered = brandFilter && brandCol
  ? (() => {
      const group = getBrandGroup(decodedTab, brandFilter);
      return group
        ? searchFiltered.filter((e) => group.some((v) => v.trim() === (e.data[brandCol] ?? '').trim()))
        : searchFiltered.filter((e) => e.data[brandCol] === brandFilter);
    })()
  : searchFiltered;
```

### KPI counts

No separate change needed. `displayTotals` (Total/Live/Removed) and
`TotalBreakdownModal` are already derived downstream of `brandFiltered` via
`kpiBase = applyDateFilter(platformFiltered)`. Once `brandFiltered` includes
both brands' rows, the counts merge automatically.

### Out of scope

- The Brand filter dropdown list (`uniqueBrands`) — unchanged, still lists
  every distinct brand value individually.
- Any tab other than TP Affiliate.
- The per-row Brand column display text — still shows each row's own actual
  brand value, not a merged label.
