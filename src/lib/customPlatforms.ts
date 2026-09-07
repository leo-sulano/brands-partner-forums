import type { Entry } from '../types/entry.ts';
import { pick, isLiveStatus, isRemovedStatus, isoToDate, startOfDay, endOfDay, passesDateFilter, rateFromCounts, successRatePct } from './scoreSummary.ts';

export interface CustomPlatformConfig {
  id: string;
  tab: string;
  name: string;
  shortLabel: string;
  statusColumn: string;
  dateColumn: string;
  maxScore: number | null;
}

export interface CustomPlatformCounts {
  total: number;
  live: number;
  removed: number;
  successRate: number | null;
}

// Reuses the same classification helpers (isLiveStatus/isRemovedStatus) and
// the same date-filter semantics (undated rows always included) the 4
// built-in platforms use in scoreSummary.ts -- zero new classification
// logic, so a custom platform can't silently disagree with what "live" or
// "in range" means anywhere else in the app.
export function computeCustomPlatformCounts(
  entries: Entry[],
  platform: CustomPlatformConfig,
  fromISO?: string,
  toISO?: string,
): CustomPlatformCounts {
  const fromDate = fromISO ? isoToDate(fromISO) : null;
  const toDate = toISO ? isoToDate(toISO) : null;
  const fromBound = fromDate ? startOfDay(fromDate) : null;
  const toBound = toDate ? endOfDay(toDate) : null;

  let live = 0;
  let removed = 0;
  for (const e of entries) {
    if (!passesDateFilter(e.data, [platform.dateColumn], fromBound, toBound)) continue;
    const raw = (pick(e.data, [platform.statusColumn]) ?? '').trim().toLowerCase();
    if (!raw) continue;
    if (isLiveStatus(raw)) live++;
    else if (isRemovedStatus(raw)) removed++;
  }
  return {
    total: live + removed,
    live,
    removed,
    successRate: successRatePct(rateFromCounts(live, removed)),
  };
}
