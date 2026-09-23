import { describe, it, expect } from 'vitest';
import { dedupeBrands, rowIsDirty, resolveSaveAction, mergeRows, type RowState } from './TabBrandsSection';

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
