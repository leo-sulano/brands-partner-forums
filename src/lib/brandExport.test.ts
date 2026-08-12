import { describe, it, expect } from 'vitest';
import { buildBrandRowsForExport } from './brandExport';
import type { Entry } from '../types/entry';

function makeEntry(data: Record<string, string | null>): Entry {
  return { id: '1', tab: 'Hanan', sheet_row_id: '1', data, updated_at: '', last_edited_by: 'dashboard', last_sync_tag: null };
}

describe('buildBrandRowsForExport', () => {
  it('exports the raw value for an ordinary column', () => {
    const entries = [makeEntry({ Account: 'acct1', 'TP Review Status': 'Live' })];
    const rows = buildBrandRowsForExport(entries, ['Account', 'TP Review Status'], 'Hanan');
    expect(rows).toEqual([['acct1', 'Live']]);
  });

  it('exports the real URL for a link column, not an on-screen label', () => {
    const entries = [makeEntry({ 'AG Review Link': 'https://askgamblers.com/reviews/acme' })];
    const rows = buildBrandRowsForExport(entries, ['AG Review Link'], 'Hanan');
    expect(rows).toEqual([['https://askgamblers.com/reviews/acme']]);
  });

  it('normalizes a date-like value the same way the on-screen table does', () => {
    const entries = [makeEntry({ 'Trust Pilot': '2026-08-05' })];
    const rows = buildBrandRowsForExport(entries, ['Trust Pilot'], 'Hanan');
    expect(rows).toEqual([['05/08/2026']]);
  });

  it('uses the derived Country when the raw Country field is blank', () => {
    const entries = [makeEntry({ Account: '123 | agent1 | Germany', Country: '' })];
    const rows = buildBrandRowsForExport(entries, ['Country'], 'Hanan');
    expect(rows).toEqual([['Germany']]);
  });

  it('uses the raw Country value when present, ignoring the derived fallback', () => {
    const entries = [makeEntry({ Account: '123 | agent1 | Germany', Country: 'France' })];
    const rows = buildBrandRowsForExport(entries, ['Country'], 'Hanan');
    expect(rows).toEqual([['France']]);
  });

  it('exports an empty string for a missing or null value', () => {
    const entries = [makeEntry({ Account: null })];
    const rows = buildBrandRowsForExport(entries, ['Account'], 'Hanan');
    expect(rows).toEqual([['']]);
  });

  it('produces one row per entry, in the given entries order', () => {
    const entries = [makeEntry({ Account: 'first' }), makeEntry({ Account: 'second' })];
    const rows = buildBrandRowsForExport(entries, ['Account'], 'Hanan');
    expect(rows).toEqual([['first'], ['second']]);
  });

  it('uses the resolver value when it returns non-null for a header', () => {
    const entries = [makeEntry({ Account: 'acct1' })];
    const resolver = (_entry: Entry, header: string) => (header === 'TP Page Removed Status' ? '05/08/2026' : null);
    const rows = buildBrandRowsForExport(entries, ['Account', 'TP Page Removed Status'], 'Hanan', resolver);
    expect(rows).toEqual([['acct1', '05/08/2026']]);
  });

  it('falls back to entry.data when the resolver returns null for a header', () => {
    const entries = [makeEntry({ Account: 'acct1', 'TP Review Status': 'Live' })];
    const resolver = () => null;
    const rows = buildBrandRowsForExport(entries, ['Account', 'TP Review Status'], 'Hanan', resolver);
    expect(rows).toEqual([['acct1', 'Live']]);
  });

  it('behaves exactly as before when no resolver is passed (regression lock)', () => {
    const entries = [makeEntry({ Account: 'acct1' })];
    const rows = buildBrandRowsForExport(entries, ['Account'], 'Hanan');
    expect(rows).toEqual([['acct1']]);
  });
});
