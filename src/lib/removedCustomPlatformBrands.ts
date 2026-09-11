//
// A brand's page on a custom (user-defined) platform can be delisted
// entirely, independent of any single review's status and independent of
// that brand's standing on any other platform (built-in or custom) -- the
// same concept removedPlatformBrands.ts covers for TP/AG/CG/WO, generalized
// here for a custom platform identified by its custom_platforms.id instead
// of the closed Platform union. Flagged (tab, brand, platform_id) triples
// live in the `removed_custom_platform_brands` table. Kept as a separate
// table/module from removedPlatformBrands.ts rather than widening that
// module's closed Platform union -- see
// docs/superpowers/specs/2026-09-11-custom-platform-removed-flag-design.md.
import { normalizeBrandKey } from './removedPlatformBrands';

export { normalizeBrandKey };

export function customPlatformRemovedKey(tab: string, brand: string, platformId: string): string {
  return `${tab}::${normalizeBrandKey(brand)}::${platformId}`;
}

export function buildRemovedCustomPlatformBrandSet(
  rows: { tab: string; brand: string; platform_id: string }[],
): Set<string> {
  return new Set(rows.map((r) => customPlatformRemovedKey(r.tab, r.brand, r.platform_id)));
}

export function buildRemovedCustomPlatformBrandDateMap(
  rows: { tab: string; brand: string; platform_id: string; removed_at: string }[],
): Map<string, string> {
  return new Map(rows.map((r) => [customPlatformRemovedKey(r.tab, r.brand, r.platform_id), r.removed_at]));
}
