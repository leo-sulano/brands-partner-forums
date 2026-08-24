import { describe, it, expect } from 'vitest';
import { leastLoadedDay, weeklyCompletion, completedBrandPlatformKey, PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms, buildDateStatusIndex, hasDateEvidence, resolveDateEvidenceKind, resolvePmsSyncStatus, buildAgentIndex, trailingManualPauseDays, hasNoScheduleThisWeek, buildAgentAssignmentMap, resolveAgentForPlatform, resolveAgentForBrand, buildResolvedAgentIndex, weekdayColumnsInRange, columnsForWeek, currentWeekColumns, countActivePlatformSlots, type DateStatusIndex } from './scheduleUtils';
import { mondayOf } from '../scheduleBrands';
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

  it('indexes a brand+platform+date whose status is Pending into pending, not confirmed/removed/done', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Pending', 'Trust Pilot': '2026-07-28' })];
    const { removed, confirmed, pending, done } = buildDateStatusIndex(entries);
    expect(pending.has('winmega::tp::2026-07-28')).toBe(true);
    expect(removed.size).toBe(0);
    expect(confirmed.size).toBe(0);
    expect(done.size).toBe(0);
  });

  it('indexes a brand+platform+date whose status is Done into done, not confirmed/removed/pending', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Done', 'Trust Pilot': '2026-07-28' })];
    const { removed, confirmed, pending, done } = buildDateStatusIndex(entries);
    expect(done.has('winmega::tp::2026-07-28')).toBe(true);
    expect(removed.size).toBe(0);
    expect(confirmed.size).toBe(0);
    expect(pending.size).toBe(0);
  });

  it('indexes none of the four sets for a status that matches none of them (e.g. On Pause)', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'On Pause', 'Trust Pilot': '2026-07-28' })];
    const { removed, confirmed, pending, done } = buildDateStatusIndex(entries);
    expect(removed.size).toBe(0);
    expect(confirmed.size).toBe(0);
    expect(pending.size).toBe(0);
    expect(done.size).toBe(0);
  });

  it('skips an entry with a Removed status but no parseable date, without throwing', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Removed', 'Trust Pilot': null })];
    expect(() => buildDateStatusIndex(entries)).not.toThrow();
    const { removed, confirmed } = buildDateStatusIndex(entries);
    expect(removed.size).toBe(0);
    expect(confirmed.size).toBe(0);
  });

  it('skips a Pending entry with no parseable date, without throwing', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Pending', 'Trust Pilot': null })];
    expect(() => buildDateStatusIndex(entries)).not.toThrow();
    const { pending } = buildDateStatusIndex(entries);
    expect(pending.size).toBe(0);
  });

  it('indexes multiple brand+platform+date combinations independently across all four sets', () => {
    const entries = [
      entry({ Brands: 'WinMega', 'TP Review Status': 'Removed', 'Trust Pilot': '2026-07-28' }),
      entry({ Brands: 'WinMega', 'AG Review Status': 'Refused', 'Ask Gambler review added': '2026-07-29' }),
      entry({ Brands: 'OtherBrand', 'TP Review Status': 'Live', 'Trust Pilot': '2026-07-30' }),
      entry({ Brands: 'OtherBrand', 'AG Review Status': 'Pending', 'Ask Gambler review added': '2026-08-01' }),
      entry({ Brands: 'OtherBrand', 'CG Review Status': 'Done', 'Casino Guru review added': '2026-08-02' }),
    ];
    const { removed, confirmed, pending, done } = buildDateStatusIndex(entries);
    expect(removed.has('winmega::tp::2026-07-28')).toBe(true);
    expect(removed.has('winmega::ag::2026-07-29')).toBe(true);
    expect(removed.size).toBe(2);
    expect(confirmed.has('otherbrand::tp::2026-07-30')).toBe(true);
    expect(confirmed.size).toBe(1);
    expect(pending.has('otherbrand::ag::2026-08-01')).toBe(true);
    expect(pending.size).toBe(1);
    expect(done.has('otherbrand::cg::2026-08-02')).toBe(true);
    expect(done.size).toBe(1);
  });

  it('classifies a two-account collision on the same brand+platform+date into whichever bucket each entry\'s own status maps to (documented, not guarded against)', () => {
    const entries = [
      entry({ Brands: 'WinMega', 'TP Review Status': 'Removed', 'Trust Pilot': '2026-07-28' }),
      entry({ Brands: 'WinMega', 'TP Review Status': 'Pending', 'Trust Pilot': '2026-07-28' }),
    ];
    const { removed, pending } = buildDateStatusIndex(entries);
    expect(removed.has('winmega::tp::2026-07-28')).toBe(true);
    expect(pending.has('winmega::tp::2026-07-28')).toBe(true);
  });
});

describe('hasDateEvidence', () => {
  const index: DateStatusIndex = {
    removed: new Set(['winmega::tp::2026-08-20']),
    confirmed: new Set(['winmega::ag::2026-08-20']),
    pending: new Set(['winmega::cg::2026-08-20']),
    done: new Set(['winmega::wo::2026-08-20']),
  };

  it('returns true when the key is in removed', () => {
    expect(hasDateEvidence(index, 'winmega', 'tp', '2026-08-20')).toBe(true);
  });

  it('returns true when the key is in confirmed', () => {
    expect(hasDateEvidence(index, 'winmega', 'ag', '2026-08-20')).toBe(true);
  });

  it('returns true when the key is in pending', () => {
    expect(hasDateEvidence(index, 'winmega', 'cg', '2026-08-20')).toBe(true);
  });

  it('returns true when the key is in done', () => {
    expect(hasDateEvidence(index, 'winmega', 'wo', '2026-08-20')).toBe(true);
  });

  it('returns false when the key is in none of the four sets', () => {
    expect(hasDateEvidence(index, 'winmega', 'tp', '2026-08-21')).toBe(false);
  });

  it('returns false for a different brand on the same platform+date', () => {
    expect(hasDateEvidence(index, 'otherbrand', 'tp', '2026-08-20')).toBe(false);
  });

  it('returns false against a completely empty index', () => {
    const empty: DateStatusIndex = { removed: new Set(), confirmed: new Set(), pending: new Set(), done: new Set() };
    expect(hasDateEvidence(empty, 'winmega', 'tp', '2026-08-20')).toBe(false);
  });
});

describe('resolveDateEvidenceKind', () => {
  const index: DateStatusIndex = {
    removed: new Set(['winmega::tp::2026-08-20']),
    confirmed: new Set(['winmega::ag::2026-08-20']),
    pending: new Set(['winmega::cg::2026-08-20']),
    done: new Set(['winmega::wo::2026-08-20']),
  };

  it('returns "removed" when the key is in the removed set', () => {
    expect(resolveDateEvidenceKind(index, 'winmega', 'tp', '2026-08-20')).toBe('removed');
  });

  it('returns "confirmed" when the key is in the confirmed set', () => {
    expect(resolveDateEvidenceKind(index, 'winmega', 'ag', '2026-08-20')).toBe('confirmed');
  });

  it('returns "pending" when the key is in the pending set', () => {
    expect(resolveDateEvidenceKind(index, 'winmega', 'cg', '2026-08-20')).toBe('pending');
  });

  it('returns "done" when the key is in the done set', () => {
    expect(resolveDateEvidenceKind(index, 'winmega', 'wo', '2026-08-20')).toBe('done');
  });

  it('returns null when the key is in none of the four sets', () => {
    expect(resolveDateEvidenceKind(index, 'winmega', 'tp', '2026-08-21')).toBeNull();
  });

  it('follows removed > confirmed > pending > done precedence when a key somehow lands in more than one set', () => {
    const collision: DateStatusIndex = {
      removed: new Set(['winmega::tp::2026-08-20']),
      confirmed: new Set(['winmega::tp::2026-08-20']),
      pending: new Set(['winmega::tp::2026-08-20']),
      done: new Set(['winmega::tp::2026-08-20']),
    };
    expect(resolveDateEvidenceKind(collision, 'winmega', 'tp', '2026-08-20')).toBe('removed');
  });
});

describe('resolvePmsSyncStatus', () => {
  const emptyIndex = { removed: new Set<string>(), confirmed: new Set<string>(), pending: new Set<string>(), done: new Set<string>() };

  it('returns "removed" when the key is in the removed set', () => {
    const index = { ...emptyIndex, removed: new Set(['winmega::tp::2026-08-20']) };
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', index, false)).toBe('removed');
  });

  it('returns "published" when the key is in the confirmed set', () => {
    const index = { ...emptyIndex, confirmed: new Set(['winmega::tp::2026-08-20']) };
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', index, false)).toBe('published');
  });

  it('returns "pending" when the key is in the pending set', () => {
    const index = { ...emptyIndex, pending: new Set(['winmega::tp::2026-08-20']) };
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', index, false)).toBe('pending');
  });

  it('returns "done" when the key is in the done set', () => {
    const index = { ...emptyIndex, done: new Set(['winmega::tp::2026-08-20']) };
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', index, false)).toBe('done');
  });

  it('returns null when paused and no evidence matches', () => {
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', emptyIndex, true)).toBeNull();
  });

  it('returns "active" when not paused and no evidence matches', () => {
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', emptyIndex, false)).toBe('active');
  });

  it('evidence wins over isPaused -- a removed key still resolves to "removed" even when isPaused is true', () => {
    const index = { ...emptyIndex, removed: new Set(['winmega::tp::2026-08-20']) };
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', index, true)).toBe('removed');
  });

  it('follows removed > confirmed > pending > done precedence when a key somehow lands in more than one set', () => {
    const index = {
      removed: new Set(['winmega::tp::2026-08-20']),
      confirmed: new Set(['winmega::tp::2026-08-20']),
      pending: new Set<string>(),
      done: new Set<string>(),
    };
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', index, false)).toBe('removed');
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

describe('weekdayColumnsInRange', () => {
  it('returns every weekday between the two dates inclusive, skipping weekends', () => {
    // Mon 2026-08-17 .. Fri 2026-08-21, spilling one day into the next Mon
    const cols = weekdayColumnsInRange('2026-08-20', '2026-08-24');
    expect(cols.map((c) => c.iso)).toEqual(['2026-08-20', '2026-08-21', '2026-08-24']);
    expect(cols.map((c) => c.weekday)).toEqual(['thursday', 'friday', 'monday']);
  });

  it('tags each column with the week_start of the week it belongs to', () => {
    const cols = weekdayColumnsInRange('2026-08-20', '2026-08-24');
    expect(cols.map((c) => c.weekStartISO)).toEqual(['2026-08-17', '2026-08-17', '2026-08-24']);
  });

  it('returns a single column for a single-day range', () => {
    const cols = weekdayColumnsInRange('2026-08-19', '2026-08-19');
    expect(cols).toEqual([{ iso: '2026-08-19', weekday: 'wednesday', weekStartISO: '2026-08-17' }]);
  });

  it('returns no columns for a range that only covers a weekend', () => {
    expect(weekdayColumnsInRange('2026-08-22', '2026-08-23')).toEqual([]);
  });
});

describe('columnsForWeek / currentWeekColumns', () => {
  it('returns the 5 weekday columns of the given week, all sharing that week_start', () => {
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    expect(cols.map((c) => c.weekday)).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
    expect(cols.every((c) => c.weekStartISO === '2026-08-17')).toBe(true);
  });

  it('currentWeekColumns matches columnsForWeek(mondayOf(today))', () => {
    expect(currentWeekColumns()).toEqual(columnsForWeek(mondayOf(new Date())));
  });
});

describe('countActivePlatformSlots', () => {
  const row = (brand: string, platform: 'tp' | 'ag', weekStart: string, days: Partial<Record<Weekday, 'active' | 'paused'>>): BrandScheduleRow => ({
    tab: 'BITP', brand_key: brand, week_start: weekStart, platform,
    monday: days.monday ?? null, tuesday: days.tuesday ?? null, wednesday: days.wednesday ?? null,
    thursday: days.thursday ?? null, friday: days.friday ?? null,
  });
  const allPlatforms = () => ['tp', 'ag'] as const;
  const emptyIndex: DateStatusIndex = { removed: new Set(), confirmed: new Set(), pending: new Set(), done: new Set() };
  // Before every date used in the plan-only tests below, so those columns
  // are always "today or future" and behave exactly as they did before the
  // evidence-gating change.
  const FUTURE_TODAY = '2026-01-01';

  it('counts one per active (brand, day) cell, per platform', () => {
    const rows = [
      row('a', 'tp', '2026-08-17', { monday: 'active', thursday: 'active' }),
      row('b', 'ag', '2026-08-17', { tuesday: 'active' }),
    ];
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const counts = countActivePlatformSlots(rows, 'BITP', ['a', 'b'], () => [...allPlatforms()], cols, emptyIndex, FUTURE_TODAY);
    expect(counts).toEqual({ tp: 2, ag: 1 });
  });

  it('does not count paused or null days', () => {
    const rows = [row('a', 'tp', '2026-08-17', { monday: 'paused' })];
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const counts = countActivePlatformSlots(rows, 'BITP', ['a'], () => ['tp'], cols, emptyIndex, FUTURE_TODAY);
    expect(counts).toEqual({ tp: 0 });
  });

  it('reports 0 (not omitted) for a platform with no active cells, as long as brandPlatformsFn returns it', () => {
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const counts = countActivePlatformSlots([], 'BITP', ['a'], () => ['tp', 'ag'], cols, emptyIndex, FUTURE_TODAY);
    expect(counts).toEqual({ tp: 0, ag: 0 });
  });

  it('only counts platforms brandPlatformsFn actually returns for that brand (respects exclusion)', () => {
    const rows = [row('a', 'tp', '2026-08-17', { monday: 'active' })];
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const counts = countActivePlatformSlots(rows, 'BITP', ['a'], () => ['ag'], cols, emptyIndex, FUTURE_TODAY);
    expect(counts).toEqual({ ag: 0 });
  });

  it('sums across multiple weeks when columns span more than one week_start', () => {
    const rows = [
      row('a', 'tp', '2026-08-17', { friday: 'active' }),
      row('a', 'tp', '2026-08-24', { monday: 'active' }),
    ];
    const cols = weekdayColumnsInRange('2026-08-21', '2026-08-24');
    const counts = countActivePlatformSlots(rows, 'BITP', ['a'], () => ['tp'], cols, emptyIndex, FUTURE_TODAY);
    expect(counts).toEqual({ tp: 2 });
  });

  it('for a past day, counts only when real evidence exists, ignoring the plan entirely', () => {
    const rows = [row('a', 'tp', '2026-08-17', { monday: 'active' })]; // planned, but no evidence
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00')); // Mon 2026-08-17 .. Fri 2026-08-21
    const todayISO = '2026-08-24'; // the whole displayed week is now in the past
    const counts = countActivePlatformSlots(rows, 'BITP', ['a'], () => ['tp'], cols, emptyIndex, todayISO);
    expect(counts).toEqual({ tp: 0 });
  });

  it('for a past day, counts a brand+platform+day with evidence even when the plan has no row for it at all', () => {
    const index: DateStatusIndex = { removed: new Set(), confirmed: new Set(['a::tp::2026-08-17']), pending: new Set(), done: new Set() };
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const todayISO = '2026-08-24';
    const counts = countActivePlatformSlots([], 'BITP', ['a'], () => ['tp'], cols, index, todayISO);
    expect(counts).toEqual({ tp: 1 });
  });

  it('for a past day, counts each of the four evidence types (removed/confirmed/pending/done) equally', () => {
    const index: DateStatusIndex = {
      removed: new Set(['a::tp::2026-08-17']),
      confirmed: new Set(['a::tp::2026-08-18']),
      pending: new Set(['a::tp::2026-08-19']),
      done: new Set(['a::tp::2026-08-20']),
    };
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const todayISO = '2026-08-24';
    const counts = countActivePlatformSlots([], 'BITP', ['a'], () => ['tp'], cols, index, todayISO);
    expect(counts).toEqual({ tp: 4 });
  });

  it('treats today/future days as plan-only even when unrelated evidence exists for them', () => {
    const rows = [row('a', 'tp', '2026-08-17', {})]; // no plan for Monday
    const index: DateStatusIndex = { removed: new Set(), confirmed: new Set(['a::tp::2026-08-17']), pending: new Set(), done: new Set() };
    const cols = columnsForWeek(new Date('2026-08-17T00:00:00'));
    const todayISO = '2026-08-17'; // Monday itself is "today"
    const counts = countActivePlatformSlots(rows, 'BITP', ['a'], () => ['tp'], cols, index, todayISO);
    expect(counts).toEqual({ tp: 0 }); // evidence present but ignored -- no plan, and not past yet
  });
});
