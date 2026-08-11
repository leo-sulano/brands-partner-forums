import { describe, it, expect } from 'vitest';
import {
  scheduleBrandKey,
  buildHiddenBrandSet,
  buildPlatformRestrictionMap,
  getSchedulableBrandPlatforms,
} from './scheduleBrandConfig';

describe('scheduleBrandKey', () => {
  it('matches regardless of brand casing or surrounding whitespace', () => {
    expect(scheduleBrandKey('Rooster Partners', 'Novadreams')).toBe(scheduleBrandKey('Rooster Partners', '  NOVADREAMS  '));
  });

  it('treats the same brand name in different tabs as distinct', () => {
    expect(scheduleBrandKey('Rooster Partners', 'Novadreams')).not.toBe(scheduleBrandKey('Revolution Casino', 'Novadreams'));
  });
});

describe('buildHiddenBrandSet / getSchedulableBrandPlatforms (hide)', () => {
  it('returns no schedulable platforms for a hidden brand', () => {
    const hiddenSet = buildHiddenBrandSet([{ tab: 'Rooster Partners', brand: 'Novadreams' }]);
    const result = getSchedulableBrandPlatforms(
      'Rooster Partners', 'Novadreams', ['tp', 'ag', 'cg'], hiddenSet, new Map(),
    );
    expect(result).toEqual([]);
  });

  it('matches a hidden brand regardless of casing', () => {
    const hiddenSet = buildHiddenBrandSet([{ tab: 'Rooster Partners', brand: 'Novadreams' }]);
    const result = getSchedulableBrandPlatforms(
      'Rooster Partners', 'NOVADREAMS', ['tp'], hiddenSet, new Map(),
    );
    expect(result).toEqual([]);
  });

  it('does not hide a brand with the same name on a different tab', () => {
    const hiddenSet = buildHiddenBrandSet([{ tab: 'Rooster Partners', brand: 'Novadreams' }]);
    const result = getSchedulableBrandPlatforms(
      'Revolution Casino', 'Novadreams', ['tp'], hiddenSet, new Map(),
    );
    expect(result).toEqual(['tp']);
  });
});

describe('buildPlatformRestrictionMap / getSchedulableBrandPlatforms (restrict)', () => {
  it('narrows a restricted brand down to its single allowed platform', () => {
    const restrictionMap = buildPlatformRestrictionMap([
      { tab: 'Rooster Partners', brand: 'Novadreams2', allowed_platform: 'tp' },
    ]);
    const result = getSchedulableBrandPlatforms(
      'Rooster Partners', 'Novadreams2', ['tp', 'ag', 'cg'], new Set(), restrictionMap,
    );
    expect(result).toEqual(['tp']);
  });

  it('returns no platforms if the allowed platform is not actually active on the tab', () => {
    const restrictionMap = buildPlatformRestrictionMap([
      { tab: 'Revolution Casino', brand: 'God Of Casino', allowed_platform: 'wo' },
    ]);
    const result = getSchedulableBrandPlatforms(
      'Revolution Casino', 'God Of Casino', ['tp', 'ag', 'cg'], new Set(), restrictionMap,
    );
    expect(result).toEqual([]);
  });

  it('leaves an unrestricted, unhidden brand unchanged', () => {
    const result = getSchedulableBrandPlatforms(
      'Rooster Partners', 'Rocketspin', ['tp', 'ag', 'cg'], new Set(), new Map(),
    );
    expect(result).toEqual(['tp', 'ag', 'cg']);
  });

  it('hide takes precedence over a restriction on the same brand', () => {
    const hiddenSet = buildHiddenBrandSet([{ tab: 'X', brand: 'Both' }]);
    const restrictionMap = buildPlatformRestrictionMap([{ tab: 'X', brand: 'Both', allowed_platform: 'tp' }]);
    const result = getSchedulableBrandPlatforms('X', 'Both', ['tp', 'ag'], hiddenSet, restrictionMap);
    expect(result).toEqual([]);
  });
});
