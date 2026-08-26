import { describe, it, expect } from 'vitest';
import { extractCredentials, mergeCredentialsIntoData } from './entryCredentials';

describe('extractCredentials', () => {
  it('splits a known credential key out of the payload', () => {
    const { credentials, rest } = extractCredentials({ Account: 'acc1', Password: 'hunter2' });
    expect(credentials).toEqual({ password: 'hunter2' });
    expect(rest).toEqual({ Account: 'acc1' });
  });

  it('leaves non-credential fields untouched', () => {
    const { rest } = extractCredentials({ Account: 'acc1', Country: 'US' });
    expect(rest).toEqual({ Account: 'acc1', Country: 'US' });
  });

  it('resolves per-tab spelling variants to the same canonical field', () => {
    expect(extractCredentials({ 'Backup Code': 'abc' }).credentials).toEqual({ backup_codes: 'abc' });
    expect(extractCredentials({ 'Backup Codes': 'abc' }).credentials).toEqual({ backup_codes: 'abc' });
    expect(extractCredentials({ 'Authenticator\nBackup': 'xyz' }).credentials).toEqual({ authenticator_backup: 'xyz' });
    expect(extractCredentials({ Authenticator: 'xyz' }).credentials).toEqual({ authenticator_backup: 'xyz' });
  });

  it('keeps Password and Casino Password as distinct fields', () => {
    const { credentials } = extractCredentials({ Password: 'login-pw', 'Casino Password': 'casino-pw' });
    expect(credentials).toEqual({ password: 'login-pw', casino_password: 'casino-pw' });
  });

  it('splits AG Password and CG Password as their own app-only fields', () => {
    const { credentials, rest } = extractCredentials({ Account: 'acc1', 'AG Password': 'ag-pw', 'CG Password': 'cg-pw' });
    expect(credentials).toEqual({ ag_password: 'ag-pw', cg_password: 'cg-pw' });
    expect(rest).toEqual({ Account: 'acc1' });
  });

  it('records an explicit null when a present key is cleared, so a clear round-trips', () => {
    const { credentials, rest } = extractCredentials({ Password: '' });
    expect(credentials).toEqual({ password: null });
    expect(rest).toEqual({});
  });

  it('does not add a field to credentials when its key was never present at all', () => {
    const { credentials } = extractCredentials({ Account: 'acc1' });
    expect(credentials).toEqual({});
  });
});

describe('mergeCredentialsIntoData', () => {
  it('writes a credential value back under the header this tab actually uses', () => {
    const data = { Account: 'acc1' };
    const merged = mergeCredentialsIntoData(data, { backup_codes: 'abc' }, ['Account', 'Backup Codes']);
    expect(merged).toEqual({ Account: 'acc1', 'Backup Codes': 'abc' });
  });

  it('falls back to the first known key when no variant is in headers', () => {
    const merged = mergeCredentialsIntoData({}, { backup_codes: 'abc' }, []);
    expect(merged).toEqual({ 'Backup Code': 'abc' });
  });

  it('returns the original data object unchanged when there are no credentials', () => {
    const data = { Account: 'acc1' };
    expect(mergeCredentialsIntoData(data, null, ['Account'])).toBe(data);
    expect(mergeCredentialsIntoData(data, {}, ['Account'])).toBe(data);
  });

  it('skips null credential values instead of writing a blank cell', () => {
    const data = { Account: 'acc1' };
    const merged = mergeCredentialsIntoData(data, { password: null, backup_codes: 'abc' }, ['Password', 'Backup Codes']);
    expect(merged).toEqual({ Account: 'acc1', 'Backup Codes': 'abc' });
  });

  it('writes AG Password / CG Password to their one literal key, no tab-header lookup needed', () => {
    const merged = mergeCredentialsIntoData({}, { ag_password: 'ag-pw', cg_password: 'cg-pw' }, []);
    expect(merged).toEqual({ 'AG Password': 'ag-pw', 'CG Password': 'cg-pw' });
  });
});
