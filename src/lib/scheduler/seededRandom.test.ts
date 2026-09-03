import { describe, it, expect } from 'vitest';
import { makeRng, shuffle, pickIndex } from './seededRandom';

describe('makeRng', () => {
  it('reproduces the exact same draw sequence for the same seed', () => {
    const a = makeRng('Rooster Partners::2026-09-07');
    const b = makeRng('Rooster Partners::2026-09-07');
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('produces a different sequence for a different seed', () => {
    const a = makeRng('Rooster Partners::2026-09-07');
    const b = makeRng('Rooster Partners::2026-09-14');
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).not.toEqual(seqB);
  });

  it('returns floats in [0, 1)', () => {
    const rng = makeRng('seed');
    for (let i = 0; i < 500; i++) {
      const n = rng();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });

  it('is roughly uniform across 5 buckets over many draws', () => {
    const rng = makeRng('distribution-check');
    const counts = [0, 0, 0, 0, 0];
    const draws = 50000;
    for (let i = 0; i < draws; i++) counts[Math.floor(rng() * 5)] += 1;
    for (const c of counts) {
      // each bucket should be near draws/5 (10000); allow a generous band.
      expect(c).toBeGreaterThan(draws / 5 - 800);
      expect(c).toBeLessThan(draws / 5 + 800);
    }
  });
});

describe('shuffle', () => {
  it('returns a permutation of the input (same multiset)', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'];
    const out = shuffle(input, makeRng('x'));
    expect([...out].sort()).toEqual([...input].sort());
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c', 'd'];
    const copy = [...input];
    shuffle(input, makeRng('x'));
    expect(input).toEqual(copy);
  });

  it('is deterministic for a fixed seed', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffle(input, makeRng('same'));
    const b = shuffle(input, makeRng('same'));
    expect(a).toEqual(b);
  });

  it('actually reorders for at least some seeds', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const reordered = ['s1', 's2', 's3', 's4', 's5'].some(
      (s) => JSON.stringify(shuffle(input, makeRng(s))) !== JSON.stringify(input),
    );
    expect(reordered).toBe(true);
  });
});

describe('pickIndex', () => {
  it('always returns an in-range index', () => {
    const rng = makeRng('pick');
    for (let i = 0; i < 200; i++) {
      const idx = pickIndex(4, rng);
      expect(Number.isInteger(idx)).toBe(true);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(4);
    }
  });

  it('returns 0 for a length of 1', () => {
    expect(pickIndex(1, makeRng('one'))).toBe(0);
  });
});
