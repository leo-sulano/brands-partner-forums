import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recalculatePauses, ensureWeekGenerated, type TabContext } from './schedulerService';
import type { PinnedCombo } from './schedulerEngine';
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

  // Regression test: a pause is only meaningful if it's inserted before the
  // target week's schedule is generated. If week W was already generated
  // (platform-tagged rows exist for it), a newly-detected two-consecutive-
  // removed combo with no existing pause row must NOT insert a pause for W
  // — that pause could never affect W's already-written schedule, and would
  // instead corrupt week W+1's resume logic by looking like a real pause
  // that "expired" (see finding writeup: this previously let a brand+
  // platform get stuck permanently un-pauseable after one resume cycle).
  it('does not insert a pause for a week that is already generated', async () => {
    queries.fetchBrandSchedule.mockResolvedValue([
      { tab: 'BITP', brand_key: 'winmega', week_start: '2026-08-03', platform: 'tp', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ]);
    const ctx: TabContext = {
      brands: ['WinMega'],
      activePlatforms: ['tp'],
      entries: [
        entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
        entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
      ],
    };
    await recalculatePauses('BITP', '2026-08-03', ctx);
    expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
  });

  describe('success-rate trigger', () => {
    it('pauses a brand+platform whose all-time success rate is below 40% with at least 5 decided posts', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          // Most recent post is Published, so the consecutive-removed check
          // (top 2 by date) never fires here — isolates the success-rate path.
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-01' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-24' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-20' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-15' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-03', 'Success rate below 40% (20% over 5 posts)',
      );
    });

    it('does not pause on a low success rate with fewer than 5 decided posts', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-01' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-24' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('does not pause at exactly 40% (boundary is strictly-below)', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-01' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-07-24' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-20' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-15' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('prefers the consecutive-removed reason when both triggers are true at once', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          // Top 2 most recent are both Removed (fires consecutive-removed)
          // AND overall rate is 1/5 = 20% with 5 decided posts (would also
          // fire success-rate) -- only one pause row/reason should result.
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-01' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-24' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-20' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-07-15' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledTimes(1);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-03', 'Two consecutive Removed/Refused posts',
      );
    });
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
    // beforeEach already sets fetchBrandSchedule to resolve [] for any week.
    const ctx: TabContext = { brands: ['WinMega'], activePlatforms: ['cg'], entries: [] };
    await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
    expect(queries.bulkUpsertBrandSchedule).toHaveBeenCalledTimes(1);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tab: 'BITP', brand: 'WinMega', week_start: '2026-08-03', platform: 'cg' });
  });

  // End-to-end check that `resumedThisWeek` (as produced by recalculatePauses)
  // actually reaches the engine as `resumingBrandPlatforms` and influences the
  // written schedule, rather than only being verified by reading the code.
  //
  // A single-brand/single-platform/no-carryover scenario can't discriminate this:
  // schedulerEngine's Priority 2 (resuming) and Priority 3 (everyone else) both call
  // assign(..., PLATFORM_RULES[platform].postsPerWeek) when there's nothing else in
  // play, so the same output would result even if `resumedThisWeek` were silently
  // dropped. To force a real difference, this combo is ALSO given carryover from last
  // week (below the 40% completion threshold): Priority 3's fallback loop adds
  // carryoverExtra on top of postsPerWeek, but Priority 2's resuming branch does not
  // (see schedulerEngine.ts — only the Priority 3 loop reads carryoverMap). So a
  // correctly-wired resumedThisWeek yields exactly postsPerWeek (1) active day here;
  // if `resumingBrandPlatforms: resumedThisWeek` were replaced with `[]`, the combo
  // would fall through to Priority 3 and pick up the extra carried-over slot, landing
  // on 2 active days instead.
  it('does not add carryover to a resumed brand+platform, proving resumedThisWeek reaches the engine', async () => {
    queries.fetchBrandSchedule.mockImplementation((_tab: string, weekStart: string) => {
      if (weekStart === '2026-08-03') return Promise.resolve([]); // this week: nothing yet
      // last week: 1 CG slot scheduled for WinMega, not completed -> carryover of 1
      return Promise.resolve([
        { tab: 'BITP', brand_key: 'winmega', week_start: '2026-07-27', platform: 'cg', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      ]);
    });
    const ctx: TabContext = {
      brands: ['WinMega'],
      activePlatforms: ['cg'],
      entries: [entry({ Brands: 'WinMega', 'CG Review Status': 'pending' })], // not done -> carryover applies
    };
    const resumedThisWeek: PinnedCombo[] = [{ brandKey: 'winmega', platform: 'cg' }];
    await ensureWeekGenerated('BITP', '2026-08-03', ctx, resumedThisWeek);
    expect(queries.bulkUpsertBrandSchedule).toHaveBeenCalledTimes(1);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tab: 'BITP', brand: 'WinMega', week_start: '2026-08-03', platform: 'cg' });
    const activeDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].filter((d) => rows[0][d] === 'active');
    expect(activeDays).toHaveLength(1); // postsPerWeek only, no carryover — proves the resuming branch (not the fallback) handled this combo
  });

  // Completion carryover is deliberately disabled for this initial ship
  // (CARRYOVER_RULES.completionThreshold = 0 in schedulerRules.ts — see the
  // comment there): buildCarryover's `ratio >= completionThreshold` early
  // return can never be skipped when the threshold is 0, since a completion
  // ratio is never negative. This test used to assert the opposite (that a
  // below-40%-complete prior week added a carried-over slot); it's flipped
  // here to lock in the current, intentionally-inert behavior so a future
  // change to CARRYOVER_RULES doesn't silently reactivate carryover with its
  // known-broken unbounded-compounding formula. See the final-review fix
  // report for full context.
  it('does not carry over unfinished slots now that completion carryover is disabled (completionThreshold = 0)', async () => {
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
    // Carryover disabled -> only the normal CG post, no carried-over slot.
    const activeDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].filter((d) => rows[0][d] === 'active');
    expect(activeDays).toHaveLength(1);
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
