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

export interface TabRemovedCustomPlatformRow {
  brand: string;
  platformId: string;
  removedAt: string;
  removedBy: string | null;
}

// Mirrors deriveTabRemovedPlatformRows exactly, for custom-platform rows
// (removed_custom_platform_brands), keyed by platform_id instead of a
// Platform code.
export function deriveTabRemovedCustomPlatformRows(
  rows: { brand: string; platform_id: string; removed_at: string; removed_by: string | null }[],
): TabRemovedCustomPlatformRow[] {
  return rows
    .map((r) => ({ brand: r.brand, platformId: r.platform_id, removedAt: r.removed_at, removedBy: r.removed_by }))
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.platformId.localeCompare(b.platformId));
}
