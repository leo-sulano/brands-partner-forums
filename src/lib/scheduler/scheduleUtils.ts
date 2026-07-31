import { WEEKDAYS, type Weekday, type BrandScheduleRow } from '../scheduleBrands';
import type { Platform } from '../removedPlatformBrands';

export const PLATFORM_BADGE: Record<Platform, { label: string; className: string }> = {
  tp: { label: 'TP', className: 'bg-emerald-100 text-emerald-700' },
  ag: { label: 'AG', className: 'bg-sky-100 text-sky-700' },
  cg: { label: 'CG', className: 'bg-amber-100 text-amber-700' },
  wo: { label: 'WO', className: 'bg-violet-100 text-violet-700' },
};

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
