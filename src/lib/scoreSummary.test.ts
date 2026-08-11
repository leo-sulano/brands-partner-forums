import { describe, it, expect } from 'vitest';
import { computeScoreSummary, computeSuccessRates, computeTabSuccessRates, computeAccountPlatformUsage, parseScore, ratingLabel, rateFromCounts, successRatePct, formatRatePct, PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, PLATFORM_REVIEW_TEXT_KEYS, pick, getReviewText, isRemovedStatus, passesPlatformDateFilter } from './scoreSummary';
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
    const result = computeScoreSummary(entries, noRange, [], ['tp']);
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
    const result = computeScoreSummary(entries, noRange, [], ['cg']);
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
    const result = computeScoreSummary(entries, noRange, [], ['wo']);
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
    const result = computeScoreSummary(entries, noRange, [], ['ag']);
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
    const result = computeScoreSummary(entries, noRange, [], ['ag']);
    const [brand] = result.brands;
    expect(brand.unrated).toBe(1);
    expect(brand.average).toBeNull();
  });

  it('treats an out-of-range CG score (e.g. entered on the wrong scale) as unrated', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'CG Review Status': 'Published', 'CG Score added': '9' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], ['cg']);
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
    const result = computeScoreSummary(entries, noRange, [], ['tp']);
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
    const result = computeScoreSummary(entries, noRange, [], ['tp']);
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
    const result = computeSuccessRates(entries, ['tp']);
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 2, removed: 1, rate: (2 / 3) * 100 });
  });

  it('excludes pending/done/on-pause rows from the denominator entirely', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Pending' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Done' }),
      makeEntry('3', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'On Pause' }),
    ];
    const result = computeSuccessRates(entries, ['tp']);
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 0, removed: 0, rate: null });
  });

  it('ignores rows with no brand or no status', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: '', 'TP Review Status': 'Published' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com' }),
    ];
    const result = computeSuccessRates(entries, ['tp']);
    expect(result.size).toBe(0);
  });

  it('is all-time by default (no range argument) and counts a Removed row with no post-date', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed' }),
    ];
    const result = computeSuccessRates(entries, ['tp']);
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 0, removed: 1, rate: 0 });
  });

  it('when a range is given, still counts a Removed row with no post-date at all (undated rows always included)', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed' }),
    ];
    const range = { from: new Date(2026, 6, 1), to: new Date(2026, 6, 30) };
    const result = computeSuccessRates(entries, ['tp'], new Set(), range);
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 0, removed: 1, rate: 0 });
  });

  it('when a range is given, excludes a row whose post-date falls outside it', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published', 'Trust Pilot': '15/07/2026' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed', 'Trust Pilot': '05/08/2026' }),
    ];
    const range = { from: new Date(2026, 6, 1), to: new Date(2026, 6, 31) };
    const result = computeSuccessRates(entries, ['tp'], new Set(), range);
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 1, removed: 0, rate: 100 });
  });

  it('keys results by tab and brand independently', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published' }),
      makeEntry('2', 'Trybet', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed' }),
    ];
    const result = computeSuccessRates(entries, ['tp']);
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 1, removed: 0, rate: 100 });
    expect(result.get('Trybet ZodiacBet.com')).toEqual({ live: 0, removed: 1, rate: 0 });
  });
});

describe('computeSuccessRates multi-platform', () => {
  it('a row live on one selected platform and removed on another counts as live once, never both (live-precedence, not double-counted)', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published', 'AG Review Status': 'Removed' }),
    ];
    const result = computeSuccessRates(entries, ['tp', 'ag']);
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 1, removed: 0, rate: 100 });
  });

  it('a row with only a non-live/non-removed status on one selected platform still creates a bucket (matchedAny gate), rather than being dropped from the result map', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Pending' }),
    ];
    const result = computeSuccessRates(entries, ['tp', 'ag']);
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 0, removed: 0, rate: null });
  });

  it('excludes a platform-removed-flagged brand only on the flagged platform within the combined loop, not the whole row', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed', 'AG Review Status': 'Published' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp' }]);
    const result = computeSuccessRates(entries, ['tp', 'ag'], removed);
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 1, removed: 0, rate: 100 });
  });
});

describe('computeTabSuccessRates — date range (matches BrandGroup.tsx brand-tab KPI cards)', () => {
  it('is all-time by default and, when a range is given, still counts undated rows regardless', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed' }),
    ];
    const range = { from: new Date(2026, 6, 1), to: new Date(2026, 6, 31) };
    expect(computeTabSuccessRates(entries, ['tp']).get('Hanan')).toEqual({ live: 0, removed: 1, rate: 0 });
    expect(computeTabSuccessRates(entries, ['tp'], new Set(), range).get('Hanan')).toEqual({ live: 0, removed: 1, rate: 0 });
  });

  it('excludes a dated row outside the selected range', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published', 'Trust Pilot': '15/07/2026' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed', 'Trust Pilot': '05/08/2026' }),
    ];
    const range = { from: new Date(2026, 6, 1), to: new Date(2026, 6, 31) };
    const result = computeTabSuccessRates(entries, ['tp'], new Set(), range);
    expect(result.get('Hanan')).toEqual({ live: 1, removed: 0, rate: 100 });
  });
});

describe('exported platform helpers (scheduler module reuse)', () => {
  it('exposes status/date keys for all four platforms', () => {
    expect(PLATFORM_STATUS_KEYS.tp).toContain('TP Review Status');
    expect(PLATFORM_DATE_KEYS.wo).toEqual(['Wizard of Odds']);
  });

  it('pick returns the first non-empty value across the given keys', () => {
    expect(pick({ a: null, b: 'x' }, ['a', 'b'])).toBe('x');
    expect(pick({ a: null }, ['a'])).toBeNull();
  });

  it('PLATFORM_REVIEW_TEXT_KEYS has one canonical key per platform', () => {
    expect(PLATFORM_REVIEW_TEXT_KEYS.tp).toEqual(['TP Review Text']);
    expect(PLATFORM_REVIEW_TEXT_KEYS.ag).toEqual(['AG Review Text']);
    expect(PLATFORM_REVIEW_TEXT_KEYS.cg).toEqual(['CG Review Text']);
    expect(PLATFORM_REVIEW_TEXT_KEYS.wo).toEqual(['WO Review Text']);
  });

  it('getReviewText reads the platform-specific key', () => {
    expect(getReviewText({ 'TP Review Text': 'Great casino!' }, 'tp')).toBe('Great casino!');
    expect(getReviewText({ 'AG Review Text': 'Fast payouts' }, 'ag')).toBe('Fast payouts');
  });

  it('getReviewText returns null when the key is missing, null, or empty', () => {
    expect(getReviewText({}, 'tp')).toBeNull();
    expect(getReviewText({ 'TP Review Text': null }, 'tp')).toBeNull();
    expect(getReviewText({ 'TP Review Text': '' }, 'tp')).toBeNull();
  });

  it('getReviewText does not cross-read another platform\'s text', () => {
    expect(getReviewText({ 'AG Review Text': 'wrong platform' }, 'tp')).toBeNull();
  });

  it('isRemovedStatus matches removed, refused, and rejected', () => {
    expect(isRemovedStatus('removed')).toBe(true);
    expect(isRemovedStatus('refused')).toBe(true);
    expect(isRemovedStatus('rejected')).toBe(true);
    expect(isRemovedStatus('published')).toBe(false);
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
    const result = computeTabSuccessRates(entries, ['tp']);
    expect(result.get('Hanan')).toEqual({ live: 10, removed: 20, rate: (10 / 30) * 100 });
  });

  it('counts entries with no brand field at all, unlike computeSuccessRates', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { 'TP Review Status': 'Published' }),
      makeEntry('2', 'Hanan', { 'TP Review Status': 'Removed' }),
    ];
    const result = computeTabSuccessRates(entries, ['tp']);
    expect(result.get('Hanan')).toEqual({ live: 1, removed: 1, rate: 50 });
  });

  it('excludes rows with no decided status from the denominator', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { 'TP Review Status': 'Pending' }),
      makeEntry('2', 'Hanan', {}),
    ];
    const result = computeTabSuccessRates(entries, ['tp']);
    expect(result.get('Hanan')).toEqual({ live: 0, removed: 0, rate: null });
  });

  it('keys results by tab independently', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { 'TP Review Status': 'Published' }),
      makeEntry('2', 'Trybet', { 'TP Review Status': 'Removed' }),
    ];
    const result = computeTabSuccessRates(entries, ['tp']);
    expect(result.get('Hanan')).toEqual({ live: 1, removed: 0, rate: 100 });
    expect(result.get('Trybet')).toEqual({ live: 0, removed: 1, rate: 0 });
  });
});

describe('rateFromCounts', () => {
  it('computes the percentage of live outcomes out of live+removed', () => {
    expect(rateFromCounts(2, 1)).toBeCloseTo((2 / 3) * 100);
  });

  it('returns null when there are no decided outcomes yet', () => {
    expect(rateFromCounts(0, 0)).toBeNull();
  });

  it('returns 100 when everything is live', () => {
    expect(rateFromCounts(5, 0)).toBe(100);
  });

  it('returns 0 when everything is removed', () => {
    expect(rateFromCounts(0, 5)).toBe(0);
  });
});

describe('successRatePct', () => {
  it('floors a fractional rate down to the nearest whole percent', () => {
    expect(successRatePct(66.666)).toBe(66);
  });

  it('keeps a rate of exactly 100 as 100 (not floored to 99 by float error)', () => {
    expect(successRatePct(100)).toBe(100);
  });

  it('returns null for a null rate', () => {
    expect(successRatePct(null)).toBeNull();
  });

  it('returns 0 for a rate of exactly 0 (distinct from null)', () => {
    expect(successRatePct(0)).toBe(0);
  });
});

describe('formatRatePct', () => {
  it('formats a rate as a whole-number percent string', () => {
    expect(formatRatePct(2, 1)).toBe('66%');
  });

  it('returns an em dash when there are no decided outcomes', () => {
    expect(formatRatePct(0, 0)).toBe('—');
  });

  it('formats a rate of exactly 100 without a flooring error', () => {
    expect(formatRatePct(5, 0)).toBe('100%');
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
    const result = computeScoreSummary(entries, noRange, [], ['tp'], removed);
    expect(result.brands.map((b) => b.brand)).toEqual(['WinMega.com']);
  });

  it('does not exclude a brand flagged on a different platform', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'AG Review Status': 'Published', 'AG Score added': '9' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    const result = computeScoreSummary(entries, noRange, [], ['ag'], removed);
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
    expect(computeScoreSummary(entries, noRange, [], ['tp'], removed).brands).toHaveLength(0);
    expect(computeScoreSummary(entries, noRange, [], ['ag'], removed).brands).toHaveLength(0);
  });
});

describe('computeSuccessRates — removedPlatformBrands exclusion', () => {
  it('excludes a flagged brand from the matching platform per-brand success rate map', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'TP Review Status': 'Published' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    const result = computeSuccessRates(entries, ['tp'], removed);
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
    const result = computeTabSuccessRates(entries, ['tp'], removed);
    expect(result.get('Hanan')).toEqual({ live: 0, removed: 1, rate: 0 });
  });

  it('still counts a brandless entry even when removedPlatformBrands is non-empty', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { 'TP Review Status': 'Published' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'SomeOtherBrand', platform: 'tp' }]);
    const result = computeTabSuccessRates(entries, ['tp'], removed);
    expect(result.get('Hanan')).toEqual({ live: 1, removed: 0, rate: 100 });
  });
});

describe('computeScoreSummary — removedPlatformBrands case/whitespace normalization', () => {
  it('excludes a flagged brand even when the entry brand value has different casing/whitespace', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: '  PRIBET.COM  ', 'TP Review Status': 'Published' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    const result = computeScoreSummary(entries, { from: null, to: null }, [], ['tp'], removed);
    expect(result.brands).toHaveLength(0);
  });
});

describe('computeAccountPlatformUsage', () => {
  it('counts a row once per platform that has any non-blank status value', () => {
    const entries: Entry[] = [
      makeEntry('1', 'TP Brand Injection', { Account: '358 | BI TP | Germany', 'TP Review Status': 'Published' }),
      makeEntry('2', 'Rooster Partners', {
        Account: '358 | BI TP | Germany',
        'TP Review Status': 'Removed',
        'AG Review Status': 'Published',
        'CG Review Status': 'Pending',
      }),
    ];
    const result = computeAccountPlatformUsage(entries);
    expect(result.get('358 | BI TP | Germany')).toEqual({ tp: 2, ag: 1, cg: 1, wo: 0 });
  });

  it('matches accounts across different tabs and different Account/status column name variants', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Wizard of Odds', { Account: '071 | Test | UK', 'WoO Review Status': 'Published' }),
      makeEntry('2', 'Hanan', { Account: '071 | Test | UK', 'Review Status': 'Published' }),
    ];
    const result = computeAccountPlatformUsage(entries);
    expect(result.get('071 | Test | UK')).toEqual({ tp: 1, ag: 0, cg: 0, wo: 1 });
  });

  it('treats an Account and its duplicated (" dup") copy as the same account', () => {
    const entries: Entry[] = [
      makeEntry('1', 'TP Brand Injection', { Account: '1182 | Test | Norway', 'TP Review Status': 'Published' }),
      makeEntry('2', 'TP Affiliate', { Account: '1182 | Test | Norway dup', 'TP Review Status': 'Published' }),
    ];
    const result = computeAccountPlatformUsage(entries);
    expect(result.size).toBe(1);
    expect(result.get('1182 | Test | Norway')).toEqual({ tp: 2, ag: 0, cg: 0, wo: 0 });
  });

  it('excludes entries with a blank or missing Account', () => {
    const entries: Entry[] = [
      makeEntry('1', 'TP Brand Injection', { Account: '', 'TP Review Status': 'Published' }),
      makeEntry('2', 'TP Brand Injection', { 'TP Review Status': 'Published' }),
    ];
    expect(computeAccountPlatformUsage(entries).size).toBe(0);
  });

  it('does not count a platform whose status keys are all blank', () => {
    const entries: Entry[] = [
      makeEntry('1', 'TP Brand Injection', { Account: '900 | Test | Spain', 'TP Review Status': '' }),
    ];
    const result = computeAccountPlatformUsage(entries);
    expect(result.get('900 | Test | Spain')).toEqual({ tp: 0, ag: 0, cg: 0, wo: 0 });
  });

  it('treats an Account differing only by leading/trailing whitespace as the same account', () => {
    const entries: Entry[] = [
      makeEntry('1', 'TP Brand Injection', { Account: '358 | BI TP | Germany', 'TP Review Status': 'Published' }),
      makeEntry('2', 'TP Affiliate', { Account: '358 | BI TP | Germany ', 'TP Review Status': 'Published' }),
    ];
    const result = computeAccountPlatformUsage(entries);
    expect(result.size).toBe(1);
    expect(result.get('358 | BI TP | Germany')).toEqual({ tp: 2, ag: 0, cg: 0, wo: 0 });
  });

  it('excludes a whitespace-only Account entirely', () => {
    const entries: Entry[] = [
      makeEntry('1', 'TP Brand Injection', { Account: '   ', 'TP Review Status': 'Published' }),
    ];
    expect(computeAccountPlatformUsage(entries).size).toBe(0);
  });
});

describe('passesPlatformDateFilter', () => {
  it('includes a row whose platform-specific date falls inside the range', () => {
    const data = { 'Trust Pilot': '10/06/2026' };
    expect(passesPlatformDateFilter(data, 'tp', '2026-05-01', '2026-07-31')).toBe(true);
  });

  it('excludes a row whose platform-specific date falls outside the range', () => {
    const data = { 'Trust Pilot': '10/01/2026' };
    expect(passesPlatformDateFilter(data, 'tp', '2026-05-01', '2026-07-31')).toBe(false);
  });

  it('always includes a row with no date for that platform, even when the range would otherwise exclude it', () => {
    const data: Record<string, string | null> = { 'Trust Pilot': null };
    expect(passesPlatformDateFilter(data, 'tp', '2026-05-01', '2026-07-31')).toBe(true);
  });

  it('checks only the requested platform\'s own date key, not another platform\'s', () => {
    // Ask Gambler's date is outside the range, but we're asking about 'cg',
    // whose own key ('Casino Guru review added') is unset on this row — must
    // not fall back to AG's value or any other column.
    const data = {
      'Ask Gambler review added': '10/01/2026',
      'Casino Guru review added': null,
    };
    expect(passesPlatformDateFilter(data, 'cg', '2026-05-01', '2026-07-31')).toBe(true);
  });

  it('includes everything when no range is set', () => {
    const data = { 'Trust Pilot': '10/01/2020' };
    expect(passesPlatformDateFilter(data, 'tp', undefined, undefined)).toBe(true);
  });
});

describe('computeScoreSummary multi-platform', () => {
  it('showStars is true for exactly one platform and false for 2+', () => {
    const one = computeScoreSummary([], { from: null, to: null }, [], ['tp']);
    const two = computeScoreSummary([], { from: null, to: null }, [], ['tp', 'ag']);
    expect(one.showStars).toBe(true);
    expect(two.showStars).toBe(false);
  });

  it('an empty platforms array behaves as all 4 combined (bucket exists if any platform has a status)', () => {
    const entries = [{ tab: 'X', data: { Brands: 'B1', 'AG Review Status': 'Published' } }] as unknown as Entry[];
    const result = computeScoreSummary(entries, { from: null, to: null }, [], []);
    expect(result.brands.map((b) => b.brand)).toEqual(['B1']);
    expect(result.showStars).toBe(false);
  });

  it('omitting platforms entirely defaults to TP only, preserving today\'s default (regression lock)', () => {
    const entries = [{ tab: 'X', data: { Brands: 'B1', 'TP Review Status': 'Published' } }] as unknown as Entry[];
    const withDefault = computeScoreSummary(entries, { from: null, to: null });
    const explicitTp = computeScoreSummary(entries, { from: null, to: null }, [], ['tp']);
    expect(withDefault).toEqual(explicitTp);
  });
});
