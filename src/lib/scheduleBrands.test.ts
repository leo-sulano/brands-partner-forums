import { describe, it, expect } from 'vitest';
import { scheduleFor, nextStatus, withDayStatus, toISODate, mondayOf, isCurrentWeekStart, type BrandScheduleRow } from './scheduleBrands';

// No @types/node in this project (browser-only lib set in tsconfig.app.json)
// — declare just enough of the real Node `process` global, which vitest runs
// under, to read/write TZ for the timezone regression test below.
declare const process: { env: { TZ?: string } };

const row: BrandScheduleRow = {
  tab: 'Hanan',
  brand_key: 'pribet.com',
  week_start: '2026-07-27',
  platform: 'tp',
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

describe('isCurrentWeekStart', () => {
  it('returns true when the given ISO date is the Monday of the real current week', () => {
    const realMonday = toISODate(mondayOf(new Date()));
    expect(isCurrentWeekStart(realMonday)).toBe(true);
  });

  it('returns false for a week start that is not the real current week', () => {
    expect(isCurrentWeekStart('2020-01-06')).toBe(false);
  });
});

describe('scheduleFor', () => {
  it('matches regardless of brand casing or surrounding whitespace, for the given platform', () => {
    expect(scheduleFor([row], 'Hanan', '  PRIBET.COM  ', '2026-07-27', 'tp')).toBe(row);
  });

  it('returns undefined when no row matches the tab', () => {
    expect(scheduleFor([row], 'Trybet', 'Pribet.com', '2026-07-27', 'tp')).toBeUndefined();
  });

  it('returns undefined when no row matches the brand', () => {
    expect(scheduleFor([row], 'Hanan', 'WinMega.com', '2026-07-27', 'tp')).toBeUndefined();
  });

  it('returns undefined when no row matches the week', () => {
    expect(scheduleFor([row], 'Hanan', 'Pribet.com', '2026-08-03', 'tp')).toBeUndefined();
  });

  it('returns undefined when platform differs', () => {
    expect(scheduleFor([row], 'Hanan', 'Pribet.com', '2026-07-27', 'ag')).toBeUndefined();
  });

  it('defaults to matching legacy (platform-less) rows when platform is omitted', () => {
    const legacy: BrandScheduleRow = { ...row, platform: null };
    expect(scheduleFor([legacy], 'Hanan', 'Pribet.com', '2026-07-27')).toBe(legacy);
    expect(scheduleFor([row], 'Hanan', 'Pribet.com', '2026-07-27')).toBeUndefined();
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
  it('creates a new row when the brand has none yet this week for this platform', () => {
    const result = withDayStatus([], 'Hanan', 'Pribet.com', '2026-07-27', 'tp', 'monday', 'active');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      tab: 'Hanan', brand_key: 'pribet.com', week_start: '2026-07-27', platform: 'tp', monday: 'active', tuesday: null,
    });
  });

  it('updates only the given day on an existing row for that week and platform', () => {
    const result = withDayStatus([row], 'Hanan', 'Pribet.com', '2026-07-27', 'tp', 'tuesday', 'active');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ monday: 'active', tuesday: 'active', wednesday: 'paused' });
  });

  it('creates a separate row for a different platform rather than updating the existing one', () => {
    const result = withDayStatus([row], 'Hanan', 'Pribet.com', '2026-07-27', 'ag', 'monday', 'active');
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.platform === 'tp')).toEqual(row);
    expect(result.find((r) => r.platform === 'ag')).toMatchObject({ monday: 'active' });
  });

  it('matches the existing row regardless of brand casing', () => {
    const result = withDayStatus([row], 'Hanan', '  PRIBET.COM  ', '2026-07-27', 'tp', 'friday', 'paused');
    expect(result).toHaveLength(1);
    expect(result[0].friday).toBe('paused');
  });

  it('leaves other tabs/brands rows untouched', () => {
    const other: BrandScheduleRow = {
      tab: 'Trybet', brand_key: 'trybet', week_start: '2026-07-27', platform: 'tp',
      monday: null, tuesday: null, wednesday: null, thursday: null, friday: null,
    };
    const result = withDayStatus([row, other], 'Hanan', 'Pribet.com', '2026-07-27', 'tp', 'monday', 'paused');
    expect(result.find((r) => r.tab === 'Trybet')).toEqual(other);
  });

  it('creates a separate row for a different week rather than updating the existing one', () => {
    const result = withDayStatus([row], 'Hanan', 'Pribet.com', '2026-08-03', 'tp', 'monday', 'active');
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.week_start === '2026-07-27')).toEqual(row);
    expect(result.find((r) => r.week_start === '2026-08-03')).toMatchObject({ monday: 'active' });
  });
});
