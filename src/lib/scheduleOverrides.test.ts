import { describe, it, expect } from 'vitest';
import { overrideKey, buildOverrideMap } from './scheduleOverrides';

describe('overrideKey', () => {
  it('combines tab, brand_key, and platform', () => {
    expect(overrideKey('BITP', 'winmega', 'tp')).toBe('BITP::winmega::tp');
  });
});

describe('buildOverrideMap', () => {
  it('maps each row to its override_state, keyed by brand_key (not raw brand)', () => {
    const map = buildOverrideMap([
      { tab: 'BITP', brand_key: 'winmega', platform: 'tp', override_state: 'pause' },
      { tab: 'Hanan', brand_key: 'pribet.com', platform: 'ag', override_state: 'active' },
    ]);
    expect(map.get(overrideKey('BITP', 'winmega', 'tp'))).toBe('pause');
    expect(map.get(overrideKey('Hanan', 'pribet.com', 'ag'))).toBe('active');
    expect(map.size).toBe(2);
  });
});
