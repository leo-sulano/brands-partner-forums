# Schedule Planner → PMS Task Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Schedule Planner cell becomes active (manual click or auto-generation), create a matching PMS task in the "Forum Team" project's To Do column, due on that exact date — and keep the date in sync if someone edits it directly in PMS.

**Architecture:** A new `schedule_pms_links` table tracks which `(tab, brand, platform, date)` combos already have a linked PMS task, for idempotency and for the pull-reconciliation direction. The actual PMS REST calls live in one new shared module, `src/lib/scheduler/pmsSync.ts`, consumed by both a new browser-facing Edge Function (`sync-schedule-pms`) and the not-yet-deployed `generate-weekly-schedule` cron function — the same "one `src/lib` module, multiple Deno/browser consumers" pattern `schedulerService.ts` itself already uses. The frontend never talks to PMS directly (the API token is server-only); it calls the Edge Function through a thin wrapper (`src/lib/schedulePmsSync.ts`), mirroring `brandRemovedNotification.ts`.

**Tech Stack:** Vite/React/TS frontend, Supabase Postgres + Deno Edge Functions, Vitest (frontend) + Deno test (edge functions), the "Forum Team" PMS REST API (`https://pms-nu-eight.vercel.app/api`).

**Spec:** `docs/superpowers/specs/2026-08-17-schedule-planner-pms-sync-design.md`

## Global Constraints

- Forward-only: sync never touches the 1000+ pre-existing `brand_schedule` rows — only cells that become active after this ships.
- Create-only: the sync never deletes/edits a PMS task because a cell was later un-scheduled or paused. The only thing that flows back from PMS is a due-date/deletion correction detected on the *next* tab load.
- All 11 operational tabs from day one — no phased rollout, no per-tab config.
- PMS project id `cmsoh1uvs000004l4fbdvqmir`, To Do column id `cmsoh1uxz000204l46gf88k3f` — confirmed live via the real API during planning, hardcoded (not env-configurable, per the spec).
- Task title: exactly `"<tab display name> | <brand>"`. Labels: the platform's (`TP`/`AG`/`CG`/`WO`, auto-creating `WO` on first use) plus the existing `Client` label. No assignee, no description.
- Every push/pull failure is non-blocking: the `brand_schedule` write that triggered it has already succeeded before the PMS call is attempted, so a PMS failure surfaces as a toast and never rolls back or blocks the schedule itself.

---

### Task 1: `schedule_pms_links` migration

**Files:**
- Create: `supabase/migrations/20260817120000_add_schedule_pms_links.sql`

**Interfaces:**
- Produces: table `schedule_pms_links(id, tab, brand, brand_key, platform, date, pms_task_id, created_at)`, unique on `(tab, brand_key, platform, date)` — this is what Task 2's query functions read/write.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260817120000_add_schedule_pms_links.sql
-- Schedule Planner -> PMS task sync (docs/superpowers/specs/2026-08-17-schedule-planner-pms-sync-design.md):
--
-- schedule_pms_links is the single source of truth for two questions:
--   - idempotency (push): has this exact (tab, brand_key, platform, date)
--     already got a PMS task, so a re-run of ensureWeekGenerated or a
--     repeated manual click never creates a duplicate?
--   - ownership (pull): which PMS task does this exact scheduled day belong
--     to, so a due-date edit made directly in PMS can be detected and
--     reflected back onto the calendar?
--
-- brand_key follows this project's standing convention (brand_schedule,
-- schedule_hidden_brands, etc.): raw `brand` stored, `brand_key` generated
-- (lower+trim) so brand matching is case/whitespace-insensitive everywhere.
--
-- Only the sync-schedule-pms and generate-weekly-schedule Edge Functions
-- (service-role client) ever write this table -- no browser code writes to
-- it directly. All four RLS policies are still defined explicitly, matching
-- every other flag table in this project (see schedule_hidden_brands),
-- rather than relying on "nothing browser-side ever calls insert/update/
-- delete" as an implicit guarantee.

create table public.schedule_pms_links (
  id          uuid primary key default gen_random_uuid(),
  tab         text not null,
  brand       text not null,
  brand_key   text generated always as (lower(btrim(brand))) stored,
  platform    text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  date        date not null,
  pms_task_id text not null,
  created_at  timestamptz not null default now(),
  unique (tab, brand_key, platform, date)
);

alter table public.schedule_pms_links enable row level security;

create policy "anyone can read schedule_pms_links"
  on public.schedule_pms_links for select using (true);
create policy "approved users can insert schedule_pms_links"
  on public.schedule_pms_links for insert with check (public.is_approved());
create policy "approved users can update schedule_pms_links"
  on public.schedule_pms_links for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete schedule_pms_links"
  on public.schedule_pms_links for delete using (public.is_approved());
```

- [ ] **Step 2: Confirm it matches the established pattern exactly**

Diff this against `supabase/migrations/20260811150000_add_schedule_brand_visibility.sql` — same table shape (`brand` + generated `brand_key`), same 4-policy RLS block using `public.is_approved()`. There is no local Supabase instance in this environment to run the migration against, so there is no automated test for this step; correctness is verified by structural match against a migration that's already live, and the migration itself is applied later via `supabase db push` (see the Deployment task at the end of this plan) — same deferred-apply pattern as every other pending migration already documented in `CLAUDE.md`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260817120000_add_schedule_pms_links.sql
git commit -m "feat: add schedule_pms_links table for Schedule Planner PMS sync"
```

---

### Task 2: `queries.ts` — `schedule_pms_links` read/write functions

**Files:**
- Modify: `src/lib/queries.ts` (add after `deleteBrandPlatformPause`, around line 1051)
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` type, `Platform` type (both already imported in `queries.ts`).
- Produces: `SchedulePmsLink` interface and `fetchSchedulePmsLinks`, `insertSchedulePmsLink`, `updateSchedulePmsLinkDate`, `deleteSchedulePmsLink` — consumed by Task 5/6's `pmsSync.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/queries.test.ts`, inside the existing `describe('queries.ts injectable Supabase client', ...)` block (reuses the file's existing `chain()` helper and `singletonFrom`/`fakeFrom` pattern):

```ts
it('fetchSchedulePmsLinks uses the passed-in client', async () => {
  const fakeFrom = vi.fn().mockReturnValue(chain({ data: [], error: null }));
  await fetchSchedulePmsLinks('X', { from: fakeFrom } as any);
  expect(fakeFrom).toHaveBeenCalledWith('schedule_pms_links');
  expect(singletonFrom).not.toHaveBeenCalled();
});

it('fetchSchedulePmsLinks falls back to the singleton when no client is passed', async () => {
  singletonFrom.mockReturnValue(chain({ data: [], error: null }));
  await fetchSchedulePmsLinks('X');
  expect(singletonFrom).toHaveBeenCalledWith('schedule_pms_links');
});

it('insertSchedulePmsLink uses the passed-in client for the insert', async () => {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const fakeFrom = vi.fn().mockReturnValue({ insert });
  await insertSchedulePmsLink('X', 'WinMega', 'tp', '2026-08-20', 'task-1', { from: fakeFrom } as any);
  expect(fakeFrom).toHaveBeenCalledWith('schedule_pms_links');
  expect(insert).toHaveBeenCalledWith({ tab: 'X', brand: 'WinMega', platform: 'tp', date: '2026-08-20', pms_task_id: 'task-1' });
  expect(singletonFrom).not.toHaveBeenCalled();
});

it('updateSchedulePmsLinkDate uses the passed-in client and filters by id', async () => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  const fakeFrom = vi.fn().mockReturnValue({ update });
  await updateSchedulePmsLinkDate('link-1', '2026-08-21', { from: fakeFrom } as any);
  expect(update).toHaveBeenCalledWith({ date: '2026-08-21' });
  expect(eq).toHaveBeenCalledWith('id', 'link-1');
  expect(singletonFrom).not.toHaveBeenCalled();
});

it('deleteSchedulePmsLink uses the passed-in client and filters by id', async () => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const del = vi.fn().mockReturnValue({ eq });
  const fakeFrom = vi.fn().mockReturnValue({ delete: del });
  await deleteSchedulePmsLink('link-1', { from: fakeFrom } as any);
  expect(eq).toHaveBeenCalledWith('id', 'link-1');
  expect(singletonFrom).not.toHaveBeenCalled();
});
```

Add the four new names to the existing `import { ... } from './queries';` block at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- queries.test.ts`
Expected: FAIL — `fetchSchedulePmsLinks` etc. are not exported from `./queries`.

- [ ] **Step 3: Implement in `queries.ts`**

Add after `deleteBrandPlatformPause`:

```ts
export interface SchedulePmsLink {
  id: string;
  tab: string;
  brand: string;
  brand_key: string;
  platform: Platform;
  date: string;
  pms_task_id: string;
}

export async function fetchSchedulePmsLinks(tab: string, client: SupabaseClient = supabase): Promise<SchedulePmsLink[]> {
  const { data, error } = await client
    .from('schedule_pms_links')
    .select('id, tab, brand, brand_key, platform, date, pms_task_id')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as SchedulePmsLink[];
}

export async function insertSchedulePmsLink(
  tab: string,
  brand: string,
  platform: Platform,
  date: string,
  pmsTaskId: string,
  client: SupabaseClient = supabase,
): Promise<void> {
  const { error } = await client
    .from('schedule_pms_links')
    .insert({ tab, brand, platform, date, pms_task_id: pmsTaskId });
  if (error) throw error;
}

export async function updateSchedulePmsLinkDate(id: string, date: string, client: SupabaseClient = supabase): Promise<void> {
  const { error } = await client.from('schedule_pms_links').update({ date }).eq('id', id);
  if (error) throw error;
}

export async function deleteSchedulePmsLink(id: string, client: SupabaseClient = supabase): Promise<void> {
  const { error } = await client.from('schedule_pms_links').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- queries.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: add schedule_pms_links CRUD functions to queries.ts"
```

---

### Task 3: `weekdayAndWeekStartFor` helper

Converts a PMS due date (which could land on any calendar day, including a weekend if someone edits it by hand) back into a Schedule Planner `(weekStart, Weekday)` pair, or `null` if it's not a Monday–Friday date. Needed by the pull-reconciliation UI wiring in Task 9.

**Files:**
- Modify: `src/lib/scheduleBrands.ts`
- Test: `src/lib/scheduleBrands.test.ts`

**Interfaces:**
- Consumes: `toISODate`, `mondayOf`, `WEEKDAYS`, `Weekday` (all already defined in this file).
- Produces: `weekdayAndWeekStartFor(dateISO: string): { weekStart: string; day: Weekday } | null` — consumed by Task 9.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scheduleBrands.test.ts`:

```ts
describe('weekdayAndWeekStartFor', () => {
  it('resolves a Wednesday to its week start and weekday name', () => {
    expect(weekdayAndWeekStartFor('2026-08-19')).toEqual({ weekStart: '2026-08-17', day: 'wednesday' });
  });

  it('resolves a Monday to itself as the week start', () => {
    expect(weekdayAndWeekStartFor('2026-08-17')).toEqual({ weekStart: '2026-08-17', day: 'monday' });
  });

  it('returns null for a Saturday (no weekday column exists for it)', () => {
    expect(weekdayAndWeekStartFor('2026-08-22')).toBeNull();
  });

  it('returns null for a Sunday', () => {
    expect(weekdayAndWeekStartFor('2026-08-23')).toBeNull();
  });
});
```

Add `weekdayAndWeekStartFor` to the `import { ... } from './scheduleBrands';` line at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- scheduleBrands.test.ts`
Expected: FAIL — `weekdayAndWeekStartFor` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/scheduleBrands.ts`, after `withDayStatus`:

```ts
// Inverse of the weekday-column model: given a real calendar date (e.g. a
// PMS task's due date, which a human can set to anything), returns which
// Schedule Planner week+weekday it belongs to, or null if it falls on a
// Saturday/Sunday -- Schedule Planner has no weekend columns, so a due date
// moved onto a weekend has nowhere to render as "active" until it's moved
// back onto a weekday.
export function weekdayAndWeekStartFor(dateISO: string): { weekStart: string; day: Weekday } | null {
  const [y, m, d] = dateISO.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const index = date.getDay() - 1; // Mon=0 .. Fri=4; Sun=-1, Sat=5
  if (index < 0 || index > 4) return null;
  return { weekStart: toISODate(mondayOf(date)), day: WEEKDAYS[index] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- scheduleBrands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleBrands.ts src/lib/scheduleBrands.test.ts
git commit -m "feat: add weekdayAndWeekStartFor helper for PMS due-date reconciliation"
```

---

### Task 4: `ensureWeekGenerated` reports what it just activated

**Files:**
- Modify: `src/lib/scheduler/schedulerService.ts`
- Test: `src/lib/scheduler/schedulerService.test.ts`

**Interfaces:**
- Consumes: `slots: ScheduledSlot[]` (already computed inside the function via `generateWeekSchedule`), the file's own existing `shiftWeek(iso, days)` helper, `WEEKDAYS` (already imported).
- Produces: `ActivatedSlot` interface and a changed return type — `ensureWeekGenerated(...): Promise<ActivatedSlot[]>` (was `Promise<void>`) — consumed by Task 9 (`TabScheduleSection.tsx`) and Task 10 (`generate-weekly-schedule`).

Existing call sites that do `await ensureWeekGenerated(...)` without using the return value keep compiling unchanged (ignoring a non-void return is valid TS) — only Tasks 9 and 10 actually consume the new value.

- [ ] **Step 1: Write the failing test**

Add to the `describe('ensureWeekGenerated', ...)` block in `src/lib/scheduler/schedulerService.test.ts`. First add `WEEKDAYS, toISODate, type Weekday` to the existing `import ... from '../scheduleBrands';` — wait, this file has no such import yet, so add a new one: `import { WEEKDAYS, toISODate, type Weekday } from '../scheduleBrands';` near the top.

```ts
function dateForWeekday(weekStart: string, day: Weekday): string {
  const index = WEEKDAYS.indexOf(day);
  const [y, m, d] = weekStart.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + index));
}

it('reports the brand/platform/date it just activated', async () => {
  const ctx: TabContext = { brands: ['WinMega'], activePlatforms: ['cg'], entries: [] };
  const activated = await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
  const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
  const activeDay = WEEKDAYS.find((d) => rows[0][d] === 'active')!;
  expect(activated).toEqual([
    { brand: 'WinMega', brandKey: 'winmega', platform: 'cg', date: dateForWeekday('2026-08-03', activeDay) },
  ]);
});

it('returns an empty array when the week already has platform-tagged rows (no-op case)', async () => {
  queries.fetchBrandSchedule.mockResolvedValue([
    { tab: 'BITP', brand_key: 'winmega', week_start: '2026-08-03', platform: 'tp', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
  ]);
  const ctx: TabContext = { brands: ['WinMega'], activePlatforms: ['tp'], entries: [] };
  const activated = await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
  expect(activated).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- schedulerService.test.ts`
Expected: FAIL — `activated` is `undefined`, not an array (current return type is `void`).

- [ ] **Step 3: Implement**

In `src/lib/scheduler/schedulerService.ts`, add the exported interface near `TabContext` and change the function's tail:

```ts
export interface ActivatedSlot {
  brand: string;
  brandKey: string;
  platform: Platform;
  date: string;
}
```

Change the signature and the final two lines:

```ts
export async function ensureWeekGenerated(
  tab: string,
  weekStart: string,
  ctx: TabContext,
  resumedThisWeek: PinnedCombo[],
  client?: SupabaseClient,
): Promise<ActivatedSlot[]> {
  // ... unchanged body up through the `slots = generateWeekSchedule({...})` call ...

  if (slots.length === 0) return [];
  await bulkUpsertBrandSchedule(groupSlotsIntoRows(tab, weekStart, slots), client);
  return slots.map((slot) => ({
    brand: slot.brand,
    brandKey: slot.brandKey,
    platform: slot.platform,
    date: shiftWeek(weekStart, WEEKDAYS.indexOf(slot.day)),
  }));
}
```

(`shiftWeek` and `WEEKDAYS` are already defined/imported in this file — no new imports needed here.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- schedulerService.test.ts`
Expected: PASS (all existing tests too — none of them assert the old `void`/`undefined` return, so none break)

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/schedulerService.ts src/lib/scheduler/schedulerService.test.ts
git commit -m "feat: ensureWeekGenerated reports which brand/platform/date it just activated"
```

---

### Task 5: `pmsSync.ts` — push logic

**Files:**
- Create: `src/lib/scheduler/pmsSync.ts`
- Create: `src/lib/scheduler/pmsSync.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` type; `normalizeBrandKey`, `type Platform` from `../removedPlatformBrands.ts`; `fetchSchedulePmsLinks`, `insertSchedulePmsLink` from `../queries.ts` (Task 2).
- Produces: `PmsCredentials`, `PmsSyncItem`, `PmsPushResult` types and `pushScheduleToPms(items, client, credentials, fetchFn?)` — consumed by Task 7 (Edge Function) and Task 10 (`generate-weekly-schedule`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/scheduler/pmsSync.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- pmsSync.test.ts`
Expected: FAIL — `./pmsSync` does not exist yet.

- [ ] **Step 3: Implement**

```ts
// src/lib/scheduler/pmsSync.ts
// Shared by two Deno consumers -- the browser-facing sync-schedule-pms Edge
// Function and the (not yet deployed) generate-weekly-schedule cron
// function -- plus nothing on the browser side directly, since the PMS API
// token never reaches the browser. Same "one src/lib module, multiple
// server-side consumers" shape schedulerService.ts itself already has.
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeBrandKey, type Platform } from '../removedPlatformBrands.ts';
import { fetchSchedulePmsLinks, insertSchedulePmsLink, updateSchedulePmsLinkDate, deleteSchedulePmsLink, type SchedulePmsLink } from '../queries.ts';

// Confirmed live against the real "Forum Team" PMS project while writing
// this spec (a throwaway test label/task was created via these exact
// endpoints, verified, then deleted). Hardcoded, not env-configurable --
// this integration is 1:1 with one specific PMS project.
const PMS_BASE_URL = 'https://pms-nu-eight.vercel.app/api';
const PMS_PROJECT_ID = 'cmsoh1uvs000004l4fbdvqmir';
const PMS_TODO_COLUMN_ID = 'cmsoh1uxz000204l46gf88k3f';
const PMS_CLIENT_LABEL_NAME = 'Client';
const PMS_PLATFORM_LABEL_NAMES: Record<Platform, string> = { tp: 'TP', ag: 'AG', cg: 'CG', wo: 'WO' };
// Every existing platform label (TP/AG/CG) already has its own color; WO is
// the one platform with no label yet in the live project, auto-created the
// first time a WO item needs tagging.
const WO_LABEL_COLOR = 'blue';

export interface PmsCredentials {
  apiToken: string;
}

export interface PmsSyncItem {
  tab: string;
  tabLabel: string;
  brand: string;
  platform: Platform;
  date: string;
}

export interface PmsPushResult {
  created: PmsSyncItem[];
  skipped: PmsSyncItem[];
  failed: { item: PmsSyncItem; error: string }[];
}

interface PmsLabel {
  id: string;
  name: string;
}

interface PmsTaskCreated {
  id: string;
}

function pmsHeaders(credentials: PmsCredentials): Record<string, string> {
  return { Authorization: `Bearer ${credentials.apiToken}`, 'Content-Type': 'application/json' };
}

async function fetchPmsLabels(credentials: PmsCredentials, fetchFn: typeof fetch): Promise<PmsLabel[]> {
  const res = await fetchFn(`${PMS_BASE_URL}/projects/${PMS_PROJECT_ID}/labels`, { headers: pmsHeaders(credentials) });
  if (!res.ok) throw new Error(`PMS labels fetch failed: ${res.status}`);
  return (await res.json()) as PmsLabel[];
}

async function createPmsLabel(name: string, color: string, credentials: PmsCredentials, fetchFn: typeof fetch): Promise<PmsLabel> {
  const res = await fetchFn(`${PMS_BASE_URL}/projects/${PMS_PROJECT_ID}/labels`, {
    method: 'POST',
    headers: pmsHeaders(credentials),
    body: JSON.stringify({ name, color }),
  });
  if (!res.ok) throw new Error(`PMS label create failed: ${res.status}`);
  return (await res.json()) as PmsLabel;
}

async function resolveLabelId(
  name: string,
  color: string,
  labelCache: PmsLabel[],
  credentials: PmsCredentials,
  fetchFn: typeof fetch,
): Promise<string> {
  const existing = labelCache.find((l) => l.name === name);
  if (existing) return existing.id;
  const created = await createPmsLabel(name, color, credentials, fetchFn);
  labelCache.push(created);
  return created.id;
}

async function createPmsTask(title: string, dueDate: string, credentials: PmsCredentials, fetchFn: typeof fetch): Promise<PmsTaskCreated> {
  const res = await fetchFn(`${PMS_BASE_URL}/projects/${PMS_PROJECT_ID}/tasks`, {
    method: 'POST',
    headers: pmsHeaders(credentials),
    body: JSON.stringify({ title, columnId: PMS_TODO_COLUMN_ID, priority: 'MEDIUM', dueDate }),
  });
  if (!res.ok) throw new Error(`PMS task create failed: ${res.status}`);
  return (await res.json()) as PmsTaskCreated;
}

async function setPmsTaskLabels(taskId: string, labelIds: string[], credentials: PmsCredentials, fetchFn: typeof fetch): Promise<void> {
  const res = await fetchFn(`${PMS_BASE_URL}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: pmsHeaders(credentials),
    body: JSON.stringify({ labelIds }),
  });
  if (!res.ok) throw new Error(`PMS task label update failed: ${res.status}`);
}

// One PMS task per exact (tab, brand, platform, date) -- idempotent via
// schedule_pms_links, so re-running this for a combo that's already linked
// is always safe (no duplicate task, no API calls beyond the links lookup).
// A per-item failure is caught and recorded rather than aborting the batch,
// since these calls come from batches (e.g. every combo ensureWeekGenerated
// just activated for a tab) where one bad item shouldn't block the rest.
export async function pushScheduleToPms(
  items: PmsSyncItem[],
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<PmsPushResult> {
  const created: PmsSyncItem[] = [];
  const skipped: PmsSyncItem[] = [];
  const failed: { item: PmsSyncItem; error: string }[] = [];
  if (items.length === 0) return { created, skipped, failed };

  const linksByTab = new Map<string, SchedulePmsLink[]>();
  let labelCache: PmsLabel[] | null = null;

  for (const item of items) {
    try {
      const brandKey = normalizeBrandKey(item.brand);
      let links = linksByTab.get(item.tab);
      if (!links) {
        links = await fetchSchedulePmsLinks(item.tab, client);
        linksByTab.set(item.tab, links);
      }
      const alreadyLinked = links.some((l) => l.brand_key === brandKey && l.platform === item.platform && l.date === item.date);
      if (alreadyLinked) {
        skipped.push(item);
        continue;
      }

      if (!labelCache) labelCache = await fetchPmsLabels(credentials, fetchFn);
      const platformLabelId = await resolveLabelId(PMS_PLATFORM_LABEL_NAMES[item.platform], WO_LABEL_COLOR, labelCache, credentials, fetchFn);
      const clientLabelId = await resolveLabelId(PMS_CLIENT_LABEL_NAME, WO_LABEL_COLOR, labelCache, credentials, fetchFn);

      const task = await createPmsTask(`${item.tabLabel} | ${item.brand}`, item.date, credentials, fetchFn);
      await setPmsTaskLabels(task.id, [platformLabelId, clientLabelId], credentials, fetchFn);
      await insertSchedulePmsLink(item.tab, item.brand, item.platform, item.date, task.id, client);
      created.push(item);
    } catch (err) {
      failed.push({ item, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { created, skipped, failed };
}
```

Note on `resolveLabelId`'s `color` parameter: it's only ever used when the label doesn't exist yet (`WO`, the one gap in the live project). Passing `WO_LABEL_COLOR` for the `Client`/`TP`/`AG`/`CG` lookups too is harmless — those labels already exist in every real scenario, so `createPmsLabel` is never reached for them; it's a shared helper, not a claim that `Client` would get `WO_LABEL_COLOR` if it were ever missing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- pmsSync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/pmsSync.ts src/lib/scheduler/pmsSync.test.ts
git commit -m "feat: add pushScheduleToPms (Schedule Planner -> PMS task creation)"
```

---

### Task 6: `pmsSync.ts` — pull logic

**Files:**
- Modify: `src/lib/scheduler/pmsSync.ts`
- Modify: `src/lib/scheduler/pmsSync.test.ts`

**Interfaces:**
- Consumes: `fetchSchedulePmsLinks`, `updateSchedulePmsLinkDate`, `deleteSchedulePmsLink` (Task 2).
- Produces: `PmsDriftedItem`, `PmsDeletedItem`, `PmsPullResult` types and `pullScheduleFromPms(tab, client, credentials, fetchFn?)` — consumed by Task 9.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/scheduler/pmsSync.test.ts`:

```ts
import { pullScheduleFromPms } from './pmsSync';

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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- pmsSync.test.ts`
Expected: FAIL — `pullScheduleFromPms` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/scheduler/pmsSync.ts`:

```ts
export interface PmsDriftedItem {
  tab: string;
  brand: string;
  platform: Platform;
  oldDate: string;
  newDate: string;
}

export interface PmsDeletedItem {
  tab: string;
  brand: string;
  platform: Platform;
  date: string;
}

export interface PmsPullResult {
  drifted: PmsDriftedItem[];
  deleted: PmsDeletedItem[];
}

interface PmsTaskListed {
  id: string;
  dueDate: string;
}

async function fetchPmsProjectTasks(credentials: PmsCredentials, fetchFn: typeof fetch): Promise<PmsTaskListed[]> {
  const res = await fetchFn(`${PMS_BASE_URL}/projects/${PMS_PROJECT_ID}/tasks`, { headers: pmsHeaders(credentials) });
  if (!res.ok) throw new Error(`PMS tasks fetch failed: ${res.status}`);
  return (await res.json()) as PmsTaskListed[];
}

// schedule_pms_links writes here (not brand_schedule) -- this table is the
// only thing the service-role Edge Function is allowed to touch under RLS.
// The caller (TabScheduleSection.tsx) is responsible for applying the
// resulting drift/deletion to brand_schedule itself, since that write goes
// through the normal approved-user RLS path, not the service role.
export async function pullScheduleFromPms(
  tab: string,
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<PmsPullResult> {
  const drifted: PmsDriftedItem[] = [];
  const deleted: PmsDeletedItem[] = [];

  const links = await fetchSchedulePmsLinks(tab, client);
  if (links.length === 0) return { drifted, deleted };

  const tasks = await fetchPmsProjectTasks(credentials, fetchFn);
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  for (const link of links) {
    const task = taskById.get(link.pms_task_id);
    if (!task) {
      await deleteSchedulePmsLink(link.id, client);
      deleted.push({ tab: link.tab, brand: link.brand, platform: link.platform, date: link.date });
      continue;
    }
    const liveDate = task.dueDate.slice(0, 10);
    if (liveDate !== link.date) {
      await updateSchedulePmsLinkDate(link.id, liveDate, client);
      drifted.push({ tab: link.tab, brand: link.brand, platform: link.platform, oldDate: link.date, newDate: liveDate });
    }
  }
  return { drifted, deleted };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- pmsSync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/pmsSync.ts src/lib/scheduler/pmsSync.test.ts
git commit -m "feat: add pullScheduleFromPms (reconcile PMS due-date edits back to Schedule Planner)"
```

---

### Task 7: `sync-schedule-pms` Edge Function

**Files:**
- Create: `supabase/functions/sync-schedule-pms/deno.json`
- Create: `supabase/functions/sync-schedule-pms/index.ts`

**Interfaces:**
- Consumes: `pushScheduleToPms`, `pullScheduleFromPms` from `../../../src/lib/scheduler/pmsSync.ts` (Tasks 5/6).
- Produces: the deployed HTTP endpoint Task 8's frontend wrapper calls.

- [ ] **Step 1: Write `deno.json`**

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2"
  }
}
```

(Identical to `supabase/functions/notify-brand-removed/deno.json`.)

- [ ] **Step 2: Write `index.ts`**

```ts
// supabase/functions/sync-schedule-pms/index.ts
// Thin HTTP wrapper: all real logic lives in src/lib/scheduler/pmsSync.ts,
// shared with generate-weekly-schedule so the two never implement the push/
// pull logic twice. Holds PMS_API_TOKEN as a Supabase secret -- the browser
// never sees it.
import { createClient } from '@supabase/supabase-js';
import { pushScheduleToPms, pullScheduleFromPms, type PmsSyncItem } from '../../../src/lib/scheduler/pmsSync.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const PMS_API_TOKEN = Deno.env.get('PMS_API_TOKEN') || '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!req.headers.get('authorization')) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!PMS_API_TOKEN) return jsonResponse({ error: 'PMS sync not configured' }, 500);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const client = createClient(SUPABASE_URL, SERVICE_ROLE);
  const credentials = { apiToken: PMS_API_TOKEN };

  try {
    if (body?.action === 'push') {
      if (!Array.isArray(body.items)) return jsonResponse({ error: 'items must be an array' }, 400);
      const result = await pushScheduleToPms(body.items as PmsSyncItem[], client, credentials);
      return jsonResponse(result);
    }
    if (body?.action === 'pull') {
      if (typeof body.tab !== 'string' || !body.tab) return jsonResponse({ error: 'Missing tab' }, 400);
      const result = await pullScheduleFromPms(body.tab, client, credentials);
      return jsonResponse(result);
    }
    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Sync failed' }, 500);
  }
});
```

- [ ] **Step 3: Verify it typechecks**

Run: `deno check --no-lock --node-modules-dir=none --config supabase/functions/sync-schedule-pms/deno.json supabase/functions/sync-schedule-pms/index.ts`
Expected: no errors (this is the same verification form `generate-weekly-schedule/index.ts`'s own header comment documents, needed because a plain `deno check` from the repo root can silently resolve `@supabase/supabase-js` via the root `node_modules` instead of via this directory's import map).

There is no dedicated test file for this wrapper — `pmsSync.ts`'s own tests (Tasks 5/6) already cover every branch of the actual logic; this file is intentionally too thin to need its own test, matching `notify-brand-removed/index.ts`'s `Deno.serve` handler, which also has no direct test.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/sync-schedule-pms/deno.json supabase/functions/sync-schedule-pms/index.ts
git commit -m "feat: add sync-schedule-pms Edge Function"
```

---

### Task 8: Frontend wrapper — `schedulePmsSync.ts`

**Files:**
- Modify: `src/lib/supabase.ts`
- Create: `src/lib/schedulePmsSync.ts`
- Create: `src/lib/schedulePmsSync.test.ts`

**Interfaces:**
- Consumes: `supabase`, `SUPABASE_ANON_KEY` (already exported from `supabase.ts`); adds `SYNC_SCHEDULE_PMS_URL`.
- Produces: `pushScheduleActivations(items)`, `pullScheduleDrift(tab)` — consumed by Task 9 (`TabScheduleSection.tsx`).

- [ ] **Step 1: Add the env var to `supabase.ts`**

```ts
// sync-schedule-pms Edge Function URL. Set in Vercel env once the
// sync-schedule-pms function is deployed (also needs PMS_API_TOKEN set via
// `supabase secrets set PMS_API_TOKEN=...`). Empty string means a newly-
// scheduled cell saves fine but never creates/reconciles a PMS task.
export const SYNC_SCHEDULE_PMS_URL = import.meta.env?.VITE_SYNC_SCHEDULE_PMS_URL ?? '';
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/schedulePmsSync.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({ data: { session: null } }),
}));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
  SUPABASE_ANON_KEY: 'test-anon-key',
  SYNC_SCHEDULE_PMS_URL: 'https://example.com/sync-schedule-pms',
}));

import { pushScheduleActivations, pullScheduleDrift } from './schedulePmsSync';

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

  it('posts action:pull with the tab and returns the parsed result', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ drifted: [], deleted: [] }) });
    const result = await pullScheduleDrift('BITP');
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/sync-schedule-pms',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'pull', tab: 'BITP' }) }),
    );
    expect(result).toEqual({ drifted: [], deleted: [] });
  });

  it('throws on a non-OK response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(pullScheduleDrift('BITP')).rejects.toThrow('Failed to pull PMS schedule updates.');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -- schedulePmsSync.test.ts`
Expected: FAIL — `./schedulePmsSync` does not exist yet.

- [ ] **Step 4: Implement**

The `PmsSyncItem`/`PmsDriftedItem`/`PmsDeletedItem` interfaces below are deliberately redeclared here rather than imported from `pmsSync.ts` — this file is browser code and `pmsSync.ts` is a Deno/server module (imports `SupabaseClient` server-side types, is never bundled for the browser). This mirrors an existing precedent in this codebase: `NotifyBrandRemovedPayload` is independently declared in both `src/lib/brandRemovedNotification.ts` and `supabase/functions/notify-brand-removed/index.ts`, "kept in sync by hand, not a shared import, per that file's existing thin proxy design" (see `CLAUDE.md`'s task history) — the same shape-only duplication, not a shared-logic drift risk, since these are plain data shapes with no behavior to diverge.

```ts
// src/lib/schedulePmsSync.ts
import { supabase, SUPABASE_ANON_KEY, SYNC_SCHEDULE_PMS_URL } from './supabase';
import type { Platform } from './removedPlatformBrands';

export interface PmsSyncItem {
  tab: string;
  tabLabel: string;
  brand: string;
  platform: Platform;
  date: string;
}

export interface PmsDriftedItem {
  tab: string;
  brand: string;
  platform: Platform;
  oldDate: string;
  newDate: string;
}

export interface PmsDeletedItem {
  tab: string;
  brand: string;
  platform: Platform;
  date: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  let token = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    /* fall back to anon key */
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY };
}

// Best-effort -- every caller has already written the real brand_schedule
// change before calling this; a PMS sync failure must never be mistaken for
// the schedule write itself failing. Callers catch and toast, never let a
// rejection here surface as if the click/generation itself failed.
export async function pushScheduleActivations(items: PmsSyncItem[]): Promise<void> {
  if (items.length === 0 || !SYNC_SCHEDULE_PMS_URL) return;
  const res = await fetch(SYNC_SCHEDULE_PMS_URL, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action: 'push', items }),
  });
  if (!res.ok) throw new Error('Failed to sync schedule to PMS.');
}

export async function pullScheduleDrift(tab: string): Promise<{ drifted: PmsDriftedItem[]; deleted: PmsDeletedItem[] }> {
  if (!SYNC_SCHEDULE_PMS_URL) return { drifted: [], deleted: [] };
  const res = await fetch(SYNC_SCHEDULE_PMS_URL, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action: 'pull', tab }),
  });
  if (!res.ok) throw new Error('Failed to pull PMS schedule updates.');
  return (await res.json()) as { drifted: PmsDriftedItem[]; deleted: PmsDeletedItem[] };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- schedulePmsSync.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase.ts src/lib/schedulePmsSync.ts src/lib/schedulePmsSync.test.ts
git commit -m "feat: add frontend wrapper for sync-schedule-pms Edge Function"
```

---

### Task 9: Wire push/pull into `TabScheduleSection.tsx`

**Files:**
- Modify: `src/components/TabScheduleSection.tsx`

**Interfaces:**
- Consumes: `pushScheduleActivations`, `pullScheduleDrift` (Task 8); `weekdayAndWeekStartFor` (Task 3); `ensureWeekGenerated`'s new return value (Task 4).

No new automated test for this file (it has none today — this page's browser-side wiring is verified live/via build, matching how every other recent change to `TabScheduleSection.tsx`/`BrandGroup.tsx` in this project's history has been verified per `CLAUDE.md`'s established pattern for these two files). Steps below are implementation + manual verification.

- [ ] **Step 1: Add the new imports**

```ts
import { pushScheduleActivations, pullScheduleDrift } from '../lib/schedulePmsSync';
import { /* ...existing names..., */ weekdayAndWeekStartFor } from '../lib/scheduleBrands';
```

(Add `weekdayAndWeekStartFor` into the existing `from '../lib/scheduleBrands'` import line rather than a new line.)

- [ ] **Step 2: Push on manual clicks**

In `handleCellClick`, after the existing `try { await setBrandScheduleDay(...) }` succeeds (i.e., inside the `try` block, after the `await setBrandScheduleDay(...)` line, before the `catch`):

```ts
async function handleCellClick(brand: string, platform: Platform, day: Weekday) {
  if (!isApproved) return;
  const currentStatus: DayStatus = scheduleFor(scheduleRows, tab, brand, weekStartISO, platform)?.[day] ?? null;
  const next = nextStatus(currentStatus);

  setScheduleRows((prev) => withDayStatus(prev, tab, brand, weekStartISO, platform, day, next));
  try {
    await setBrandScheduleDay(tab, brand, weekStartISO, platform, day, next);
    if (next === 'active') {
      const dayIndex = WEEKDAYS.indexOf(day);
      pushScheduleActivations([{ tab, tabLabel: tabDisplayName(tab), brand, platform, date: toISODate(addDays(weekStart, dayIndex)) }]).catch((err) => {
        setToast({ message: err instanceof Error ? err.message : 'Failed to sync to PMS', kind: 'error' });
      });
    }
  } catch (err) {
    setScheduleRows((prev) => withDayStatus(prev, tab, brand, weekStartISO, platform, day, currentStatus));
    setToast({ message: err instanceof Error ? err.message : 'Failed to save', kind: 'error' });
  }
}
```

Apply the identical pattern to `handleSetDayStatus`, gated on `status === 'active'` (its `status` parameter is already typed `'active' | 'paused'`):

```ts
async function handleSetDayStatus(brand: string, platform: Platform, day: Weekday, status: 'active' | 'paused') {
  if (!isApproved) return;
  const currentStatus: DayStatus = scheduleFor(scheduleRows, tab, brand, weekStartISO, platform)?.[day] ?? null;

  setScheduleRows((prev) => withDayStatus(prev, tab, brand, weekStartISO, platform, day, status));
  try {
    await setBrandScheduleDay(tab, brand, weekStartISO, platform, day, status);
    if (status === 'active') {
      const dayIndex = WEEKDAYS.indexOf(day);
      pushScheduleActivations([{ tab, tabLabel: tabDisplayName(tab), brand, platform, date: toISODate(addDays(weekStart, dayIndex)) }]).catch((err) => {
        setToast({ message: err instanceof Error ? err.message : 'Failed to sync to PMS', kind: 'error' });
      });
    }
  } catch (err) {
    setScheduleRows((prev) => withDayStatus(prev, tab, brand, weekStartISO, platform, day, currentStatus));
    setToast({ message: err instanceof Error ? err.message : 'Failed to save', kind: 'error' });
  }
}
```

Both pushes are fire-and-forget (`.catch(...)`, not `await`ed) — the schedule write has already succeeded by this point, so a slow or failing PMS call must never delay or block the cell's own optimistic UI update.

- [ ] **Step 3: Push after auto-generation**

In the schedule-loading effect, change:

```ts
const resumed = await recalculatePauses(tab, weekStartISO, ctx);
await ensureWeekGenerated(tab, weekStartISO, ctx, resumed);
if (canceled) return;
```

to:

```ts
const resumed = await recalculatePauses(tab, weekStartISO, ctx);
const activated = await ensureWeekGenerated(tab, weekStartISO, ctx, resumed);
if (canceled) return;
if (activated.length > 0) {
  pushScheduleActivations(
    activated.map((a) => ({ tab, tabLabel: tabDisplayName(tab), brand: a.brand, platform: a.platform, date: a.date })),
  ).catch((err) => {
    setToast({ message: err instanceof Error ? err.message : 'Failed to sync to PMS', kind: 'error' });
  });
}
```

- [ ] **Step 4: Pull once per tab load**

Add a new effect, keyed on `[tab]` only (not on the displayed week — a due-date edit in PMS can affect any week, not just the one currently shown):

```ts
// Reconciles any due-date edit made directly in PMS back onto the calendar.
// Runs once per tab visit, independent of which week is currently displayed
// -- a linked task's due date can drift into a different week entirely.
useEffect(() => {
  if (!isApproved) return;
  let canceled = false;
  (async () => {
    try {
      const { drifted, deleted } = await pullScheduleDrift(tab);
      if (canceled) return;
      for (const d of deleted) {
        const loc = weekdayAndWeekStartFor(d.date);
        if (loc) await setBrandScheduleDay(d.tab, d.brand, loc.weekStart, d.platform, loc.day, null);
      }
      for (const d of drifted) {
        const oldLoc = weekdayAndWeekStartFor(d.oldDate);
        const newLoc = weekdayAndWeekStartFor(d.newDate);
        if (oldLoc) await setBrandScheduleDay(d.tab, d.brand, oldLoc.weekStart, d.platform, oldLoc.day, null);
        if (newLoc) await setBrandScheduleDay(d.tab, d.brand, newLoc.weekStart, d.platform, newLoc.day, 'active');
      }
      if (!canceled && (drifted.length > 0 || deleted.length > 0)) {
        const rows = await fetchBrandSchedule(tab, weekStartISO);
        if (!canceled) setScheduleRows(rows);
      }
    } catch (err) {
      if (!canceled) setToast({ message: err instanceof Error ? err.message : 'Failed to check PMS schedule updates', kind: 'error' });
    }
  })();
  return () => {
    canceled = true;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [tab]);
```

A drifted/deleted PMS due date landing on a weekend has nowhere to render (`weekdayAndWeekStartFor` returns `null`) — the old day is still cleared, but no new day is set active, matching the spec's accepted limitation that Schedule Planner has no weekend columns.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open Schedule Planner, select a brand tab, click a blank cell to make it active, and confirm in the browser console/network tab that a POST to the (locally empty, since `VITE_SYNC_SCHEDULE_PMS_URL` isn't set yet) sync endpoint is attempted and fails silently into a toast rather than blocking the cell's own optimistic checkmark. Full live verification against the real PMS API happens after Task 11's deploy steps.

- [ ] **Step 6: Run the full test suite and build**

Run: `npm run test`
Expected: PASS (no existing test in this file's absence of a test suite breaks; this confirms nothing else regressed)

Run: `npm run build`
Expected: succeeds with no type errors

- [ ] **Step 7: Commit**

```bash
git add src/components/TabScheduleSection.tsx
git commit -m "feat: wire Schedule Planner cell actions to PMS push/pull sync"
```

---

### Task 10: Wire `generate-weekly-schedule` (pending its own deploy)

**Files:**
- Modify: `supabase/functions/generate-weekly-schedule/index.ts`
- Modify: `supabase/functions/generate-weekly-schedule/index_test.ts`

**Interfaces:**
- Consumes: `pushScheduleToPms` from `../../../src/lib/scheduler/pmsSync.ts` (Task 5); `ensureWeekGenerated`'s new return value (Task 4).

This function itself is still not deployed (per `CLAUDE.md`'s existing Known Issues entry) — this task keeps its code from drifting out of sync with the rest of this feature, so there's no follow-up gap once that pending deploy finally happens, per the design spec's explicit decision to wire this in now rather than later.

- [ ] **Step 1: Write the failing test**

Add to `supabase/functions/generate-weekly-schedule/index_test.ts` (its existing imports already include `generateAllTabs`; add `generateForTab`). This file already defines a `fakeClient(tables: Record<string, unknown[]>)` helper (defaults any unlisted table to `[]`) and an `entry(tab, id, data)` helper, reused directly here rather than hand-rolling a new fake — see the existing `buildTabContext` tests just above this one for the exact same pattern this copies. `'BITP'` as a tab name is not a real operational tab, but `getTabPlatforms`/`getBrandNameCol` (`tab-configs.ts`) both have safe fallbacks for an unconfigured tab (`getTabPlatforms` always includes `'tp'` by default; `getBrandNameCol` falls back to `'Brand Name'`), and the `tab_schemas` row below supplies `'Brands'` as the resolved header anyway, so this is a safe, minimal fixture — the point of this test is `generateForTab`'s wiring, not tab-config resolution (already covered by the `buildTabContext` tests above):

```ts
import { buildTabContext, generateAllTabs, generateForTab } from './index.ts';
```

```ts
Deno.test('generateForTab pushes every combo ensureWeekGenerated just activated to PMS', async () => {
  const client = fakeClient({
    entries: [entry('BITP', '1', { Brands: 'WinMega' })],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
    brand_platform_override: [],
    schedule_hidden_brands: [],
    schedule_platform_restrictions: [],
  });
  const pushedBatches: unknown[][] = [];
  const fakePush = async (items: unknown[]) => {
    pushedBatches.push(items);
    return { created: [], skipped: [], failed: [] };
  };
  await generateForTab('BITP', '2026-08-17', client, fakePush);
  assertEquals(pushedBatches.length, 1);
  assertEquals((pushedBatches[0] as { brand: string }[]).length > 0, true);
  assertEquals((pushedBatches[0] as { brand: string }[])[0].brand, 'WinMega');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-env --allow-net --config supabase/functions/generate-weekly-schedule/deno.json supabase/functions/generate-weekly-schedule/index_test.ts`
Expected: FAIL — `generateForTab` doesn't accept a 4th `pushFn` parameter yet.

- [ ] **Step 3: Implement**

```ts
import { pushScheduleToPms, type PmsSyncItem } from '../../../src/lib/scheduler/pmsSync.ts';

// ...

const PMS_API_TOKEN = Deno.env.get('PMS_API_TOKEN') || '';

export async function generateForTab(
  tab: string,
  weekStart: string,
  client: SupabaseClient,
  pushFn: (items: PmsSyncItem[], client: SupabaseClient, credentials: { apiToken: string }) => Promise<unknown> = pushScheduleToPms,
): Promise<void> {
  const ctx = await buildTabContext(tab, client);
  if (ctx.brands.length === 0 || ctx.activePlatforms.length === 0) return;
  const resumed = await recalculatePauses(tab, weekStart, ctx, client);
  const activated = await ensureWeekGenerated(tab, weekStart, ctx, resumed, client);
  if (activated.length > 0 && PMS_API_TOKEN) {
    const items: PmsSyncItem[] = activated.map((a) => ({ tab, tabLabel: tabDisplayName(tab), brand: a.brand, platform: a.platform, date: a.date }));
    await pushFn(items, client, { apiToken: PMS_API_TOKEN });
  }
}
```

Change this file's existing `import { OPERATIONAL_TABS } from '../../../src/lib/tabs.ts';` to `import { OPERATIONAL_TABS, tabDisplayName } from '../../../src/lib/tabs.ts';` — `tabDisplayName` is a plain function with no external side effects, the same proven-safe cross-import pattern this file already uses for `OPERATIONAL_TABS`/`getTabPlatforms`/etc.

`generateAllTabs`'s own signature is unaffected — it already calls `generateFn(tab, weekStart, client)` with 3 args, and `generateForTab`'s new 4th parameter has a default, so existing calls (both production and `generateAllTabs`'s own injectable-`generateFn` tests) keep working unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-env --allow-net --config supabase/functions/generate-weekly-schedule/deno.json supabase/functions/generate-weekly-schedule/index_test.ts`
Expected: PASS

- [ ] **Step 5: Verify the whole function still typechecks**

Run: `deno check --no-lock --node-modules-dir=none --config supabase/functions/generate-weekly-schedule/deno.json supabase/functions/generate-weekly-schedule/index.ts`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/generate-weekly-schedule/index.ts supabase/functions/generate-weekly-schedule/index_test.ts
git commit -m "feat: push newly-generated combos to PMS from generate-weekly-schedule"
```

---

### Task 11: Env vars, deployment checklist, docs

**Files:**
- Modify: `.env`
- Modify: `.env.example`
- Modify: `CLAUDE.md`
- Modify: `docs/task-history.md`

**Interfaces:** none — documentation/config only.

- [ ] **Step 1: Add the new env var placeholders**

In `.env.example`, add near the other Edge-Function URL entries:

```
# VITE_SYNC_SCHEDULE_PMS_URL : Schedule Planner -> PMS task sync. The sync-schedule-pms Edge
#   Function also needs PMS_API_TOKEN set via `supabase secrets set PMS_API_TOKEN=...`.
VITE_SYNC_SCHEDULE_PMS_URL=https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/sync-schedule-pms
```

In `.env` (the real local file, already has `PMS_API_TOKEN` set): add `VITE_SYNC_SCHEDULE_PMS_URL=` left blank until Step 2 below is actually run, since the function isn't deployed yet.

- [ ] **Step 2: Run the full test suite and build one more time, repo-wide**

Run: `npm run test`
Expected: PASS (full suite, including every test file touched across Tasks 2–8)

Run: `npm run build`
Expected: succeeds

- [ ] **Step 3: Update `CLAUDE.md`'s Dynamic State**

Add a new entry to "Recent Changes" (top of the list, dated with today's date) summarizing what shipped and what's still pending deploy — following this file's own established format for every prior feature (see the `ai-assistant`/`notify-brand-removed` entries for the exact tone/structure: what changed, why, what's deferred). Add a corresponding "Pending manual deploy" bullet to "Known Issues / Backlog" listing the 3 steps below, mirroring the existing `generate-weekly-schedule` and `review-removal-assessment` pending-deploy bullets exactly in structure:

```
1. `supabase db push` (applies the new `schedule_pms_links` table).
2. `supabase secrets set PMS_API_TOKEN=...` then `supabase functions deploy sync-schedule-pms`.
3. Add `VITE_SYNC_SCHEDULE_PMS_URL=<deployed function URL>` to Vercel env, then redeploy.
```

Also note that `generate-weekly-schedule`'s own already-pending deploy now additionally requires `PMS_API_TOKEN` to be set before its push-wiring (Task 10) does anything — it silently no-ops without it (per Task 10's `if (activated.length > 0 && PMS_API_TOKEN)` guard), so this isn't a new blocker on top of its existing pending-deploy status, just an additional thing to set at the same time.

- [ ] **Step 4: Append to `docs/task-history.md`**

Add a new `## Task N: Schedule Planner → PMS Task Sync` entry (use the next sequential task number) summarizing the same information as the CLAUDE.md entry, per this project's standing PMS-workflow rule — the Stop hook auto-syncs this to the PMS board's Review/QA column, no manual API call needed.

- [ ] **Step 5: Commit**

```bash
git add .env .env.example CLAUDE.md docs/task-history.md
git commit -m "docs: document Schedule Planner PMS sync deploy steps and task history"
```

---

## Deployment (manual, after this plan's tasks land)

1. `supabase db push`
2. `supabase secrets set PMS_API_TOKEN=<the value already in .env>`
3. `supabase functions deploy sync-schedule-pms`
4. Add `VITE_SYNC_SCHEDULE_PMS_URL=<deployed function URL>` to Vercel env, redeploy
5. Live-verify: open Schedule Planner, click a blank cell active on a real tab, confirm a real task appears in the "Forum Team" PMS project's To Do column with the right title/label/due date; then edit that task's due date directly in PMS, reload the tab, and confirm the calendar cell moves to match.

`generate-weekly-schedule`'s own deploy (migration + function + `PMS_API_TOKEN`, already documented as pending in `CLAUDE.md`) is unchanged by this plan beyond needing the same `PMS_API_TOKEN` secret once it's finally deployed.
