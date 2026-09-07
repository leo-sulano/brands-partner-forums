import { describe, it, expect } from 'vitest';
import { computeCustomPlatformCounts, type CustomPlatformConfig } from './customPlatforms';
import type { Entry } from '../types/entry';

function entry(data: Record<string, string | null>): Entry {
  return {
    id: crypto.randomUUID(),
    tab: 'Test Tab',
    sheet_row_id: '',
    data,
    updated_at: '',
    last_edited_by: 'dashboard',
    last_sync_tag: null,
  };
}

const YELP: CustomPlatformConfig = {
  id: 'p1',
  tab: 'Test Tab',
  name: 'Yelp',
  shortLabel: 'YP',
  statusColumn: 'Yelp Review Status',
  dateColumn: 'Yelp Review Added',
  maxScore: null,
};

describe('computeCustomPlatformCounts', () => {
  it('counts live, removed, and total from the platform-specific status column', () => {
    const entries = [
      entry({ 'Yelp Review Status': 'Published' }),
      entry({ 'Yelp Review Status': 'Removed' }),
      entry({ 'Yelp Review Status': 'Pending' }),
      entry({ 'Yelp Review Status': '' }),
    ];
    const result = computeCustomPlatformCounts(entries, YELP);
    expect(result).toEqual({ total: 2, live: 1, removed: 1, successRate: 50 });
  });

  it('ignores a different platform\'s status column on the same entry', () => {
    const entries = [entry({ 'TP Review Status': 'Published', 'Yelp Review Status': '' })];
    const result = computeCustomPlatformCounts(entries, YELP);
    expect(result).toEqual({ total: 0, live: 0, removed: 0, successRate: null });
  });

  it('excludes a row outside the date range', () => {
    const entries = [
      entry({ 'Yelp Review Status': 'Published', 'Yelp Review Added': '01/01/2026' }),
      entry({ 'Yelp Review Status': 'Published', 'Yelp Review Added': '01/06/2026' }),
    ];
    const result = computeCustomPlatformCounts(entries, YELP, '2026-05-01', '2026-06-30');
    expect(result.total).toBe(1);
  });

  it('always includes a row with no recorded date, matching the built-in platforms\' rule', () => {
    const entries = [entry({ 'Yelp Review Status': 'Removed' })];
    const result = computeCustomPlatformCounts(entries, YELP, '2026-05-01', '2026-06-30');
    expect(result.total).toBe(1);
  });
});
