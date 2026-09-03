import type { Platform } from './removedPlatformBrands';

export interface TabPausedBrandRow {
  brand: string;
  brandKey: string;
  platform: Platform;
  reason: string;
  resumeAt: string | null;
  setBy: string | null;
}

// Shapes brand_platform_override rows (override_state === 'pause' only) into
// display rows for the Edit Brand Tab "Paused brands" section. `eligible` is
// the caller's hidden/restricted/removed exclusion check (resolveBrandPlatforms
// in practice) so this list can't drift from the Schedule Planner grid or
// Ask AI's get_paused_combos. Auto-detected pauses have no override row and
// therefore never appear here.
export function deriveTabPausedBrandRows(
  overrides: {
    brand_key: string;
    platform: Platform;
    override_state: 'pause' | 'active';
    reason: string | null;
    resume_at: string | null;
    set_by: string | null;
  }[],
  brandByKey: Map<string, string>,
  eligible: (brandKey: string, platform: Platform) => boolean,
): TabPausedBrandRow[] {
  return overrides
    .filter((o) => o.override_state === 'pause')
    .filter((o) => eligible(o.brand_key, o.platform))
    .map((o) => ({
      brand: brandByKey.get(o.brand_key) ?? o.brand_key,
      brandKey: o.brand_key,
      platform: o.platform,
      reason: o.reason ?? '',
      resumeAt: o.resume_at ?? null,
      setBy: o.set_by ?? null,
    }))
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.platform.localeCompare(b.platform));
}
