import { PLATFORM_FULL_LABEL } from './scheduleUtils';
import type { DayStatus, BrandScheduleRow } from '../scheduleBrands';
import type { BrandPlatformPause } from '../queries';
import type { Platform } from '../removedPlatformBrands';

export const SCHEDULE_EXPORT_HEADERS = [
  'Brand', 'Platform', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Paused This Week', 'Page Removed',
];

export interface ScheduleExportBrandData {
  brand: string;
  platforms: Platform[];
  rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>;
  pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>>;
  removedPlatforms: Platform[];
}

function dayStatusLabel(status: DayStatus | undefined): string {
  if (status === 'active') return 'Active';
  if (status === 'paused') return 'Paused';
  return '';
}

export function buildScheduleExportRows(data: ScheduleExportBrandData[]): string[][] {
  const rows: string[][] = [];
  for (const { brand, platforms, rowsByPlatform, pausesByPlatform, removedPlatforms } of data) {
    for (const platform of platforms) {
      const row = rowsByPlatform[platform];
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
      ]);
    }
  }
  return rows;
}
