import { WEEKDAYS, toISODate, type Weekday } from './scheduleBrands.ts';

export interface PublicHoliday {
  date: string; // 'YYYY-MM-DD'
  name: string;
}

// The five real calendar dates (Mon..Fri) of the week starting weekStartISO.
// Local-time only — never Date.parse on the ISO string (UTC rollback bug).
function weekdayDatesOf(weekStartISO: string): string[] {
  const [y, m, d] = weekStartISO.split('-').map(Number);
  const monday = new Date(y, m - 1, d);
  return WEEKDAYS.map((_, i) => {
    const day = new Date(monday);
    day.setDate(day.getDate() + i);
    return toISODate(day);
  });
}

export function buildHolidayDateSet(rows: PublicHoliday[]): Set<string> {
  return new Set(rows.map((r) => r.date));
}

export function holidayOn(dateISO: string, holidays: PublicHoliday[]): PublicHoliday | undefined {
  return holidays.find((h) => h.date === dateISO);
}

export function holidaysInWeek(weekStartISO: string, holidays: PublicHoliday[]): PublicHoliday[] {
  const inWeek = new Set(weekdayDatesOf(weekStartISO));
  return holidays.filter((h) => inWeek.has(h.date));
}

export function holidayWeekdaysForDateSet(weekStartISO: string, dates: Set<string>): Weekday[] {
  const weekdayDates = weekdayDatesOf(weekStartISO);
  const out: Weekday[] = [];
  weekdayDates.forEach((iso, i) => {
    if (dates.has(iso)) out.push(WEEKDAYS[i]);
  });
  return out;
}

export function holidayWeekdaysForWeek(weekStartISO: string, holidays: PublicHoliday[]): Weekday[] {
  return holidayWeekdaysForDateSet(weekStartISO, buildHolidayDateSet(holidays));
}
