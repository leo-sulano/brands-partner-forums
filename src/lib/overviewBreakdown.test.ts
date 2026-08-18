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
    // France (100% published) outranks Germany (83.3%) despite lower volume — order is by rate.
    expect(cards).toEqual([
      { key: 'france', label: 'France', live: 2, removed: 0, isOther: false },
      { key: 'germany', label: 'Germany', live: 5, removed: 1, isOther: false },
    ]);
  });

  it('sorts final cards by published rate descending, independent of volume', () => {
    const merged: Record<string, CountBreakdown> = {
      lowRateHighVolume: { label: 'Low Rate High Volume', live: 10, removed: 20 }, // 33.3%
      highRateLowVolume: { label: 'High Rate Low Volume', live: 3, removed: 0 }, // 100%
    };
    const cards = topNWithOther(merged, 8);
    expect(cards.map((c) => c.key)).toEqual(['highRateLowVolume', 'lowRateHighVolume']);
  });

  it('still uses volume (not rate) to decide top-N membership vs. folding into "Other", even though the resulting cards are then rate-sorted', () => {
    const merged: Record<string, CountBreakdown> = {
      bigButAverage: { label: 'Big', live: 5, removed: 5 }, // 50%, volume 10 — makes top-1 on volume
      smallButPerfect: { label: 'Small', live: 1, removed: 0 }, // 100%, volume 1 — folded to Other on volume
    };
    const cards = topNWithOther(merged, 1);
    const other = cards.find((c) => c.isOther);
    // Small (the only lower-volume value) is the one folded into Other, proving membership was
    // decided by volume — Other's own 100% aggregate rate then outranks Big's 50%, so it leads.
    expect(other?.members?.map((m) => m.key)).toEqual(['smallButPerfect']);
    expect(cards.map((c) => c.key)).toEqual(['__other__', 'bigButAverage']);
  });

  it('ties on rate fall back to volume descending', () => {
    const merged: Record<string, CountBreakdown> = {
      a: { label: 'A', live: 1, removed: 0 }, // 100%, volume 1
      b: { label: 'B', live: 10, removed: 0 }, // 100%, volume 10
    };
    const cards = topNWithOther(merged, 8);
    expect(cards.map((c) => c.key)).toEqual(['b', 'a']);
  });

  it('a card with zero accounts sorts last, below a real 0% (all-removed) rate', () => {
    const merged: Record<string, CountBreakdown> = {
      noData: { label: 'No Data', live: 0, removed: 0 },
      allRemoved: { label: 'All Removed', live: 0, removed: 5 },
    };
    const cards = topNWithOther(merged, 8);
    expect(cards.map((c) => c.key)).toEqual(['allRemoved', 'noData']);
  });

  it('collapses the remainder past topN into a single non-"Other"-flagged-false-elsewhere "Other" card, summed correctly, and attaches the folded-in members', () => {
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
      {
        key: '__other__', label: 'Other', live: 2, removed: 1, isOther: true,
        members: [
          { key: 'c', label: 'C', live: 1, removed: 1, isOther: false },
          { key: 'd', label: 'D', live: 1, removed: 0, isOther: false },
        ],
      },
    ]);
  });

  it('does not attach a members field to a real (non-"Other") card', () => {
    const merged: Record<string, CountBreakdown> = { germany: { label: 'Germany', live: 1, removed: 0 } };
    const cards = topNWithOther(merged, 8);
    expect(cards[0].members).toBeUndefined();
  });

  it('returns an empty array for an empty input map', () => {
    expect(topNWithOther({}, 8)).toEqual([]);
  });

  it('pins pinnedLastKey as the trailing card regardless of its volume or rate, excluding it from topN ranking so a real value fills its slot', () => {
    const merged: Record<string, CountBreakdown> = {
      noproxy: { label: 'No Proxy', live: 5, removed: 20 },
      a: { label: 'A', live: 3, removed: 0 },
      b: { label: 'B', live: 2, removed: 0 },
      c: { label: 'C', live: 1, removed: 0 },
    };
    const cards = topNWithOther(merged, 2, 'noproxy');
    expect(cards.map((c) => c.key)).toEqual(['a', 'b', '__other__', 'noproxy']);
    expect(cards[3]).toEqual({ key: 'noproxy', label: 'No Proxy', live: 5, removed: 20, isOther: false });
  });

  it('pinnedLastKey with no matching entry in merged is a no-op', () => {
    const merged: Record<string, CountBreakdown> = { a: { label: 'A', live: 1, removed: 0 } };
    const cards = topNWithOther(merged, 8, 'missing');
    expect(cards).toEqual([{ key: 'a', label: 'A', live: 1, removed: 0, isOther: false }]);
  });

  it('with topN=Infinity, returns every card individually and never produces an "Other" card (Overview.tsx relies on this for Country Breakdown)', () => {
    const merged: Record<string, CountBreakdown> = {
      a: { label: 'A', live: 10, removed: 0 },
      b: { label: 'B', live: 9, removed: 0 },
      c: { label: 'C', live: 1, removed: 1 },
    };
    const cards = topNWithOther(merged, Infinity);
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => !c.isOther)).toBe(true);
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
