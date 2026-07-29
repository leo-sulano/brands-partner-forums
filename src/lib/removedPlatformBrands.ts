// A brand's platform page (Trustpilot, AskGamblers, CasinoGuru, or Wizard of
// Odds) can be delisted entirely, independent of any single review's status
// and independent of that brand's standing on any other platform. Flagged
// (tab, brand, platform) triples live in the `removed_platform_brands`
// table. This key format is the single shared definition of that match —
// every reader (BrandGroup's badges, scoreSummary's per-platform exclusion,
// the Edit Entry checkboxes) goes through it so they can't drift out of sync
// with each other or with what's actually stored in the table.

export type Platform = 'tp' | 'ag' | 'cg' | 'wo';

export function normalizeBrandKey(brand: string): string {
  return brand.trim().toLowerCase();
}

export function platformRemovedKey(tab: string, brand: string, platform: Platform): string {
  return `${tab}::${normalizeBrandKey(brand)}::${platform}`;
}

export function buildRemovedPlatformBrandSet(
  rows: { tab: string; brand: string; platform: Platform }[],
): Set<string> {
  return new Set(rows.map((r) => platformRemovedKey(r.tab, r.brand, r.platform)));
}
