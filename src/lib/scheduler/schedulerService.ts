import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isDoneStatus,
  fetchBrandSchedule,
  bulkUpsertBrandSchedule,
  fetchActiveBrandPlatformPauses,
  upsertBrandPlatformPause,
  deleteBrandPlatformPause,
  clearBrandPlatformOverride,
} from '../queries.ts';
import {
  PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, pick, isRemovedStatus, parsePostDate,
  computeSuccessRates, successRatePct, type SuccessRate, type DateRange,
} from '../scoreSummary.ts';
import { normalizeBrandKey, platformRemovedKey, type Platform } from '../removedPlatformBrands.ts';
import { overrideKey, type OverrideDetails } from '../scheduleOverrides.ts';
import { getSchedulableBrandPlatforms } from '../scheduleBrandConfig.ts';
import { holidayWeekdaysForDateSet } from '../publicHolidays.ts';
import { WEEKDAYS, toISODate, type BrandScheduleUpsertRow } from '../scheduleBrands.ts';
import { BRAND_COLS } from '../tab-configs.ts';
import { generateWeekSchedule, type PinnedCombo, type CarryoverItem, type ScheduledSlot } from './schedulerEngine.ts';
import { weeklyCompletion, completedBrandPlatformKey } from './scheduleUtils.ts';
import { CARRYOVER_RULES, PAUSE_RULES, PERSISTENT_PAUSE_REASONS } from './schedulerRules.ts';
import type { Entry } from '../../types/entry.ts';

export interface ActivatedSlot {
  brand: string;
  brandKey: string;
  platform: Platform;
  date: string;
}

export interface TabContext {
  brands: string[];
  activePlatforms: Platform[];
  entries: Entry[];
  // Keys from platformRemovedKey(tab, brand, platform) for every brand+
  // platform whose page was flagged removed in Brand Tabs. Optional (defaults
  // to "nothing removed") so callers/tests that don't care about this feature
  // don't need to thread an empty Set through everywhere.
  removedPlatformBrandSet?: Set<string>;
  // Every (tab, brand_key, platform) with a manually-set override, beating
  // whatever the automatic checks below would otherwise compute. 'active'
  // forces continued posting (deletes/skips any pause); 'pause' forces a
  // pause unconditionally (with a custom reason and an optional auto-resume
  // date — see recalculatePauses below). Optional, same "defaults to nothing
  // overridden" convention as the other two sets.
  overrideMap?: Map<string, OverrideDetails>;
  // Keys from scheduleBrandKey(tab, brand) for every brand hidden from
  // Schedule Planner entirely (schedule_hidden_brands). Optional, same
  // "defaults to nothing hidden" convention as the other two sets/maps.
  hiddenBrandSet?: Set<string>;
  // scheduleBrandKey(tab, brand) -> the one platform this brand may be
  // scheduled on (schedule_platform_restrictions). Optional, same
  // "defaults to unrestricted" convention.
  platformRestrictionMap?: Map<string, Platform>;
  // ISO date strings ('YYYY-MM-DD') of every public holiday. Any that falls
  // on a Mon-Fri of the week being generated becomes an unavailable day for
  // the engine. Optional — defaults to "no holidays" — same convention as
  // removedPlatformBrandSet / overrideMap / hiddenBrandSet above.
  holidayDates?: Set<string>;
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
// The success-rate pause check uses a rolling 30-day window ending on
// `weekStart`, not a calendar month. Originally shipped as a
// calendar-month-to-date window, but a final whole-branch review found
// that combined with Wizard of Odds' 1-post/week cadence (and Casino
// Guru's, which was already 1/wk), a calendar-month window made this
// trigger mathematically unreachable for both platforms -- neither can
// accumulate minDecidedPostsForRateCheck (5) dated posts within a single
// calendar month, especially in the first half of it. A rolling 30-day
// window gives every platform a real, continuously-available chance to
// reach the threshold instead of resetting to zero on the 1st.
// recalculatePauses is only ever invoked for the actual current week in
// production (both call sites gate on that), so this is equivalent to
// "trailing 30 days as of now" there, while also making the check
// deterministic for a fixed weekStart in tests. Parses weekStart as a
// local date the same way shiftWeek below does, to avoid the
// UTC-conversion bug documented on toISODate in scheduleBrands.ts.
// The Sunday ending the week that starts on weekStart, as an ISO date
// string — used to decide whether a periodic override's resumeAt has
// "passed" for the week currently being evaluated (see recalculatePauses).
// Parsed/formatted as a local date, matching last30DaysRange below, to avoid
// the UTC-conversion bug documented on toISODate in scheduleBrands.ts.
function weekEndSunday(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const sunday = new Date(y, m - 1, d + 6);
  const yyyy = sunday.getFullYear();
  const mm = String(sunday.getMonth() + 1).padStart(2, '0');
  const dd = String(sunday.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function last30DaysRange(weekStart: string): DateRange {
  const [y, m, d] = weekStart.split('-').map(Number);
  const to = new Date(y, m - 1, d);
  const from = new Date(y, m - 1, d);
  from.setDate(from.getDate() - 29);
  return { from, to };
}

export async function recalculatePauses(tab: string, weekStart: string, ctx: TabContext, client?: SupabaseClient): Promise<PinnedCombo[]> {
  const [pauses, existingRows] = await Promise.all([
    fetchActiveBrandPlatformPauses(tab, client),
    fetchBrandSchedule(tab, weekStart, client),
  ]);
  const resumed: PinnedCombo[] = [];
  const removedSet = ctx.removedPlatformBrandSet ?? new Set<string>();
  const overrideMap = ctx.overrideMap ?? new Map<string, OverrideDetails>();
  const hiddenSet = ctx.hiddenBrandSet ?? new Set<string>();
  const restrictionMap = ctx.platformRestrictionMap ?? new Map<string, Platform>();

  // Computed once per active platform (not per brand) since each call scans
  // all of ctx.entries — reused by the success-rate pause check below.
  // normalizedRates re-buckets by normalized brand keys so case variants
  // (e.g. "WinMega" / "winmega") merge correctly.
  const rateRange = last30DaysRange(weekStart);
  const ratesByPlatform = new Map(
    ctx.activePlatforms.map((platform) => [platform, normalizedRates(computeSuccessRates(ctx.entries, [platform], new Set(), rateRange), tab)]),
  );

  for (const brand of ctx.brands) {
    const brandKey = normalizeBrandKey(brand);
    const schedulablePlatforms = getSchedulableBrandPlatforms(tab, brand, ctx.activePlatforms, hiddenSet, restrictionMap);
    for (const platform of ctx.activePlatforms) {
      // A page flagged removed has nothing to pause/resume — leave any
      // existing pause row untouched (harmless while hidden; a real resume
      // still applies correctly if the flag is ever cleared) and never
      // evaluate it for a new pause.
      if (removedSet.has(platformRemovedKey(tab, brand, platform))) continue;

      // A brand hidden from Schedule Planner, or restricted to a different
      // platform than this one, has nothing to pause/resume here either --
      // same rationale as the removed-platform skip above.
      if (!schedulablePlatforms.includes(platform)) continue;

      // Manual override beats every automatic check below -- checked before
      // the existing/alreadyHasRow/consecutive-removed/success-rate chain
      // entirely, not merged into it, since it's an explicit operator
      // decision rather than a background computation. 'pause' deliberately
      // does NOT respect the alreadyHasRow guard the auto path uses below
      // (that guard exists to protect the auto-detection heuristic from a
      // race with a week that's already been generated; a manual override
      // is an intentional action that should always take effect, even for
      // an already-generated week -- the pause row's mere existence dims
      // that week's cells regardless of whether brand_schedule already has
      // a row for it).
      const override = overrideMap.get(overrideKey(tab, brandKey, platform));
      const existingPause = pauses.find((p) => p.brand_key === brandKey && p.platform === platform);

      // A periodic override ('pause' with a resumeAt) auto-expires once its
      // resume date has passed relative to the week being evaluated — checked
      // BEFORE the override === 'pause' branch below, so an expired periodic
      // pause is cleared and resumed rather than re-applied. Note this
      // `continue`s, so it skips the rest of this pass for this combo:
      // auto-detection only applies on the NEXT recalculatePauses run, once
      // the override row is actually gone from a freshly-fetched
      // `overrideMap`. Week-granular, matching
      // every other pause-lifecycle check in this function: a resumeAt
      // anywhere within the week being evaluated already counts as
      // "passed" (compared against that week's Sunday), so a periodic pause
      // resumes as soon as this same week is next evaluated, not one week
      // later.
      if (override?.state === 'pause' && override.resumeAt && override.resumeAt <= weekEndSunday(weekStart)) {
        await clearBrandPlatformOverride(tab, brandKey, platform, client);
        if (existingPause) {
          await deleteBrandPlatformPause(tab, brandKey, platform, client);
          resumed.push({ brandKey, platform });
        }
        continue;
      }
      if (override?.state === 'active') {
        if (existingPause) {
          await deleteBrandPlatformPause(tab, brandKey, platform, client);
          resumed.push({ brandKey, platform });
        }
        continue;
      }
      if (override?.state === 'pause') {
        await upsertBrandPlatformPause(tab, brand, platform, weekStart, override.reason?.trim() || PERSISTENT_PAUSE_REASONS.manual, client);
        continue;
      }

      const existing = pauses.find((p) => p.brand_key === brandKey && p.platform === platform);
      if (existing) {
        if (existing.paused_week_start < weekStart) {
          await deleteBrandPlatformPause(tab, brandKey, platform, client);
          resumed.push({ brandKey, platform });
        }
        continue;
      }
      const alreadyHasRow = existingRows.some((r) => r.platform === platform && r.brand_key === brandKey);
      if (alreadyHasRow) continue;

      const recent = recentStatusesFor(ctx.entries, brandKey, platform).slice(0, 2);
      const bothRemoved = recent.length === 2 && recent.every(isRemovedStatus);
      if (bothRemoved) {
        await upsertBrandPlatformPause(tab, brand, platform, weekStart, 'Two consecutive Removed/Refused posts', client);
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
          `Success rate below ${PAUSE_RULES.successRateThreshold}% in the last 30 days (${pct}% over ${decided} posts)`,
          client,
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

async function buildCarryover(tab: string, weekStart: string, ctx: TabContext, client?: SupabaseClient): Promise<CarryoverItem[]> {
  const lastWeekStart = shiftWeek(weekStart, -7);
  const lastWeekRows = (await fetchBrandSchedule(tab, lastWeekStart, client)).filter((r) => r.platform != null);
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
  client?: SupabaseClient,
): Promise<ActivatedSlot[]> {
  const existingRows = await fetchBrandSchedule(tab, weekStart, client);
  const alreadyHasRowCombos: PinnedCombo[] = existingRows
    .filter((r) => r.platform != null)
    .map((r) => ({ brandKey: r.brand_key, platform: r.platform as Platform }));

  // A removed combo is treated as pinned — "already accounted for, don't
  // touch" — so the generator never assigns it real slots. Without this, a
  // brand whose TP page was flagged removed would keep getting a fresh
  // Mon/Thu-style TP schedule written to brand_schedule every week even
  // though it's hidden from the UI.
  const removedSet = ctx.removedPlatformBrandSet ?? new Set<string>();
  const hiddenSet = ctx.hiddenBrandSet ?? new Set<string>();
  const restrictionMap = ctx.platformRestrictionMap ?? new Map<string, Platform>();
  const removedCombos: PinnedCombo[] = [];
  const excludedCombos: PinnedCombo[] = [];
  for (const brand of ctx.brands) {
    const brandKey = normalizeBrandKey(brand);
    const schedulablePlatforms = getSchedulableBrandPlatforms(tab, brand, ctx.activePlatforms, hiddenSet, restrictionMap);
    for (const platform of ctx.activePlatforms) {
      if (removedSet.has(platformRemovedKey(tab, brand, platform))) {
        removedCombos.push({ brandKey, platform });
      } else if (!schedulablePlatforms.includes(platform)) {
        excludedCombos.push({ brandKey, platform });
      }
    }
  }

  const pauses = await fetchActiveBrandPlatformPauses(tab, client);
  const pausedBrandPlatforms: PinnedCombo[] = pauses
    .filter((p) => p.paused_week_start === weekStart)
    .map((p) => ({ brandKey: p.brand_key, platform: p.platform }));

  const carryover = await buildCarryover(tab, weekStart, ctx, client);

  const unavailableDays = holidayWeekdaysForDateSet(weekStart, ctx.holidayDates ?? new Set());

  const slots = generateWeekSchedule({
    brands: ctx.brands,
    activePlatforms: ctx.activePlatforms,
    pinnedBrandPlatforms: [...alreadyHasRowCombos, ...removedCombos, ...excludedCombos],
    pausedBrandPlatforms,
    resumingBrandPlatforms: resumedThisWeek,
    carryover,
    unavailableDays,
  });

  if (slots.length === 0) return [];
  await bulkUpsertBrandSchedule(groupSlotsIntoRows(tab, weekStart, slots), client);
  return slots.map((slot) => ({
    brand: slot.brand,
    brandKey: slot.brandKey,
    platform: slot.platform,
    date: shiftWeek(weekStart, WEEKDAYS.indexOf(slot.day)),
  }));
}
