// A brand can be fully hidden from Schedule Planner (schedule_hidden_brands)
// or restricted to a single platform for scheduling purposes only
// (schedule_platform_restrictions) -- both Schedule-Planner-scoped, distinct
// from removed_platform_brands (which also affects Score Summary/Brand
// Tabs and is keyed per-platform, not per-brand).
// getSchedulableBrandPlatforms is the single place this is resolved, so
// SchedulePlanner.tsx (display), the generate-weekly-schedule Edge Function,
// and schedulerService.ts (auto-generation/pause) can't drift out of sync.

import { normalizeBrandKey, platformRemovedKey, type Platform } from './removedPlatformBrands.ts';

export function scheduleBrandKey(tab: string, brand: string): string {
  return `${tab}::${normalizeBrandKey(brand)}`;
}

export function buildHiddenBrandSet(rows: { tab: string; brand: string }[]): Set<string> {
  return new Set(rows.map((r) => scheduleBrandKey(r.tab, r.brand)));
}

export function buildPlatformRestrictionMap(
  rows: { tab: string; brand: string; allowed_platform: Platform }[],
): Map<string, Platform> {
  return new Map(rows.map((r) => [scheduleBrandKey(r.tab, r.brand), r.allowed_platform]));
}

export function getSchedulableBrandPlatforms(
  tab: string,
  brand: string,
  tabPlatforms: Platform[],
  hiddenSet: Set<string>,
  restrictionMap: Map<string, Platform>,
): Platform[] {
  if (hiddenSet.has(scheduleBrandKey(tab, brand))) return [];
  const restriction = restrictionMap.get(scheduleBrandKey(tab, brand));
  if (restriction) return tabPlatforms.filter((p) => p === restriction);
  return tabPlatforms;
}

// getSchedulableBrandPlatforms above, further filtered by removed_platform_brands
// (a separate, platform-level exclusion — see the file header) — the exact
// two-step resolution Schedule Planner uses everywhere it decides which
// platform chips a brand can show, factored out so its per-tab calendar and
// its landing-grid mini-preview can't independently drift.
export function resolveBrandPlatforms(
  tab: string,
  brand: string,
  tabPlatforms: Platform[],
  hiddenSet: Set<string>,
  restrictionMap: Map<string, Platform>,
  removedPlatformBrandSet: Set<string>,
): Platform[] {
  const schedulable = getSchedulableBrandPlatforms(tab, brand, tabPlatforms, hiddenSet, restrictionMap);
  return schedulable.filter((p) => !removedPlatformBrandSet.has(platformRemovedKey(tab, brand, p)));
}
