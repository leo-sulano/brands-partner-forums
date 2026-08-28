import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildDynamicTabColumns,
  registerDynamicTabs,
  unregisterDynamicTab,
  resetDynamicTabs,
  getDynamicTabColumns,
  getDynamicTabIcon,
  isDynamicTab,
  renameDynamicTab,
} from './dynamicTabRegistry';
import { OPERATIONAL_TABS } from './tabs';
import { TAB_COLUMN_CONFIGS, getTabColumns } from './tab-configs';

describe('buildDynamicTabColumns', () => {
  it('always includes the TP-only base column set when tp is selected', () => {
    expect(buildDynamicTabColumns(['tp'])).toEqual([
      'Account', 'Country', 'Proxy Used', 'Account Name', 'Agent',
      'Brand Name', 'Brand Link', 'Trust Pilot', 'Link to the profile',
      'TP Review Status',
    ]);
  });

  it('omits TP columns entirely when tp is not selected', () => {
    const cols = buildDynamicTabColumns(['ag']);
    expect(cols).not.toContain('Trust Pilot');
    expect(cols).not.toContain('Link to the profile');
    expect(cols).not.toContain('TP Review Status');
  });

  it('returns only the generic base columns when no platform is selected', () => {
    expect(buildDynamicTabColumns([])).toEqual([
      'Account', 'Country', 'Proxy Used', 'Account Name', 'Agent',
      'Brand Name', 'Brand Link',
    ]);
  });

  it('appends the AG block when ag is selected', () => {
    const cols = buildDynamicTabColumns(['tp', 'ag']);
    expect(cols).toContain('Ask Gambler review added');
    expect(cols).toContain('AG Review Status');
    expect(cols).toContain('AG Review Link');
    expect(cols).toContain('AG User');
    expect(cols).not.toContain('Casino Guru review added');
  });

  it('appends the CG block when cg is selected', () => {
    const cols = buildDynamicTabColumns(['tp', 'cg']);
    expect(cols).toContain('Casino Guru review added');
    expect(cols).toContain('CG Review Status');
    expect(cols).toContain('CG Review Link');
    expect(cols).toContain('CG User');
    expect(cols).not.toContain('Ask Gambler review added');
  });

  it('appends the WO block when wo is selected', () => {
    const cols = buildDynamicTabColumns(['wo']);
    expect(cols).toContain('Wizard of Odds');
    expect(cols).toContain('WoO Review Status');
    expect(cols).toContain('Wizard of OddsScore added');
    expect(cols).toContain('WO Review Link');
    expect(cols).not.toContain('Trust Pilot');
  });

  it('appends AG before CG before WO when all are selected, base columns first', () => {
    const cols = buildDynamicTabColumns(['tp', 'ag', 'cg', 'wo']);
    expect(cols.indexOf('TP Review Status')).toBeLessThan(cols.indexOf('Ask Gambler review added'));
    expect(cols.indexOf('AG User')).toBeLessThan(cols.indexOf('Casino Guru review added'));
    expect(cols.indexOf('CG User')).toBeLessThan(cols.indexOf('Wizard of Odds'));
  });
});

describe('registerDynamicTabs / unregisterDynamicTab / getDynamicTabColumns / isDynamicTab', () => {
  beforeEach(() => {
    // Registry is module-level state — explicitly clear anything a prior
    // test registered so tests don't leak into each other.
    unregisterDynamicTab('Test Dynamic Tab');
    unregisterDynamicTab('Second Dynamic Tab');
  });

  it('is not a dynamic tab before registration', () => {
    expect(isDynamicTab('Test Dynamic Tab')).toBe(false);
    expect(getDynamicTabColumns('Test Dynamic Tab')).toBeNull();
  });

  it('registers a tab and makes its columns available', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'] }]);
    expect(isDynamicTab('Test Dynamic Tab')).toBe(true);
    expect(getDynamicTabColumns('Test Dynamic Tab')).toEqual(buildDynamicTabColumns(['tp']));
  });

  it('pushes a newly registered tab into OPERATIONAL_TABS exactly once', () => {
    const before = OPERATIONAL_TABS.length;
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'] }]);
    expect(OPERATIONAL_TABS).toContain('Test Dynamic Tab');
    expect(OPERATIONAL_TABS.length).toBe(before + 1);
    // Re-registering the same name must not duplicate the entry.
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp', 'ag'] }]);
    expect(OPERATIONAL_TABS.filter((t) => t === 'Test Dynamic Tab').length).toBe(1);
    expect(getDynamicTabColumns('Test Dynamic Tab')).toEqual(buildDynamicTabColumns(['tp', 'ag']));
  });

  it('registers multiple tabs in one call', () => {
    registerDynamicTabs([
      { name: 'Test Dynamic Tab', platforms: ['tp'] },
      { name: 'Second Dynamic Tab', platforms: ['tp', 'cg'] },
    ]);
    expect(isDynamicTab('Test Dynamic Tab')).toBe(true);
    expect(isDynamicTab('Second Dynamic Tab')).toBe(true);
  });

  it('unregisterDynamicTab removes the tab from OPERATIONAL_TABS and the registry', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'] }]);
    unregisterDynamicTab('Test Dynamic Tab');
    expect(OPERATIONAL_TABS).not.toContain('Test Dynamic Tab');
    expect(isDynamicTab('Test Dynamic Tab')).toBe(false);
    expect(getDynamicTabColumns('Test Dynamic Tab')).toBeNull();
  });

  it('unregistering a tab that was never registered is a no-op', () => {
    expect(() => unregisterDynamicTab('Never Registered Tab')).not.toThrow();
  });

  it('never treats a hardcoded tab as dynamic', () => {
    expect(isDynamicTab('Hanan')).toBe(false);
    expect(getDynamicTabColumns('Hanan')).toBeNull();
  });

  it('registerDynamicTabs refuses to register a hardcoded tab name', () => {
    const before = [...OPERATIONAL_TABS];
    registerDynamicTabs([{ name: 'Hanan', platforms: ['tp'] }]);
    expect(isDynamicTab('Hanan')).toBe(false);
    expect(getDynamicTabColumns('Hanan')).toBeNull();
    // No duplicate entry pushed, and the hardcoded tab's own config untouched.
    expect(OPERATIONAL_TABS).toEqual(before);
    expect(getTabColumns('Hanan')).toEqual(TAB_COLUMN_CONFIGS['Hanan']);
  });

  it('unregisterDynamicTab never removes a hardcoded tab from OPERATIONAL_TABS', () => {
    unregisterDynamicTab('Hanan');
    expect(OPERATIONAL_TABS).toContain('Hanan');
    expect(getTabColumns('Hanan')).toEqual(TAB_COLUMN_CONFIGS['Hanan']);
  });

  it('resetDynamicTabs clears every registered dynamic tab', () => {
    registerDynamicTabs([
      { name: 'Test Dynamic Tab', platforms: ['tp'] },
      { name: 'Second Dynamic Tab', platforms: ['tp', 'ag'] },
    ]);
    expect(OPERATIONAL_TABS).toContain('Test Dynamic Tab');
    expect(OPERATIONAL_TABS).toContain('Second Dynamic Tab');

    resetDynamicTabs();

    expect(isDynamicTab('Test Dynamic Tab')).toBe(false);
    expect(isDynamicTab('Second Dynamic Tab')).toBe(false);
    expect(OPERATIONAL_TABS).not.toContain('Test Dynamic Tab');
    expect(OPERATIONAL_TABS).not.toContain('Second Dynamic Tab');
    // Hardcoded tabs are untouched.
    expect(OPERATIONAL_TABS).toContain('Hanan');
  });
});

describe('renameDynamicTab', () => {
  beforeEach(() => {
    unregisterDynamicTab('Test Dynamic Tab');
    unregisterDynamicTab('Renamed Dynamic Tab');
    unregisterDynamicTab('Second Dynamic Tab');
  });

  it('renames a registered tab in place, preserving its OPERATIONAL_TABS position', () => {
    registerDynamicTabs([
      { name: 'Second Dynamic Tab', platforms: ['tp'] },
      { name: 'Test Dynamic Tab', platforms: ['tp', 'ag'] },
    ]);
    const idxBefore = OPERATIONAL_TABS.indexOf('Test Dynamic Tab');
    renameDynamicTab('Test Dynamic Tab', 'Renamed Dynamic Tab', ['tp', 'ag']);
    expect(OPERATIONAL_TABS.indexOf('Renamed Dynamic Tab')).toBe(idxBefore);
    expect(OPERATIONAL_TABS).not.toContain('Test Dynamic Tab');
    expect(isDynamicTab('Test Dynamic Tab')).toBe(false);
    expect(isDynamicTab('Renamed Dynamic Tab')).toBe(true);
    expect(getDynamicTabColumns('Renamed Dynamic Tab')).toEqual(buildDynamicTabColumns(['tp', 'ag']));
  });

  it('is a no-op when the old name was never registered as a dynamic tab', () => {
    const before = [...OPERATIONAL_TABS];
    renameDynamicTab('Never Registered', 'Also Never', ['tp']);
    expect(OPERATIONAL_TABS).toEqual(before);
    expect(isDynamicTab('Also Never')).toBe(false);
  });

  it('refuses to rename into a hardcoded tab name, leaving the original registered', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'] }]);
    renameDynamicTab('Test Dynamic Tab', 'Hanan', ['tp']);
    expect(isDynamicTab('Test Dynamic Tab')).toBe(true);
    expect(OPERATIONAL_TABS.filter((t) => t === 'Hanan').length).toBe(1);
    expect(getTabColumns('Hanan')).toEqual(TAB_COLUMN_CONFIGS['Hanan']);
  });

  it('refuses to rename a hardcoded tab', () => {
    const before = [...OPERATIONAL_TABS];
    renameDynamicTab('Hanan', 'Hanan Renamed', ['tp']);
    expect(OPERATIONAL_TABS).toEqual(before);
    expect(isDynamicTab('Hanan Renamed')).toBe(false);
  });
});

describe('getDynamicTabIcon', () => {
  beforeEach(() => {
    unregisterDynamicTab('Test Dynamic Tab');
    unregisterDynamicTab('Renamed Dynamic Tab');
  });

  it('is null before registration', () => {
    expect(getDynamicTabIcon('Test Dynamic Tab')).toBeNull();
  });

  it('registerDynamicTabs sets the icon when provided', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'], icon: 'rocket' }]);
    expect(getDynamicTabIcon('Test Dynamic Tab')).toBe('rocket');
  });

  it('re-registering without an icon field preserves the previously set icon', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'], icon: 'rocket' }]);
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp', 'ag'] }]);
    expect(getDynamicTabIcon('Test Dynamic Tab')).toBe('rocket');
  });

  it('re-registering with icon: null clears a previously set icon', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'], icon: 'rocket' }]);
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'], icon: null }]);
    expect(getDynamicTabIcon('Test Dynamic Tab')).toBeNull();
  });

  it('unregisterDynamicTab clears the icon', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'], icon: 'rocket' }]);
    unregisterDynamicTab('Test Dynamic Tab');
    expect(getDynamicTabIcon('Test Dynamic Tab')).toBeNull();
  });

  it('renameDynamicTab carries the icon over to the new name', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'], icon: 'rocket' }]);
    renameDynamicTab('Test Dynamic Tab', 'Renamed Dynamic Tab', ['tp']);
    expect(getDynamicTabIcon('Test Dynamic Tab')).toBeNull();
    expect(getDynamicTabIcon('Renamed Dynamic Tab')).toBe('rocket');
  });
});
