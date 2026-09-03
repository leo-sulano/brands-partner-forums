import { describe, it, expect } from 'vitest';
import { generateWeekSchedule, type SchedulerInput, type ScheduledSlot } from './schedulerEngine';

function slotsFor(slots: ScheduledSlot[], brand: string, platform: string): ScheduledSlot[] {
  return slots.filter((s) => s.brand === brand && s.platform === platform);
}

const baseInput: SchedulerInput = {
  brands: ['WinMega'],
  activePlatforms: ['tp'],
  pinnedBrandPlatforms: [],
  pausedBrandPlatforms: [],
  resumingBrandPlatforms: [],
  carryover: [],
  unavailableDays: [],
  seed: 'test-seed',
};

describe('generateWeekSchedule', () => {
  it('assigns TP its 2 posts on exactly one of its configured preferred pairs', () => {
    const days = new Set(slotsFor(generateWeekSchedule(baseInput), 'WinMega', 'tp').map((s) => s.day));
    const isMonThu = days.size === 2 && days.has('monday') && days.has('thursday');
    const isTueFri = days.size === 2 && days.has('tuesday') && days.has('friday');
    expect(isMonThu || isTueFri).toBe(true);
  });

  it('assigns WO exactly 1 post, load-balanced with no fixed preferred day', () => {
    const input: SchedulerInput = { ...baseInput, activePlatforms: ['wo'] };
    expect(slotsFor(generateWeekSchedule(input), 'WinMega', 'wo')).toHaveLength(1);
  });

  it('assigns CG exactly 1 post', () => {
    const input: SchedulerInput = { ...baseInput, activePlatforms: ['cg'] };
    expect(slotsFor(generateWeekSchedule(input), 'WinMega', 'cg')).toHaveLength(1);
  });

  it('never assigns the same brand+platform to the same day twice', () => {
    const input: SchedulerInput = { ...baseInput, activePlatforms: ['ag'] };
    const days = slotsFor(generateWeekSchedule(input), 'WinMega', 'ag').map((s) => s.day);
    expect(new Set(days).size).toBe(days.length);
  });

  it('skips a paused brand+platform entirely', () => {
    const input: SchedulerInput = {
      ...baseInput,
      pausedBrandPlatforms: [{ brandKey: 'winmega', platform: 'tp' }],
    };
    expect(slotsFor(generateWeekSchedule(input), 'WinMega', 'tp')).toHaveLength(0);
  });

  it('skips a pinned brand+platform entirely (already has manually-set data this week)', () => {
    const input: SchedulerInput = {
      ...baseInput,
      pinnedBrandPlatforms: [{ brandKey: 'winmega', platform: 'tp' }],
    };
    expect(slotsFor(generateWeekSchedule(input), 'WinMega', 'tp')).toHaveLength(0);
  });

  it('gives carryover items extra slots on top of the platform normal frequency', () => {
    const input: SchedulerInput = {
      ...baseInput,
      activePlatforms: ['cg'],
      carryover: [{ brand: 'WinMega', brandKey: 'winmega', platform: 'cg', count: 2 }],
    };
    // 1 normal CG post + 2 carryover CG posts = 3 total for WinMega/CG.
    expect(slotsFor(generateWeekSchedule(input), 'WinMega', 'cg')).toHaveLength(3);
  });

  it('does not double-count carryover for a paused brand+platform', () => {
    const input: SchedulerInput = {
      ...baseInput,
      activePlatforms: ['cg'],
      pausedBrandPlatforms: [{ brandKey: 'winmega', platform: 'cg' }],
      carryover: [{ brand: 'WinMega', brandKey: 'winmega', platform: 'cg', count: 2 }],
    };
    expect(slotsFor(generateWeekSchedule(input), 'WinMega', 'cg')).toHaveLength(0);
  });

  it('balances AG (no preferred days) across the week when many brands are scheduled', () => {
    const input: SchedulerInput = {
      brands: ['A', 'B', 'C', 'D', 'E'],
      activePlatforms: ['ag'],
      pinnedBrandPlatforms: [],
      pausedBrandPlatforms: [],
      resumingBrandPlatforms: [],
      carryover: [],
      unavailableDays: [],
      seed: 'test-seed',
    };
    const slots = generateWeekSchedule(input);
    const counts: Record<string, number> = { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0 };
    for (const s of slots) counts[s.day] += 1;
    // 5 brands * 2 posts/week = 10 slots across 5 days = 2 each, perfectly balanced.
    expect(Object.values(counts)).toEqual([2, 2, 2, 2, 2]);
  });

  it('never assigns two different platforms to the same brand on the same day when avoidable', () => {
    const input: SchedulerInput = { ...baseInput, activePlatforms: ['tp', 'ag', 'cg', 'wo'] };
    const slots = generateWeekSchedule(input).filter((s) => s.brand === 'WinMega');
    const byDay = new Map<string, number>();
    for (const s of slots) byDay.set(s.day, (byDay.get(s.day) ?? 0) + 1);
    // TP(2) + AG(2) + CG(1) + WO(3) = 8 slots across 5 days for one brand —
    // some overlap is unavoidable (8 > 5), but no day should exceed 2.
    expect(Math.max(...byDay.values())).toBeLessThanOrEqual(2);
  });

  it('gives a resuming brand+platform exactly its normal postsPerWeek slots (no extras)', () => {
    const input: SchedulerInput = {
      ...baseInput,
      activePlatforms: ['ag'],
      resumingBrandPlatforms: [{ brandKey: 'winmega', platform: 'ag' }],
    };
    // AG has 2 posts/week; resuming should give exactly 2, not extra.
    expect(slotsFor(generateWeekSchedule(input), 'WinMega', 'ag')).toHaveLength(2);
  });

  it('skips a brand+platform that is both resuming AND paused (paused takes precedence)', () => {
    const input: SchedulerInput = {
      ...baseInput,
      activePlatforms: ['ag'],
      resumingBrandPlatforms: [{ brandKey: 'winmega', platform: 'ag' }],
      pausedBrandPlatforms: [{ brandKey: 'winmega', platform: 'ag' }],
    };
    // Paused should win over resuming, so 0 slots.
    expect(slotsFor(generateWeekSchedule(input), 'WinMega', 'ag')).toHaveLength(0);
  });

  it('handles carryover overflow (count: 10) by capping at 5 slots max per weekday with no duplicates', () => {
    const input: SchedulerInput = {
      ...baseInput,
      activePlatforms: ['cg'],
      carryover: [{ brand: 'WinMega', brandKey: 'winmega', platform: 'cg', count: 10 }],
    };
    // CG has 1 post/week + 10 carryover = 11 requested slots, but only 5 weekdays exist.
    // Should place at most 5 slots (one per day) with no duplicates.
    const slots = slotsFor(generateWeekSchedule(input), 'WinMega', 'cg');
    expect(slots.length).toBeLessThanOrEqual(5);
    const days = slots.map((s) => s.day);
    expect(new Set(days).size).toBe(days.length); // no duplicate days
  });

  it('never assigns a slot on an unavailable (holiday) weekday', () => {
    const input: SchedulerInput = {
      ...baseInput,
      activePlatforms: ['tp'],
      unavailableDays: ['thursday'],
    };
    const days = slotsFor(generateWeekSchedule(input), 'WinMega', 'tp').map((s) => s.day);
    expect(days).not.toContain('thursday');
  });

  it('preserves the weekly post count when a preferred day is unavailable (redistributes)', () => {
    const input: SchedulerInput = {
      ...baseInput,
      activePlatforms: ['tp'], // 2 posts/week
      unavailableDays: ['thursday'],
    };
    expect(slotsFor(generateWeekSchedule(input), 'WinMega', 'tp')).toHaveLength(2);
  });

  it('balances load across only the available days', () => {
    const input: SchedulerInput = {
      brands: ['A', 'B', 'C', 'D', 'E'],
      activePlatforms: ['ag'], // 2/week each -> 10 slots
      pinnedBrandPlatforms: [],
      pausedBrandPlatforms: [],
      resumingBrandPlatforms: [],
      carryover: [],
      unavailableDays: ['friday'],
      seed: 'test-seed',
    };
    const counts: Record<string, number> = { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0 };
    for (const s of generateWeekSchedule(input)) counts[s.day] += 1;
    expect(counts.friday).toBe(0);
    // 10 slots across 4 available days, balanced: within 1 of each other.
    const active = [counts.monday, counts.tuesday, counts.wednesday, counts.thursday];
    expect(Math.max(...active) - Math.min(...active)).toBeLessThanOrEqual(1);
  });

  it('caps posts when fewer available days remain than the platform frequency', () => {
    const input: SchedulerInput = {
      ...baseInput,
      activePlatforms: ['wo'], // 1/week — unaffected
      unavailableDays: ['monday', 'tuesday', 'wednesday', 'thursday'],
    };
    const slots = slotsFor(generateWeekSchedule(input), 'WinMega', 'wo');
    expect(slots).toHaveLength(1);
    expect(slots[0].day).toBe('friday');
  });

  it('returns no slots at all when every weekday is unavailable', () => {
    const input: SchedulerInput = {
      ...baseInput,
      activePlatforms: ['tp', 'ag', 'cg', 'wo'],
      unavailableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    };
    expect(generateWeekSchedule(input)).toHaveLength(0);
  });

  const manyBrands = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

  it('produces an identical schedule when regenerated with the same seed', () => {
    const input: SchedulerInput = {
      ...baseInput,
      brands: manyBrands,
      activePlatforms: ['tp', 'ag', 'cg'],
      seed: 'Rooster Partners::2026-09-07',
    };
    const first = generateWeekSchedule(input);
    const second = generateWeekSchedule(input);
    expect(second).toEqual(first);
  });

  it('produces a different day layout for a different seed', () => {
    const base: SchedulerInput = {
      ...baseInput,
      brands: manyBrands,
      activePlatforms: ['ag'],
    };
    const layout = (seed: string) =>
      generateWeekSchedule({ ...base, seed })
        .map((s) => `${s.brandKey}:${s.day}`)
        .sort()
        .join('|');
    expect(layout('Rooster Partners::2026-09-07')).not.toEqual(layout('Rooster Partners::2026-09-14'));
  });

  it('spreads AG evenly across the week for a large tab (no day carries more than ~1/5 + slack)', () => {
    const input: SchedulerInput = {
      ...baseInput,
      brands: manyBrands, // 10 brands * 2 AG/wk = 20 slots
      activePlatforms: ['ag'],
      seed: 'Rooster Partners::2026-09-07',
    };
    const counts: Record<string, number> = { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0 };
    for (const s of generateWeekSchedule(input)) counts[s.day] += 1;
    const values = Object.values(counts);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });

  it('splits TP across both preferred pairs when many brands are scheduled', () => {
    const input: SchedulerInput = {
      ...baseInput,
      brands: manyBrands, // 10 brands * 2 TP/wk = 20 slots
      activePlatforms: ['tp'],
      seed: 'Rooster Partners::2026-09-07',
    };
    const counts: Record<string, number> = { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0 };
    for (const s of generateWeekSchedule(input)) counts[s.day] += 1;
    // Both configured pairs carry real load — the point of the per-brand pair
    // pick is that Tue/Fri isn't starved while Mon/Thu (or Friday alone) soaks
    // up everything.
    expect(counts.monday + counts.thursday).toBeGreaterThan(3);
    expect(counts.tuesday + counts.friday).toBeGreaterThan(3);
    // Wednesday is never a preferred TP day — only reachable via DAY_SLACK
    // spillover, so it stays a small minority, never a primary bucket.
    expect(counts.wednesday).toBeLessThanOrEqual(4);
    // No single day soaks up the bulk of TP (20 slots / 4 preferred days = 5 ideal).
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(7);
  });
});
