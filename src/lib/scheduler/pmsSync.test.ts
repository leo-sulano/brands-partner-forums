import { describe, it, expect, vi } from 'vitest';
import { pushScheduleToPms, type PmsSyncItem } from './pmsSync';

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
  });
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
});
