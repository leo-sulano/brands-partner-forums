import { describe, it, expect, afterEach } from 'vitest';
import { registerTabCustomPlatforms, resetTabCustomPlatforms, getTabCustomPlatforms, getCustomPlatformColumns } from './customPlatformRegistry';
import { getTabColumns, getTabPlatforms } from './tab-configs';
import { registerDynamicTabs, unregisterDynamicTab } from './dynamicTabRegistry';
import { DATE_ENTRY_HEADERS } from './dateUtils';

const YELP = {
  id: 'p1', tab: 'Hanan', name: 'Yelp', shortLabel: 'YP',
  statusColumn: 'Yelp Review Status', dateColumn: 'Yelp Review Added', maxScore: null,
};

afterEach(() => {
  resetTabCustomPlatforms();
  unregisterDynamicTab('Custom Platform Test Tab');
});

describe('customPlatformRegistry', () => {
  it('getTabCustomPlatforms returns [] when nothing is registered for a tab', () => {
    expect(getTabCustomPlatforms('Hanan')).toEqual([]);
  });

  it('appends a registered platform\'s columns after a hardcoded tab\'s base columns', () => {
    const before = getTabColumns('Hanan')!;
    registerTabCustomPlatforms([YELP]);
    const after = getTabColumns('Hanan')!;
    expect(after).toEqual([...before, 'Yelp Review Status', 'Yelp Review Added']);
  });

  it('appends after a dynamic tab\'s generated columns too', () => {
    registerDynamicTabs([{ name: 'Custom Platform Test Tab', platforms: ['tp'] }]);
    registerTabCustomPlatforms([{ ...YELP, tab: 'Custom Platform Test Tab' }]);
    expect(getTabColumns('Custom Platform Test Tab')).toContain('Yelp Review Status');
  });

  it('registers the date column into DATE_ENTRY_HEADERS', () => {
    registerTabCustomPlatforms([YELP]);
    expect(DATE_ENTRY_HEADERS.has('Yelp Review Added')).toBe(true);
  });

  it('never widens getTabPlatforms\'s built-in return type/value', () => {
    const before = getTabPlatforms('Hanan');
    registerTabCustomPlatforms([YELP]);
    expect(getTabPlatforms('Hanan')).toEqual(before);
  });

  it('resetTabCustomPlatforms clears every registration', () => {
    registerTabCustomPlatforms([YELP]);
    resetTabCustomPlatforms();
    expect(getTabCustomPlatforms('Hanan')).toEqual([]);
    expect(getCustomPlatformColumns('Hanan')).toEqual([]);
  });
});
