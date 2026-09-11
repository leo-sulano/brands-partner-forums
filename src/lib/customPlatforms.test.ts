import { describe, it, expect } from 'vitest';
import { computeCustomPlatformCounts, type CustomPlatformConfig } from './customPlatforms';
import { customPlatformRemovedKey, buildRemovedCustomPlatformBrandSet } from './removedCustomPlatformBrands';
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
    const result = computeCustomPlatformCounts(entries, YELP, 'Test Tab', null);
    expect(result).toEqual({ total: 2, live: 1, removed: 1, successRate: 50 });
  });

  it('ignores a different platform\'s status column on the same entry', () => {
    const entries = [entry({ 'TP Review Status': 'Published', 'Yelp Review Status': '' })];
    const result = computeCustomPlatformCounts(entries, YELP, 'Test Tab', null);
    expect(result).toEqual({ total: 0, live: 0, removed: 0, successRate: null });
  });

  it('excludes a row outside the date range', () => {
    const entries = [
      entry({ 'Yelp Review Status': 'Published', 'Yelp Review Added': '01/01/2026' }),
      entry({ 'Yelp Review Status': 'Published', 'Yelp Review Added': '01/06/2026' }),
    ];
    const result = computeCustomPlatformCounts(entries, YELP, 'Test Tab', null, '2026-05-01', '2026-06-30');
    expect(result.total).toBe(1);
  });

  it('always includes a row with no recorded date, matching the built-in platforms\' rule', () => {
    const entries = [entry({ 'Yelp Review Status': 'Removed' })];
    const result = computeCustomPlatformCounts(entries, YELP, 'Test Tab', null, '2026-05-01', '2026-06-30');
    expect(result.total).toBe(1);
  });

  it('excludes a brand flagged removed on this custom platform', () => {
    const entries = [
      entry({ 'Brand Name': 'Flagged Co', 'Yelp Review Status': 'Published' }),
      entry({ 'Brand Name': 'Other Co', 'Yelp Review Status': 'Published' }),
    ];
    const removed = buildRemovedCustomPlatformBrandSet([{ tab: 'Test Tab', brand: 'Flagged Co', platform_id: 'p1' }]);
    const result = computeCustomPlatformCounts(entries, YELP, 'Test Tab', 'Brand Name', undefined, undefined, removed);
    expect(result).toEqual({ total: 1, live: 1, removed: 0, successRate: 100 });
  });

  it('does not exclude the same brand flagged removed on a DIFFERENT custom platform', () => {
    const entries = [entry({ 'Brand Name': 'Flagged Co', 'Yelp Review Status': 'Published' })];
    const removed = buildRemovedCustomPlatformBrandSet([{ tab: 'Test Tab', brand: 'Flagged Co', platform_id: 'p2-other' }]);
    const result = computeCustomPlatformCounts(entries, YELP, 'Test Tab', 'Brand Name', undefined, undefined, removed);
    expect(result.total).toBe(1);
  });
});
