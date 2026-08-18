import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recalculatePauses, ensureWeekGenerated, type TabContext } from './schedulerService';
import type { PinnedCombo } from './schedulerEngine';
import { platformRemovedKey } from '../removedPlatformBrands';
import { overrideKey } from '../scheduleOverrides';
import { scheduleBrandKey } from '../scheduleBrandConfig';
import { WEEKDAYS, toISODate, type Weekday } from '../scheduleBrands';
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

function dateForWeekday(weekStart: string, day: Weekday): string {
  const index = WEEKDAYS.indexOf(day);
  const [y, m, d] = weekStart.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + index));
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
    expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith('BITP', 'WinMega', 'tp', '2026-08-03', expect.any(String), undefined);
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
    expect(queries.deleteBrandPlatformPause).toHaveBeenCalledWith('BITP', 'winmega', 'tp', undefined);
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
  // target combo's schedule is generated. If a brand+platform combo already
  // has a row for week W (platform-tagged), a newly-detected two-consecutive-
  // removed combo with no existing pause row must NOT insert a pause for W
  // — that pause could never affect W's already-written row, and would
  // instead corrupt week W+1's resume logic by looking like a real pause
  // that "expired" (see finding writeup: this previously let a brand+
  // platform get stuck permanently un-pauseable after one resume cycle).
  it('does not insert a pause for a combo that already has a row for the week', async () => {
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

  // Regression test for future-week manual editing: an existing row for one
  // brand+platform combo must not block pause-detection for a DIFFERENT
  // combo in the same week.
  it('still detects a pause for one combo when a different combo already has a row for the week', async () => {
    queries.fetchBrandSchedule.mockResolvedValue([
      { tab: 'BITP', brand_key: 'winmega', week_start: '2026-08-03', platform: 'tp', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ]);
    const ctx: TabContext = {
      brands: ['WinMega', 'BrandB'],
      activePlatforms: ['tp'],
      entries: [
        // Both brands independently qualify for the consecutive-removed pause trigger.
        entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
        entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
        entry({ Brands: 'BrandB', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
        entry({ Brands: 'BrandB', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
      ],
    };
    await recalculatePauses('BITP', '2026-08-03', ctx);
    // WinMega/tp already has a row for this week (a manual future-week edit,
    // in the scenario this guards) -- skipped even though it would otherwise
    // qualify. BrandB/tp has no existing row and still gets paused.
    expect(queries.upsertBrandPlatformPause).toHaveBeenCalledTimes(1);
    expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith('BITP', 'BrandB', 'tp', '2026-08-03', expect.any(String), undefined);
  });

  // A brand whose TP page is flagged removed in Brand Tabs has nothing to
  // pause — it should never even be evaluated, regardless of how it would
  // otherwise score on either pause trigger.
  it('does not evaluate or pause a brand+platform whose page is flagged removed', async () => {
    const ctx: TabContext = {
      brands: ['WinMega'],
      activePlatforms: ['tp'],
      entries: [
        entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
        entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
      ],
      removedPlatformBrandSet: new Set([platformRemovedKey('BITP', 'WinMega', 'tp')]),
    };
    await recalculatePauses('BITP', '2026-08-03', ctx);
    expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
  });

  it('does not evaluate or pause a brand hidden from Schedule Planner', async () => {
    const ctx: TabContext = {
      brands: ['WinMega'],
      activePlatforms: ['tp'],
      entries: [
        entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
        entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
      ],
      hiddenBrandSet: new Set([scheduleBrandKey('BITP', 'WinMega')]),
    };
    await recalculatePauses('BITP', '2026-08-03', ctx);
    expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
  });

  it('only evaluates a platform-restricted brand for its allowed platform, skipping the rest', async () => {
    const ctx: TabContext = {
      brands: ['WinMega'],
      activePlatforms: ['tp', 'ag'],
      entries: [
        entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
        entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
        entry({ Brands: 'WinMega', 'AG Review Status': 'removed', 'Ask Gambler review added': '2026-07-28' }),
        entry({ Brands: 'WinMega', 'AG Review Status': 'refused', 'Ask Gambler review added': '2026-07-24' }),
      ],
      platformRestrictionMap: new Map([[scheduleBrandKey('BITP', 'WinMega'), 'ag']]),
    };
    await recalculatePauses('BITP', '2026-08-03', ctx);
    // Both TP and AG independently qualify for the consecutive-removed pause
    // trigger, but WinMega is restricted to AG only -- TP must never be
    // evaluated or paused.
    expect(queries.upsertBrandPlatformPause).toHaveBeenCalledTimes(1);
    expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith('BITP', 'WinMega', 'ag', '2026-08-03', expect.any(String), undefined);
  });

  it('forwards an explicitly-passed client through to the query functions', async () => {
    const fakeClient = { marker: 'fake' } as any;
    const ctx: TabContext = { brands: ['WinMega'], activePlatforms: ['tp'], entries: [] };
    await recalculatePauses('BITP', '2026-08-03', ctx, fakeClient);
    expect(queries.fetchActiveBrandPlatformPauses).toHaveBeenCalledWith('BITP', fakeClient);
    expect(queries.fetchBrandSchedule).toHaveBeenCalledWith('BITP', '2026-08-03', fakeClient);
  });

  describe('success-rate trigger (rolling 30-day window)', () => {
    it('pauses a brand+platform whose rolling-30-day success rate is below 40% with at least 5 decided posts', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          // Most recent post is Published, so the consecutive-removed check
          // (top 2 by date) never fires here — isolates the success-rate path.
          // weekStart below is 2026-08-17, so the rolling 30-day window is
          // 2026-07-19 through 2026-08-17 -- every date here falls inside it.
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-17', 'Success rate below 40% in the last 30 days (20% over 5 posts)', undefined,
      );
    });

    it('does not pause on a low rolling-30-day rate with fewer than 5 decided posts', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-12' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('does not pause at exactly 40% (boundary is strictly-below)', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('prefers the consecutive-removed reason when both triggers are true at once', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          // Top 2 most recent are both Removed (fires consecutive-removed)
          // AND the rolling-30-day rate is 1/5 = 20% (would also fire
          // success-rate) -- only one pause row/reason should result.
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledTimes(1);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-17', 'Two consecutive Removed/Refused posts', undefined,
      );
    });

    it('does not insert a success-rate pause for a combo that already has a row for the week', async () => {
      queries.fetchBrandSchedule.mockResolvedValue([
        { tab: 'BITP', brand_key: 'winmega', week_start: '2026-08-17', platform: 'tp', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      ]);
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('merges success rates across different brand casings within the rolling 30-day window', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'winmega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'winmega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'winmega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      // 2 live + 3 removed = 5 decided, rate exactly 40% -> no pause (boundary)
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('does not pause when the all-time rate is low but the rolling-30-day rate is at or above 40%', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          // 10 old, out-of-window (early July, before the 2026-07-19 window
          // start) Removed posts -- would tank an all-time rate, but must be
          // excluded entirely from the rolling 30-day window.
          ...Array.from({ length: 10 }, (_, i) =>
            entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': `2026-07-${String(i + 1).padStart(2, '0')}` })),
          // Within the window: 4 live + 1 removed = 5 decided, 80% -- top 2 by
          // date (Aug16, Aug14) are both Published, so consecutive-removed
          // doesn't fire either.
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('pauses when the rolling-30-day rate is low even though the all-time rate looks fine', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          // 10 old, out-of-window (early July, before the 2026-07-19 window
          // start) Published posts -- would make an all-time rate look
          // healthy, but must be excluded from the rolling 30-day window.
          ...Array.from({ length: 10 }, (_, i) =>
            entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': `2026-07-${String(i + 1).padStart(2, '0')}` })),
          // Within the window: 1 live + 4 removed = 5 decided, 20% -- top 2 by
          // date (Aug16 Published, Aug14 Removed) are not both removed, so
          // this isolates the success-rate trigger from consecutive-removed.
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-17', 'Success rate below 40% in the last 30 days (20% over 5 posts)', undefined,
      );
    });
  });

  describe('manual override', () => {
    it("override 'active' clears an existing pause, reports it resumed, and skips auto-detection even with two consecutive removed posts", async () => {
      queries.fetchActiveBrandPlatformPauses.mockResolvedValue([
        { tab: 'BITP', brand_key: 'winmega', platform: 'tp', paused_week_start: '2026-08-03', reason: 'Two consecutive Removed/Refused posts' },
      ]);
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
        ],
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), 'active']]),
      };
      const resumed = await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.deleteBrandPlatformPause).toHaveBeenCalledWith('BITP', 'winmega', 'tp', undefined);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
      expect(resumed).toEqual([{ brandKey: 'winmega', platform: 'tp' }]);
    });

    it("override 'active' with no existing pause is a no-op that skips auto-detection", async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
        ],
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), 'active']]),
      };
      const resumed = await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.deleteBrandPlatformPause).not.toHaveBeenCalled();
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
      expect(resumed).toEqual([]);
    });

    it("override 'pause' unconditionally pauses even with a perfect record", async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-01' })],
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), 'pause']]),
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-03', 'Manually paused', undefined,
      );
    });

    it("override 'pause' bypasses the already-has-a-row-for-the-week guard (unlike auto-detection)", async () => {
      queries.fetchBrandSchedule.mockResolvedValue([
        { tab: 'BITP', brand_key: 'winmega', week_start: '2026-08-03', platform: 'tp', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      ]);
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [],
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), 'pause']]),
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-03', 'Manually paused', undefined,
      );
    });

    it('a removed-platform-flagged combo is skipped even when it has an active override', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [],
        removedPlatformBrandSet: new Set([platformRemovedKey('BITP', 'WinMega', 'tp')]),
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), 'pause']]),
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
      expect(queries.deleteBrandPlatformPause).not.toHaveBeenCalled();
    });

    it("override 'pause' wins over consecutive-removed, with the manual reason not the auto one", async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
        ],
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), 'pause']]),
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledTimes(1);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-03', 'Manually paused', undefined,
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

  // Regression test for the Edge Function's service-role client: a real
  // write only lands in the right place if the client explicitly passed
  // into ensureWeekGenerated actually reaches bulkUpsertBrandSchedule,
  // not just fetchBrandSchedule/fetchActiveBrandPlatformPauses (already
  // covered by recalculatePauses's own "forwards an explicitly-passed
  // client" test above). This is the one write that produces this
  // feature's actual output, so a future edit that forgets to thread
  // `client` through to bulkUpsertBrandSchedule needs a test to catch it.
  it('forwards an explicitly-passed client through to bulkUpsertBrandSchedule', async () => {
    const fakeClient = { marker: 'fake' } as any;
    // beforeEach already sets fetchBrandSchedule to resolve [] for any week,
    // and a single brand/platform with no existing rows guarantees at least
    // one slot is generated, so bulkUpsertBrandSchedule is genuinely called.
    const ctx: TabContext = { brands: ['WinMega'], activePlatforms: ['cg'], entries: [] };
    await ensureWeekGenerated('BITP', '2026-08-03', ctx, [], fakeClient);
    expect(queries.bulkUpsertBrandSchedule).toHaveBeenCalledTimes(1);
    expect(queries.bulkUpsertBrandSchedule).toHaveBeenCalledWith(expect.any(Array), fakeClient);
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

  // Regression test for future-week manual editing: a manually-created row
  // for one brand+platform combo must not block generation for every OTHER
  // combo in the same week — only that exact combo should be skipped.
  it('generates rows only for combos that do not already have one, leaving existing combos untouched', async () => {
    queries.fetchBrandSchedule.mockResolvedValue([
      { tab: 'BITP', brand_key: 'winmega', week_start: '2026-08-10', platform: 'cg', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ]);
    const ctx: TabContext = { brands: ['WinMega', 'BrandB'], activePlatforms: ['cg'], entries: [] };
    await ensureWeekGenerated('BITP', '2026-08-10', ctx, []);
    expect(queries.bulkUpsertBrandSchedule).toHaveBeenCalledTimes(1);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tab: 'BITP', brand: 'BrandB', week_start: '2026-08-10', platform: 'cg' });
  });

  // A brand+platform flagged removed must never get a fresh schedule row
  // written, even on a week with nothing generated yet — otherwise the
  // generator would keep quietly re-creating a schedule for a page that no
  // longer exists, just hidden from the UI. A sibling combo without the flag
  // still generates normally, proving the skip is scoped to that one combo.
  it('does not generate rows for a brand+platform flagged removed, but still generates for others', async () => {
    const ctx: TabContext = {
      brands: ['WinMega', 'BrandB'],
      activePlatforms: ['tp'],
      entries: [],
      removedPlatformBrandSet: new Set([platformRemovedKey('BITP', 'WinMega', 'tp')]),
    };
    await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
    expect(queries.bulkUpsertBrandSchedule).toHaveBeenCalledTimes(1);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tab: 'BITP', brand: 'BrandB', week_start: '2026-08-03', platform: 'tp' });
  });

  it('does not generate rows for a brand hidden from Schedule Planner, but still generates for others', async () => {
    const ctx: TabContext = {
      brands: ['WinMega', 'BrandB'],
      activePlatforms: ['tp'],
      entries: [],
      hiddenBrandSet: new Set([scheduleBrandKey('BITP', 'WinMega')]),
    };
    await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
    expect(queries.bulkUpsertBrandSchedule).toHaveBeenCalledTimes(1);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tab: 'BITP', brand: 'BrandB', week_start: '2026-08-03', platform: 'tp' });
  });

  it('generates no rows for a brand restricted to a platform that is also flagged removed', async () => {
    const ctx: TabContext = {
      brands: ['WinMega', 'BrandB'],
      activePlatforms: ['tp', 'ag'],
      entries: [],
      platformRestrictionMap: new Map([[scheduleBrandKey('BITP', 'WinMega'), 'ag']]),
      removedPlatformBrandSet: new Set([platformRemovedKey('BITP', 'WinMega', 'ag')]),
    };
    await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
    expect(queries.bulkUpsertBrandSchedule).toHaveBeenCalledTimes(1);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    // WinMega's only allowed platform (ag, via the restriction) is also
    // independently flagged removed, so both of its combos (ag via
    // removedSet, tp via not being in the restricted schedulable set) are
    // pinned out entirely — zero WinMega rows. BrandB is untouched by either
    // exclusion and still gets its normal row per active platform (tp + ag).
    expect(rows.every((r: { brand: string }) => r.brand === 'BrandB')).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(expect.objectContaining({ tab: 'BITP', brand: 'BrandB', week_start: '2026-08-03', platform: 'tp' }));
    expect(rows).toContainEqual(expect.objectContaining({ tab: 'BITP', brand: 'BrandB', week_start: '2026-08-03', platform: 'ag' }));
  });

  it('only generates rows for a platform-restricted brand\'s allowed platform', async () => {
    const ctx: TabContext = {
      brands: ['WinMega'],
      activePlatforms: ['tp', 'ag'],
      entries: [],
      platformRestrictionMap: new Map([[scheduleBrandKey('BITP', 'WinMega'), 'ag']]),
    };
    await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
    expect(queries.bulkUpsertBrandSchedule).toHaveBeenCalledTimes(1);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tab: 'BITP', brand: 'WinMega', week_start: '2026-08-03', platform: 'ag' });
  });

  it('reports the brand/platform/date it just activated', async () => {
    const ctx: TabContext = { brands: ['WinMega'], activePlatforms: ['cg'], entries: [] };
    const activated = await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    const activeDay = WEEKDAYS.find((d) => rows[0][d] === 'active')!;
    expect(activated).toEqual([
      { brand: 'WinMega', brandKey: 'winmega', platform: 'cg', date: dateForWeekday('2026-08-03', activeDay) },
    ]);
  });

  it('returns an empty array when the week already has platform-tagged rows (no-op case)', async () => {
    queries.fetchBrandSchedule.mockResolvedValue([
      { tab: 'BITP', brand_key: 'winmega', week_start: '2026-08-03', platform: 'tp', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ]);
    const ctx: TabContext = { brands: ['WinMega'], activePlatforms: ['tp'], entries: [] };
    const activated = await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
    expect(activated).toEqual([]);
  });
});
