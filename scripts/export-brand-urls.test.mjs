import { describe, it, expect } from 'vitest';
import { extractFlatObject, extractNestedObject, buildBrandUrlMaps } from './export-brand-urls.mjs';

const FIXTURE_TAB_CONFIGS = `
export const BRAND_TP_URLS: Record<string, string> = {
  'prive casino':          'https://www.trustpilot.com/review/privecasino.bet',
  'lucky7even':            'https://www.trustpilot.com/review/www.lucky7even.com',
};

const BRAND_AG_URLS: Record<string, string> = {
  'lucky7even':        'https://www.askgamblers.com/online-casinos/reviews/lucky7even-casino',
};

const BRAND_CG_URLS: Record<string, string> = {
  'lucky7even':        'https://casinoguru-en.com/lucky7even-casino-review',
};

const TAB_BRAND_URLS: Record<string, Record<string, string>> = {
  'Wizard of Odds': {
    'rocketspin':      'https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/',
  },
  'Revolution Casino': {
    // God Of Casino has no Trustpilot page (AG only).
    'god of casino': 'https://www.askgamblers.com/online-casinos/reviews/god-of-casino',
  },
};
`;

const FIXTURE_TABS = `
const TAB_DISPLAY_NAMES: Partial<Record<OperationalTab, string>> = {
  'TP Affiliate': 'FTP',
  'TP Brand Injection': 'BITP',
};
`;

describe('extractFlatObject', () => {
  it('extracts quoted key/value pairs from a top-level const object', () => {
    const result = extractFlatObject(FIXTURE_TAB_CONFIGS, 'BRAND_TP_URLS');
    expect(result).toEqual({
      'prive casino': 'https://www.trustpilot.com/review/privecasino.bet',
      'lucky7even': 'https://www.trustpilot.com/review/www.lucky7even.com',
    });
  });

  it('throws when the const name is not found', () => {
    expect(() => extractFlatObject(FIXTURE_TAB_CONFIGS, 'NOT_THERE')).toThrow();
  });
});

describe('extractNestedObject', () => {
  it('extracts one flat object per outer tab key, skipping comment lines', () => {
    const result = extractNestedObject(FIXTURE_TAB_CONFIGS, 'TAB_BRAND_URLS');
    expect(result).toEqual({
      'Wizard of Odds': {
        rocketspin: 'https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/',
      },
      'Revolution Casino': {
        'god of casino': 'https://www.askgamblers.com/online-casinos/reviews/god-of-casino',
      },
    });
  });
});

describe('buildBrandUrlMaps', () => {
  it('assembles all five maps from the two source files', () => {
    const maps = buildBrandUrlMaps({
      tabConfigsSource: FIXTURE_TAB_CONFIGS,
      tabsSource: FIXTURE_TABS,
    });
    expect(maps.tab_display_names).toEqual({
      'TP Affiliate': 'FTP',
      'TP Brand Injection': 'BITP',
    });
    expect(maps.brand_tp_urls['prive casino']).toBe(
      'https://www.trustpilot.com/review/privecasino.bet',
    );
    expect(maps.tab_brand_urls['Wizard of Odds'].rocketspin).toBe(
      'https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/',
    );
  });
});
