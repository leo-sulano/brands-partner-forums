import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({ data: { session: null } }),
}));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
  SUPABASE_ANON_KEY: 'test-anon-key',
  SYNC_SCHEDULE_PMS_URL: 'https://example.com/sync-schedule-pms',
}));

import { pushScheduleActivations, pullScheduleDrift, syncTabStatusToPms } from './schedulePmsSync';

const ITEM = { tab: 'BITP', tabLabel: 'TP Brand Injection', brand: 'WinMega', platform: 'tp' as const, date: '2026-08-20' };

describe('pushScheduleActivations', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  it('does nothing for an empty item list', async () => {
    await pushScheduleActivations([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts action:push with the items and an auth header', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ created: [], skipped: [], failed: [] }) });
    await pushScheduleActivations([ITEM]);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/sync-schedule-pms',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'test-anon-key', Authorization: expect.stringMatching(/^Bearer /) }),
        body: JSON.stringify({ action: 'push', items: [ITEM] }),
      }),
    );
  });

  it('throws on a non-OK response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(pushScheduleActivations([ITEM])).rejects.toThrow('Failed to sync schedule to PMS.');
  });
});

describe('pullScheduleDrift', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  it('posts action:pull with the tab and returns the parsed result, including assignees', async () => {
    const assignees = [{ tab: 'BITP', brand: 'WinMega', platform: 'tp' as const, date: '2026-08-20', assigneeName: 'Jen' }];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ drifted: [], deleted: [], assignees }) });
    const result = await pullScheduleDrift('BITP');
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/sync-schedule-pms',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'pull', tab: 'BITP' }) }),
    );
    expect(result).toEqual({ drifted: [], deleted: [], assignees });
  });

  it('throws on a non-OK response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(pullScheduleDrift('BITP')).rejects.toThrow('Failed to pull PMS schedule updates.');
  });
});

describe('syncTabStatusToPms', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  it('posts action:syncAllStatuses with the tab and an auth header', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ results: { BITP: 'ok' } }) });
    await syncTabStatusToPms('BITP');
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/sync-schedule-pms',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'test-anon-key', Authorization: expect.stringMatching(/^Bearer /) }),
        body: JSON.stringify({ action: 'syncAllStatuses', tab: 'BITP' }),
      }),
    );
  });

  it('throws on a non-OK response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(syncTabStatusToPms('BITP')).rejects.toThrow('Failed to sync schedule status to PMS.');
  });

  it('throws when the 200 response reports this tab as an error result', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ results: { BITP: 'error: 2 link(s) failed to move' } }),
    });
    await expect(syncTabStatusToPms('BITP')).rejects.toThrow(
      'Failed to sync schedule status to PMS: 2 link(s) failed to move',
    );
  });

  it('does not throw when the 200 response reports a different tab as an error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ results: { Hanan: 'error: boom' } }),
    });
    await expect(syncTabStatusToPms('BITP')).resolves.toBeUndefined();
  });
});
