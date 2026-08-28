import { describe, it, expect, beforeEach } from 'vitest';
import {
  TAB_ICONS, DEFAULT_TAB_ICON, DEFAULT_ICON_NAME, POPULAR_ICON_NAMES, ALL_DYNAMIC_ICON_NAMES,
  isKnownDynamicIconName, resolveTabIconKind, computeInitialIconSelection, faviconUrl,
} from './tabIcons';
import { registerTabIconOverrides, clearTabIconOverride } from './tabIconOverrideRegistry';

describe('faviconUrl', () => {
  it('builds a Google favicon-service URL for the given domain', () => {
    expect(faviconUrl('trybet.com')).toBe('https://www.google.com/s2/favicons?domain=trybet.com&sz=32');
  });

  it('accepts a custom size', () => {
    expect(faviconUrl('trybet.com', 16)).toBe('https://www.google.com/s2/favicons?domain=trybet.com&sz=16');
  });

  it('encodes the domain', () => {
    expect(faviconUrl('tr y bet.com')).toBe('https://www.google.com/s2/favicons?domain=tr%20y%20bet.com&sz=32');
  });
});

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
    clearTabIconOverride('Hanan');
    clearTabIconOverride('Test Dynamic Tab');
  });

  it('resolves a hardcoded tab with no override to its TAB_ICONS entry', () => {
    expect(resolveTabIconKind('Hanan')).toEqual({ kind: 'static', Icon: TAB_ICONS['Hanan'] });
  });

  it('falls back to DEFAULT_TAB_ICON for an unrecognized tab with no override', () => {
    expect(resolveTabIconKind('Test Dynamic Tab')).toEqual({ kind: 'static', Icon: DEFAULT_TAB_ICON });
  });

  it('resolves a lucide-icon override', () => {
    registerTabIconOverrides([{ tab: 'Test Dynamic Tab', icon: 'rocket', faviconDomain: null, imageUrl: null }]);
    expect(resolveTabIconKind('Test Dynamic Tab')).toEqual({ kind: 'dynamic', name: 'rocket' });
  });

  it('falls back to DEFAULT_TAB_ICON for an unrecognized/stale icon name', () => {
    registerTabIconOverrides([{ tab: 'Test Dynamic Tab', icon: 'not-a-real-icon-name', faviconDomain: null, imageUrl: null }]);
    expect(resolveTabIconKind('Test Dynamic Tab')).toEqual({ kind: 'static', Icon: DEFAULT_TAB_ICON });
  });

  it('resolves a favicon override', () => {
    registerTabIconOverrides([{ tab: 'Test Dynamic Tab', icon: null, faviconDomain: 'trybet.com', imageUrl: null }]);
    expect(resolveTabIconKind('Test Dynamic Tab')).toEqual({ kind: 'favicon', domain: 'trybet.com' });
  });

  it('resolves an image override', () => {
    registerTabIconOverrides([{ tab: 'Test Dynamic Tab', icon: null, faviconDomain: null, imageUrl: 'https://x/icon.webp' }]);
    expect(resolveTabIconKind('Test Dynamic Tab')).toEqual({ kind: 'image', url: 'https://x/icon.webp' });
  });

  it('priority order when multiple override fields are set: image > favicon > icon', () => {
    registerTabIconOverrides([{
      tab: 'Test Dynamic Tab', icon: 'rocket', faviconDomain: 'trybet.com', imageUrl: 'https://x/icon.webp',
    }]);
    expect(resolveTabIconKind('Test Dynamic Tab')).toEqual({ kind: 'image', url: 'https://x/icon.webp' });
  });

  it('an override wins over a hardcoded tab\'s own TAB_ICONS default', () => {
    registerTabIconOverrides([{ tab: 'Hanan', icon: 'rocket', faviconDomain: null, imageUrl: null }]);
    expect(resolveTabIconKind('Hanan')).toEqual({ kind: 'dynamic', name: 'rocket' });
  });
});

describe('computeInitialIconSelection', () => {
  beforeEach(() => {
    clearTabIconOverride('Hanan');
    clearTabIconOverride('Test Dynamic Tab');
  });

  it('defaults to the icon-search mode with DEFAULT_ICON_NAME when there is no override', () => {
    expect(computeInitialIconSelection('Hanan')).toEqual({ type: 'icon', value: DEFAULT_ICON_NAME });
  });

  it('reflects an existing icon override', () => {
    registerTabIconOverrides([{ tab: 'Test Dynamic Tab', icon: 'rocket', faviconDomain: null, imageUrl: null }]);
    expect(computeInitialIconSelection('Test Dynamic Tab')).toEqual({ type: 'icon', value: 'rocket' });
  });

  it('reflects an existing favicon override', () => {
    registerTabIconOverrides([{ tab: 'Test Dynamic Tab', icon: null, faviconDomain: 'trybet.com', imageUrl: null }]);
    expect(computeInitialIconSelection('Test Dynamic Tab')).toEqual({ type: 'favicon', value: 'trybet.com' });
  });

  it('reflects an existing image override', () => {
    registerTabIconOverrides([{ tab: 'Test Dynamic Tab', icon: null, faviconDomain: null, imageUrl: 'https://x/icon.webp' }]);
    expect(computeInitialIconSelection('Test Dynamic Tab')).toEqual({ type: 'image', value: 'https://x/icon.webp' });
  });
});
