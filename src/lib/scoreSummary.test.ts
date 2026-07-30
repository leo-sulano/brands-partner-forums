import { describe, it, expect } from 'vitest';
import { computeScoreSummary, computeSuccessRates, computeTabSuccessRates, parseScore, ratingLabel } from './scoreSummary';
import { buildRemovedPlatformBrandSet } from './removedPlatformBrands';
import type { Entry } from '../types/entry';

function makeEntry(id: string, tab: string, data: Record<string, string | null>): Entry {
  return {
    id,
    tab,
    sheet_row_id: id,
    data,
    updated_at: '',
    last_edited_by: 'dashboard',
    last_sync_tag: null,
  };
}

describe('parseScore', () => {
  it('accepts a value within range', () => {
    expect(parseScore('7', 10)).toBe(7);
  });

  it('rejects a value above maxScore', () => {
    expect(parseScore('7', 5)).toBeNull();
  });

  it('rejects zero, negative, and non-numeric input', () => {
    expect(parseScore('0', 10)).toBeNull();
    expect(parseScore('-1', 10)).toBeNull();
    expect(parseScore('abc', 10)).toBeNull();
  });

  it('accepts a two-digit value up to maxScore 10', () => {
    expect(parseScore('10', 10)).toBe(10);
  });
});

describe('ratingLabel', () => {
  it('uses the 1-5 thresholds by default', () => {
    expect(ratingLabel(4.6)).toBe('Excellent');
    expect(ratingLabel(4.0)).toBe('Great');
    expect(ratingLabel(3.0)).toBe('Average');
    expect(ratingLabel(2.0)).toBe('Poor');
    expect(ratingLabel(1.0)).toBe('Bad');
  });

  it('doubles the thresholds for a 1-10 scale', () => {
    expect(ratingLabel(9.2, 10)).toBe('Excellent');
    expect(ratingLabel(8.0, 10)).toBe('Great');
    expect(ratingLabel(6.0, 10)).toBe('Average');
    expect(ratingLabel(4.0, 10)).toBe('Poor');
    expect(ratingLabel(1.2, 10)).toBe('Bad');
  });

  it('returns null when average is null', () => {
    expect(ratingLabel(null)).toBeNull();
  });
});

describe('computeScoreSummary', () => {
  const noRange = { from: null, to: null };

  it('reads TP scores on a 1-5 scale (existing behavior, unaffected)', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published', 'TP Score added': '5' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published', 'TP Score added': '4' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'tp');
    expect(result.brands).toHaveLength(1);
    const [brand] = result.brands;
    expect(brand.counts[5]).toBe(1);
    expect(brand.counts[4]).toBe(1);
    expect(brand.average).toBe(4.5);
    expect(brand.label).toBe('Excellent');
  });

  it('reads CG scores on a 1-5 scale', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'CG Review Status': 'Published', 'CG Score added': '3' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'CG Review Status': 'Published', 'CG Score added': '2' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'cg');
    const [brand] = result.brands;
    expect(brand.counts[3]).toBe(1);
    expect(brand.counts[2]).toBe(1);
    expect(brand.average).toBe(2.5);
    expect(brand.label).toBe('Poor');
  });

  it('reads WO scores on a 1-5 scale', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Wizard of Odds', { 'Brand Name': 'ZodiacBet.com', 'WoO Review Status': 'Published', 'Wizard of OddsScore added': '4' }),
      makeEntry('2', 'Wizard of Odds', { 'Brand Name': 'ZodiacBet.com', 'WoO Review Status': 'Published', 'Wizard of OddsScore added': '3' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'wo');
    const [brand] = result.brands;
    expect(brand.counts[4]).toBe(1);
    expect(brand.counts[3]).toBe(1);
    expect(brand.average).toBe(3.5);
    expect(brand.label).toBe('Average');
  });

  it('reads AG scores on a 1-10 scale', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'AG Review Status': 'Published', 'AG Score added': '9' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'AG Review Status': 'Published', 'AG Score added': '10' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'ag');
    const [brand] = result.brands;
    expect(brand.counts[9]).toBe(1);
    expect(brand.counts[10]).toBe(1);
    expect(brand.average).toBe(9.5);
    expect(brand.label).toBe('Excellent');
  });

  it('buckets an AG review with no score as unrated', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'AG Review Status': 'Published' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'ag');
    const [brand] = result.brands;
    expect(brand.unrated).toBe(1);
    expect(brand.average).toBeNull();
  });

  it('treats an out-of-range CG score (e.g. entered on the wrong scale) as unrated', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'CG Review Status': 'Published', 'CG Score added': '9' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'cg');
    const [brand] = result.brands;
    expect(brand.unrated).toBe(1);
  });

  it('still gives a brand a row (all-zero star counts) when it has a resolvable status but no Published entries', () => {
    // Regression: a brand entirely Removed used to get no BrandSummary row at
    // all, which silently hid its Success Rate in ScoreSummaryPanel too (that
    // lookup keys off this same tab+brand set) even though Success Rate is
    // computed independently and all-time.
    const entries: Entry[] = [
      makeEntry('1', 'GRG - Gulf Recovery Group', { Brands: 'Gulf Recovery Group', 'TP Review Status': 'Removed' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'tp');
    expect(result.brands).toHaveLength(1);
    const [brand] = result.brands;
    expect(brand.brand).toBe('Gulf Recovery Group');
    expect(brand.total).toBe(0);
    expect(brand.average).toBeNull();
  });

  it('gives no row at all when status is blank, unlike a Removed/Refused status', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'tp');
    expect(result.brands).toHaveLength(0);
  });
});

describe('computeSuccessRates', () => {
  it('computes live/removed/rate per brand for the selected platform', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published' }),
      makeEntry('3', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed' }),
      makeEntry('4', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Pending' }),
    ];
    const result = computeSuccessRates(entries, 'tp');
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 2, removed: 1, rate: (2 / 3) * 100 });
  });

  it('excludes pending/done/on-pause rows from the denominator entirely', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Pending' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Done' }),
      makeEntry('3', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'On Pause' }),
    ];
    const result = computeSuccessRates(entries, 'tp');
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 0, removed: 0, rate: null });
  });

  it('ignores rows with no brand or no status', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: '', 'TP Review Status': 'Published' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com' }),
    ];
    const result = computeSuccessRates(entries, 'tp');
    expect(result.size).toBe(0);
  });

  it('is all-time by default (no range argument) and counts a Removed row with no post-date', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed' }),
    ];
    const result = computeSuccessRates(entries, 'tp');
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 0, removed: 1, rate: 0 });
  });

  it('when a range is given, still counts a Removed row with no post-date at all (undated rows always included)', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed' }),
    ];
    const range = { from: new Date(2026, 6, 1), to: new Date(2026, 6, 30) };
    const result = computeSuccessRates(entries, 'tp', new Set(), range);
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 0, removed: 1, rate: 0 });
  });

  it('when a range is given, excludes a row whose post-date falls outside it', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published', 'Trust Pilot': '15/07/2026' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed', 'Trust Pilot': '05/08/2026' }),
    ];
    const range = { from: new Date(2026, 6, 1), to: new Date(2026, 6, 31) };
    const result = computeSuccessRates(entries, 'tp', new Set(), range);
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 1, removed: 0, rate: 100 });
  });

  it('keys results by tab and brand independently', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published' }),
      makeEntry('2', 'Trybet', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed' }),
    ];
    const result = computeSuccessRates(entries, 'tp');
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 1, removed: 0, rate: 100 });
    expect(result.get('Trybet ZodiacBet.com')).toEqual({ live: 0, removed: 1, rate: 0 });
  });
});

describe('computeTabSuccessRates — date range (matches BrandGroup.tsx brand-tab KPI cards)', () => {
  it('is all-time by default and, when a range is given, still counts undated rows regardless', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed' }),
    ];
    const range = { from: new Date(2026, 6, 1), to: new Date(2026, 6, 31) };
    expect(computeTabSuccessRates(entries, 'tp').get('Hanan')).toEqual({ live: 0, removed: 1, rate: 0 });
    expect(computeTabSuccessRates(entries, 'tp', new Set(), range).get('Hanan')).toEqual({ live: 0, removed: 1, rate: 0 });
  });

  it('excludes a dated row outside the selected range', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published', 'Trust Pilot': '15/07/2026' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed', 'Trust Pilot': '05/08/2026' }),
    ];
    const range = { from: new Date(2026, 6, 1), to: new Date(2026, 6, 31) };
    const result = computeTabSuccessRates(entries, 'tp', new Set(), range);
    expect(result.get('Hanan')).toEqual({ live: 1, removed: 0, rate: 100 });
  });
});

describe('computeTabSuccessRates', () => {
  it('aggregates by tab only, so a brand with zero Published entries still counts toward the tab total', () => {
    // Brand A: 10 Published (live). Brand B: 20 Removed, 0 Published. Even
    // though computeScoreSummary now gives Brand B its own (all-zero-star)
    // BrandSummary row too, this test still guards computeTabSuccessRates'
    // independent tab-level aggregation — a naive sum over BrandSummary rows
    // would miss its 20 Removed entirely and show the tab at 100% instead of 33%.
    const entries: Entry[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeEntry(`a${i}`, 'Hanan', { Brands: 'BrandA.com', 'TP Review Status': 'Published' }),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        makeEntry(`b${i}`, 'Hanan', { Brands: 'BrandB.com', 'TP Review Status': 'Removed' }),
      ),
    ];
    const result = computeTabSuccessRates(entries, 'tp');
    expect(result.get('Hanan')).toEqual({ live: 10, removed: 20, rate: (10 / 30) * 100 });
  });

  it('counts entries with no brand field at all, unlike computeSuccessRates', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { 'TP Review Status': 'Published' }),
      makeEntry('2', 'Hanan', { 'TP Review Status': 'Removed' }),
    ];
    const result = computeTabSuccessRates(entries, 'tp');
    expect(result.get('Hanan')).toEqual({ live: 1, removed: 1, rate: 50 });
  });

  it('excludes rows with no decided status from the denominator', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { 'TP Review Status': 'Pending' }),
      makeEntry('2', 'Hanan', {}),
    ];
    const result = computeTabSuccessRates(entries, 'tp');
    expect(result.get('Hanan')).toEqual({ live: 0, removed: 0, rate: null });
  });

  it('keys results by tab independently', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { 'TP Review Status': 'Published' }),
      makeEntry('2', 'Trybet', { 'TP Review Status': 'Removed' }),
    ];
    const result = computeTabSuccessRates(entries, 'tp');
    expect(result.get('Hanan')).toEqual({ live: 1, removed: 0, rate: 100 });
    expect(result.get('Trybet')).toEqual({ live: 0, removed: 1, rate: 0 });
  });
});

describe('computeScoreSummary — removedPlatformBrands exclusion', () => {
  const noRange = { from: null, to: null };

  it('excludes a flagged brand entirely from the matching platform view', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'TP Review Status': 'Published', 'TP Score added': '5' }),
      makeEntry('2', 'Hanan', { Brands: 'WinMega.com', 'TP Review Status': 'Published', 'TP Score added': '4' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    const result = computeScoreSummary(entries, noRange, [], 'tp', removed);
    expect(result.brands.map((b) => b.brand)).toEqual(['WinMega.com']);
  });

  it('does not exclude a brand flagged on a different platform', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'AG Review Status': 'Published', 'AG Score added': '9' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    const result = computeScoreSummary(entries, noRange, [], 'ag', removed);
    expect(result.brands).toHaveLength(1);
  });

  it('excludes the same brand independently per platform when flagged on both', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'TP Review Status': 'Published', 'TP Score added': '5' }),
      makeEntry('2', 'Hanan', { Brands: 'Pribet.com', 'AG Review Status': 'Published', 'AG Score added': '9' }),
    ];
    const removed = buildRemovedPlatformBrandSet([
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' },
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'ag' },
    ]);
    expect(computeScoreSummary(entries, noRange, [], 'tp', removed).brands).toHaveLength(0);
    expect(computeScoreSummary(entries, noRange, [], 'ag', removed).brands).toHaveLength(0);
  });
});

describe('computeSuccessRates — removedPlatformBrands exclusion', () => {
  it('excludes a flagged brand from the matching platform per-brand success rate map', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'TP Review Status': 'Published' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    const result = computeSuccessRates(entries, 'tp', removed);
    expect(result.has('Hanan Pribet.com')).toBe(false);
  });
});

describe('computeTabSuccessRates — removedPlatformBrands exclusion', () => {
  it('excludes a flagged brand from the matching platform tab-level success rate total', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'TP Review Status': 'Published' }),
      makeEntry('2', 'Hanan', { Brands: 'WinMega.com', 'TP Review Status': 'Removed' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    const result = computeTabSuccessRates(entries, 'tp', removed);
    expect(result.get('Hanan')).toEqual({ live: 0, removed: 1, rate: 0 });
  });

  it('still counts a brandless entry even when removedPlatformBrands is non-empty', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { 'TP Review Status': 'Published' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'SomeOtherBrand', platform: 'tp' }]);
    const result = computeTabSuccessRates(entries, 'tp', removed);
    expect(result.get('Hanan')).toEqual({ live: 1, removed: 0, rate: 100 });
  });
});

describe('computeScoreSummary — removedPlatformBrands case/whitespace normalization', () => {
  it('excludes a flagged brand even when the entry brand value has different casing/whitespace', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: '  PRIBET.COM  ', 'TP Review Status': 'Published' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    const result = computeScoreSummary(entries, { from: null, to: null }, [], 'tp', removed);
    expect(result.brands).toHaveLength(0);
  });
});
