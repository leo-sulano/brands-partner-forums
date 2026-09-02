import { describe, it, expect } from 'vitest';
import { buildScheduleExportRows, SCHEDULE_EXPORT_HEADERS, type ScheduleExportBrandData } from './scheduleExport';
import type { BrandScheduleRow } from '../scheduleBrands';
import type { BrandPlatformPause } from '../queries';

function makeRow(overrides: Partial<BrandScheduleRow> = {}): BrandScheduleRow {
  return {
    tab: 'Hanan',
    brand_key: 'acme',
    week_start: '2026-08-10',
    platform: 'tp',
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    ...overrides,
  };
}

function makePause(): BrandPlatformPause {
  return { tab: 'Hanan', brand_key: 'acme', platform: 'tp', paused_week_start: '2026-08-10', reason: 'auto' };
}

describe('SCHEDULE_EXPORT_HEADERS', () => {
  it('has one column per weekday plus brand/platform/paused/removed/evidence/holidays', () => {
    expect(SCHEDULE_EXPORT_HEADERS).toEqual([
      'Brand', 'Platform', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Paused This Week', 'Page Removed',
      'Mon Evidence', 'Tue Evidence', 'Wed Evidence', 'Thu Evidence', 'Fri Evidence',
      'Holidays This Week',
    ]);
  });
});

describe('buildScheduleExportRows', () => {
  it('builds one row per (brand, platform) with weekday statuses', () => {
    const data: ScheduleExportBrandData[] = [{
      brand: 'Acme',
      platforms: ['tp'],
      rowsByPlatform: { tp: makeRow({ monday: 'active', wednesday: 'paused' }) },
      pausesByPlatform: {},
      removedPlatforms: [],
    }];
    expect(buildScheduleExportRows(data)).toEqual([
      ['Acme', 'Trustpilot', 'Active', '', 'Paused', '', '', 'N', 'N', '', '', '', '', '', ''],
    ]);
  });

  it('marks Paused This Week and Page Removed independently of the day statuses', () => {
    const data: ScheduleExportBrandData[] = [{
      brand: 'Acme',
      platforms: ['tp'],
      rowsByPlatform: {},
      pausesByPlatform: { tp: makePause() },
      removedPlatforms: ['tp'],
    }];
    expect(buildScheduleExportRows(data)).toEqual([
      ['Acme', 'Trustpilot', '', '', '', '', '', 'Y', 'Y', '', '', '', '', '', ''],
    ]);
  });

  it('produces one row per platform for a multi-platform brand', () => {
    const data: ScheduleExportBrandData[] = [{
      brand: 'Acme',
      platforms: ['tp', 'ag'],
      rowsByPlatform: { tp: makeRow({ platform: 'tp', friday: 'active' }), ag: makeRow({ platform: 'ag' }) },
      pausesByPlatform: {},
      removedPlatforms: [],
    }];
    const rows = buildScheduleExportRows(data);
    expect(rows).toHaveLength(2);
    expect(rows[0][1]).toBe('Trustpilot');
    expect(rows[1][1]).toBe('AskGamblers');
  });

  it('produces no rows for a brand with zero remaining platforms', () => {
    const data: ScheduleExportBrandData[] = [{
      brand: 'Acme',
      platforms: [],
      rowsByPlatform: {},
      pausesByPlatform: {},
      removedPlatforms: ['tp'],
    }];
    expect(buildScheduleExportRows(data)).toEqual([]);
  });

  it('surfaces per-weekday evidence independently of the plan columns', () => {
    const data: ScheduleExportBrandData[] = [{
      brand: 'Acme',
      platforms: ['tp'],
      // A past day the plan never covered (no brand_schedule row) but a real
      // post happened anyway — exactly the plan-vs-evidence divergence the
      // calendar's own overlay renders and this export previously dropped.
      rowsByPlatform: {},
      pausesByPlatform: {},
      removedPlatforms: [],
      evidenceByPlatform: { tp: { monday: 'confirmed', tuesday: 'removed', wednesday: 'pending', thursday: 'done', friday: null } },
    }];
    expect(buildScheduleExportRows(data)).toEqual([
      ['Acme', 'Trustpilot', '', '', '', '', '', 'N', 'N', 'Confirmed', 'Removed', 'Pending', 'Done', '', ''],
    ]);
  });

  it('adds a Holidays This Week column carrying the joined holiday names', () => {
    const data = [{
      brand: 'WinMega',
      platforms: ['tp' as const],
      rowsByPlatform: {},
      pausesByPlatform: {},
      removedPlatforms: [],
    }];
    const rows = buildScheduleExportRows(data, "New Year's Day, Rizal Day");
    expect(SCHEDULE_EXPORT_HEADERS[SCHEDULE_EXPORT_HEADERS.length - 1]).toBe('Holidays This Week');
    expect(rows[0][rows[0].length - 1]).toBe("New Year's Day, Rizal Day");
  });

  it('leaves the Holidays This Week column blank when none passed', () => {
    const data = [{
      brand: 'WinMega',
      platforms: ['tp' as const],
      rowsByPlatform: {},
      pausesByPlatform: {},
      removedPlatforms: [],
    }];
    const rows = buildScheduleExportRows(data);
    expect(rows[0][rows[0].length - 1]).toBe('');
  });
});
