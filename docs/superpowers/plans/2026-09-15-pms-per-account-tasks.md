# Per-Account PMS Task Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each real account (entry) posting for an already-scheduled brand+platform+day its own PMS task card, assigned to that account's own agent, instead of every account sharing the one card created when the slot's plan first went active.

**Architecture:** Additive on top of the existing single-task-per-slot model, never a replacement. `schedule_pms_links` gains a nullable `entry_id` column (NULL = the existing "generic" plan-level link, unchanged behavior; set = a new entry-tied link representing one specific account). A new `backfillMissingEntryLinks` function (sibling to the existing `backfillMissingScheduledLinks`) finds combos where real entries outnumber existing links and creates the missing entry-tied cards, wired into the same 1-minute cron + daily audit the existing backfill already runs from. Status sync (`resolveAndSyncTabStatuses`) resolves an entry-tied link from that entry's own evidence classification; the generic link keeps its existing combo-aggregate resolution untouched.

**Tech Stack:** TypeScript, Vitest, Supabase Postgres (migrations), Deno Edge Functions (`sync-schedule-pms`).

**Spec:** `docs/superpowers/specs/2026-09-15-pms-per-account-tasks-design.md`

## Global Constraints

- Additive only: `pushScheduleToPms` (the proactive activation-time push) and `computeSchedulePmsParityIssues` are NOT modified — both already work correctly for the generic-link-only case per the spec's "Call sites NOT changed" section.
- `entry_id IS NULL` link = generic (existing behavior, unchanged). `entry_id IS NOT NULL` link = entry-tied (new).
- At most one generic link per `(tab, brand_key, platform, date)`; at most one entry-tied link per `(tab, brand_key, platform, date, entry_id)` — enforced by two partial unique indexes, not the old plain unique constraint.
- New PMS task titles for entry-tied cards: `"<tabLabel> | <brand> — <account>"`.
- Follow this codebase's existing TDD discipline: write the failing test, watch it fail, implement, watch it pass, for every step marked TDD below. Run `npm run build` and the relevant test file after every task; run the full suite + `deno check` on both `generate-weekly-schedule` and `sync-schedule-pms` before the final commit of each task.

---

### Task 1: Schema migration + query-layer support for `entry_id`

**Files:**
- Create: `supabase/migrations/20260915130000_add_schedule_pms_links_entry_id.sql`
- Modify: `src/lib/queries.ts:1671-1736` (`SchedulePmsLink` interface, `fetchSchedulePmsLinks`, `fetchAllSchedulePmsLinks`, `insertSchedulePmsLink`)

**Interfaces:**
- Produces: `SchedulePmsLink.entry_id: string | null`; `insertSchedulePmsLink(tab, brand, platform, date, pmsTaskId, columnId, entryId, client?)` — note the new required `entryId` parameter is inserted before the optional trailing `client` parameter, so every existing call site must be updated to pass `null` explicitly (there is exactly one call site today, inside `pushScheduleToPms`).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260915130000_add_schedule_pms_links_entry_id.sql
-- Per-account PMS task cards (docs/superpowers/specs/2026-09-15-pms-per-account-tasks-design.md):
-- lets more than one PMS task exist for the same (tab, brand_key, platform, date)
-- combo, one per real account (entry), on top of the existing single "generic"
-- plan-level task. entry_id NULL = the existing generic link (unchanged
-- behavior); entry_id set = a new entry-tied link for one specific account.
--
-- The old plain `unique (tab, brand_key, platform, date)` constraint is
-- replaced by two partial unique indexes, since Postgres allows multiple NULLs
-- under a plain unique constraint (which would have let duplicate generic
-- links slip through) but a partial index with `where entry_id is null` closes
-- that gap while still allowing many entry-tied rows per combo.

alter table public.schedule_pms_links
  add column entry_id uuid references public.entries(id) on delete set null;

alter table public.schedule_pms_links
  drop constraint schedule_pms_links_tab_brand_key_platform_date_key;

create unique index schedule_pms_links_one_generic_per_combo
  on public.schedule_pms_links (tab, brand_key, platform, date)
  where entry_id is null;

create unique index schedule_pms_links_one_per_entry
  on public.schedule_pms_links (tab, brand_key, platform, date, entry_id)
  where entry_id is not null;
```

- [ ] **Step 2: Confirm the exact constraint name to drop**

Run against the live database (read-only):
```sql
select conname from pg_constraint where conrelid = 'public.schedule_pms_links'::regclass and contype = 'u';
```
If the name differs from `schedule_pms_links_tab_brand_key_platform_date_key` (Postgres's default auto-generated name for a `unique (tab, brand_key, platform, date)` constraint declared inline in `create table`), update Step 1's `drop constraint` line to match the real name before applying.

- [ ] **Step 3: Update `SchedulePmsLink` and the two fetch functions**

In `src/lib/queries.ts`, replace lines 1671-1721:

```typescript
export interface SchedulePmsLink {
  id: string;
  tab: string;
  brand: string;
  brand_key: string;
  platform: Platform;
  date: string;
  pms_task_id: string;
  synced_status: string;
  synced_column_id: string;
  // NULL for the original "generic" plan-level link (one per combo, created
  // when the slot's plan first went active -- unchanged behavior). Set to a
  // specific entries.id for a new entry-tied link representing one real
  // account's own posting -- see docs/superpowers/specs/2026-09-15-pms-per-account-tasks-design.md.
  entry_id: string | null;
}

export async function fetchSchedulePmsLinks(tab: string, client: SupabaseClient = supabase): Promise<SchedulePmsLink[]> {
  const { data, error } = await client
    .from('schedule_pms_links')
    .select('id, tab, brand, brand_key, platform, date, pms_task_id, synced_status, synced_column_id, entry_id')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as SchedulePmsLink[];
}

// Every link, all tabs -- used by the column-drift reconcile
// (enforcePmsColumns, src/lib/scheduler/pmsSync.ts), which must also correct
// cards on schedule-paused/archived tabs the per-tab status sweep never
// touches. Paginated for the same reason fetchEntryCredentials is: an
// unpaginated select silently caps at PostgREST's 1,000-row default, and
// this table grows one row per scheduled (tab, brand, platform, date) --
// now potentially several rows per combo, one per account.
export async function fetchAllSchedulePmsLinks(client: SupabaseClient = supabase): Promise<SchedulePmsLink[]> {
  const PAGE = 1000;
  const all: SchedulePmsLink[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from('schedule_pms_links')
      .select('id, tab, brand, brand_key, platform, date, pms_task_id, synced_status, synced_column_id, entry_id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as SchedulePmsLink[]));
    if ((data ?? []).length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export async function insertSchedulePmsLink(
  tab: string,
  brand: string,
  platform: Platform,
  date: string,
  pmsTaskId: string,
  columnId: string,
  entryId: string | null,
  client: SupabaseClient = supabase,
): Promise<void> {
  const { error } = await client
    .from('schedule_pms_links')
    .insert({ tab, brand, platform, date, pms_task_id: pmsTaskId, synced_column_id: columnId, entry_id: entryId });
  if (error) throw error;
}
```

- [ ] **Step 4: Update the one existing call site**

In `src/lib/scheduler/pmsSync.ts`, find the `insertSchedulePmsLink` call inside `pushScheduleToPms` (currently reads `await insertSchedulePmsLink(item.tab, item.brand, item.platform as Platform, item.date, task.id, PMS_TODO_COLUMN_ID, client);`) and add `null` for the new `entryId` parameter, before the trailing `client` argument:

```typescript
      await insertSchedulePmsLink(item.tab, item.brand, item.platform as Platform, item.date, task.id, PMS_TODO_COLUMN_ID, null, client);
```

Also update the in-memory `links.push(...)` two lines below it in the same function to include `entry_id: null`:

```typescript
      links.push({ id: '', tab: item.tab, brand: item.brand, brand_key: brandKey, platform: item.platform as Platform, date: item.date, pms_task_id: task.id, synced_status: 'active', synced_column_id: PMS_TODO_COLUMN_ID, entry_id: null });
```

- [ ] **Step 5: Run the build and full suite**

```bash
npm run build
npx vitest run
```
Expected: build clean, all tests pass (the type change ripples through any test file that constructs a `SchedulePmsLink` object literal directly — fix each one by adding `entry_id: null`, the same mechanical fix already done twice this session for `DateStatusIndex` fixtures).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260915130000_add_schedule_pms_links_entry_id.sql src/lib/queries.ts src/lib/scheduler/pmsSync.ts
git commit -m "feat: add entry_id column to schedule_pms_links for per-account PMS tasks"
```

Do NOT run `supabase db push` yet — the migration is applied once, at the end, alongside deploying both edge functions (Task 6).

---

### Task 2: `EntryDetails` gains `id` and `kind`

**Files:**
- Modify: `src/lib/scheduler/scheduleUtils.ts` (`EntryDetails` interface, `buildDateStatusIndex`)
- Test: `src/lib/scheduler/scheduleUtils.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `EntryDetails.id: string` (the entry's own `entries.id`), `EntryDetails.kind: DateEvidenceKind` (which of `'removed' | 'confirmed' | 'pending' | 'done'` this specific entry landed in).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/scheduler/scheduleUtils.test.ts`, inside the existing `describe('buildDateStatusIndex', ...)` block (near the other "captures ... details" tests):

```typescript
  it('captures each entry\'s own id and evidence kind alongside its other details', () => {
    const entries = [
      entry({ Brands: 'WinMega', 'TP Review Status': 'Done', 'Trust Pilot': '2026-07-28' }),
      entry({ Brands: 'WinMega', 'TP Review Status': 'Removed', 'Trust Pilot': '2026-07-28' }),
    ];
    entries[0].id = 'entry-done';
    entries[1].id = 'entry-removed';
    const { entries: index } = buildDateStatusIndex(entries);
    const list = index.get('winmega::tp::2026-07-28');
    expect(list?.map((e) => ({ id: e.id, kind: e.kind }))).toEqual([
      { id: 'entry-done', kind: 'done' },
      { id: 'entry-removed', kind: 'removed' },
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/scheduler/scheduleUtils.test.ts -t "captures each entry's own id and evidence kind"
```
Expected: FAIL — `e.id`/`e.kind` are `undefined` (the fields don't exist yet on `EntryDetails`).

- [ ] **Step 3: Add the fields and populate them**

In `src/lib/scheduler/scheduleUtils.ts`, update the `EntryDetails` interface:

```typescript
export interface EntryDetails {
  id: string;
  kind: DateEvidenceKind;
  account: string;
  agent: string;
  country: string;
  proxy: string;
  content: string;
}
```

`DateEvidenceKind` is declared later in this same file (`export type DateEvidenceKind = 'removed' | 'confirmed' | 'pending' | 'done';`, currently after `buildDateStatusIndex`) — move that type declaration to just above the `EntryDetails` interface so it's defined before use.

In `buildDateStatusIndex`, the loop already computes which target Set an entry belongs to (`removed`/`confirmed`/`pending`/`done`) via the `target` variable before building `entryDetail`. Capture the matching kind string alongside it:

```typescript
      const target = isRemovedStatus(status)
        ? removed
        : isLiveStatus(status)
          ? confirmed
          : isPendingStatus(status)
            ? pending
            : isDoneStatus(status)
              ? done
              : null;
      if (!target) continue;
      const kind: DateEvidenceKind =
        target === removed ? 'removed' : target === confirmed ? 'confirmed' : target === pending ? 'pending' : 'done';
      const date = parsePostDate(pick(entry.data, PLATFORM_DATE_KEYS[platform]));
      if (!date) continue;
      const key = `${brandKey}::${platform}::${toISODate(date)}`;
      target.add(key);
      const entryDetail: EntryDetails = {
        id: entry.id,
        kind,
        account: (entry.data.Account ?? '').trim(),
        agent: (entry.data.Agent ?? '').trim(),
        country: (entry.data.Country ?? '').trim(),
        proxy: (entry.data['Proxy Used'] ?? '').trim(),
        content: (getReviewText(entry.data, platform) ?? '').trim(),
      };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/scheduler/scheduleUtils.test.ts
```
Expected: the new test passes. Other existing tests in this file that build `EntryDetails` object literals directly (the "captures Account/Agent/Country/Proxy/content details" tests, the `getEntryList` tests, the `countActivePlatformSlots` fixtures) will now fail to type-check or fail their `toEqual` assertions, since they don't include `id`/`kind`. Fix each one: add `id: 'x'` (or a distinct fake id per entry where the test cares about ordering) and the correct `kind` matching that fixture's own status, mirroring the exact mechanical fixture-repair already done twice this session for the `counts` → `entries` rename.

- [ ] **Step 5: Run full suite and build**

```bash
npx vitest run
npm run build
```
Expected: all pass, clean build.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler/scheduleUtils.ts src/lib/scheduler/scheduleUtils.test.ts
git commit -m "feat: EntryDetails gains id and kind for per-entry PMS task resolution"
```

---

### Task 3: `resolveEntryPmsStatus`

**Files:**
- Modify: `src/lib/scheduler/pmsSync.ts` (near `resolvePmsSyncStatus`)
- Test: `src/lib/scheduler/pmsSync.test.ts`

**Interfaces:**
- Consumes: `DateEvidenceKind` (from Task 2).
- Produces: `resolveEntryPmsStatus(kind: DateEvidenceKind): PmsSyncStatus`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/scheduler/pmsSync.test.ts`, in a new `describe` block near the existing `resolvePmsSyncStatus` tests:

```typescript
describe('resolveEntryPmsStatus', () => {
  it('maps each evidence kind straight to its PMS status, with no pause branch', () => {
    expect(resolveEntryPmsStatus('removed')).toBe('removed');
    expect(resolveEntryPmsStatus('confirmed')).toBe('published');
    expect(resolveEntryPmsStatus('pending')).toBe('pending');
    expect(resolveEntryPmsStatus('done')).toBe('done');
  });
});
```

Add `resolveEntryPmsStatus` to this test file's import line at the top (`import { ... resolveEntryPmsStatus } from './pmsSync';`).

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/scheduler/pmsSync.test.ts -t "resolveEntryPmsStatus"
```
Expected: FAIL — `resolveEntryPmsStatus is not a function` (not exported yet).

- [ ] **Step 3: Implement**

In `src/lib/scheduler/pmsSync.ts`, add near `resolvePmsSyncStatus` (reuse its `type PmsSyncStatus` already exported from `scheduleUtils.ts` and imported at the top of this file):

```typescript
// An entry-tied schedule_pms_links row (entry_id set) always represents a
// SETTLED real posting -- it only ever gets created because that specific
// entry already landed in one of the four evidence categories (see
// backfillMissingEntryLinks below). Unlike resolvePmsSyncStatus (used for the
// generic, plan-level link), there is no isPaused branch here: a settled
// account can never be "paused" or "active" (not-yet-decided) -- those are
// plan-level concepts that don't apply to history that already happened.
export function resolveEntryPmsStatus(kind: DateEvidenceKind): PmsSyncStatus {
  if (kind === 'removed') return 'removed';
  if (kind === 'confirmed') return 'published';
  if (kind === 'pending') return 'pending';
  return 'done';
}
```

`DateEvidenceKind` needs to be imported into `pmsSync.ts` from `./scheduleUtils.ts` — add it to the existing import line (`import { buildDateStatusIndex, resolvePmsSyncStatus, hasDateEvidence, buildBrandDisplayMap, columnsForWeek, type PmsSyncStatus, type EntryDetails, type DateEvidenceKind } from './scheduleUtils.ts';`).

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/scheduler/pmsSync.test.ts -t "resolveEntryPmsStatus"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/pmsSync.ts src/lib/scheduler/pmsSync.test.ts
git commit -m "feat: add resolveEntryPmsStatus for entry-tied PMS link status resolution"
```

---

### Task 4: `backfillMissingEntryLinks`

**Files:**
- Modify: `src/lib/scheduler/pmsSync.ts` (new function, plus widen `createPmsTask` with an optional `columnId` parameter)
- Test: `src/lib/scheduler/pmsSync.test.ts`

**Interfaces:**
- Consumes: `getEntryList`/`buildDateStatusIndex` (`scheduleUtils.ts`), `buildBrandDisplayMap`, `resolveBrandPlatforms`, `fetchSchedulePmsLinks`, `insertSchedulePmsLink` (now taking `entryId`), `createPmsTask`, `setPmsTaskLabelsAndAssignee`, `fetchPmsTeamMembers`, `resolveAssigneeId`, `fetchPmsLabels`, `resolveLabelId`, `getPmsPlatformLabel`, `buildTaskDescription`, `columnsForWeek`.
- Produces: `export interface PmsEntryLinkResult { created: { tab: string; brand: string; platform: SchedulablePlatform; date: string; account: string }[]; failed: { tab: string; brand: string; platform: SchedulablePlatform; date: string; account: string; error: string }[]; }` and `export async function backfillMissingEntryLinks(tab: string, weekStart: string, client: SupabaseClient, credentials: PmsCredentials, fetchFn: typeof fetch = fetch): Promise<PmsEntryLinkResult>`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scheduler/pmsSync.test.ts`, in a new `describe('backfillMissingEntryLinks', ...)` block near `describe('backfillMissingScheduledLinks', ...)`. Uses the same `fakeMultiTableClient`/`fakeFetchSequence`/`CREDENTIALS` helpers already defined earlier in this file.

```typescript
describe('backfillMissingEntryLinks', () => {
  const TAB = 'TP Brand Injection';
  const WEEK = '2026-09-14'; // Monday

  function entryRow(overrides: Partial<{ id: string; account: string; agent: string; status: string; date: string }> = {}) {
    return {
      id: overrides.id ?? 'e1',
      tab: TAB,
      sheet_row_id: '1',
      updated_at: '',
      last_edited_by: 'dashboard',
      last_sync_tag: null,
      data: {
        Brands: 'Casino Magius',
        Account: overrides.account ?? '504 | BI TP | Netherlands',
        Agent: overrides.agent ?? 'LAI',
        'TP Review Status': overrides.status ?? 'Done',
        'Trust Pilot': overrides.date ?? '2026-09-15',
      },
    };
  }

  it('creates one entry-tied task for each account beyond the pre-existing generic link', async () => {
    const client = fakeMultiTableClient({
      entries: [
        entryRow({ id: 'e1', account: '504 | BI TP | Netherlands', agent: 'LAI' }),
        entryRow({ id: 'e2', account: '506 | BI TP | Netherlands', agent: 'JEN' }),
        entryRow({ id: 'e3', account: '512 | BI TP | Netherlands', agent: 'ANN' }),
      ],
      schedule_pms_links: [
        { id: 'link-1', tab: TAB, brand: 'Casino Magius', brand_key: 'casino magius', platform: 'tp', date: '2026-09-15', pms_task_id: 'task-existing', synced_status: 'active', synced_column_id: 'col-todo', entry_id: null },
      ],
      brand_catalog: [],
      removed_platform_brands: [],
      schedule_hidden_brands: [],
      schedule_platform_restrictions: [],
    });
    const fetchFn = fakeFetchSequence([
      { url: /\/teams\//, method: 'GET', body: { members: [{ user: { id: 'u-jen', name: 'JEN' } }, { user: { id: 'u-ann', name: 'ANN' } }] } },
      { url: /\/labels$/, method: 'GET', body: [{ id: 'label-tp', name: 'TP' }, { id: 'label-client', name: 'Client' }] },
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-2' } },
      { url: /\/tasks\/task-2$/, method: 'PATCH', body: {} },
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-3' } },
      { url: /\/tasks\/task-3$/, method: 'PATCH', body: {} },
    ]);
    const result = await backfillMissingEntryLinks(TAB, WEEK, client, CREDENTIALS, fetchFn);
    expect(result.created).toEqual([
      { tab: TAB, brand: 'Casino Magius', platform: 'tp', date: '2026-09-15', account: '506 | BI TP | Netherlands' },
      { tab: TAB, brand: 'Casino Magius', platform: 'tp', date: '2026-09-15', account: '512 | BI TP | Netherlands' },
    ]);
    expect(result.failed).toEqual([]);
  });

  it('is a no-op when every entry already has its own link (or is covered by the generic link)', async () => {
    const client = fakeMultiTableClient({
      entries: [entryRow({ id: 'e1' })],
      schedule_pms_links: [
        { id: 'link-1', tab: TAB, brand: 'Casino Magius', brand_key: 'casino magius', platform: 'tp', date: '2026-09-15', pms_task_id: 'task-existing', synced_status: 'active', synced_column_id: 'col-todo', entry_id: null },
      ],
      brand_catalog: [],
      removed_platform_brands: [],
      schedule_hidden_brands: [],
      schedule_platform_restrictions: [],
    });
    const fetchFn = vi.fn(async () => { throw new Error('should never call the PMS API when nothing is missing'); }) as unknown as typeof fetch;
    const result = await backfillMissingEntryLinks(TAB, WEEK, client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ created: [], failed: [] });
  });

  it('creates entry-tied links for every entry when no generic link exists yet', async () => {
    const client = fakeMultiTableClient({
      entries: [entryRow({ id: 'e1', account: '504 | BI TP | Netherlands', agent: 'LAI' })],
      schedule_pms_links: [],
      brand_catalog: [],
      removed_platform_brands: [],
      schedule_hidden_brands: [],
      schedule_platform_restrictions: [],
    });
    const fetchFn = fakeFetchSequence([
      { url: /\/teams\//, method: 'GET', body: { members: [{ user: { id: 'u-lai', name: 'LAI' } }] } },
      { url: /\/labels$/, method: 'GET', body: [{ id: 'label-tp', name: 'TP' }, { id: 'label-client', name: 'Client' }] },
      { url: /\/tasks$/, method: 'POST', body: { id: 'task-1' } },
      { url: /\/tasks\/task-1$/, method: 'PATCH', body: {} },
    ]);
    const result = await backfillMissingEntryLinks(TAB, WEEK, client, CREDENTIALS, fetchFn);
    expect(result.created).toEqual([
      { tab: TAB, brand: 'Casino Magius', platform: 'tp', date: '2026-09-15', account: '504 | BI TP | Netherlands' },
    ]);
  });

  it('skips a combo whose platform is flagged page-removed for that brand', async () => {
    const client = fakeMultiTableClient({
      entries: [
        entryRow({ id: 'e1', account: '504 | BI TP | Netherlands' }),
        entryRow({ id: 'e2', account: '506 | BI TP | Netherlands' }),
      ],
      schedule_pms_links: [],
      brand_catalog: [],
      removed_platform_brands: [{ tab: TAB, brand: 'Casino Magius', brand_key: 'casino magius', platform: 'tp' }],
      schedule_hidden_brands: [],
      schedule_platform_restrictions: [],
    });
    const fetchFn = vi.fn(async () => { throw new Error('should never call the PMS API for an excluded combo'); }) as unknown as typeof fetch;
    const result = await backfillMissingEntryLinks(TAB, WEEK, client, CREDENTIALS, fetchFn);
    expect(result).toEqual({ created: [], failed: [] });
  });
});
```

Add `backfillMissingEntryLinks` to this test file's import line at the top.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/scheduler/pmsSync.test.ts -t "backfillMissingEntryLinks"
```
Expected: FAIL — `backfillMissingEntryLinks is not a function`.

- [ ] **Step 3: Widen `createPmsTask` with an optional `columnId`**

In `src/lib/scheduler/pmsSync.ts`, change:

```typescript
async function createPmsTask(title: string, dueDate: string, credentials: PmsCredentials, fetchFn: typeof fetch): Promise<PmsTaskCreated> {
  const res = await fetchFn(`${PMS_BASE_URL}/projects/${PMS_PROJECT_ID}/tasks`, {
    method: 'POST',
    headers: pmsHeaders(credentials),
    body: JSON.stringify({ title, columnId: PMS_TODO_COLUMN_ID, priority: 'MEDIUM', dueDate }),
  });
  if (!res.ok) throw new Error(`PMS task create failed: ${res.status}`);
  return (await res.json()) as PmsTaskCreated;
}
```

to:

```typescript
async function createPmsTask(title: string, dueDate: string, credentials: PmsCredentials, fetchFn: typeof fetch, columnId: string = PMS_TODO_COLUMN_ID): Promise<PmsTaskCreated> {
  const res = await fetchFn(`${PMS_BASE_URL}/projects/${PMS_PROJECT_ID}/tasks`, {
    method: 'POST',
    headers: pmsHeaders(credentials),
    body: JSON.stringify({ title, columnId, priority: 'MEDIUM', dueDate }),
  });
  if (!res.ok) throw new Error(`PMS task create failed: ${res.status}`);
  return (await res.json()) as PmsTaskCreated;
}
```

(The existing call site in `pushScheduleToPms` doesn't pass a 5th argument, so it keeps defaulting to `PMS_TODO_COLUMN_ID` — no behavior change there.)

- [ ] **Step 4: Implement `backfillMissingEntryLinks`**

Add to `src/lib/scheduler/pmsSync.ts`, after `backfillMissingScheduledLinks`:

```typescript
export interface PmsEntryLinkResult {
  created: { tab: string; brand: string; platform: SchedulablePlatform; date: string; account: string }[];
  failed: { tab: string; brand: string; platform: SchedulablePlatform; date: string; account: string; error: string }[];
}

// Sibling to backfillMissingScheduledLinks above, NOT a modification of it --
// this one is driven by real evidence (dateStatusIndex.entries), not the
// plan (brand_schedule). For every (tab, brand_key, platform, date) combo
// with more real entries than schedule_pms_links rows, creates the missing
// entry-tied cards (entry_id set), one per uncovered account, each assigned
// to that account's own Agent. The pre-existing generic link (entry_id null,
// created by pushScheduleToPms when the slot's plan first went active) is
// left completely untouched -- see docs/superpowers/specs/2026-09-15-pms-per-account-tasks-design.md
// for the full "why" and the positional-coverage rule below.
export async function backfillMissingEntryLinks(
  tab: string,
  weekStart: string,
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<PmsEntryLinkResult> {
  const created: PmsEntryLinkResult['created'] = [];
  const failed: PmsEntryLinkResult['failed'] = [];

  const [entries, links, catalogRows, removedPlatformBrandRows, hiddenBrandRows, restrictedBrandRows] = await Promise.all([
    fetchRawEntriesByTab(tab, client),
    fetchSchedulePmsLinks(tab, client),
    fetchBrandCatalog(tab, client).catch(() => []),
    fetchRemovedPlatformBrands(client),
    fetchScheduleHiddenBrands(tab, client),
    fetchScheduleRestrictedBrands(tab, client),
  ]);

  const dateStatusIndex = buildDateStatusIndex(entries);
  const brandDisplay = buildBrandDisplayMap(entries, catalogRows.map((r) => r.brand));
  const removedPlatformBrandSet = buildRemovedPlatformBrandSet(removedPlatformBrandRows);
  const hiddenBrandSet = buildHiddenBrandSet(hiddenBrandRows);
  const platformRestrictionMap = buildPlatformRestrictionMap(restrictedBrandRows);
  const tabPlatforms = getTabPlatforms(tab);
  const tabLabel = tabDisplayName(tab);
  const weekISOs = new Set(columnsForWeek(new Date(`${weekStart}T00:00:00`)).map((c) => c.iso));

  let labelCache: PmsLabel[] | null = null;
  let teamMembers: PmsTeamMember[] | null = null;

  for (const [key, entryList] of dateStatusIndex.entries) {
    const [brandKey, platform, date] = key.split('::');
    if (!weekISOs.has(date)) continue;
    const brand = brandDisplay.get(brandKey) ?? brandKey;
    const allowedPlatforms = resolveBrandPlatforms(tab, brand, tabPlatforms, hiddenBrandSet, platformRestrictionMap, removedPlatformBrandSet);
    // platform here is a raw string pulled out of the index key -- every key
    // this loop sees was itself built from a real SchedulablePlatform in
    // buildDateStatusIndex, so this narrowing is safe at runtime; TypeScript
    // just can't track it through the split('::').
    if (!allowedPlatforms.includes(platform as SchedulablePlatform)) continue;

    const comboLinks = links.filter((l) => l.brand_key === brandKey && l.platform === platform && l.date === date);
    const linkedEntryIds = new Set(comboLinks.filter((l) => l.entry_id != null).map((l) => l.entry_id));
    const genericCoverage = comboLinks.some((l) => l.entry_id == null) ? 1 : 0;
    const unlinkedEntries = entryList.filter((entry, i) => !linkedEntryIds.has(entry.id) && i >= genericCoverage);
    if (unlinkedEntries.length === 0) continue;

    const currentColumnId = comboLinks[0]?.synced_column_id ?? PMS_TODO_COLUMN_ID;

    for (const entryDetail of unlinkedEntries) {
      let createdTaskId: string | null = null;
      try {
        if (!labelCache) labelCache = await fetchPmsLabels(credentials, fetchFn);
        const platformLabelId = await resolveLabelId(getPmsPlatformLabel(platform as SchedulablePlatform), WO_LABEL_COLOR, labelCache, credentials, fetchFn);
        const clientLabelId = await resolveLabelId(PMS_CLIENT_LABEL_NAME, WO_LABEL_COLOR, labelCache, credentials, fetchFn);
        if (!teamMembers && entryDetail.agent) teamMembers = await fetchPmsTeamMembers(credentials, fetchFn);
        const assigneeId = resolveAssigneeId(entryDetail.agent, teamMembers ?? []);

        const task = await createPmsTask(`${tabLabel} | ${brand} — ${entryDetail.account}`, date, credentials, fetchFn, currentColumnId);
        createdTaskId = task.id;
        await setPmsTaskLabelsAndAssignee(task.id, [platformLabelId, clientLabelId], assigneeId, credentials, fetchFn);
        await insertSchedulePmsLink(tab, brand, platform as Platform, date, task.id, currentColumnId, entryDetail.id, client);
        created.push({ tab, brand, platform: platform as SchedulablePlatform, date, account: entryDetail.account });
      } catch (err) {
        if (createdTaskId) {
          await deletePmsTask(createdTaskId, credentials, fetchFn).catch(() => {});
        }
        failed.push({ tab, brand, platform: platform as SchedulablePlatform, date, account: entryDetail.account, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return { created, failed };
}
```

`deletePmsTask` is already declared later in this same file (used by `cancelScheduleInPms`) — since it's a plain top-level `function`/`async function` declaration in the same module, it's usable here regardless of declaration order (function hoisting). No new import needed.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/lib/scheduler/pmsSync.test.ts -t "backfillMissingEntryLinks"
```
Expected: all 4 new tests PASS.

- [ ] **Step 6: Run full suite and build**

```bash
npx vitest run
npm run build
```
Expected: all pass, clean build.

- [ ] **Step 7: Commit**

```bash
git add src/lib/scheduler/pmsSync.ts src/lib/scheduler/pmsSync.test.ts
git commit -m "feat: add backfillMissingEntryLinks to create per-account PMS tasks"
```

---

### Task 5: Route entry-tied links through `resolveEntryPmsStatus` in `resolveAndSyncTabStatuses`

**Files:**
- Modify: `src/lib/scheduler/pmsSync.ts:1072-1134` (the per-link loop inside `resolveAndSyncTabStatuses`)
- Test: `src/lib/scheduler/pmsSync.test.ts`

**Interfaces:**
- Consumes: `resolveEntryPmsStatus` (Task 3), `DateStatusIndex.entries` / `EntryDetails.id`/`.kind` (Task 2).
- Produces: no new exports — behavior change inside an existing exported function.

- [ ] **Step 1: Write the failing test**

Find the existing `describe('resolveAndSyncTabStatuses', ...)` block in `src/lib/scheduler/pmsSync.test.ts` and add, inside it:

```typescript
  it('resolves an entry-tied link from its own entry\'s evidence, independent of the combo\'s other entries', async () => {
    const client = fakeMultiTableClient({
      entries: [
        { id: 'e1', tab: TAB, sheet_row_id: '1', updated_at: '', last_edited_by: 'dashboard', last_sync_tag: null, data: { Brands: 'Casino Magius', Account: 'a1', Agent: 'LAI', 'TP Review Status': 'Removed', 'Trust Pilot': '2026-09-15' } },
        { id: 'e2', tab: TAB, sheet_row_id: '1', updated_at: '', last_edited_by: 'dashboard', last_sync_tag: null, data: { Brands: 'Casino Magius', Account: 'a2', Agent: 'JEN', 'TP Review Status': 'Done', 'Trust Pilot': '2026-09-15' } },
      ],
      schedule_pms_links: [
        { id: 'link-generic', tab: TAB, brand: 'Casino Magius', brand_key: 'casino magius', platform: 'tp', date: '2026-09-15', pms_task_id: 'task-generic', synced_status: 'removed', synced_column_id: DONE_COL, entry_id: null },
        { id: 'link-e1', tab: TAB, brand: 'Casino Magius', brand_key: 'casino magius', platform: 'tp', date: '2026-09-15', pms_task_id: 'task-e1', synced_status: 'removed', synced_column_id: DONE_COL, entry_id: 'e1' },
        { id: 'link-e2', tab: TAB, brand: 'Casino Magius', brand_key: 'casino magius', platform: 'tp', date: '2026-09-15', pms_task_id: 'task-e2', synced_status: 'active', synced_column_id: TODO_COL, entry_id: 'e2' },
      ],
      brand_schedule: [],
      brand_platform_pause: [],
      schedule_manual_pauses: [],
      removed_platform_brands: [],
      schedule_hidden_brands: [],
      schedule_platform_restrictions: [],
    });
    const fetchFn = fakeFetchSequence([
      // link-generic: synced_status already 'removed', matches target -- no PATCH.
      // link-e1: synced_status already 'removed' (matches its own 'removed' kind) -- no PATCH.
      // link-e2: synced_status 'active' but its own entry (e2) is 'done' -- needs a move.
      { url: /\/tasks\/task-e2\/move$/, method: 'PATCH', body: {} },
    ]);
    const result = await resolveAndSyncTabStatuses(TAB, client, CREDENTIALS, fetchFn);
    expect(result.synced.map((s) => s.linkId)).toEqual(['link-e2']);
  });
```

Check the existing top of this test file's `resolveAndSyncTabStatuses` describe block for its own `TAB`/`TODO_COL`/`DONE_COL` constants and `fakeMultiTableClient` table-list conventions (e.g. whether `brand_platform_pause`/`schedule_manual_pauses` need to be present as empty arrays) and match them exactly — copy the surrounding tests' existing fixture shape rather than guessing field names.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/scheduler/pmsSync.test.ts -t "resolves an entry-tied link from its own entry"
```
Expected: FAIL — with the current combo-aggregate-only resolution, `link-e2` resolves via `resolvePmsSyncStatus` against the COMBO's aggregate (which is 'removed', since e1's Removed status wins the combo-level precedence), so it would incorrectly try to move to 'removed' instead of 'done', and the assertion on which task's move endpoint gets called won't match.

- [ ] **Step 3: Implement**

In `src/lib/scheduler/pmsSync.ts`, inside `resolveAndSyncTabStatuses`'s per-link loop, replace:

```typescript
    const targetStatus = resolvePmsSyncStatus(link.brand_key, link.platform, link.date, dateStatusIndex, isPaused);
    if (targetStatus !== link.synced_status) {
      const detailsKey = `${link.brand_key}::${link.platform}::${link.date}`;
      const details = dateStatusIndex.details.get(detailsKey);
      const description = details ? buildTaskDescription(details) : undefined;
      items.push({ linkId: link.id, pmsTaskId: link.pms_task_id, targetStatus, tabLabel: tabDisplayName(link.tab), brand: link.brand, date: link.date, description });
    }
```

with:

```typescript
    const comboKey = `${link.brand_key}::${link.platform}::${link.date}`;
    let targetStatus: PmsSyncStatus;
    let description: string | undefined;
    if (link.entry_id != null) {
      // Entry-tied link: resolve from THIS entry's own evidence, not the
      // combo's aggregate -- see resolveEntryPmsStatus's own doc comment.
      // If the entry can't be found (e.g. its status changed to something
      // outside the four recognized categories since this link was created),
      // leave the link untouched rather than guessing -- same
      // never-destructively-act-on-an-unclear-case spirit as the rest of
      // this function.
      const entryDetail = dateStatusIndex.entries.get(comboKey)?.find((e) => e.id === link.entry_id);
      if (!entryDetail) continue;
      targetStatus = resolveEntryPmsStatus(entryDetail.kind);
      description = buildTaskDescription(entryDetail);
    } else {
      targetStatus = resolvePmsSyncStatus(link.brand_key, link.platform, link.date, dateStatusIndex, isPaused);
      const details = dateStatusIndex.details.get(comboKey);
      description = details ? buildTaskDescription(details) : undefined;
    }
    if (targetStatus !== link.synced_status) {
      items.push({ linkId: link.id, pmsTaskId: link.pms_task_id, targetStatus, tabLabel: tabDisplayName(link.tab), brand: link.brand, date: link.date, description });
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/scheduler/pmsSync.test.ts -t "resolveAndSyncTabStatuses"
```
Expected: the new test passes; every pre-existing `resolveAndSyncTabStatuses` test still passes unmodified (none of their fixtures set `entry_id`, so they all fall straight through the unchanged `else` branch — confirm this is actually true by running the full describe block, not just the new test).

- [ ] **Step 5: Run full suite and build**

```bash
npx vitest run
npm run build
```
Expected: all pass, clean build.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler/pmsSync.ts src/lib/scheduler/pmsSync.test.ts
git commit -m "feat: resolveAndSyncTabStatuses resolves entry-tied links independently"
```

---

### Task 6: Wire `backfillMissingEntryLinks` into the cron, apply migration, deploy, live-verify

**Files:**
- Modify: `supabase/functions/sync-schedule-pms/index.ts`

**Interfaces:**
- Consumes: `backfillMissingEntryLinks` (Task 4).
- Produces: nothing new — wires an existing function into the existing cron/audit handlers.

This function has an existing dependency-injection convention: `backfillActiveTabs` takes a `backfillFn: typeof backfillMissingScheduledLinks` parameter, threaded in from `handleSyncAllStatuses`/`handleAuditAllStatuses`'s own trailing optional parameters (each defaulting to the real `backfillMissingScheduledLinks`) so tests can inject a fake. `backfillMissingEntryLinks` must follow the exact same pattern — appended as a brand-new trailing parameter on all three functions (never inserted in the middle), since the real HTTP handler below calls `handleAuditAllStatuses` with several explicit positional `undefined`s that would break if a new parameter were inserted before them.

- [ ] **Step 1: Add the import**

In `supabase/functions/sync-schedule-pms/index.ts`, add `backfillMissingEntryLinks` to the existing import line from `pmsSync.ts` (the long line starting `import { pushScheduleToPms, pullScheduleFromPms, ...`).

- [ ] **Step 2: Thread a new injectable `backfillEntryFn` parameter through all three functions**

In `backfillActiveTabs` (around line 79), add a new trailing parameter and call it right after the existing backfill call, inside the same `try` block so a failure here is caught by the same per-tab `catch`:

```typescript
async function backfillActiveTabs(
  activeTabs: readonly string[],
  results: Record<string, string>,
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch,
  backfillFn: typeof backfillMissingScheduledLinks,
  backfillEntryFn: typeof backfillMissingEntryLinks,
): Promise<void> {
  if (activeTabs.length === 0) return;
  const weekStart = toISODate(mondayOf(new Date()));
  for (const tab of activeTabs) {
    // Two independent try/catches, not one shared block -- a failure in the
    // entry-backfill must never mask or overwrite a successful note the
    // plan-backfill already recorded for this tab, and vice versa. Matches
    // this file's existing per-tab isolation philosophy, applied one level
    // deeper (per-backfill-kind, not just per-tab).
    try {
      const backfill = await backfillFn(tab, weekStart, client, credentials, fetchFn);
      if (backfill.created.length > 0 || backfill.failed.length > 0) {
        const note = `backfilled ${backfill.created.length} missing link(s)${backfill.failed.length > 0 ? `, ${backfill.failed.length} failed` : ''}`;
        results[tab] = results[tab] && results[tab] !== 'ok' ? `${results[tab]}; ${note}` : note;
      }
    } catch (err) {
      console.error(`[sync-schedule-pms] backfill ${tab} failed:`, err);
      const note = `backfill error: ${err instanceof Error ? err.message : String(err)}`;
      results[tab] = results[tab] && results[tab] !== 'ok' ? `${results[tab]}; ${note}` : note;
    }
    try {
      const entryBackfill = await backfillEntryFn(tab, weekStart, client, credentials, fetchFn);
      if (entryBackfill.created.length > 0 || entryBackfill.failed.length > 0) {
        const note = `backfilled ${entryBackfill.created.length} per-account link(s)${entryBackfill.failed.length > 0 ? `, ${entryBackfill.failed.length} failed` : ''}`;
        results[tab] = results[tab] && results[tab] !== 'ok' ? `${results[tab]}; ${note}` : note;
      }
    } catch (err) {
      console.error(`[sync-schedule-pms] entry backfill ${tab} failed:`, err);
      const note = `entry backfill error: ${err instanceof Error ? err.message : String(err)}`;
      results[tab] = results[tab] && results[tab] !== 'ok' ? `${results[tab]}; ${note}` : note;
    } finally {
      invalidateTabCache(tab);
    }
  }
}
```

Then, on `handleSyncAllStatuses` (around line 186), add a new trailing parameter after its existing `backfillFn` parameter, and pass it through to `backfillActiveTabs`:

```typescript
export async function handleSyncAllStatuses(
  body: { tab?: unknown },
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch,
  bootstrapFn: typeof bootstrapTabRegistries = bootstrapTabRegistries,
  getActiveTabsFn: typeof getActiveOperationalTabs = getActiveOperationalTabs,
  getPausedTabsFn: typeof getPausedOperationalTabs = getPausedOperationalTabs,
  backfillFn: typeof backfillMissingScheduledLinks = backfillMissingScheduledLinks,
  backfillEntryFn: typeof backfillMissingEntryLinks = backfillMissingEntryLinks,
): Promise<Record<string, string>> {
```

and find its own call to `backfillActiveTabs` further down (`await backfillActiveTabs(tabs.filter((t) => !t.paused).map((t) => t.tab), results, client, credentials, fetchFn, backfillFn);`) — append `backfillEntryFn` as its new final argument.

Finally, on `handleAuditAllStatuses` (around line 239), add the same new trailing parameter, after its existing `sendAlertFn` parameter (the last one in its current signature):

```typescript
export async function handleAuditAllStatuses(
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch,
  bootstrapFn: typeof bootstrapTabRegistries = bootstrapTabRegistries,
  getActiveTabsFn: typeof getActiveOperationalTabs = getActiveOperationalTabs,
  getPausedTabsFn: typeof getPausedOperationalTabs = getPausedOperationalTabs,
  backfillFn: typeof backfillMissingScheduledLinks = backfillMissingScheduledLinks,
  parityFn: typeof computeSchedulePmsParityIssues = computeSchedulePmsParityIssues,
  gmailCredentials?: GmailCredentials,
  sendAlertFn: typeof sendToApprovedProfiles = sendToApprovedProfiles,
  backfillEntryFn: typeof backfillMissingEntryLinks = backfillMissingEntryLinks,
): Promise<Record<string, string>> {
```

and find its own call to `backfillActiveTabs` (`await backfillActiveTabs(activeTabs, results, client, credentials, fetchFn, backfillFn);`) — append `backfillEntryFn` as its new final argument.

The real HTTP-handler call sites (`handleSyncAllStatuses(body, client, credentials, fetch)` and `handleAuditAllStatuses(client, credentials, fetch, undefined, undefined, undefined, undefined, undefined, gmailCredentials)`) need no changes — both new parameters were appended strictly after every existing one, so they keep defaulting to the real `backfillMissingEntryLinks`.

- [ ] **Step 3: `deno check`**

```bash
deno check supabase/functions/sync-schedule-pms/index.ts
deno check supabase/functions/generate-weekly-schedule/index.ts
```
Expected: both clean (this shared module is imported by both functions).

- [ ] **Step 4: Fix the 5 existing tests that inject a custom `backfillFn` and assert on `results[tab]`'s exact content**

`supabase/functions/sync-schedule-pms/index_test.ts` has a `backfillFn` dependency-injection convention identical to the one just added for `backfillEntryFn` — several existing tests already pass a custom fake `backfillFn` and assert on the resulting `results[tab]` string's exact suffix/content. Since `backfillEntryFn` now defaults to the REAL `backfillMissingEntryLinks` in every test that doesn't explicitly override it, and every test in this file uses a fake `{} as SupabaseClient` with no real `.from()`, the real default will throw and append its own `"; entry backfill error: ..."` note — which is invisible to a test that only checks `Object.keys(results)` or `.startsWith(...)`, but breaks the small number of tests asserting exact suffix content. Find each of these 5 `Deno.test` blocks by name and add one more trailing argument, `async () => ({ created: [], failed: [] })`, immediately after their existing custom `backfillFn` argument:

- `'handleSyncAllStatuses calls backfillFn for a single requested active tab, and folds a non-empty result into it'`
- `'handleAuditAllStatuses appends a non-empty backfill result onto that tab's existing result string'`
- `'handleAuditAllStatuses isolates one tab's backfill failure from the rest'`
- `'handleAuditAllStatuses leaves a tab's result string untouched when its backfill has nothing to report'`

(A 4th `handleSyncAllStatuses` test, `'calls backfillFn for every active tab in an unscoped sweep'`, and a 5th, `'never calls backfillFn when the requested body.tab is currently paused'`, only assert on a captured `backfillCalls` array, never on `results[tab]`'s content — verify these two still pass unmodified; do not add anything to them unless the test run below proves otherwise.)

Example fix, using the first test above:

```typescript
Deno.test('handleSyncAllStatuses calls backfillFn for a single requested active tab, and folds a non-empty result into it', async () => {
  const backfillCalls: string[] = [];
  const results = await handleSyncAllStatuses(
    { tab: 'Hanan' },
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan'],
    () => [],
    async (tab: string) => {
      backfillCalls.push(tab);
      return {
        created: [{ tab: 'Hanan', tabLabel: 'Hanan', brand: 'WinMega', platform: 'tp', date: '2026-09-07' }],
        skipped: [],
        failed: [],
      };
    },
    async () => ({ created: [], failed: [] }),
  );
  assertEquals(backfillCalls, ['Hanan']);
  assertEquals(results['Hanan'].endsWith('; backfilled 1 missing link(s)'), true);
});
```

Apply the exact same one-line addition (a trailing `async () => ({ created: [], failed: [] })`) to the other 3 named tests.

- [ ] **Step 5: `deno check` and run the Deno test suite**

```bash
deno check supabase/functions/sync-schedule-pms/index.ts
deno check supabase/functions/generate-weekly-schedule/index.ts
deno test --allow-env --allow-net supabase/functions/sync-schedule-pms/
```
Expected: all clean, all tests pass. If any OTHER test in this file breaks beyond the 5 named above, that means the "safe as-is" reasoning in Step 4 missed a case — read that specific failure's assertion, determine whether it needs the same `async () => ({ created: [], failed: [] })` trailing fix, and apply it the same way rather than changing production code to work around it.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/sync-schedule-pms/index.ts supabase/functions/sync-schedule-pms/index_test.ts
git commit -m "feat: wire backfillMissingEntryLinks into the sync-schedule-pms cron"
```

- [ ] **Step 7: Confirm the migration's constraint name against the live database**

Before applying, run (read-only) against production via the Supabase SQL editor or `supabase db query` to get the real constraint name for Task 1 Step 2, and update the migration file if it differs from the assumed default name.

- [ ] **Step 8: Apply the migration**

```bash
supabase db push
```
Confirm success and that the two new partial indexes exist (`\d schedule_pms_links` or an equivalent query) before proceeding.

- [ ] **Step 9: Deploy both edge functions**

```bash
supabase functions deploy sync-schedule-pms
supabase functions deploy generate-weekly-schedule
```
Confirm both show `ACTIVE` via `supabase functions list`.

- [ ] **Step 10: Live-verify against the real Casino Magius case**

Trigger `sync-schedule-pms`'s sync-all-statuses action for the BIT tab (matching how this project has live-verified every prior PMS-sync task this session — a direct authenticated call, or visiting the Schedule Planner page for BIT, which triggers the same code path). Then confirm directly via the PMS API:
- Exactly 2 new task cards exist for Casino Magius's TP slot on 2026-09-15, titled `"BIT | Casino Magius — 506 | BI TP | Netherlands"` and `"BIT | Casino Magius — 512 | BI TP | Netherlands"`.
- Their assignees are JEN and ANN respectively (not LAI, not unassigned).
- The pre-existing original card (task-1, account 504) is completely untouched — same title, same id.
- All 3 cards show a status matching "Done" (since all 3 real entries are currently Done in production).
- Run `backfillMissingEntryLinks` (or the cron) a second time and confirm it creates zero additional cards (idempotent).

- [ ] **Step 11: Update `docs/task-history.md`, memory, and `.agent/handoff/`**

Following this session's established workflow: a short `## Task 349: ...` entry in `docs/task-history.md`, a memory update to `project_schedule_planner_multi_account_day_cell` (mark the PMS-tasks section SHIPPED with the live-verification detail), and a new dated `.agent/handoff/` file. File the PMS ticket for Task 349 in Review/QA per the same pattern as Tasks 345-348.
