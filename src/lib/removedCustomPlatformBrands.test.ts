import { describe, it, expect } from 'vitest';
import {
  customPlatformRemovedKey,
  buildRemovedCustomPlatformBrandSet,
  buildRemovedCustomPlatformBrandDateMap,
} from './removedCustomPlatformBrands';

describe('customPlatformRemovedKey', () => {
  it('joins tab, normalized brand, and platform id', () => {
    expect(customPlatformRemovedKey('BITP', 'Brand X', 'p1')).toBe('BITP::brand x::p1');
  });

  it('normalizes case and whitespace on the brand only', () => {
    expect(customPlatformRemovedKey('BITP', '  Brand X  ', 'p1')).toBe('BITP::brand x::p1');
  });
});

describe('buildRemovedCustomPlatformBrandSet', () => {
  it('builds one key per row', () => {
    const set = buildRemovedCustomPlatformBrandSet([
      { tab: 'BITP', brand: 'Brand X', platform_id: 'p1' },
      { tab: 'Hanan', brand: 'Brand Y', platform_id: 'p2' },
    ]);
    expect(set.has('BITP::brand x::p1')).toBe(true);
    expect(set.has('Hanan::brand y::p2')).toBe(true);
    expect(set.size).toBe(2);
  });
});

describe('buildRemovedCustomPlatformBrandDateMap', () => {
  it('maps each key to its removed_at', () => {
    const map = buildRemovedCustomPlatformBrandDateMap([
      { tab: 'BITP', brand: 'Brand X', platform_id: 'p1', removed_at: '2026-09-05' },
    ]);
    expect(map.get('BITP::brand x::p1')).toBe('2026-09-05');
  });
});
