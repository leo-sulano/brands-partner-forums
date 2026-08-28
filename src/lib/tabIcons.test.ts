import { describe, it, expect, beforeEach } from 'vitest';
import {
  TAB_ICONS, DEFAULT_TAB_ICON, POPULAR_ICON_NAMES, ALL_DYNAMIC_ICON_NAMES,
  isKnownDynamicIconName, resolveTabIconKind,
} from './tabIcons';
import { registerDynamicTabs, unregisterDynamicTab } from './dynamicTabRegistry';

describe('isKnownDynamicIconName', () => {
  it('recognizes every POPULAR_ICON_NAMES entry as a real lucide dynamic icon name', () => {
    for (const name of POPULAR_ICON_NAMES) {
      expect(isKnownDynamicIconName(name)).toBe(true);
    }
  });

  it('rejects a made-up name', () => {
    expect(isKnownDynamicIconName('not-a-real-icon-name')).toBe(false);
  });

  it('ALL_DYNAMIC_ICON_NAMES holds lucide\'s full icon set, not just the popular subset', () => {
    expect(ALL_DYNAMIC_ICON_NAMES.length).toBeGreaterThan(1000);
  });
});

describe('resolveTabIconKind', () => {
  beforeEach(() => {
    unregisterDynamicTab('Test Dynamic Tab');
  });

  it('resolves a hardcoded tab to its TAB_ICONS entry', () => {
    expect(resolveTabIconKind('Hanan')).toEqual({ kind: 'static', Icon: TAB_ICONS['Hanan'] });
  });

  it('falls back to DEFAULT_TAB_ICON for a dynamic tab with no icon set', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'] }]);
    expect(resolveTabIconKind('Test Dynamic Tab')).toEqual({ kind: 'static', Icon: DEFAULT_TAB_ICON });
  });

  it('resolves a dynamic tab to its chosen icon name', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'], icon: 'rocket' }]);
    expect(resolveTabIconKind('Test Dynamic Tab')).toEqual({ kind: 'dynamic', name: 'rocket' });
  });

  it('falls back to DEFAULT_TAB_ICON for an unrecognized/stale icon name', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'], icon: 'not-a-real-icon-name' }]);
    expect(resolveTabIconKind('Test Dynamic Tab')).toEqual({ kind: 'static', Icon: DEFAULT_TAB_ICON });
  });

  it('a hardcoded tab name always wins over any dynamic icon registration', () => {
    // registerDynamicTabs itself refuses to register a hardcoded tab name, so
    // this just confirms resolveTabIconKind still reads TAB_ICONS first regardless.
    registerDynamicTabs([{ name: 'Hanan', platforms: ['tp'], icon: 'rocket' }]);
    expect(resolveTabIconKind('Hanan')).toEqual({ kind: 'static', Icon: TAB_ICONS['Hanan'] });
  });
});
