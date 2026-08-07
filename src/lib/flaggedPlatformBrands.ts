// A brand+platform can be manually flagged after ops receives an email
// notification about it — there's no automated email-parsing in this
// system, so this is purely an operator-set toggle, same shape as
// removed_platform_brands (a row's mere existence is the flag). This key
// format is the single shared definition every reader (the Edit Entry
// checkbox, recalculatePauses' third pause trigger) goes through so they
// can't drift out of sync with each other or with the
// flagged_platform_brands table.

import { normalizeBrandKey, type Platform } from './removedPlatformBrands.ts';

export function platformFlaggedKey(tab: string, brand: string, platform: Platform): string {
  return `${tab}::${normalizeBrandKey(brand)}::${platform}`;
}

export function buildFlaggedPlatformBrandSet(
  rows: { tab: string; brand: string; platform: Platform }[],
): Set<string> {
  return new Set(rows.map((r) => platformFlaggedKey(r.tab, r.brand, r.platform)));
}
