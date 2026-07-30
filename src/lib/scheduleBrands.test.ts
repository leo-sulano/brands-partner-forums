import { describe, it, expect } from 'vitest';
import { scheduleFor, nextStatus, withDayStatus, toISODate, type BrandScheduleRow } from './scheduleBrands';

// No @types/node in this project (browser-only lib set in tsconfig.app.json)
// — declare just enough of the real Node `process` global, which vitest runs
// under, to read/write TZ for the timezone regression test below.
declare const process: { env: { TZ?: string } };

const row: BrandScheduleRow = {
  tab: 'Hanan',
  brand_key: 'pribet.com',
  week_start: '2026-07-27',
  monday: 'active',
  tuesday: null,
  wednesday: 'paused',
  thursday: null,
  friday: null,
};

describe('toISODate', () => {
  it('formats a locally-constructed Date as YYYY-MM-DD', () => {
    const d = new Date(2026, 6, 27); // 0-indexed month: July 27, 2026, local midnight
    expect(toISODate(d)).toBe('2026-07-27');
  });

  it('does not roll the date back a day for timezones ahead of UTC (regression test for the toISOString().slice(0,10) bug)', () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = 'Asia/Manila'; // UTC+8, no DST
    try {
      // Local midnight Monday in Manila is 16:00 the *previous* day in UTC —
      // toISOString().slice(0, 10) would incorrectly return '2026-07-26'.
      const d = new Date(2026, 6, 27, 0, 0, 0);
      expect(toISODate(d)).toBe('2026-07-27');
      // Sanity-check that this environment actually exercises the bug this
      // guards against — if this assertion ever fails, the TZ override above
      // stopped taking effect and the assertion above is no longer proving
      // anything.
      expect(d.toISOString().slice(0, 10)).toBe('2026-07-26');
    } finally {
      if (originalTZ === undefined) delete process.env.TZ;
      else process.env.TZ = originalTZ;
    }
  });
});

describe('scheduleFor', () => {
  it('matches regardless of brand casing or surrounding whitespace', () => {
    expect(scheduleFor([row], 'Hanan', '  PRIBET.COM  ', '2026-07-27')).toBe(row);
  });

  it('returns undefined when no row matches the tab', () => {
    expect(scheduleFor([row], 'Trybet', 'Pribet.com', '2026-07-27')).toBeUndefined();
  });

  it('returns undefined when no row matches the brand', () => {
    expect(scheduleFor([row], 'Hanan', 'WinMega.com', '2026-07-27')).toBeUndefined();
  });

  it('returns undefined when no row matches the week', () => {
    expect(scheduleFor([row], 'Hanan', 'Pribet.com', '2026-08-03')).toBeUndefined();
  });
});

describe('nextStatus', () => {
  it('cycles blank -> active -> paused -> blank', () => {
    expect(nextStatus(null)).toBe('active');
    expect(nextStatus('active')).toBe('paused');
    expect(nextStatus('paused')).toBeNull();
  });
});

describe('withDayStatus', () => {
  it('creates a new row when the brand has none yet this week', () => {
    const result = withDayStatus([], 'Hanan', 'Pribet.com', '2026-07-27', 'monday', 'active');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      tab: 'Hanan', brand_key: 'pribet.com', week_start: '2026-07-27', monday: 'active', tuesday: null,
    });
  });

  it('updates only the given day on an existing row for that week', () => {
    const result = withDayStatus([row], 'Hanan', 'Pribet.com', '2026-07-27', 'tuesday', 'active');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ monday: 'active', tuesday: 'active', wednesday: 'paused' });
  });

  it('matches the existing row regardless of brand casing', () => {
    const result = withDayStatus([row], 'Hanan', '  PRIBET.COM  ', '2026-07-27', 'friday', 'paused');
    expect(result).toHaveLength(1);
    expect(result[0].friday).toBe('paused');
  });

  it('leaves other tabs/brands rows untouched', () => {
    const other: BrandScheduleRow = {
      tab: 'Trybet', brand_key: 'trybet', week_start: '2026-07-27',
      monday: null, tuesday: null, wednesday: null, thursday: null, friday: null,
    };
    const result = withDayStatus([row, other], 'Hanan', 'Pribet.com', '2026-07-27', 'monday', 'paused');
    expect(result.find((r) => r.tab === 'Trybet')).toEqual(other);
  });

  it('creates a separate row for a different week rather than updating the existing one', () => {
    const result = withDayStatus([row], 'Hanan', 'Pribet.com', '2026-08-03', 'monday', 'active');
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.week_start === '2026-07-27')).toEqual(row);
    expect(result.find((r) => r.week_start === '2026-08-03')).toMatchObject({ monday: 'active' });
  });
});
