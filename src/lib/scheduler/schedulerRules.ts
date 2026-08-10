import type { Weekday } from '../scheduleBrands.ts';
import type { Platform } from '../removedPlatformBrands.ts';

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
  // Reduced from 3/wk to 1/wk per the 2026-08-07 rules update (see
  // docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md).
  // No preferredDays — load-balanced across the week, same as cg's 1/wk.
  wo: { postsPerWeek: 1 },
};

export const PAUSE_RULES = {
  consecutiveRemovedThreshold: 2,
  pauseDurationWeeks: 1,
  // A brand+platform combo also pauses when its success rate over a
  // ROLLING 30-DAY WINDOW ending on weekStart (see computeSuccessRates in
  // scoreSummary.ts, called with a last30DaysRange DateRange from
  // recalculatePauses in schedulerService.ts) is strictly below this
  // percentage, once it has at least minDecidedPostsForRateCheck decided
  // (live+removed) posts within that window. Independent of, and
  // lower-priority than, the consecutiveRemovedThreshold rule above -- see
  // recalculatePauses in schedulerService.ts. Originally shipped 2026-08-07 (see
  // docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md)
  // as a calendar-month-to-date window (fixing the previously-known-broken
  // all-time oscillation issue), but a final whole-branch review on that
  // same date found the calendar-month window combined with Wizard of
  // Odds' new 1-post/week cadence (and Casino Guru's, already 1/wk) made
  // this trigger mathematically unreachable for both platforms -- neither
  // can accumulate 5 dated posts within a single calendar month. Switched
  // to rolling 30 days per product-owner decision, so every platform has a
  // continuously-available chance to reach the threshold instead of
  // resetting to zero on the 1st of each month.
  successRateThreshold: 40,
  minDecidedPostsForRateCheck: 5,
};

// Reason string for the pause trigger that persists until manually cleared,
// rather than auto-expiring after a week like the automatic triggers do.
// Shared between schedulerService.ts (which produces it) and
// calendarRenderer.tsx (which compares against it to decide the pause
// tooltip's wording) so the two can't drift out of sync.
export const PERSISTENT_PAUSE_REASONS = {
  manual: 'Manually paused',
} as const;

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
