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

  // 2026-08-14: a brief version of this guardrail accepted "No Review"/"On
  // Pause" as status sentinels after a live-data audit found them on
  // thousands of rows. The user explicitly reversed that: these columns must
  // hold a real date or nothing, so both are rejected like any other text —
  // the live values were cleared to null rather than kept as an exception
  // (see scripts/clear-nondates.mjs).
  it('rejects the former "No Review"/"On Pause" status sentinels — dates only now', () => {
    expect(isValidDateText('No Review')).toBe(false);
    expect(isValidDateText('ON PAUSE')).toBe(false);
    expect(isValidDateText('ON PAUSE as from 10/16/2025')).toBe(false);
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
