import { normalizeBrandKey } from './removedPlatformBrands.ts';
import type { Platform } from './removedPlatformBrands.ts';

// NOTE: deliberately NOT `date.toISOString().slice(0, 10)` — that converts to
// UTC first, which silently rolls the date back a day for any browser whose
// local timezone is ahead of UTC (e.g. UTC+8 Manila: a local midnight Monday
// becomes 16:00 the previous day in UTC). Building the string from local
// getFullYear/getMonth/getDate keeps this in agreement with mondayOf/
// formatWeekdayDate in SchedulePlanner.tsx, which are local-time throughout —
// otherwise the visible "Week of ..." label and the week_start actually
// fetched/written disagree by a day for those users, and every previously-
// saved row becomes invisible.
export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
export const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
};
export type DayStatus = 'active' | 'paused' | null;

export interface BrandScheduleRow {
  tab: string;
  brand_key: string;
  week_start: string;
  platform: Platform | null;
  monday: DayStatus;
  tuesday: DayStatus;
  wednesday: DayStatus;
  thursday: DayStatus;
  friday: DayStatus;
}

// A write payload uses the raw `brand` name (brand_key is DB-generated) and
// always carries a real platform — legacy platform-less rows are never
// written by new code.
export interface BrandScheduleUpsertRow {
  tab: string;
  brand: string;
  week_start: string;
  platform: Platform;
  monday: DayStatus;
  tuesday: DayStatus;
  wednesday: DayStatus;
  thursday: DayStatus;
  friday: DayStatus;
}

export function scheduleFor(
  rows: BrandScheduleRow[],
  tab: string,
  brand: string,
  weekStart: string,
  platform: Platform | null = null,
): BrandScheduleRow | undefined {
  const key = normalizeBrandKey(brand);
  return rows.find(
    (r) => r.tab === tab && r.brand_key === key && r.week_start === weekStart && r.platform === platform,
  );
}

export function nextStatus(current: DayStatus): DayStatus {
  if (current === null) return 'active';
  if (current === 'active') return 'paused';
  return null;
}

export function withDayStatus(
  rows: BrandScheduleRow[],
  tab: string,
  brand: string,
  weekStart: string,
  platform: Platform | null,
  day: Weekday,
  status: DayStatus,
): BrandScheduleRow[] {
  const key = normalizeBrandKey(brand);
  const idx = rows.findIndex(
    (r) => r.tab === tab && r.brand_key === key && r.week_start === weekStart && r.platform === platform,
  );
  if (idx === -1) {
    const blank: BrandScheduleRow = {
      tab,
      brand_key: key,
      week_start: weekStart,
      platform,
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
    };
    return [...rows, { ...blank, [day]: status }];
  }
  const updated = [...rows];
  updated[idx] = { ...updated[idx], [day]: status };
  return updated;
}
