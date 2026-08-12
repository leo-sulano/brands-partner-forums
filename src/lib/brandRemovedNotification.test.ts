import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({ data: { session: null } }),
}));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
  SUPABASE_ANON_KEY: 'test-anon-key',
  NOTIFY_BRAND_REMOVED_URL: 'https://example.com/notify-brand-removed',
}));

import { notifyBrandRemoved } from './brandRemovedNotification';

const PAYLOAD = {
  brand: 'Prive Casino',
  tabLabel: 'TP Brand Injection',
  platformShortLabel: 'TP',
};

describe('notifyBrandRemoved', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  it('resolves on a successful response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ sent: 2 }) });
    await expect(notifyBrandRemoved(PAYLOAD)).resolves.toBeUndefined();
  });

  it('sends the anon key, a bearer token, and the payload to NOTIFY_BRAND_REMOVED_URL', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ sent: 1 }) });
    await notifyBrandRemoved(PAYLOAD);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/notify-brand-removed',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'test-anon-key', Authorization: expect.stringMatching(/^Bearer /) }),
        body: JSON.stringify(PAYLOAD),
      }),
    );
  });

  it('throws on a non-OK response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(notifyBrandRemoved(PAYLOAD)).rejects.toThrow('Failed to send the brand-removed notification email.');
  });

  it('throws when fetch itself rejects', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    await expect(notifyBrandRemoved(PAYLOAD)).rejects.toThrow('Failed to send the brand-removed notification email.');
  });
});
