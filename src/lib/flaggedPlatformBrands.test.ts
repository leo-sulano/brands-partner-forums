import { describe, it, expect } from 'vitest';
import { platformFlaggedKey, buildFlaggedPlatformBrandSet } from './flaggedPlatformBrands';

describe('platformFlaggedKey', () => {
  it('normalizes brand casing/whitespace but keeps tab and platform exact', () => {
    expect(platformFlaggedKey('BITP', '  WinMega  ', 'tp')).toBe(platformFlaggedKey('BITP', 'winmega', 'tp'));
    expect(platformFlaggedKey('BITP', 'WinMega', 'tp')).not.toBe(platformFlaggedKey('BITP', 'WinMega', 'ag'));
  });
});

describe('buildFlaggedPlatformBrandSet', () => {
  it('builds one key per row', () => {
    const set = buildFlaggedPlatformBrandSet([
      { tab: 'BITP', brand: 'WinMega', platform: 'tp' },
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'ag' },
    ]);
    expect(set.has(platformFlaggedKey('BITP', 'WinMega', 'tp'))).toBe(true);
    expect(set.has(platformFlaggedKey('Hanan', 'Pribet.com', 'ag'))).toBe(true);
    expect(set.size).toBe(2);
  });
});
