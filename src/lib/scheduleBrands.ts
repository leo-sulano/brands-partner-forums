import { normalizeBrandKey } from './removedPlatformBrands';

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
export const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
export type DayStatus = 'active' | 'paused' | null;

export interface BrandScheduleRow {
  tab: string;
  brand_key: string;
  monday: DayStatus;
  tuesday: DayStatus;
  wednesday: DayStatus;
  thursday: DayStatus;
  friday: DayStatus;
}

export function scheduleFor(rows: BrandScheduleRow[], tab: string, brand: string): BrandScheduleRow | undefined {
  const key = normalizeBrandKey(brand);
  return rows.find((r) => r.tab === tab && r.brand_key === key);
}

export function nextStatus(current: DayStatus): DayStatus {
  if (current === null) return 'active';
  if (current === 'active') return 'paused';
  return null;
}

// Returns a new array with the (tab, brand)'s `day` column set to `status`,
// creating a blank row first if none exists yet. Pure — callers use this for
// both the optimistic local update and its rollback on save failure.
export function withDayStatus(
  rows: BrandScheduleRow[],
  tab: string,
  brand: string,
  day: Weekday,
  status: DayStatus,
): BrandScheduleRow[] {
  const key = normalizeBrandKey(brand);
  const idx = rows.findIndex((r) => r.tab === tab && r.brand_key === key);
  if (idx === -1) {
    const blank: BrandScheduleRow = {
      tab,
      brand_key: key,
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
