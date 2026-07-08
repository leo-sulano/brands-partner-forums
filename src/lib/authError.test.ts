import { describe, it, expect } from 'vitest';
import { parseAuthErrorFromHash } from './authError';

describe('parseAuthErrorFromHash', () => {
  it('returns null when the hash has no error', () => {
    expect(parseAuthErrorFromHash('#access_token=abc123&type=recovery')).toBeNull();
  });

  it('returns null for an empty hash', () => {
    expect(parseAuthErrorFromHash('')).toBeNull();
  });

  it('extracts and decodes error_description from the hash', () => {
    const hash = '#error=access_denied&error_code=access_denied&error_description=User+denied+access';
    expect(parseAuthErrorFromHash(hash)).toBe('User denied access');
  });

  it('works whether or not the leading # is present', () => {
    const hash = 'error=server_error&error_description=Something+went+wrong';
    expect(parseAuthErrorFromHash(hash)).toBe('Something went wrong');
  });
});
