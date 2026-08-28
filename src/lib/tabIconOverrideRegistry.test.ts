import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerTabIconOverrides, clearTabIconOverride, renameTabIconOverride, getTabIconOverride,
} from './tabIconOverrideRegistry';

describe('tabIconOverrideRegistry', () => {
  beforeEach(() => {
    clearTabIconOverride('Hanan');
    clearTabIconOverride('Test Dynamic Tab');
    clearTabIconOverride('Renamed Dynamic Tab');
  });

  it('is null before registration', () => {
    expect(getTabIconOverride('Hanan')).toBeNull();
  });

  it('applies to a hardcoded tab name, not just a dynamic one', () => {
    registerTabIconOverrides([{ tab: 'Hanan', icon: 'rocket', faviconDomain: null, imageUrl: null }]);
    expect(getTabIconOverride('Hanan')).toEqual({ icon: 'rocket', faviconDomain: null, imageUrl: null });
  });

  it('registers a favicon override', () => {
    registerTabIconOverrides([{ tab: 'Test Dynamic Tab', icon: null, faviconDomain: 'trybet.com', imageUrl: null }]);
    expect(getTabIconOverride('Test Dynamic Tab')).toEqual({ icon: null, faviconDomain: 'trybet.com', imageUrl: null });
  });

  it('registers an image override', () => {
    registerTabIconOverrides([{ tab: 'Test Dynamic Tab', icon: null, faviconDomain: null, imageUrl: 'https://x/icon.webp' }]);
    expect(getTabIconOverride('Test Dynamic Tab')).toEqual({ icon: null, faviconDomain: null, imageUrl: 'https://x/icon.webp' });
  });

  it('a row with all three fields null/falsy is treated as no override', () => {
    registerTabIconOverrides([{ tab: 'Test Dynamic Tab', icon: 'rocket', faviconDomain: null, imageUrl: null }]);
    registerTabIconOverrides([{ tab: 'Test Dynamic Tab', icon: null, faviconDomain: null, imageUrl: null }]);
    expect(getTabIconOverride('Test Dynamic Tab')).toBeNull();
  });

  it('clearTabIconOverride removes a registered override', () => {
    registerTabIconOverrides([{ tab: 'Test Dynamic Tab', icon: 'rocket', faviconDomain: null, imageUrl: null }]);
    clearTabIconOverride('Test Dynamic Tab');
    expect(getTabIconOverride('Test Dynamic Tab')).toBeNull();
  });

  it('renameTabIconOverride carries the override over to the new name', () => {
    registerTabIconOverrides([{ tab: 'Test Dynamic Tab', icon: 'rocket', faviconDomain: null, imageUrl: null }]);
    renameTabIconOverride('Test Dynamic Tab', 'Renamed Dynamic Tab');
    expect(getTabIconOverride('Test Dynamic Tab')).toBeNull();
    expect(getTabIconOverride('Renamed Dynamic Tab')).toEqual({ icon: 'rocket', faviconDomain: null, imageUrl: null });
  });

  it('renameTabIconOverride is a no-op when the old name had no override', () => {
    renameTabIconOverride('Test Dynamic Tab', 'Renamed Dynamic Tab');
    expect(getTabIconOverride('Renamed Dynamic Tab')).toBeNull();
  });
});
