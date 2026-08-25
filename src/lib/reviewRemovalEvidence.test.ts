import { describe, it, expect } from 'vitest';
import { computeRemovalEvidence } from './reviewRemovalEvidence';
import type { Entry } from '../types/entry';

let nextId = 1;
function makeEntry(data: Record<string, string | null>, tab = 'Rooster Partners'): Entry {
  return {
    id: `entry-${nextId++}`,
    tab,
    sheet_row_id: `row-${nextId}`,
    data,
    updated_at: '2026-08-01T00:00:00.000Z',
    last_edited_by: 'dashboard',
    last_sync_tag: null,
  };
}

describe('computeRemovalEvidence — cross-entry proxy pattern', () => {
  it('counts other entries sharing the exact same canonical proxy, excluding blank/redacted', () => {
    const current = makeEntry({ Brands: 'BrandA', 'Proxy Used': 'Proxylite', Country: 'Germany', 'TP Review Status': 'Removed' });
    const sameProxyOther = makeEntry({ Brands: 'BrandB', 'Proxy Used': 'proylite', Country: 'France', 'TP Review Status': 'Removed' }); // typo alias, still matches
    const differentProxy = makeEntry({ Brands: 'BrandC', 'Proxy Used': 'SmartProxy', Country: 'Germany', 'TP Review Status': 'Live' });
    const blankProxy = makeEntry({ Brands: 'BrandD', 'Proxy Used': '', Country: 'Germany', 'TP Review Status': 'Live' });
    const redactedProxy = makeEntry({ Brands: 'BrandE', 'Proxy Used': '*****', Country: 'Germany', 'TP Review Status': 'Live' });
    const tabEntries = [current, sameProxyOther, differentProxy, blankProxy, redactedProxy];

    const evidence = computeRemovalEvidence(tabEntries, current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.crossEntry.sameProxyCount).toBe(1);
    expect(evidence.crossEntry.sameProxyRemovedCount).toBe(1);
    expect(evidence.crossEntry.exampleBrands).toEqual(['BrandB']);
  });

  it('reports zero cross-entry matches when the current entry itself has no real proxy recorded', () => {
    const current = makeEntry({ Brands: 'BrandA', 'Proxy Used': '', Country: 'Germany', 'TP Review Status': 'Removed' });
    const other = makeEntry({ Brands: 'BrandB', 'Proxy Used': '', Country: 'Germany', 'TP Review Status': 'Removed' });

    const evidence = computeRemovalEvidence([current, other], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.crossEntry.sameProxyCount).toBe(0);
  });

  it('narrows sameProxySameCountryCount to matches that also share the country', () => {
    const current = makeEntry({ Brands: 'BrandA', 'Proxy Used': 'SmartProxy', Country: 'Germany', 'TP Review Status': 'Removed' });
    const sameCountry = makeEntry({ Brands: 'BrandB', 'Proxy Used': 'SmartProxy', Country: 'Germany', 'TP Review Status': 'Removed' });
    const otherCountry = makeEntry({ Brands: 'BrandC', 'Proxy Used': 'SmartProxy', Country: 'France', 'TP Review Status': 'Removed' });

    const evidence = computeRemovalEvidence([current, sameCountry, otherCountry], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.crossEntry.sameProxyCount).toBe(2);
    expect(evidence.crossEntry.sameProxySameCountryCount).toBe(1);
  });

  it('caps exampleBrands at 5 distinct names', () => {
    const current = makeEntry({ Brands: 'BrandA', 'Proxy Used': 'SmartProxy', Country: 'Germany', 'TP Review Status': 'Removed' });
    const others = ['B', 'C', 'D', 'E', 'F', 'G'].map((letter) =>
      makeEntry({ Brands: `Brand${letter}`, 'Proxy Used': 'SmartProxy', Country: 'Germany', 'TP Review Status': 'Live' }),
    );

    const evidence = computeRemovalEvidence([current, ...others], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.crossEntry.exampleBrands).toHaveLength(5);
  });
});

describe('computeRemovalEvidence — brand resolution excludes Account Name fallback', () => {
  it('does not surface an Account Name as an example brand when the row has no real brand value', () => {
    const current = makeEntry({ Brands: 'BrandA', 'Proxy Used': 'SmartProxy', 'TP Review Status': 'Removed' });
    const blankBrandRow = makeEntry({ Brands: '', 'Account Name': 'John Smith', 'Proxy Used': 'SmartProxy', 'TP Review Status': 'Live' });

    const evidence = computeRemovalEvidence([current, blankBrandRow], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.crossEntry.sameProxyCount).toBe(1);
    expect(evidence.crossEntry.exampleBrands).toEqual([]);
  });
});

describe('computeRemovalEvidence — country resolution falls back through getEntryCountry', () => {
  it('falls back to the Account-derived country via getEntryCountry when Country is blank', () => {
    // Mirrors the exact (tab, Account) pattern already verified in
    // tab-configs.test.ts:143-146 — a pipe-delimited Account on a Wizard of Odds row
    // derives Country from its third segment when the Country cell itself is blank.
    const current = makeEntry(
      { Brands: 'BrandA', 'Proxy Used': 'SmartProxy', Country: null, Account: '1182 | Test | Norway' },
      'Wizard of Odds',
    );
    const sameDerivedCountry = makeEntry(
      { Brands: 'BrandB', 'Proxy Used': 'SmartProxy', Country: null, Account: '2200 | Test | Norway' },
      'Wizard of Odds',
    );
    const differentDerivedCountry = makeEntry(
      { Brands: 'BrandC', 'Proxy Used': 'SmartProxy', Country: null, Account: '3300 | Test | Germany' },
      'Wizard of Odds',
    );

    const evidence = computeRemovalEvidence(
      [current, sameDerivedCountry, differentDerivedCountry],
      current,
      'wo',
      'BrandA',
      'Wizard of Odds',
    );

    expect(evidence.crossEntry.sameProxyCount).toBe(2);
    expect(evidence.crossEntry.sameProxySameCountryCount).toBe(1);
  });
});

describe('computeRemovalEvidence — brand history', () => {
  it('classifies this brand\'s other entries on this platform into live/removed and computes a matching success rate', () => {
    const current = makeEntry({ Brands: 'BrandA', 'TP Review Status': 'Removed' });
    const live1 = makeEntry({ Brands: 'BrandA', 'TP Review Status': 'Published' });
    const live2 = makeEntry({ Brands: 'BrandA', 'TP Review Status': 'Live' });
    const removed1 = makeEntry({ Brands: 'BrandA', 'TP Review Status': 'Refused' });
    const otherBrand = makeEntry({ Brands: 'BrandZ', 'TP Review Status': 'Removed' });
    const noStatus = makeEntry({ Brands: 'BrandA', 'TP Review Status': '' });

    const evidence = computeRemovalEvidence(
      [current, live1, live2, removed1, otherBrand, noStatus],
      current,
      'tp',
      'BrandA',
      'Rooster Partners',
    );

    expect(evidence.brandHistory.totalReviews).toBe(3);
    expect(evidence.brandHistory.liveCount).toBe(2);
    expect(evidence.brandHistory.removedCount).toBe(1);
    expect(evidence.brandHistory.successRatePct).toBe(66);
  });

  it('matches brand names case/whitespace-insensitively', () => {
    const current = makeEntry({ Brands: '  BrandA  ', 'TP Review Status': 'Removed' });
    const other = makeEntry({ Brands: 'branda', 'TP Review Status': 'Live' });

    const evidence = computeRemovalEvidence([current, other], current, 'tp', '  BrandA  ', 'Rooster Partners');

    expect(evidence.brandHistory.totalReviews).toBe(1);
    expect(evidence.brandHistory.liveCount).toBe(1);
  });

  it('reports null successRatePct when this brand has no other decided reviews on this platform', () => {
    const current = makeEntry({ Brands: 'BrandA', 'TP Review Status': 'Removed' });

    const evidence = computeRemovalEvidence([current], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.brandHistory.totalReviews).toBe(0);
    expect(evidence.brandHistory.successRatePct).toBeNull();
  });
});

describe('computeRemovalEvidence — cross-platform corroboration', () => {
  it('reports not applicable for a single-platform tab', () => {
    const current = makeEntry({ Brands: 'BrandA', 'TP Review Status': 'Removed' }, 'TP Brand Injection');

    const evidence = computeRemovalEvidence([current], current, 'tp', 'BrandA', 'TP Brand Injection');

    expect(evidence.crossPlatform).toEqual({ applicable: false });
  });

  it('reads the same entry row\'s other platform statuses for a multi-platform tab', () => {
    const current = makeEntry(
      { Brands: 'BrandA', 'TP Review Status': 'Removed', 'AG Review Status': 'Live', 'CG Review Status': 'Pending' },
      'Rooster Partners',
    );

    const evidence = computeRemovalEvidence([current], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.crossPlatform).toEqual({
      applicable: true,
      other: { ag: { status: 'Live' }, cg: { status: 'Pending' } },
    });
  });
});

describe('computeRemovalEvidence — hard signals', () => {
  it('flags duplicateReviewTextFound when another entry has byte-identical (normalized) review text', () => {
    const current = makeEntry({ Brands: 'BrandA', 'TP Review Text': 'Great platform, super fast!' });
    const duplicate = makeEntry({ Brands: 'BrandB', 'TP Review Text': '  Great platform, super fast!  ' });

    const evidence = computeRemovalEvidence([current, duplicate], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.hardSignals.duplicateReviewTextFound).toBe(true);
  });

  it('does not flag duplicateReviewTextFound for merely similar text', () => {
    const current = makeEntry({ Brands: 'BrandA', 'TP Review Text': 'Great platform, super fast!' });
    const similar = makeEntry({ Brands: 'BrandB', 'TP Review Text': 'Great platform, super fast experience!' });

    const evidence = computeRemovalEvidence([current, similar], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.hardSignals.duplicateReviewTextFound).toBe(false);
  });

  it('sets proxyTiedToOtherRemoval true exactly when sameProxyRemovedCount > 0', () => {
    const current = makeEntry({ Brands: 'BrandA', 'Proxy Used': 'SmartProxy', 'TP Review Status': 'Removed' });
    const otherRemoved = makeEntry({ Brands: 'BrandB', 'Proxy Used': 'SmartProxy', 'TP Review Status': 'Removed' });

    const evidence = computeRemovalEvidence([current, otherRemoved], current, 'tp', 'BrandA', 'Rooster Partners');

    expect(evidence.hardSignals.proxyTiedToOtherRemoval).toBe(true);
  });
});
