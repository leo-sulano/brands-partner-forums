import { describe, it, expect, afterAll, afterEach, beforeEach } from 'vitest';
import {
  TAB_COLUMN_CONFIGS, getEntryCountry, getCountryForAccount, getBrandGroup,
  getTabPlatforms, getTabPlatformsUnfiltered, registerHiddenTabPlatforms,
  unregisterHiddenTabPlatform, resetHiddenTabPlatforms,
  stripDupSuffix, accountUsageKey, hasMultiPlatform, getTabColumns, getBrandNameCol,
  getEnabledToolbarFilters, registerToolbarFilters, unregisterToolbarFilters, resetToolbarFilters, ALL_TOOLBAR_FILTERS,
  getColLabel, getTabSequence, getTabSequenceCol, getBrandTpUrl, getBrandLinkCol, resolveBrandLink,
} from './tab-configs';
import { registerDynamicTabs, unregisterDynamicTab } from './dynamicTabRegistry';
import { renameHardcodedTabLocally, resetHardcodedTabRenames } from './hardcodedTabRenameRegistry';

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

describe('getTabPlatforms / hidden platform overrides', () => {
  beforeEach(() => {
    resetHiddenTabPlatforms();
  });

  afterAll(() => {
    resetHiddenTabPlatforms();
  });

  it('is a no-op for every hardcoded tab when nothing is hidden', () => {
    expect(getTabPlatforms('Rooster Partners')).toEqual(['tp', 'ag', 'cg']);
    expect(getTabPlatforms('Wizard of Odds')).toEqual(['wo']);
    expect(getTabPlatforms('TP Brand Injection')).toEqual(['tp']);
  });

  it('filters a hidden platform out of getTabPlatforms', () => {
    registerHiddenTabPlatforms([{ tab: 'Rooster Partners', platform: 'ag' }]);
    expect(getTabPlatforms('Rooster Partners')).toEqual(['tp', 'cg']);
  });

  it('getTabPlatformsUnfiltered still reports a hidden platform as real', () => {
    registerHiddenTabPlatforms([{ tab: 'Rooster Partners', platform: 'ag' }]);
    expect(getTabPlatformsUnfiltered('Rooster Partners')).toEqual(['tp', 'ag', 'cg']);
  });

  it('unregisterHiddenTabPlatform restores a previously-hidden platform', () => {
    registerHiddenTabPlatforms([{ tab: 'Rooster Partners', platform: 'ag' }]);
    unregisterHiddenTabPlatform('Rooster Partners', 'ag');
    expect(getTabPlatforms('Rooster Partners')).toEqual(['tp', 'ag', 'cg']);
  });

  it('hiding one tab\'s platform does not affect another tab', () => {
    registerHiddenTabPlatforms([{ tab: 'Rooster Partners', platform: 'ag' }]);
    expect(getTabPlatforms('Hanan')).toEqual(['tp', 'ag', 'cg']);
  });

  it('resetHiddenTabPlatforms clears every tab\'s hidden set', () => {
    registerHiddenTabPlatforms([
      { tab: 'Rooster Partners', platform: 'ag' },
      { tab: 'Hanan', platform: 'cg' },
    ]);
    resetHiddenTabPlatforms();
    expect(getTabPlatforms('Rooster Partners')).toEqual(['tp', 'ag', 'cg']);
    expect(getTabPlatforms('Hanan')).toEqual(['tp', 'ag', 'cg']);
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

  it('getTabPlatforms omits tp for a dynamic tab created without it', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['ag', 'wo'] }]);
    expect(getTabPlatforms('Test Dynamic Tab')).toEqual(['ag', 'wo']);
  });

  it('a hardcoded tab is unaffected by the dynamic fallback', () => {
    expect(getTabColumns('Hanan')).toEqual(TAB_COLUMN_CONFIGS['Hanan']);
  });
});

describe('toolbar filter overrides', () => {
  beforeEach(() => {
    resetToolbarFilters();
  });

  afterAll(() => {
    resetToolbarFilters();
  });

  it('returns all 6 filters for a tab with no override row', () => {
    expect(getEnabledToolbarFilters('Rooster Partners')).toEqual(ALL_TOOLBAR_FILTERS);
  });

  it('narrows to exactly the registered set', () => {
    registerToolbarFilters([{ tab: 'Rooster Partners', enabled_filters: ['brand', 'status'] }]);
    expect(getEnabledToolbarFilters('Rooster Partners')).toEqual(['brand', 'status']);
  });

  it('does not affect a different tab', () => {
    registerToolbarFilters([{ tab: 'Rooster Partners', enabled_filters: ['brand'] }]);
    expect(getEnabledToolbarFilters('Hanan')).toEqual(ALL_TOOLBAR_FILTERS);
  });

  it('unregisterToolbarFilters reverts a tab to the all-6 default', () => {
    registerToolbarFilters([{ tab: 'Rooster Partners', enabled_filters: ['brand'] }]);
    unregisterToolbarFilters('Rooster Partners');
    expect(getEnabledToolbarFilters('Rooster Partners')).toEqual(ALL_TOOLBAR_FILTERS);
  });

  it('resetToolbarFilters clears every tab\'s override', () => {
    registerToolbarFilters([
      { tab: 'Rooster Partners', enabled_filters: ['brand'] },
      { tab: 'Hanan', enabled_filters: ['status'] },
    ]);
    resetToolbarFilters();
    expect(getEnabledToolbarFilters('Rooster Partners')).toEqual(ALL_TOOLBAR_FILTERS);
    expect(getEnabledToolbarFilters('Hanan')).toEqual(ALL_TOOLBAR_FILTERS);
  });

  it('re-registering the same tab replaces its set rather than merging', () => {
    registerToolbarFilters([{ tab: 'Rooster Partners', enabled_filters: ['brand', 'agent'] }]);
    registerToolbarFilters([{ tab: 'Rooster Partners', enabled_filters: ['status'] }]);
    expect(getEnabledToolbarFilters('Rooster Partners')).toEqual(['status']);
  });

  it('allows registering an empty filter set', () => {
    registerToolbarFilters([{ tab: 'Rooster Partners', enabled_filters: [] }]);
    expect(getEnabledToolbarFilters('Rooster Partners')).toEqual([]);
  });
});

describe('hardcoded tab rename resolution', () => {
  afterEach(() => {
    resetHardcodedTabRenames();
  });

  it('getTabColumns resolves a renamed hardcoded tab back to its original column list', () => {
    renameHardcodedTabLocally('Hanan', 'Hanan Group');
    expect(getTabColumns('Hanan Group')).toEqual(TAB_COLUMN_CONFIGS['Hanan']);
  });

  it('getColLabel resolves a renamed hardcoded tab back to its per-tab label override', () => {
    renameHardcodedTabLocally('Wizard of Odds', 'WO Renamed');
    expect(getColLabel('User Name', 'WO Renamed')).toBe('WO User');
  });

  it('getTabSequence/getTabSequenceCol resolve a renamed hardcoded tab', () => {
    renameHardcodedTabLocally('TP Brand Injection', 'BITP Team');
    expect(getTabSequence('BITP Team')).toEqual(getTabSequence('TP Brand Injection'));
    expect(getTabSequenceCol('BITP Team')).toBe(getTabSequenceCol('TP Brand Injection'));
  });

  it('getCountryForAccount resolves a renamed hardcoded tab\'s default country', () => {
    renameHardcodedTabLocally('SuprPlay Limited', 'SuprPlay Renamed');
    expect(getCountryForAccount('not a delimited value', 'SuprPlay Renamed')).toBe('UK');
  });

  it('getBrandGroup resolves a renamed hardcoded tab (no groups configured today, still resolves without throwing)', () => {
    renameHardcodedTabLocally('TP Affiliate', 'FTP Renamed');
    expect(getBrandGroup('FTP Renamed', 'Any Brand')).toBeNull();
  });

  it('getBrandTpUrl/resolveBrandLink resolve a renamed tab\'s per-tab brand URL override', () => {
    renameHardcodedTabLocally('Wizard of Odds', 'WO Renamed');
    expect(getBrandTpUrl('lucky7even', 'WO Renamed')).toBe(getBrandTpUrl('lucky7even', 'Wizard of Odds'));
    expect(resolveBrandLink('lucky7even', 'WO Renamed')).toBe(resolveBrandLink('lucky7even', 'Wizard of Odds'));
  });

  it('getBrandLinkCol resolves a renamed hardcoded tab\'s special-cased link column', () => {
    renameHardcodedTabLocally('Wizard of Odds', 'WO Renamed');
    expect(getBrandLinkCol('WO Renamed')).toBe('Link to the profile');
    renameHardcodedTabLocally('WO Renamed', 'Wizard of Odds');
    renameHardcodedTabLocally('TP Brand Injection', 'BITP Team');
    expect(getBrandLinkCol('BITP Team')).toBe('Brand / TP URL PAGE__href');
  });

  it('getTabPlatformsUnfiltered resolves a renamed Wizard of Odds tab to wo-only', () => {
    renameHardcodedTabLocally('Wizard of Odds', 'WO Renamed');
    expect(getTabPlatformsUnfiltered('WO Renamed')).toEqual(['wo']);
  });

  it('getTabPlatforms resolves a renamed multi-platform hardcoded tab', () => {
    renameHardcodedTabLocally('Hanan', 'Hanan Group');
    expect(getTabPlatforms('Hanan Group')).toEqual(getTabPlatforms('Hanan'));
  });
});
