import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApproveWeek, mockPush, mockSyncStatus } = vi.hoisted(() => ({
  mockApproveWeek: vi.fn(),
  mockPush: vi.fn(),
  mockSyncStatus: vi.fn(),
}));

vi.mock('./queries.ts', () => ({ approveWeek: mockApproveWeek }));
vi.mock('./schedulePmsSync.ts', () => ({
  pushScheduleActivations: mockPush,
  syncTabStatusToPms: mockSyncStatus,
}));

import { buildActiveSlotItems, approveWeekAndFlush, PmsFlushError } from './scheduleApproval.ts';
import type { BrandScheduleRow } from './scheduleBrands.ts';

const WEEK = '2026-09-07'; // a Monday

function row(overrides: Partial<BrandScheduleRow>): BrandScheduleRow {
  return {
    tab: 'Rooster Partners',
    brand_key: 'spinjo',
    week_start: WEEK,
    platform: 'tp',
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    ...overrides,
  };
}

describe('buildActiveSlotItems', () => {
  const brandByKey = new Map([['spinjo', 'Spinjo'], ['rollero', 'Rollero']]);
  const agentAssignments = new Map<string, string | null>([['spinjo::tp', 'Ann']]);
  const rawAgentFallback = new Map<string, string>([['rollero', 'Jen']]);

  it('emits one item per active weekday, resolving brand name and per-platform agent', () => {
    const items = buildActiveSlotItems({
      tab: 'Rooster Partners',
      tabLabel: 'Rooster Partners',
      weekStartISO: WEEK,
      scheduleRows: [
        row({ brand_key: 'spinjo', platform: 'tp', monday: 'active', thursday: 'active' }),
        row({ brand_key: 'rollero', platform: 'ag', tuesday: 'active' }),
      ],
      brandByKey,
      agentAssignments,
      rawAgentFallback,
    });
    expect(items).toEqual([
      { tab: 'Rooster Partners', tabLabel: 'Rooster Partners', brand: 'Spinjo', platform: 'tp', date: '2026-09-07', agent: 'Ann' },
      { tab: 'Rooster Partners', tabLabel: 'Rooster Partners', brand: 'Spinjo', platform: 'tp', date: '2026-09-10', agent: 'Ann' },
      { tab: 'Rooster Partners', tabLabel: 'Rooster Partners', brand: 'Rollero', platform: 'ag', date: '2026-09-08', agent: 'Jen' },
    ]);
  });

  it('ignores paused/blank days, other weeks, and legacy platform-null rows', () => {
    const items = buildActiveSlotItems({
      tab: 'Rooster Partners',
      tabLabel: 'Rooster Partners',
      weekStartISO: WEEK,
      scheduleRows: [
        row({ monday: 'paused', tuesday: null }),
        row({ week_start: '2026-09-14', monday: 'active' }),
        row({ platform: null, monday: 'active' }),
      ],
      brandByKey,
      agentAssignments,
      rawAgentFallback,
    });
    expect(items).toEqual([]);
  });

  it('falls back to the raw brand_key and a null agent when nothing resolves', () => {
    const items = buildActiveSlotItems({
      tab: 'Rooster Partners',
      tabLabel: 'Rooster Partners',
      weekStartISO: WEEK,
      scheduleRows: [row({ brand_key: 'unknownbrand', platform: 'cg', friday: 'active' })],
      brandByKey,
      agentAssignments,
      rawAgentFallback,
    });
    expect(items).toEqual([
      { tab: 'Rooster Partners', tabLabel: 'Rooster Partners', brand: 'unknownbrand', platform: 'cg', date: '2026-09-11', agent: null },
    ]);
  });
});

describe('approveWeekAndFlush', () => {
  beforeEach(() => {
    mockApproveWeek.mockReset().mockResolvedValue(undefined);
    mockPush.mockReset().mockResolvedValue(undefined);
    mockSyncStatus.mockReset().mockResolvedValue(undefined);
  });

  const ITEM = { tab: 'Rooster Partners', tabLabel: 'Rooster Partners', brand: 'Spinjo', platform: 'tp' as const, date: WEEK, agent: 'Ann' };

  it('approves then pushes activations and reconciles status', async () => {
    await approveWeekAndFlush({ tab: 'Rooster Partners', weekStartISO: WEEK, actorEmail: 'a@b.com', items: [ITEM] });
    expect(mockApproveWeek).toHaveBeenCalledWith('Rooster Partners', WEEK, 'a@b.com');
    expect(mockPush).toHaveBeenCalledWith([ITEM]);
    expect(mockSyncStatus).toHaveBeenCalledWith('Rooster Partners');
  });

  it('skips the PMS flush entirely when there are no active slots', async () => {
    await approveWeekAndFlush({ tab: 'Rooster Partners', weekStartISO: WEEK, actorEmail: 'a@b.com', items: [] });
    expect(mockApproveWeek).toHaveBeenCalledOnce();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockSyncStatus).not.toHaveBeenCalled();
  });

  it('propagates an approval failure unchanged (not as PmsFlushError)', async () => {
    mockApproveWeek.mockRejectedValue(new Error('42501'));
    await expect(
      approveWeekAndFlush({ tab: 'Rooster Partners', weekStartISO: WEEK, actorEmail: 'a@b.com', items: [ITEM] }),
    ).rejects.toThrow('42501');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('wraps a flush failure as PmsFlushError after the approval has been written', async () => {
    mockPush.mockRejectedValue(new Error('Failed to sync schedule to PMS.'));
    await expect(
      approveWeekAndFlush({ tab: 'Rooster Partners', weekStartISO: WEEK, actorEmail: 'a@b.com', items: [ITEM] }),
    ).rejects.toBeInstanceOf(PmsFlushError);
    expect(mockApproveWeek).toHaveBeenCalledOnce();
  });
});
