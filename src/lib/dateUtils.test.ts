import { describe, it, expect } from 'vitest';
import { isValidDateText, DATE_ENTRY_HEADERS } from './dateUtils';

describe('isValidDateText', () => {
  it('accepts empty/blank values — these fields are optional', () => {
    expect(isValidDateText('')).toBe(true);
    expect(isValidDateText('   ')).toBe(true);
  });

  it('accepts DD/MM/YYYY, including single-digit day/month', () => {
    expect(isValidDateText('05/01/2026')).toBe(true);
    expect(isValidDateText('5/1/2026')).toBe(true);
    expect(isValidDateText('31/12/2025')).toBe(true);
  });

  it('accepts YYYY-MM-DD', () => {
    expect(isValidDateText('2026-01-05')).toBe(true);
    expect(isValidDateText('2025-12-31')).toBe(true);
  });

  it('tolerates leading/trailing whitespace around an otherwise valid date', () => {
    expect(isValidDateText('  05/01/2026  ')).toBe(true);
  });

  it('rejects calendar-invalid dates rather than letting them roll over', () => {
    expect(isValidDateText('31/02/2026')).toBe(false); // no Feb 31
    expect(isValidDateText('00/01/2026')).toBe(false); // day 0
    expect(isValidDateText('05/13/2026')).toBe(false); // month 13
    expect(isValidDateText('2026-02-30')).toBe(false); // no Feb 30
    expect(isValidDateText('2026-00-05')).toBe(false); // month 0
  });

  it('rejects free text', () => {
    expect(isValidDateText('TBD')).toBe(false);
    expect(isValidDateText('pending')).toBe(false);
    expect(isValidDateText('asap')).toBe(false);
    expect(isValidDateText('N/A')).toBe(false);
    expect(isValidDateText('soon')).toBe(false);
  });

  it('rejects partial or malformed dates', () => {
    expect(isValidDateText('2026')).toBe(false);
    expect(isValidDateText('01/2026')).toBe(false);
    expect(isValidDateText('2026/01/05')).toBe(false);
    expect(isValidDateText('05-01-2026')).toBe(false);
  });

  // Live-data audit (2026-08-14) found these are deliberate status text used
  // thousands of times on real AG/CG/TP Added values, not typos — an earlier
  // version of this guardrail wrongly rejected them.
  it('accepts the "No Review" status sentinel, case-insensitively', () => {
    expect(isValidDateText('No Review')).toBe(true);
    expect(isValidDateText('no review')).toBe(true);
    expect(isValidDateText('NO REVIEW')).toBe(true);
  });

  it('accepts the "On Pause" status sentinel, with or without an "as from" date', () => {
    expect(isValidDateText('ON PAUSE')).toBe(true);
    expect(isValidDateText('on pause')).toBe(true);
    expect(isValidDateText('ON PAUSE as from 10/16/2025')).toBe(true); // M/D/YYYY
    expect(isValidDateText('ON PAUSE as from 08/29/2025')).toBe(true); // M/D/YYYY
    expect(isValidDateText('on pause as from 20/11/2025')).toBe(true); // D/M/YYYY
  });

  it('rejects an "On Pause as from" date that is invalid in both D/M and M/D order', () => {
    expect(isValidDateText('ON PAUSE as from 13/32/2025')).toBe(false);
  });

  it('rejects near-miss text that only superficially resembles the sentinels', () => {
    expect(isValidDateText('No Review Yet')).toBe(false);
    expect(isValidDateText('Paused')).toBe(false);
  });
});

describe('DATE_ENTRY_HEADERS', () => {
  it('covers TP/AG/CG/WO added-date columns plus the removed/not-published date', () => {
    expect(DATE_ENTRY_HEADERS.has('Trust Pilot')).toBe(true);
    expect(DATE_ENTRY_HEADERS.has('Ask Gambler review added')).toBe(true);
    expect(DATE_ENTRY_HEADERS.has('Casino Guru review added')).toBe(true);
    expect(DATE_ENTRY_HEADERS.has('Wizard of Odds')).toBe(true);
    expect(DATE_ENTRY_HEADERS.has('Removed / Not Published / stil published date')).toBe(true);
  });
});
