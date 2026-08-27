import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushScheduleToPms, type PmsSyncItem } from './pmsSync';
import { pullScheduleFromPms } from './pmsSync';
import { syncScheduleStatusToPms, type PmsStatusSyncItem } from './pmsSync';
import { resolveAndSyncTabStatuses } from './pmsSync';
import { cancelScheduleInPms, type PmsCancelItem } from './pmsSync';
import { invalidateTabCache } from '../queries';

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

  it('sets assigneeIds on the task-patch call when the item\'s agent matches a real PMS team member', async () => {
    const { client } = fakeSupabase([]);
    const itemWithAgent: PmsSyncItem = { ...ITEM, agent: 'Jen' };
    let patchBody: unknown;
    const fetchFn = fakeFetchSequence([
      { url: /\/labels$/, method: 'GET', body: [{ id: 'label-tp', name: 'TP' }, { id: 'label-client', name: 'Client' }] },
      { url: /\/teams\//, method: 'GET', body: { members: [{ user: { id: 'user-jen', name: 'Jen' } }, { user: { id: 'user-ann', name: 'Ann' } }] } },
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-1', dueDate: '2026-08-20T00:00:00.000Z' } },
      { url: /\/tasks\/task-1$/, method: 'PATCH', body: {} },
    ]);
    const spiedFetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'PATCH') patchBody = JSON.parse(init.body as string);
      return (fetchFn as unknown as (u: string, i: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;
    const result = await pushScheduleToPms([itemWithAgent], client, CREDENTIALS, spiedFetch);
    expect(result.created).toEqual([itemWithAgent]);
    expect(patchBody).toEqual({ labelIds: ['label-tp', 'label-client'], assigneeIds: ['user-jen'] });
  });

  it('leaves the task unassigned (no assigneeIds field) when the agent has no matching PMS team member', async () => {
    const { client } = fakeSupabase([]);
    const itemWithUnknownAgent: PmsSyncItem = { ...ITEM, agent: 'Venus' };
    let patchBody: unknown;
    const fetchFn = fakeFetchSequence([
      { url: /\/labels$/, method: 'GET', body: [{ id: 'label-tp', name: 'TP' }, { id: 'label-client', name: 'Client' }] },
      { url: /\/teams\//, method: 'GET', body: { members: [{ user: { id: 'user-jen', name: 'Jen' } }] } },
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-1', dueDate: '2026-08-20T00:00:00.000Z' } },
      { url: /\/tasks\/task-1$/, method: 'PATCH', body: {} },
    ]);
    const spiedFetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'PATCH') patchBody = JSON.parse(init.body as string);
      return (fetchFn as unknown as (u: string, i: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;
    const result = await pushScheduleToPms([itemWithUnknownAgent], client, CREDENTIALS, spiedFetch);
    expect(result.created).toEqual([itemWithUnknownAgent]);
    expect(patchBody).toEqual({ labelIds: ['label-tp', 'label-client'] });
  });

  it('matches an agent name case/whitespace-insensitively against the PMS team roster', async () => {
    const { client } = fakeSupabase([]);
    const itemWithMessyAgent: PmsSyncItem = { ...ITEM, agent: '  JEN  ' };
    let patchBody: unknown;
    const fetchFn = fakeFetchSequence([
      { url: /\/labels$/, method: 'GET', body: [{ id: 'label-tp', name: 'TP' }, { id: 'label-client', name: 'Client' }] },
      { url: /\/teams\//, method: 'GET', body: { members: [{ user: { id: 'user-jen', name: 'Jen' } }] } },
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-1', dueDate: '2026-08-20T00:00:00.000Z' } },
      { url: /\/tasks\/task-1$/, method: 'PATCH', body: {} },
    ]);
    const spiedFetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'PATCH') patchBody = JSON.parse(init.body as string);
      return (fetchFn as unknown as (u: string, i: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;
    await pushScheduleToPms([itemWithMessyAgent], client, CREDENTIALS, spiedFetch);
    expect(patchBody).toEqual({ labelIds: ['label-tp', 'label-client'], assigneeIds: ['user-jen'] });
  });

  it('fetches the PMS team roster only once across a batch of agent-bearing items, and never when no item has an agent', async () => {
    const { client } = fakeSupabase([]);
    const item1: PmsSyncItem = { ...ITEM, brand: 'BrandA', agent: 'Jen' };
    const item2: PmsSyncItem = { ...ITEM, brand: 'BrandB', agent: 'Ann' };
    const fetchFn = fakeFetchSequence([
      { url: /\/labels$/, method: 'GET', body: [{ id: 'label-tp', name: 'TP' }, { id: 'label-client', name: 'Client' }] },
      { url: /\/teams\//, method: 'GET', body: { members: [{ user: { id: 'user-jen', name: 'Jen' } }, { user: { id: 'user-ann', name: 'Ann' } }] } },
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-1', dueDate: '2026-08-20T00:00:00.000Z' } },
      { url: /\/tasks\/task-1$/, method: 'PATCH', body: {} },
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-2', dueDate: '2026-08-20T00:00:00.000Z' } },
      { url: /\/tasks\/task-2$/, method: 'PATCH', body: {} },
      // No second /teams/ call expected -- fakeFetchSequence throws on any
      // unexpected extra call, so a second fetch would fail this test.
    ]);
    const result = await pushScheduleToPms([item1, item2], client, CREDENTIALS, fetchFn);
    expect(result.created).toEqual([item1, item2]);
  });

  it('never fetches the PMS team roster when no item in the batch has an agent', async () => {
    const { client } = fakeSupabase([]);
    const fetchFn = fakeFetchSequence([
      { url: /\/labels$/, method: 'GET', body: [{ id: 'label-tp', name: 'TP' }, { id: 'label-client', name: 'Client' }] },
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-1', dueDate: '2026-08-20T00:00:00.000Z' } },
      { url: /\/tasks\/task-1$/, method: 'PATCH', body: {} },
      // No /teams/ call expected at all.
    ]);
    const result = await pushScheduleToPms([ITEM], client, CREDENTIALS, fetchFn);
    expect(result.created).toEqual([ITEM]);
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
      json: async () => [{ id: 'task-1', dueDate: '2026-08-22T00:00:00.000Z', assignees: [] }],
    });
    const result = await pullScheduleFromPms('BITP', client, CREDENTIALS, fetchFn);
    expect(result).toEqual({
      drifted: [{ tab: 'BITP', brand: 'WinMega', platform: 'tp', oldDate: '2026-08-20', newDate: '2026-08-22' }],
      deleted: [],
      assignees: [{ tab: 'BITP', brand: 'WinMega', platform: 'tp', date: '2026-08-22', assigneeName: null }],
    });
    expect(updated).toEqual([{ id: 'link-1', date: '2026-08-22' }]);
  });

  it('reports a deleted item and deletes the link when the task no longer exists', async () => {
    const { client, deletedIds } = fakeSupabaseWithLinks([LINK]);
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => [] }); // task-1 is gone
    const result = await pullScheduleFromPms('BITP', client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ drifted: [], deleted: [{ tab: 'BITP', brand: 'WinMega', platform: 'tp', date: '2026-08-20' }], assignees: [] });
    expect(deletedIds).toEqual(['link-1']);
  });

  it('does nothing when the live due date still matches the stored date, but still reports the current assignee', async () => {
    const { client, updated, deletedIds } = fakeSupabaseWithLinks([LINK]);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'task-1', dueDate: '2026-08-20T00:00:00.000Z', assignees: [{ user: { name: 'Jen' } }] }],
    });
    const result = await pullScheduleFromPms('BITP', client, CREDENTIALS, fetchFn);
    expect(result).toEqual({
      drifted: [],
      deleted: [],
      assignees: [{ tab: 'BITP', brand: 'WinMega', platform: 'tp', date: '2026-08-20', assigneeName: 'Jen' }],
    });
    expect(updated).toEqual([]);
    expect(deletedIds).toEqual([]);
  });

  it('returns immediately with no PMS API call when there are no links for the tab', async () => {
    const { client } = fakeSupabaseWithLinks([]);
    const fetchFn = vi.fn();
    const result = await pullScheduleFromPms('BITP', client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ drifted: [], deleted: [], assignees: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('skips a link whose live task has a cleared (null) due date without throwing, while still processing other links and still reporting its assignee', async () => {
    const LINK_2 = { id: 'link-2', tab: 'BITP', brand: 'OtherBrand', brand_key: 'otherbrand', platform: 'tp' as const, date: '2026-08-20', pms_task_id: 'task-2' };
    const { client, updated, deletedIds } = fakeSupabaseWithLinks([LINK, LINK_2]);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'task-1', dueDate: null, assignees: [{ user: { name: 'Lai' } }] }, // due date cleared in PMS
        { id: 'task-2', dueDate: '2026-08-22T00:00:00.000Z', assignees: [] }, // still processed normally
      ],
    });
    const outcome = await pullScheduleFromPms('BITP', client, CREDENTIALS, fetchFn);
    expect(outcome).toEqual({
      drifted: [{ tab: 'BITP', brand: 'OtherBrand', platform: 'tp', oldDate: '2026-08-20', newDate: '2026-08-22' }],
      deleted: [],
      assignees: [
        { tab: 'BITP', brand: 'WinMega', platform: 'tp', date: '2026-08-20', assigneeName: 'Lai' },
        { tab: 'BITP', brand: 'OtherBrand', platform: 'tp', date: '2026-08-22', assigneeName: null },
      ],
    });
    expect(updated).toEqual([{ id: 'link-2', date: '2026-08-22' }]);
    expect(deletedIds).toEqual([]);
  });

  it('resolves assigneeName from the task\'s first assignee entry when one is set', async () => {
    const { client } = fakeSupabaseWithLinks([LINK]);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'task-1', dueDate: '2026-08-20T00:00:00.000Z', assignees: [{ user: { name: 'Ann' } }] }],
    });
    const result = await pullScheduleFromPms('BITP', client, CREDENTIALS, fetchFn);
    expect(result.assignees).toEqual([{ tab: 'BITP', brand: 'WinMega', platform: 'tp', date: '2026-08-20', assigneeName: 'Ann' }]);
  });
});

const CANCEL_ITEM: PmsCancelItem = { tab: 'BITP', brand: 'WinMega', platform: 'tp', date: '2026-08-20' };

describe('cancelScheduleInPms', () => {
  it('deletes the PMS task and the link when a matching link exists', async () => {
    const { client, deletedIds } = fakeSupabaseWithLinks([LINK]);
    const fetchFn = fakeFetchSequence([
      { url: /\/tasks\/task-1$/, method: 'DELETE', body: null, status: 204 },
    ]);
    const result = await cancelScheduleInPms([CANCEL_ITEM], client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ deleted: [CANCEL_ITEM], skipped: [], failed: [] });
    expect(deletedIds).toEqual(['link-1']);
  });

  it('skips an item with no matching link, making no PMS API calls', async () => {
    const { client, deletedIds } = fakeSupabaseWithLinks([]);
    const fetchFn = vi.fn();
    const result = await cancelScheduleInPms([CANCEL_ITEM], client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ deleted: [], skipped: [CANCEL_ITEM], failed: [] });
    expect(deletedIds).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('records a per-item failure without aborting the batch, and never deletes that link', async () => {
    const { client, deletedIds } = fakeSupabaseWithLinks([
      LINK,
      { id: 'link-2', tab: 'BITP', brand: 'OtherBrand', brand_key: 'otherbrand', platform: 'tp' as const, date: '2026-08-21', pms_task_id: 'task-2' },
    ]);
    const badItem: PmsCancelItem = CANCEL_ITEM;
    const okItem: PmsCancelItem = { tab: 'BITP', brand: 'OtherBrand', platform: 'tp', date: '2026-08-21' };
    const fetchFn = fakeFetchSequence([
      { url: /\/tasks\/task-1$/, method: 'DELETE', body: {}, status: 500 },
      { url: /\/tasks\/task-2$/, method: 'DELETE', body: null, status: 204 },
    ]);
    const result = await cancelScheduleInPms([badItem, okItem], client, CREDENTIALS, fetchFn);
    expect(result.deleted).toEqual([okItem]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].item).toEqual(badItem);
    expect(deletedIds).toEqual(['link-2']);
  });

  it('treats a 404 delete response as the task already being gone, and still deletes the link', async () => {
    const { client, deletedIds } = fakeSupabaseWithLinks([LINK]);
    const fetchFn = fakeFetchSequence([
      { url: /\/tasks\/task-1$/, method: 'DELETE', body: {}, status: 404 },
    ]);
    const result = await cancelScheduleInPms([CANCEL_ITEM], client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ deleted: [CANCEL_ITEM], skipped: [], failed: [] });
    expect(deletedIds).toEqual(['link-1']);
  });

  it('returns immediately with no API calls for an empty item list', async () => {
    const { client } = fakeSupabaseWithLinks([]);
    const fetchFn = vi.fn();
    const result = await cancelScheduleInPms([], client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ deleted: [], skipped: [], failed: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reuses the per-tab links fetch across a batch, fetching schedule_pms_links only once', async () => {
    const item2: PmsCancelItem = { tab: 'BITP', brand: 'OtherBrand', platform: 'tp', date: '2026-08-21' };
    const link2 = { id: 'link-2', tab: 'BITP', brand: 'OtherBrand', brand_key: 'otherbrand', platform: 'tp' as const, date: '2026-08-21', pms_task_id: 'task-2' };
    let selectCalls = 0;
    const deletedIds: string[] = [];
    const client = {
      from: (table: string) => {
        if (table !== 'schedule_pms_links') throw new Error(`unexpected table ${table}`);
        return {
          select: () => {
            selectCalls++;
            return { eq: () => Promise.resolve({ data: [LINK, link2], error: null }) };
          },
          delete: () => ({ eq: (_col: string, id: string) => { deletedIds.push(id); return Promise.resolve({ error: null }); } }),
        };
      },
    } as any;
    const fetchFn = fakeFetchSequence([
      { url: /\/tasks\/task-1$/, method: 'DELETE', body: null, status: 204 },
      { url: /\/tasks\/task-2$/, method: 'DELETE', body: null, status: 204 },
    ]);
    await cancelScheduleInPms([CANCEL_ITEM, item2], client, CREDENTIALS, fetchFn);
    expect(selectCalls).toBe(1);
    expect(deletedIds).toEqual(['link-1', 'link-2']);
  });
});

function fakeSupabaseForStatusUpdate() {
  const updated: unknown[] = [];
  return {
    client: {
      from: (table: string) => {
        if (table !== 'schedule_pms_links') throw new Error(`unexpected table ${table}`);
        return {
          update: (row: unknown) => ({
            eq: (_col: string, id: string) => {
              updated.push({ id, ...row as object });
              return Promise.resolve({ error: null });
            },
          }),
        };
      },
    } as any,
    updated,
  };
}

describe('syncScheduleStatusToPms', () => {
  it('moves the task to the mapped column and records the new synced_status on success', async () => {
    const { client, updated } = fakeSupabaseForStatusUpdate();
    const fetchFn = fakeFetchSequence([
      { url: /\/tasks$/, method: 'GET', body: [] },
      { url: /\/tasks\/task-1\/move$/, method: 'PATCH', body: {} },
    ]);
    const item: PmsStatusSyncItem = { linkId: 'link-1', pmsTaskId: 'task-1', targetStatus: 'published', tabLabel: 'BITP', date: '2026-08-20' };
    const result = await syncScheduleStatusToPms([item], client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ synced: [item], failed: [] });
    expect(updated).toEqual([{ id: 'link-1', synced_status: 'published' }]);
  });

  it('records a per-item failure without aborting the rest of the batch, and never updates synced_status for the failed item', async () => {
    const { client, updated } = fakeSupabaseForStatusUpdate();
    const badItem: PmsStatusSyncItem = { linkId: 'link-1', pmsTaskId: 'task-bad', targetStatus: 'removed', tabLabel: 'BITP', date: '2026-08-20' };
    const okItem: PmsStatusSyncItem = { linkId: 'link-2', pmsTaskId: 'task-ok', targetStatus: 'active', tabLabel: 'BITP', date: '2026-08-20' };
    const fetchFn = fakeFetchSequence([
      { url: /\/tasks$/, method: 'GET', body: [] },
      { url: /\/tasks\/task-bad\/move$/, method: 'PATCH', body: {}, status: 500 },
      { url: /\/tasks\/task-ok\/move$/, method: 'PATCH', body: {} },
    ]);
    const result = await syncScheduleStatusToPms([badItem, okItem], client, CREDENTIALS, fetchFn);
    expect(result.synced).toEqual([okItem]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].item).toEqual(badItem);
    expect(updated).toEqual([{ id: 'link-2', synced_status: 'active' }]);
  });

  it.each([
    ['active', 'cmsoh1uxz000204l46gf88k3f'],
    ['pending', 'cmsoh1uxz000604l4j5loen7g'],
    ['done', 'cmsoh1uxz000604l4j5loen7g'],
    ['published', 'cmsoh1uxz000604l4j5loen7g'],
    ['removed', 'cmsoh1uxz000604l4j5loen7g'],
    ['paused', 'cmt8eih3x000004lazna3tbmz'],
  ])('maps target status "%s" to column %s', async (targetStatus, columnId) => {
    const { client } = fakeSupabaseForStatusUpdate();
    let movedBody: unknown;
    const fetchFn = vi.fn(async (_url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => [] };
      movedBody = JSON.parse(init.body as string);
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    await syncScheduleStatusToPms(
      [{ linkId: 'link-1', pmsTaskId: 'task-1', targetStatus: targetStatus as PmsStatusSyncItem['targetStatus'], tabLabel: 'BITP', date: '2026-08-20' }],
      client,
      CREDENTIALS,
      fetchFn,
    );
    expect(movedBody).toEqual({ columnId, position: 0 });
  });

  it('returns immediately with no API calls for an empty item list', async () => {
    const { client } = fakeSupabaseForStatusUpdate();
    const fetchFn = vi.fn();
    const result = await syncScheduleStatusToPms([], client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ synced: [], failed: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('groups a moved card by (due date, brand tab): it lands after the last existing peer with an equal-or-earlier date+tab key, not at position 0', async () => {
    const { client } = fakeSupabaseForStatusUpdate();
    const DONE_COLUMN = 'cmsoh1uxz000604l4j5loen7g';
    const existingTasks = [
      { id: 'existing-1', title: 'BITP | Alf Casino', columnId: DONE_COLUMN, position: 0, dueDate: '2026-08-27T00:00:00.000Z', assignees: [] },
      { id: 'existing-2', title: 'BITP | Big Pirate Casino', columnId: DONE_COLUMN, position: 1, dueDate: '2026-08-27T00:00:00.000Z', assignees: [] },
      { id: 'existing-3', title: 'Hanan | ZodiacBet.com', columnId: DONE_COLUMN, position: 2, dueDate: '2026-08-27T00:00:00.000Z', assignees: [] },
      { id: 'existing-4', title: 'Rooster Partners | Spinjo', columnId: DONE_COLUMN, position: 3, dueDate: '2026-08-28T00:00:00.000Z', assignees: [] },
      // A different column's tasks must never affect the count.
      { id: 'other-column', title: 'BITP | Nomini Kasino', columnId: 'some-other-column', position: 0, dueDate: '2026-08-01T00:00:00.000Z', assignees: [] },
    ];
    let movedBody: unknown;
    const fetchFn = vi.fn(async (_url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => existingTasks };
      movedBody = JSON.parse(init.body as string);
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    // A second Hanan card due the same date should slot in right after
    // existing-3 (the current lone Hanan/08-27 card), i.e. position 3 --
    // after both BITP cards and the existing Hanan card, before the 08-28 item.
    const item: PmsStatusSyncItem = { linkId: 'link-1', pmsTaskId: 'task-new', targetStatus: 'published', tabLabel: 'Hanan', date: '2026-08-27' };
    await syncScheduleStatusToPms([item], client, CREDENTIALS, fetchFn);
    expect(movedBody).toEqual({ columnId: DONE_COLUMN, position: 3 });
  });

  it('computes each later item in a batch against the earlier items\' new placements, not stale pre-batch data', async () => {
    const { client } = fakeSupabaseForStatusUpdate();
    const DONE_COLUMN = 'cmsoh1uxz000604l4j5loen7g';
    const existingTasks = [
      { id: 'existing-1', title: 'BITP | Alf Casino', columnId: DONE_COLUMN, position: 0, dueDate: '2026-08-27T00:00:00.000Z', assignees: [] },
    ];
    const movedBodies: unknown[] = [];
    const fetchFn = vi.fn(async (_url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => existingTasks };
      movedBodies.push(JSON.parse(init.body as string));
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    // Two Hanan/08-27 cards moving in the same batch: the first joins after
    // the existing BITP card (position 1); the second must see the first
    // one's new placement and join after it too (position 2), not recompute
    // against the stale pre-batch list and also land at position 1.
    const item1: PmsStatusSyncItem = { linkId: 'link-1', pmsTaskId: 'task-a', targetStatus: 'published', tabLabel: 'Hanan', date: '2026-08-27' };
    const item2: PmsStatusSyncItem = { linkId: 'link-2', pmsTaskId: 'task-b', targetStatus: 'published', tabLabel: 'Hanan', date: '2026-08-27' };
    await syncScheduleStatusToPms([item1, item2], client, CREDENTIALS, fetchFn);
    expect(movedBodies).toEqual([{ columnId: DONE_COLUMN, position: 1 }, { columnId: DONE_COLUMN, position: 2 }]);
  });

  it('falls back to position 0 (ungrouped) rather than failing every item when the project-tasks lookup fails', async () => {
    const { client, updated } = fakeSupabaseForStatusUpdate();
    const fetchFn = vi.fn(async (_url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const item: PmsStatusSyncItem = { linkId: 'link-1', pmsTaskId: 'task-1', targetStatus: 'published', tabLabel: 'BITP', date: '2026-08-20' };
    const result = await syncScheduleStatusToPms([item], client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ synced: [item], failed: [] });
    expect(updated).toEqual([{ id: 'link-1', synced_status: 'published' }]);
  });

  it('PATCHes the task description after a successful move when the item carries one', async () => {
    const { client, updated } = fakeSupabaseForStatusUpdate();
    const fetchFn = fakeFetchSequence([
      { url: /\/tasks$/, method: 'GET', body: [] },
      { url: /\/tasks\/task-1\/move$/, method: 'PATCH', body: {} },
      { url: /\/tasks\/task-1$/, method: 'PATCH', body: {} },
    ]);
    const item: PmsStatusSyncItem = {
      linkId: 'link-1', pmsTaskId: 'task-1', targetStatus: 'done', tabLabel: 'BITP', date: '2026-08-20',
      description: 'Account: agent@example.com\nCountry: Germany\nProxy: SpyderProxy\n\nGreat service.',
    };
    const result = await syncScheduleStatusToPms([item], client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ synced: [item], failed: [] });
    expect(updated).toEqual([{ id: 'link-1', synced_status: 'done' }]);
    const descriptionCall = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url, init]) => /\/tasks\/task-1$/.test(url as string) && init?.method === 'PATCH',
    );
    expect(descriptionCall).toBeDefined();
    expect(JSON.parse(descriptionCall![1].body as string)).toEqual({ description: item.description });
  });

  it('never calls the description PATCH when the item has no description', async () => {
    const { client } = fakeSupabaseForStatusUpdate();
    // fakeFetchSequence throws on any unexpected call -- only listing the move
    // call here proves no /tasks/:id PATCH (description) call was made.
    const fetchFn = fakeFetchSequence([
      { url: /\/tasks$/, method: 'GET', body: [] },
      { url: /\/tasks\/task-1\/move$/, method: 'PATCH', body: {} },
    ]);
    const item: PmsStatusSyncItem = { linkId: 'link-1', pmsTaskId: 'task-1', targetStatus: 'active', tabLabel: 'BITP', date: '2026-08-20' };
    const result = await syncScheduleStatusToPms([item], client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ synced: [item], failed: [] });
  });

  it('fails the whole item (and never updates synced_status) when the description PATCH fails, even though the move already succeeded', async () => {
    const { client, updated } = fakeSupabaseForStatusUpdate();
    const fetchFn = fakeFetchSequence([
      { url: /\/tasks$/, method: 'GET', body: [] },
      { url: /\/tasks\/task-1\/move$/, method: 'PATCH', body: {} },
      { url: /\/tasks\/task-1$/, method: 'PATCH', body: {}, status: 500 },
    ]);
    const item: PmsStatusSyncItem = {
      linkId: 'link-1', pmsTaskId: 'task-1', targetStatus: 'done', tabLabel: 'BITP', date: '2026-08-20',
      description: 'Account: x\nCountry: y\nProxy: z',
    };
    const result = await syncScheduleStatusToPms([item], client, CREDENTIALS, fetchFn);
    expect(result.synced).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].item).toEqual(item);
    expect(updated).toEqual([]);
  });
});

// Generic multi-table fake for resolveAndSyncTabStatuses's tests -- it reads
// six different tables per call (schedule_pms_links, entries,
// removed_platform_brands, schedule_hidden_brands,
// schedule_platform_restrictions, brand_platform_pause, brand_schedule),
// unlike this file's other fakes which are scoped to one or two tables.
// Beyond the brief's original select/eq/then shape, this also answers
// .order()/.range() -- fetchRawEntriesByTab's real implementation
// (fetchAllTabEntries in src/lib/queries.ts) chains
// .select().eq().order().range(), not just .select().eq() -- and .update()
// -- updateSchedulePmsLinkStatus's real implementation does
// .update({synced_status}).eq('id', id), reached whenever
// syncScheduleStatusToPms actually moves a link. Both gaps were found by
// reading the real queries.ts functions against this fake, not assumed.
// upsertCapture, when passed, records every { table, row } an .upsert() call
// on this fake client makes -- used by the watermark tests below to assert
// what resolveAndSyncTabStatuses actually wrote, without changing the
// signature callers that don't care about upserts already use.
function fakeMultiTableClient(tables: Record<string, unknown[]>, upsertCapture?: { table: string; row: unknown }[]) {
  function builder(rows: unknown[], tableName: string) {
    return {
      select: () => builder(rows, tableName),
      eq: () => builder(rows, tableName),
      order: () => builder(rows, tableName),
      range: () => builder(rows, tableName),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      upsert: (row: unknown) => {
        upsertCapture?.push({ table: tableName, row });
        return Promise.resolve({ error: null });
      },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
  }
  return { from: (table: string) => builder(tables[table] ?? [], table) } as any;
}

function entry(tab: string, id: string, data: Record<string, string | null>) {
  return { id, tab, sheet_row_id: id, data, updated_at: '', last_edited_by: 'dashboard' as const, last_sync_tag: null };
}

describe('resolveAndSyncTabStatuses', () => {
  // fetchRawEntriesByTab (via fetchAllTabEntries in src/lib/queries.ts)
  // caches entries per tab name for 60s regardless of which client fetched
  // them. Two cases below reuse the 'TP Brand Injection' tab name -- clear
  // the cache before each test so one test's fixture can never leak into
  // another's via a stale cache hit.
  beforeEach(() => {
    invalidateTabCache('TP Brand Injection');
    invalidateTabCache('Trybet');
    invalidateTabCache('Rooster Partners');
  });

  it('moves a link whose entry status resolves to Done, and leaves synced_status current on success', async () => {
    const client = fakeMultiTableClient({
      schedule_pms_links: [
        { id: 'link-1', tab: 'TP Brand Injection', brand: 'WinMega', brand_key: 'winmega', platform: 'tp', date: '2026-08-27', pms_task_id: 'task-1', synced_status: 'active' },
      ],
      entries: [entry('TP Brand Injection', 'e1', { Brands: 'WinMega', 'TP Review Status': 'Done', 'Trust Pilot': '27/08/2026' })],
      removed_platform_brands: [],
      schedule_hidden_brands: [],
      schedule_platform_restrictions: [],
      brand_platform_pause: [],
      brand_schedule: [],
    });
    const calls: { url: string; body: unknown }[] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => [] };
      calls.push({ url, body: JSON.parse(init.body as string) });
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    // 'TP Brand Injection' is this tab's real identifier (TAB_COLUMN_CONFIGS'
    // key in src/lib/tab-configs.ts) -- getTabPlatforms/fetchRawEntriesByTab/
    // etc. all key off this exact value, not the 'BITP' display abbreviation
    // (tabDisplayName('TP Brand Injection') === 'BITP', asserted below via
    // tabLabel, matching tabs.test.ts's own coverage of that mapping).
    const result = await resolveAndSyncTabStatuses('TP Brand Injection', client, { apiToken: 'test-token' }, fetchFn);
    // The entry has no Account/Country/Proxy Used/TP Review Text -- the
    // details block still renders with each label blank, per the "always
    // show the details block, only the content line is conditional" design.
    expect(result.synced).toEqual([{
      linkId: 'link-1', pmsTaskId: 'task-1', targetStatus: 'done', tabLabel: 'BITP', date: '2026-08-27',
      description: 'Account: \nCountry: \nProxy: ',
    }]);
    const moveCall = calls.find((c) => c.url.endsWith('/move'));
    expect(moveCall?.body).toEqual({ columnId: 'cmsoh1uxz000604l4j5loen7g', position: 0 });
    const descriptionCall = calls.find((c) => !c.url.endsWith('/move'));
    expect(descriptionCall?.body).toEqual({ description: 'Account: \nCountry: \nProxy: ' });
  });

  it('builds the description with the matched entry\'s Account/Country/Proxy Used/review-text content, content appended after a blank line', async () => {
    const client = fakeMultiTableClient({
      schedule_pms_links: [
        { id: 'link-1', tab: 'TP Brand Injection', brand: 'WinMega', brand_key: 'winmega', platform: 'tp', date: '2026-08-27', pms_task_id: 'task-1', synced_status: 'active' },
      ],
      entries: [entry('TP Brand Injection', 'e1', {
        Brands: 'WinMega', 'TP Review Status': 'Removed', 'Trust Pilot': '27/08/2026',
        Account: 'agent@example.com', Country: 'Germany', 'Proxy Used': 'SpyderProxy', 'TP Review Text': 'Great service.',
      })],
      removed_platform_brands: [],
      schedule_hidden_brands: [],
      schedule_platform_restrictions: [],
      brand_platform_pause: [],
      brand_schedule: [],
    });
    const calls: { url: string; body: unknown }[] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => [] };
      calls.push({ url, body: JSON.parse(init.body as string) });
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const result = await resolveAndSyncTabStatuses('TP Brand Injection', client, { apiToken: 'test-token' }, fetchFn);
    expect(result.synced[0]?.description).toBe(
      'Account: agent@example.com\nCountry: Germany\nProxy: SpyderProxy\n\nGreat service.',
    );
  });

  it('leaves description undefined for a combo resolving to paused (no evidence, plan/title-only)', async () => {
    const client = fakeMultiTableClient({
      schedule_pms_links: [
        { id: 'link-1', tab: 'Trybet', brand: 'Trybet.com', brand_key: 'trybet.com', platform: 'tp', date: '2026-08-27', pms_task_id: 'task-1', synced_status: 'active' },
      ],
      entries: [],
      removed_platform_brands: [],
      schedule_hidden_brands: [],
      schedule_platform_restrictions: [],
      brand_platform_pause: [{ tab: 'Trybet', brand_key: 'trybet.com', platform: 'tp', paused_week_start: '2026-08-24', reason: 'low success rate' }],
      brand_schedule: [],
    });
    const fetchFn = vi.fn(async (_url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => [] };
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const result = await resolveAndSyncTabStatuses('Trybet', client, { apiToken: 'test-token' }, fetchFn);
    expect(result.synced[0]?.targetStatus).toBe('paused');
    expect(result.synced[0]?.description).toBeUndefined();
  });

  it('returns immediately with no fetches beyond links when the tab has no linked PMS tasks', async () => {
    const calls: string[] = [];
    const client = {
      from: (table: string) => {
        calls.push(table);
        return { select: () => ({ eq: () => ({ then: (r: any) => Promise.resolve({ data: [], error: null }).then(r) }) }) };
      },
    } as any;
    const result = await resolveAndSyncTabStatuses('Empty Tab', client, { apiToken: 'test-token' });
    expect(result).toEqual({ synced: [], failed: [] });
    expect(calls).toEqual(['schedule_pms_links']);
  });

  it('resolves an evidence-free but scheduler-paused combo to paused, not active', async () => {
    const client = fakeMultiTableClient({
      schedule_pms_links: [
        { id: 'link-1', tab: 'Trybet', brand: 'Trybet.com', brand_key: 'trybet.com', platform: 'tp', date: '2026-08-27', pms_task_id: 'task-1', synced_status: 'active' },
      ],
      entries: [],
      removed_platform_brands: [],
      schedule_hidden_brands: [],
      schedule_platform_restrictions: [],
      brand_platform_pause: [{ tab: 'Trybet', brand_key: 'trybet.com', platform: 'tp', paused_week_start: '2026-08-24', reason: 'low success rate' }],
      brand_schedule: [],
    });
    const fetchFn = vi.fn(async (_url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => [] };
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const result = await resolveAndSyncTabStatuses('Trybet', client, { apiToken: 'test-token' }, fetchFn);
    expect(result.synced[0]?.targetStatus).toBe('paused');
  });

  it('skips a link whose platform is currently hidden for that brand, never syncing it', async () => {
    const client = fakeMultiTableClient({
      schedule_pms_links: [
        { id: 'link-1', tab: 'Rooster Partners', brand: 'Novadreams2', brand_key: 'novadreams2', platform: 'ag', date: '2026-08-27', pms_task_id: 'task-1', synced_status: 'active' },
      ],
      entries: [entry('Rooster Partners', 'e1', { Brands: 'Novadreams2', 'AG Review Status': 'Done', 'Ask Gambler review added': '27/08/2026' })],
      removed_platform_brands: [],
      schedule_hidden_brands: [{ tab: 'Rooster Partners', brand: 'Novadreams2' }],
      schedule_platform_restrictions: [],
      brand_platform_pause: [],
      brand_schedule: [],
    });
    const fetchFn = vi.fn();
    const result = await resolveAndSyncTabStatuses('Rooster Partners', client, { apiToken: 'test-token' }, fetchFn as unknown as typeof fetch);
    expect(result).toEqual({ synced: [], failed: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('makes no move call when the resolved status already matches synced_status', async () => {
    const client = fakeMultiTableClient({
      schedule_pms_links: [
        { id: 'link-1', tab: 'TP Brand Injection', brand: 'WinMega', brand_key: 'winmega', platform: 'tp', date: '2026-08-27', pms_task_id: 'task-1', synced_status: 'done' },
      ],
      entries: [entry('TP Brand Injection', 'e1', { Brands: 'WinMega', 'TP Review Status': 'Done', 'Trust Pilot': '27/08/2026' })],
      removed_platform_brands: [],
      schedule_hidden_brands: [],
      schedule_platform_restrictions: [],
      brand_platform_pause: [],
      brand_schedule: [],
    });
    const fetchFn = vi.fn();
    const result = await resolveAndSyncTabStatuses('TP Brand Injection', client, { apiToken: 'test-token' }, fetchFn as unknown as typeof fetch);
    expect(result).toEqual({ synced: [], failed: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('skips the whole resolve (no PMS calls at all) when the tab watermark matches the last successful sync', async () => {
    const client = fakeMultiTableClient({
      schedule_pms_links: [
        { id: 'link-1', tab: 'TP Brand Injection', brand: 'WinMega', brand_key: 'winmega', platform: 'tp', date: '2026-08-27', pms_task_id: 'task-1', synced_status: 'active' },
      ],
      entries: [{ ...entry('TP Brand Injection', 'e1', { Brands: 'WinMega', 'TP Review Status': 'Done', 'Trust Pilot': '27/08/2026' }), updated_at: '2026-08-27T10:00:00Z' }],
      schedule_pms_sync_watermarks: [{ tab: 'TP Brand Injection', last_seen_max_updated_at: '2026-08-27T10:00:00Z' }],
    });
    const fetchFn = vi.fn();
    const result = await resolveAndSyncTabStatuses('TP Brand Injection', client, { apiToken: 'test-token' }, fetchFn as unknown as typeof fetch);
    expect(result).toEqual({ synced: [], failed: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('records the new tab watermark after a fully successful resolve, so the next tick can skip it', async () => {
    const upserts: { table: string; row: unknown }[] = [];
    const client = fakeMultiTableClient({
      schedule_pms_links: [
        { id: 'link-1', tab: 'TP Brand Injection', brand: 'WinMega', brand_key: 'winmega', platform: 'tp', date: '2026-08-27', pms_task_id: 'task-1', synced_status: 'active' },
      ],
      entries: [{ ...entry('TP Brand Injection', 'e1', { Brands: 'WinMega', 'TP Review Status': 'Done', 'Trust Pilot': '27/08/2026' }), updated_at: '2026-08-27T11:00:00Z' }],
    }, upserts);
    const fetchFn = vi.fn(async (_url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => [] };
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const result = await resolveAndSyncTabStatuses('TP Brand Injection', client, { apiToken: 'test-token' }, fetchFn);
    expect(result.synced).toHaveLength(1);
    expect(upserts.filter((u) => u.table === 'schedule_pms_sync_watermarks')).toEqual([
      { table: 'schedule_pms_sync_watermarks', row: { tab: 'TP Brand Injection', last_seen_max_updated_at: '2026-08-27T11:00:00Z' } },
    ]);
  });

  it('does not record a new tab watermark when a link fails to sync, so the next tick retries it', async () => {
    const upserts: { table: string; row: unknown }[] = [];
    const client = fakeMultiTableClient({
      schedule_pms_links: [
        { id: 'link-1', tab: 'TP Brand Injection', brand: 'WinMega', brand_key: 'winmega', platform: 'tp', date: '2026-08-27', pms_task_id: 'task-1', synced_status: 'active' },
      ],
      entries: [{ ...entry('TP Brand Injection', 'e1', { Brands: 'WinMega', 'TP Review Status': 'Done', 'Trust Pilot': '27/08/2026' }), updated_at: '2026-08-27T12:00:00Z' }],
    }, upserts);
    const fetchFn = vi.fn(async (_url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => [] };
      return { ok: false, status: 500, json: async () => ({}) }; // the PMS move itself fails
    }) as unknown as typeof fetch;
    const result = await resolveAndSyncTabStatuses('TP Brand Injection', client, { apiToken: 'test-token' }, fetchFn);
    expect(result.failed).toHaveLength(1);
    expect(upserts.filter((u) => u.table === 'schedule_pms_sync_watermarks')).toEqual([]);
  });
});
