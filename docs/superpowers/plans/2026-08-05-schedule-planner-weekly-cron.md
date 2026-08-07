# Schedule Planner Weekly Cron Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Schedule Planner generation run automatically every Monday via a server-side
cron job, instead of only firing when a user happens to open that tab's Schedule Planner page.

**Architecture:** A new Supabase Edge Function (`generate-weekly-schedule`) imports the real,
unmodified `src/lib/scheduler/schedulerService.ts` logic and runs it for every operational tab.
A new `pg_cron` job (calling `net.http_post`, the same pattern already used for the TP-status
cron and the SSO daily job) triggers it every Monday. To let the Edge Function call the real
frontend scheduler code, `queries.ts`'s Supabase-touching functions gain an optional injected
`client` parameter (default = today's browser singleton, so every existing call site is
unaffected), and the whole dependency chain gets explicit `.ts` extensions so Deno can resolve
it. The existing page-visit trigger in `SchedulePlanner.tsx` is untouched — it remains a
harmless, idempotent fallback.

**Tech Stack:** TypeScript, Vite/React (frontend), Deno (Supabase Edge Functions), Vitest,
Postgres `pg_cron`/`pg_net`, Supabase CLI (`deno` v2.7.14 and `supabase` CLI are both installed
locally, and this checkout is already linked to the project — confirmed via
`supabase/.temp/project-ref` — so `deno check`/`deno test` and `supabase functions deploy`/
`db push` are real, runnable commands in this environment, not aspirational).

## Global Constraints

- Every existing browser call site of the 8 touched `queries.ts` functions and the 3 touched
  `schedulerService.ts` functions must keep working with zero call-site changes (new `client`
  parameter is optional, defaulting to the existing singleton/behavior).
- No change to `CARRYOVER_RULES.completionThreshold` (stays `0`, deliberately disabled) or any
  other scheduler rule.
- The existing page-visit trigger in `SchedulePlanner.tsx` (`isCurrentWeek`-gated effect) is not
  modified or removed.
- `npm test` (Vitest) and `npm run build` must both pass after every task that touches
  `src/**`.
- Deploying the Edge Function and applying the new migration against the live Supabase project
  are real, executable actions in this environment — but they affect shared production
  infrastructure, so get explicit user confirmation before running `supabase functions deploy`
  or `supabase db push` for real (Task 9).

---

### Task 1: Injectable Supabase client in `queries.ts`

**Files:**
- Modify: `src/lib/queries.ts`
- Test: `src/lib/queries.test.ts` (new)

**Interfaces:**
- Produces: `fetchRemovedPlatformBrands(client?: SupabaseClient)`,
  `fetchRawEntriesByTab(tab: string, client?: SupabaseClient)`,
  `fetchTabHeaders(tab: string, client?: SupabaseClient)`,
  `fetchBrandSchedule(tab: string, weekStart: string, client?: SupabaseClient)`,
  `bulkUpsertBrandSchedule(rows: BrandScheduleUpsertRow[], client?: SupabaseClient)`,
  `fetchActiveBrandPlatformPauses(tab: string, client?: SupabaseClient)`,
  `upsertBrandPlatformPause(tab, brand, platform, pausedWeekStart, reason, client?: SupabaseClient)`,
  `deleteBrandPlatformPause(tab: string, brandKey: string, platform: Platform, client?: SupabaseClient)`
  — all with the new param appended last, defaulting to the module's existing `supabase`
  singleton, so omitting it behaves exactly as before. Task 6 (the Edge Function) is the
  first real caller to ever pass an explicit client.

- [ ] **Step 1: Write the failing test**

Create `src/lib/queries.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

const singletonFrom = vi.fn();
vi.mock('./supabase', () => ({
  supabase: { from: singletonFrom },
  SUPABASE_ANON_KEY: '',
  CHECK_STATUS_URL: '',
  CHECK_STATUS_BASE_URL: '',
  CHECK_STATUS_TOKEN: '',
  CHECK_AG_STATUS_URL: '',
  CHECK_AG_STATUS_BASE_URL: '',
}));

import {
  fetchBrandSchedule,
  fetchActiveBrandPlatformPauses,
  fetchRemovedPlatformBrands,
  bulkUpsertBrandSchedule,
} from './queries';

// Minimal fake of Supabase's thenable PostgrestFilterBuilder: every filter
// method returns the same builder, and awaiting it anywhere in the chain
// resolves via .then() to the fixed result.
function chain(result: { data: unknown; error: null }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve(result),
  };
  return builder;
}

describe('queries.ts injectable Supabase client', () => {
  it('fetchBrandSchedule uses the passed-in client, not the singleton', async () => {
    singletonFrom.mockReturnValue(chain({ data: [], error: null }));
    const fakeFrom = vi.fn().mockReturnValue(chain({
      data: [{ tab: 'X', brand_key: 'y', week_start: '2026-08-10', platform: 'tp', monday: null, tuesday: null, wednesday: null, thursday: null, friday: null }],
      error: null,
    }));
    const fakeClient = { from: fakeFrom } as any;

    const rows = await fetchBrandSchedule('X', '2026-08-10', fakeClient);

    expect(fakeFrom).toHaveBeenCalledWith('brand_schedule');
    expect(singletonFrom).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it('fetchActiveBrandPlatformPauses falls back to the singleton when no client is passed', async () => {
    singletonFrom.mockReturnValue(chain({ data: [], error: null }));
    await fetchActiveBrandPlatformPauses('X');
    expect(singletonFrom).toHaveBeenCalledWith('brand_platform_pause');
  });

  it('fetchRemovedPlatformBrands uses the passed-in client', async () => {
    const fakeFrom = vi.fn().mockReturnValue(chain({ data: [], error: null }));
    await fetchRemovedPlatformBrands({ from: fakeFrom } as any);
    expect(fakeFrom).toHaveBeenCalledWith('removed_platform_brands');
    expect(singletonFrom).not.toHaveBeenCalled();
  });

  it('bulkUpsertBrandSchedule uses the passed-in client for the upsert', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const fakeFrom = vi.fn().mockReturnValue({ upsert });
    await bulkUpsertBrandSchedule(
      [{ tab: 'X', brand: 'Y', week_start: '2026-08-10', platform: 'tp', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null }],
      { from: fakeFrom } as any,
    );
    expect(fakeFrom).toHaveBeenCalledWith('brand_schedule');
    expect(upsert).toHaveBeenCalled();
    expect(singletonFrom).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- queries.test.ts`
Expected: FAIL — `fetchBrandSchedule`/etc. don't accept a third/second `client` argument yet
(the passed-in fake is silently ignored, so `fakeFrom`/`upsert` are never called, and
`singletonFrom` gets called instead — the two `not.toHaveBeenCalled()`/`toHaveBeenCalledWith`
assertions on `fakeFrom` fail).

- [ ] **Step 3: Add the `SupabaseClient` type import and thread `client` through the 8 functions**

In `src/lib/queries.ts`, add this import line near the top of the file, alongside the existing
imports (exact position among them doesn't matter — Task 4 rewrites the whole import block
anyway):

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
```

Replace the 8 functions with client-accepting versions (only the signature and the internal
`supabase.` → `client.` calls change — bodies are otherwise identical):

```ts
export async function fetchRemovedPlatformBrands(
  client: SupabaseClient = supabase,
): Promise<{ tab: string; brand: string; platform: Platform }[]> {
  const { data, error } = await client
    .from('removed_platform_brands')
    .select('tab, brand, platform');
  if (error) throw error;
  return (data ?? []) as { tab: string; brand: string; platform: Platform }[];
}
```

```ts
async function fetchAllTabEntries(tab: string, client: SupabaseClient = supabase): Promise<Entry[]> {
  const cached = tabEntryCache.get(tab);
  if (cached && Date.now() - cached.ts < TAB_CACHE_TTL) return cached.entries;

  const PAGE = 1000;
  const all: Entry[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from('entries')
      .select('*')
      .eq('tab', tab)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as Entry[]));
    if ((data ?? []).length < PAGE) break;
    from += PAGE;
  }

  tabEntryCache.set(tab, { entries: all, ts: Date.now() });
  return all;
}

export async function fetchRawEntriesByTab(tab: string, client: SupabaseClient = supabase): Promise<Entry[]> {
  return fetchAllTabEntries(tab, client);
}
```

```ts
export async function fetchTabHeaders(tab: string, client: SupabaseClient = supabase): Promise<string[]> {
  const { data, error } = await client
    .from('tab_schemas')
    .select('headers')
    .eq('tab', tab)
    .maybeSingle();
  if (error) throw error;
  const headers = (data?.headers ?? []) as string[];
  const filtered = headers.filter((h) => h !== 'id' && h !== 'last_sync_tag' && h !== '');
  if (filtered.length === 0) return getTabColumns(tab) ?? [];
  return Array.from(new Set(filtered));
}
```

```ts
export async function fetchBrandSchedule(tab: string, weekStart: string, client: SupabaseClient = supabase): Promise<BrandScheduleRow[]> {
  const { data, error } = await client
    .from('brand_schedule')
    .select('tab, brand_key, week_start, platform, monday, tuesday, wednesday, thursday, friday')
    .eq('tab', tab)
    .eq('week_start', weekStart);
  if (error) throw error;
  return (data ?? []) as BrandScheduleRow[];
}
```

```ts
export async function bulkUpsertBrandSchedule(rows: BrandScheduleUpsertRow[], client: SupabaseClient = supabase): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client
    .from('brand_schedule')
    .upsert(
      rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'tab,brand_key,platform,week_start' },
    );
  if (error) throw error;
}
```

```ts
export async function fetchActiveBrandPlatformPauses(tab: string, client: SupabaseClient = supabase): Promise<BrandPlatformPause[]> {
  const { data, error } = await client
    .from('brand_platform_pause')
    .select('tab, brand_key, platform, paused_week_start, reason')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as BrandPlatformPause[];
}
```

```ts
export async function upsertBrandPlatformPause(
  tab: string,
  brand: string,
  platform: Platform,
  pausedWeekStart: string,
  reason: string,
  client: SupabaseClient = supabase,
): Promise<void> {
  const { error } = await client
    .from('brand_platform_pause')
    .upsert(
      { tab, brand, platform, paused_week_start: pausedWeekStart, reason },
      { onConflict: 'tab,brand_key,platform' },
    );
  if (error) throw error;
}
```

```ts
export async function deleteBrandPlatformPause(tab: string, brandKey: string, platform: Platform, client: SupabaseClient = supabase): Promise<void> {
  const { error } = await client
    .from('brand_platform_pause')
    .delete()
    .eq('tab', tab)
    .eq('brand_key', brandKey)
    .eq('platform', platform);
  if (error) throw error;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- queries.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS — every existing caller of these 8 functions omits the new argument, so the
default `= supabase` kicks in and behaves exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat(queries): accept an injectable Supabase client for the 8 scheduler-used functions"
```

---

### Task 2: Thread the client through `schedulerService.ts`

**Files:**
- Modify: `src/lib/scheduler/schedulerService.ts`
- Modify: `src/lib/scheduler/schedulerService.test.ts`

**Interfaces:**
- Consumes: the 8 client-accepting functions from Task 1 (same names, same import path
  `'../queries'`).
- Produces: `recalculatePauses(tab, weekStart, ctx, client?: SupabaseClient)`,
  `ensureWeekGenerated(tab, weekStart, ctx, resumedThisWeek, client?: SupabaseClient)` — the
  4th/5th param is optional and undeclared calls forward `undefined`, which Task 1's default
  params resolve to the singleton automatically (no need to import `supabase` into this file
  at all).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/scheduler/schedulerService.test.ts` (inside the existing `describe('recalculatePauses', ...)` block, after the last existing `it`):

```ts
  it('forwards an explicitly-passed client through to the query functions', async () => {
    const fakeClient = { marker: 'fake' } as any;
    const ctx: TabContext = { brands: ['WinMega'], activePlatforms: ['tp'], entries: [] };
    await recalculatePauses('BITP', '2026-08-03', ctx, fakeClient);
    expect(queries.fetchActiveBrandPlatformPauses).toHaveBeenCalledWith('BITP', fakeClient);
    expect(queries.fetchBrandSchedule).toHaveBeenCalledWith('BITP', '2026-08-03', fakeClient);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- schedulerService.test.ts`
Expected: FAIL — `recalculatePauses` doesn't accept or forward a 4th argument yet, so
`fetchActiveBrandPlatformPauses`/`fetchBrandSchedule` are called without `fakeClient`.

- [ ] **Step 3: Add the `client` parameter and thread it through**

In `src/lib/scheduler/schedulerService.ts`, add to the top of the import block:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
```

Update `recalculatePauses`'s signature and its 4 query-function calls:

```ts
export async function recalculatePauses(tab: string, weekStart: string, ctx: TabContext, client?: SupabaseClient): Promise<PinnedCombo[]> {
  const [pauses, existingRows] = await Promise.all([
    fetchActiveBrandPlatformPauses(tab, client),
    fetchBrandSchedule(tab, weekStart, client),
  ]);
```

(the rest of the function body is unchanged except these three call sites, which gain `client`
as their trailing argument in place):

```ts
      if (existing) {
        if (existing.paused_week_start < weekStart) {
          await deleteBrandPlatformPause(tab, brandKey, platform, client);
          resumed.push({ brandKey, platform });
        }
        continue;
      }
```

```ts
      const recent = recentStatusesFor(ctx.entries, brandKey, platform).slice(0, 2);
      const bothRemoved = recent.length === 2 && recent.every(isRemovedStatus);
      if (bothRemoved) {
        await upsertBrandPlatformPause(tab, brand, platform, weekStart, 'Two consecutive Removed/Refused posts', client);
        continue;
      }
```

```ts
      if (lowSuccessRate) {
        const pct = successRatePct(sr!.rate);
        await upsertBrandPlatformPause(
          tab, brand, platform, weekStart,
          `Success rate below ${PAUSE_RULES.successRateThreshold}% (${pct}% over ${decided} posts)`,
          client,
        );
      }
```

Update `buildCarryover`'s signature and its `fetchBrandSchedule` call:

```ts
async function buildCarryover(tab: string, weekStart: string, ctx: TabContext, client?: SupabaseClient): Promise<CarryoverItem[]> {
  const lastWeekStart = shiftWeek(weekStart, -7);
  const lastWeekRows = (await fetchBrandSchedule(tab, lastWeekStart, client)).filter((r) => r.platform != null);
```

Update `ensureWeekGenerated`'s signature and its 3 remaining call sites:

```ts
export async function ensureWeekGenerated(
  tab: string,
  weekStart: string,
  ctx: TabContext,
  resumedThisWeek: PinnedCombo[],
  client?: SupabaseClient,
): Promise<void> {
  const existingRows = await fetchBrandSchedule(tab, weekStart, client);
```

```ts
  const pauses = await fetchActiveBrandPlatformPauses(tab, client);
```

```ts
  const carryover = await buildCarryover(tab, weekStart, ctx, client);
```

```ts
  if (slots.length === 0) return;
  await bulkUpsertBrandSchedule(groupSlotsIntoRows(tab, weekStart, slots), client);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- schedulerService.test.ts`
Expected: PASS (all existing cases plus the new one)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS — `SchedulePlanner.tsx`'s existing 3-arg/4-arg calls to `recalculatePauses`/
`ensureWeekGenerated` omit the new `client` argument, which becomes `undefined` and is
forwarded as `undefined` to Task 1's functions, which then fall back to their own `= supabase`
default exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler/schedulerService.ts src/lib/scheduler/schedulerService.test.ts
git commit -m "feat(scheduler): thread an optional Supabase client through recalculatePauses/ensureWeekGenerated"
```

---

### Task 3: Make `supabase.ts` safe to import from Deno

**Files:**
- Modify: `src/lib/supabase.ts`

**Interfaces:**
- Produces: same exports as today (`supabase`, `SUPABASE_ANON_KEY`, `CHECK_STATUS_URL`,
  `CHECK_STATUS_BASE_URL`, `CHECK_STATUS_TOKEN`, `CHECK_AG_STATUS_URL`,
  `CHECK_AG_STATUS_BASE_URL`, `AI_ASSISTANT_URL`) — values are unchanged in the browser;
  importing the module no longer throws in a runtime with no `import.meta.env` (Deno).

This file is imported transitively by `queries.ts` (and therefore by every module in Task 1/2's
chain). Two real problems block importing it from Deno today, found while researching this
plan:
1. `import.meta.env.VITE_X` throws in Deno — `import.meta` exists but has no `.env` property,
   so `.VITE_X` on `undefined` throws `TypeError: Cannot read properties of undefined`.
2. Even after fixing (1), `createClient(url ?? '', anonKey ?? '')` still throws — verified in
   `node_modules/@supabase/supabase-js/src/lib/helpers.ts:86` and `SupabaseClient.ts:286`,
   which throw `'supabaseUrl is required.'`/`'supabaseKey is required.'` for falsy arguments,
   and `''` is falsy.

No test is added for this step — Vitest always runs under Vite, which statically defines
`import.meta.env`, so it can't exercise the "no `import.meta.env` at all" case this fix
targets. Task 5's `deno check` is the real verification for this file.

- [ ] **Step 1: Guard every `import.meta.env` access and give `createClient` non-throwing fallbacks**

Replace the top of `src/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env?.VITE_SUPABASE_URL;
const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — check .env');
}

// createClient throws if either argument is falsy (see
// @supabase/supabase-js's helpers.ts/SupabaseClient.ts) — fall back to
// harmless placeholder values so importing this module never crashes, e.g.
// from a Deno Edge Function, which has no import.meta.env and always hits
// this branch. Every caller outside the browser passes its own client
// explicitly (see queries.ts's injectable `client` parameter), so this
// placeholder client is constructed but never actually used.
export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder-anon-key');

export const SUPABASE_ANON_KEY = anonKey ?? '';
export const CHECK_STATUS_URL = import.meta.env?.VITE_CHECK_STATUS_URL ?? '';
// VITE_CHECK_STATUS_URL must end in /check-status (e.g. http://localhost:5001/check-status)
export const CHECK_STATUS_BASE_URL = CHECK_STATUS_URL.replace(/\/check-status$/, '');
// Shared secret for the self-hosted status server (behind a Cloudflare Tunnel).
// Protected by the Vercel password gate; its job is to stop strangers who find
// the tunnel URL from triggering Selenium runs. Falls back to the anon key so
// local dev against an open server still works.
export const CHECK_STATUS_TOKEN = import.meta.env?.VITE_CHECK_STATUS_TOKEN ?? '';

// Separate local-PC server for AG/CG/WO checks — EC2's Singapore IP is geo-blocked
// by AskGamblers, so these must run from a residential IP.
// Set VITE_CHECK_AG_STATUS_URL to your local ngrok URL + /check-status.
// Falls back to CHECK_STATUS_URL so a single server still works in dev.
export const CHECK_AG_STATUS_URL = import.meta.env?.VITE_CHECK_AG_STATUS_URL || CHECK_STATUS_URL;
export const CHECK_AG_STATUS_BASE_URL = CHECK_AG_STATUS_URL.replace(/\/check-status$/, '');

// AI assistant Edge Function URL (gpt-4o-mini proxy). Set in Vercel env once the
// `ai-assistant` function is deployed. Empty string disables the assistant.
export const AI_ASSISTANT_URL = import.meta.env?.VITE_AI_ASSISTANT_URL ?? '';
```

- [ ] **Step 2: Run the full suite and build to confirm no regressions**

Run: `npm test && npm run build`
Expected: PASS — Vite still statically replaces `import.meta.env` as a whole object at build
time, so `import.meta.env?.VITE_X` behaves identically to `import.meta.env.VITE_X` in every
browser/Vite context; only Deno (where the object itself is absent) takes the new fallback
path.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "fix(supabase): make module import-safe outside Vite (optional-chained env access, non-throwing client fallback)"
```

---

### Task 4: Explicit `.ts` extensions on the scheduler dependency chain

**Files:**
- Modify: `src/lib/scheduleBrands.ts`
- Modify: `src/lib/scoreSummary.ts`
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/scheduler/schedulerRules.ts`
- Modify: `src/lib/scheduler/scheduleUtils.ts`
- Modify: `src/lib/scheduler/schedulerEngine.ts`
- Modify: `src/lib/scheduler/schedulerService.ts`

Deno requires explicit file extensions on relative imports; today's code omits them (standard
for Vite/tsc). This is confirmed safe for the Vite/tsc side: `tsconfig.app.json` already has
`allowImportingTsExtensions: true`. Only relative (`./`/`../`) import paths change — the
`@supabase/supabase-js` package specifier is untouched (Task 5 handles its Deno resolution via
an import map, not an extension). Import-line edits only, no logic changes, so this task has no
new test of its own — Steps 2 and 4 (build + full suite) are the verification.

- [ ] **Step 1: Add `.ts` to every relative import in the 7 files**

`src/lib/scheduleBrands.ts` — top of file:
```ts
import { normalizeBrandKey } from './removedPlatformBrands.ts';
import type { Platform } from './removedPlatformBrands.ts';
```

`src/lib/scoreSummary.ts` — top of file:
```ts
import type { Entry } from '../types/entry.ts';
import { platformRemovedKey } from './removedPlatformBrands.ts';
import type { Platform } from './removedPlatformBrands.ts';
import { accountUsageKey } from './tab-configs.ts';
```

`src/lib/queries.ts` — top of file (the `SupabaseClient` line from Task 1 is unaffected, it's
a package specifier):
```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase, SUPABASE_ANON_KEY, CHECK_STATUS_URL, CHECK_STATUS_BASE_URL, CHECK_STATUS_TOKEN, CHECK_AG_STATUS_URL, CHECK_AG_STATUS_BASE_URL } from './supabase.ts';
import { inDateRange } from './dateUtils.ts';
import { getTabColumns, getBrandNameCol } from './tab-configs.ts';
import { platformRemovedKey, normalizeBrandKey, type Platform } from './removedPlatformBrands.ts';
import type { BrandScheduleRow, BrandScheduleUpsertRow, Weekday, DayStatus } from './scheduleBrands.ts';
import type { Mention, MentionStatus } from '../types/mention.ts';
import type { Entry } from '../types/entry.ts';
import type { Profile } from '../types/profile.ts';
import type { BrandEntry, TabKpis } from '../types/brand-entry.ts';
import type { AuditEntityType, AuditLogEntry } from '../types/audit-log.ts';
```

`src/lib/scheduler/schedulerRules.ts` — top of file:
```ts
import type { Weekday } from '../scheduleBrands.ts';
import type { Platform } from '../removedPlatformBrands.ts';
```

`src/lib/scheduler/scheduleUtils.ts` — top of file:
```ts
import { WEEKDAYS, toISODate, type Weekday, type BrandScheduleRow } from '../scheduleBrands.ts';
import { normalizeBrandKey, type Platform } from '../removedPlatformBrands.ts';
import { PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, pick, isRemovedStatus, isLiveStatus, parsePostDate } from '../scoreSummary.ts';
import { BRAND_COLS } from '../tab-configs.ts';
import type { Entry } from '../../types/entry.ts';
```

`src/lib/scheduler/schedulerEngine.ts` — top of file:
```ts
import { WEEKDAYS, type Weekday } from '../scheduleBrands.ts';
import { normalizeBrandKey, type Platform } from '../removedPlatformBrands.ts';
import { PLATFORM_RULES, type PlatformRule } from './schedulerRules.ts';
import { leastLoadedDay } from './scheduleUtils.ts';
```

`src/lib/scheduler/schedulerService.ts` — top of file (the `SupabaseClient` line from Task 2
is unaffected):
```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isDoneStatus,
  fetchBrandSchedule,
  bulkUpsertBrandSchedule,
  fetchActiveBrandPlatformPauses,
  upsertBrandPlatformPause,
  deleteBrandPlatformPause,
} from '../queries.ts';
import {
  PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, pick, isRemovedStatus, parsePostDate,
  computeSuccessRates, successRatePct, type SuccessRate,
} from '../scoreSummary.ts';
import { normalizeBrandKey, platformRemovedKey, type Platform } from '../removedPlatformBrands.ts';
import { WEEKDAYS, toISODate, type BrandScheduleUpsertRow } from '../scheduleBrands.ts';
import { BRAND_COLS } from '../tab-configs.ts';
import { generateWeekSchedule, type PinnedCombo, type CarryoverItem, type ScheduledSlot } from './schedulerEngine.ts';
import { weeklyCompletion, completedBrandPlatformKey } from './scheduleUtils.ts';
import { CARRYOVER_RULES, PAUSE_RULES } from './schedulerRules.ts';
import type { Entry } from '../../types/entry.ts';
```

- [ ] **Step 2: Run the build to confirm the extensions don't break Vite/tsc**

Run: `npm run build`
Expected: PASS (no TypeScript errors — `allowImportingTsExtensions` already permits this)

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — no behavior changed, only import specifiers.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scheduleBrands.ts src/lib/scoreSummary.ts src/lib/queries.ts src/lib/scheduler/schedulerRules.ts src/lib/scheduler/scheduleUtils.ts src/lib/scheduler/schedulerEngine.ts src/lib/scheduler/schedulerService.ts
git commit -m "chore(scheduler): add explicit .ts extensions to relative imports for Deno compatibility"
```

---

### Task 5: Scaffold the Edge Function and verify Deno can resolve the dependency chain

**Files:**
- Create: `supabase/functions/generate-weekly-schedule/deno.json`
- Create: `supabase/functions/generate-weekly-schedule/index.ts` (spike version, replaced in
  Task 6)

This is the risk-verification step: no Edge Function in this repo has ever imported code from
`src/lib` before (every existing function is self-contained within `supabase/functions/`), and
`src/lib/supabase.ts` imports `@supabase/supabase-js` as a bare package specifier, which Deno
cannot resolve without an import map. `deno.json`'s `imports` field is Supabase's documented,
standard mechanism for this (auto-detected per-function directory by `supabase functions
deploy`/`serve`).

- [ ] **Step 1: Create the import map**

Create `supabase/functions/generate-weekly-schedule/deno.json`:

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2"
  }
}
```

- [ ] **Step 2: Create a minimal spike `index.ts`**

Create `supabase/functions/generate-weekly-schedule/index.ts`:

```ts
import { createClient } from '@supabase/supabase-js';
import { OPERATIONAL_TABS } from '../../../src/lib/tabs.ts';
import { fetchRawEntriesByTab } from '../../../src/lib/queries.ts';
import { recalculatePauses, ensureWeekGenerated } from '../../../src/lib/scheduler/schedulerService.ts';

// Spike: proves Deno can resolve this repo's src/lib modules (relative .ts
// extensions from Task 4 + the @supabase/supabase-js bare specifier via this
// directory's deno.json import map) before Task 6 builds out the real
// orchestration logic. Each import is referenced so an "unused import" error
// can't mask a real resolution failure.
console.log(typeof createClient, OPERATIONAL_TABS.length, typeof fetchRawEntriesByTab, typeof recalculatePauses, typeof ensureWeekGenerated);

Deno.serve(() => new Response('ok'));
```

- [ ] **Step 3: Verify Deno resolves and type-checks the whole chain**

Run: `deno check supabase/functions/generate-weekly-schedule/index.ts`
Expected: exits 0 with no output (or only version/download noise from fetching the
`npm:@supabase/supabase-js@2` and any `deno.land/std` deps on first run).

**More rigorous alternative:** this repo is a monorepo checkout with a root `node_modules`
present, so the plain form above can resolve `@supabase/supabase-js` via `node_modules`
instead of via `deno.json`'s import map — a typo'd or missing `deno.json` would go
undetected even though it would break at actual deploy time (no `node_modules` there). To
genuinely exercise the import map, run:
`deno check --no-lock --node-modules-dir=none --config supabase/functions/generate-weekly-schedule/deno.json supabase/functions/generate-weekly-schedule/index.ts`

**If this fails:** read the specific unresolved-specifier or type error.
- An extensionless relative import surfacing from a file this plan didn't touch (e.g. one of
  `src/types/entry.ts`, `mention.ts`, `profile.ts`, `brand-entry.ts`, `audit-log.ts`, which
  weren't individually inspected for their own relative imports during planning) — add the
  missing `.ts` extension there too, the same mechanical fix as Task 4, and re-run.
  `types/entry.ts` is confirmed already self-contained (no imports) from planning research;
  the other 4 type files were not.
- A bare-specifier resolution failure for `@supabase/supabase-js` despite the `deno.json` —
  confirm the file is being picked up by running `deno check` from the repo root (not from
  inside the function directory), and that the JSON is valid.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/generate-weekly-schedule/deno.json supabase/functions/generate-weekly-schedule/index.ts
git commit -m "chore(generate-weekly-schedule): scaffold Edge Function, verify Deno resolves src/lib scheduler chain"
```

---

### Task 6: Implement the per-tab orchestration

**Files:**
- Modify: `src/lib/scheduleBrands.ts` (extract `mondayOf`)
- Modify: `src/pages/SchedulePlanner.tsx` (use the extracted `mondayOf`)
- Modify: `supabase/functions/generate-weekly-schedule/index.ts` (replace the Task 5 spike)

**Interfaces:**
- Produces (from `scheduleBrands.ts`): `mondayOf(date: Date): Date`
- Produces (from the Edge Function, for Task 7's tests):
  `buildTabContext(tab: string, client: SupabaseClient): Promise<TabContext>`,
  `generateForTab(tab: string, weekStart: string, client: SupabaseClient): Promise<void>`,
  `generateAllTabs(tabs: readonly string[], weekStart: string, client: SupabaseClient, generateFn?): Promise<Record<string, string>>`
- Consumes: `TabContext` from `schedulerService.ts` (Task 1/2), `getTabPlatforms`/`BRAND_COLS`/
  `getBrandNameCol`/`TAB_DEFAULT_BRAND` from `tab-configs.ts`, `buildRemovedPlatformBrandSet`
  from `removedPlatformBrands.ts`, `OPERATIONAL_TABS` from `tabs.ts`.

`mondayOf` currently only exists as a private helper inside `SchedulePlanner.tsx`
(`src/pages/SchedulePlanner.tsx:40-47`). The Edge Function needs the identical Monday
computation to pick the right `weekStart` — duplicating it would reintroduce exactly the kind
of drift risk this whole plan exists to avoid (see the spec's Decision 2), so it's extracted
into `scheduleBrands.ts` next to `toISODate`, which already has the same "shared date logic"
role.

- [ ] **Step 1: Extract `mondayOf` into `scheduleBrands.ts`**

Add to `src/lib/scheduleBrands.ts`, directly after `toISODate`'s closing brace:

```ts
export function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
```

- [ ] **Step 2: Update `SchedulePlanner.tsx` to import it instead of defining its own copy**

In `src/pages/SchedulePlanner.tsx`, change the import line for `scheduleBrands`:

```ts
import { WEEKDAYS, scheduleFor, nextStatus, withDayStatus, toISODate, mondayOf, type BrandScheduleRow, type DayStatus, type Weekday } from '../lib/scheduleBrands';
```

Delete the local `mondayOf` function definition (`SchedulePlanner.tsx:40-47`, the block starting
`function mondayOf(date: Date): Date {` and ending at its closing `}`). Every existing call site
(`mondayOf(parsed)`, `mondayOf(new Date())` in the `weekStart` initializer, and
`mondayOf(new Date())` in the `isCurrentWeek` check) is unchanged — only the definition moves.

- [ ] **Step 3: Run the full suite and build to confirm the extraction is behavior-preserving**

Run: `npm test && npm run build`
Expected: PASS

- [ ] **Step 4: Replace the Edge Function spike with the real orchestration**

Replace `supabase/functions/generate-weekly-schedule/index.ts` in full:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OPERATIONAL_TABS } from '../../../src/lib/tabs.ts';
import { BRAND_COLS, getBrandNameCol, TAB_DEFAULT_BRAND, getTabPlatforms } from '../../../src/lib/tab-configs.ts';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchRemovedPlatformBrands } from '../../../src/lib/queries.ts';
import { buildRemovedPlatformBrandSet, type Platform } from '../../../src/lib/removedPlatformBrands.ts';
import { toISODate, mondayOf } from '../../../src/lib/scheduleBrands.ts';
import { recalculatePauses, ensureWeekGenerated, type TabContext } from '../../../src/lib/scheduler/schedulerService.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Assembles the same TabContext SchedulePlanner.tsx's brand-loading effect
// builds client-side (fetchRawEntriesByTab + fetchTabHeaders +
// fetchRemovedPlatformBrands, then derive brands/activePlatforms) — kept as
// its own function so it's independently testable (Task 7) without
// re-exercising recalculatePauses/ensureWeekGenerated, which already have
// full coverage in schedulerService.test.ts.
export async function buildTabContext(tab: string, client: SupabaseClient): Promise<TabContext> {
  const [rawEntries, headers, removedPlatformBrandRows] = await Promise.all([
    fetchRawEntriesByTab(tab, client),
    fetchTabHeaders(tab, client),
    fetchRemovedPlatformBrands(client),
  ]);
  const brandCol = BRAND_COLS.find((c) => headers.includes(c)) ?? getBrandNameCol(tab);
  const uniqueBrands = [...new Set(
    rawEntries
      .map((e) => e.data[brandCol])
      .filter((v): v is string => !!v && v.trim() !== ''),
  )].sort();
  if (uniqueBrands.length === 0 && TAB_DEFAULT_BRAND[tab]) uniqueBrands.push(TAB_DEFAULT_BRAND[tab]);

  return {
    brands: uniqueBrands,
    activePlatforms: getTabPlatforms(tab),
    entries: rawEntries,
    removedPlatformBrandSet: buildRemovedPlatformBrandSet(
      removedPlatformBrandRows as { tab: string; brand: string; platform: Platform }[],
    ),
  };
}

export async function generateForTab(tab: string, weekStart: string, client: SupabaseClient): Promise<void> {
  const ctx = await buildTabContext(tab, client);
  if (ctx.brands.length === 0 || ctx.activePlatforms.length === 0) return;
  const resumed = await recalculatePauses(tab, weekStart, ctx, client);
  await ensureWeekGenerated(tab, weekStart, ctx, resumed, client);
}

// Runs generateForTab for every tab independently — one tab's failure (a
// malformed entry, a transient DB error) must not stop the rest of the
// week's tabs from generating. generateFn is injectable so Task 7's tests
// can verify this isolation without needing a real Supabase client.
export async function generateAllTabs(
  tabs: readonly string[],
  weekStart: string,
  client: SupabaseClient,
  generateFn: (tab: string, weekStart: string, client: SupabaseClient) => Promise<void> = generateForTab,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const tab of tabs) {
    try {
      await generateFn(tab, weekStart, client);
      results[tab] = 'ok';
    } catch (err) {
      console.error(`[generate-weekly-schedule] ${tab} failed:`, err);
      results[tab] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return results;
}

Deno.serve(async (_req: Request): Promise<Response> => {
  const client = createClient(SUPABASE_URL, SERVICE_ROLE);
  const weekStart = toISODate(mondayOf(new Date()));
  const results = await generateAllTabs(OPERATIONAL_TABS, weekStart, client);
  return new Response(JSON.stringify({ weekStart, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 5: Re-run the Deno type check**

Run: `deno check supabase/functions/generate-weekly-schedule/index.ts`
Expected: exits 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduleBrands.ts src/pages/SchedulePlanner.tsx supabase/functions/generate-weekly-schedule/index.ts
git commit -m "feat(generate-weekly-schedule): implement per-tab orchestration, extract shared mondayOf"
```

---

### Task 7: Deno tests for the Edge Function

**Files:**
- Create: `supabase/functions/generate-weekly-schedule/index_test.ts`

(Named with an underscore, not `.test.ts`, matching `ai-assistant/tools_test.ts`'s existing
convention — Vitest's default include glob only matches `.test.ts`/`.spec.ts`, so this file is
correctly invisible to `npm test` and only runs under `deno test`.)

- [ ] **Step 1: Write the tests**

Create `supabase/functions/generate-weekly-schedule/index_test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildTabContext, generateAllTabs } from './index.ts';

// Minimal fake of Supabase's thenable PostgrestFilterBuilder: every filter
// method returns the same builder, and awaiting it anywhere in the chain
// resolves via .then() to the fixed row list. .maybeSingle() is a real
// terminal async method (queries.ts always calls it last, never chains
// after it), so it returns a resolved promise directly instead of the
// builder.
function tableBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    range: () => builder,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then(onfulfilled: (v: { data: unknown[]; error: null }) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(onfulfilled);
    },
  };
  return builder;
}

function fakeClient(tables: Record<string, unknown[]>): SupabaseClient {
  return { from: (table: string) => tableBuilder(tables[table] ?? []) } as unknown as SupabaseClient;
}

function entry(tab: string, id: string, data: Record<string, string | null>) {
  return { id, tab, sheet_row_id: id, data, updated_at: '', last_edited_by: 'dashboard' as const, last_sync_tag: null };
}

// buildTabContext calls fetchRawEntriesByTab, which caches by tab name for
// 60s in a module-level Map inside queries.ts. Each test below uses a
// distinct tab name specifically to avoid one test's fake data leaking into
// another via that cache within this one Deno test-file process.

Deno.test('buildTabContext derives brands from raw entries, deduped and sorted, with WO platform', async () => {
  const client = fakeClient({
    entries: [
      entry('Wizard of Odds', '1', { Brands: 'WinMega' }),
      entry('Wizard of Odds', '2', { Brands: 'WinMega' }),
      entry('Wizard of Odds', '3', { Brands: 'BrandB' }),
    ],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
  });
  const ctx = await buildTabContext('Wizard of Odds', client);
  assertEquals(ctx.brands, ['BrandB', 'WinMega']);
  assertEquals(ctx.activePlatforms, ['wo']);
  assertEquals(ctx.removedPlatformBrandSet.size, 0);
});

Deno.test('buildTabContext falls back to TAB_DEFAULT_BRAND when no entry has a brand value', async () => {
  const client = fakeClient({
    entries: [entry('Trybet', '1', {})],
    tab_schemas: [{ headers: [] }],
    removed_platform_brands: [],
  });
  const ctx = await buildTabContext('Trybet', client);
  assertEquals(ctx.brands, ['Trybet']);
});

Deno.test('generateAllTabs continues past a single tab failure', async () => {
  const calls: string[] = [];
  const fakeGenerate = async (tab: string) => {
    calls.push(tab);
    if (tab === 'Trybet') throw new Error('boom');
  };
  const results = await generateAllTabs(
    ['TP Brand Injection', 'Trybet', 'Hanan'],
    '2026-08-10',
    {} as SupabaseClient,
    fakeGenerate,
  );
  assertEquals(calls, ['TP Brand Injection', 'Trybet', 'Hanan']);
  assertEquals(results['TP Brand Injection'], 'ok');
  assertEquals(results['Trybet'], 'error: boom');
  assertEquals(results['Hanan'], 'ok');
});
```

- [ ] **Step 2: Run the Deno tests**

Run: `deno test --allow-env --allow-net supabase/functions/generate-weekly-schedule/index_test.ts`
Expected: PASS (3 tests). `--allow-env` is required because `index.ts`'s module-level
`Deno.env.get('SUPABASE_URL')`/`SUPABASE_SERVICE_ROLE_KEY` calls need env-read permission even
though their values are never used by the imported `buildTabContext`/`generateAllTabs`
functions themselves (only by `Deno.serve`'s handler, which the test file never invokes).
`--allow-net` is also required: `index.ts` has a top-level `Deno.serve(...)` call, so merely
importing it for testing binds a real listener — omitting `--allow-net` fails with
`NotCapable: Requires net access`, even though the test never sends the server a request.

- [ ] **Step 3: Confirm `npm test` still ignores this file**

Run: `npm test`
Expected: PASS, with no mention of `index_test.ts` in the output (same underscore-naming
exclusion `ai-assistant/tools_test.ts` already relies on).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/generate-weekly-schedule/index_test.ts
git commit -m "test(generate-weekly-schedule): cover TabContext assembly and per-tab failure isolation"
```

---

### Task 8: Migration for the weekly cron job

**Files:**
- Create: `supabase/migrations/20260805100000_add_generate_weekly_schedule_cron.sql`

Follows the exact `cron.schedule(name, expr, $$ select net.http_post(...) $$)` shape already
live in `supabase/schema.sql` (the `check-tp-review-status-daily` job) — same project ref and
anon-key bearer token already committed there (anon keys are meant to be public/embeddable, so
reusing the one already in this repo is consistent with existing practice, not a new exposure).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260805100000_add_generate_weekly_schedule_cron.sql`:

```sql
-- supabase/migrations/20260805100000_add_generate_weekly_schedule_cron.sql
-- Runs Schedule Planner generation every Monday via the new
-- generate-weekly-schedule Edge Function, so a tab's schedule generates
-- even if nobody opens that tab's Schedule Planner page that week. The
-- existing page-visit trigger (SchedulePlanner.tsx's isCurrentWeek-gated
-- effect) stays in place as an idempotent fallback. See
-- docs/superpowers/specs/2026-08-05-schedule-planner-weekly-cron-design.md.
--
-- 01:00 UTC Monday = 09:00 Asia/Manila Monday, the team's operating
-- timezone (see ai-assistant's system-message +8h offset and
-- scheduleBrands.ts's toISODate) — safely past local midnight, so the job
-- never fires while it's still Sunday there.
--
-- Requires pg_cron and pg_net extensions to be enabled in the Supabase
-- dashboard (already required by check-tp-review-status-daily below in
-- schema.sql, so almost certainly already on).
select cron.schedule(
  'generate-weekly-schedule-monday',
  '0 1 * * 1',
  $$
    select net.http_post(
      url     := 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/generate-weekly-schedule',
      body    := '{}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU"}'::jsonb
    )
  $$
);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260805100000_add_generate_weekly_schedule_cron.sql
git commit -m "feat(db): add weekly Monday cron job for generate-weekly-schedule"
```

(This step only adds the migration file — it does not apply it to the live database. Applying
it is part of Task 9, which requires explicit confirmation.)

---

### Task 9: Final verification and deployment

**Files:** none (verification and manual deployment only)

- [ ] **Step 1: Run the full frontend suite and build one more time**

Run: `npm test && npm run build`
Expected: PASS — confirms Tasks 1-4 and 6's `SchedulePlanner.tsx`/`scheduleBrands.ts` changes
are all still consistent together.

- [ ] **Step 2: Run the Deno checks one more time**

Run: `deno check supabase/functions/generate-weekly-schedule/index.ts && deno test --allow-env --allow-net supabase/functions/generate-weekly-schedule/index_test.ts`
Expected: both PASS. (`--allow-net` is required on the test command: `index.ts` has a
top-level `Deno.serve(...)` call, so merely importing it binds a real listener.)

**More rigorous alternative for the `deno check` half:** this repo is a monorepo checkout with
a root `node_modules` present, so the plain form above can resolve `@supabase/supabase-js` via
`node_modules` instead of via `deno.json`'s import map, masking a typo'd or missing
`deno.json`. To genuinely exercise the import map, run:
`deno check --no-lock --node-modules-dir=none --config supabase/functions/generate-weekly-schedule/deno.json supabase/functions/generate-weekly-schedule/index.ts`

- [ ] **Step 3: Ask the user for explicit go-ahead before touching the live project**

This is the point where the work starts affecting shared production infrastructure
(deploying a function, running a migration against the live database). Confirm with the user
before running the two commands below — do not run them automatically.

- [ ] **Step 4: Apply the migration (only after user confirmation)**

Run: `supabase db push`
Expected: reports `20260805100000_add_generate_weekly_schedule_cron.sql` applied.

- [ ] **Step 5: Deploy the Edge Function (only after user confirmation)**

Run: `supabase functions deploy generate-weekly-schedule`
Expected: reports a successful deploy. No new secrets are required — `SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY` are auto-injected into every Edge Function by Supabase.

- [ ] **Step 6: Confirm the cron job registered**

Run (via the Supabase SQL Editor, or `supabase db push`'s own connection):
```sql
select jobname, schedule, active from cron.job where jobname = 'generate-weekly-schedule-monday';
```
Expected: one row, `active = true`, `schedule = '0 1 * * 1'`.

- [ ] **Step 7: One-time manual invocation to confirm it actually writes schedule rows**

Rather than waiting for the next real Monday, manually invoke the deployed function once (via
the Supabase dashboard's "Invoke" button, or `curl` with the anon key) and then check:
```sql
select tab, count(*) from brand_schedule where updated_at > now() - interval '5 minutes' group by tab;
```
Expected: rows appear for tabs that didn't already have a fully-generated current week — this
is the same idempotent generation `SchedulePlanner.tsx`'s page-visit trigger already produces,
just invoked without opening the page.
