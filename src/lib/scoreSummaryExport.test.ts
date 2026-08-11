import { describe, it, expect } from 'vitest';
import { buildScoreSummaryExportHeaders, buildScoreSummaryExportRows } from './scoreSummaryExport';
import type { BrandSummary, SuccessRate } from './scoreSummary';

function makeBrand(overrides: Partial<BrandSummary> = {}): BrandSummary {
  return {
    tab: 'Hanan',
    brand: 'Acme',
    counts: { 5: 2, 4: 1, 3: 0, 2: 0, 1: 0 },
    unrated: 1,
    total: 4,
    rated: 3,
    average: 4.33,
    label: 'Great',
    ...overrides,
  };
}

describe('buildScoreSummaryExportHeaders', () => {
  it('includes star columns in descending order when showStars is true', () => {
    expect(buildScoreSummaryExportHeaders(5, true)).toEqual([
      'Tab', 'Brand', '5 Star', '4 Star', '3 Star', '2 Star', '1 Star', 'Unrated', 'Stars Total',
      'Published', 'Removed', 'Total', 'Success Rate %',
    ]);
  });

  it('omits star columns entirely when showStars is false', () => {
    expect(buildScoreSummaryExportHeaders(0, false)).toEqual([
      'Tab', 'Brand', 'Published', 'Removed', 'Total', 'Success Rate %',
    ]);
  });
});

describe('buildScoreSummaryExportRows', () => {
  it('builds one row per brand with star counts and success rate', () => {
    const brands = [makeBrand()];
    const successRates = new Map<string, SuccessRate>([
      ['Hanan Acme', { live: 8, removed: 2, rate: 80 }],
    ]);
    const rows = buildScoreSummaryExportRows(brands, 5, true, successRates);
    expect(rows).toEqual([
      ['Hanan', 'Acme', '2', '1', '0', '0', '0', '1', '4', '8', '2', '10', '80'],
    ]);
  });

  it('omits star columns when showStars is false', () => {
    const brands = [makeBrand()];
    const successRates = new Map<string, SuccessRate>([
      ['Hanan Acme', { live: 8, removed: 2, rate: 80 }],
    ]);
    const rows = buildScoreSummaryExportRows(brands, 0, false, successRates);
    expect(rows).toEqual([['Hanan', 'Acme', '8', '2', '10', '80']]);
  });

  it('writes empty success-rate fields for a brand with no decided outcomes', () => {
    const brands = [makeBrand()];
    const rows = buildScoreSummaryExportRows(brands, 0, false, new Map());
    expect(rows).toEqual([['Hanan', 'Acme', '0', '0', '0', '']]);
  });

  it('floors the success rate the same way the on-screen table does', () => {
    const brands = [makeBrand()];
    const successRates = new Map<string, SuccessRate>([
      ['Hanan Acme', { live: 199, removed: 1, rate: 99.5 }],
    ]);
    const rows = buildScoreSummaryExportRows(brands, 0, false, successRates);
    expect(rows[0][rows[0].length - 1]).toBe('99');
  });

  it('exports the display name for a renamed tab while keeping the success-rate lookup keyed on the raw tab', () => {
    const brands = [makeBrand({ tab: 'TP Affiliate' })];
    const successRates = new Map<string, SuccessRate>([
      ['TP Affiliate Acme', { live: 8, removed: 2, rate: 80 }],
    ]);
    const rows = buildScoreSummaryExportRows(brands, 0, false, successRates);
    expect(rows).toEqual([['FTP', 'Acme', '8', '2', '10', '80']]);
  });
});
