// A manual override lets ops force a brand+platform's schedule state,
// beating whatever recalculatePauses' automatic detection would otherwise
// compute (docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md).
// 'pause' forces a pause regardless of auto conditions; 'active' forces
// continued posting even if auto-detection would otherwise pause it.
// Unlike removedPlatformBrands (boolean presence), this carries a state, so
// the shared helper here builds a Map, not a Set.
//
// Keyed by brand_key (not raw brand) because the source table
// (brand_platform_override, like brand_platform_pause) only stores the
// generated brand_key column, not the original brand string.

import type { Platform } from './removedPlatformBrands.ts';

export type OverrideState = 'pause' | 'active';

export function overrideKey(tab: string, brandKey: string, platform: Platform): string {
  return `${tab}::${brandKey}::${platform}`;
}

export function buildOverrideMap(
  rows: { tab: string; brand_key: string; platform: Platform; override_state: OverrideState }[],
): Map<string, OverrideState> {
  return new Map(rows.map((r) => [overrideKey(r.tab, r.brand_key, r.platform), r.override_state]));
}

// Separate from buildOverrideMap (whose Map<string, OverrideState> value
// shape is relied on by schedulerService.ts's pause-resolution logic) so
// that logic never has to change just because a display-only "who set this"
// lookup was added. Only rows with a real set_by are included — a legacy or
// unattributed override simply has no entry here, and callers should treat
// that as "unknown," not render an empty name.
export function buildOverrideSetByMap(
  rows: { tab: string; brand_key: string; platform: Platform; set_by: string | null }[],
): Map<string, string> {
  return new Map(
    rows.filter((r) => !!r.set_by).map((r) => [overrideKey(r.tab, r.brand_key, r.platform), r.set_by as string]),
  );
}
