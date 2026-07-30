import { describe, it, expect } from 'vitest';
import { scheduleFor, nextStatus, withDayStatus, type BrandScheduleRow } from './scheduleBrands';

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
