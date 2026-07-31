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
  completionThreshold: 0.40,
};
