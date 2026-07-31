import {
  isDoneStatus,
  fetchBrandSchedule,
  bulkUpsertBrandSchedule,
  fetchActiveBrandPlatformPauses,
  upsertBrandPlatformPause,
  deleteBrandPlatformPause,
} from '../queries';
import { PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, pick, isRemovedStatus, parsePostDate } from '../scoreSummary';
import { normalizeBrandKey, type Platform } from '../removedPlatformBrands';
import { WEEKDAYS, toISODate, type BrandScheduleUpsertRow } from '../scheduleBrands';
import { BRAND_COLS } from '../tab-configs';
import { generateWeekSchedule, type PinnedCombo, type CarryoverItem, type ScheduledSlot } from './schedulerEngine';
import { weeklyCompletion, completedBrandPlatformKey } from './scheduleUtils';
import { CARRYOVER_RULES } from './schedulerRules';
import type { Entry } from '../../types/entry';

export interface TabContext {
  brands: string[];
  activePlatforms: Platform[];
  entries: Entry[];
}

function brandOf(entry: Entry): string {
  return (pick(entry.data, BRAND_COLS) ?? '').trim();
}

// Chronologically ordered (most recent first) status values for one
// brand+platform, drawn from that tab's raw entries. Rows with no date fall
// last, in original order, rather than being dropped — an undated Removed
// row should still be seen as "recent" rather than silently ignored.
function recentStatusesFor(entries: Entry[], brandKey: string, platform: Platform): string[] {
  const statusKeys = PLATFORM_STATUS_KEYS[platform];
  const dateKeys = PLATFORM_DATE_KEYS[platform];
  return entries
    .filter((e) => normalizeBrandKey(brandOf(e)) === brandKey)
    .map((e) => ({
      status: (pick(e.data, statusKeys) ?? '').trim().toLowerCase(),
      date: parsePostDate(pick(e.data, dateKeys)),
    }))
    .filter((x) => x.status !== '')
    .sort((a, b) => {
      if (a.date && b.date) return b.date.getTime() - a.date.getTime();
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    })
    .map((x) => x.status);
}

// Evaluates every active brand+platform combination for this tab: pauses one
// if its two most recent posts are both Removed/Refused-classified and it
// isn't already paused; resumes (deletes) any pause whose week has passed.
// Returns the combos that resumed on this call, for the caller to pass into
// ensureWeekGenerated as `resumedThisWeek`.
export async function recalculatePauses(tab: string, weekStart: string, ctx: TabContext): Promise<PinnedCombo[]> {
  const pauses = await fetchActiveBrandPlatformPauses(tab);
  const resumed: PinnedCombo[] = [];

  for (const brand of ctx.brands) {
    const brandKey = normalizeBrandKey(brand);
    for (const platform of ctx.activePlatforms) {
      const existing = pauses.find((p) => p.brand_key === brandKey && p.platform === platform);
      if (existing) {
        if (existing.paused_week_start < weekStart) {
          await deleteBrandPlatformPause(tab, brandKey, platform);
          resumed.push({ brandKey, platform });
        }
        continue;
      }
      const recent = recentStatusesFor(ctx.entries, brandKey, platform).slice(0, 2);
      const bothRemoved = recent.length === 2 && recent.every(isRemovedStatus);
      if (bothRemoved) {
        await upsertBrandPlatformPause(tab, brand, platform, weekStart, 'Two consecutive Removed/Refused posts');
      }
    }
  }

  return resumed;
}

function shiftWeek(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

async function buildCarryover(tab: string, weekStart: string, ctx: TabContext): Promise<CarryoverItem[]> {
  const lastWeekStart = shiftWeek(weekStart, -7);
  const lastWeekRows = (await fetchBrandSchedule(tab, lastWeekStart)).filter((r) => r.platform != null);
  if (lastWeekRows.length === 0) return [];

  const completedBrandPlatforms = new Set<string>();
  for (const e of ctx.entries) {
    const brand = brandOf(e);
    if (!brand) continue;
    const brandKey = normalizeBrandKey(brand);
    for (const platform of ctx.activePlatforms) {
      const status = (pick(e.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (status && isDoneStatus(status)) {
        completedBrandPlatforms.add(completedBrandPlatformKey(brandKey, platform));
      }
    }
  }

  const { ratio } = weeklyCompletion(lastWeekRows, completedBrandPlatforms);
  if (ratio === null || ratio >= CARRYOVER_RULES.completionThreshold) return [];

  const items: CarryoverItem[] = [];
  for (const row of lastWeekRows) {
    const platform = row.platform as Platform;
    if (completedBrandPlatforms.has(completedBrandPlatformKey(row.brand_key, platform))) continue;
    const slotCount = WEEKDAYS.filter((d) => row[d] != null).length;
    if (slotCount === 0) continue;
    const brand = ctx.brands.find((b) => normalizeBrandKey(b) === row.brand_key) ?? row.brand_key;
    items.push({ brand, brandKey: row.brand_key, platform, count: slotCount });
  }
  return items;
}

function groupSlotsIntoRows(tab: string, weekStart: string, slots: ScheduledSlot[]): BrandScheduleUpsertRow[] {
  const map = new Map<string, BrandScheduleUpsertRow>();
  for (const slot of slots) {
    const key = `${slot.brandKey}::${slot.platform}`;
    let row = map.get(key);
    if (!row) {
      row = {
        tab, brand: slot.brand, week_start: weekStart, platform: slot.platform,
        monday: null, tuesday: null, wednesday: null, thursday: null, friday: null,
      };
      map.set(key, row);
    }
    row[slot.day] = 'active';
  }
  return [...map.values()];
}

// Generates and writes this week's schedule exactly once — a no-op if any
// platform-tagged row already exists for (tab, weekStart), so navigating
// back to an already-generated week never regenerates it.
export async function ensureWeekGenerated(
  tab: string,
  weekStart: string,
  ctx: TabContext,
  resumedThisWeek: PinnedCombo[],
): Promise<void> {
  const existingRows = await fetchBrandSchedule(tab, weekStart);
  if (existingRows.some((r) => r.platform != null)) return;

  const pauses = await fetchActiveBrandPlatformPauses(tab);
  const pausedBrandPlatforms: PinnedCombo[] = pauses
    .filter((p) => p.paused_week_start === weekStart)
    .map((p) => ({ brandKey: p.brand_key, platform: p.platform }));

  const carryover = await buildCarryover(tab, weekStart, ctx);

  const slots = generateWeekSchedule({
    brands: ctx.brands,
    activePlatforms: ctx.activePlatforms,
    pinnedBrandPlatforms: [],
    pausedBrandPlatforms,
    resumingBrandPlatforms: resumedThisWeek,
    carryover,
  });

  if (slots.length === 0) return;
  await bulkUpsertBrandSchedule(groupSlotsIntoRows(tab, weekStart, slots));
}
