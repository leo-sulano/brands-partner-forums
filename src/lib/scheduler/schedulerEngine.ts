import { WEEKDAYS, type Weekday } from '../scheduleBrands.ts';
import { normalizeBrandKey, type Platform } from '../removedPlatformBrands.ts';
import { PLATFORM_RULES, type PlatformRule } from './schedulerRules.ts';
import { makeRng, shuffle, pickIndex } from './seededRandom.ts';

// If the least-loaded preferred day is at least this much more loaded than
// the week's overall least-loaded day, spill over to the overall best day
// instead of forcing every post onto an already-saturated preferred day.
const DAY_SLACK = 2;

// Least-loaded day among `candidates`, breaking ties by a seeded random pick
// rather than by `candidates` order. This is what keeps a platform from
// piling onto Monday/Tuesday every week: with a shared dayCounts accumulator,
// most picks early in a week are ties, and a positional tie-break (the old
// `leastLoadedDay`) always resolved them toward the front of the week.
// `candidates` is assumed non-empty (every call site guards).
function leastLoadedDayRandom(
  dayCounts: Record<Weekday, number>,
  candidates: Weekday[],
  rng: () => number,
): Weekday {
  let min = Infinity;
  for (const d of candidates) if (dayCounts[d] < min) min = dayCounts[d];
  const tied = candidates.filter((d) => dayCounts[d] === min);
  return tied[pickIndex(tied.length, rng)];
}

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
  // Weekdays that fall on a public holiday this week — receive zero slots.
  // The engine redistributes each platform's normal weekly post count across
  // the remaining days via the same load balancing.
  unavailableDays: Weekday[];
  // Seed for this run's deterministic PRNG — pass `${tab}::${weekStart}` so a
  // regenerate of the same week is byte-identical while each new week gets a
  // fresh shuffle (platform days rotate week to week). Drives the brand-order
  // shuffle, the day tie-breaks, and the TP preferred-pair pick.
  seed: string;
  // Brand keys within their post-catalog-add ramp-up window (see
  // ensureWeekGenerated's rampBrandKeys computation in schedulerService.ts) —
  // capped to 1 post per active platform this week instead of the platform's
  // normal frequency (+ carryover, once that's re-enabled). Optional,
  // defaults to "nobody ramping" so existing callers/tests are unaffected.
  rampBrandKeys?: string[];
}

function hasCombo(list: PinnedCombo[], brandKey: string, platform: Platform): boolean {
  return list.some((c) => c.brandKey === brandKey && c.platform === platform);
}

function selectDays(
  rule: PlatformRule,
  numSlots: number,
  dayCounts: Record<Weekday, number>,
  availableDays: Weekday[],
  rng: () => number,
): Weekday[] {
  // For a platform defined by preferred PAIRS (TP), pick exactly ONE pair for
  // this brand's run rather than pooling every preferred day. Half the tab's
  // brands then land on Mon+Thu and half on Tue+Fri, instead of the old
  // flattened pool letting Friday soak up all the DAY_SLACK spillover.
  const preferredSource: Weekday[] | null = rule.preferredDayPairs
    ? rule.preferredDayPairs[pickIndex(rule.preferredDayPairs.length, rng)]
    : rule.preferredDays ?? null;
  const preferredPool: Weekday[] = (preferredSource ?? [...WEEKDAYS]).filter((d) =>
    availableDays.includes(d),
  );

  const chosen: Weekday[] = [];
  for (let i = 0; i < numSlots; i++) {
    const overallAvailable = availableDays.filter((d) => !chosen.includes(d));
    if (overallAvailable.length === 0) break; // more slots than available weekdays exist; can't place more.
    const preferredAvailable = preferredPool.filter((d) => !chosen.includes(d));

    let pick: Weekday;
    if (preferredAvailable.length === 0) {
      pick = leastLoadedDayRandom(dayCounts, overallAvailable, rng);
    } else {
      const preferredBest = leastLoadedDayRandom(dayCounts, preferredAvailable, rng);
      const overallBest = leastLoadedDayRandom(dayCounts, overallAvailable, rng);
      pick = dayCounts[preferredBest] - dayCounts[overallBest] >= DAY_SLACK ? overallBest : preferredBest;
    }
    chosen.push(pick);
    dayCounts[pick] += 1;
  }
  return chosen;
}

export function generateWeekSchedule(input: SchedulerInput): ScheduledSlot[] {
  const rng = makeRng(input.seed);
  const dayCounts: Record<Weekday, number> = { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0 };
  const availableDays = WEEKDAYS.filter((d) => !input.unavailableDays.includes(d));
  const slots: ScheduledSlot[] = [];
  // Shuffle brand processing order (seeded) so no single brand always claims
  // the earliest least-loaded days. Applied once, reused by both priority
  // loops below.
  const brandKeys = shuffle(
    input.brands.map((brand) => ({ brand, brandKey: normalizeBrandKey(brand) })),
    rng,
  );
  const rampBrandKeys = input.rampBrandKeys ?? [];

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
    if (availableDays.length === 0) return;
    const days = selectDays(PLATFORM_RULES[platform], numSlots, dayCounts, availableDays, rng);
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
      const normalSlots = PLATFORM_RULES[platform].postsPerWeek + carryoverExtra;
      // New-brand ramp-up: cap at 1 post on this platform for the brand's
      // first 2 calendar weeks since being added via the brand catalog,
      // rather than its normal frequency (+carryover).
      const numSlots = rampBrandKeys.includes(brandKey) ? Math.min(1, normalSlots) : normalSlots;
      assign(brand, brandKey, platform, numSlots);
    }
  }

  return slots;
}
