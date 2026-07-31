import { describe, it, expect } from 'vitest';
import { leastLoadedDay, weeklyCompletion, completedBrandPlatformKey, PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms } from './scheduleUtils';
import type { BrandScheduleRow } from '../scheduleBrands';

describe('leastLoadedDay', () => {
  it('picks the candidate with the fewest assignments', () => {
    const counts = { monday: 3, tuesday: 1, wednesday: 5, thursday: 0, friday: 2 };
    expect(leastLoadedDay(counts, ['monday', 'wednesday', 'friday'])).toBe('friday');
  });

  it('breaks ties by candidate order', () => {
    const counts = { monday: 1, tuesday: 1, wednesday: 0, thursday: 0, friday: 0 };
    expect(leastLoadedDay(counts, ['thursday', 'wednesday', 'friday'])).toBe('thursday');
  });
});

describe('completedBrandPlatformKey', () => {
  it('joins brandKey and platform deterministically', () => {
    expect(completedBrandPlatformKey('winmega.com', 'tp')).toBe('winmega.com::tp');
  });
});

describe('weeklyCompletion', () => {
  const row = (brandKey: string, platform: 'tp' | 'ag', days: Partial<Record<'monday'|'tuesday'|'wednesday'|'thursday'|'friday', 'active'>>): BrandScheduleRow => ({
    tab: 'BITP', brand_key: brandKey, week_start: '2026-07-27', platform,
    monday: days.monday ?? null, tuesday: days.tuesday ?? null, wednesday: days.wednesday ?? null,
    thursday: days.thursday ?? null, friday: days.friday ?? null,
  });

  it('returns null ratio when there are no platform-tagged rows', () => {
    const legacy: BrandScheduleRow = { tab: 'BITP', brand_key: 'x', week_start: '2026-07-27', platform: null, monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null };
    expect(weeklyCompletion([legacy], new Set())).toEqual({ scheduled: 0, completed: 0, ratio: null });
  });

  it('counts scheduled slots as non-null days across all platform rows', () => {
    const rows = [row('a', 'tp', { monday: 'active', thursday: 'active' }), row('b', 'ag', { tuesday: 'active' })];
    const result = weeklyCompletion(rows, new Set());
    expect(result).toEqual({ scheduled: 3, completed: 0, ratio: 0 });
  });

  it('counts a row fully completed when its brand+platform key is in the completed set', () => {
    const rows = [row('a', 'tp', { monday: 'active', thursday: 'active' }), row('b', 'ag', { tuesday: 'active' })];
    const completed = new Set([completedBrandPlatformKey('a', 'tp')]);
    const result = weeklyCompletion(rows, completed);
    expect(result).toEqual({ scheduled: 3, completed: 2, ratio: 2 / 3 });
  });
});

describe('PLATFORM_BADGE', () => {
  it('has an entry for all four platforms', () => {
    expect(Object.keys(PLATFORM_BADGE).sort()).toEqual(['ag', 'cg', 'tp', 'wo']);
  });
});

describe('PLATFORM_FULL_LABEL', () => {
  it('has a full display name for all four platforms', () => {
    expect(PLATFORM_FULL_LABEL).toEqual({
      tp: 'Trustpilot',
      ag: 'AskGamblers',
      cg: 'CasinoGuru',
      wo: 'Wizard of Odds',
    });
  });
});

describe('unscheduledPlatforms', () => {
  const rowWith = (platform: 'tp' | 'ag', days: Partial<Record<'monday' | 'tuesday', 'active' | 'paused'>>): BrandScheduleRow => ({
    tab: 'BITP', brand_key: 'x', week_start: '2026-07-27', platform,
    monday: days.monday ?? null, tuesday: days.tuesday ?? null, wednesday: null, thursday: null, friday: null,
  });

  it('excludes a platform with a non-null status for that day', () => {
    const rowsByPlatform = { tp: rowWith('tp', { monday: 'active' }) };
    expect(unscheduledPlatforms(['tp', 'ag'], 'monday', rowsByPlatform, {})).toEqual(['ag']);
  });

  it('includes a platform whose row exists but that day is null', () => {
    const rowsByPlatform = { tp: rowWith('tp', { monday: 'active' }) };
    expect(unscheduledPlatforms(['tp'], 'tuesday', rowsByPlatform, {})).toEqual(['tp']);
  });

  it('includes a platform with no row at all for that brand/week', () => {
    expect(unscheduledPlatforms(['tp', 'ag'], 'monday', {}, {})).toEqual(['tp', 'ag']);
  });

  it('excludes a platform that is scheduler-paused for the week regardless of day status', () => {
    expect(unscheduledPlatforms(['tp'], 'monday', {}, { tp: { reason: 'x' } })).toEqual([]);
  });
});
