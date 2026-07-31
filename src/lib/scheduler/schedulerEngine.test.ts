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
};

describe('generateWeekSchedule', () => {
  it('assigns TP its 2 posts on the first preferred pair (Monday+Thursday) when the week is empty', () => {
    const slots = generateWeekSchedule(baseInput);
    const days = slotsFor(slots, 'WinMega', 'tp').map((s) => s.day).sort();
    expect(days).toEqual(['monday', 'thursday']);
  });

  it('assigns WO its 3 posts on Monday/Wednesday/Friday when the week is empty', () => {
    const input: SchedulerInput = { ...baseInput, activePlatforms: ['wo'] };
    const days = slotsFor(generateWeekSchedule(input), 'WinMega', 'wo').map((s) => s.day).sort();
    expect(days).toEqual(['friday', 'monday', 'wednesday']);
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
});
