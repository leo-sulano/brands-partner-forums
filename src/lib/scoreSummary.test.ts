import { describe, it, expect } from 'vitest';
import { computeScoreSummary, parseScore, ratingLabel } from './scoreSummary';
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
});
