import { normalizeBrandKey } from './removedPlatformBrands';

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

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
export const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
export type DayStatus = 'active' | 'paused' | null;

export interface BrandScheduleRow {
  tab: string;
  brand_key: string;
  week_start: string;
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
): BrandScheduleRow | undefined {
  const key = normalizeBrandKey(brand);
  return rows.find((r) => r.tab === tab && r.brand_key === key && r.week_start === weekStart);
}

export function nextStatus(current: DayStatus): DayStatus {
  if (current === null) return 'active';
  if (current === 'active') return 'paused';
  return null;
}

// Returns a new array with the (tab, brand, weekStart)'s `day` column set to
// `status`, creating a blank row first if none exists yet for that week.
// Pure — callers use this for both the optimistic local update and its
// rollback on save failure.
export function withDayStatus(
  rows: BrandScheduleRow[],
  tab: string,
  brand: string,
  weekStart: string,
  day: Weekday,
  status: DayStatus,
): BrandScheduleRow[] {
  const key = normalizeBrandKey(brand);
  const idx = rows.findIndex((r) => r.tab === tab && r.brand_key === key && r.week_start === weekStart);
  if (idx === -1) {
    const blank: BrandScheduleRow = {
      tab,
      brand_key: key,
      week_start: weekStart,
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
