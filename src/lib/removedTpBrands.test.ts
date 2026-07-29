import { describe, it, expect } from 'vitest';
import { tpRemovedKey, buildRemovedTpBrandSet } from './removedTpBrands';

describe('tpRemovedKey', () => {
  it('matches regardless of brand casing or surrounding whitespace', () => {
    expect(tpRemovedKey('Hanan', 'Pribet.com')).toBe(tpRemovedKey('Hanan', '  PRIBET.COM  '));
  });

  it('treats the same brand name in different tabs as distinct', () => {
    expect(tpRemovedKey('Hanan', 'Pribet.com')).not.toBe(tpRemovedKey('Trybet', 'Pribet.com'));
  });
});

describe('buildRemovedTpBrandSet', () => {
  it('builds a set whose membership matches via tpRemovedKey regardless of casing', () => {
    const set = buildRemovedTpBrandSet([{ tab: 'Hanan', brand: 'Pribet.com' }]);
    expect(set.has(tpRemovedKey('Hanan', 'pribet.com'))).toBe(true);
    expect(set.has(tpRemovedKey('Hanan', 'WinMega.com'))).toBe(false);
  });
});
