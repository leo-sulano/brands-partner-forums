// A manual override lets ops force a brand+platform's schedule state,
// beating whatever recalculatePauses' automatic detection would otherwise
// compute (docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md).
// 'pause' forces a pause regardless of auto conditions; 'active' forces
// continued posting even if auto-detection would otherwise pause it.
// Unlike removedPlatformBrands (boolean presence), this carries state, so
// the shared helper here builds a Map, not a Set.
//
// Keyed by brand_key (not raw brand) because the source table
// (brand_platform_override, like brand_platform_pause) only stores the
// generated brand_key column, not the original brand string.
//
// reason/resumeAt (docs/superpowers/specs/2026-09-02-brand-platform-pause-reason-design.md)
// are only meaningful when state === 'pause'. reason is null for the
// pre-existing Edit Entry "Force Paused" path (which never collects one) and
// for every 'active' override. resumeAt is null for a permanent pause; an
// ISO date for a periodic one recalculatePauses auto-expires.
//
// Everything (state, reason, resumeAt, who-set-it) lives in one map now,
// not split across a second parallel buildOverrideSetByMap the way this file
// used to -- two lookups for the same key that could silently drift is
// exactly the class of bug the reason/resumeAt addition would have made
// worse, not better, if kept split.

import type { Platform } from './removedPlatformBrands.ts';

export type OverrideState = 'pause' | 'active';

export interface OverrideDetails {
  state: OverrideState;
  reason: string | null;
  resumeAt: string | null;
  setBy: string | null;
}

export function overrideKey(tab: string, brandKey: string, platform: Platform): string {
  return `${tab}::${brandKey}::${platform}`;
}

export function buildOverrideMap(
  rows: {
    tab: string;
    brand_key: string;
    platform: Platform;
    override_state: OverrideState;
    reason: string | null;
    resume_at: string | null;
    set_by: string | null;
  }[],
): Map<string, OverrideDetails> {
  return new Map(
    rows.map((r) => [
      overrideKey(r.tab, r.brand_key, r.platform),
      { state: r.override_state, reason: r.reason ?? null, resumeAt: r.resume_at ?? null, setBy: r.set_by ?? null },
    ]),
  );
}
