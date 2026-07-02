# Per-Brand "Newly Removed" Drilldown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each brand pill on the Check Status page (`/sync`) an accurate per-run "newly removed" count, clickable to show exactly which accounts/reviews flipped to removed, backed by new Supabase tables instead of today's localStorage + arithmetic-delta approach.

**Architecture:** Two new Supabase tables (`full_check_runs`, `full_check_removed_entries`) replace the `fullCheckHistory` localStorage list. On every full check, the frontend snapshots every currently-removed (entry, platform) pair. A pure diff function compares two runs' snapshots by `entry_id + platform` to compute true newly-removed counts, fetched lazily only when a run row is expanded. A new `RunHistoryTable` component (extracted from `SyncStatus.tsx`) owns the expand/diff/drilldown UI.

**Tech Stack:** Vite · React 19 · TypeScript · Supabase (Postgres + supabase-js) · Vitest (new)

**Spec:** `docs/superpowers/specs/2026-07-02-newly-removed-drilldown-design.md`

## Global Constraints

- TypeScript strict mode; no `any` without a comment explaining why.
- All Supabase reads/writes happen in `src/lib/queries.ts` — components never call `supabase.from(...)` directly.
- Any new table with RLS gets SELECT, INSERT, and DELETE policies gated by `public.is_approved()` (matches `sync_runs`; DELETE included even though unused today so a future delete feature doesn't silently no-op).
- This repo has no `tsc --noEmit`-only check (root tsconfig is references-only) — verify all TypeScript changes with `npm run build`.
- This repo has no existing test runner. The one pure, dependency-free function in this plan (`diffRemovedEntries`) gets real Vitest unit tests per the approved spec. Everything else (Supabase-integration functions in `queries.ts`, UI components) follows this codebase's existing convention: verified via `npm run build` + manual browser verification (Task 6) — there is no mocking layer for `supabase-js` in this repo and none is being introduced.
- Applying the migration (Task 1) modifies the live, shared production database (`Brands Partner Forum`, ref `krxnupmhfiduduvvlumc`). **Get explicit confirmation from Leo immediately before running `supabase db push --linked`.** Do not run it automatically just because the plan says so.
- Note for whoever executes this: there is a remote migration `20260702120000_add_delete_edit_audit_logs` already applied to production with no corresponding file in this repo (unrelated to this feature, from the delete/edit audit-log work). This plan's migration uses a distinct, later timestamp so it doesn't collide — it's flagged here so it isn't mistaken for drift caused by this plan.

---

## File Structure

- Create: `supabase/migrations/20260702180000_add_full_check_run_history.sql` — new tables + RLS
- Create: `src/lib/removedEntriesDiff.ts` — pure diff function + shared `Platform`/`RemovedEntryRow` types
- Create: `src/lib/removedEntriesDiff.test.ts` — Vitest unit tests
- Modify: `src/lib/queries.ts` — add `fetchRemovedEntryDetails`, `recordFullCheckRun`, `fetchFullCheckRuns`, `fetchRemovedEntriesForRun`
- Create: `src/components/RunHistoryTable.tsx` — extracted run-history table UI (expand/diff/drilldown)
- Modify: `src/pages/SyncStatus.tsx` — drop localStorage history, load from Supabase, render `<RunHistoryTable />`
- Modify: `vite.config.ts` — switch to `vitest/config`'s `defineConfig`, add `test.environment`
- Modify: `package.json` — add `vitest` devDependency + `test` script

---

### Task 1: Supabase migration for run-history tables

**Files:**
- Create: `supabase/migrations/20260702180000_add_full_check_run_history.sql`

**Interfaces:**
- Produces: tables `public.full_check_runs (id, run_at, scope jsonb, summary jsonb)` and `public.full_check_removed_entries (id, run_id, entry_id, tab, brand, account_name, platform, link, created_at)` — every later task's Supabase queries target these exact names/columns.

- [ ] **Step 1: Write the migration file**

```sql
-- Full-check run history + per-run removed-entry snapshots, replacing the
-- client-only localStorage history on the Check Status page.
create table public.full_check_runs (
  id      uuid primary key default gen_random_uuid(),
  run_at  timestamptz not null default now(),
  scope   jsonb not null,  -- { tabsRun, tabsTotal, brandsRun, brandsTotal }
  summary jsonb not null   -- TabStatusRow[] as computed by fetchAllTabsStatusSummary
);
create index full_check_runs_run_at_idx on public.full_check_runs (run_at desc);

create table public.full_check_removed_entries (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.full_check_runs(id) on delete cascade,
  entry_id     uuid references public.entries(id) on delete set null,
  tab          text not null,
  brand        text,
  account_name text,
  platform     text not null check (platform in ('TP','AG','CG')),
  link         text,
  created_at   timestamptz not null default now()
);
create index full_check_removed_entries_run_idx on public.full_check_removed_entries (run_id, tab, brand);

alter table public.full_check_runs enable row level security;
alter table public.full_check_removed_entries enable row level security;

create policy "approved users can read full_check_runs"
  on public.full_check_runs for select using (public.is_approved());
create policy "approved users can insert full_check_runs"
  on public.full_check_runs for insert with check (public.is_approved());
create policy "approved users can delete full_check_runs"
  on public.full_check_runs for delete using (public.is_approved());

create policy "approved users can read full_check_removed_entries"
  on public.full_check_removed_entries for select using (public.is_approved());
create policy "approved users can insert full_check_removed_entries"
  on public.full_check_removed_entries for insert with check (public.is_approved());
create policy "approved users can delete full_check_removed_entries"
  on public.full_check_removed_entries for delete using (public.is_approved());
```

- [ ] **Step 2: Get explicit confirmation, then push to the linked project**

Ask Leo to confirm before running this — it changes the live production database:

Run: `supabase db push --linked`
Expected: CLI reports the new migration applied, no errors.

- [ ] **Step 3: Verify the tables exist**

Run: `supabase db query "select table_name from information_schema.tables where table_name in ('full_check_runs','full_check_removed_entries') order by table_name;" --linked`
Expected: both `full_check_removed_entries` and `full_check_runs` rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260702180000_add_full_check_run_history.sql
git commit -m "feat: add full_check_runs and full_check_removed_entries tables"
```

---

### Task 2: `diffRemovedEntries` pure function + Vitest setup

**Files:**
- Create: `src/lib/removedEntriesDiff.ts`
- Create: `src/lib/removedEntriesDiff.test.ts`
- Modify: `package.json`
- Modify: `vite.config.ts`

**Interfaces:**
- Produces: `type Platform = 'TP' | 'AG' | 'CG'`, `interface RemovedEntryRow { id, run_id, entry_id, tab, brand, account_name, platform, link, created_at }`, `function diffRemovedEntries(current: RemovedEntryRow[], previous: RemovedEntryRow[]): Record<string, RemovedEntryRow[]>` (keyed by `` `${tab}::${brand ?? ''}` ``) — consumed by `queries.ts` (Task 3/4) and `RunHistoryTable.tsx` (Task 5).

- [ ] **Step 1: Install Vitest**

Run: `npm install -D vitest`
Expected: `vitest` added to `package.json` devDependencies.

- [ ] **Step 2: Add the test script**

Modify `package.json` — add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 3: Wire Vitest into the Vite config**

Modify `vite.config.ts` (full replacement):

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Write the failing tests**

Create `src/lib/removedEntriesDiff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { diffRemovedEntries, type RemovedEntryRow } from './removedEntriesDiff';

function row(overrides: Partial<RemovedEntryRow>): RemovedEntryRow {
  return {
    id: 'row-id',
    run_id: 'run-id',
    entry_id: 'entry-1',
    tab: 'Rooster Partners',
    brand: 'Fortuneplay',
    account_name: 'john82',
    platform: 'TP',
    link: 'https://trustpilot.com/reviews/1',
    created_at: '2026-07-02T00:00:00Z',
    ...overrides,
  };
}

describe('diffRemovedEntries', () => {
  it('shows net churn instead of netting to zero', () => {
    // entry-1 was removed last run and is reinstated (absent from current).
    // entry-2 is newly removed this run (absent from previous).
    const previous = [row({ entry_id: 'entry-1' })];
    const current = [row({ entry_id: 'entry-2', account_name: 'spinmaster99' })];

    const diff = diffRemovedEntries(current, previous);

    expect(diff['Rooster Partners::Fortuneplay']).toHaveLength(1);
    expect(diff['Rooster Partners::Fortuneplay'][0].entry_id).toBe('entry-2');
  });

  it('does not flag an entry as new when it matches by entry_id+platform', () => {
    const previous = [row({ entry_id: 'entry-1' })];
    const current = [row({ entry_id: 'entry-1' })];

    const diff = diffRemovedEntries(current, previous);

    expect(diff['Rooster Partners::Fortuneplay']).toBeUndefined();
  });

  it('falls back to account_name+platform when entry_id is null', () => {
    const previous = [row({ entry_id: null, account_name: 'john82' })];
    const current = [row({ entry_id: null, account_name: 'john82' })];

    const diff = diffRemovedEntries(current, previous);

    expect(diff['Rooster Partners::Fortuneplay']).toBeUndefined();
  });

  it('treats each platform on a multi-platform entry independently', () => {
    const previous = [row({ entry_id: 'entry-1', platform: 'TP' })];
    const current = [
      row({ entry_id: 'entry-1', platform: 'TP' }),
      row({ entry_id: 'entry-1', platform: 'AG', link: 'https://askgamblers.com/reviews/1' }),
    ];

    const diff = diffRemovedEntries(current, previous);

    expect(diff['Rooster Partners::Fortuneplay']).toHaveLength(1);
    expect(diff['Rooster Partners::Fortuneplay'][0].platform).toBe('AG');
  });

  it('groups brandless entries under an empty-string brand key', () => {
    const previous: RemovedEntryRow[] = [];
    const current = [row({ tab: 'Trybet', brand: null, entry_id: 'entry-3' })];

    const diff = diffRemovedEntries(current, previous);

    expect(diff['Trybet::']).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Run tests, confirm they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './removedEntriesDiff'` (file doesn't exist yet).

- [ ] **Step 6: Implement `diffRemovedEntries`**

Create `src/lib/removedEntriesDiff.ts`:

```ts
export type Platform = 'TP' | 'AG' | 'CG';

export interface RemovedEntryRow {
  id: string;
  run_id: string;
  entry_id: string | null;
  tab: string;
  brand: string | null;
  account_name: string | null;
  platform: Platform;
  link: string | null;
  created_at: string;
}

function rowKey(row: RemovedEntryRow): string {
  return row.entry_id
    ? `${row.entry_id}::${row.platform}`
    : `${row.account_name ?? ''}::${row.platform}`;
}

// Returns rows present in `current` with no matching key in `previous`,
// grouped by `${tab}::${brand ?? ''}`. A brand-less tab groups under the
// empty-string brand key.
export function diffRemovedEntries(
  current: RemovedEntryRow[],
  previous: RemovedEntryRow[],
): Record<string, RemovedEntryRow[]> {
  const previousKeys = new Set(previous.map(rowKey));
  const groups: Record<string, RemovedEntryRow[]> = {};
  for (const row of current) {
    if (previousKeys.has(rowKey(row))) continue;
    const groupKey = `${row.tab}::${row.brand ?? ''}`;
    (groups[groupKey] ??= []).push(row);
  }
  return groups;
}
```

- [ ] **Step 7: Run tests, confirm they pass**

Run: `npm test`
Expected: PASS — all 5 tests in `removedEntriesDiff.test.ts` green.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/lib/removedEntriesDiff.ts src/lib/removedEntriesDiff.test.ts
git commit -m "feat: add diffRemovedEntries and Vitest setup"
```

---

### Task 3: `fetchRemovedEntryDetails` in queries.ts

**Files:**
- Modify: `src/lib/queries.ts:746` (insert after the closing brace of `fetchAllTabsStatusSummary`)

**Interfaces:**
- Consumes: `Platform` type from `./removedEntriesDiff` (Task 2); `fetchRawEntriesByTab`, `fetchTabHeaders`, `SUMMARY_BRAND_COLS`, `isLiveStatus`, `isRemovedStatus` (all already in `queries.ts`).
- Produces: `interface RemovedEntryDetail { entry_id, tab, brand, account_name, platform, link }`, `function fetchRemovedEntryDetails(tabs: string[]): Promise<RemovedEntryDetail[]>` — consumed by `recordFullCheckRun` (Task 4).

- [ ] **Step 1: Add the import**

Modify `src/lib/queries.ts` line 1 area — add alongside the existing type imports:

```ts
import type { Platform } from './removedEntriesDiff';
```

- [ ] **Step 2: Add `RemovedEntryDetail` and `fetchRemovedEntryDetails`**

Insert directly after `fetchAllTabsStatusSummary`'s closing brace (after line 746 in the current file):

```ts
export interface RemovedEntryDetail {
  entry_id: string;
  tab: string;
  brand: string | null;
  account_name: string | null;
  platform: Platform;
  link: string | null;
}

export async function fetchRemovedEntryDetails(tabs: string[]): Promise<RemovedEntryDetail[]> {
  const perTab = await Promise.all(
    tabs.map(async (tab): Promise<RemovedEntryDetail[]> => {
      const [entries, rawHeaders] = await Promise.all([
        fetchRawEntriesByTab(tab),
        fetchTabHeaders(tab),
      ]);
      const headerSet = new Set(rawHeaders);
      const TP_VARIANTS = [
        'TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status',
        'Trust pilot Review Status', 'Review Status',
      ];
      const tpStatusCol = rawHeaders.find((h) => TP_VARIANTS.includes(h));
      const agStatusCol = rawHeaders.find((h) => h === 'AG Review Status');
      const cgStatusCol = rawHeaders.find((h) => h === 'CG Review Status');
      const brandCol = SUMMARY_BRAND_COLS.find((c) => headerSet.has(c)) ?? null;
      const accountNameCol = headerSet.has('Account Name') ? 'Account Name' : null;
      const tpLinkCol = headerSet.has('Link to the profile') ? 'Link to the profile' : null;

      const platformCols: Array<{ platform: Platform; statusCol?: string; linkCol: string | null }> = [
        { platform: 'TP', statusCol: tpStatusCol, linkCol: tpLinkCol },
        { platform: 'AG', statusCol: agStatusCol, linkCol: headerSet.has('AG Review Link') ? 'AG Review Link' : null },
        { platform: 'CG', statusCol: cgStatusCol, linkCol: headerSet.has('CG Review Link') ? 'CG Review Link' : null },
      ];

      const out: RemovedEntryDetail[] = [];
      for (const entry of entries) {
        const d = entry.data;
        const statuses = [tpStatusCol, agStatusCol, cgStatusCol]
          .filter((c): c is string => !!c)
          .map((c) => (d[c] ?? '').toLowerCase());
        const isLive = statuses.some(isLiveStatus);
        if (isLive || !statuses.some(isRemovedStatus)) continue;

        const brand = brandCol ? (d[brandCol]?.trim() ?? null) : null;
        const accountName = accountNameCol ? (d[accountNameCol]?.trim() ?? null) : null;

        for (const p of platformCols) {
          if (!p.statusCol) continue;
          const status = (d[p.statusCol] ?? '').toLowerCase();
          if (!isRemovedStatus(status)) continue;
          out.push({
            entry_id: entry.id,
            tab,
            brand,
            account_name: accountName,
            platform: p.platform,
            link: p.linkCol ? (d[p.linkCol] ?? null) : null,
          });
        }
      }
      return out;
    }),
  );
  return perTab.flat();
}
```

- [ ] **Step 3: Verify with a build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat: add fetchRemovedEntryDetails for per-platform removal snapshots"
```

---

### Task 4: `recordFullCheckRun`, `fetchFullCheckRuns`, `fetchRemovedEntriesForRun`

**Files:**
- Modify: `src/lib/queries.ts` (insert after `fetchRemovedEntryDetails` from Task 3)

**Interfaces:**
- Consumes: `RemovedEntryRow` type from `./removedEntriesDiff` (Task 2); `fetchAllTabsStatusSummary`, `fetchRemovedEntryDetails`, `TabStatusRow`, `supabase` client (all already in `queries.ts`).
- Produces: `interface RunScope { tabsRun, tabsTotal, brandsRun, brandsTotal }`, `interface FullCheckRun { id, run_at, scope, summary }`, `function recordFullCheckRun(tabs: string[], scope: RunScope): Promise<TabStatusRow[]>`, `function fetchFullCheckRuns(limit?: number): Promise<FullCheckRun[]>`, `function fetchRemovedEntriesForRun(runId: string): Promise<RemovedEntryRow[]>` — consumed by `SyncStatus.tsx` and `RunHistoryTable.tsx` (Task 5).

- [ ] **Step 1: Add the import**

Modify the import added in Task 3 to also bring in `RemovedEntryRow`:

```ts
import type { Platform, RemovedEntryRow } from './removedEntriesDiff';
```

- [ ] **Step 2: Add the new interfaces and functions**

Insert directly after `fetchRemovedEntryDetails`'s closing brace:

```ts
export interface RunScope {
  tabsRun: number;
  tabsTotal: number;
  brandsRun: number;
  brandsTotal: number;
}

export interface FullCheckRun {
  id: string;
  run_at: string;
  scope: RunScope;
  summary: TabStatusRow[];
}

export async function recordFullCheckRun(tabs: string[], scope: RunScope): Promise<TabStatusRow[]> {
  const [summary, removedDetails] = await Promise.all([
    fetchAllTabsStatusSummary(tabs),
    fetchRemovedEntryDetails(tabs),
  ]);

  const { data: run, error: runErr } = await supabase
    .from('full_check_runs')
    .insert({ scope, summary })
    .select('id')
    .single();
  if (runErr) throw runErr;

  if (removedDetails.length > 0) {
    const { error: detailErr } = await supabase
      .from('full_check_removed_entries')
      .insert(removedDetails.map((d) => ({ ...d, run_id: run.id })));
    if (detailErr) throw detailErr;
  }
  return summary;
}

export async function fetchFullCheckRuns(limit = 30): Promise<FullCheckRun[]> {
  const { data, error } = await supabase
    .from('full_check_runs')
    .select('id, run_at, scope, summary')
    .order('run_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as FullCheckRun[];
}

export async function fetchRemovedEntriesForRun(runId: string): Promise<RemovedEntryRow[]> {
  const { data, error } = await supabase
    .from('full_check_removed_entries')
    .select('id, run_id, entry_id, tab, brand, account_name, platform, link, created_at')
    .eq('run_id', runId);
  if (error) throw error;
  return (data ?? []) as RemovedEntryRow[];
}
```

- [ ] **Step 3: Verify with a build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat: add recordFullCheckRun and Supabase-backed run history reads"
```

---

### Task 5: `RunHistoryTable` component + `SyncStatus.tsx` integration

**Files:**
- Create: `src/components/RunHistoryTable.tsx`
- Modify: `src/pages/SyncStatus.tsx` (full replacement)

**Interfaces:**
- Consumes: `fetchRemovedEntriesForRun`, `FullCheckRun`, `recordFullCheckRun`, `fetchFullCheckRuns`, `RunScope`, `TabStatusRow` (from `queries.ts`, Tasks 2-4); `diffRemovedEntries`, `RemovedEntryRow` (from `removedEntriesDiff.ts`, Task 2); `tabToSlug` (existing, `src/lib/tabs.ts`).
- Produces: `export default function RunHistoryTable({ runs }: { runs: FullCheckRun[] })` — a self-contained component with no other consumers planned.

- [ ] **Step 1: Create `RunHistoryTable.tsx`**

```tsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { fetchRemovedEntriesForRun, type FullCheckRun } from '../lib/queries';
import { diffRemovedEntries, type RemovedEntryRow } from '../lib/removedEntriesDiff';
import { tabToSlug } from '../lib/tabs';

interface RunHistoryTableProps {
  runs: FullCheckRun[];
}

type RunDiffState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; groups: Record<string, RemovedEntryRow[]> };

export default function RunHistoryTable({ runs }: RunHistoryTableProps) {
  const [expandedRun, setExpandedRun] = useState<Set<string>>(new Set());
  const [expandedBrand, setExpandedBrand] = useState<Set<string>>(new Set());
  const [diffByRun, setDiffByRun] = useState<Record<string, RunDiffState>>({});

  async function toggleRun(run: FullCheckRun, prevRun: FullCheckRun | undefined) {
    setExpandedRun((prev) => {
      const next = new Set(prev);
      next.has(run.id) ? next.delete(run.id) : next.add(run.id);
      return next;
    });
    if (!prevRun || diffByRun[run.id]) return;
    setDiffByRun((prev) => ({ ...prev, [run.id]: { status: 'loading' } }));
    try {
      const [currentRows, previousRows] = await Promise.all([
        fetchRemovedEntriesForRun(run.id),
        fetchRemovedEntriesForRun(prevRun.id),
      ]);
      const groups = diffRemovedEntries(currentRows, previousRows);
      setDiffByRun((prev) => ({ ...prev, [run.id]: { status: 'ready', groups } }));
    } catch {
      setDiffByRun((prev) => ({ ...prev, [run.id]: { status: 'error' } }));
    }
  }

  function toggleBrand(key: string) {
    setExpandedBrand((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  if (runs.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="rounded-tl-lg px-4 py-3">Run</th>
            <th className="rounded-tr-lg px-4 py-3">Summary</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run, ri) => {
            const isOpen = expandedRun.has(run.id);
            const isLast = ri === runs.length - 1;
            const label = new Date(run.run_at).toLocaleString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            });

            const totRem = run.summary.reduce((s, r) => s + r.removed, 0);
            const prevRun = runs[ri + 1];
            const hasPrev = !!prevRun;
            const prevRem = prevRun ? prevRun.summary.reduce((s, r) => s + r.removed, 0) : 0;

            const diffState = diffByRun[run.id];
            const diffReady = diffState?.status === 'ready';
            const diffGroups: Record<string, RemovedEntryRow[]> = diffReady ? diffState.groups : {};
            const newlyRemovedTotal = diffReady
              ? Object.values(diffGroups).reduce((s, rows) => s + rows.length, 0)
              : totRem - prevRem; // shown before expand — corrected once the real diff loads

            const rowsToShow = diffReady
              ? run.summary.filter((row) => (diffGroups[`${row.tab}::`] ?? []).length > 0)
              : [];

            return (
              <React.Fragment key={run.id}>
                <tr
                  onClick={() => toggleRun(run, prevRun)}
                  className={`cursor-pointer select-none hover:bg-violet-50 ${!isOpen && !isLast ? 'border-b border-slate-100' : ''} ${isOpen ? 'bg-slate-50' : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      {isOpen ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
                      {label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {run.scope && (run.scope.tabsRun !== run.scope.tabsTotal || run.scope.brandsRun !== run.scope.brandsTotal) && (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
                          Custom — {run.scope.tabsRun}/{run.scope.tabsTotal} tabs, {run.scope.brandsRun}/{run.scope.brandsTotal} brands
                        </span>
                      )}
                      {!hasPrev ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 font-medium text-rose-700 tabular-nums">{totRem} removed</span>
                          <span className="text-slate-400">(baseline)</span>
                        </span>
                      ) : newlyRemovedTotal > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 font-medium text-rose-700 tabular-nums">
                          +{newlyRemovedTotal} newly removed from Published
                        </span>
                      ) : (
                        <span className="text-slate-400">No new removals</span>
                      )}
                    </div>
                  </td>
                </tr>
                {isOpen && (
                  <tr className={!isLast ? 'border-b border-slate-100' : ''}>
                    <td colSpan={2} className="bg-slate-50 px-6 pb-3 pt-1">
                      {!hasPrev ? (
                        <p className="py-2 text-xs text-slate-400">No prior run to compare against — this is the baseline.</p>
                      ) : diffState?.status === 'error' ? (
                        <p className="py-2 text-xs text-rose-500">Couldn't load removal details for this run.</p>
                      ) : !diffReady ? (
                        <p className="py-2 text-xs text-slate-400">Loading removal details…</p>
                      ) : rowsToShow.length === 0 ? (
                        <p className="py-2 text-xs text-slate-400">No newly removed entries in this run.</p>
                      ) : (
                        <div className="space-y-1">
                          {rowsToShow.map((row) => {
                            const rb = row.removedBrands ?? [];
                            const counts = row.removedBrandCounts ?? {};
                            const tabNewRows = diffGroups[`${row.tab}::`] ?? [];
                            return (
                              <div key={row.tab} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-xs">
                                <Link
                                  to={`/brands/${tabToSlug(row.tab)}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="min-w-[130px] font-medium text-slate-700 whitespace-nowrap hover:text-brand-600 hover:underline"
                                >{row.tab}</Link>
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 tabular-nums">{row.published} pub</span>
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700 tabular-nums">{row.removed} rem</span>
                                {tabNewRows.length > 0 && (
                                  <span className="rounded-full bg-rose-600 px-2 py-0.5 font-semibold text-white tabular-nums">+{tabNewRows.length} new</span>
                                )}
                                {rb.length > 0 && (
                                  <>
                                    <span className="text-slate-300">→</span>
                                    {rb.map((b) => {
                                      const groupKey = `${row.tab}::${b}`;
                                      const newRows = diffGroups[groupKey] ?? [];
                                      const brandKey = `${run.id}::${groupKey}`;
                                      const brandOpen = expandedBrand.has(brandKey);
                                      return (
                                        <span key={b} className="inline-flex flex-col gap-1">
                                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
                                            {b}
                                            {counts[b] != null && (
                                              <span className="rounded-full bg-rose-200 px-1.5 py-px font-semibold tabular-nums">{counts[b]}</span>
                                            )}
                                            {newRows.length > 0 && (
                                              <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); toggleBrand(brandKey); }}
                                                className="ml-1 rounded-full bg-rose-600 px-1.5 py-px font-semibold text-white tabular-nums hover:bg-rose-700"
                                              >
                                                +{newRows.length} new
                                              </button>
                                            )}
                                          </span>
                                          {brandOpen && newRows.length > 0 && (
                                            <span className="ml-2 flex flex-col gap-0.5 border-l border-rose-200 pl-2">
                                              {newRows.map((r) => (
                                                <a
                                                  key={`${r.entry_id ?? r.account_name}-${r.platform}`}
                                                  href={r.link ?? undefined}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="text-rose-600 hover:underline"
                                                >
                                                  {r.account_name ?? 'Unknown account'} — {r.platform} removed
                                                </a>
                                              ))}
                                            </span>
                                          )}
                                        </span>
                                      );
                                    })}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Replace `SyncStatus.tsx`**

Full replacement of `src/pages/SyncStatus.tsx`:

```tsx
import { useEffect, useReducer, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { triggerStatusCheck, fetchAllTabsStatusSummary, recordFullCheckRun, fetchFullCheckRuns, type TabStatusRow, type FullCheckRun, type RunScope } from '../lib/queries';
import Toast, { type ToastKind } from '../components/Toast';
import { TAB_COLUMN_CONFIGS, getTabSequence } from '../lib/tab-configs';
import FullCheckScopePicker from '../components/FullCheckScopePicker';
import RunHistoryTable from '../components/RunHistoryTable';

// Module-level singleton — survives React unmount/remount during navigation
let _fullCheckRunning = false;
let _fullCheckProgress = '';
const _fullCheckListeners = new Set<() => void>();
function setFullCheckRunning(v: boolean) {
  _fullCheckRunning = v;
  if (!v) _fullCheckProgress = '';
  _fullCheckListeners.forEach(fn => fn());
}
function setFullCheckProgress(v: string) {
  _fullCheckProgress = v;
  _fullCheckListeners.forEach(fn => fn());
}

const ALL_TABS = Object.keys(TAB_COLUMN_CONFIGS);

// Orders each tab's brands by its curated TAB_BRAND_SEQUENCE (when one exists), appending
// any live brand not yet in that list so nothing is ever hidden from the picker. Tabs with
// no detected brand column at all fall back to a single pseudo-brand (the tab name itself).
function buildBrandsByTab(summary: TabStatusRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const row of summary) {
    if (row.brands.length === 0) {
      out[row.tab] = [row.tab];
      continue;
    }
    const seq = getTabSequence(row.tab);
    if (!seq) {
      out[row.tab] = row.brands;
      continue;
    }
    const liveSet = new Set(row.brands);
    const ordered = seq.filter((b) => liveSet.has(b));
    const extra = row.brands.filter((b) => !seq.includes(b)).sort();
    out[row.tab] = [...ordered, ...extra];
  }
  return out;
}

export default function SyncStatus() {
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);

  const [checkHistory, setCheckHistory] = useState<FullCheckRun[]>([]);

  const [summary, setSummary] = useState<TabStatusRow[]>([]);
  const [selection, setSelection] = useState<Record<string, Set<string>>>({});
  const seededSelectionRef = useRef(false);

  // Mirror module-level singleton into render via forceUpdate
  const [, tick] = useReducer(x => x + 1, 0);
  useEffect(() => {
    _fullCheckListeners.add(tick);
    return () => { _fullCheckListeners.delete(tick); };
  }, []);
  const checkingAll   = _fullCheckRunning;
  const checkProgress = _fullCheckProgress;

  async function loadSummary(): Promise<TabStatusRow[]> {
    return fetchAllTabsStatusSummary(ALL_TABS);
  }

  useEffect(() => { loadSummary().then(setSummary); }, []);
  useEffect(() => { fetchFullCheckRuns().then(setCheckHistory).catch(() => setCheckHistory([])); }, []);

  const brandsByTab = buildBrandsByTab(summary);

  // Default every tab/brand to checked the first time real data arrives. Runs once per
  // page load — later summary refreshes (e.g. after running a check) don't touch a
  // selection the user has already customized.
  useEffect(() => {
    if (seededSelectionRef.current || summary.length === 0) return;
    setSelection(Object.fromEntries(ALL_TABS.map((t) => [t, new Set(brandsByTab[t] ?? [])])));
    seededSelectionRef.current = true;
  }, [summary]);

  async function handleFullCheck() {
    const tabsToRun = ALL_TABS.filter((t) => (selection[t]?.size ?? 0) > 0);
    if (tabsToRun.length === 0) return;

    setFullCheckRunning(true);
    let succeeded = 0, failed = 0;
    for (let i = 0; i < tabsToRun.length; i++) {
      const tab = tabsToRun[i];
      const total = brandsByTab[tab]?.length ?? 0;
      const picked = selection[tab]?.size ?? 0;
      const full = picked >= total;
      setFullCheckProgress(
        full
          ? `Checking "${tab}" (${i + 1}/${tabsToRun.length})…`
          : `Checking "${tab}" — ${picked} brand${picked !== 1 ? 's' : ''} (${i + 1}/${tabsToRun.length})…`
      );
      try {
        await triggerStatusCheck(tab, true, full ? undefined : [...selection[tab]!]);
        succeeded++;
      } catch {
        failed++;
      }
    }
    setFullCheckRunning(false);
    setToast({
      message: failed > 0
        ? `${succeeded} tab${succeeded !== 1 ? 's' : ''} checked, ${failed} failed`
        : `All ${succeeded} tab${succeeded !== 1 ? 's' : ''} checked successfully`,
      kind: failed > 0 ? 'error' : 'success',
    });

    const brandsRun = tabsToRun.reduce((s, t) => s + (selection[t]?.size ?? 0), 0);
    const brandsTotal = ALL_TABS.reduce((s, t) => s + (brandsByTab[t]?.length ?? 0), 0);
    const scope: RunScope = { tabsRun: tabsToRun.length, tabsTotal: ALL_TABS.length, brandsRun, brandsTotal };

    const latest = await recordFullCheckRun(ALL_TABS, scope);
    setSummary(latest);
    const runs = await fetchFullCheckRuns();
    setCheckHistory(runs);
  }

  const nothingSelected = ALL_TABS.every((t) => (selection[t]?.size ?? 0) === 0);

  return (
    <div className="space-y-6">
      {/* ── Full Check Status ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Full Check Status</h2>
            <p className="mt-1 text-sm text-slate-500">Checks all TP links including Published — detects reviews that have been removed</p>
          </div>
          <div className="flex items-center gap-3">
            {checkProgress && (
              <span className="text-sm text-slate-500 tabular-nums">{checkProgress}</span>
            )}
            <button
              onClick={handleFullCheck}
              disabled={checkingAll || nothingSelected}
              title={nothingSelected ? 'Select at least one tab or brand' : undefined}
              className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${checkingAll ? 'animate-spin' : ''}`} />
              {checkingAll ? 'Checking…' : 'Run Full Check'}
            </button>
          </div>
        </div>

        {summary.length > 0 && (
          <FullCheckScopePicker
            tabs={ALL_TABS}
            brandsByTab={brandsByTab}
            selection={selection}
            onChange={setSelection}
          />
        )}

        {/* Delta message */}
        {checkHistory.length > 0 && (() => {
          const latest = checkHistory[0];
          const prev = checkHistory[1];
          const latestRem = latest.summary.reduce((s, r) => s + r.removed, 0);
          if (!prev) {
            return (
              <p className="text-sm text-slate-500">
                <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 tabular-nums mr-1.5">{latestRem}</span>
                removed reviews detected in the last check.
              </p>
            );
          }
          const prevRem = prev.summary.reduce((s, r) => s + r.removed, 0);
          const delta = latestRem - prevRem;
          if (delta === 0) {
            return <p className="text-sm text-slate-500">No new removed reviews since last check.</p>;
          }
          if (delta > 0) {
            return (
              <p className="text-sm text-slate-700">
                <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 tabular-nums mr-1.5">↑ {delta}</span>
                new removed review{delta !== 1 ? 's' : ''} detected since last check.
              </p>
            );
          }
          return (
            <p className="text-sm text-slate-700">
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 tabular-nums mr-1.5">↓ {Math.abs(delta)}</span>
              fewer removed reviews since last check.
            </p>
          );
        })()}

        <RunHistoryTable runs={checkHistory} />
      </div>

      {toast ? <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
```

Note: `tabToSlug`, `Link`, `ChevronDown`, and `ChevronRight` are no longer used in `SyncStatus.tsx` — they moved into `RunHistoryTable.tsx` along with the JSX that used them, so this full replacement drops those imports entirely.

- [ ] **Step 3: Verify with a build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors, no unused-import errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SyncStatus.tsx src/components/RunHistoryTable.tsx
git commit -m "feat: per-brand newly-removed drilldown on Check Status run history"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts at `http://localhost:5173`.

- [ ] **Step 2: Establish a baseline run**

Navigate to `/sync`, sign in as an approved user, click "Run Full Check" with the default (everything selected). Confirm the run appears in the table labeled "(baseline)" with a total removed count and no "+N new" badge (since `fetchFullCheckRuns()` returns only this one row — no previous run to diff against).

- [ ] **Step 3: Flip one entry's status and re-run**

Pick one entry currently "Published" on TP for a tab with a brand column (e.g. Rooster Partners). Change its TP review status to "Removed" directly (via the sheet sync path or an admin edit in the dashboard, whichever this environment uses today). Run "Run Full Check" again.

- [ ] **Step 4: Confirm the new run's badges**

In the new run row: confirm the collapsed badge shows "+1 newly removed from Published" (or matches however many entries you flipped). Expand the row: confirm the affected tab shows a "+1 new" tab badge, and the affected brand's pill shows its own "+1 new" button.

- [ ] **Step 5: Confirm the drilldown**

Click the brand's "+1 new" button. Confirm it expands inline to show the account name, "TP removed" label, and a working link that opens the review in a new tab.

- [ ] **Step 6: Confirm no regression on an unaffected run**

Collapse and re-expand the baseline run from Step 2 — confirm it still shows "(baseline)" with no errors (no previous run to diff against, so no fetch is attempted for it).

- [ ] **Step 7: Record the completed task**

Per this project's standing workflow, append an entry to `docs/task-history.md`:

```markdown
## Task N: Per-brand "newly removed" drilldown on Check Status
**Date:** 2026-07-02
Replaced the localStorage-based full-check run history with Supabase-backed
`full_check_runs` / `full_check_removed_entries` tables. Brand pills on the
Check Status page now show an accurate per-run "newly removed" count (real
entry-level diffing instead of arithmetic count deltas) and are clickable to
reveal exactly which accounts/reviews flipped to removed, with a link to each.
```

(Replace `N` with the next sequential task number in that file.)

---

## Self-Review Notes

- **Spec coverage:** schema (Task 1) ✓, write path (Task 3+4) ✓, diff/read logic (Task 2+5) ✓, UI/edge cases — baseline, no-diff-yet, error, brandless tabs (Task 5) ✓, testing (Task 2 unit tests + Task 6 manual) ✓.
- **Placeholder scan:** no TBD/TODO placeholders in any code block.
- **Type consistency:** `Platform` and `RemovedEntryRow` are defined once in `removedEntriesDiff.ts` (Task 2) and imported everywhere else (`queries.ts` Tasks 3-4, `RunHistoryTable.tsx` Task 5) — no redefinition drift. `RunScope`/`FullCheckRun` defined once in `queries.ts` (Task 4), imported by `SyncStatus.tsx` and `RunHistoryTable.tsx` (Task 5).
