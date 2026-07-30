import { describe, it, expect } from 'vitest';
import { TAB_COLUMN_CONFIGS, getEntryCountry, getCountryForAccount, getBrandGroup } from './tab-configs';

describe('TAB_COLUMN_CONFIGS', () => {
  it('places Country immediately after Account in every tab', () => {
    for (const [tab, cols] of Object.entries(TAB_COLUMN_CONFIGS)) {
      const accountIdx = cols.indexOf('Account');
      expect(accountIdx, `${tab} has no Account column`).toBeGreaterThanOrEqual(0);
      expect(cols[accountIdx + 1], `${tab}: Country should immediately follow Account`).toBe('Country');
    }
  });
});

describe('getEntryCountry', () => {
  it('returns the real synced Country value when present', () => {
    const data = { Account: '071 | Test | New Zealand', Country: 'New Zealand' };
    expect(getEntryCountry(data, 'Rooster Partners')).toBe('New Zealand');
  });

  it('derives Country from a pipe-delimited Account when the sheet has no Country column', () => {
    const data = { Account: '1182 | Test | Norway', Country: null };
    expect(getEntryCountry(data, 'Wizard of Odds')).toBe('Norway');
  });

  it('derives Country from an "l"-delimited Account (Hanan-sourced Wizard of Odds rows)', () => {
    const data = { Account: '550 l Hanan l Australia', Country: null };
    expect(getEntryCountry(data, 'Wizard of Odds')).toBe('Australia');
  });

  it('falls back to the per-tab default when Account has no parseable country', () => {
    const data = { Account: '001 - UK Reviews', Country: null };
    expect(getEntryCountry(data, 'SuprPlay Limited')).toBe('UK');
  });

  it('returns empty string when there is no real value, no parseable Account, and no tab default', () => {
    const data = { Account: '001 - UK Reviews', Country: null };
    expect(getEntryCountry(data, 'Trybet')).toBe('');
  });

  it('strips a trailing " dup" suffix (added by Duplicate Account) before parsing Account', () => {
    const data = { Account: '550 l Hanan l Australia dup', Country: null };
    expect(getEntryCountry(data, 'Wizard of Odds')).toBe('Australia');
  });

  it('strips repeated " dup" suffixes from duplicating an already-duplicated row', () => {
    const data = { Account: '1182 | Test | Norway dup dup', Country: null };
    expect(getEntryCountry(data, 'Wizard of Odds')).toBe('Norway');
  });
});

describe('getCountryForAccount', () => {
  it('derives Country from a pipe-delimited Account', () => {
    expect(getCountryForAccount('1303 | Test | Germany', 'Wizard of Odds')).toBe('Germany');
  });

  it('derives Country from an "l"-delimited Account', () => {
    expect(getCountryForAccount('550 l Hanan l Australia', 'Wizard of Odds')).toBe('Australia');
  });

  it('strips a trailing " dup" suffix before deriving', () => {
    expect(getCountryForAccount('1303 | Test | Germany dup', 'Wizard of Odds')).toBe('Germany');
  });

  it('falls back to the per-tab default when Account has no parseable country', () => {
    expect(getCountryForAccount('001 - UK Reviews', 'SuprPlay Limited')).toBe('UK');
  });

  it('returns empty string when unparseable and there is no tab default', () => {
    expect(getCountryForAccount('001 - UK Reviews', 'Trybet')).toBe('');
  });

  it('returns empty string for a null/empty Account', () => {
    expect(getCountryForAccount(null, 'Wizard of Odds')).toBe('');
    expect(getCountryForAccount('', 'SuprPlay Limited')).toBe('UK');
  });
});

describe('getBrandGroup', () => {
  it('returns null for a tab with no configured groups at all', () => {
    expect(getBrandGroup('TP Affiliate', 'Aussie Online Pokies')).toBeNull();
    expect(getBrandGroup('Rooster Partners', 'Best Online Casino in Canada 2026 | Top Rated Online Casinos')).toBeNull();
  });
});
