import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  SUPABASE_ANON_KEY: 'test-anon-key',
  CHECK_STATUS_URL: 'https://example.com/check-status',
  CHECK_STATUS_BASE_URL: 'https://example.com',
  CHECK_STATUS_TOKEN: '',
  CHECK_AG_STATUS_URL: 'https://example.com/check-status',
  CHECK_AG_STATUS_BASE_URL: 'https://example.com',
}));

import {
  triggerStatusCheck,
  triggerAgStatusCheck,
  triggerCgStatusCheck,
  triggerWoStatusCheck,
  StatusCheckTimeoutError,
} from './queries';

// A 504 means the proxy in front of status_server.py gave up waiting for a
// response -- the check runs synchronously there and keeps going until it
// truly finishes, so a 504 says nothing about whether the check itself
// succeeded or failed (unlike a real app-level error such as 409/500).
// These triggers must surface that distinctly so callers don't tell the user
// the check "failed" while the server is, in fact, still running it.
describe.each([
  ['triggerStatusCheck', triggerStatusCheck],
  ['triggerAgStatusCheck', triggerAgStatusCheck],
  ['triggerCgStatusCheck', triggerCgStatusCheck],
  ['triggerWoStatusCheck', triggerWoStatusCheck],
] as const)('%s', (_name, trigger) => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('throws a StatusCheckTimeoutError on a 504, not a generic failure error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 504,
      json: async () => ({}),
    });
    await expect(trigger('SomeTab', {})).rejects.toBeInstanceOf(StatusCheckTimeoutError);
  });

  it('still throws a plain Error (not a timeout) on a real app-level failure like 409', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'A check is already running for this brand — wait and retry' }),
    });
    await expect(trigger('SomeTab', {})).rejects.toThrow('A check is already running for this brand — wait and retry');
    await expect(trigger('SomeTab', {})).rejects.not.toBeInstanceOf(StatusCheckTimeoutError);
  });
});
