# Bidirectional Realtime Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconnect the dashboard to the correct database table, wire up true bidirectional sync (Google Sheets ⇄ Supabase ⇄ Dashboard), prevent echo loops, and add realtime live updates.

**Architecture:** Google Sheets ↔ Apps Script Web App ↔ Supabase Edge Functions (`import-tabs` / `push-to-sheet`) ↔ `entries` table ↔ React dashboard. The React app never reads Google Sheets directly — Supabase is the single source of truth. The Edge Functions handle all Sheet communication. Loop prevention uses a `last_sync_tag` UUID that `push-to-sheet` stamps into both the DB and the Sheet; `import-tabs` skips rows where the Sheet's tag matches the DB's tag (echo detection).

**Tech Stack:** React 19, TypeScript strict, Supabase JS v2, Supabase Edge Functions (Deno), Supabase Realtime (postgres_changes), Tailwind v4, Vite 6.

---

## Current State Analysis

### Critical Bugs (dashboard shows zero data today)
1. **Wrong table**: `src/lib/queries.ts` queries the `mentions` table. The current `supabase/schema.sql` drops `mentions` and replaces it with `entries`. Every query returns empty.
2. **Broken import**: `queries.ts` line 1 imports `SYNC_FUNCTION_URL` from `./supabase`, but `supabase.ts` exports `IMPORT_TABS_URL`. TypeScript strict mode should flag this; `triggerSync()` silently fails with undefined URL.

### High Priority (sync not bidirectional)
3. **Write-back not wired**: `supabase/functions/push-to-sheet/index.ts` is fully implemented but `queries.ts` has no function calling it, and no UI exposes edits.
4. **No loop prevention**: `import-tabs` upserts every Sheet row unconditionally. After a dashboard edit, the next sync overwrites the DB with the Sheet's stale version.
5. **No realtime updates**: Pages fetch on mount only. After sync, SyncStatus refreshes manually; Overview never refreshes.

### Medium Priority
6. **Wrong direction label**: `import-tabs` inserts `direction: 'initial_import'` instead of `direction: 'sheet_to_db'`.
7. **Race condition**: `push-to-sheet` does an unprotected read-modify-write on `entries.data`.
8. **Client-side aggregation**: `fetchMentionsPerDay`, `fetchTopForums`, `fetchTrendingKeywords` pull all rows and tally in JS.

---

## File Map

### Modified
| File | What changes |
|------|-------------|
| `src/lib/supabase.ts` | Add `SYNC_FUNCTION_URL` export alias for `IMPORT_TABS_URL` |
| `src/types/mention.ts` | Add `tab: string` field (needed so write-back knows which Sheet tab to target) |
| `src/lib/queries.ts` | Full rewrite: all queries target `entries`; add `pushEntryToSheet`; adapter `entryToMention` maps JSONB → `Mention` |
| `src/pages/Overview.tsx` | Add Realtime subscription to `entries`; extract `loadData` into reusable callback |
| `src/pages/SyncStatus.tsx` | Add Realtime subscription to `sync_runs` |
| `supabase/functions/import-tabs/index.ts` | Fix direction label; add loop prevention (batch echo detection via `last_sync_tag`) |

### Created
| File | Purpose |
|------|---------|
| `src/lib/realtime.ts` | Two thin helpers: `subscribeEntries` and `subscribeSyncRuns` — wrap `supabase.channel()` and return cleanup functions |

### Unchanged (no edits needed)
- `src/types/entry.ts` — already correct
- `src/types/sync.ts` — already correct
- `src/lib/tabs.ts` — correct
- `src/components/*` — all components stay the same; `MentionsTable`, `StatusBadge`, `KpiCard`, etc. receive the same props as today
- `src/pages/MentionDetail.tsx` — no changes; `updateMentionStatus` now calls push-to-sheet internally
- `supabase/functions/push-to-sheet/index.ts` — already correct; no changes needed

---

## Phase 1 — Fix Critical Disconnects

**Goal: make the dashboard show real data.** After this phase the Overview, MentionDetail, and SyncStatus pages all work against the live `entries` table.

---

### Task 1.1 — Fix `SYNC_FUNCTION_URL` export in `supabase.ts`

**Files:**
- Modify: `src/lib/supabase.ts`

`queries.ts` imports `SYNC_FUNCTION_URL` which doesn't exist in `supabase.ts`. The correct env var is `VITE_IMPORT_TABS_URL` (exported as `IMPORT_TABS_URL`). We add an alias so the import resolves.

- [ ] **Step 1: Add the alias export**

Open `src/lib/supabase.ts`. The full file after edit:

```typescript
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — check .env');
}

export const supabase = createClient(url ?? '', anonKey ?? '');

export const SUPABASE_ANON_KEY = anonKey ?? '';
export const PUSH_TO_SHEET_URL = import.meta.env.VITE_PUSH_TO_SHEET_URL ?? '';
export const IMPORT_TABS_URL = import.meta.env.VITE_IMPORT_TABS_URL ?? '';
// Alias used by queries.ts — points to the same import-tabs function URL
export const SYNC_FUNCTION_URL = IMPORT_TABS_URL;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: 0 errors (specifically, no "Module './supabase' has no exported member 'SYNC_FUNCTION_URL'" error).

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "fix: export SYNC_FUNCTION_URL alias so triggerSync resolves"
```

---

### Task 1.2 — Add `tab` field to `Mention` type

**Files:**
- Modify: `src/types/mention.ts`

The write-back path (`push-to-sheet`) needs `tab` (e.g. `"Rooster Partners"`) to know which Sheet tab to target. Adding it to `Mention` lets `MentionDetail` pass it through without changes to that page.

- [ ] **Step 1: Add `tab: string` to the interface**

Full replacement of `src/types/mention.ts`:

```typescript
export type MentionStatus = 'new' | 'reviewed' | 'ignored';
export type Sentiment = 'positive' | 'neutral' | 'negative' | null;

export interface Mention {
  id: string;
  tab: string;
  source_row_id: string;
  forum: string;
  thread_title: string | null;
  mention_text: string;
  url: string;
  author: string | null;
  posted_at: string | null;
  keyword: string | null;
  sentiment: Sentiment;
  status: MentionStatus;
  synced_at: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: 0 errors. (No component reads `mention.tab` today so nothing breaks.)

- [ ] **Step 3: Commit**

```bash
git add src/types/mention.ts
git commit -m "feat(types): add tab field to Mention for write-back routing"
```

---

### Task 1.3 — Rewrite `queries.ts` to target `entries`

**Files:**
- Modify: `src/lib/queries.ts`

**Design decisions:**
- Keep every exported function signature identical so pages need zero changes.
- `entryToMention` adapter maps `Entry.data` (JSONB) to `Mention` fields. It tries both lowercase/snake_case and common alternative spellings since Sheet headers are copied verbatim.
- `fetchMentionCounts` uses `updated_at` (a real column) since `posted_at` lives inside JSONB.
- `updateMentionStatus` does read-merge-write on `entries.data`, sets `last_edited_by: 'dashboard'`, then fire-and-forgets `pushEntryToSheet` so the Sheet stays in sync without blocking the UI.
- `pushEntryToSheet` is exported so future pages can call it directly.

- [ ] **Step 1: Replace the entire file**

Full replacement of `src/lib/queries.ts`:

```typescript
import { supabase, SYNC_FUNCTION_URL, PUSH_TO_SHEET_URL } from './supabase';
import type { Mention, MentionStatus } from '../types/mention';
import type { SyncRun } from '../types/sync';
import type { Entry } from '../types/entry';

// ---------------------------------------------------------------------------
// Adapter — maps an Entry row to the Mention shape the UI expects.
// Column names in `data` must match the exact headers from the Google Sheet.
// Falls back through common variants so minor header-name differences don't
// break the display.
// ---------------------------------------------------------------------------
function getField(data: Record<string, string | null>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = data[k];
    if (v != null) return v;
  }
  return null;
}

function entryToMention(entry: Entry): Mention {
  const d = entry.data;
  return {
    id: entry.id,
    tab: entry.tab,
    source_row_id: entry.sheet_row_id,
    forum: getField(d, 'forum', 'Forum') ?? '',
    thread_title: getField(d, 'thread_title', 'Thread Title', 'title', 'Title'),
    mention_text: getField(d, 'mention_text', 'Mention Text', 'text', 'Text', 'body', 'Body') ?? '',
    url: getField(d, 'url', 'URL', 'Url', 'link', 'Link') ?? '',
    author: getField(d, 'author', 'Author', 'username', 'Username'),
    posted_at: getField(d, 'posted_at', 'Posted At', 'date', 'Date'),
    keyword: getField(d, 'keyword', 'Keyword'),
    sentiment: getField(d, 'sentiment', 'Sentiment') as Mention['sentiment'],
    status: (getField(d, 'status', 'Status') ?? 'new') as MentionStatus,
    synced_at: entry.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Read queries
// ---------------------------------------------------------------------------

export async function fetchRecentMentions(limit = 20): Promise<Mention[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => entryToMention(row as Entry));
}

export async function fetchMentionById(id: string): Promise<Mention | null> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? entryToMention(data as Entry) : null;
}

export interface MentionCounts {
  total: number;
  last7d: number;
}

export async function fetchMentionCounts(): Promise<MentionCounts> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [totalRes, recentRes] = await Promise.all([
    supabase.from('entries').select('id', { count: 'exact', head: true }),
    supabase
      .from('entries')
      .select('id', { count: 'exact', head: true })
      .gte('updated_at', sevenDaysAgo),
  ]);
  if (totalRes.error) throw totalRes.error;
  if (recentRes.error) throw recentRes.error;
  return { total: totalRes.count ?? 0, last7d: recentRes.count ?? 0 };
}

export interface DailyCount {
  day: string;
  count: number;
}

export async function fetchMentionsPerDay(days = 30): Promise<DailyCount[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('entries')
    .select('updated_at')
    .gte('updated_at', since);
  if (error) throw error;
  const buckets = new Map<string, number>();
  for (const row of data ?? []) {
    const d = (row.updated_at as string).slice(0, 10);
    buckets.set(d, (buckets.get(d) ?? 0) + 1);
  }
  return Array.from(buckets.entries())
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export interface TopItem {
  label: string;
  count: number;
}

export async function fetchTopForums(limit = 5): Promise<TopItem[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('entries')
    .select('data')
    .gte('updated_at', since);
  if (error) throw error;
  const forums = (data ?? []).map((row) => {
    const d = row.data as Record<string, string | null>;
    return getField(d, 'forum', 'Forum') ?? '';
  });
  return tallyTop(forums, limit);
}

export async function fetchTrendingKeywords(limit = 5): Promise<TopItem[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('entries')
    .select('data')
    .gte('updated_at', since);
  if (error) throw error;
  const keywords = (data ?? [])
    .map((row) => {
      const d = row.data as Record<string, string | null>;
      return getField(d, 'keyword', 'Keyword');
    })
    .filter((k): k is string => k != null && k !== '');
  return tallyTop(keywords, limit);
}

function tallyTop(values: string[], limit: number): TopItem[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function fetchSyncRuns(limit = 10): Promise<SyncRun[]> {
  const { data, error } = await supabase
    .from('sync_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SyncRun[];
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

export async function updateMentionStatus(id: string, status: MentionStatus): Promise<void> {
  // Read existing entry to get current data blob, tab, and sheet_row_id.
  const { data: existing, error: selErr } = await supabase
    .from('entries')
    .select('tab, sheet_row_id, data')
    .eq('id', id)
    .single();
  if (selErr) throw selErr;

  const mergedData = {
    ...(existing.data as Record<string, string | null>),
    status,
  };

  const { error: upErr } = await supabase
    .from('entries')
    .update({ data: mergedData, last_edited_by: 'dashboard' })
    .eq('id', id);
  if (upErr) throw upErr;

  // Fire-and-forget: push the status change to the Sheet without blocking the UI.
  // If push-to-sheet is not configured, the error is only logged.
  pushEntryToSheet(existing.tab as string, existing.sheet_row_id as string, { status }).catch(
    (err) => console.warn('[push-to-sheet] status update failed (non-blocking):', err),
  );
}

export async function pushEntryToSheet(
  tab: string,
  sheetRowId: string,
  fields: Record<string, string | null>,
): Promise<void> {
  if (!PUSH_TO_SHEET_URL) throw new Error('VITE_PUSH_TO_SHEET_URL is not configured');
  const res = await fetch(PUSH_TO_SHEET_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ tab, sheet_row_id: sheetRowId, fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Push to sheet failed: ${res.status} ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Sync trigger
// ---------------------------------------------------------------------------

export async function triggerSync(): Promise<void> {
  if (!SYNC_FUNCTION_URL) throw new Error('VITE_IMPORT_TABS_URL is not configured — check .env');
  const res = await fetch(SYNC_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sync failed: ${res.status} ${body}`);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles with zero errors**

Run: `npx tsc --noEmit`

Expected output: `(no output)` — zero errors.

- [ ] **Step 3: Start dev server and verify the Overview loads data**

Run: `npm run dev`

Navigate to `http://localhost:5173`. Verify:
- KPI cards show counts greater than 0 (assuming entries exist in Supabase).
- Recent mentions table shows rows.
- No console errors about missing exports or table not found.

If KPI cards show 0, confirm that `supabase/schema.sql` has been applied and the `entries` table exists with data. Trigger a sync from the SyncStatus page if not.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries.ts
git commit -m "fix: rewrite queries to use entries table; add entryToMention adapter and pushEntryToSheet"
```

---

## Phase 2 — Bidirectional Write-Back

**Goal: verify that dashboard status changes write through to Google Sheets.**

After Phase 1, `updateMentionStatus` already calls `pushEntryToSheet` as fire-and-forget. This phase verifies the end-to-end path works and surfaces any configuration gaps.

---

### Task 2.1 — Verify `push-to-sheet` is deployed and env vars are set

- [ ] **Step 1: Check `.env` for the push URL**

Open `.env`. Confirm `VITE_PUSH_TO_SHEET_URL` is set to the deployed `push-to-sheet` function URL (format: `https://<project-ref>.supabase.co/functions/v1/push-to-sheet`).

If it is missing, add it:
```
VITE_PUSH_TO_SHEET_URL=https://<project-ref>.supabase.co/functions/v1/push-to-sheet
```

- [ ] **Step 2: Confirm the function is deployed**

Run: `npx supabase functions list`

Expected: `push-to-sheet` appears in the list. If it doesn't, deploy it:

```bash
npx supabase functions deploy push-to-sheet
```

- [ ] **Step 3: Verify Edge Function secrets are set**

In the Supabase dashboard → Edge Functions → push-to-sheet → Secrets, confirm:
- `APPS_SCRIPT_WEB_APP_URL` is set
- `APPS_SCRIPT_SHARED_SECRET` is set

---

### Task 2.2 — Test the write-back end-to-end

- [ ] **Step 1: Open MentionDetail for any row**

Navigate to `http://localhost:5173`, click any row in the Recent Mentions table.

- [ ] **Step 2: Change the status**

Click a status button (e.g. "Mark as reviewed"). Verify the toast shows "Marked reviewed" (success). If the toast shows an error, open the browser console — the `push-to-sheet` fire-and-forget warning will appear there.

- [ ] **Step 3: Verify change in Supabase**

In Supabase Table Editor, open `entries`. Find the row by its `id`. Confirm:
- `data->>'status'` equals `"reviewed"` (or whatever status you chose).
- `last_edited_by` equals `"dashboard"`.

- [ ] **Step 4: Verify change in Google Sheet**

Open the Google Sheet, find the corresponding row (matched by the `id` column). Confirm the `status` cell updated. This may take a few seconds for the Apps Script to write back.

If the Sheet did NOT update, check:
1. The Apps Script `SHARED_SECRET` matches the Edge Function secret.
2. The Apps Script `upsert_row` operation is implemented and handles the `status` field.

---

## Phase 3 — Loop Prevention in `import-tabs`

**Goal: prevent the Sheet→DB sync from overwriting dashboard edits.**

When the dashboard edits a row and then a sync runs, `import-tabs` should detect the echo (Sheet echoing back the same `last_sync_tag` that `push-to-sheet` wrote) and skip that row.

---

### Task 3.1 — Rewrite the tab-processing loop in `import-tabs`

**Files:**
- Modify: `supabase/functions/import-tabs/index.ts`

Two changes in one edit:
1. Line 33: `direction: 'initial_import'` → `direction: 'sheet_to_db'`
2. Replace the row-processing loop with the echo-detection version below.

**How echo detection works:**
- `push-to-sheet` stamps a UUID `last_sync_tag` into the DB and sends it to the Apps Script, which writes it to a `last_sync_tag` column in the Sheet.
- On next import, `import-tabs` reads each row's `last_sync_tag` value from the Sheet.
- For the batch, we fetch existing DB rows `(sheet_row_id, last_edited_by, last_sync_tag)`.
- If `DB.last_edited_by === 'dashboard'` AND `DB.last_sync_tag === Sheet.last_sync_tag` AND both are non-null → this row is an echo of our own write → skip it.
- Otherwise → accept the Sheet's version, set `last_edited_by: 'sheet'`.

- [ ] **Step 1: Replace the full file**

Full replacement of `supabase/functions/import-tabs/index.ts`:

```typescript
// Supabase Edge Function: import-tabs
//
// Calls Apps Script doGet(op='dump') and bulk-upserts every operational tab's
// rows into public.entries. Refreshes public.tab_schemas with current headers.
// Skips rows where the Sheet is echoing back our own last_sync_tag (loop prevention).
//
// Required secrets:
//   SUPABASE_URL                — runtime
//   SUPABASE_SERVICE_ROLE_KEY   — runtime
//   APPS_SCRIPT_WEB_APP_URL     — /exec URL
//   APPS_SCRIPT_SHARED_SECRET   — matches Code.gs SHARED_SECRET

// @ts-expect-error: Deno-only import resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (h: (r: Request) => Response | Promise<Response>) => void;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SCRIPT_URL = Deno.env.get('APPS_SCRIPT_WEB_APP_URL')!;
const SCRIPT_SECRET = Deno.env.get('APPS_SCRIPT_SHARED_SECRET')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

interface DumpedTab {
  name: string;
  headers: string[];
  rows: string[][];
}

interface Candidate {
  tab: string;
  sheet_row_id: string;
  data: Record<string, string | null>;
  sheetSyncTag: string | null; // read from Sheet row; used for echo detection only
}

Deno.serve(async () => {
  const { data: runRow, error: startErr } = await admin
    .from('sync_runs')
    .insert({ direction: 'sheet_to_db', status: 'running' })
    .select('id')
    .single();
  if (startErr) return json({ ok: false, error: startErr.message }, 500);
  const runId = runRow!.id as string;

  let rowsSeen = 0;
  let rowsUpserted = 0;
  let rowsSkipped = 0;
  const tabsFailed: string[] = [];

  try {
    const dumpUrl = `${SCRIPT_URL}?secret=${encodeURIComponent(SCRIPT_SECRET)}&op=dump`;
    const res = await fetch(dumpUrl);
    if (!res.ok) throw new Error(`doGet ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { ok: boolean; tabs?: DumpedTab[]; error?: string };
    if (!body.ok || !body.tabs) throw new Error(body.error ?? 'doGet returned not-ok');

    for (const tab of body.tabs) {
      try {
        await admin.from('tab_schemas').upsert(
          { tab: tab.name, headers: tab.headers, refreshed_at: new Date().toISOString() },
          { onConflict: 'tab' },
        );

        const idColIndex = tab.headers.indexOf('id');
        if (idColIndex === -1) {
          tabsFailed.push(`${tab.name}: no 'id' column`);
          continue;
        }

        const syncTagColIndex = tab.headers.indexOf('last_sync_tag');

        // Build candidate list — extract sheet sync tag alongside the data blob.
        const candidates: Candidate[] = [];
        for (const row of tab.rows) {
          rowsSeen++;
          const sheetRowId = String(row[idColIndex] ?? '').trim();
          if (!sheetRowId) {
            rowsSkipped++;
            continue;
          }

          const sheetSyncTag =
            syncTagColIndex >= 0 && row[syncTagColIndex]
              ? String(row[syncTagColIndex]).trim() || null
              : null;

          const data: Record<string, string | null> = {};
          for (let i = 0; i < tab.headers.length; i++) {
            const h = tab.headers[i];
            if (h === 'id' || h === 'last_sync_tag' || h === '') continue;
            const val = row[i];
            data[h] = val == null || val === '' ? null : String(val);
          }
          candidates.push({ tab: tab.name, sheet_row_id: sheetRowId, data, sheetSyncTag });
        }

        if (candidates.length === 0) continue;

        // Batch-fetch existing rows for this tab to detect echoes.
        const sheetIds = candidates.map((c) => c.sheet_row_id);
        const { data: existingRows } = await admin
          .from('entries')
          .select('sheet_row_id, last_edited_by, last_sync_tag')
          .eq('tab', tab.name)
          .in('sheet_row_id', sheetIds);

        const existingMap = new Map<string, { last_edited_by: string; last_sync_tag: string | null }>();
        for (const row of existingRows ?? []) {
          existingMap.set(row.sheet_row_id as string, {
            last_edited_by: row.last_edited_by as string,
            last_sync_tag: row.last_sync_tag as string | null,
          });
        }

        // Filter echoes and build final upsert batch.
        const toUpsert: Array<Record<string, unknown>> = [];
        for (const c of candidates) {
          const existing = existingMap.get(c.sheet_row_id);
          // Echo: dashboard wrote this exact sync_tag and the Sheet is reflecting it back.
          if (
            existing?.last_edited_by === 'dashboard' &&
            existing.last_sync_tag !== null &&
            c.sheetSyncTag !== null &&
            existing.last_sync_tag === c.sheetSyncTag
          ) {
            rowsSkipped++;
            continue;
          }
          toUpsert.push({
            tab: c.tab,
            sheet_row_id: c.sheet_row_id,
            data: c.data,
            last_edited_by: 'sheet',
            last_sync_tag: null, // clear tag — Sheet is now authoritative for this row
          });
        }

        if (toUpsert.length > 0) {
          const { error: upErr } = await admin
            .from('entries')
            .upsert(toUpsert, { onConflict: 'tab,sheet_row_id' });
          if (upErr) throw upErr;
          rowsUpserted += toUpsert.length;
        }
      } catch (tabErr) {
        tabsFailed.push(`${tab.name}: ${tabErr instanceof Error ? tabErr.message : String(tabErr)}`);
      }
    }

    const finalStatus = tabsFailed.length === 0 ? 'success' : 'error';
    await admin
      .from('sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        rows_seen: rowsSeen,
        rows_upserted: rowsUpserted,
        rows_skipped: rowsSkipped,
        status: finalStatus,
        error_message: tabsFailed.length > 0 ? tabsFailed.join('; ') : null,
      })
      .eq('id', runId);

    return json({
      ok: tabsFailed.length === 0,
      rows_seen: rowsSeen,
      rows_upserted: rowsUpserted,
      rows_skipped: rowsSkipped,
      tabs_failed: tabsFailed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin
      .from('sync_runs')
      .update({ finished_at: new Date().toISOString(), status: 'error', error_message: msg })
      .eq('id', runId);
    return json({ ok: false, error: msg }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: Deploy the updated function**

Run: `npx supabase functions deploy import-tabs`

Expected: `Deployed function import-tabs` (or equivalent success message).

- [ ] **Step 3: Verify the fix in SyncStatus**

In the dashboard, go to SyncStatus → click "Run sync now". After it completes, open the sync run row. Verify:
- The `direction` column in the SyncStatus table now shows correctly as `sheet_to_db`.
- `rows_skipped` is 0 on first run (no dashboard edits yet to echo).

- [ ] **Step 4: Verify loop prevention manually**

1. In MentionDetail, change one entry's status (e.g. to "reviewed"). This sets `last_edited_by = 'dashboard'` in DB and writes `last_sync_tag` to both DB and Sheet.
2. In SyncStatus, click "Run sync now".
3. After sync completes, in Supabase Table Editor, confirm that the edited entry still has `last_edited_by = 'dashboard'` (i.e. the sync skipped it).
4. Confirm `rows_skipped` in the sync run is at least 1.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/import-tabs/index.ts
git commit -m "fix(import-tabs): use sheet_to_db direction; add echo loop prevention via last_sync_tag"
```

---

## Phase 4 — Realtime Live Updates

**Goal: Overview and SyncStatus pages update automatically without manual refresh.**

Requires Supabase Realtime to be enabled for `entries` and `sync_runs` tables. Enable it in the Supabase dashboard under Database → Replication → Realtime → toggle both tables ON.

---

### Task 4.1 — Create `src/lib/realtime.ts`

**Files:**
- Create: `src/lib/realtime.ts`

- [ ] **Step 1: Write the file**

```typescript
import { supabase } from './supabase';

// Returns an unsubscribe function. Call it in a useEffect cleanup.
export function subscribeEntries(onChange: () => void): () => void {
  const channel = supabase
    .channel('entries-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeSyncRuns(onChange: () => void): () => void {
  const channel = supabase
    .channel('sync-runs-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_runs' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/realtime.ts
git commit -m "feat: add Supabase Realtime subscription helpers"
```

---

### Task 4.2 — Wire Realtime into `Overview.tsx`

**Files:**
- Modify: `src/pages/Overview.tsx`

Extract the data-loading logic into a stable callback and call it from both the initial mount effect and the Realtime change handler.

- [ ] **Step 1: Replace the contents of `src/pages/Overview.tsx`**

```typescript
import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, CalendarDays, Flame, Hash } from 'lucide-react';
import KpiCard from '../components/KpiCard';
import MentionsTable from '../components/MentionsTable';
import TopList from '../components/TopList';
import TimeSeriesChart from '../components/TimeSeriesChart';
import {
  fetchMentionCounts,
  fetchMentionsPerDay,
  fetchRecentMentions,
  fetchTopForums,
  fetchTrendingKeywords,
  type DailyCount,
  type MentionCounts,
  type TopItem,
} from '../lib/queries';
import { subscribeEntries } from '../lib/realtime';
import type { Mention } from '../types/mention';

interface State {
  loading: boolean;
  error: string | null;
  counts: MentionCounts;
  perDay: DailyCount[];
  topForums: TopItem[];
  trendingKeywords: TopItem[];
  recent: Mention[];
}

const initial: State = {
  loading: true,
  error: null,
  counts: { total: 0, last7d: 0 },
  perDay: [],
  topForums: [],
  trendingKeywords: [],
  recent: [],
};

export default function Overview() {
  const [state, setState] = useState<State>(initial);

  const loadData = useCallback(async () => {
    try {
      const [counts, perDay, topForums, trendingKeywords, recent] = await Promise.all([
        fetchMentionCounts(),
        fetchMentionsPerDay(30),
        fetchTopForums(5),
        fetchTrendingKeywords(5),
        fetchRecentMentions(20),
      ]);
      setState({
        loading: false,
        error: null,
        counts,
        perDay,
        topForums,
        trendingKeywords,
        recent,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime: re-fetch when any entry changes
  useEffect(() => {
    return subscribeEntries(() => {
      loadData();
    });
  }, [loadData]);

  if (state.error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {state.error}
      </div>
    );
  }

  const topForumLabel = state.topForums[0]?.label ?? '—';
  const trendingKeyword = state.trendingKeywords[0]?.label ?? '—';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total mentions"
          value={state.loading ? '…' : state.counts.total.toLocaleString()}
          icon={<MessageCircle className="size-4" />}
        />
        <KpiCard
          label="Last 7 days"
          value={state.loading ? '…' : state.counts.last7d.toLocaleString()}
          icon={<CalendarDays className="size-4" />}
        />
        <KpiCard
          label="Top forum (30d)"
          value={state.loading ? '…' : topForumLabel}
          icon={<Flame className="size-4" />}
        />
        <KpiCard
          label="Trending keyword (7d)"
          value={state.loading ? '…' : trendingKeyword}
          icon={<Hash className="size-4" />}
        />
      </div>

      <TimeSeriesChart data={state.perDay} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopList title="Top forums (30d)" items={state.topForums} />
        <TopList title="Trending keywords (7d)" items={state.trendingKeywords} />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Recent mentions</h2>
        <MentionsTable mentions={state.recent} emptyLabel="No mentions yet — sync from the Sync Status page." />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Test Realtime in the browser**

1. Open `http://localhost:5173` (Overview).
2. In a second browser tab, open Supabase Table Editor and manually update any entry's `data` JSONB value (e.g., add a field or change a value).
3. Switch back to the dashboard tab. The KPI counts and table should update within ~1–2 seconds without a page refresh.

If it doesn't update, check the browser console for Supabase Realtime connection errors. Confirm the `entries` table is enabled in Supabase Realtime settings.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Overview.tsx
git commit -m "feat(overview): add Supabase Realtime subscription for live updates"
```

---

### Task 4.3 — Wire Realtime into `SyncStatus.tsx`

**Files:**
- Modify: `src/pages/SyncStatus.tsx`

- [ ] **Step 1: Add the import and subscription**

Add `subscribeSyncRuns` import at the top of the file (alongside existing imports):

```typescript
import { subscribeSyncRuns } from '../lib/realtime';
```

Add a second `useEffect` inside the component, after the existing `useEffect(() => { load(); }, [])`:

```typescript
// Realtime: re-fetch sync_runs when any run changes (e.g. running → success)
useEffect(() => {
  return subscribeSyncRuns(() => {
    load();
  });
}, []);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Test in the browser**

1. Open `http://localhost:5173/sync` (SyncStatus).
2. Click "Run sync now".
3. Without any manual action, the sync run row should appear and its status should transition from `running` → `success` live, without needing to click Refresh.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SyncStatus.tsx
git commit -m "feat(sync-status): add Realtime subscription for live run updates"
```

---

## Post-Implementation Checklist

Run through these after all phases are complete:

- [ ] **TypeScript**: `npx tsc --noEmit` → 0 errors
- [ ] **Build**: `npm run build` → builds without errors; no Vite warnings about missing env vars
- [ ] **Overview**: KPI cards show non-zero counts; Recent Mentions table shows rows; page auto-updates when Supabase data changes
- [ ] **MentionDetail**: status change updates the row in Supabase Table Editor within seconds; Sheet cell updates via Apps Script
- [ ] **SyncStatus**: "Run sync now" succeeds; run history auto-refreshes after sync completes; `direction` column shows `sheet_to_db` (not `initial_import`)
- [ ] **Loop prevention**: edit a row in dashboard, run sync, confirm `rows_skipped` ≥ 1 and the DB row still shows `last_edited_by = 'dashboard'`
- [ ] **Env vars in Vercel**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_IMPORT_TABS_URL`, `VITE_PUSH_TO_SHEET_URL` are all set in Vercel project settings

---

## Deferred (not in this plan)

- **Postgres RPC for aggregations** — replace client-side `GROUP BY` in `fetchTopForums`, `fetchTrendingKeywords`, `fetchMentionsPerDay` with Supabase RPC calls. Improves performance at scale; not needed until row counts exceed ~5,000.
- **Atomic JSONB update** — replace the read-modify-write in `updateMentionStatus` with a Postgres function using `jsonb_set()` for proper concurrency safety.
- **Cron schedule for `import-tabs`** — set up `pg_cron` or Vercel Cron to run the sync automatically (e.g. hourly) instead of requiring manual trigger.
- **Clean up dead code** — `supabase/functions/sync-sheet/` and `supabase/functions/initial-import/` target dropped tables; safe to delete once confident in the new architecture.
- **RLS policies** — add Row Level Security to `entries`, `tab_schemas`, and `sync_runs` to limit anon access.
