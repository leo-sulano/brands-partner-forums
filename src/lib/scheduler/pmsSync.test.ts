import { describe, it, expect, vi } from 'vitest';
import { pushScheduleToPms, type PmsSyncItem } from './pmsSync';
import { pullScheduleFromPms } from './pmsSync';

const CREDENTIALS = { apiToken: 'test-token' };

function fakeSupabase(existingLinks: unknown[] = []) {
  const insertedRows: unknown[] = [];
  return {
    client: {
      from: (table: string) => {
        if (table !== 'schedule_pms_links') throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({ eq: () => Promise.resolve({ data: existingLinks, error: null }) }),
          insert: (row: unknown) => {
            insertedRows.push(row);
            return Promise.resolve({ error: null });
          },
        };
      },
    } as any,
    insertedRows,
  };
}

function fakeFetchSequence(responses: { url: RegExp; method: string; body: unknown; status?: number }[]) {
  let call = 0;
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const step = responses[call];
    call += 1;
    if (!step) throw new Error(`unexpected extra fetch call: ${init.method ?? 'GET'} ${url}`);
    if (!step.url.test(url) || (init.method ?? 'GET') !== step.method) {
      throw new Error(`unexpected fetch call: ${init.method ?? 'GET'} ${url}, expected ${step.method} matching ${step.url}`);
    }
    return { ok: (step.status ?? 200) < 400, status: step.status ?? 200, json: async () => step.body };
  }) as unknown as typeof fetch;
}

const ITEM: PmsSyncItem = { tab: 'BITP', tabLabel: 'TP Brand Injection', brand: 'WinMega', platform: 'tp', date: '2026-08-20' };

describe('pushScheduleToPms', () => {
  it('creates a task, labels it, and inserts a link when no link exists yet', async () => {
    const { client, insertedRows } = fakeSupabase([]);
    const fetchFn = fakeFetchSequence([
      { url: /\/labels$/, method: 'GET', body: [{ id: 'label-tp', name: 'TP' }, { id: 'label-client', name: 'Client' }] },
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-1', dueDate: '2026-08-20T00:00:00.000Z' } },
      { url: /\/tasks\/task-1$/, method: 'PATCH', body: {} },
    ]);
    const result = await pushScheduleToPms([ITEM], client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ created: [ITEM], skipped: [], failed: [] });
    expect(insertedRows).toEqual([{ tab: 'BITP', brand: 'WinMega', platform: 'tp', date: '2026-08-20', pms_task_id: 'task-1' }]);
  });

  it('skips an item that already has a link for that exact combo, making no PMS API calls', async () => {
    const { client } = fakeSupabase([{ id: 'link-1', tab: 'BITP', brand: 'WinMega', brand_key: 'winmega', platform: 'tp', date: '2026-08-20', pms_task_id: 'task-1' }]);
    const fetchFn = vi.fn();
    const result = await pushScheduleToPms([ITEM], client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ created: [], skipped: [ITEM], failed: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('auto-creates the WO label on first use, then reuses it for a second WO item', async () => {
    const { client } = fakeSupabase([]);
    const woItem1: PmsSyncItem = { tab: 'Wizard of Odds', tabLabel: 'Wizard of Odds', brand: 'BrandA', platform: 'wo', date: '2026-08-20' };
    const woItem2: PmsSyncItem = { tab: 'Wizard of Odds', tabLabel: 'Wizard of Odds', brand: 'BrandB', platform: 'wo', date: '2026-08-21' };
    const fetchFn = fakeFetchSequence([
      { url: /\/labels$/, method: 'GET', body: [{ id: 'label-client', name: 'Client' }] }, // no WO label yet
      { url: /\/labels$/, method: 'POST', body: { id: 'label-wo', name: 'WO' } }, // auto-created
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-1', dueDate: '2026-08-20T00:00:00.000Z' } },
      { url: /\/tasks\/task-1$/, method: 'PATCH', body: {} },
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-2', dueDate: '2026-08-21T00:00:00.000Z' } },
      { url: /\/tasks\/task-2$/, method: 'PATCH', body: {} },
    ]);
    const result = await pushScheduleToPms([woItem1, woItem2], client, CREDENTIALS, fetchFn);
    expect(result.created).toEqual([woItem1, woItem2]);
    // Exactly one label-fetch and one label-create across both items -- the
    // second item's WO label resolution must reuse the cache, not create a
    // second WO label (fakeFetchSequence throws on any unexpected call, so
    // this is already enforced by the mock sequence above having only one
    // GET and one POST to /labels for two WO items).
  });

  it('records a per-item failure without aborting the rest of the batch', async () => {
    const { client } = fakeSupabase([]);
    const okItem: PmsSyncItem = { ...ITEM, brand: 'GoodBrand' };
    const badItem: PmsSyncItem = { ...ITEM, brand: 'BadBrand' };
    const fetchFn = fakeFetchSequence([
      { url: /\/labels$/, method: 'GET', body: [{ id: 'label-tp', name: 'TP' }, { id: 'label-client', name: 'Client' }] },
      { url: /\/tasks$/, method: 'POST', body: {}, status: 500 }, // badItem's create fails
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-1', dueDate: '2026-08-20T00:00:00.000Z' } },
      { url: /\/tasks\/task-1$/, method: 'PATCH', body: {} },
    ]);
    const result = await pushScheduleToPms([badItem, okItem], client, CREDENTIALS, fetchFn);
    expect(result.created).toEqual([okItem]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].item).toEqual(badItem);
  });

  it('returns immediately with no API calls for an empty item list', async () => {
    const { client } = fakeSupabase([]);
    const fetchFn = vi.fn();
    const result = await pushScheduleToPms([], client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ created: [], skipped: [], failed: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('creates only one task when the same (tab, brand, platform, date) combo appears twice in one batch', async () => {
    const { client, insertedRows } = fakeSupabase([]);
    const fetchFn = fakeFetchSequence([
      { url: /\/labels$/, method: 'GET', body: [{ id: 'label-tp', name: 'TP' }, { id: 'label-client', name: 'Client' }] },
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-1', dueDate: '2026-08-20T00:00:00.000Z' } },
      { url: /\/tasks\/task-1$/, method: 'PATCH', body: {} },
      // No second /tasks POST or /tasks/:id PATCH expected -- fakeFetchSequence
      // throws on any unexpected extra call, so a second create attempt for
      // the duplicate item would fail this test.
    ]);
    const result = await pushScheduleToPms([ITEM, { ...ITEM }], client, CREDENTIALS, fetchFn);
    expect(result.created).toEqual([ITEM]);
    expect(result.skipped).toEqual([{ ...ITEM }]);
    expect(result.failed).toEqual([]);
    expect(insertedRows).toEqual([{ tab: 'BITP', brand: 'WinMega', platform: 'tp', date: '2026-08-20', pms_task_id: 'task-1' }]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

function fakeSupabaseWithLinks(links: any[]) {
  const updated: unknown[] = [];
  const deletedIds: string[] = [];
  return {
    client: {
      from: (table: string) => {
        if (table !== 'schedule_pms_links') throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({ eq: () => Promise.resolve({ data: links, error: null }) }),
          update: (row: unknown) => ({
            eq: (_col: string, id: string) => {
              updated.push({ id, ...row as object });
              return Promise.resolve({ error: null });
            },
          }),
          delete: () => ({
            eq: (_col: string, id: string) => {
              deletedIds.push(id);
              return Promise.resolve({ error: null });
            },
          }),
        };
      },
    } as any,
    updated,
    deletedIds,
  };
}

const LINK = { id: 'link-1', tab: 'BITP', brand: 'WinMega', brand_key: 'winmega', platform: 'tp' as const, date: '2026-08-20', pms_task_id: 'task-1' };

describe('pullScheduleFromPms', () => {
  it('reports a drifted item and updates the link when the live due date differs', async () => {
    const { client, updated } = fakeSupabaseWithLinks([LINK]);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'task-1', dueDate: '2026-08-22T00:00:00.000Z' }],
    });
    const result = await pullScheduleFromPms('BITP', client, CREDENTIALS, fetchFn);
    expect(result).toEqual({
      drifted: [{ tab: 'BITP', brand: 'WinMega', platform: 'tp', oldDate: '2026-08-20', newDate: '2026-08-22' }],
      deleted: [],
    });
    expect(updated).toEqual([{ id: 'link-1', date: '2026-08-22' }]);
  });

  it('reports a deleted item and deletes the link when the task no longer exists', async () => {
    const { client, deletedIds } = fakeSupabaseWithLinks([LINK]);
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => [] }); // task-1 is gone
    const result = await pullScheduleFromPms('BITP', client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ drifted: [], deleted: [{ tab: 'BITP', brand: 'WinMega', platform: 'tp', date: '2026-08-20' }] });
    expect(deletedIds).toEqual(['link-1']);
  });

  it('does nothing when the live due date still matches the stored date', async () => {
    const { client, updated, deletedIds } = fakeSupabaseWithLinks([LINK]);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'task-1', dueDate: '2026-08-20T00:00:00.000Z' }],
    });
    const result = await pullScheduleFromPms('BITP', client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ drifted: [], deleted: [] });
    expect(updated).toEqual([]);
    expect(deletedIds).toEqual([]);
  });

  it('returns immediately with no PMS API call when there are no links for the tab', async () => {
    const { client } = fakeSupabaseWithLinks([]);
    const fetchFn = vi.fn();
    const result = await pullScheduleFromPms('BITP', client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ drifted: [], deleted: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('skips a link whose live task has a cleared (null) due date without throwing, while still processing other links', async () => {
    const LINK_2 = { id: 'link-2', tab: 'BITP', brand: 'OtherBrand', brand_key: 'otherbrand', platform: 'tp' as const, date: '2026-08-20', pms_task_id: 'task-2' };
    const { client, updated, deletedIds } = fakeSupabaseWithLinks([LINK, LINK_2]);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'task-1', dueDate: null }, // due date cleared in PMS
        { id: 'task-2', dueDate: '2026-08-22T00:00:00.000Z' }, // still processed normally
      ],
    });
    const outcome = await pullScheduleFromPms('BITP', client, CREDENTIALS, fetchFn);
    expect(outcome).toEqual({
      drifted: [{ tab: 'BITP', brand: 'OtherBrand', platform: 'tp', oldDate: '2026-08-20', newDate: '2026-08-22' }],
      deleted: [],
    });
    expect(updated).toEqual([{ id: 'link-2', date: '2026-08-22' }]);
    expect(deletedIds).toEqual([]);
  });
});
