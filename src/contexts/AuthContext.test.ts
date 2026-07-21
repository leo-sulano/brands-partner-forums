import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  },
}));

import { fetchProfile } from './AuthContext';

describe('fetchProfile', () => {
  beforeEach(() => {
    maybeSingle.mockReset();
  });

  it('returns the profile on success', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: 'u1', approved: true }, error: null });
    await expect(fetchProfile('u1')).resolves.toEqual({ id: 'u1', approved: true });
  });

  it('returns null without retrying when the row genuinely does not exist', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchProfile('u1')).resolves.toBeNull();
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('retries on a transient query error and returns the profile once it succeeds', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: 'network blip' } })
      .mockResolvedValueOnce({ data: { id: 'u1', approved: true }, error: null });

    await expect(fetchProfile('u1')).resolves.toEqual({ id: 'u1', approved: true });
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it('gives up and returns null after repeated errors', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'still down' } });
    await expect(fetchProfile('u1')).resolves.toBeNull();
    expect(maybeSingle).toHaveBeenCalledTimes(3);
  });
});
