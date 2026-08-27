# Schedule PMS Automatic Status Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Schedule Planner → PMS status sync (Task 247/279) run automatically on a 1-minute
cron instead of only when a human opens a tab's Schedule Planner page, with zero duplicated
resolution logic between the two triggers.

**Architecture:** Extract the resolve-and-sync computation that currently lives inline in
`TabScheduleSection.tsx`'s effect into one server-side function, `resolveAndSyncTabStatuses`, in the
already-shared `src/lib/scheduler/pmsSync.ts`. Both the on-visit browser trigger and a new 1-minute
`pg_cron` job reach this one function over HTTP through a new `syncAllStatuses` action on the
existing `sync-schedule-pms` Edge Function — never two independent implementations of the same rule.
A second, small extraction (`bootstrapTabRegistries`) removes an existing hand-duplicated isolate
bootstrap sequence between `generate-weekly-schedule` and this new code path.

**Tech Stack:** TypeScript/Deno (shared `src/lib`), Supabase Edge Functions, `pg_cron`/`pg_net`,
Vitest (frontend/shared-lib tests), Deno test (Edge Function tests).

**Spec:** `docs/superpowers/specs/2026-08-27-schedule-pms-automatic-status-sync-design.md`

## Global Constraints

- The PMS API token (`credentials: PmsCredentials`) never reaches the browser — any code path that
  needs it must run server-side (Edge Function), never in `src/components/*.tsx`.
- `pg_cron`'s practical floor is 1-minute granularity (`* * * * *`) — do not attempt sub-minute
  scheduling.
- Every Edge Function invocation that reads `getActiveOperationalTabs()` or `getTabPlatforms(tab)`
  must first call `bootstrapTabRegistries` — Edge isolates are reused across invocations and these
  registries only ever grow via their own register/apply calls, so a missing reset+reapply leaks
  stale state (a deleted custom tab, an unhidden platform, an unarchived/unpaused tab) across
  invocations indefinitely.
- After processing each tab in a multi-tab loop, call `invalidateTabCache(tab)` (`src/lib/queries.ts`)
  — `fetchRawEntriesByTab` caches a tab's full (sometimes 1,700+ row) entry list in a module-level Map
  with no write-side eviction; this is the same discipline `generateAllTabs` already follows, and
  matters more here since this cron runs every minute, far more often than the weekly job.
- Every new/modified `.ts` file under `src/lib` that's reachable from a Deno Edge Function must use
  explicit `.ts` extensions on relative imports and pass `deno check` — this repo's bundler has
  broken on extensionless imports at real deploy time before (see CLAUDE.md Known Issues).
- Verify with `npm run build`, not `tsc --noEmit` (the root tsconfig is references-only and checks
  nothing by itself in this repo).

---

### Task 1: Extract `bootstrapTabRegistries` and refactor `generate-weekly-schedule` to use it

**Files:**
- Create: `src/lib/tabRegistryBootstrap.ts`
- Create: `src/lib/tabRegistryBootstrap.test.ts`
- Modify: `supabase/functions/generate-weekly-schedule/index.ts:12-22` (imports), `:142-190`
  (bootstrap block)

**Interfaces:**
- Produces: `bootstrapTabRegistries(client: SupabaseClient, logPrefix: string): Promise<void>` —
  fetches and applies all four isolate-scoped tab registries (dynamic tabs, hidden tab platforms,
  archived tabs, paused tabs). Fails open per-registry (a fetch error for one registry logs and
  leaves that registry empty, never throws, never blocks the other three).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tabRegistryBootstrap.test.ts
import { describe, it, expect, vi } from 'vitest';
import { bootstrapTabRegistries } from './tabRegistryBootstrap';
import { isTabPaused, getActiveOperationalTabs, resetPausedTabs } from './pausedTabRegistry';
import { getTabPlatforms, resetHiddenTabPlatforms } from './tab-configs';

function fakeClient(tables: Record<string, unknown[]>) {
  const builder = (rows: unknown[]) => ({
    select: () => builder(rows),
    eq: () => builder(rows),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  });
  return { from: (table: string) => builder(tables[table] ?? []) } as any;
}

describe('bootstrapTabRegistries', () => {
  it('applies fetched rows to all four registries', async () => {
    resetPausedTabs();
    resetHiddenTabPlatforms();
    const client = fakeClient({
      custom_tabs: [],
      hidden_tab_platforms: [{ tab: 'Rooster Partners', platform: 'ag' }],
      archived_tabs: [],
      paused_tabs: [{ tab: 'BITP' }],
    });
    await bootstrapTabRegistries(client, 'test');
    expect(isTabPaused('BITP')).toBe(true);
    expect(getActiveOperationalTabs().includes('BITP')).toBe(false);
    expect(getTabPlatforms('Rooster Partners').includes('ag')).toBe(false);
  });

  it('degrades one failed registry fetch to empty without throwing or blocking the others', async () => {
    resetPausedTabs();
    resetHiddenTabPlatforms();
    const client = {
      from: (table: string) => {
        if (table === 'paused_tabs') {
          return {
            select: () => ({
              then: () => Promise.reject(new Error('boom')),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({ then: (r: any) => Promise.resolve({ data: [], error: null }).then(r) }),
            then: (r: any) => Promise.resolve({ data: table === 'paused_tabs' ? [] : [], error: null }).then(r) as any,
          }),
        };
      },
    } as any;
    await expect(bootstrapTabRegistries(client, 'test')).resolves.toBeUndefined();
    expect(getActiveOperationalTabs().includes('BITP')).toBe(true); // never got paused, fetch failed open
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tabRegistryBootstrap.test.ts`
Expected: FAIL — `Cannot find module './tabRegistryBootstrap'`

- [ ] **Step 3: Write the implementation**

First read `supabase/functions/generate-weekly-schedule/index.ts:142-190` to confirm the exact
current bootstrap block (imports for `fetchCustomTabs`, `fetchHiddenTabPlatforms`, `fetchArchivedTabs`,
`fetchPausedTabs` already live in `src/lib/queries.ts`; `registerDynamicTabs`/`resetDynamicTabs` in
`src/lib/dynamicTabRegistry.ts`; `applyArchivedTabs`/`resetArchivedTabs` in
`src/lib/archivedTabRegistry.ts`; `applyPausedTabs`/`resetPausedTabs` in
`src/lib/pausedTabRegistry.ts`; `registerHiddenTabPlatforms`/`resetHiddenTabPlatforms` in
`src/lib/tab-configs.ts`), then create:

```ts
// src/lib/tabRegistryBootstrap.ts
// Every Edge Function isolate that reads getActiveOperationalTabs() or
// getTabPlatforms(tab) must call this once per invocation first. Isolates
// are reused across invocations, and each of the four registries below only
// ever grows via its own register/apply call -- without a reset+reapply
// here, a warm isolate keeps stale state (a deleted custom tab, an unhidden
// platform, an unarchived/unpaused tab) forever. This exact sequence used to
// be hand-copied inline in generate-weekly-schedule/index.ts; factored out
// here so a second Edge Function (sync-schedule-pms's syncAllStatuses
// action) can't drift from it by hand-copying a second time.
import type { SupabaseClient } from '@supabase/supabase-js';
import { registerHiddenTabPlatforms, resetHiddenTabPlatforms } from './tab-configs.ts';
import { fetchCustomTabs, fetchHiddenTabPlatforms, fetchArchivedTabs, fetchPausedTabs } from './queries.ts';
import { registerDynamicTabs, resetDynamicTabs } from './dynamicTabRegistry.ts';
import { applyArchivedTabs, resetArchivedTabs } from './archivedTabRegistry.ts';
import { applyPausedTabs, resetPausedTabs } from './pausedTabRegistry.ts';

export async function bootstrapTabRegistries(client: SupabaseClient, logPrefix: string): Promise<void> {
  const customTabs = await fetchCustomTabs(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch custom tabs:`, err);
    return [];
  });
  resetDynamicTabs();
  registerDynamicTabs(customTabs);

  const hiddenPlatforms = await fetchHiddenTabPlatforms(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch hidden tab platforms:`, err);
    return [];
  });
  resetHiddenTabPlatforms();
  registerHiddenTabPlatforms(hiddenPlatforms);

  const archivedTabs = await fetchArchivedTabs(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch archived tabs:`, err);
    return [];
  });
  resetArchivedTabs();
  applyArchivedTabs(archivedTabs);

  const pausedTabs = await fetchPausedTabs(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch paused tabs:`, err);
    return [];
  });
  resetPausedTabs();
  applyPausedTabs(pausedTabs);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tabRegistryBootstrap.test.ts`
Expected: PASS (2 tests). If the fake client shape doesn't match a real fetch function's actual
query chain (`.select().eq()` vs a bare `.select()`), read the real `fetchPausedTabs`/
`fetchHiddenTabPlatforms`/`fetchCustomTabs`/`fetchArchivedTabs` implementations in
`src/lib/queries.ts` first and adjust the fake's chain to match exactly — don't guess.

- [ ] **Step 5: Refactor `generate-weekly-schedule/index.ts` to use the extracted function**

Replace lines 142-190 (the `Deno.serve` handler's bootstrap block, from
`const client = createClient(...)` through the `applyPausedTabs(pausedTabs);` line) with:

```ts
Deno.serve(async (_req: Request): Promise<Response> => {
  const client = createClient(SUPABASE_URL, SERVICE_ROLE);
  await bootstrapTabRegistries(client, 'generate-weekly-schedule');
  const weekStart = toISODate(mondayOf(new Date()));
  const results = await generateAllTabs(getActiveOperationalTabs(), weekStart, client);
```

Update the import block (lines 12-22): remove `registerDynamicTabs, resetDynamicTabs` from the
`dynamicTabRegistry.ts` import, `applyArchivedTabs, resetArchivedTabs` from the
`archivedTabRegistry.ts` import, `applyPausedTabs, resetPausedTabs` from the `pausedTabRegistry.ts`
import (keep `getActiveOperationalTabs` there), `registerHiddenTabPlatforms, resetHiddenTabPlatforms`
from the `tab-configs.ts` import, and `fetchCustomTabs, fetchHiddenTabPlatforms, fetchArchivedTabs,
fetchPausedTabs` from the `queries.ts` import — none of these are referenced anywhere else in this
file once the bootstrap block moves out. Add:

```ts
import { bootstrapTabRegistries } from '../../../src/lib/tabRegistryBootstrap.ts';
```

- [ ] **Step 6: Verify the refactor is behavior-preserving**

Run: `deno check --no-lock --node-modules-dir=none --config supabase/functions/generate-weekly-schedule/deno.json supabase/functions/generate-weekly-schedule/index.ts`
Expected: clean, no errors.

Run: `deno test --allow-env --allow-net supabase/functions/generate-weekly-schedule/index_test.ts`
Expected: all existing tests still pass (this file's tests exercise `buildTabContext`/
`generateForTab`/`generateAllTabs` directly, none of which changed).

- [ ] **Step 7: Commit**

```bash
git add src/lib/tabRegistryBootstrap.ts src/lib/tabRegistryBootstrap.test.ts supabase/functions/generate-weekly-schedule/index.ts
git commit -m "refactor: extract bootstrapTabRegistries, shared by generate-weekly-schedule and (soon) sync-schedule-pms"
```

---

### Task 2: Add `resolveAndSyncTabStatuses` to `pmsSync.ts`

**Files:**
- Modify: `src/lib/scheduler/pmsSync.ts` (add new export near the end, after `syncScheduleStatusToPms`)
- Test: `src/lib/scheduler/pmsSync.test.ts`

**Interfaces:**
- Consumes: `syncScheduleStatusToPms(items, client, credentials, fetchFn)` (already exists in this
  same file, unchanged) — `resolveAndSyncTabStatuses` calls it internally once it has resolved which
  links need to move.
- Produces: `resolveAndSyncTabStatuses(tab: string, client: SupabaseClient, credentials:
  PmsCredentials, fetchFn: typeof fetch = fetch): Promise<PmsStatusSyncResult>` — the one place the
  full resolution rules (evidence precedence, pause exclusion, hidden/restricted/removed-platform
  exclusion) are implemented; used by both Task 3 (the cron/on-visit Edge Function action) and
  nothing else going forward (Task 5/6 remove the frontend's own duplicate copy of this logic).

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scheduler/pmsSync.test.ts` (new `describe` block, after the existing
`syncScheduleStatusToPms` block):

```ts
import { resolveAndSyncTabStatuses } from './pmsSync';

// Generic multi-table fake for resolveAndSyncTabStatuses's tests -- it reads
// six different tables per call (schedule_pms_links, entries,
// removed_platform_brands, schedule_hidden_brands,
// schedule_platform_restrictions, brand_platform_pause, brand_schedule),
// unlike this file's other fakes which are scoped to one or two tables.
function fakeMultiTableClient(tables: Record<string, unknown[]>) {
  function builder(rows: unknown[]) {
    return {
      select: () => builder(rows),
      eq: () => builder(rows),
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
  }
  return { from: (table: string) => builder(tables[table] ?? []) } as any;
}

function entry(tab: string, id: string, data: Record<string, string | null>) {
  return { id, tab, sheet_row_id: id, data, updated_at: '', last_edited_by: 'dashboard' as const, last_sync_tag: null };
}

describe('resolveAndSyncTabStatuses', () => {
  it('moves a link whose entry status resolves to Done, and leaves synced_status current on success', async () => {
    const client = fakeMultiTableClient({
      schedule_pms_links: [
        { id: 'link-1', tab: 'BITP', brand: 'WinMega', brand_key: 'winmega', platform: 'tp', date: '2026-08-27', pms_task_id: 'task-1', synced_status: 'active' },
      ],
      entries: [entry('BITP', 'e1', { Brands: 'WinMega', 'TP Review Status': 'Done', 'Trust Pilot': '27/08/2026' })],
      removed_platform_brands: [],
      schedule_hidden_brands: [],
      schedule_platform_restrictions: [],
      brand_platform_pause: [],
      brand_schedule: [],
    });
    let movedBody: unknown;
    const fetchFn = vi.fn(async (url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => [] };
      movedBody = JSON.parse(init.body as string);
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const result = await resolveAndSyncTabStatuses('BITP', client, { apiToken: 'test-token' }, fetchFn);
    expect(result.synced).toEqual([{ linkId: 'link-1', pmsTaskId: 'task-1', targetStatus: 'done', tabLabel: 'BITP', date: '2026-08-27' }]);
    expect(movedBody).toEqual({ columnId: 'cmsoh1uxz000604l4j5loen7g', position: 0 });
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
        { id: 'link-1', tab: 'BITP', brand: 'WinMega', brand_key: 'winmega', platform: 'tp', date: '2026-08-27', pms_task_id: 'task-1', synced_status: 'done' },
      ],
      entries: [entry('BITP', 'e1', { Brands: 'WinMega', 'TP Review Status': 'Done', 'Trust Pilot': '27/08/2026' })],
      removed_platform_brands: [],
      schedule_hidden_brands: [],
      schedule_platform_restrictions: [],
      brand_platform_pause: [],
      brand_schedule: [],
    });
    const fetchFn = vi.fn();
    const result = await resolveAndSyncTabStatuses('BITP', client, { apiToken: 'test-token' }, fetchFn as unknown as typeof fetch);
    expect(result).toEqual({ synced: [], failed: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
```

Add `import { describe, it, expect, vi } from 'vitest';` items already exist at the top of this file
— reuse them, don't re-import.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scheduler/pmsSync.test.ts`
Expected: FAIL — `resolveAndSyncTabStatuses is not a function` / `does not provide an export`.

- [ ] **Step 3: Write the implementation**

Add near the end of `src/lib/scheduler/pmsSync.ts`, after the existing `syncScheduleStatusToPms`
function and before `pullScheduleFromPms`'s section. First replace the file's existing top-of-file
import block (currently 4 lines: the `SupabaseClient` type import, the `removedPlatformBrands.ts`
import, the `queries.ts` import, and the `type { PmsSyncStatus }` import) with:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeBrandKey, buildRemovedPlatformBrandSet, type Platform } from '../removedPlatformBrands.ts';
import { fetchSchedulePmsLinks, insertSchedulePmsLink, updateSchedulePmsLinkDate, updateSchedulePmsLinkStatus, deleteSchedulePmsLink, fetchRawEntriesByTab, fetchRemovedPlatformBrands, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, fetchActiveBrandPlatformPauses, fetchBrandSchedule, type SchedulePmsLink } from '../queries.ts';
import { buildDateStatusIndex, resolvePmsSyncStatus, type PmsSyncStatus } from './scheduleUtils.ts';
import { buildHiddenBrandSet, buildPlatformRestrictionMap, resolveBrandPlatforms } from '../scheduleBrandConfig.ts';
import { getTabPlatforms } from '../tab-configs.ts';
import { weekdayAndWeekStartFor, scheduleFor, type BrandScheduleRow } from '../scheduleBrands.ts';
import { tabDisplayName } from '../tabs.ts';
```

This is the file's complete new top-of-file import section — every name from the original 4 lines
(`SupabaseClient`, `normalizeBrandKey`, `Platform`, `fetchSchedulePmsLinks`, `insertSchedulePmsLink`,
`updateSchedulePmsLinkDate`, `updateSchedulePmsLinkStatus`, `deleteSchedulePmsLink`,
`SchedulePmsLink`, `PmsSyncStatus`) is preserved, just merged with the new names this task adds.

Then add the function itself:

```ts
// The one place the full dashboard -> PMS status resolution rules are
// implemented (evidence precedence, pause exclusion, hidden/restricted/
// removed-platform exclusion) -- both the on-visit browser trigger and the
// 1-minute cron reach this same function over HTTP through
// sync-schedule-pms's syncAllStatuses action (see that Edge Function's
// index.ts), never a second independently-written copy of these rules.
// Mirrors what TabScheduleSection.tsx's status-sync effect used to compute
// inline before this extraction.
export async function resolveAndSyncTabStatuses(
  tab: string,
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<PmsStatusSyncResult> {
  const links = await fetchSchedulePmsLinks(tab, client);
  if (links.length === 0) return { synced: [], failed: [] };

  const [entries, removedPlatformBrandRows, hiddenBrandRows, restrictedBrandRows, pauses] = await Promise.all([
    fetchRawEntriesByTab(tab, client),
    fetchRemovedPlatformBrands(client),
    fetchScheduleHiddenBrands(tab, client),
    fetchScheduleRestrictedBrands(tab, client),
    fetchActiveBrandPlatformPauses(tab, client),
  ]);
  const dateStatusIndex = buildDateStatusIndex(entries);
  const removedPlatformBrandSet = buildRemovedPlatformBrandSet(
    removedPlatformBrandRows as { tab: string; brand: string; platform: Platform }[],
  );
  const hiddenBrandSet = buildHiddenBrandSet(hiddenBrandRows);
  const platformRestrictionMap = buildPlatformRestrictionMap(restrictedBrandRows);
  const tabPlatforms = getTabPlatforms(tab);

  const distinctWeeks = [...new Set(
    links.map((l) => weekdayAndWeekStartFor(l.date)?.weekStart).filter((w): w is string => w != null),
  )];
  const rowsPerWeek = await Promise.all(
    distinctWeeks.map((w) => fetchBrandSchedule(tab, w, client).catch(() => [] as BrandScheduleRow[])),
  );
  const manualPauseRows = rowsPerWeek.flat();

  const items: PmsStatusSyncItem[] = [];
  for (const link of links) {
    const allowedPlatforms = resolveBrandPlatforms(tab, link.brand, tabPlatforms, hiddenBrandSet, platformRestrictionMap, removedPlatformBrandSet);
    if (!allowedPlatforms.includes(link.platform)) continue;
    const loc = weekdayAndWeekStartFor(link.date);
    const autoPaused = pauses.some((p) => p.brand_key === link.brand_key && p.platform === link.platform && p.paused_week_start === loc?.weekStart);
    const manuallyPaused = loc != null && scheduleFor(manualPauseRows, tab, link.brand, loc.weekStart, link.platform)?.[loc.day] === 'paused';
    const isPaused = autoPaused || manuallyPaused;
    const targetStatus = resolvePmsSyncStatus(link.brand_key, link.platform, link.date, dateStatusIndex, isPaused);
    if (targetStatus !== link.synced_status) {
      items.push({ linkId: link.id, pmsTaskId: link.pms_task_id, targetStatus, tabLabel: tabDisplayName(tab), date: link.date });
    }
  }
  if (items.length === 0) return { synced: [], failed: [] };
  return syncScheduleStatusToPms(items, client, credentials, fetchFn);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/pmsSync.test.ts`
Expected: PASS (all tests in this file, including the 5 new ones). If a mock's `.select().eq()`
chain doesn't match what one of the real `fetch*` functions in `src/lib/queries.ts` actually calls,
read that function's real implementation first and adjust the fake to match — don't guess at the
chain shape.

- [ ] **Step 5: `deno check`**

Run: `deno check src/lib/scheduler/pmsSync.ts`
Expected: clean, no errors (confirms every new import resolves and the file stays Deno-safe — this
module is imported by two Edge Functions).

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler/pmsSync.ts src/lib/scheduler/pmsSync.test.ts
git commit -m "feat: add resolveAndSyncTabStatuses, the single source of truth for PMS status resolution"
```

---

### Task 3: Add the `syncAllStatuses` action to `sync-schedule-pms`, remove the now-superseded `syncStatus` action

**Files:**
- Modify: `supabase/functions/sync-schedule-pms/index.ts`
- Create: `supabase/functions/sync-schedule-pms/index_test.ts` (this function has no test file today)

**Interfaces:**
- Consumes: `resolveAndSyncTabStatuses` (Task 2), `bootstrapTabRegistries` (Task 1),
  `getActiveOperationalTabs()` (`src/lib/pausedTabRegistry.ts`), `invalidateTabCache(tab)`
  (`src/lib/queries.ts`).
- Produces: `syncAllTabStatuses(tabs: readonly string[], client: SupabaseClient, credentials:
  PmsCredentials, fetchFn: typeof fetch, resolveFn: typeof resolveAndSyncTabStatuses =
  resolveAndSyncTabStatuses): Promise<Record<string, string>>` — exported from `index.ts` so it's
  directly testable, mirroring `generate-weekly-schedule/index.ts`'s `generateAllTabs` shape exactly
  (per-tab try/catch isolation, injectable resolve function for tests, a `tab -> 'ok' | 'error: ...'`
  result record).
- HTTP: `POST` body `{ action: 'syncAllStatuses', tab?: string }` — `tab` omitted processes every
  active tab (the cron's call shape); `tab` set processes only that one tab (the browser's on-visit
  call shape, Task 6).

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/sync-schedule-pms/index_test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncAllTabStatuses } from './index.ts';

Deno.test('syncAllTabStatuses processes every given tab independently, isolating one failure', async () => {
  const calls: string[] = [];
  const fakeResolve = async (tab: string) => {
    calls.push(tab);
    if (tab === 'Trybet') throw new Error('boom');
    return { synced: [], failed: [] };
  };
  const results = await syncAllTabStatuses(
    ['BITP', 'Trybet', 'Hanan'],
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    fakeResolve as any,
  );
  assertEquals(calls, ['BITP', 'Trybet', 'Hanan']);
  assertEquals(results['BITP'], 'ok');
  assertEquals(results['Trybet'], 'error: boom');
  assertEquals(results['Hanan'], 'ok');
});

Deno.test('syncAllTabStatuses processes only the given tab when the list has one entry', async () => {
  const calls: string[] = [];
  const fakeResolve = async (tab: string) => {
    calls.push(tab);
    return { synced: [], failed: [] };
  };
  const results = await syncAllTabStatuses(['Wizard of Odds'], {} as SupabaseClient, { apiToken: 'test-token' }, fetch, fakeResolve as any);
  assertEquals(calls, ['Wizard of Odds']);
  assertEquals(Object.keys(results), ['Wizard of Odds']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-env --allow-net supabase/functions/sync-schedule-pms/index_test.ts`
Expected: FAIL — `does not provide an export named 'syncAllTabStatuses'`.

- [ ] **Step 3: Write the implementation**

First read the current full `supabase/functions/sync-schedule-pms/index.ts` (59 lines) to confirm
nothing else changed underneath this plan. Replace its contents with:

```ts
/// <reference path="./vite-env-shim.d.ts" />
// supabase/functions/sync-schedule-pms/index.ts
// Thin HTTP wrapper: all real logic lives in src/lib/scheduler/pmsSync.ts,
// shared with generate-weekly-schedule so the two never implement the push/
// pull/status-resolution logic twice. Holds PMS_API_TOKEN as a Supabase
// secret -- the browser never sees it.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pushScheduleToPms, pullScheduleFromPms, resolveAndSyncTabStatuses, type PmsSyncItem, type PmsCredentials, type PmsStatusSyncResult } from '../../../src/lib/scheduler/pmsSync.ts';
import { bootstrapTabRegistries } from '../../../src/lib/tabRegistryBootstrap.ts';
import { getActiveOperationalTabs } from '../../../src/lib/pausedTabRegistry.ts';
import { invalidateTabCache } from '../../../src/lib/queries.ts';

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

// Mirrors generate-weekly-schedule/index.ts's generateAllTabs exactly: one
// tab's failure (a transient PMS API error, a malformed entry) must never
// block the rest. invalidateTabCache runs after every tab, success or
// failure, for the same reason generateAllTabs already evicts per-tab --
// fetchRawEntriesByTab caches a tab's full entry list with no write-side
// eviction, and this action can run every minute across every active tab.
// resolveFn is injectable so tests can verify this loop's isolation/eviction
// behavior without a real Supabase client or PMS API.
export async function syncAllTabStatuses(
  tabs: readonly string[],
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch,
  resolveFn: (tab: string, client: SupabaseClient, credentials: PmsCredentials, fetchFn: typeof fetch) => Promise<PmsStatusSyncResult> = resolveAndSyncTabStatuses,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const tab of tabs) {
    try {
      const result = await resolveFn(tab, client, credentials, fetchFn);
      results[tab] = result.failed.length > 0 ? `error: ${result.failed.length} link(s) failed to move` : 'ok';
    } catch (err) {
      console.error(`[sync-schedule-pms] syncAllStatuses ${tab} failed:`, err);
      results[tab] = `error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      invalidateTabCache(tab);
    }
  }
  return results;
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

  const credentials = { apiToken: PMS_API_TOKEN };

  try {
    const client = createClient(SUPABASE_URL, SERVICE_ROLE);
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
    if (body?.action === 'syncAllStatuses') {
      await bootstrapTabRegistries(client, 'sync-schedule-pms');
      const tabs = typeof body.tab === 'string' && body.tab ? [body.tab] : getActiveOperationalTabs();
      const results = await syncAllTabStatuses(tabs, client, credentials, fetch);
      return jsonResponse({ results });
    }
    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Sync failed' }, 500);
  }
});
```

This removes the old `action: 'syncStatus'` branch and its `PmsStatusSyncItem` import — nothing
calls it after Task 6 refactors the browser side (Task 5/6, later in this plan) to use
`syncAllStatuses` instead. `syncScheduleStatusToPms` (the underlying "move a pre-resolved batch"
function) is untouched in `pmsSync.ts` and still called internally by `resolveAndSyncTabStatuses`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-env --allow-net supabase/functions/sync-schedule-pms/index_test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: `deno check`**

Run: `deno check --no-lock --node-modules-dir=none --config supabase/functions/sync-schedule-pms/deno.json supabase/functions/sync-schedule-pms/index.ts`
Expected: clean, no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/sync-schedule-pms/index.ts supabase/functions/sync-schedule-pms/index_test.ts
git commit -m "feat: add syncAllStatuses action to sync-schedule-pms, remove superseded syncStatus action"
```

---

### Task 4: Add the 1-minute cron migration

**Files:**
- Create: `supabase/migrations/20260827120000_add_sync_schedule_pms_status_cron.sql`

**Interfaces:**
- Produces: a `pg_cron` job `sync-schedule-pms-status-minutely` that POSTs `{"action":"syncAllStatuses"}`
  to the deployed `sync-schedule-pms` function every minute.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260827120000_add_sync_schedule_pms_status_cron.sql
-- Makes the dashboard -> PMS status sync (Task 247/279) run automatically
-- instead of only when a human visits a tab's Schedule Planner page. See
-- docs/superpowers/specs/2026-08-27-schedule-pms-automatic-status-sync-design.md.
--
-- '* * * * *' is pg_cron's practical floor (1-minute granularity) -- a
-- single scraper run can PATCH 50+ individual entries in quick succession
-- (one row per request, not one bulk statement), so this cron sweep
-- naturally coalesces any burst of writes within a given minute into one
-- resync per tab, rather than firing once per row the way a database
-- trigger would.
--
-- Same net.http_post shape and the same real anon-role JWT already inlined
-- in the existing generate-weekly-schedule-monday job's migration
-- (20260805100000_add_generate_weekly_schedule_cron.sql) -- that JWT is
-- long-lived per that file's own comment, so reusing the identical literal
-- value here is consistent with existing practice, not a new secret.
--
-- Requires pg_cron and pg_net extensions to be enabled (already required by
-- the two existing cron jobs in this project).
select cron.schedule(
  'sync-schedule-pms-status-minutely',
  '* * * * *',
  $$
    select net.http_post(
      url     := 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/sync-schedule-pms',
      body    := '{"action":"syncAllStatuses"}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU"}'::jsonb
    )
  $$
);
```

- [ ] **Step 2: Verify the migration file has no syntax errors**

Run: `cat supabase/migrations/20260827120000_add_sync_schedule_pms_status_cron.sql` and confirm the
`$$ ... $$` block is well-formed (the pattern already used by
`supabase/migrations/20260805100000_add_generate_weekly_schedule_cron.sql` — diff against it to
confirm the shape matches exactly aside from the job name, schedule, action body, and function URL
path).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260827120000_add_sync_schedule_pms_status_cron.sql
git commit -m "feat: add 1-minute cron for automatic PMS status sync"
```

(Not applied yet — `supabase db push` happens in Task 7, alongside deploying the Edge Function, so
the migration and the code it depends on land together.)

---

### Task 5: Replace `pushScheduleStatusSync`/`PmsStatusSyncItem` with `syncTabStatusToPms` in `schedulePmsSync.ts`

**Files:**
- Modify: `src/lib/schedulePmsSync.ts`
- Modify: `src/lib/schedulePmsSync.test.ts`

**Interfaces:**
- Produces: `syncTabStatusToPms(tab: string): Promise<void>` — posts
  `{ action: 'syncAllStatuses', tab }` to `SYNC_SCHEDULE_PMS_URL`, same fire-and-forget/
  throw-on-non-OK shape as `pushScheduleActivations`. Replaces `pushScheduleStatusSync` (removed —
  its only caller, `TabScheduleSection.tsx`, is refactored in Task 6) and `PmsStatusSyncItem`
  (removed — no longer crosses the browser/server boundary; `pmsSync.ts` keeps its own
  server-internal copy of this type, used only by `resolveAndSyncTabStatuses`/
  `syncScheduleStatusToPms`).

- [ ] **Step 1: Write the failing test**

Replace the `describe('pushScheduleStatusSync', ...)` block in `src/lib/schedulePmsSync.test.ts`
with:

```ts
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
});
```

(No test for `SYNC_SCHEDULE_PMS_URL` unset — checked, and no existing test in this file covers that
case for `pushScheduleActivations`/`pullScheduleDrift` either, since the module-level `vi.mock` at
the top of this file fixes the URL as always-truthy for every test. Not a gap introduced by this
task; leave it as-is rather than inventing new coverage for an unrelated pre-existing function.)

Update the import line at the top of the test file:

```ts
import { pushScheduleActivations, pullScheduleDrift, syncTabStatusToPms } from './schedulePmsSync';
```

Remove the `pushScheduleStatusSync` import and the `STATUS_ITEM` constant + its two tests (`'does
nothing for an empty item list'`, `'posts action:syncStatus...'`, `'throws on a non-OK response'`
inside the old `describe('pushScheduleStatusSync', ...)` block) — they test a function that no
longer exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/schedulePmsSync.test.ts`
Expected: FAIL — `does not provide an export named 'syncTabStatusToPms'`.

- [ ] **Step 3: Write the implementation**

In `src/lib/schedulePmsSync.ts`, remove the `PmsStatusSyncItem` interface and the
`pushScheduleStatusSync` function (the last ~20 lines of the file), replacing them with:

```ts
// Best-effort, mirrors pushScheduleActivations exactly -- posts action:
// syncAllStatuses scoped to one tab, the on-visit trigger's call shape (the
// cron's own call, made server-side from a pg_cron job, never goes through
// this browser-only wrapper). All resolution logic now lives server-side in
// resolveAndSyncTabStatuses (src/lib/scheduler/pmsSync.ts) -- this file no
// longer builds a PmsStatusSyncItem[] itself, since the PMS API token those
// items would eventually need never reaches the browser anyway.
export async function syncTabStatusToPms(tab: string): Promise<void> {
  if (!SYNC_SCHEDULE_PMS_URL) return;
  const res = await fetch(SYNC_SCHEDULE_PMS_URL, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action: 'syncAllStatuses', tab }),
  });
  if (!res.ok) throw new Error('Failed to sync schedule status to PMS.');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/schedulePmsSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedulePmsSync.ts src/lib/schedulePmsSync.test.ts
git commit -m "refactor: replace pushScheduleStatusSync with tab-scoped syncTabStatusToPms"
```

---

### Task 6: Refactor `TabScheduleSection.tsx`'s status-sync effect to call `syncTabStatusToPms`

**Files:**
- Modify: `src/components/TabScheduleSection.tsx:1-38` (imports), `:497-532` (the effect)

**Interfaces:**
- Consumes: `syncTabStatusToPms(tab: string): Promise<void>` (Task 5).

- [ ] **Step 1: Update imports**

In the import block (lines 1-38 today), on the `schedulePmsSync` import line, replace
`pushScheduleStatusSync, type PmsStatusSyncItem` with `syncTabStatusToPms`:

```ts
import { pushScheduleActivations, pullScheduleDrift, syncTabStatusToPms } from '../lib/schedulePmsSync';
```

On the `scheduleUtils` import line, remove `resolvePmsSyncStatus` (no longer referenced anywhere in
this file — confirm with a search for `resolvePmsSyncStatus(` across `TabScheduleSection.tsx` before
removing; every other name on that import line, including `buildDateStatusIndex`, stays, since
`dateStatusIndex` is still used elsewhere in this component for rendering the calendar's own
confirmed/removed/pending/done badges).

- [ ] **Step 2: Replace the effect**

Replace the entire `useEffect` block currently at lines 497-532 (from `useEffect(() => {` through
its closing `}, [tab, dateStatusIndex, pauses, isApproved, scheduleLoading]);`) with:

```ts
  // Moves this tab's linked PMS tasks to match their calendar cells' real
  // status (Removed/Confirmed/Pending/Done -> Done; Paused -> Project
  // Paused; otherwise To Do) -- one-way, dashboard -> PMS only, a manual PMS
  // column move never writes back here. As of the automatic-sync feature
  // (docs/superpowers/specs/2026-08-27-schedule-pms-automatic-status-sync-design.md),
  // the actual resolution (which links moved, to what) happens entirely
  // server-side in resolveAndSyncTabStatuses (src/lib/scheduler/pmsSync.ts)
  // -- this effect's only job is to ask the server to resolve+sync THIS tab
  // right now, on the same triggers as before (tab load, and any later
  // change to dateStatusIndex/pauses while the tab stays open, e.g. a live
  // realtime entry update), so a status change made while someone is
  // actively looking at this tab still reflects immediately rather than
  // waiting for the next cron tick (up to ~60s later). The 1-minute cron
  // (`sync-schedule-pms-status-minutely`) covers every tab whether or not
  // anyone has it open. See the same four correctness guards documented in
  // the effect this replaced: waits on !scheduleLoading, is keyed on
  // dateStatusIndex/pauses (not just tab), and the server-side resolution
  // itself still applies the same week-scoped pause matching and
  // hidden/restricted/removed-platform exclusion this tab's calendar cells
  // already respect.
  useEffect(() => {
    if (!isApproved || !tabCtx || tabCtx.tab !== tab || scheduleLoading) return;
    let canceled = false;
    (async () => {
      try {
        await syncTabStatusToPms(tab);
      } catch (err) {
        if (!canceled) setToast({ message: err instanceof Error ? err.message : 'Failed to sync schedule status to PMS', kind: 'error' });
      }
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dateStatusIndex, pauses, isApproved, scheduleLoading]);
```

- [ ] **Step 3: Verify unused-import cleanup didn't remove something still needed**

Run: `npm run build`
Expected: clean. If `tsc` reports an unused-import error, that name is genuinely dead (removed
correctly); if it reports a missing-name error, re-check step 1 — something was removed that's
still referenced elsewhere in this file (the earlier research for this plan confirmed
`fetchBrandSchedule`, `weekdayAndWeekStartFor`, `scheduleFor`, `fetchActiveBrandPlatformPauses`,
`brandPlatforms`, and `buildDateStatusIndex` are all still used elsewhere in this component — only
`resolvePmsSyncStatus`, `pushScheduleStatusSync`, and `PmsStatusSyncItem` become unused by this
refactor).

- [ ] **Step 4: Run the full frontend suite**

Run: `npx vitest run`
Expected: PASS (all tests — this component has no dedicated test file today, so this refactor is
verified by the full suite not regressing plus the manual live check in Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/components/TabScheduleSection.tsx
git commit -m "refactor: TabScheduleSection's on-visit PMS status sync now calls the shared server-side resolver"
```

---

### Task 7: Deploy and live-verify

**Files:** none (deploy + verification only)

- [ ] **Step 1: Apply the migration**

Run: `supabase db push`
Expected: `20260827120000_add_sync_schedule_pms_status_cron.sql` applies cleanly. Confirm via:
`supabase db query "select jobname, schedule, active from cron.job where jobname = 'sync-schedule-pms-status-minutely';"`
Expected: one row, `active = true`, `schedule = '* * * * *'`.

- [ ] **Step 2: Deploy the Edge Function**

Run: `supabase functions deploy sync-schedule-pms`
Expected: succeeds; confirm via `supabase functions list` that `sync-schedule-pms` shows a new,
higher version number and `ACTIVE` status.

Run: `supabase functions deploy generate-weekly-schedule` (Task 1 changed this file too, even though
its own behavior is unchanged — the deployed version must match the refactored source).
Expected: succeeds; confirm `ACTIVE` via `supabase functions list`.

- [ ] **Step 3: Confirm the cron is actually firing**

Wait 2 minutes, then run:
`supabase db query "select status, start_time, end_time from cron.job_run_details where jobname = 'sync-schedule-pms-status-minutely' order by start_time desc limit 5;"`
Expected: multiple rows with `status = 'succeeded'`, roughly 60 seconds apart.

- [ ] **Step 4: Live-verify the automatic path**

Pick a real entry on a tab with an existing `schedule_pms_links` row whose `synced_status` doesn't
match its current real status (query `schedule_pms_links` alongside the entry's real status column
to find one, the same way this session's Task 279 investigation did), or manually change one real
entry's status (e.g. to `Done`) via the dashboard UI. Do **not** open that tab's Schedule Planner
page. Wait up to 60 seconds, then re-query that `schedule_pms_links` row's `synced_status` and check
the live PMS board — confirm the card moved to the correct column without any page visit.

- [ ] **Step 5: Live-verify the on-visit path still works**

Open that same tab's Schedule Planner page in a browser. Confirm the network tab shows a
`sync-schedule-pms` POST with `{"action":"syncAllStatuses","tab":"<tab>"}` firing, and that any
newly-changed status on that tab reflects on the PMS board without waiting for the next cron tick.

- [ ] **Step 6: Update `docs/task-history.md`**

Append a new `## Task N: ...` entry (check the current highest task number first) documenting: what
shipped, the extraction of `bootstrapTabRegistries`/`resolveAndSyncTabStatuses`, the removal of the
old `syncStatus` action/`pushScheduleStatusSync`, the new cron job name and schedule, and the live
verification results from Steps 4-5 (including the exact tab/entry used, so a future session can
re-check the same case if needed).

```bash
git add docs/task-history.md
git commit -m "docs: record automatic PMS status sync deploy + live verification"
git push origin main
```
