import { describe, it, expect } from 'vitest';
import { leastLoadedDay, weeklyCompletion, completedBrandPlatformKey, PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms, buildDateStatusIndex, buildCurrentStatusIndex, buildAgentIndex, trailingManualPauseDays, hasNoScheduleThisWeek, buildAgentAssignmentMap, resolveAgentForPlatform, resolveAgentForBrand, buildResolvedAgentIndex } from './scheduleUtils';
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

describe('buildCurrentStatusIndex', () => {
  const entry = (data: Record<string, string | null>, updatedAt: string): Entry => ({
    id: 'x', tab: 'BITP', sheet_row_id: '1', data, updated_at: updatedAt, last_edited_by: 'dashboard', last_sync_tag: null,
  });

  it('indexes a brand+platform whose latest status is Pending into pending, not done', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Pending' }, '2026-08-01T00:00:00Z')];
    const { pending, done } = buildCurrentStatusIndex(entries);
    expect(pending.has('winmega::tp')).toBe(true);
    expect(done.has('winmega::tp')).toBe(false);
  });

  it('indexes a brand+platform whose latest status is Done into done, not pending', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Done' }, '2026-08-01T00:00:00Z')];
    const { pending, done } = buildCurrentStatusIndex(entries);
    expect(done.has('winmega::tp')).toBe(true);
    expect(pending.has('winmega::tp')).toBe(false);
  });

  it('indexes neither set for a status that is neither pending nor done (e.g. Published)', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Published' }, '2026-08-01T00:00:00Z')];
    const { pending, done } = buildCurrentStatusIndex(entries);
    expect(pending.size).toBe(0);
    expect(done.size).toBe(0);
  });

  it('picks the most-recently-updated entry\'s status per brand+platform when multiple entries disagree', () => {
    const entries = [
      entry({ Brands: 'WinMega', 'TP Review Status': 'Pending' }, '2026-07-01T00:00:00Z'),
      entry({ Brands: 'WinMega', 'TP Review Status': 'Done' }, '2026-08-10T00:00:00Z'),
      entry({ Brands: 'WinMega', 'TP Review Status': 'Pending' }, '2026-07-15T00:00:00Z'),
    ];
    const { pending, done } = buildCurrentStatusIndex(entries);
    expect(done.has('winmega::tp')).toBe(true);
    expect(pending.has('winmega::tp')).toBe(false);
  });

  it('resolves each platform on the same entry independently', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Pending', 'AG Review Status': 'Done' }, '2026-08-01T00:00:00Z')];
    const { pending, done } = buildCurrentStatusIndex(entries);
    expect(pending.has('winmega::tp')).toBe(true);
    expect(done.has('winmega::ag')).toBe(true);
  });

  it('skips a blank status in favor of an older non-blank one for the same brand+platform', () => {
    const entries = [
      entry({ Brands: 'WinMega', 'TP Review Status': 'Pending' }, '2026-07-01T00:00:00Z'),
      entry({ Brands: 'WinMega', 'TP Review Status': '' }, '2026-08-10T00:00:00Z'),
    ];
    const { pending, done } = buildCurrentStatusIndex(entries);
    expect(pending.has('winmega::tp')).toBe(true);
  });

  it('returns empty sets for no entries', () => {
    const { pending, done } = buildCurrentStatusIndex([]);
    expect(pending.size).toBe(0);
    expect(done.size).toBe(0);
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

describe('buildAgentAssignmentMap', () => {
  it('keys by brandKey::platform', () => {
    const map = buildAgentAssignmentMap([
      { tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp', agent: 'ANN' },
    ]);
    expect(map.get('zodiacbet.com::tp')).toBe('ANN');
  });

  it('preserves an explicit null agent as a present key, not a missing one', () => {
    const map = buildAgentAssignmentMap([
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'tp', agent: null },
    ]);
    expect(map.has('silver play::tp')).toBe(true);
    expect(map.get('silver play::tp')).toBeNull();
  });

  it('normalizes the brand key the same way the rest of this file does (trim + lowercase)', () => {
    const map = buildAgentAssignmentMap([
      { tab: 'Hanan', brand: '  ZodiacBet.com  ', platform: 'tp', agent: 'ANN' },
    ]);
    expect(map.get('zodiacbet.com::tp')).toBe('ANN');
  });
});

describe('resolveAgentForPlatform', () => {
  it('returns the assignment table value when a row exists', () => {
    const assignments = buildAgentAssignmentMap([
      { tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp', agent: 'ANN' },
    ]);
    const agentIndex = new Map([['zodiacbet.com', 'SomeoneElse']]);
    expect(resolveAgentForPlatform('zodiacbet.com', 'tp', assignments, agentIndex)).toBe('ANN');
  });

  it('returns null (not the fallback) when the assignment row is an explicit N/A', () => {
    const assignments = buildAgentAssignmentMap([
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'tp', agent: null },
    ]);
    const agentIndex = new Map([['silver play', 'SomeoneElse']]);
    expect(resolveAgentForPlatform('silver play', 'tp', assignments, agentIndex)).toBeNull();
  });

  it('falls back to agentIndex when no assignment row exists for this brand+platform', () => {
    const assignments = buildAgentAssignmentMap([]);
    const agentIndex = new Map([['midasluck', 'Fallback']]);
    expect(resolveAgentForPlatform('midasluck', 'tp', assignments, agentIndex)).toBe('Fallback');
  });

  it('is scoped per platform — a row for tp does not affect ag resolution for the same brand', () => {
    const assignments = buildAgentAssignmentMap([
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'tp', agent: null },
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'ag', agent: 'JEN' },
    ]);
    const agentIndex = new Map<string, string>();
    expect(resolveAgentForPlatform('silver play', 'tp', assignments, agentIndex)).toBeNull();
    expect(resolveAgentForPlatform('silver play', 'ag', assignments, agentIndex)).toBe('JEN');
  });
});

describe('resolveAgentForBrand', () => {
  it('returns the first non-null platform-specific agent in platform order', () => {
    const assignments = buildAgentAssignmentMap([
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'tp', agent: null },
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'ag', agent: 'JEN' },
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'cg', agent: 'JEN' },
    ]);
    const agentIndex = new Map<string, string>();
    expect(resolveAgentForBrand('silver play', ['tp', 'ag', 'cg'], assignments, agentIndex)).toBe('JEN');
  });

  it('returns null when every platform resolves to null', () => {
    const assignments = buildAgentAssignmentMap([
      { tab: 'Rooster Partners', brand: 'Novadreams2', platform: 'tp', agent: null },
      { tab: 'Rooster Partners', brand: 'Novadreams2', platform: 'ag', agent: null },
      { tab: 'Rooster Partners', brand: 'Novadreams2', platform: 'cg', agent: null },
    ]);
    const agentIndex = new Map<string, string>();
    expect(resolveAgentForBrand('novadreams2', ['tp', 'ag', 'cg'], assignments, agentIndex)).toBeNull();
  });
});

describe('buildResolvedAgentIndex', () => {
  const entry = (data: Record<string, string | null>, updatedAt: string): Entry => ({
    id: 'x', tab: 'BITP', sheet_row_id: '1', data, updated_at: updatedAt, last_edited_by: 'dashboard', last_sync_tag: null,
  });

  it('prefers the assignment table over the per-entry heuristic', () => {
    const entries = [entry({ Brands: 'ZodiacBet.com', Agent: 'WrongAgent' }, '2026-08-01T00:00:00Z')];
    const assignmentRows = [{ tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp' as const, agent: 'ANN' }];
    const index = buildResolvedAgentIndex(entries, assignmentRows, ['tp', 'ag', 'cg']);
    expect(index.get('zodiacbet.com')).toBe('ANN');
  });

  it('falls back to the per-entry heuristic for a brand with no assignment row', () => {
    const entries = [entry({ Brands: 'Midasluck', Agent: 'Fallback' }, '2026-08-01T00:00:00Z')];
    const index = buildResolvedAgentIndex(entries, [], ['tp', 'ag', 'cg']);
    expect(index.get('midasluck')).toBe('Fallback');
  });

  it('resolves a brand that has an assignment row but no entries at all (no Agent column on this tab)', () => {
    const assignmentRows = [{ tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp' as const, agent: 'ANN' }];
    const index = buildResolvedAgentIndex([], assignmentRows, ['tp', 'ag', 'cg']);
    expect(index.get('zodiacbet.com')).toBe('ANN');
  });

  it('has no key for a brand whose every platform resolves to null', () => {
    const assignmentRows = [
      { tab: 'Rooster Partners', brand: 'Novadreams2', platform: 'tp' as const, agent: null },
      { tab: 'Rooster Partners', brand: 'Novadreams2', platform: 'ag' as const, agent: null },
      { tab: 'Rooster Partners', brand: 'Novadreams2', platform: 'cg' as const, agent: null },
    ];
    const index = buildResolvedAgentIndex([], assignmentRows, ['tp', 'ag', 'cg']);
    expect(index.has('novadreams2')).toBe(false);
  });
});
