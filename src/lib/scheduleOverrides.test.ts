import { describe, it, expect } from 'vitest';
import { overrideKey, buildOverrideMap } from './scheduleOverrides';

describe('overrideKey', () => {
  it('combines tab, brand_key, and platform', () => {
    expect(overrideKey('BITP', 'winmega', 'tp')).toBe('BITP::winmega::tp');
  });
});

describe('buildOverrideMap', () => {
  it('maps each row to its full details, keyed by brand_key (not raw brand)', () => {
    const map = buildOverrideMap([
      { tab: 'BITP', brand_key: 'winmega', platform: 'tp', override_state: 'pause', reason: 'Client requested a break', resume_at: '2026-09-30', set_by: 'leo@optinetsolutions.com' },
      { tab: 'Hanan', brand_key: 'pribet.com', platform: 'ag', override_state: 'active', reason: null, resume_at: null, set_by: null },
    ]);
    expect(map.get(overrideKey('BITP', 'winmega', 'tp'))).toEqual({
      state: 'pause', reason: 'Client requested a break', resumeAt: '2026-09-30', setBy: 'leo@optinetsolutions.com',
    });
    expect(map.get(overrideKey('Hanan', 'pribet.com', 'ag'))).toEqual({
      state: 'active', reason: null, resumeAt: null, setBy: null,
    });
    expect(map.size).toBe(2);
  });

  it('defaults reason/resume_at/set_by to null when the row omits them (a null/blank set_by is never coerced to an empty string)', () => {
    const map = buildOverrideMap([
      { tab: 'BITP', brand_key: 'rocketspin', platform: 'ag', override_state: 'pause', reason: null, resume_at: null, set_by: '' },
    ]);
    expect(map.get(overrideKey('BITP', 'rocketspin', 'ag'))).toEqual({
      state: 'pause', reason: null, resumeAt: null, setBy: '',
    });
  });
});
