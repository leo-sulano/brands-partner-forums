import { describe, it, expect } from 'vitest';
import { platformRemovedKey, buildRemovedPlatformBrandSet } from './removedPlatformBrands';

describe('platformRemovedKey', () => {
  it('matches regardless of brand casing or surrounding whitespace', () => {
    expect(platformRemovedKey('Hanan', 'Pribet.com', 'tp')).toBe(platformRemovedKey('Hanan', '  PRIBET.COM  ', 'tp'));
  });

  it('treats the same brand name in different tabs as distinct', () => {
    expect(platformRemovedKey('Hanan', 'Pribet.com', 'tp')).not.toBe(platformRemovedKey('Trybet', 'Pribet.com', 'tp'));
  });

  it('treats the same (tab, brand) on different platforms as distinct', () => {
    expect(platformRemovedKey('Hanan', 'Pribet.com', 'tp')).not.toBe(platformRemovedKey('Hanan', 'Pribet.com', 'ag'));
  });
});

describe('buildRemovedPlatformBrandSet', () => {
  it('builds a set whose membership matches via platformRemovedKey regardless of casing', () => {
    const set = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    expect(set.has(platformRemovedKey('Hanan', 'pribet.com', 'tp'))).toBe(true);
    expect(set.has(platformRemovedKey('Hanan', 'WinMega.com', 'tp'))).toBe(false);
  });

  it('does not match the same brand flagged on a different platform', () => {
    const set = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    expect(set.has(platformRemovedKey('Hanan', 'Pribet.com', 'ag'))).toBe(false);
  });
});
