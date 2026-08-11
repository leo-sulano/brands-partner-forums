import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildCsv, buildWorkbook } from './exportFile';

describe('buildCsv', () => {
  it('joins headers and rows with commas and CRLF line endings', () => {
    const csv = buildCsv(['Name', 'Status'], [['Acme', 'Live'], ['Beta', 'Removed']]);
    expect(csv).toBe('Name,Status\r\nAcme,Live\r\nBeta,Removed');
  });

  it('quotes a field containing a comma', () => {
    const csv = buildCsv(['Name'], [['Acme, Inc.']]);
    expect(csv).toBe('Name\r\n"Acme, Inc."');
  });

  it('quotes and doubles an embedded double-quote', () => {
    const csv = buildCsv(['Name'], [['Say "hi"']]);
    expect(csv).toBe('Name\r\n"Say ""hi"""');
  });

  it('quotes a field containing a newline', () => {
    const csv = buildCsv(['Notes'], [['line one\nline two']]);
    expect(csv).toBe('Notes\r\n"line one\nline two"');
  });

  it('leaves a plain field with no special characters unquoted', () => {
    const csv = buildCsv(['Status'], [['Live']]);
    expect(csv).toBe('Status\r\nLive');
  });

  it('produces just the header row when there are no data rows', () => {
    const csv = buildCsv(['A', 'B'], []);
    expect(csv).toBe('A,B');
  });

  it('produces an empty string when there are no headers and no rows', () => {
    const csv = buildCsv([], []);
    expect(csv).toBe('');
  });

  it('prefixes a formula-triggering field with a leading quote and leaves it otherwise unquoted', () => {
    const csv = buildCsv(['Formula'], [['=1+1']]);
    expect(csv).toBe("Formula\r\n'=1+1");
  });

  it('leaves a normal field unaffected by the formula-injection guard', () => {
    const csv = buildCsv(['Status'], [['Live']]);
    expect(csv).toBe('Status\r\nLive');
  });
});

describe('buildWorkbook', () => {
  it('round-trips headers and rows through XLSX.read', () => {
    const buffer = buildWorkbook('Rooster Partners', ['Name', 'Status'], [['Acme', 'Live']]);
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    expect(data).toEqual([['Name', 'Status'], ['Acme', 'Live']]);
  });

  it('truncates and sanitizes a sheet name Excel would otherwise reject', () => {
    const longName = 'A'.repeat(40) + ':bad/chars?';
    const buffer = buildWorkbook(longName, ['A'], [['1']]);
    const wb = XLSX.read(buffer, { type: 'array' });
    expect(wb.SheetNames[0].length).toBeLessThanOrEqual(31);
    expect(wb.SheetNames[0]).not.toMatch(/[:\\/?*[\]]/);
  });

  it('falls back to a default sheet name when sanitizing empties the string', () => {
    const buffer = buildWorkbook('::://///', ['A'], [['1']]);
    const wb = XLSX.read(buffer, { type: 'array' });
    expect(wb.SheetNames[0]).toBe('Sheet1');
  });
});
