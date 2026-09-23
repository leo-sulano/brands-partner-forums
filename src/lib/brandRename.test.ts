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

const { renameBrandMock } = vi.hoisted(() => ({ renameBrandMock: vi.fn() }));
vi.mock('./queries', () => ({ renameBrand: renameBrandMock }));
vi.mock('./tabs', () => ({ OPERATIONAL_TABS: ['SilverPlay', 'BIT'] }));

import { brandLinkColumnFor, tabLinkPlatforms, buildLinkWrites, buildFallbackFills, effectiveBrandLinks, performBrandRename, applyRenameToFields, rekeyBrandRows } from './brandRename';

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

describe('performBrandRename', () => {
  it('passes fallback fills for every operational tab and trims the new name', async () => {
    renameBrandMock.mockResolvedValue(3);
    const res = await performBrandRename('rooster.bet', '  Rooster  ');
    expect(renameBrandMock).toHaveBeenCalledWith('rooster.bet', 'Rooster', res.fills);
    expect(res.changed).toBe(3);
    expect(res.fills.map((f) => `${f.tab}:${f.platform}`)).toEqual(['SilverPlay:tp', 'SilverPlay:ag', 'BIT:tp']);
  });
});

describe('applyRenameToFields', () => {
  const fills = [
    { tab: 'SilverPlay', column: 'Brand Link', value: 'https://tp/r', platform: 'tp' as const },
    { tab: 'SilverPlay', column: 'AG Review Link', value: 'https://ag/r', platform: 'ag' as const },
    { tab: 'BIT', column: 'Brand / TP URL PAGE__href', value: 'https://tp/r', platform: 'tp' as const },
  ];
  it('sets the new name and mirrors fills for this tab into empty fields only', () => {
    const out = applyRenameToFields(
      { Brands: 'rooster.bet', 'Brand Link': '', 'AG Review Link': 'https://ag/own', Email: 'x' },
      'Brands', ' Rooster ', 'SilverPlay', fills,
    );
    expect(out).toEqual({ Brands: 'Rooster', 'Brand Link': 'https://tp/r', 'AG Review Link': 'https://ag/own', Email: 'x' });
  });
  it('ignores fills for other tabs and columns the form does not have', () => {
    const out = applyRenameToFields({ Brands: 'a' }, 'Brands', 'b', 'SilverPlay', fills);
    expect(out).toEqual({ Brands: 'b' });
  });
  it('treats an em-dash placeholder as empty and fills it', () => {
    const out = applyRenameToFields(
      { Brands: 'rooster.bet', 'Brand Link': '—' },
      'Brands', 'Rooster', 'SilverPlay', fills,
    );
    expect(out).toEqual({ Brands: 'Rooster', 'Brand Link': 'https://tp/r' });
  });
  it('treats a whitespace-only value as empty and fills it', () => {
    const out = applyRenameToFields(
      { Brands: 'rooster.bet', 'Brand Link': '   ' },
      'Brands', 'Rooster', 'SilverPlay', fills,
    );
    expect(out).toEqual({ Brands: 'Rooster', 'Brand Link': 'https://tp/r' });
  });
});

describe('rekeyBrandRows', () => {
  interface BrandRow { tab: string; brand: string; platform: string }
  const getKey = (r: BrandRow) => r.brand;
  const withKey = (r: BrandRow, v: string): BrandRow => ({ ...r, brand: v });

  it('re-keys every row matching the old name (trimmed/case-insensitive), across every tab', () => {
    const rows: BrandRow[] = [
      { tab: 'SilverPlay', brand: ' Rooster.Bet ', platform: 'tp' },
      { tab: 'BIT', brand: 'rooster.bet', platform: 'tp' },
    ];
    const out = rekeyBrandRows(rows, 'rooster.bet', 'Rooster', getKey, withKey);
    expect(out).toEqual([
      { tab: 'SilverPlay', brand: 'Rooster', platform: 'tp' },
      { tab: 'BIT', brand: 'Rooster', platform: 'tp' },
    ]);
  });

  it('leaves other brands untouched', () => {
    const rows: BrandRow[] = [
      { tab: 'SilverPlay', brand: 'rooster.bet', platform: 'tp' },
      { tab: 'SilverPlay', brand: 'Librabet', platform: 'ag' },
    ];
    const out = rekeyBrandRows(rows, 'rooster.bet', 'Rooster', getKey, withKey);
    expect(out).toEqual([
      { tab: 'SilverPlay', brand: 'Rooster', platform: 'tp' },
      { tab: 'SilverPlay', brand: 'Librabet', platform: 'ag' },
    ]);
  });

  it('does not mutate the input array or its rows', () => {
    const rows: BrandRow[] = [{ tab: 'SilverPlay', brand: 'rooster.bet', platform: 'tp' }];
    const original = rows[0];
    const out = rekeyBrandRows(rows, 'rooster.bet', 'Rooster', getKey, withKey);
    expect(rows[0]).toBe(original);
    expect(rows[0].brand).toBe('rooster.bet');
    expect(out).not.toBe(rows);
    expect(out[0]).not.toBe(original);
  });

  it('works with a normalized brand_key field, matching overrideRows shape', () => {
    interface OverrideRow { tab: string; brand_key: string; platform: string }
    const overrideRows: OverrideRow[] = [{ tab: 'SilverPlay', brand_key: 'rooster.bet', platform: 'tp' }];
    const out = rekeyBrandRows(
      overrideRows, 'rooster.bet', 'rooster',
      (r) => r.brand_key, (r, v) => ({ ...r, brand_key: v }),
    );
    expect(out).toEqual([{ tab: 'SilverPlay', brand_key: 'rooster', platform: 'tp' }]);
  });
});
