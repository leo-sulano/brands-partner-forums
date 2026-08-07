import { describe, it, expect } from 'vitest';
import { mergeBreakdownMaps, topNWithOther, mergeDistinctValues } from './overviewBreakdown';
import type { CountBreakdown } from '../types/brand-entry';

describe('mergeBreakdownMaps', () => {
  it('sums live/removed across maps that share a key, keeping the first label seen', () => {
    const a: Record<string, CountBreakdown> = { germany: { label: 'Germany', live: 2, removed: 1 } };
    const b: Record<string, CountBreakdown> = { germany: { label: 'germany', live: 3, removed: 0 } };
    const merged = mergeBreakdownMaps([a, b]);
    expect(merged).toEqual({ germany: { label: 'Germany', live: 5, removed: 1 } });
  });

  it('keeps disjoint keys from different tabs separate', () => {
    const a: Record<string, CountBreakdown> = { germany: { label: 'Germany', live: 1, removed: 0 } };
    const b: Record<string, CountBreakdown> = { france: { label: 'France', live: 0, removed: 2 } };
    const merged = mergeBreakdownMaps([a, b]);
    expect(merged).toEqual({
      germany: { label: 'Germany', live: 1, removed: 0 },
      france: { label: 'France', live: 0, removed: 2 },
    });
  });

  it('returns an empty object for an empty input list', () => {
    expect(mergeBreakdownMaps([])).toEqual({});
  });
});

describe('topNWithOther', () => {
  it('returns all cards, no "Other", when there are fewer than or equal to topN distinct values', () => {
    const merged: Record<string, CountBreakdown> = {
      germany: { label: 'Germany', live: 5, removed: 1 },
      france: { label: 'France', live: 2, removed: 0 },
    };
    const cards = topNWithOther(merged, 8);
    expect(cards).toEqual([
      { key: 'germany', label: 'Germany', live: 5, removed: 1, isOther: false },
      { key: 'france', label: 'France', live: 2, removed: 0, isOther: false },
    ]);
  });

  it('sorts by total volume descending', () => {
    const merged: Record<string, CountBreakdown> = {
      small: { label: 'Small', live: 1, removed: 0 },
      big: { label: 'Big', live: 10, removed: 5 },
    };
    const cards = topNWithOther(merged, 8);
    expect(cards.map((c) => c.key)).toEqual(['big', 'small']);
  });

  it('collapses the remainder past topN into a single non-"Other"-flagged-false-elsewhere "Other" card, summed correctly', () => {
    const merged: Record<string, CountBreakdown> = {
      a: { label: 'A', live: 10, removed: 0 },
      b: { label: 'B', live: 9, removed: 0 },
      c: { label: 'C', live: 1, removed: 1 },
      d: { label: 'D', live: 1, removed: 0 },
    };
    const cards = topNWithOther(merged, 2);
    expect(cards).toEqual([
      { key: 'a', label: 'A', live: 10, removed: 0, isOther: false },
      { key: 'b', label: 'B', live: 9, removed: 0, isOther: false },
      { key: '__other__', label: 'Other', live: 2, removed: 1, isOther: true },
    ]);
  });

  it('returns an empty array for an empty input map', () => {
    expect(topNWithOther({}, 8)).toEqual([]);
  });
});

describe('mergeDistinctValues', () => {
  it('dedupes case-insensitively across lists, keeping first-seen casing, sorted alphabetically', () => {
    const merged = mergeDistinctValues([['Germany', 'France'], ['germany', 'Spain']]);
    expect(merged).toEqual(['France', 'Germany', 'Spain']);
  });

  it('returns an empty array when given no lists or only empty lists', () => {
    expect(mergeDistinctValues([])).toEqual([]);
    expect(mergeDistinctValues([[], []])).toEqual([]);
  });
});
