import { describe, it, expect } from 'vitest';
import { readArrayParam, writeArrayParam, toArrayFilter } from './filterParams';

describe('readArrayParam', () => {
  it('returns [] when the param is absent', () => {
    expect(readArrayParam(new URLSearchParams(''), 'platform')).toEqual([]);
  });
  it('reads a bare single value as a one-item array (legacy URL migration)', () => {
    expect(readArrayParam(new URLSearchParams('platform=tp'), 'platform')).toEqual(['tp']);
  });
  it('splits a comma-separated value into multiple items', () => {
    expect(readArrayParam(new URLSearchParams('platform=tp,ag'), 'platform')).toEqual(['tp', 'ag']);
  });
  it('drops empty segments from a trailing/leading comma', () => {
    expect(readArrayParam(new URLSearchParams('platform=tp,,ag,'), 'platform')).toEqual(['tp', 'ag']);
  });
});

describe('writeArrayParam', () => {
  it('deletes the key when values is empty', () => {
    const next = new URLSearchParams('platform=tp');
    writeArrayParam(next, 'platform', []);
    expect(next.has('platform')).toBe(false);
  });
  it('sets a single value with no comma', () => {
    const next = new URLSearchParams('');
    writeArrayParam(next, 'platform', ['tp']);
    expect(next.get('platform')).toBe('tp');
  });
  it('joins multiple values with a comma', () => {
    const next = new URLSearchParams('');
    writeArrayParam(next, 'platform', ['tp', 'ag']);
    expect(next.get('platform')).toBe('tp,ag');
  });
});

describe('toArrayFilter', () => {
  it('wraps a truthy legacy string into a one-item array', () => {
    expect(toArrayFilter('tp')).toEqual(['tp']);
  });
  it('returns [] for an empty legacy string', () => {
    expect(toArrayFilter('')).toEqual([]);
  });
  it('returns [] for undefined/null', () => {
    expect(toArrayFilter(undefined)).toEqual([]);
    expect(toArrayFilter(null)).toEqual([]);
  });
  it('passes an already-array value through unchanged', () => {
    expect(toArrayFilter(['tp', 'ag'])).toEqual(['tp', 'ag']);
  });
});
