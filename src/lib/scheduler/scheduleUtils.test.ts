import { describe, it, expect } from 'vitest';
import { leastLoadedDay, weeklyCompletion, completedBrandPlatformKey, PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms, buildDateStatusIndex, buildAgentIndex, trailingManualPauseDays, hasNoScheduleThisWeek } from './scheduleUtils';
import type { BrandScheduleRow, Weekday } from '../scheduleBrands';
import type { Entry } from '../../types/entry';

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

  it('excludes a platform with a manually-paused status for that day', () => {
    const rowsByPlatform = { tp: rowWith('tp', { monday: 'paused' }) };
    expect(unscheduledPlatforms(['tp'], 'monday', rowsByPlatform, {})).toEqual([]);
  });
});

describe('trailingManualPauseDays', () => {
  const row = (days: Partial<Record<Weekday, 'active' | 'paused'>>): BrandScheduleRow => ({
    tab: 'BITP', brand_key: 'x', week_start: '2026-08-03', platform: 'tp',
    monday: days.monday ?? null, tuesday: days.tuesday ?? null, wednesday: days.wednesday ?? null,
    thursday: days.thursday ?? null, friday: days.friday ?? null,
  });

  it('returns the full week when all 5 days are paused', () => {
    expect(trailingManualPauseDays(row({
      monday: 'paused', tuesday: 'paused', wednesday: 'paused', thursday: 'paused', friday: 'paused',
    }))).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  });

  it('returns the trailing run when Wed-Fri are paused and Mon/Tue are active', () => {
    expect(trailingManualPauseDays(row({
      monday: 'active', tuesday: 'active', wednesday: 'paused', thursday: 'paused', friday: 'paused',
    }))).toEqual(['wednesday', 'thursday', 'friday']);
  });

  it('returns the trailing run when only Thu-Fri are paused', () => {
    expect(trailingManualPauseDays(row({ thursday: 'paused', friday: 'paused' }))).toEqual(['thursday', 'friday']);
  });

  it('returns empty when only Friday is paused (run length 1)', () => {
    expect(trailingManualPauseDays(row({ friday: 'paused' }))).toEqual([]);
  });

  it('returns empty when Mon+Tue are paused but the run does not reach Friday', () => {
    expect(trailingManualPauseDays(row({ monday: 'paused', tuesday: 'paused' }))).toEqual([]);
  });

  it('returns empty for a scattered/alternating pause pattern', () => {
    expect(trailingManualPauseDays(row({ monday: 'paused', wednesday: 'paused', friday: 'active' }))).toEqual([]);
  });

  it('returns empty for an undefined row', () => {
    expect(trailingManualPauseDays(undefined)).toEqual([]);
  });
});

describe('hasNoScheduleThisWeek', () => {
  const row = (days: Partial<Record<Weekday, 'active' | 'paused'>>): BrandScheduleRow => ({
    tab: 'BITP', brand_key: 'x', week_start: '2026-08-03', platform: 'tp',
    monday: days.monday ?? null, tuesday: days.tuesday ?? null, wednesday: days.wednesday ?? null,
    thursday: days.thursday ?? null, friday: days.friday ?? null,
  });

  it('returns true when all 5 days are null', () => {
    expect(hasNoScheduleThisWeek(row({}))).toBe(true);
  });

  it('returns true for an undefined row', () => {
    expect(hasNoScheduleThisWeek(undefined)).toBe(true);
  });

  it('returns false when a single day is active', () => {
    expect(hasNoScheduleThisWeek(row({ wednesday: 'active' }))).toBe(false);
  });

  it('returns false when a single day is paused', () => {
    expect(hasNoScheduleThisWeek(row({ friday: 'paused' }))).toBe(false);
  });

  it('returns false for a fully active week', () => {
    expect(hasNoScheduleThisWeek(row({
      monday: 'active', tuesday: 'active', wednesday: 'active', thursday: 'active', friday: 'active',
    }))).toBe(false);
  });

  it('returns false for a fully paused week (this is the manual-trailing-pause case, not no-schedule)', () => {
    expect(hasNoScheduleThisWeek(row({
      monday: 'paused', tuesday: 'paused', wednesday: 'paused', thursday: 'paused', friday: 'paused',
    }))).toBe(false);
  });
});

describe('buildDateStatusIndex', () => {
  const entry = (data: Record<string, string | null>): Entry => ({
    id: 'x', tab: 'BITP', sheet_row_id: '1', data, updated_at: '', last_edited_by: 'dashboard', last_sync_tag: null,
  });

  it('indexes a brand+platform+date whose status is Removed into removed, not confirmed', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Removed', 'Trust Pilot': '2026-07-28' })];
    const { removed, confirmed } = buildDateStatusIndex(entries);
    expect(removed.has('winmega::tp::2026-07-28')).toBe(true);
    expect(confirmed.has('winmega::tp::2026-07-28')).toBe(false);
  });

  it('indexes a brand+platform+date whose status is Live into confirmed, not removed', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Live', 'Trust Pilot': '2026-07-28' })];
    const { removed, confirmed } = buildDateStatusIndex(entries);
    expect(confirmed.has('winmega::tp::2026-07-28')).toBe(true);
    expect(removed.has('winmega::tp::2026-07-28')).toBe(false);
  });

  it('indexes neither set for a status that is neither live nor removed (e.g. Pending)', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Pending', 'Trust Pilot': '2026-07-28' })];
    const { removed, confirmed } = buildDateStatusIndex(entries);
    expect(removed.size).toBe(0);
    expect(confirmed.size).toBe(0);
  });

  it('skips an entry with a Removed status but no parseable date, without throwing', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Removed', 'Trust Pilot': null })];
    expect(() => buildDateStatusIndex(entries)).not.toThrow();
    const { removed, confirmed } = buildDateStatusIndex(entries);
    expect(removed.size).toBe(0);
    expect(confirmed.size).toBe(0);
  });

  it('indexes multiple brand+platform+date combinations independently across both sets', () => {
    const entries = [
      entry({ Brands: 'WinMega', 'TP Review Status': 'Removed', 'Trust Pilot': '2026-07-28' }),
      entry({ Brands: 'WinMega', 'AG Review Status': 'Refused', 'Ask Gambler review added': '2026-07-29' }),
      entry({ Brands: 'OtherBrand', 'TP Review Status': 'Live', 'Trust Pilot': '2026-07-30' }),
    ];
    const { removed, confirmed } = buildDateStatusIndex(entries);
    expect(removed.has('winmega::tp::2026-07-28')).toBe(true);
    expect(removed.has('winmega::ag::2026-07-29')).toBe(true);
    expect(removed.size).toBe(2);
    expect(confirmed.has('otherbrand::tp::2026-07-30')).toBe(true);
    expect(confirmed.size).toBe(1);
  });
});

describe('buildAgentIndex', () => {
  const entry = (data: Record<string, string | null>, updatedAt: string): Entry => ({
    id: 'x', tab: 'BITP', sheet_row_id: '1', data, updated_at: updatedAt, last_edited_by: 'dashboard', last_sync_tag: null,
  });

  it('maps a brand to its one entry\'s Agent value', () => {
    const entries = [entry({ Brands: 'WinMega', Agent: 'Jen' }, '2026-08-01T00:00:00Z')];
    const index = buildAgentIndex(entries);
    expect(index.get('winmega')).toBe('Jen');
  });

  it('picks the most-recently-updated entry\'s Agent when a brand has multiple, disagreeing entries', () => {
    const entries = [
      entry({ Brands: 'Spinjo', Agent: 'Ann' }, '2026-07-01T00:00:00Z'),
      entry({ Brands: 'Spinjo', Agent: 'Lai' }, '2026-08-10T00:00:00Z'),
      entry({ Brands: 'Spinjo', Agent: 'Jen' }, '2026-07-15T00:00:00Z'),
    ];
    const index = buildAgentIndex(entries);
    expect(index.get('spinjo')).toBe('Lai');
  });

  it('has no key for a brand whose entries all have a blank Agent', () => {
    const entries = [entry({ Brands: 'NoAgentBrand', Agent: '' }, '2026-08-01T00:00:00Z')];
    const index = buildAgentIndex(entries);
    expect(index.has('noagentbrand')).toBe(false);
  });

  it('has no key for a brand whose Agent column is missing entirely', () => {
    const entries = [entry({ Brands: 'NoAgentColumn' }, '2026-08-01T00:00:00Z')];
    const index = buildAgentIndex(entries);
    expect(index.has('noagentcolumn')).toBe(false);
  });

  it('normalizes the brand key the same way the rest of this file does (trim + lowercase)', () => {
    const entries = [entry({ Brands: '  WinMega  ', Agent: 'Jen' }, '2026-08-01T00:00:00Z')];
    const index = buildAgentIndex(entries);
    expect(index.get('winmega')).toBe('Jen');
  });
});
