# Full Check History — Removed Brands per Tab

**Date:** 2026-06-08  
**Status:** Approved

## Problem

The expanded Run History shows a full table (Published / Removed / Pending / Brands) per tab, but the Brands column lists all brands in the tab regardless of status. There is no way to see which specific brands have removed reviews without drilling into each brand tab manually.

## Goal

In the expanded history view, show a compact line per tab with the published count, removed count, and the brand names that specifically have removed TP reviews. Tabs with no removed entries are hidden.

## Design

### Data Model

Add `removedBrands: string[]` to `TabStatusRow` in `src/lib/queries.ts`:

```ts
export interface TabStatusRow {
  tab: string;
  published: number;
  removed: number;
  pending: number;
  brands: string[];
  removedBrands: string[];  // brands with at least one removed review
}
```

### Query Change (`fetchAllTabsStatusSummary`)

In the per-entry loop, when an entry has a removed status, add its brand name to a separate `removedBrandSet`:

```ts
const removedBrandSet = new Set<string>();

for (const entry of entries) {
  // ...existing published/removed/pending counting...
  if (statuses.some(isRemovedStatus)) {
    removed++;
    if (brandCol) {
      const brand = entry.data[brandCol]?.trim();
      if (brand) removedBrandSet.add(brand);
    }
  }
}

return { tab, published, removed, pending, brands: [...brandSet].sort(), removedBrands: [...removedBrandSet].sort() };
```

### History Display (`SyncStatus.tsx`)

Replace the expanded sub-table with compact lines. Only tabs where `row.removed > 0` are rendered:

```
Rooster Partners   990 pub  640 rem  → Fortuneplay, Luckyvibe, +12 more
Hanan              571 pub  232 rem  → DachBet.com, EmirBet.com, +7 more
SuprPlay Limited   110 pub  283 rem  → Dueltz.com, NY Spins, Voodoo Dreams
SilverPlay          40 pub   52 rem  → Silver Play
```

- Brand chips use rose styling to signal removed state
- If `removedBrands` is empty for a tab with `removed > 0`, show the count only (no brand col available for that tab)
- Show up to 5 brand chips then `+N more`

### Out of Scope

- The live Full Check Status table (top section) keeps its existing Brands column behaviour
- History snapshot storage format (`localStorage`) is unchanged — `removedBrands` is derived at query time, not stored
- No changes to server, schema, or other pages
