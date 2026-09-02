import { describe, it, expect } from 'vitest';
import {
  holidaysInWeek,
  holidayWeekdaysForWeek,
  holidayWeekdaysForDateSet,
  holidayOn,
  buildHolidayDateSet,
  type PublicHoliday,
} from './publicHolidays';

// Week of Monday 2026-09-07 .. Friday 2026-09-11.
const WEEK = '2026-09-07';

const HOLIDAYS: PublicHoliday[] = [
  { date: '2026-09-09', name: 'Wednesday Holiday' }, // in-week Wed
  { date: '2026-09-12', name: 'Saturday Holiday' },  // in-week Sat (no column)
  { date: '2026-09-16', name: 'Next Week Holiday' }, // out of week
];

describe('publicHolidays', () => {
  it('holidaysInWeek returns only Mon-Fri holidays inside the week', () => {
    expect(holidaysInWeek(WEEK, HOLIDAYS).map((h) => h.name)).toEqual(['Wednesday Holiday']);
  });

  it('holidayWeekdaysForWeek maps in-week holidays to weekday enum values', () => {
    expect(holidayWeekdaysForWeek(WEEK, HOLIDAYS)).toEqual(['wednesday']);
  });

  it('holidayWeekdaysForWeek returns [] when no holiday lands on a weekday of the week', () => {
    expect(holidayWeekdaysForWeek(WEEK, [{ date: '2026-09-12', name: 'Sat' }])).toEqual([]);
  });

  it('handles two holidays in one week', () => {
    const two: PublicHoliday[] = [
      { date: '2026-09-07', name: 'Mon' },
      { date: '2026-09-10', name: 'Thu' },
    ];
    expect(holidayWeekdaysForWeek(WEEK, two).sort()).toEqual(['monday', 'thursday']);
  });

  it('holidayWeekdaysForDateSet matches holidayWeekdaysForWeek for the same dates', () => {
    const set = new Set(['2026-09-09', '2026-09-12', '2026-09-16']);
    expect(holidayWeekdaysForDateSet(WEEK, set)).toEqual(['wednesday']);
  });

  it('holidayOn returns the holiday for an exact date, else undefined', () => {
    expect(holidayOn('2026-09-09', HOLIDAYS)?.name).toBe('Wednesday Holiday');
    expect(holidayOn('2026-09-08', HOLIDAYS)).toBeUndefined();
  });

  it('buildHolidayDateSet returns a set of ISO date strings', () => {
    const set = buildHolidayDateSet(HOLIDAYS);
    expect(set.has('2026-09-09')).toBe(true);
    expect(set.size).toBe(3);
  });
});
