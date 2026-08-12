import { describe, it, expect } from 'vitest';
import { platformRemovedKey, buildRemovedPlatformBrandSet, buildRemovedPlatformBrandDateMap } from './removedPlatformBrands';

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

describe('buildRemovedPlatformBrandDateMap', () => {
  it('maps a flagged (tab, brand, platform) to its removed_at value', () => {
    const map = buildRemovedPlatformBrandDateMap([
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp', removed_at: '2026-08-05T10:00:00.000Z' },
    ]);
    expect(map.get(platformRemovedKey('Hanan', 'pribet.com', 'tp'))).toBe('2026-08-05T10:00:00.000Z');
  });

  it('returns undefined for a key with no matching row', () => {
    const map = buildRemovedPlatformBrandDateMap([]);
    expect(map.get(platformRemovedKey('Hanan', 'Pribet.com', 'tp'))).toBeUndefined();
  });

  it('keeps distinct dates for the same brand flagged on two different platforms', () => {
    const map = buildRemovedPlatformBrandDateMap([
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp', removed_at: '2026-08-05T10:00:00.000Z' },
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'ag', removed_at: '2026-08-06T10:00:00.000Z' },
    ]);
    expect(map.get(platformRemovedKey('Hanan', 'Pribet.com', 'tp'))).toBe('2026-08-05T10:00:00.000Z');
    expect(map.get(platformRemovedKey('Hanan', 'Pribet.com', 'ag'))).toBe('2026-08-06T10:00:00.000Z');
  });
});
