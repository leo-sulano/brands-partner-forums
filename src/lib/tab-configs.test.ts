import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { TAB_COLUMN_CONFIGS, getEntryCountry, getCountryForAccount, getBrandGroup, getTabPlatforms, stripDupSuffix, accountUsageKey, hasMultiPlatform, getTabColumns, getBrandNameCol } from './tab-configs';
import { registerDynamicTabs, unregisterDynamicTab } from './dynamicTabRegistry';

describe('TAB_COLUMN_CONFIGS', () => {
  it('places Country immediately after Account in every tab', () => {
    for (const [tab, cols] of Object.entries(TAB_COLUMN_CONFIGS)) {
      const accountIdx = cols.indexOf('Account');
      expect(accountIdx, `${tab} has no Account column`).toBeGreaterThanOrEqual(0);
      expect(cols[accountIdx + 1], `${tab}: Country should immediately follow Account`).toBe('Country');
    }
  });
});

describe('stripDupSuffix', () => {
  it('strips a single trailing " dup" suffix', () => {
    expect(stripDupSuffix('550 l Hanan l Australia dup')).toBe('550 l Hanan l Australia');
  });

  it('strips repeated " dup" suffixes from duplicating an already-duplicated row', () => {
    expect(stripDupSuffix('1182 | Test | Norway dup dup')).toBe('1182 | Test | Norway');
  });

  it('is case-insensitive', () => {
    expect(stripDupSuffix('358 | BI TP | Germany DUP')).toBe('358 | BI TP | Germany');
  });

  it('returns the input unchanged when there is no dup suffix', () => {
    expect(stripDupSuffix('1303 | Test | Germany')).toBe('1303 | Test | Germany');
  });

  it('returns an empty string unchanged', () => {
    expect(stripDupSuffix('')).toBe('');
  });
});

describe('accountUsageKey', () => {
  it('strips a dup suffix and trims whitespace together', () => {
    expect(accountUsageKey('358 | BI TP | Germany dup ')).toBe('358 | BI TP | Germany');
  });

  it('trims leading and trailing whitespace with no dup suffix', () => {
    expect(accountUsageKey('  358 | BI TP | Germany  ')).toBe('358 | BI TP | Germany');
  });

  it('returns an empty string for a whitespace-only value', () => {
    expect(accountUsageKey('   ')).toBe('');
  });

  it('returns an empty string for null or undefined', () => {
    expect(accountUsageKey(null)).toBe('');
    expect(accountUsageKey(undefined)).toBe('');
  });
});

// Regression lock for the platform set every one of the 11 real brand tabs
// resolves to — the Schedule Planner (SchedulePlanner.tsx) now uses this as
// its sole source of "which platforms does this tab track" instead of the
// live-header-based resolveActivePlatforms it used to call, so a silent
// change here would silently change which tabs the scheduler generates
// platform-tagged rows for.
describe('getTabPlatforms', () => {
  it('resolves the three multi-platform tabs to tp+ag+cg', () => {
    expect(getTabPlatforms('Rooster Partners')).toEqual(['tp', 'ag', 'cg']);
    expect(getTabPlatforms('Hanan')).toEqual(['tp', 'ag', 'cg']);
    expect(getTabPlatforms('Revolution Casino')).toEqual(['tp', 'ag', 'cg']);
    expect(getTabPlatforms('SilverPlay')).toEqual(['tp', 'ag', 'cg']);
  });

  it('resolves TP-only tabs (including ones whose status column is bare "Review Status") to tp only', () => {
    expect(getTabPlatforms('TP Brand Injection')).toEqual(['tp']);
    expect(getTabPlatforms('TP Affiliate')).toEqual(['tp']);
    expect(getTabPlatforms('SuprPlay Limited')).toEqual(['tp']);
    expect(getTabPlatforms('Trybet')).toEqual(['tp']);
    expect(getTabPlatforms('HazEmirates UAE')).toEqual(['tp']);
    expect(getTabPlatforms('GRG - Gulf Recovery Group')).toEqual(['tp']);
  });

  it('resolves Wizard of Odds to wo only, with no dependency on a live header match', () => {
    expect(getTabPlatforms('Wizard of Odds')).toEqual(['wo']);
  });
});

describe('getEntryCountry', () => {
  it('returns the real synced Country value when present', () => {
    const data = { Account: '071 | Test | New Zealand', Country: 'New Zealand' };
    expect(getEntryCountry(data, 'Rooster Partners')).toBe('New Zealand');
  });

  it('derives Country from a pipe-delimited Account when the sheet has no Country column', () => {
    const data = { Account: '1182 | Test | Norway', Country: null };
    expect(getEntryCountry(data, 'Wizard of Odds')).toBe('Norway');
  });

  it('derives Country from an "l"-delimited Account (Hanan-sourced Wizard of Odds rows)', () => {
    const data = { Account: '550 l Hanan l Australia', Country: null };
    expect(getEntryCountry(data, 'Wizard of Odds')).toBe('Australia');
  });

  it('falls back to the per-tab default when Account has no parseable country', () => {
    const data = { Account: '001 - UK Reviews', Country: null };
    expect(getEntryCountry(data, 'SuprPlay Limited')).toBe('UK');
  });

  it('returns empty string when there is no real value, no parseable Account, and no tab default', () => {
    const data = { Account: '001 - UK Reviews', Country: null };
    expect(getEntryCountry(data, 'Trybet')).toBe('');
  });

  it('strips a trailing " dup" suffix (added by Duplicate Account) before parsing Account', () => {
    const data = { Account: '550 l Hanan l Australia dup', Country: null };
    expect(getEntryCountry(data, 'Wizard of Odds')).toBe('Australia');
  });

  it('strips repeated " dup" suffixes from duplicating an already-duplicated row', () => {
    const data = { Account: '1182 | Test | Norway dup dup', Country: null };
    expect(getEntryCountry(data, 'Wizard of Odds')).toBe('Norway');
  });
});

describe('getCountryForAccount', () => {
  it('derives Country from a pipe-delimited Account', () => {
    expect(getCountryForAccount('1303 | Test | Germany', 'Wizard of Odds')).toBe('Germany');
  });

  it('derives Country from an "l"-delimited Account', () => {
    expect(getCountryForAccount('550 l Hanan l Australia', 'Wizard of Odds')).toBe('Australia');
  });

  it('strips a trailing " dup" suffix before deriving', () => {
    expect(getCountryForAccount('1303 | Test | Germany dup', 'Wizard of Odds')).toBe('Germany');
  });

  it('falls back to the per-tab default when Account has no parseable country', () => {
    expect(getCountryForAccount('001 - UK Reviews', 'SuprPlay Limited')).toBe('UK');
  });

  it('returns empty string when unparseable and there is no tab default', () => {
    expect(getCountryForAccount('001 - UK Reviews', 'Trybet')).toBe('');
  });

  it('returns empty string for a null/empty Account', () => {
    expect(getCountryForAccount(null, 'Wizard of Odds')).toBe('');
    expect(getCountryForAccount('', 'SuprPlay Limited')).toBe('UK');
  });
});

describe('getBrandGroup', () => {
  it('returns null for a tab with no configured groups at all', () => {
    expect(getBrandGroup('TP Affiliate', 'Aussie Online Pokies')).toBeNull();
    expect(getBrandGroup('Rooster Partners', 'Best Online Casino in Canada 2026 | Top Rated Online Casinos')).toBeNull();
  });
});

describe('tab-configs.ts dynamic tab fallback', () => {
  beforeEach(() => {
    unregisterDynamicTab('Test Dynamic Tab');
  });

  // The registry is module-level state shared with OPERATIONAL_TABS — without
  // this, the last test's registration leaks into any later describe block in
  // this file (and into anything that reads OPERATIONAL_TABS after it).
  afterAll(() => {
    unregisterDynamicTab('Test Dynamic Tab');
  });

  it('getTabColumns falls back to a registered dynamic tab', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp', 'ag'] }]);
    const cols = getTabColumns('Test Dynamic Tab');
    expect(cols).not.toBeNull();
    expect(cols).toContain('AG Review Status');
  });

  it('getTabColumns returns null for an unregistered, non-hardcoded tab', () => {
    expect(getTabColumns('Nonexistent Tab')).toBeNull();
  });

  it('getBrandNameCol resolves "Brand Name" for a dynamic tab', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'] }]);
    expect(getBrandNameCol('Test Dynamic Tab')).toBe('Brand Name');
  });

  it('hasMultiPlatform is true only when a dynamic tab has both AG and CG', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp', 'ag'] }]);
    expect(hasMultiPlatform('Test Dynamic Tab')).toBe(false);
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp', 'ag', 'cg'] }]);
    expect(hasMultiPlatform('Test Dynamic Tab')).toBe(true);
  });

  it('getTabPlatforms reflects a dynamic tab\'s selected platforms', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp', 'cg'] }]);
    expect(getTabPlatforms('Test Dynamic Tab')).toEqual(['tp', 'cg']);
  });

  it('a hardcoded tab is unaffected by the dynamic fallback', () => {
    expect(getTabColumns('Hanan')).toEqual(TAB_COLUMN_CONFIGS['Hanan']);
  });
});
