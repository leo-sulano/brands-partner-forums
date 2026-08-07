import { describe, it, expect } from 'vitest';
import { countryFlagEmoji } from './countryFlags';

describe('countryFlagEmoji', () => {
  it('maps a full country name to its flag emoji', () => {
    expect(countryFlagEmoji('Germany')).toBe('🇩🇪');
    expect(countryFlagEmoji('France')).toBe('🇫🇷');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(countryFlagEmoji('germany')).toBe('🇩🇪');
    expect(countryFlagEmoji('  Germany  ')).toBe('🇩🇪');
    expect(countryFlagEmoji('GERMANY')).toBe('🇩🇪');
  });

  it('resolves common aliases seen in this dataset (UK, USA, UAE)', () => {
    expect(countryFlagEmoji('UK')).toBe('🇬🇧');
    expect(countryFlagEmoji('United Kingdom')).toBe('🇬🇧');
    expect(countryFlagEmoji('USA')).toBe('🇺🇸');
    expect(countryFlagEmoji('United States')).toBe('🇺🇸');
    expect(countryFlagEmoji('UAE')).toBe('🇦🇪');
  });

  it('returns null for an unrecognized value, so callers can fall back to a generic icon', () => {
    expect(countryFlagEmoji('Not A Real Country')).toBeNull();
    expect(countryFlagEmoji('')).toBeNull();
  });
});
