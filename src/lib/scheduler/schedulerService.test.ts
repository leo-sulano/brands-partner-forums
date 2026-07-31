import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recalculatePauses, ensureWeekGenerated, type TabContext } from './schedulerService';
import type { Entry } from '../../types/entry';

const queries = vi.hoisted(() => ({
  fetchBrandSchedule: vi.fn(),
  bulkUpsertBrandSchedule: vi.fn(),
  fetchActiveBrandPlatformPauses: vi.fn(),
  upsertBrandPlatformPause: vi.fn(),
  deleteBrandPlatformPause: vi.fn(),
}));
vi.mock('../queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../queries')>();
  return { ...actual, ...queries };
});

function entry(data: Record<string, string | null>): Entry {
  return { id: 'x', tab: 'BITP', sheet_row_id: '1', data, updated_at: '', last_edited_by: 'dashboard', last_sync_tag: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  queries.fetchActiveBrandPlatformPauses.mockResolvedValue([]);
  queries.fetchBrandSchedule.mockResolvedValue([]);
});

describe('recalculatePauses', () => {
  it('pauses a brand+platform after two consecutive Removed/Refused posts', async () => {
    const ctx: TabContext = {
      brands: ['WinMega'],
      activePlatforms: ['tp'],
      entries: [
        entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
        entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
        entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-07-01' }),
      ],
    };
    await recalculatePauses('BITP', '2026-08-03', ctx);
    expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith('BITP', 'WinMega', 'tp', '2026-08-03', expect.any(String));
  });

  it('does not pause when only the most recent post is Removed', async () => {
    const ctx: TabContext = {
      brands: ['WinMega'],
      activePlatforms: ['tp'],
      entries: [
        entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
        entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-07-24' }),
      ],
    };
    await recalculatePauses('BITP', '2026-08-03', ctx);
    expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
  });

  it('deletes and reports a resumed pause once its week has passed', async () => {
    queries.fetchActiveBrandPlatformPauses.mockResolvedValue([
      { tab: 'BITP', brand_key: 'winmega', platform: 'tp', paused_week_start: '2026-07-27', reason: 'x' },
    ]);
    const ctx: TabContext = { brands: ['WinMega'], activePlatforms: ['tp'], entries: [] };
    const resumed = await recalculatePauses('BITP', '2026-08-03', ctx);
    expect(queries.deleteBrandPlatformPause).toHaveBeenCalledWith('BITP', 'winmega', 'tp');
    expect(resumed).toEqual([{ brandKey: 'winmega', platform: 'tp' }]);
  });

  it('leaves a pause in place while still within its paused week', async () => {
    queries.fetchActiveBrandPlatformPauses.mockResolvedValue([
      { tab: 'BITP', brand_key: 'winmega', platform: 'tp', paused_week_start: '2026-08-03', reason: 'x' },
    ]);
    const ctx: TabContext = { brands: ['WinMega'], activePlatforms: ['tp'], entries: [] };
    const resumed = await recalculatePauses('BITP', '2026-08-03', ctx);
    expect(queries.deleteBrandPlatformPause).not.toHaveBeenCalled();
    expect(resumed).toEqual([]);
  });
});

describe('ensureWeekGenerated', () => {
  it('is a no-op when the week already has platform-tagged rows', async () => {
    queries.fetchBrandSchedule.mockResolvedValue([
      { tab: 'BITP', brand_key: 'winmega', week_start: '2026-08-03', platform: 'tp', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ]);
    const ctx: TabContext = { brands: ['WinMega'], activePlatforms: ['tp'], entries: [] };
    await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
    expect(queries.bulkUpsertBrandSchedule).not.toHaveBeenCalled();
  });

  it('generates and writes rows when the week has no platform-tagged rows yet', async () => {
    queries.fetchBrandSchedule.mockImplementation((_tab: string, weekStart: string) =>
      Promise.resolve(weekStart === '2026-08-03' ? [] : []), // this week and last week both empty
    );
    const ctx: TabContext = { brands: ['WinMega'], activePlatforms: ['cg'], entries: [] };
    await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
    expect(queries.bulkUpsertBrandSchedule).toHaveBeenCalledTimes(1);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tab: 'BITP', brand: 'WinMega', week_start: '2026-08-03', platform: 'cg' });
  });

  it('carries over unfinished slots when last week\'s tab completion was below 40%', async () => {
    queries.fetchBrandSchedule.mockImplementation((_tab: string, weekStart: string) => {
      if (weekStart === '2026-08-03') return Promise.resolve([]); // this week: nothing yet
      // last week: 1 CG slot scheduled for WinMega, not completed
      return Promise.resolve([
        { tab: 'BITP', brand_key: 'winmega', week_start: '2026-07-27', platform: 'cg', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      ]);
    });
    const ctx: TabContext = {
      brands: ['WinMega'],
      activePlatforms: ['cg'],
      entries: [entry({ Brands: 'WinMega', 'CG Review Status': 'pending' })], // not done
    };
    await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    // 1 normal CG post + 1 carried-over CG post = 2 active days this week.
    const activeDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].filter((d) => rows[0][d] === 'active');
    expect(activeDays).toHaveLength(2);
  });

  it('does not carry over when last week had no platform-tagged rows (legacy-only week)', async () => {
    queries.fetchBrandSchedule.mockResolvedValue([]); // both weeks empty/legacy
    const ctx: TabContext = { brands: ['WinMega'], activePlatforms: ['cg'], entries: [] };
    await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    const activeDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].filter((d) => rows[0][d] === 'active');
    expect(activeDays).toHaveLength(1); // normal frequency only, no carryover
  });
});
