import { PLATFORM_FULL_LABEL, type DateEvidenceKind } from './scheduleUtils';
import { WEEKDAYS, type DayStatus, type BrandScheduleRow, type Weekday } from '../scheduleBrands';
import type { BrandPlatformPause } from '../queries';
import type { Platform } from '../removedPlatformBrands';

export const SCHEDULE_EXPORT_HEADERS = [
  'Brand', 'Platform', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Paused This Week', 'Page Removed',
  'Mon Evidence', 'Tue Evidence', 'Wed Evidence', 'Thu Evidence', 'Fri Evidence',
  'Holidays This Week',
];

export interface ScheduleExportBrandData {
  brand: string;
  platforms: Platform[];
  rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>;
  pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>>;
  removedPlatforms: Platform[];
  // What a real entry's status says actually happened each weekday, per
  // resolveDateEvidenceKind (scheduleUtils.ts) — the same overlay ScheduleCell
  // renders on top of the plan below, so the export can't disagree with what
  // the calendar itself shows for a given day. Optional/absent weekday keys
  // mean "no evidence", same as the plan-only columns' blank cells.
  evidenceByPlatform?: Partial<Record<Platform, Partial<Record<Weekday, DateEvidenceKind | null>>>>;
}

function dayStatusLabel(status: DayStatus | undefined): string {
  if (status === 'active') return 'Active';
  if (status === 'paused') return 'Paused';
  return '';
}

function evidenceLabel(kind: DateEvidenceKind | null | undefined): string {
  if (kind === 'removed') return 'Removed';
  if (kind === 'confirmed') return 'Confirmed';
  if (kind === 'pending') return 'Pending';
  if (kind === 'done') return 'Done';
  return '';
}

export function buildScheduleExportRows(
  data: ScheduleExportBrandData[],
  holidaysThisWeek = '',
): string[][] {
  const rows: string[][] = [];
  for (const { brand, platforms, rowsByPlatform, pausesByPlatform, removedPlatforms, evidenceByPlatform } of data) {
    for (const platform of platforms) {
      const row = rowsByPlatform[platform];
      const evidence = evidenceByPlatform?.[platform];
      rows.push([
        brand,
        PLATFORM_FULL_LABEL[platform],
        dayStatusLabel(row?.monday),
        dayStatusLabel(row?.tuesday),
        dayStatusLabel(row?.wednesday),
        dayStatusLabel(row?.thursday),
        dayStatusLabel(row?.friday),
        pausesByPlatform[platform] ? 'Y' : 'N',
        removedPlatforms.includes(platform) ? 'Y' : 'N',
        ...WEEKDAYS.map((wd) => evidenceLabel(evidence?.[wd])),
        holidaysThisWeek,
      ]);
    }
  }
  return rows;
}
