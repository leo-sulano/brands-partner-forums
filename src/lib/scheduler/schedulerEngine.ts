import { WEEKDAYS, type Weekday } from '../scheduleBrands';
import { normalizeBrandKey, type Platform } from '../removedPlatformBrands';
import { PLATFORM_RULES, type PlatformRule } from './schedulerRules';
import { leastLoadedDay } from './scheduleUtils';

// If the least-loaded preferred day is at least this much more loaded than
// the week's overall least-loaded day, spill over to the overall best day
// instead of forcing every post onto an already-saturated preferred day.
const DAY_SLACK = 2;

export interface ScheduledSlot {
  brand: string;
  brandKey: string;
  platform: Platform;
  day: Weekday;
}

export interface PinnedCombo {
  brandKey: string;
  platform: Platform;
}

export interface CarryoverItem {
  brand: string;
  brandKey: string;
  platform: Platform;
  count: number;
}

export interface SchedulerInput {
  brands: string[];
  activePlatforms: Platform[];
  pinnedBrandPlatforms: PinnedCombo[];
  pausedBrandPlatforms: PinnedCombo[];
  resumingBrandPlatforms: PinnedCombo[];
  carryover: CarryoverItem[];
}

function hasCombo(list: PinnedCombo[], brandKey: string, platform: Platform): boolean {
  return list.some((c) => c.brandKey === brandKey && c.platform === platform);
}

function selectDays(rule: PlatformRule, numSlots: number, dayCounts: Record<Weekday, number>): Weekday[] {
  const preferredPool: Weekday[] = rule.preferredDayPairs
    ? [...new Set(rule.preferredDayPairs.flat())]
    : rule.preferredDays
      ? [...rule.preferredDays]
      : [...WEEKDAYS];

  const chosen: Weekday[] = [];
  for (let i = 0; i < numSlots; i++) {
    const overallAvailable = WEEKDAYS.filter((d) => !chosen.includes(d));
    if (overallAvailable.length === 0) break; // more slots than weekdays exist; can't place more.
    const preferredAvailable = preferredPool.filter((d) => !chosen.includes(d));

    let pick: Weekday;
    if (preferredAvailable.length === 0) {
      pick = leastLoadedDay(dayCounts, overallAvailable);
    } else {
      const preferredBest = leastLoadedDay(dayCounts, preferredAvailable);
      const overallBest = leastLoadedDay(dayCounts, overallAvailable);
      pick = dayCounts[preferredBest] - dayCounts[overallBest] >= DAY_SLACK ? overallBest : preferredBest;
    }
    chosen.push(pick);
    dayCounts[pick] += 1;
  }
  return chosen;
}

export function generateWeekSchedule(input: SchedulerInput): ScheduledSlot[] {
  const dayCounts: Record<Weekday, number> = { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0 };
  const slots: ScheduledSlot[] = [];
  const brandKeys = input.brands.map((brand) => ({ brand, brandKey: normalizeBrandKey(brand) }));

  // Build carryover lookup map from valid combos only (those in brands × activePlatforms).
  // This prevents carryover from introducing rows for brand/platform combos the tab doesn't track.
  const carryoverMap = new Map<string, number>();
  for (const item of input.carryover) {
    if (brandKeys.some((bk) => bk.brandKey === item.brandKey) && input.activePlatforms.includes(item.platform)) {
      const key = `${item.brandKey}::${item.platform}`;
      carryoverMap.set(key, (carryoverMap.get(key) ?? 0) + item.count);
    }
  }

  function assign(brand: string, brandKey: string, platform: Platform, numSlots: number) {
    if (numSlots <= 0) return;
    const days = selectDays(PLATFORM_RULES[platform], numSlots, dayCounts);
    for (const day of days) slots.push({ brand, brandKey, platform, day });
  }

  // Priority 2: platforms resuming from pause, at their normal frequency.
  for (const { brand, brandKey } of brandKeys) {
    for (const platform of input.activePlatforms) {
      if (!hasCombo(input.resumingBrandPlatforms, brandKey, platform)) continue;
      if (hasCombo(input.pinnedBrandPlatforms, brandKey, platform)) continue;
      if (hasCombo(input.pausedBrandPlatforms, brandKey, platform)) continue;
      assign(brand, brandKey, platform, PLATFORM_RULES[platform].postsPerWeek);
    }
  }

  // Priority 3: everyone else at normal frequency + carryover (if any). This is also "fill
  // remaining slots" — every active, non-paused, non-pinned, non-resuming
  // combination passes through here exactly once, with carryover baked into the frequency.
  for (const { brand, brandKey } of brandKeys) {
    for (const platform of input.activePlatforms) {
      if (hasCombo(input.pinnedBrandPlatforms, brandKey, platform)) continue;
      if (hasCombo(input.pausedBrandPlatforms, brandKey, platform)) continue;
      if (hasCombo(input.resumingBrandPlatforms, brandKey, platform)) continue;
      // Look up carryover for this combo (0 if none), add to normal frequency, assign once.
      const key = `${brandKey}::${platform}`;
      const carryoverExtra = carryoverMap.get(key) ?? 0;
      assign(brand, brandKey, platform, PLATFORM_RULES[platform].postsPerWeek + carryoverExtra);
    }
  }

  return slots;
}
