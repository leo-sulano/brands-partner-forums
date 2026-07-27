import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invoke, setSession } = vi.hoisted(() => ({
  invoke: vi.fn(),
  setSession: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke },
    auth: { setSession },
  },
}));

import { mapSsoErrorCode, completePortalLogin } from './portalSso';

describe('mapSsoErrorCode', () => {
  it('maps known codes to distinct messages', () => {
    const sso = mapSsoErrorCode('sso');
    const provision = mapSsoErrorCode('provision');
    const access = mapSsoErrorCode('access');
    const session = mapSsoErrorCode('session');
    const all = [sso, provision, access, session];
    expect(new Set(all).size).toBe(4);
    all.forEach((m) => expect(m.length).toBeGreaterThan(0));
  });

  it('falls back to a default message for an unknown or missing code', () => {
    expect(mapSsoErrorCode('something-new')).toBe(mapSsoErrorCode(undefined));
  });
});

describe('completePortalLogin', () => {
  beforeEach(() => {
    invoke.mockReset();
    setSession.mockReset();
  });

  it('adopts the session and returns ok on success', async () => {
    invoke.mockResolvedValueOnce({
      data: { access_token: 'at', refresh_token: 'rt' },
      error: null,
    });
    setSession.mockResolvedValueOnce({ error: null });

    await expect(completePortalLogin('tok')).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('sso-callback', { body: { token: 'tok' } });
    expect(setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
  });

  it('returns a mapped error message when the function reports one', async () => {
    invoke.mockResolvedValueOnce({ data: { error: 'provision' }, error: null });

    await expect(completePortalLogin('tok')).resolves.toEqual({
      ok: false,
      message: mapSsoErrorCode('provision'),
    });
    expect(setSession).not.toHaveBeenCalled();
  });

  it('returns a fallback error when invoke itself fails', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } });

    await expect(completePortalLogin('tok')).resolves.toEqual({
      ok: false,
      message: mapSsoErrorCode(undefined),
    });
  });

  it('returns a fallback error when the response is missing tokens', async () => {
    invoke.mockResolvedValueOnce({ data: {}, error: null });

    await expect(completePortalLogin('tok')).resolves.toEqual({
      ok: false,
      message: mapSsoErrorCode(undefined),
    });
  });

  it('returns the session error message when setSession fails', async () => {
    invoke.mockResolvedValueOnce({
      data: { access_token: 'at', refresh_token: 'rt' },
      error: null,
    });
    setSession.mockResolvedValueOnce({ error: { message: 'bad tokens' } });

    await expect(completePortalLogin('tok')).resolves.toEqual({
      ok: false,
      message: mapSsoErrorCode('session'),
    });
  });
});
