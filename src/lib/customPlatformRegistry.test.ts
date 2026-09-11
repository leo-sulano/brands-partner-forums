import { describe, it, expect, afterEach } from 'vitest';
import { registerTabCustomPlatforms, resetTabCustomPlatforms, getTabCustomPlatforms, getCustomPlatformColumns, getCustomPlatformById, getCustomPlatformIds } from './customPlatformRegistry';
import { getTabColumns, getTabPlatforms } from './tab-configs';
import { registerDynamicTabs, unregisterDynamicTab } from './dynamicTabRegistry';
import { DATE_ENTRY_HEADERS } from './dateUtils';
import type { CustomPlatformConfig } from './customPlatformRegistry';

const YELP: CustomPlatformConfig = {
  id: 'p1', tab: 'Hanan', name: 'Yelp', shortLabel: 'YP',
  statusColumn: 'Yelp Review Status', dateColumn: 'Yelp Review Added', maxScore: null,
};

// Separate constants for the new test suites, matching the brief's example values
const YELP_BITP: CustomPlatformConfig = {
  id: 'p1', tab: 'BITP', name: 'Yelp', shortLabel: 'YP',
  statusColumn: 'Yelp Review Status', dateColumn: 'Yelp Review Added', maxScore: null,
};

const G2: CustomPlatformConfig = {
  id: 'p2', tab: 'Hanan', name: 'G2', shortLabel: 'G2',
  statusColumn: 'G2 Review Status', dateColumn: 'G2 Review Added', maxScore: null,
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

  // Reverses this test's original assertion from the Custom Platforms feature
  // (2026-09-07, commit 72a7d60), which deliberately locked getTabPlatforms
  // to NOT widen -- Schedule Planner integration was an explicit non-goal at
  // the time (see CLAUDE.md's Known Issues entry for Task 325). The
  // 2026-09-11 schedule-planner-custom-platform-support plan's whole premise
  // is reversing that non-goal, via the setCustomPlatformKeysResolver
  // self-registration wired up in this file (see the bottom of
  // customPlatformRegistry.ts). This is the end-to-end proof that a
  // registered custom platform's id really does flow through to
  // getTabPlatforms via the real registry, not just via a test-injected
  // resolver (tab-configs.test.ts's own 'custom platform resolver' describe
  // block covers that half in isolation).
  it('appends a registered platform\'s id after getTabPlatforms\'s built-in return value', () => {
    const before = getTabPlatforms('Hanan');
    registerTabCustomPlatforms([YELP]);
    expect(getTabPlatforms('Hanan')).toEqual([...before, 'p1']);
  });

  it('resetTabCustomPlatforms clears every registration', () => {
    registerTabCustomPlatforms([YELP]);
    resetTabCustomPlatforms();
    expect(getTabCustomPlatforms('Hanan')).toEqual([]);
    expect(getCustomPlatformColumns('Hanan')).toEqual([]);
  });

  it('is idempotent on (tab, id) -- re-running the AuthContext bootstrap (e.g. a sign-out/sign-in cycle with no full page reload) must not duplicate a row', () => {
    registerTabCustomPlatforms([YELP]);
    registerTabCustomPlatforms([YELP]);
    expect(getTabCustomPlatforms('Hanan')).toEqual([YELP]);
    expect(getTabColumns('Hanan')!.filter((c) => c === 'Yelp Review Status')).toHaveLength(1);
  });
});

describe('getCustomPlatformById', () => {
  afterEach(() => resetTabCustomPlatforms());

  it('finds a registered platform by id regardless of which tab registered it', () => {
    registerTabCustomPlatforms([YELP_BITP, G2]);
    expect(getCustomPlatformById('p1')).toEqual(YELP_BITP);
    expect(getCustomPlatformById('p2')).toEqual(G2);
  });

  it('returns undefined for an unregistered id', () => {
    registerTabCustomPlatforms([YELP_BITP]);
    expect(getCustomPlatformById('nonexistent')).toBeUndefined();
  });
});

describe('getCustomPlatformIds', () => {
  afterEach(() => resetTabCustomPlatforms());

  it('returns the ids of every custom platform registered for a tab', () => {
    registerTabCustomPlatforms([YELP_BITP, G2]);
    expect(getCustomPlatformIds('BITP')).toEqual(['p1']);
    expect(getCustomPlatformIds('Hanan')).toEqual(['p2']);
  });

  it('returns an empty array for a tab with no custom platforms', () => {
    expect(getCustomPlatformIds('NoCustomTab')).toEqual([]);
  });
});
