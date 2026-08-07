import { describe, it, expect } from 'vitest';
import { canonicalCountryKey, canonicalCountryName, countryFlagImageUrl } from './countryFlags';

describe('canonicalCountryKey', () => {
  it('resolves a full country name to its ISO2 code', () => {
    expect(canonicalCountryKey('Germany')).toBe('DE');
    expect(canonicalCountryKey('France')).toBe('FR');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(canonicalCountryKey('germany')).toBe('DE');
    expect(canonicalCountryKey('  Germany  ')).toBe('DE');
  });

  it('merges every alias of the same real country onto one key (the UK/United Kingdom bug)', () => {
    expect(canonicalCountryKey('UK')).toBe('GB');
    expect(canonicalCountryKey('United Kingdom')).toBe('GB');
    expect(canonicalCountryKey('England')).toBe('GB');
    expect(canonicalCountryKey('Great Britain')).toBe('GB');
  });

  it('merges USA aliases onto one key', () => {
    expect(canonicalCountryKey('USA')).toBe('US');
    expect(canonicalCountryKey('United States')).toBe('US');
    expect(canonicalCountryKey('United States of America')).toBe('US');
  });

  it('falls back to the trimmed/lowercased raw text for an unrecognized value, still self-consistent', () => {
    expect(canonicalCountryKey('Not A Real Country')).toBe('not a real country');
    expect(canonicalCountryKey('  Not A Real Country  ')).toBe('not a real country');
  });
});

describe('canonicalCountryName', () => {
  it('returns the canonical full name for any recognized alias', () => {
    expect(canonicalCountryName('UK')).toBe('United Kingdom');
    expect(canonicalCountryName('England')).toBe('United Kingdom');
    expect(canonicalCountryName('United Kingdom')).toBe('United Kingdom');
    expect(canonicalCountryName('USA')).toBe('United States');
  });

  it('title-cases correctly, keeping "and"/"of"/"the" lowercase mid-name', () => {
    expect(canonicalCountryName('bosnia')).toBe('Bosnia and Herzegovina');
    expect(canonicalCountryName('democratic republic of the congo')).toBe('Democratic Republic of the Congo');
    expect(canonicalCountryName('trinidad and tobago')).toBe('Trinidad and Tobago');
  });

  it('falls back to the raw trimmed value for an unrecognized country', () => {
    expect(canonicalCountryName('  Neverland  ')).toBe('Neverland');
  });
});

describe('countryFlagImageUrl', () => {
  it('returns a flagcdn.com SVG URL keyed by the canonical ISO2 code for any recognized alias', () => {
    expect(countryFlagImageUrl('Germany')).toBe('https://flagcdn.com/de.svg');
    expect(countryFlagImageUrl('UK')).toBe('https://flagcdn.com/gb.svg');
    expect(countryFlagImageUrl('United Kingdom')).toBe('https://flagcdn.com/gb.svg');
  });

  it('returns null for an unrecognized value', () => {
    expect(countryFlagImageUrl('Not A Real Country')).toBeNull();
    expect(countryFlagImageUrl('')).toBeNull();
  });
});
