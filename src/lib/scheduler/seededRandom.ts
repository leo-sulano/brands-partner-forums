// Tiny, dependency-free deterministic PRNG for the schedule generator.
//
// The engine runs in both the browser and the Deno `generate-weekly-schedule`
// edge function, so this uses only integer arithmetic (Math.imul, >>>) — no
// `crypto`, no platform-specific APIs — and produces byte-identical output in
// both runtimes for a given seed string.
//
// `xmur3` turns the seed string into a 32-bit state; `mulberry32` is a small,
// well-distributed generator over that state. Both are standard public-domain
// snippets.

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Returns a function that yields floats in [0, 1). Same seed -> same sequence.
export function makeRng(seed: string): () => number {
  const seeder = xmur3(seed);
  return mulberry32(seeder());
}

// Uniform integer index in [0, length). `length` is assumed >= 1.
export function pickIndex(length: number, rng: () => number): number {
  return Math.floor(rng() * length);
}

// Fisher-Yates. Returns a new array; does not mutate the input.
export function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = pickIndex(i + 1, rng);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
