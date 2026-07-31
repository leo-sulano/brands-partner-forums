import type { Weekday } from '../scheduleBrands';
import type { Platform } from '../removedPlatformBrands';

export interface PlatformRule {
  postsPerWeek: number;
  preferredDays?: Weekday[];
  preferredDayPairs?: Weekday[][];
}

// Adding a 5th platform: add one entry here, one entry in scoreSummary.ts's
// PLATFORM_STATUS_KEYS/PLATFORM_DATE_KEYS, and one entry in scheduleUtils.ts's
// PLATFORM_BADGE — nothing in schedulerEngine.ts or schedulerService.ts
// changes.
export const PLATFORM_RULES: Record<Platform, PlatformRule> = {
  tp: { postsPerWeek: 2, preferredDayPairs: [['monday', 'thursday'], ['tuesday', 'friday']] },
  ag: { postsPerWeek: 2 },
  cg: { postsPerWeek: 1 },
  wo: { postsPerWeek: 3, preferredDays: ['monday', 'wednesday', 'friday'] },
};

export const PAUSE_RULES = {
  consecutiveRemovedThreshold: 2,
  pauseDurationWeeks: 1,
};

export const CARRYOVER_RULES = {
  // Deliberately disabled (0 instead of 0.40) for this initial ship.
  // `buildCarryover` (schedulerService.ts) sets a carryover item's `count` to
  // last week's TOTAL non-null day count for that brand+platform, not the
  // unfinished remainder, and `completedBrandPlatforms` is built from
  // ALL-TIME entries matched by an exact `=== 'done'` status — so a combo
  // that never records a literal "done" status reads as 0% complete every
  // single week. Combined, carryover would compound unbounded (1 -> 2 -> 3 ->
  // 4 -> 5 slots, capping only because there are just 5 weekdays) for any
  // combo that never hits 'done', saturating it to every weekday within
  // roughly 5 weeks. This is a design-level gap in the original spec (which
  // called for uncapped additive carryover with no time-scoping on
  // completion), not a coding mistake — and the spec's own phased-rollout
  // section already says carryover should be the LAST piece enabled,
  // specifically because it needs at least one fully platform-generated
  // week of real data to validate against before it's safe to turn on live.
  // `ratio < completionThreshold` can never be true when this is 0 (a ratio
  // is never negative), so `buildCarryover` always returns an empty list —
  // a no-op, zero-risk state — until the formula is redesigned (time-scoped
  // completion + a capped/remainder-based count instead of last week's full
  // total) and re-enabled as its own follow-up.
  completionThreshold: 0,
};
