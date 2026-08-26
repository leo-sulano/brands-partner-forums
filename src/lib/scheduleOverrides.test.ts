import { describe, it, expect } from 'vitest';
import { overrideKey, buildOverrideMap, buildOverrideSetByMap } from './scheduleOverrides';

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

describe('buildOverrideSetByMap', () => {
  it('maps each row with a real set_by to its actor, keyed the same way as buildOverrideMap', () => {
    const map = buildOverrideSetByMap([
      { tab: 'BITP', brand_key: 'winmega', platform: 'tp', set_by: 'leo@optinetsolutions.com' },
      { tab: 'Hanan', brand_key: 'pribet.com', platform: 'ag', set_by: 'ann@optinetsolutions.com' },
    ]);
    expect(map.get(overrideKey('BITP', 'winmega', 'tp'))).toBe('leo@optinetsolutions.com');
    expect(map.get(overrideKey('Hanan', 'pribet.com', 'ag'))).toBe('ann@optinetsolutions.com');
    expect(map.size).toBe(2);
  });

  it('omits rows with a null/blank set_by rather than storing an empty name', () => {
    const map = buildOverrideSetByMap([
      { tab: 'BITP', brand_key: 'winmega', platform: 'tp', set_by: null },
      { tab: 'BITP', brand_key: 'rocketspin', platform: 'ag', set_by: '' },
    ]);
    expect(map.size).toBe(0);
  });
});
