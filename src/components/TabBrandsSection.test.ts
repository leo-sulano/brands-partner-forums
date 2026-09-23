import { describe, it, expect } from 'vitest';
import { filterBrandKeys, dedupeBrands, rowIsDirty, resolveSaveAction, mergeRows, makeRowsUpdater, type RowState } from './TabBrandsSection';

describe('dedupeBrands', () => {
  it('trims whitespace-suffixed brand names', () => {
    expect(dedupeBrands(['Cazimbo Casino ', 'Rabona Casino '])).toEqual(['Cazimbo Casino', 'Rabona Casino']);
  });

  it('collapses duplicates that only differ by case/whitespace, keeping first-seen casing', () => {
    expect(dedupeBrands(['Librabet', 'librabet ', 'LIBRABET', 'Librabet Casino'])).toEqual(['Librabet', 'Librabet Casino']);
  });

  it('drops blank entries', () => {
    expect(dedupeBrands(['  ', 'Real Brand'])).toEqual(['Real Brand']);
  });
});

describe('rowIsDirty', () => {
  const base: RowState = { name: 'Cazimbo Casino', links: { tp: 'https://tp/x' } };

  it('a trailing-space brand is not dirty on load (base name is already trimmed)', () => {
    // Row state as constructed at load time: name/links identical to base.
    const row: RowState = { name: 'Cazimbo Casino', links: { tp: 'https://tp/x' } };
    expect(rowIsDirty(row, base, ['tp'])).toBe(false);
  });

  it('is dirty when the name actually changes', () => {
    const row: RowState = { name: 'Cazimbo Casino Renamed', links: { tp: 'https://tp/x' } };
    expect(rowIsDirty(row, base, ['tp'])).toBe(true);
  });

  it('is dirty when a link actually changes', () => {
    const row: RowState = { name: 'Cazimbo Casino', links: { tp: 'https://tp/new' } };
    expect(rowIsDirty(row, base, ['tp'])).toBe(true);
  });

  it('ignores whitespace-only link differences', () => {
    const row: RowState = { name: 'Cazimbo Casino', links: { tp: '  https://tp/x  ' } };
    expect(rowIsDirty(row, base, ['tp'])).toBe(false);
  });
});

describe('resolveSaveAction', () => {
  it('routes a link-only edit on a trailing-space brand to links, not rename', () => {
    // brandKey is the trimmed canonical key; liveName is the (untouched)
    // input value, which for a load-time row equals the trimmed key too.
    const action = resolveSaveAction('Cazimbo Casino', 'Cazimbo Casino', { tp: 'https://new' });
    expect(action).toEqual({ kind: 'links', links: { tp: 'https://new' } });
  });

  it('routes an actual name change to rename', () => {
    const action = resolveSaveAction('Cazimbo Casino', 'Cazimbo Casino Renamed', {});
    expect(action).toEqual({ kind: 'rename', newName: 'Cazimbo Casino Renamed' });
  });

  it('rejects a blanked-out name before considering it a rename', () => {
    expect(resolveSaveAction('Cazimbo Casino', '   ', {})).toEqual({ kind: 'empty-name' });
  });

  it('does not treat re-adding the trimmed key spelling as a rename', () => {
    // Typing trailing space back in and saving should not read as "renamed".
    const action = resolveSaveAction('Cazimbo Casino', 'Cazimbo Casino ', { tp: 'https://x' });
    expect(action).toEqual({ kind: 'links', links: { tp: 'https://x' } });
  });
});

describe('mergeRows', () => {
  const platforms: ('tp')[] = ['tp'];

  it('keeps a row dirty relative to its own previous initial, even if nextInitial changed too', () => {
    const prevInitial = { Librabet: { name: 'Librabet', links: { tp: 'https://old' } } };
    const currentRows = { Librabet: { name: 'Librabet', links: { tp: 'https://user-is-typing' } } };
    const nextInitial = { Librabet: { name: 'Librabet', links: { tp: 'https://realtime-update' } } };
    const merged = mergeRows(currentRows, prevInitial, nextInitial, platforms);
    expect(merged.Librabet.links.tp).toBe('https://user-is-typing');
  });

  it('takes the fresh value for a row with no in-progress edits', () => {
    const prevInitial = { Librabet: { name: 'Librabet', links: { tp: 'https://old' } } };
    const currentRows = { Librabet: { name: 'Librabet', links: { tp: 'https://old' } } };
    const nextInitial = { Librabet: { name: 'Librabet', links: { tp: 'https://realtime-update' } } };
    const merged = mergeRows(currentRows, prevInitial, nextInitial, platforms);
    expect(merged.Librabet.links.tp).toBe('https://realtime-update');
  });

  it('adds a brand-new brand straight from nextInitial', () => {
    const merged = mergeRows({}, {}, { 'New Brand': { name: 'New Brand', links: {} } }, platforms);
    expect(merged['New Brand']).toEqual({ name: 'New Brand', links: {} });
  });

  it('drops a brand no longer present in nextInitial', () => {
    const prevInitial = { Gone: { name: 'Gone', links: {} } };
    const currentRows = { Gone: { name: 'Gone', links: {} } };
    const merged = mergeRows(currentRows, prevInitial, {}, platforms);
    expect(merged).toEqual({});
  });
});

// Exercises the actual effect wiring (fix rounds 2 & 3), not just mergeRows
// in isolation -- the bug this guards against wasn't in mergeRows itself, it
// was in HOW the component fed it "what changed since last time" and HOW it
// packaged that into the setRows updater:
//   - round 1: a plain ref written synchronously right next to a
//     setRows(updater) call, where the updater (and therefore the ref read
//     inside it) only actually runs later -- after that synchronous write
//     had already replaced the ref's old value, so prevInitial ended up
//     always equal to nextInitial.
//   - round 2's fix bundled the merge and the "previous initial" bookkeeping
//     into one closure call (correct order), but MUTATED that closure state
//     from inside the function handed to setRows -- and a setState updater
//     must be pure, since React can call it more than once (this repo's
//     src/main.tsx renders in StrictMode; React 19 dev double-invokes an
//     updater on the non-eager path and discards the first call's result).
//     The first (discarded) call advanced the mutable state, so the second
//     (kept) call saw prevInitial === nextInitial again -- the same bug,
//     reachable in production too on any replayed render.
// makeRowsUpdater has no mutable state: prevInitial/nextInitial are fixed
// arguments for the life of the returned function, so calling it any number
// of times with the same `current` is required to return an equal result
// (tested directly below) -- and the component now advances "what's
// previous now" itself, synchronously, BEFORE calling setRows.
describe('makeRowsUpdater', () => {
  const platforms: ('tp')[] = ['tp'];
  const gen = (tp: string) => ({ Librabet: { name: 'Librabet', links: { tp } } });

  it('is idempotent: the same updater called twice with the same current gives a clean row the new value and a dirty row its edit, both times', () => {
    const updater = makeRowsUpdater(gen('https://v1'), gen('https://v2'), platforms);

    // Clean row: current still matches prevInitial (user never touched it).
    const cleanCurrent = gen('https://v1');
    const cleanCall1 = updater(cleanCurrent);
    const cleanCall2 = updater(cleanCurrent);
    expect(cleanCall1).toEqual(cleanCall2);
    expect(cleanCall1.Librabet.links.tp).toBe('https://v2');

    // Dirty row: current diverges from prevInitial (user is mid-edit).
    const dirtyCurrent = { Librabet: { name: 'Librabet', links: { tp: 'https://user-typing' } } };
    const dirtyCall1 = updater(dirtyCurrent);
    const dirtyCall2 = updater(dirtyCurrent);
    expect(dirtyCall1).toEqual(dirtyCall2);
    expect(dirtyCall1.Librabet.links.tp).toBe('https://user-typing');
  });

  it('chains across successive transitions applied in order (i0 -> i1, then i1 -> i2)', () => {
    const i0 = gen('https://v1');
    const i1 = gen('https://v2');
    const i2 = gen('https://v3');

    // Mount: rows seeded directly from initial, same as the component's useState(initial).
    let rows = makeRowsUpdater({}, i0, platforms)(i0);
    rows = makeRowsUpdater(i0, i1, platforms)(rows);
    rows = makeRowsUpdater(i1, i2, platforms)(rows);
    expect(rows.Librabet.links.tp).toBe('https://v3');
  });
});

describe('filterBrandKeys', () => {
  const keys = ['Librabet', 'Librabet Casino', 'Alf Casino'];
  it('returns all keys for a blank query', () => {
    expect(filterBrandKeys(keys, '  ')).toEqual(keys);
  });
  it('matches case-insensitive substrings', () => {
    expect(filterBrandKeys(keys, 'CASINO')).toEqual(['Librabet Casino', 'Alf Casino']);
    expect(filterBrandKeys(keys, ' libra ')).toEqual(['Librabet', 'Librabet Casino']);
  });
});
