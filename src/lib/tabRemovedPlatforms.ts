import type { Platform } from './removedPlatformBrands';

export interface TabRemovedPlatformRow {
  brand: string;
  platform: Platform;
  removedAt: string;
  removedBy: string | null;
}

// Shapes removed_platform_brands rows into display rows for the Edit Brand
// Tab "Removed platform pages" section — mirrors deriveTabPausedBrandRows in
// tabPausedBrands.ts. No eligibility filter here (unlike the paused-brands
// list): a flagged platform page is a fact about that platform independent of
// Schedule Planner visibility/hidden/restricted state, so every row for this
// tab is shown.
export function deriveTabRemovedPlatformRows(
  rows: { brand: string; platform: Platform; removed_at: string; removed_by: string | null }[],
): TabRemovedPlatformRow[] {
  return rows
    .map((r) => ({ brand: r.brand, platform: r.platform, removedAt: r.removed_at, removedBy: r.removed_by }))
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.platform.localeCompare(b.platform));
}
