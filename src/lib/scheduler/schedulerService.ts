import {
  isDoneStatus,
  fetchBrandSchedule,
  bulkUpsertBrandSchedule,
  fetchActiveBrandPlatformPauses,
  upsertBrandPlatformPause,
  deleteBrandPlatformPause,
} from '../queries';
import {
  PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, pick, isRemovedStatus, parsePostDate,
  computeSuccessRates, successRatePct, type SuccessRate,
} from '../scoreSummary';
import { normalizeBrandKey, type Platform } from '../removedPlatformBrands';
import { WEEKDAYS, toISODate, type BrandScheduleUpsertRow } from '../scheduleBrands';
import { BRAND_COLS } from '../tab-configs';
import { generateWeekSchedule, type PinnedCombo, type CarryoverItem, type ScheduledSlot } from './schedulerEngine';
import { weeklyCompletion, completedBrandPlatformKey } from './scheduleUtils';
import { CARRYOVER_RULES, PAUSE_RULES } from './schedulerRules';
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

// computeSuccessRates buckets by exact brand-string casing (its Map key is
// `${tab} ${brand}`, unnormalized). Everything else in this file matches
// brands via normalizeBrandKey (trim + lowercase) — re-bucket here so two
// casing variants of the same brand (e.g. "WinMega" / "winmega") in raw
// entry data can't silently split into two under-counted buckets and cause
// a false negative (missed 5-post minimum) or false positive (understated
// post count) on the success-rate pause check.
//
// Note: computeSuccessRates uses scoreSummary.ts's BRAND_KEYS for brand
// resolution while recentStatusesFor/brandOf use BRAND_COLS (from
// tab-configs.ts), and these lists aren't identical (BRAND_COLS includes
// 'Account Name', BRAND_KEYS doesn't) — a tab whose brand column resolves
// to 'Account Name' would have computeSuccessRates silently find no brand
// for every row. This is a latent (not live) limitation; do not fix it
// without coordinating with scoreSummary.ts's broader usage.
function normalizedRates(rates: Map<string, SuccessRate>, tab: string): Map<string, SuccessRate> {
  const merged = new Map<string, { live: number; removed: number }>();
  const prefix = `${tab} `;
  for (const [key, sr] of rates) {
    if (!key.startsWith(prefix)) continue;
    const brandKey = normalizeBrandKey(key.slice(prefix.length));
    const acc = merged.get(brandKey) ?? { live: 0, removed: 0 };
    acc.live += sr.live;
    acc.removed += sr.removed;
    merged.set(brandKey, acc);
  }
  const result = new Map<string, SuccessRate>();
  for (const [brandKey, { live, removed }] of merged) {
    const total = live + removed;
    result.set(brandKey, { live, removed, rate: total === 0 ? null : (live / total) * 100 });
  }
  return result;
}

// Evaluates every active brand+platform combination for this tab: pauses one
// if its two most recent posts are both Removed/Refused-classified and it
// isn't already paused; resumes (deletes) any pause whose week has passed.
// Returns the combos that resumed on this call, for the caller to pass into
// ensureWeekGenerated as `resumedThisWeek`.
//
// A new pause is only ever inserted for a brand+platform combo that doesn't
// already have a row for this week — checked per combo, not per week, so a
// manually pre-filled combo (e.g. a future week edited ahead of time) can
// never block pause-detection for every OTHER combo that week. Once a
// combo's row for that week already exists, inserting a pause for it can
// never actually affect that row — the pause would just sit in the table
// inert, and its mere existence would corrupt the *next* week's resume
// logic (it would look like a real pause that "expired" and get reported as
// resumed even though it never took effect). The resume/delete path stays
// unconditional: deleting an expired pause is always safe and idempotent.
export async function recalculatePauses(tab: string, weekStart: string, ctx: TabContext): Promise<PinnedCombo[]> {
  const [pauses, existingRows] = await Promise.all([
    fetchActiveBrandPlatformPauses(tab),
    fetchBrandSchedule(tab, weekStart),
  ]);
  const resumed: PinnedCombo[] = [];

  // Computed once per active platform (not per brand) since each call scans
  // all of ctx.entries — reused by the success-rate pause check below.
  // normalizedRates re-buckets by normalized brand keys so case variants
  // (e.g. "WinMega" / "winmega") merge correctly.
  const ratesByPlatform = new Map(
    ctx.activePlatforms.map((platform) => [platform, normalizedRates(computeSuccessRates(ctx.entries, platform), tab)]),
  );

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
      const alreadyHasRow = existingRows.some((r) => r.platform === platform && r.brand_key === brandKey);
      if (alreadyHasRow) continue;

      const recent = recentStatusesFor(ctx.entries, brandKey, platform).slice(0, 2);
      const bothRemoved = recent.length === 2 && recent.every(isRemovedStatus);
      if (bothRemoved) {
        await upsertBrandPlatformPause(tab, brand, platform, weekStart, 'Two consecutive Removed/Refused posts');
        continue;
      }

      // Second, independent trigger: sustained poor performance rather than
      // just the last two posts. Lower priority than the check above — a
      // combo can only hold one pause row, and consecutive-removed is
      // checked first.
      const sr = ratesByPlatform.get(platform)?.get(brandKey);
      const decided = (sr?.live ?? 0) + (sr?.removed ?? 0);
      const lowSuccessRate =
        sr != null &&
        decided >= PAUSE_RULES.minDecidedPostsForRateCheck &&
        sr.rate != null &&
        sr.rate < PAUSE_RULES.successRateThreshold;
      if (lowSuccessRate) {
        const pct = successRatePct(sr!.rate);
        await upsertBrandPlatformPause(
          tab, brand, platform, weekStart,
          `Success rate below ${PAUSE_RULES.successRateThreshold}% (${pct}% over ${decided} posts)`,
        );
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

// Generates and writes this week's schedule for every brand+platform combo
// that doesn't already have a row for (tab, weekStart) — any combo that
// already has one is passed to the engine as "pinned" and left completely
// untouched. This is checked per combo, not per week: navigating back to
// an already-fully-generated week still writes nothing (every combo is
// pinned, so the generator produces zero slots), but a week with only SOME
// combos manually pre-filled (e.g. a future week edited ahead of time)
// still gets every other combo generated normally once it becomes current.
export async function ensureWeekGenerated(
  tab: string,
  weekStart: string,
  ctx: TabContext,
  resumedThisWeek: PinnedCombo[],
): Promise<void> {
  const existingRows = await fetchBrandSchedule(tab, weekStart);
  const alreadyHasRowCombos: PinnedCombo[] = existingRows
    .filter((r) => r.platform != null)
    .map((r) => ({ brandKey: r.brand_key, platform: r.platform as Platform }));

  const pauses = await fetchActiveBrandPlatformPauses(tab);
  const pausedBrandPlatforms: PinnedCombo[] = pauses
    .filter((p) => p.paused_week_start === weekStart)
    .map((p) => ({ brandKey: p.brand_key, platform: p.platform }));

  const carryover = await buildCarryover(tab, weekStart, ctx);

  const slots = generateWeekSchedule({
    brands: ctx.brands,
    activePlatforms: ctx.activePlatforms,
    pinnedBrandPlatforms: alreadyHasRowCombos,
    pausedBrandPlatforms,
    resumingBrandPlatforms: resumedThisWeek,
    carryover,
  });

  if (slots.length === 0) return;
  await bulkUpsertBrandSchedule(groupSlotsIntoRows(tab, weekStart, slots));
}
