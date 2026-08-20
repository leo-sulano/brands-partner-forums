# Schedule Planner → PMS Status Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reflect a Schedule Planner cell's real status (Removed/Published/Pending/Done/Active) onto its linked PMS task's column, one-way (dashboard → PMS only), checked automatically once per tab visit.

**Architecture:** A new pure resolver in `scheduleUtils.ts` turns a cell's existing evidence data (`dateStatusIndex`) plus pause state into a target status. A new `synced_status` column on `schedule_pms_links` tracks what was last successfully synced, so only changed links trigger a PMS API call. The Deno-side `pmsSync.ts` module (already shared by the `sync-schedule-pms` Edge Function) gets a new `syncScheduleStatusToPms()` that moves each changed task's column via the PMS "move task" endpoint. `TabScheduleSection.tsx` computes and sends the diff once per tab visit through a new browser-side wrapper, mirroring the existing push/pull PMS calls exactly.

**Tech Stack:** TypeScript, React, Supabase (Postgres + Deno Edge Functions), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-schedule-planner-pms-status-sync-design.md`

## Global Constraints

- Column mapping (verified live against the "Forum Team" PMS project, `cmsoh1uvs000004l4fbdvqmir`): Active → To Do (`cmsoh1uxz000204l46gf88k3f`), Pending → In Progress (`cmsoh1uxz000304l4zynwy7vw`), Done → In Progress (`cmsoh1uxz000304l4zynwy7vw`), Published (Confirmed) → Review/QA (`cmsoh1uxz000404l44x2m2b9a`), Removed → Review/QA (`cmsoh1uxz000404l44x2m2b9a`).
- Paused is excluded entirely — never triggers a move, and a paused link's `synced_status` is left untouched.
- Status precedence when resolving a cell: Removed > Confirmed (Published) > Pending > Done > Paused > Active — mirrors `ScheduleCell`'s existing render precedence in `calendarRenderer.tsx` exactly.
- One-way sync only: dashboard → PMS. A manual PMS column move is never read back or written into `brand_schedule`.
- Runs automatically once per tab visit, alongside the existing `pullScheduleDrift` call — no new UI control.
- Best-effort / fire-and-forget from the caller's perspective, matching every existing PMS call in this feature: a sync failure must never block or be mistaken for a dashboard write failing.

---

### Task 1: `synced_status` column + queries.ts support

**Files:**
- Create: `supabase/migrations/20260820130000_add_schedule_pms_links_synced_status.sql`
- Modify: `src/lib/queries.ts` (the `SchedulePmsLink` interface and `fetchSchedulePmsLinks` at line ~1131-1148; add a new `updateSchedulePmsLinkStatus` function after `updateSchedulePmsLinkDate` at line ~1167)
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Produces: `SchedulePmsLink.synced_status: string`; `updateSchedulePmsLinkStatus(id: string, status: string, client?: SupabaseClient): Promise<void>`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260820130000_add_schedule_pms_links_synced_status.sql
-- Schedule Planner -> PMS status sync (docs/superpowers/specs/2026-08-20-schedule-planner-pms-status-sync-design.md):
--
-- Tracks which status was last successfully reflected onto a linked PMS
-- task's column, so the browser-driven sync only calls the PMS move API for
-- links whose resolved status has actually changed since the last sync --
-- without this, every tab visit would re-issue a move call for every linked
-- task regardless of whether anything changed.
--
-- Existing rows (all created before this column existed, sitting in PMS's To
-- Do column, never moved) default to 'active', which is correct: nothing has
-- ever moved them, so 'active' (-> To Do) is an accurate record of their
-- last-known-synced state.
alter table public.schedule_pms_links
  add column synced_status text not null default 'active'
    check (synced_status in ('active', 'pending', 'done', 'published', 'removed'));
```

- [ ] **Step 2: Write the failing tests for `updateSchedulePmsLinkStatus`**

Add `updateSchedulePmsLinkStatus` to the existing import list from `./queries` near the top of `src/lib/queries.test.ts` (alongside `updateSchedulePmsLinkDate`), then add this test right after the existing `updateSchedulePmsLinkDate` test (~line 229):

```ts
  it('updateSchedulePmsLinkStatus uses the passed-in client and filters by id', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const fakeFrom = vi.fn().mockReturnValue({ update });
    await updateSchedulePmsLinkStatus('link-1', 'published', { from: fakeFrom } as any);
    expect(update).toHaveBeenCalledWith({ synced_status: 'published' });
    expect(eq).toHaveBeenCalledWith('id', 'link-1');
    expect(singletonFrom).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- queries.test.ts -t "updateSchedulePmsLinkStatus"`
Expected: FAIL with `updateSchedulePmsLinkStatus is not defined` (or a TypeScript import error).

- [ ] **Step 4: Implement — extend `SchedulePmsLink`, `fetchSchedulePmsLinks`, and add `updateSchedulePmsLinkStatus`**

In `src/lib/queries.ts`, replace the existing block (~line 1131-1148):

```ts
export interface SchedulePmsLink {
  id: string;
  tab: string;
  brand: string;
  brand_key: string;
  platform: Platform;
  date: string;
  pms_task_id: string;
  synced_status: string;
}

export async function fetchSchedulePmsLinks(tab: string, client: SupabaseClient = supabase): Promise<SchedulePmsLink[]> {
  const { data, error } = await client
    .from('schedule_pms_links')
    .select('id, tab, brand, brand_key, platform, date, pms_task_id, synced_status')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as SchedulePmsLink[];
}
```

Then add this function right after `updateSchedulePmsLinkDate` (~line 1167):

```ts
export async function updateSchedulePmsLinkStatus(id: string, status: string, client: SupabaseClient = supabase): Promise<void> {
  const { error } = await client.from('schedule_pms_links').update({ synced_status: status }).eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- queries.test.ts -t "SchedulePmsLink"`
Expected: PASS (all `SchedulePmsLink`-related tests, including the pre-existing `fetchSchedulePmsLinks`/`insertSchedulePmsLink`/`updateSchedulePmsLinkDate`/`deleteSchedulePmsLink` ones, still pass unchanged).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260820130000_add_schedule_pms_links_synced_status.sql src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: add synced_status tracking column to schedule_pms_links"
```

---

### Task 2: `resolvePmsSyncStatus` pure resolver

**Files:**
- Modify: `src/lib/scheduler/scheduleUtils.ts` (insert after `buildDateStatusIndex`, ~line 143)
- Test: `src/lib/scheduler/scheduleUtils.test.ts`

**Interfaces:**
- Consumes: `DateStatusIndex` (from Task 1's neighbor file, already exists: `{ removed: Set<string>; confirmed: Set<string>; pending: Set<string>; done: Set<string> }`), `Platform` (`'tp' | 'ag' | 'cg' | 'wo'`, from `../removedPlatformBrands.ts`).
- Produces: `export type PmsSyncStatus = 'active' | 'pending' | 'done' | 'published' | 'removed';` and `export function resolvePmsSyncStatus(brandKey: string, platform: Platform, dateISO: string, index: DateStatusIndex, isPaused: boolean): PmsSyncStatus | null` — used by Task 3 (`pmsSync.ts`) and Task 5 (`TabScheduleSection.tsx`).

- [ ] **Step 1: Write the failing tests**

Add `resolvePmsSyncStatus` to the existing import list at the top of `src/lib/scheduler/scheduleUtils.test.ts` (alongside `buildDateStatusIndex`), then add this new describe block after the existing `buildDateStatusIndex` describe block:

```ts
describe('resolvePmsSyncStatus', () => {
  const emptyIndex = { removed: new Set<string>(), confirmed: new Set<string>(), pending: new Set<string>(), done: new Set<string>() };

  it('returns "removed" when the key is in the removed set', () => {
    const index = { ...emptyIndex, removed: new Set(['winmega::tp::2026-08-20']) };
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', index, false)).toBe('removed');
  });

  it('returns "published" when the key is in the confirmed set', () => {
    const index = { ...emptyIndex, confirmed: new Set(['winmega::tp::2026-08-20']) };
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', index, false)).toBe('published');
  });

  it('returns "pending" when the key is in the pending set', () => {
    const index = { ...emptyIndex, pending: new Set(['winmega::tp::2026-08-20']) };
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', index, false)).toBe('pending');
  });

  it('returns "done" when the key is in the done set', () => {
    const index = { ...emptyIndex, done: new Set(['winmega::tp::2026-08-20']) };
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', index, false)).toBe('done');
  });

  it('returns null when paused and no evidence matches', () => {
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', emptyIndex, true)).toBeNull();
  });

  it('returns "active" when not paused and no evidence matches', () => {
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', emptyIndex, false)).toBe('active');
  });

  it('evidence wins over isPaused -- a removed key still resolves to "removed" even when isPaused is true', () => {
    const index = { ...emptyIndex, removed: new Set(['winmega::tp::2026-08-20']) };
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', index, true)).toBe('removed');
  });

  it('follows removed > confirmed > pending > done precedence when a key somehow lands in more than one set', () => {
    const index = {
      removed: new Set(['winmega::tp::2026-08-20']),
      confirmed: new Set(['winmega::tp::2026-08-20']),
      pending: new Set<string>(),
      done: new Set<string>(),
    };
    expect(resolvePmsSyncStatus('winmega', 'tp', '2026-08-20', index, false)).toBe('removed');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- scheduleUtils.test.ts -t "resolvePmsSyncStatus"`
Expected: FAIL with `resolvePmsSyncStatus is not defined`.

- [ ] **Step 3: Implement**

In `src/lib/scheduler/scheduleUtils.ts`, insert this immediately after `buildDateStatusIndex`'s closing `}` (~line 143), before the `buildAgentIndex` doc comment:

```ts
export type PmsSyncStatus = 'active' | 'pending' | 'done' | 'published' | 'removed';

// Resolves the status that should be reflected onto a linked PMS task for one
// exact (brand, platform, date) cell -- mirrors ScheduleCell's own render
// precedence (Removed > Confirmed/Published > Pending > Done > Paused >
// Active, calendarRenderer.tsx) exactly, so a PMS card can never disagree
// with what the calendar itself shows. Returns null for a currently-paused
// (brand, platform) combo with no evidence -- Paused is deliberately excluded
// from PMS sync entirely; the caller must leave that link's synced_status
// untouched rather than moving its task.
export function resolvePmsSyncStatus(
  brandKey: string,
  platform: Platform,
  dateISO: string,
  index: DateStatusIndex,
  isPaused: boolean,
): PmsSyncStatus | null {
  const key = `${brandKey}::${platform}::${dateISO}`;
  if (index.removed.has(key)) return 'removed';
  if (index.confirmed.has(key)) return 'published';
  if (index.pending.has(key)) return 'pending';
  if (index.done.has(key)) return 'done';
  if (isPaused) return null;
  return 'active';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- scheduleUtils.test.ts -t "resolvePmsSyncStatus"`
Expected: PASS (all 8 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/scheduleUtils.ts src/lib/scheduler/scheduleUtils.test.ts
git commit -m "feat: add resolvePmsSyncStatus, resolving a cell's PMS sync status"
```

---

### Task 3: `syncScheduleStatusToPms` + edge function wiring

**Files:**
- Modify: `src/lib/scheduler/pmsSync.ts` (add column ID constants near `PMS_TODO_COLUMN_ID` at line ~16; add new types/function after `pushScheduleToPms`, ~line 212)
- Modify: `supabase/functions/sync-schedule-pms/index.ts` (add a new `syncStatus` action branch, ~line 44-49)
- Test: `src/lib/scheduler/pmsSync.test.ts`

**Interfaces:**
- Consumes: `PmsSyncStatus` (Task 2, `./scheduleUtils.ts`), `updateSchedulePmsLinkStatus` (Task 1, `../queries.ts`).
- Produces: `export interface PmsStatusSyncItem { linkId: string; pmsTaskId: string; targetStatus: PmsSyncStatus }`, `export interface PmsStatusSyncResult { synced: PmsStatusSyncItem[]; failed: { item: PmsStatusSyncItem; error: string }[] }`, `export async function syncScheduleStatusToPms(items: PmsStatusSyncItem[], client: SupabaseClient, credentials: PmsCredentials, fetchFn?: typeof fetch): Promise<PmsStatusSyncResult>` — used by Task 4's edge-function branch and (indirectly, via the Edge Function) Task 5.

- [ ] **Step 1: Write the failing tests**

Add this to `src/lib/scheduler/pmsSync.test.ts`, after the existing `pullScheduleFromPms` describe block. Add `syncScheduleStatusToPms, type PmsStatusSyncItem` to the top import from `./pmsSync`.

```ts
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
      { url: /\/tasks\/task-1\/move$/, method: 'PATCH', body: {} },
    ]);
    const item: PmsStatusSyncItem = { linkId: 'link-1', pmsTaskId: 'task-1', targetStatus: 'published' };
    const result = await syncScheduleStatusToPms([item], client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ synced: [item], failed: [] });
    expect(updated).toEqual([{ id: 'link-1', synced_status: 'published' }]);
  });

  it('records a per-item failure without aborting the rest of the batch, and never updates synced_status for the failed item', async () => {
    const { client, updated } = fakeSupabaseForStatusUpdate();
    const badItem: PmsStatusSyncItem = { linkId: 'link-1', pmsTaskId: 'task-bad', targetStatus: 'removed' };
    const okItem: PmsStatusSyncItem = { linkId: 'link-2', pmsTaskId: 'task-ok', targetStatus: 'active' };
    const fetchFn = fakeFetchSequence([
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
    ['pending', 'cmsoh1uxz000304l4zynwy7vw'],
    ['done', 'cmsoh1uxz000304l4zynwy7vw'],
    ['published', 'cmsoh1uxz000404l44x2m2b9a'],
    ['removed', 'cmsoh1uxz000404l44x2m2b9a'],
  ])('maps target status "%s" to column %s', async (targetStatus, columnId) => {
    const { client } = fakeSupabaseForStatusUpdate();
    let movedBody: unknown;
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      movedBody = JSON.parse(init.body as string);
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    await syncScheduleStatusToPms(
      [{ linkId: 'link-1', pmsTaskId: 'task-1', targetStatus: targetStatus as PmsStatusSyncItem['targetStatus'] }],
      client,
      CREDENTIALS,
      fetchFn,
    );
    expect(movedBody).toEqual({ columnId, position: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- pmsSync.test.ts -t "syncScheduleStatusToPms"`
Expected: FAIL with `syncScheduleStatusToPms is not defined`.

- [ ] **Step 3: Implement in `pmsSync.ts`**

Add these two constants right after `PMS_TODO_COLUMN_ID` (~line 16):

```ts
const PMS_IN_PROGRESS_COLUMN_ID = 'cmsoh1uxz000304l4zynwy7vw';
const PMS_REVIEW_QA_COLUMN_ID = 'cmsoh1uxz000404l44x2m2b9a';
```

Add `type PmsSyncStatus` to the import from `./scheduleUtils.ts` at the top of the file (new import line, since `scheduleUtils.ts` isn't currently imported here):

```ts
import type { PmsSyncStatus } from './scheduleUtils.ts';
```

Add `updateSchedulePmsLinkStatus` to the existing import from `../queries.ts` (~line 8):

```ts
import { fetchSchedulePmsLinks, insertSchedulePmsLink, updateSchedulePmsLinkDate, updateSchedulePmsLinkStatus, deleteSchedulePmsLink, type SchedulePmsLink } from '../queries.ts';
```

Then append this block after `pushScheduleToPms`'s closing `}` (~line 212), before the `PmsDriftedItem` interface:

```ts
const PMS_STATUS_COLUMN_IDS: Record<PmsSyncStatus, string> = {
  active: PMS_TODO_COLUMN_ID,
  pending: PMS_IN_PROGRESS_COLUMN_ID,
  done: PMS_IN_PROGRESS_COLUMN_ID,
  published: PMS_REVIEW_QA_COLUMN_ID,
  removed: PMS_REVIEW_QA_COLUMN_ID,
};

export interface PmsStatusSyncItem {
  linkId: string;
  pmsTaskId: string;
  targetStatus: PmsSyncStatus;
}

export interface PmsStatusSyncResult {
  synced: PmsStatusSyncItem[];
  failed: { item: PmsStatusSyncItem; error: string }[];
}

async function movePmsTask(taskId: string, columnId: string, credentials: PmsCredentials, fetchFn: typeof fetch): Promise<void> {
  const res = await fetchFn(`${PMS_BASE_URL}/tasks/${taskId}/move`, {
    method: 'PATCH',
    headers: pmsHeaders(credentials),
    body: JSON.stringify({ columnId, position: 0 }),
  });
  if (!res.ok) throw new Error(`PMS task move failed: ${res.status}`);
}

// Moves each linked task's PMS column to match its resolved dashboard status
// (see resolvePmsSyncStatus in scheduleUtils.ts for how targetStatus is
// derived client-side) -- one-way, dashboard -> PMS only, never the reverse.
// Per-item try/catch mirrors pushScheduleToPms's existing batch resilience:
// one failed move never blocks the rest. schedule_pms_links.synced_status is
// only updated on a successful move, so a failed item is naturally retried on
// the caller's next sync pass (its resolved status still won't match the
// stale synced_status).
export async function syncScheduleStatusToPms(
  items: PmsStatusSyncItem[],
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<PmsStatusSyncResult> {
  const synced: PmsStatusSyncItem[] = [];
  const failed: { item: PmsStatusSyncItem; error: string }[] = [];
  for (const item of items) {
    try {
      await movePmsTask(item.pmsTaskId, PMS_STATUS_COLUMN_IDS[item.targetStatus], credentials, fetchFn);
      await updateSchedulePmsLinkStatus(item.linkId, item.targetStatus, client);
      synced.push(item);
    } catch (err) {
      failed.push({ item, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { synced, failed };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- pmsSync.test.ts`
Expected: PASS (full file, including all pre-existing `pushScheduleToPms`/`pullScheduleFromPms` tests).

- [ ] **Step 5: Wire up the edge function**

In `supabase/functions/sync-schedule-pms/index.ts`, change the import line (~line 8):

```ts
import { pushScheduleToPms, pullScheduleFromPms, syncScheduleStatusToPms, type PmsSyncItem, type PmsStatusSyncItem } from '../../../src/lib/scheduler/pmsSync.ts';
```

Then add a new branch after the existing `pull` branch (~line 49), before the `Unknown action` fallback:

```ts
    if (body?.action === 'syncStatus') {
      if (!Array.isArray(body.items)) return jsonResponse({ error: 'items must be an array' }, 400);
      const result = await syncScheduleStatusToPms(body.items as PmsStatusSyncItem[], client, credentials);
      return jsonResponse(result);
    }
```

- [ ] **Step 6: Type-check the edge function**

Run: `cd supabase/functions/sync-schedule-pms && deno check index.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/scheduler/pmsSync.ts src/lib/scheduler/pmsSync.test.ts supabase/functions/sync-schedule-pms/index.ts
git commit -m "feat: add syncScheduleStatusToPms and wire it into sync-schedule-pms"
```

---

### Task 4: Browser wrapper `pushScheduleStatusSync`

**Files:**
- Modify: `src/lib/schedulePmsSync.ts`
- Test: `src/lib/schedulePmsSync.test.ts`

**Interfaces:**
- Consumes: `PmsSyncStatus` (Task 2, `./scheduler/scheduleUtils`).
- Produces: `export interface PmsStatusSyncItem { linkId: string; pmsTaskId: string; targetStatus: PmsSyncStatus }`, `export async function pushScheduleStatusSync(items: PmsStatusSyncItem[]): Promise<void>` — used by Task 5 (`TabScheduleSection.tsx`). Returns `void` (not the server's `{synced, failed}` detail), matching `pushScheduleActivations`'s existing fire-and-forget shape exactly — Task 5 never inspects per-item results, only whether the call as a whole threw.

- [ ] **Step 1: Write the failing tests**

Add `pushScheduleStatusSync` to the import from `./schedulePmsSync` at the top of `src/lib/schedulePmsSync.test.ts`, then add this describe block after the existing `pullScheduleDrift` describe block:

```ts
describe('pushScheduleStatusSync', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  const STATUS_ITEM = { linkId: 'link-1', pmsTaskId: 'task-1', targetStatus: 'published' as const };

  it('does nothing for an empty item list', async () => {
    await pushScheduleStatusSync([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts action:syncStatus with the items and an auth header', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ synced: [STATUS_ITEM], failed: [] }) });
    await pushScheduleStatusSync([STATUS_ITEM]);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/sync-schedule-pms',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'test-anon-key', Authorization: expect.stringMatching(/^Bearer /) }),
        body: JSON.stringify({ action: 'syncStatus', items: [STATUS_ITEM] }),
      }),
    );
  });

  it('throws on a non-OK response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(pushScheduleStatusSync([STATUS_ITEM])).rejects.toThrow('Failed to sync schedule status to PMS.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- schedulePmsSync.test.ts -t "pushScheduleStatusSync"`
Expected: FAIL with `pushScheduleStatusSync is not defined`.

- [ ] **Step 3: Implement**

In `src/lib/schedulePmsSync.ts`, add this import at the top:

```ts
import type { PmsSyncStatus } from './scheduler/scheduleUtils';
```

Then append this type and function at the end of the file, after `pullScheduleDrift`:

```ts
export interface PmsStatusSyncItem {
  linkId: string;
  pmsTaskId: string;
  targetStatus: PmsSyncStatus;
}

// Best-effort, mirrors pushScheduleActivations exactly -- the caller has
// already resolved which links changed status; a failure here must never be
// mistaken for a dashboard write failing. Per-item success/failure detail
// stays server-side (see syncScheduleStatusToPms's PmsStatusSyncResult) --
// nothing here consumes it, so it isn't parsed or surfaced.
export async function pushScheduleStatusSync(items: PmsStatusSyncItem[]): Promise<void> {
  if (items.length === 0 || !SYNC_SCHEDULE_PMS_URL) return;
  const res = await fetch(SYNC_SCHEDULE_PMS_URL, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action: 'syncStatus', items }),
  });
  if (!res.ok) throw new Error('Failed to sync schedule status to PMS.');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- schedulePmsSync.test.ts`
Expected: PASS (full file, including all pre-existing `pushScheduleActivations`/`pullScheduleDrift` tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedulePmsSync.ts src/lib/schedulePmsSync.test.ts
git commit -m "feat: add pushScheduleStatusSync browser wrapper"
```

---

### Task 5: Wire into `TabScheduleSection.tsx`

**Files:**
- Modify: `src/components/TabScheduleSection.tsx`

**Interfaces:**
- Consumes: `fetchSchedulePmsLinks` (Task 1, `../lib/queries`), `resolvePmsSyncStatus` (Task 2, `../lib/scheduler/scheduleUtils`), `pushScheduleStatusSync, type PmsStatusSyncItem` (Task 4, `../lib/schedulePmsSync`).
- Produces: nothing consumed elsewhere — this is the final integration point.

No new test file for this task, matching this project's established pattern for page/section-level components (`BrandGroup.tsx`, `Overview.tsx`) — verified via `npm run build` and a manual/live check instead of a dedicated component test file (see `CLAUDE.md`'s Development Guidelines).

- [ ] **Step 1: Add the three new imports**

In `src/components/TabScheduleSection.tsx`, add `fetchSchedulePmsLinks` to the existing `../lib/queries` import block (~line 6-19), e.g. right after `fetchBrandSchedule,` (~line 9):

```ts
  fetchBrandSchedule,
  fetchSchedulePmsLinks,
```

Change the `../lib/schedulePmsSync` import (~line 25) from:

```ts
import { pushScheduleActivations, pullScheduleDrift } from '../lib/schedulePmsSync';
```

to:

```ts
import { pushScheduleActivations, pullScheduleDrift, pushScheduleStatusSync, type PmsStatusSyncItem } from '../lib/schedulePmsSync';
```

Add `resolvePmsSyncStatus` to the existing `../lib/scheduler/scheduleUtils` import block (~line 27), e.g. right after `buildDateStatusIndex,`:

```ts
import { unscheduledPlatforms, buildDateStatusIndex, resolvePmsSyncStatus, buildAgentIndex, buildAgentAssignmentMap, resolveAgentForPlatform, buildResolvedAgentIndex, buildCountryIndex, trailingManualPauseDays, hasNoScheduleThisWeek, PLATFORM_BADGE, PLATFORM_FULL_LABEL, columnsForWeek, weekdayColumnsInRange, countActivePlatformSlots, type ScheduleColumn } from '../lib/scheduler/scheduleUtils';
```

- [ ] **Step 2: Add the new effect right after `dateStatusIndex` is computed**

`dateStatusIndex` must already exist in scope before this effect's closure captures it — inserting any earlier in the component would hit the same temporal-dead-zone bug this file's own `activePlatforms` comment (~line 443-459) already warns about. Insert immediately after the `dateStatusIndex` `useMemo` block closes (~line 432, right before the `// Brand -> Country` comment):

```tsx

  // Reflects each linked task's current calendar-cell status (Removed >
  // Confirmed/Published > Pending > Done > Active) onto its PMS task's
  // column, so someone working the PMS board can see status without opening
  // the dashboard. One-way (dashboard -> PMS only; a manual PMS column move
  // never writes back here) and best-effort, same fire-and-forget/toast-on-
  // failure shape as pushScheduleActivations/pullScheduleDrift above. Keyed
  // on dateStatusIndex (not just `tab`) so it reruns once this tab's real
  // entry evidence has actually loaded/changed, not on a stale prior tab's
  // data -- see the tabCtx.tab === tab guard below, same pattern the
  // pull-drift effect uses. A currently-paused (brand, platform) combo is
  // skipped entirely (resolvePmsSyncStatus returns null) -- Paused
  // deliberately never syncs to PMS.
  useEffect(() => {
    if (!isApproved || !tabCtx || tabCtx.tab !== tab) return;
    let canceled = false;
    (async () => {
      try {
        const links = await fetchSchedulePmsLinks(tab);
        if (canceled || links.length === 0) return;
        const items: PmsStatusSyncItem[] = [];
        for (const link of links) {
          const isPaused = pauses.some((p) => p.brand_key === link.brand_key && p.platform === link.platform);
          const targetStatus = resolvePmsSyncStatus(link.brand_key, link.platform, link.date, dateStatusIndex, isPaused);
          if (targetStatus !== null && targetStatus !== link.synced_status) {
            items.push({ linkId: link.id, pmsTaskId: link.pms_task_id, targetStatus });
          }
        }
        if (!canceled && items.length > 0) {
          await pushScheduleStatusSync(items);
        }
      } catch (err) {
        if (!canceled) setToast({ message: err instanceof Error ? err.message : 'Failed to sync schedule status to PMS', kind: 'error' });
      }
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dateStatusIndex, pauses, isApproved]);
```

- [ ] **Step 3: Build and type-check**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no regressions in any file this touched).

- [ ] **Step 5: Manual/live verification**

Using the dashboard against real Supabase + PMS data (matching this project's established verification pattern for page-level Schedule Planner changes):
1. Open a Brand Tab's Schedule section for a tab with at least one already-linked PMS task (e.g. Rooster Partners).
2. Confirm no error toast appears on load.
3. Edit an entry so its status becomes Published/Removed/Pending/Done for a brand+platform+date that already has a linked PMS task, reload the Schedule Planner tab, and confirm the linked PMS task's card has moved to the mapped column (Review/QA for Published/Removed, In Progress for Pending/Done).
4. Confirm a linked task whose cell is scheduler-paused does NOT move columns.
5. Confirm reloading again with no further status change makes no additional PMS API calls move anything (i.e. the task stays exactly where it landed — no flapping).
6. Revert any test entry edits made during verification.

- [ ] **Step 6: Commit**

```bash
git add src/components/TabScheduleSection.tsx
git commit -m "feat: sync Schedule Planner cell status to linked PMS task columns"
```

---

## Deployment (manual, not part of this plan's automated steps)

Once all 5 tasks are merged, the migration and `sync-schedule-pms` Edge Function need a live deploy before this feature does anything in production, matching this project's existing deploy checklist pattern for this same function (see `CLAUDE.md`'s pending-deploy history for `sync-schedule-pms`):

1. `supabase db push` (applies the `synced_status` migration).
2. `supabase functions deploy sync-schedule-pms`.
3. Confirm via `supabase functions list` that it redeployed successfully (new version number, `ACTIVE`).

No new Vercel env var is needed — this reuses the existing `VITE_SYNC_SCHEDULE_PMS_URL` already configured for the push/pull sync.
