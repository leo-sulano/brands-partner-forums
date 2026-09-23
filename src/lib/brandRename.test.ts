import { describe, it, expect, vi } from 'vitest';

vi.mock('./tab-configs', () => ({
  getBrandLinkCol: (tab: string) =>
    tab === 'BIT' ? 'Brand / TP URL PAGE__href' : tab === 'Wizard of Odds' ? 'Link to the profile' : 'Brand Link',
  getTabPlatforms: (tab: string) =>
    tab === 'BIT' ? ['tp'] : tab === 'Wizard of Odds' ? ['wo'] : tab === 'SilverPlay' ? ['tp', 'ag', 'cg', 'custom-x'] : ['tp'],
  resolveBrandLink: (brand: string) => (brand === 'rooster.bet' ? 'https://tp/rooster' : ''),
  getBrandAgUrl: (brand: string) => (brand === 'rooster.bet' ? 'https://ag/rooster' : undefined),
  getBrandCgUrl: () => undefined,
}));

import { brandLinkColumnFor, tabLinkPlatforms, buildLinkWrites, buildFallbackFills, effectiveBrandLinks } from './brandRename';

describe('brandLinkColumnFor', () => {
  it('maps TP to the tab brand-link column', () => {
    expect(brandLinkColumnFor('BIT', 'tp')).toBe('Brand / TP URL PAGE__href');
    expect(brandLinkColumnFor('SilverPlay', 'tp')).toBe('Brand Link');
  });
  it('gives TP no column on Wizard of Odds (its link col belongs to WO)', () => {
    expect(brandLinkColumnFor('Wizard of Odds', 'tp')).toBeNull();
    expect(brandLinkColumnFor('Wizard of Odds', 'wo')).toBe('Link to the profile');
  });
  it('maps AG/CG to their review-link columns', () => {
    expect(brandLinkColumnFor('SilverPlay', 'ag')).toBe('AG Review Link');
    expect(brandLinkColumnFor('SilverPlay', 'cg')).toBe('CG Review Link');
  });
});

describe('tabLinkPlatforms', () => {
  it('keeps only enabled built-in link platforms, dropping custom ones', () => {
    expect(tabLinkPlatforms('SilverPlay')).toEqual(['tp', 'ag', 'cg']);
    expect(tabLinkPlatforms('BIT')).toEqual(['tp']);
    expect(tabLinkPlatforms('Wizard of Odds')).toEqual(['wo']);
  });
});

describe('buildLinkWrites', () => {
  it('writes each non-empty link to every tab where that platform is enabled', () => {
    const w = buildLinkWrites(['BIT', 'SilverPlay'], { tp: ' https://tp/x ', ag: 'https://ag/x' });
    expect(w).toEqual([
      { tab: 'BIT', column: 'Brand / TP URL PAGE__href', value: 'https://tp/x', platform: 'tp' },
      { tab: 'SilverPlay', column: 'Brand Link', value: 'https://tp/x', platform: 'tp' },
      { tab: 'SilverPlay', column: 'AG Review Link', value: 'https://ag/x', platform: 'ag' },
    ]);
  });
  it('skips empty/blank values so clearing an input never wipes links everywhere', () => {
    expect(buildLinkWrites(['SilverPlay'], { tp: '', ag: '   ' })).toEqual([]);
  });
});

describe('buildFallbackFills', () => {
  it('emits hardcoded fallbacks for enabled platforms only', () => {
    expect(buildFallbackFills(['SilverPlay', 'BIT'], 'rooster.bet')).toEqual([
      { tab: 'SilverPlay', column: 'Brand Link', value: 'https://tp/rooster', platform: 'tp' },
      { tab: 'SilverPlay', column: 'AG Review Link', value: 'https://ag/rooster', platform: 'ag' },
      { tab: 'BIT', column: 'Brand / TP URL PAGE__href', value: 'https://tp/rooster', platform: 'tp' },
    ]);
  });
  it('emits nothing for a brand with no hardcoded links', () => {
    expect(buildFallbackFills(['SilverPlay'], 'Librabet')).toEqual([]);
  });
});

describe('effectiveBrandLinks', () => {
  it('prefers the tab profile value, falls back to hardcoded, else empty', () => {
    expect(effectiveBrandLinks('SilverPlay', 'rooster.bet', { 'Brand Link': 'https://tp/own' })).toEqual({
      tp: 'https://tp/own', ag: 'https://ag/rooster', cg: '',
    });
  });
});
