import { WEEKDAYS, toISODate, type Weekday, type BrandScheduleRow } from '../scheduleBrands';
import { normalizeBrandKey, type Platform } from '../removedPlatformBrands';
import { PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, pick, isRemovedStatus, parsePostDate } from '../scoreSummary';
import { BRAND_COLS } from '../tab-configs';
import type { Entry } from '../../types/entry';

export const PLATFORM_BADGE: Record<Platform, { label: string; className: string }> = {
  tp: { label: 'TP', className: 'bg-emerald-100 text-emerald-700' },
  ag: { label: 'AG', className: 'bg-sky-100 text-sky-700' },
  cg: { label: 'CG', className: 'bg-amber-100 text-amber-700' },
  wo: { label: 'WO', className: 'bg-violet-100 text-violet-700' },
};

// Full display name for tooltips and the Add Platform modal — the short
// TP/AG/CG/WO code lives in PLATFORM_BADGE above, this is the human-readable
// version shown alongside it.
export const PLATFORM_FULL_LABEL: Record<Platform, string> = {
  tp: 'Trustpilot',
  ag: 'AskGamblers',
  cg: 'CasinoGuru',
  wo: 'Wizard of Odds',
};

// A platform counts as "scheduled" for a given day if it's scheduler-paused
// for the whole week (pausedPlatforms[platform] truthy — a paused combo has
// zero day rows by design, so it would otherwise look unscheduled every day)
// or that day's status is non-null. Shared by ScheduleCell (to decide which
// chips to render/which platforms are addable) and SchedulePlanner (to
// compute the Add Platform modal's live addable list) so the two can never
// disagree about what counts as "already there."
export function unscheduledPlatforms(
  platforms: Platform[],
  day: Weekday,
  rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>,
  pausedPlatforms: Partial<Record<Platform, unknown>>,
): Platform[] {
  return platforms.filter((p) => !pausedPlatforms[p] && rowsByPlatform[p]?.[day] == null);
}

// Deterministic: ties break by `candidates`' own order, so callers control
// tie-breaking by the order they pass in (schedulerEngine relies on this).
export function leastLoadedDay(dayCounts: Record<Weekday, number>, candidates: Weekday[]): Weekday {
  let best = candidates[0];
  for (const day of candidates) {
    if (dayCounts[day] < dayCounts[best]) best = day;
  }
  return best;
}

export function completedBrandPlatformKey(brandKey: string, platform: Platform): string {
  return `${brandKey}::${platform}`;
}

const ALL_PLATFORMS = Object.keys(PLATFORM_STATUS_KEYS) as Platform[];

// A brand+platform+exact-date lookup of "the post scheduled for this brand
// on this platform on this calendar day was later found Removed/Refused",
// built once per tab load from raw entries. Brand resolution matches
// SchedulePlanner.tsx's own brand-list resolution (BRAND_COLS), not
// scoreSummary.ts's separate BRAND_KEYS list — see the note in
// schedulerService.ts's normalizedRates for why those two lists disagree.
export function buildRemovedOnDateIndex(entries: Entry[]): Set<string> {
  const index = new Set<string>();
  for (const entry of entries) {
    const brand = (pick(entry.data, BRAND_COLS) ?? '').trim();
    if (!brand) continue;
    const brandKey = normalizeBrandKey(brand);
    for (const platform of ALL_PLATFORMS) {
      const status = (pick(entry.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status || !isRemovedStatus(status)) continue;
      const date = parsePostDate(pick(entry.data, PLATFORM_DATE_KEYS[platform]));
      if (!date) continue;
      index.add(`${brandKey}::${platform}::${toISODate(date)}`);
    }
  }
  return index;
}

// Brand Tab Completion Rule: scheduled = total non-null day-slots across this
// week's platform-tagged rows (legacy platform:null rows are excluded —
// they carry no meaningful per-platform scheduled/completed concept);
// completed = how many of those slots belong to a (brand_key, platform) pair
// present in `completedBrandPlatforms` (built by the caller from `entries`
// via isDoneStatus — this function does no I/O of its own).
export function weeklyCompletion(
  scheduleRows: BrandScheduleRow[],
  completedBrandPlatforms: Set<string>,
): { scheduled: number; completed: number; ratio: number | null } {
  let scheduled = 0;
  let completed = 0;
  for (const row of scheduleRows) {
    if (row.platform == null) continue;
    const slotCount = WEEKDAYS.filter((d) => row[d] != null).length;
    if (slotCount === 0) continue;
    scheduled += slotCount;
    if (completedBrandPlatforms.has(completedBrandPlatformKey(row.brand_key, row.platform))) {
      completed += slotCount;
    }
  }
  return { scheduled, completed, ratio: scheduled === 0 ? null : completed / scheduled };
}
