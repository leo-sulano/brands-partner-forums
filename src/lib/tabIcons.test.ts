import { describe, it, expect, beforeEach } from 'vitest';
import { TAB_ICONS, DEFAULT_TAB_ICON, ICON_OPTIONS, resolveTabIcon } from './tabIcons';
import { registerDynamicTabs, unregisterDynamicTab } from './dynamicTabRegistry';

describe('resolveTabIcon', () => {
  beforeEach(() => {
    unregisterDynamicTab('Test Dynamic Tab');
  });

  it('resolves a hardcoded tab to its TAB_ICONS entry', () => {
    expect(resolveTabIcon('Hanan')).toBe(TAB_ICONS['Hanan']);
  });

  it('falls back to DEFAULT_TAB_ICON for a dynamic tab with no icon set', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'] }]);
    expect(resolveTabIcon('Test Dynamic Tab')).toBe(DEFAULT_TAB_ICON);
  });

  it('resolves a dynamic tab to its chosen ICON_OPTIONS icon', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'], icon: 'rocket' }]);
    const rocketOption = ICON_OPTIONS.find((o) => o.key === 'rocket')!;
    expect(resolveTabIcon('Test Dynamic Tab')).toBe(rocketOption.Icon);
  });

  it('falls back to DEFAULT_TAB_ICON for an unrecognized/stale icon key', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'], icon: 'not-a-real-key' }]);
    expect(resolveTabIcon('Test Dynamic Tab')).toBe(DEFAULT_TAB_ICON);
  });

  it('a hardcoded tab name always wins over any dynamic icon registration', () => {
    // registerDynamicTabs itself refuses to register a hardcoded tab name, so
    // this just confirms resolveTabIcon still reads TAB_ICONS first regardless.
    registerDynamicTabs([{ name: 'Hanan', platforms: ['tp'], icon: 'rocket' }]);
    expect(resolveTabIcon('Hanan')).toBe(TAB_ICONS['Hanan']);
  });
});
