# Multi-Tab Ops Tool — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the single-tab scaffold with a multi-tab dashboard that round-trips edits between the dashboard and 6 configured Google Sheet tabs.

**Architecture:** One Postgres table (`entries`) with `(tab, sheet_row_id)` unique key and `data jsonb`. A bound Apps Script Web App exposes `doGet` (read any tab) and `doPost` (write any tab). Two Edge Functions: `import-tabs` (seed from Apps Script) and `push-to-sheet` (relay dashboard edits). Dynamic frontend forms built from per-tab column headers.

**Tech Stack:** Vite 6, React 19, TypeScript, Tailwind v4, React Router v7, Supabase Edge Functions (Deno), Google Apps Script.

**Reference spec:** [docs/superpowers/specs/2026-05-15-multi-tab-ops-tool-design.md](../specs/2026-05-15-multi-tab-ops-tool-design.md)

**Supersedes:** [docs/superpowers/plans/2026-05-15-bidirectional-sync-phase-1.md](2026-05-15-bidirectional-sync-phase-1.md) (single-tab plan, Tasks 1–5 partially implemented and now reworked).

---

## Pre-flight: External setup state

The operator has already done:
- ✅ Initialized git, committed baseline
- ✅ Applied the **prior** single-tab `schema.sql` to Supabase (now needs to be replaced — destructive migration handled in Task 1)
- ❌ Has NOT yet installed Apps Script
- ❌ Has NOT yet linked Supabase CLI / deployed any Edge Functions
- ❌ Has NOT yet set Supabase function secrets

Things that don't change: Supabase project ref `krxnupmhfiduduvvlumc`, anon key value, the bound Google Sheet at `1YufhZ3Wpq8vUdZhmTX96-3w4KrAQm8roXDJncXvf0wk`.

---

## File Structure (Phase 1)

```
supabase/
├── schema.sql                          # REWRITE (Task 1) — drops review_entries; creates entries + tab_schemas
└── functions/
    ├── import-tabs/index.ts            # CREATE (Task 4)
    ├── push-to-sheet/index.ts          # REWRITE (Task 5)
    └── initial-import/                 # DELETE (Task 17)

apps-script/
└── Code.gs                             # REWRITE (Task 3)

src/
├── App.tsx                             # MODIFY (Task 9) — multi-tab routes
├── lib/
│   ├── tabs.ts                         # CREATE (Task 2)
│   ├── queries.ts                      # REWRITE (Task 7)
│   ├── sheet-bridge.ts                 # CREATE (Task 8)
│   └── supabase.ts                     # MODIFY (Task 6)
├── pages/
│   ├── Overview.tsx                    # REWRITE (Task 15)
│   ├── TabEntriesList.tsx              # CREATE (Task 12)
│   ├── EntryDetail.tsx                 # CREATE (Task 13)
│   ├── EntryNew.tsx                    # CREATE (Task 14)
│   └── SyncStatus.tsx                  # MODIFY (Task 16)
├── components/
│   ├── Sidebar.tsx                     # REWRITE (Task 9)
│   ├── Topbar.tsx                      # MODIFY (Task 9)
│   ├── DynamicEntryForm.tsx            # CREATE (Task 10)
│   ├── MaskedField.tsx                 # CREATE (Task 10)
│   └── EntriesTable.tsx                # CREATE (Task 11)
└── types/
    ├── entry.ts                        # CREATE (Task 2)
    ├── tab-schema.ts                   # CREATE (Task 2)
    ├── sync.ts                         # MODIFY (Task 2)
    ├── review-entry.ts                 # DELETE (Task 17)
    └── mention.ts                      # DELETE (Task 17)

.env.example                            # MODIFY (Task 6)
CLAUDE.md                               # MODIFY (Task 18)
```

---

## Task 1: Replace schema with multi-tab tables

**Files:** Modify `supabase/schema.sql` (full rewrite)

- [ ] **Step 1: Replace `supabase/schema.sql` with the following:**

```sql
-- Brands Partner Forum — Supabase schema (multi-tab)
-- Run in the Supabase SQL editor. This is a destructive migration:
-- review_entries from the prior single-tab attempt is dropped.

drop table if exists public.review_entries cascade;
drop table if exists public.entries cascade;
drop table if exists public.tab_schemas cascade;
drop table if exists public.sync_runs cascade;
drop table if exists public.mentions cascade;

create extension if not exists "pgcrypto";

create table public.entries (
  id              uuid primary key default gen_random_uuid(),
  tab             text not null,
  sheet_row_id    text not null,
  data            jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now(),
  last_edited_by  text not null default 'dashboard',
  last_sync_tag   text,
  unique (tab, sheet_row_id)
);

create index entries_tab_idx         on public.entries (tab);
create index entries_tab_updated_idx on public.entries (tab, updated_at desc);
create index entries_data_gin        on public.entries using gin (data);

create table public.tab_schemas (
  tab          text primary key,
  headers      jsonb not null,
  refreshed_at timestamptz not null default now()
);

create table public.sync_runs (
  id             uuid primary key default gen_random_uuid(),
  direction      text not null check (direction in ('sheet_to_db','db_to_sheet','initial_import')),
  tab            text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  rows_seen      int,
  rows_upserted  int,
  rows_skipped   int,
  status         text not null default 'running' check (status in ('running','success','error','skipped')),
  error_message  text,
  payload_ref    text
);

create index sync_runs_started_at_idx on public.sync_runs (started_at desc);
create index sync_runs_direction_idx  on public.sync_runs (direction);
```

- [ ] **Step 2 (operator action — flagged for human):** Open https://supabase.com/dashboard/project/krxnupmhfiduduvvlumc/sql, paste the file contents, and **Run without RLS** when prompted.

- [ ] **Step 3 (operator action):** In Table Editor, verify `entries`, `tab_schemas`, `sync_runs` exist; `review_entries` and `mentions` are gone.

- [ ] **Step 4: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add supabase/schema.sql
git commit -m "schema: replace single-tab with multi-tab entries+tab_schemas"
```

---

## Task 2: Types and tab config

**Files:**
- Create: `src/types/entry.ts`
- Create: `src/types/tab-schema.ts`
- Modify: `src/types/sync.ts`
- Create: `src/lib/tabs.ts`

- [ ] **Step 1: Create `src/types/entry.ts`**

```typescript
export interface Entry {
  id: string;
  tab: string;
  sheet_row_id: string;
  data: Record<string, string | null>;
  updated_at: string;
  last_edited_by: 'dashboard' | 'sheet';
  last_sync_tag: string | null;
}

export type EntryData = Record<string, string | null>;
```

- [ ] **Step 2: Create `src/types/tab-schema.ts`**

```typescript
export interface TabSchema {
  tab: string;
  headers: string[];
  refreshed_at: string;
}
```

- [ ] **Step 3: Replace `src/types/sync.ts`**

```typescript
export type SyncRunStatus = 'running' | 'success' | 'error' | 'skipped';
export type SyncDirection = 'sheet_to_db' | 'db_to_sheet' | 'initial_import';

export interface SyncRun {
  id: string;
  direction: SyncDirection;
  tab: string | null;
  started_at: string;
  finished_at: string | null;
  rows_seen: number | null;
  rows_upserted: number | null;
  rows_skipped: number | null;
  status: SyncRunStatus;
  error_message: string | null;
  payload_ref: string | null;
}
```

- [ ] **Step 4: Create `src/lib/tabs.ts`**

```typescript
export const OPERATIONAL_TABS = [
  'TP Brand Injection',
  'Rooster Partners',
  'Revolution Casino',
  'Trybet',
  'SilverPlay',
  'SuprPlay Limited',
] as const;

export type OperationalTab = (typeof OPERATIONAL_TABS)[number];

export function isOperationalTab(s: string): s is OperationalTab {
  return (OPERATIONAL_TABS as readonly string[]).includes(s);
}

// Slug helpers for URL routing. Spaces → '-', lowercase. Reversible via direct lookup.
export function tabToSlug(tab: string): string {
  return tab.toLowerCase().replace(/\s+/g, '-');
}

export function slugToTab(slug: string): OperationalTab | null {
  const decoded = decodeURIComponent(slug).toLowerCase();
  return OPERATIONAL_TABS.find((t) => tabToSlug(t) === decoded) ?? null;
}

// Sensitive-field heuristic for masked rendering.
const SENSITIVE_PATTERNS = /password|backup|authenticator|secret|token|2fa|otp/i;
export function isSensitiveHeader(header: string): boolean {
  return SENSITIVE_PATTERNS.test(header);
}

// Headers that are bookkeeping, not data — never rendered in the form.
const SKIP_HEADERS = new Set(['id', 'last_sync_tag', '']);
export function isEditableHeader(header: string): boolean {
  return !SKIP_HEADERS.has(header.trim());
}
```

- [ ] **Step 5: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add src/types/entry.ts src/types/tab-schema.ts src/types/sync.ts src/lib/tabs.ts
git commit -m "types: add Entry, TabSchema, tabs config for multi-tab"
```

---

## Task 3: Apps Script — multi-tab bridge

**Files:** Rewrite `apps-script/Code.gs`

- [ ] **Step 1: Replace `apps-script/Code.gs` entirely with:**

```javascript
// Brands Partner Forum — Multi-tab Sheet bridge
// Bound to the Google Sheet at id 1YufhZ3Wpq8vUdZhmTX96-3w4KrAQm8roXDJncXvf0wk.
//
// Endpoints:
//   doPost  { secret, op: 'upsert_row', tab, sheet_row_id, fields, sync_tag } → writes row
//   doGet   ?secret=X&op=structure  → returns [{ name, headers }]
//   doGet   ?secret=X&op=dump       → returns [{ name, headers, rows }]
//
// Run once after install: backfillAllTabIds()

var OPERATIONAL_TABS = [
  'TP Brand Injection',
  'Rooster Partners',
  'Revolution Casino',
  'Trybet',
  'SilverPlay',
  'SuprPlay Limited'
];

var SHARED_SECRET = 'REPLACE_ME_WITH_APPS_SCRIPT_SHARED_SECRET';

var ID_COLUMN = 1; // column A, always

// Per-tab, last_sync_tag goes in (last data column + 1). Computed dynamically.

function backfillAllTabIds() {
  var ss = SpreadsheetApp.getActive();
  var totals = [];
  for (var i = 0; i < OPERATIONAL_TABS.length; i++) {
    var name = OPERATIONAL_TABS[i];
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      totals.push(name + ': NOT FOUND');
      continue;
    }
    var n = ensureIdColumn(sheet);
    ensureSyncTagColumn(sheet);
    totals.push(name + ': +' + n + ' UUIDs');
  }
  Logger.log(totals.join('\n'));
}

function ensureIdColumn(sheet) {
  var firstHeader = sheet.getRange(1, ID_COLUMN).getValue();
  if (firstHeader !== 'id') {
    sheet.insertColumnsBefore(ID_COLUMN, 1);
    sheet.getRange(1, ID_COLUMN).setValue('id');
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var range = sheet.getRange(2, ID_COLUMN, lastRow - 1, 1);
  var values = range.getValues();
  var changed = 0;
  for (var i = 0; i < values.length; i++) {
    if (!values[i][0]) {
      values[i][0] = Utilities.getUuid();
      changed++;
    }
  }
  range.setValues(values);
  return changed;
}

function ensureSyncTagColumn(sheet) {
  var col = syncTagColumnIndex(sheet);
  var header = sheet.getRange(1, col).getValue();
  if (header !== 'last_sync_tag') {
    sheet.getRange(1, col).setValue('last_sync_tag');
  }
}

function syncTagColumnIndex(sheet) {
  // last column with header content + 1. If already named 'last_sync_tag', use that column.
  var lastCol = sheet.getLastColumn();
  for (var c = 1; c <= lastCol; c++) {
    if (sheet.getRange(1, c).getValue() === 'last_sync_tag') return c;
  }
  return lastCol + 1;
}

function doGet(e) {
  var p = e.parameter || {};
  if (p.secret !== SHARED_SECRET) {
    return jsonResponse({ ok: false, error: 'unauthorized' });
  }
  var op = p.op;
  if (op === 'structure') return jsonResponse({ ok: true, tabs: collectStructures(false) });
  if (op === 'dump')      return jsonResponse({ ok: true, tabs: collectStructures(true) });
  return jsonResponse({ ok: false, error: 'unknown op: ' + op });
}

function collectStructures(includeRows) {
  var ss = SpreadsheetApp.getActive();
  var out = [];
  for (var i = 0; i < OPERATIONAL_TABS.length; i++) {
    var name = OPERATIONAL_TABS[i];
    var sheet = ss.getSheetByName(name);
    if (!sheet) continue;
    var lastCol = sheet.getLastColumn();
    var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var tab = { name: name, headers: headers.map(String) };
    if (includeRows) {
      var lastRow = sheet.getLastRow();
      tab.rows = lastRow >= 2
        ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
        : [];
    }
    out.push(tab);
  }
  return out;
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
    }
    if (body.op === 'upsert_row') return handleUpsertRow(body);
    return jsonResponse({ ok: false, error: 'unknown op: ' + body.op });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function handleUpsertRow(body) {
  var tabName = body.tab;
  var rowId = body.sheet_row_id;
  var fields = body.fields || {};
  var syncTag = body.sync_tag;
  if (!tabName || !rowId) {
    return jsonResponse({ ok: false, error: 'tab and sheet_row_id required' });
  }
  if (OPERATIONAL_TABS.indexOf(tabName) === -1) {
    return jsonResponse({ ok: false, error: 'tab not in OPERATIONAL_TABS: ' + tabName });
  }
  var sheet = SpreadsheetApp.getActive().getSheetByName(tabName);
  if (!sheet) return jsonResponse({ ok: false, error: 'sheet not found: ' + tabName });

  // Locate the row by id (column A). Create a new row at the bottom if not found.
  var rowIdx = findRowById(sheet, rowId);
  if (rowIdx === -1) {
    rowIdx = sheet.getLastRow() + 1;
    sheet.getRange(rowIdx, ID_COLUMN).setValue(rowId);
  }

  // Read row 1 to map header → column index.
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var headerToCol = {};
  for (var i = 0; i < headers.length; i++) headerToCol[headers[i]] = i + 1;

  for (var key in fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
    if (key === 'id' || key === 'last_sync_tag') continue; // never overwrite bookkeeping
    var col = headerToCol[key];
    if (!col) {
      // Unknown header — append it after current last column.
      lastCol++;
      col = lastCol;
      sheet.getRange(1, col).setValue(key);
      headers.push(key);
      headerToCol[key] = col;
    }
    var v = fields[key];
    sheet.getRange(rowIdx, col).setValue(v == null ? '' : v);
  }

  if (syncTag) {
    sheet.getRange(rowIdx, syncTagColumnIndex(sheet)).setValue(syncTag);
  }

  return jsonResponse({ ok: true, row: rowIdx });
}

function findRowById(sheet, rowId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, ID_COLUMN, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === rowId) return i + 2;
  }
  return -1;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 2 (operator action):** Open the bound Sheet → **Extensions → Apps Script**. **Delete the previous single-tab code** and paste the contents above. Replace `REPLACE_ME_WITH_APPS_SCRIPT_SHARED_SECRET` on line 16 with a fresh UUID-style secret. Save the secret somewhere.

- [ ] **Step 3 (operator action):** Save (Ctrl+S). Run `backfillAllTabIds` from the function dropdown. Approve OAuth. Verify each of the 6 tabs now has column A = `id` (with UUIDs) and a `last_sync_tag` column at the end.

- [ ] **Step 4 (operator action):** **Deploy → Manage deployments → either edit the existing Web App deployment (if one exists from prior plan) OR create a new deployment**:
  - Execute as: **Me**
  - Who has access: **Anyone**
  - Deploy. Copy the new `/exec` URL.

- [ ] **Step 5 (operator action — smoke test):**

```powershell
$secret = '<the secret>'
$url = '<the /exec URL>'
$body = @{
  secret = $secret; op = 'upsert_row';
  tab = 'Rooster Partners';
  sheet_row_id = 'smoke-test-fake-id';
  fields = @{ Account = 'SMOKE'; Country = 'Atlantis' };
  sync_tag = 'smoke-tag-1'
} | ConvertTo-Json -Compress
Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json' -Body $body

# Then smoke-test doGet:
Invoke-RestMethod -Uri "$url`?secret=$secret&op=structure" -Method Get
```

Confirm: a new row in the `Rooster Partners` tab with `smoke-test-fake-id` in column A and `SMOKE` under `Account`. The `doGet` response lists all 6 tabs with their headers. Delete the smoke-test row afterward.

- [ ] **Step 6: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add apps-script/Code.gs
git commit -m "apps-script: rewrite for multi-tab backfill, doGet, doPost"
```

---

## Task 4: Edge Function — `import-tabs`

**Files:** Create `supabase/functions/import-tabs/index.ts`

- [ ] **Step 1: Create `supabase/functions/import-tabs/index.ts`:**

```typescript
// Supabase Edge Function: import-tabs
//
// Calls Apps Script doGet(op='dump') and bulk-upserts every operational tab's
// rows into public.entries. Refreshes public.tab_schemas with current headers.
//
// Required secrets:
//   SUPABASE_URL                — runtime
//   SUPABASE_SERVICE_ROLE_KEY   — runtime
//   APPS_SCRIPT_WEB_APP_URL     — /exec URL
//   APPS_SCRIPT_SHARED_SECRET   — matches Code.gs SHARED_SECRET

// @ts-expect-error: Deno-only import resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: { env: { get(name: string): string | undefined }; serve: (h: (r: Request) => Response | Promise<Response>) => void };

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

Deno.serve(async () => {
  const { data: runRow, error: startErr } = await admin
    .from('sync_runs')
    .insert({ direction: 'initial_import', status: 'running' })
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
        await admin.from('tab_schemas').upsert({
          tab: tab.name,
          headers: tab.headers,
          refreshed_at: new Date().toISOString(),
        }, { onConflict: 'tab' });

        const idColIndex = tab.headers.indexOf('id');
        if (idColIndex === -1) {
          tabsFailed.push(`${tab.name}: no 'id' column`);
          continue;
        }

        const entries: Array<Record<string, unknown>> = [];
        for (const row of tab.rows) {
          rowsSeen++;
          const sheetRowId = String(row[idColIndex] ?? '').trim();
          if (!sheetRowId) {
            rowsSkipped++;
            continue;
          }
          const data: Record<string, string | null> = {};
          for (let i = 0; i < tab.headers.length; i++) {
            const h = tab.headers[i];
            if (h === 'id' || h === 'last_sync_tag' || h === '') continue;
            const val = row[i];
            data[h] = val == null || val === '' ? null : String(val);
          }
          entries.push({
            tab: tab.name,
            sheet_row_id: sheetRowId,
            data,
          });
        }

        if (entries.length > 0) {
          const { error: upErr } = await admin
            .from('entries')
            .upsert(entries, { onConflict: 'tab,sheet_row_id' });
          if (upErr) throw upErr;
          rowsUpserted += entries.length;
        }
      } catch (tabErr) {
        tabsFailed.push(`${tab.name}: ${tabErr instanceof Error ? tabErr.message : String(tabErr)}`);
      }
    }

    const finalStatus = tabsFailed.length === 0 ? 'success' : 'error';
    await admin.from('sync_runs').update({
      finished_at: new Date().toISOString(),
      rows_seen: rowsSeen,
      rows_upserted: rowsUpserted,
      rows_skipped: rowsSkipped,
      status: finalStatus,
      error_message: tabsFailed.length > 0 ? tabsFailed.join('; ') : null,
    }).eq('id', runId);

    return json({
      ok: tabsFailed.length === 0,
      rows_seen: rowsSeen,
      rows_upserted: rowsUpserted,
      rows_skipped: rowsSkipped,
      tabs_failed: tabsFailed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from('sync_runs').update({
      finished_at: new Date().toISOString(),
      status: 'error',
      error_message: msg,
    }).eq('id', runId);
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

- [ ] **Step 2: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add supabase/functions/import-tabs/index.ts
git commit -m "feat: add import-tabs Edge Function reading via Apps Script doGet"
```

---

## Task 5: Edge Function — `push-to-sheet` (rewrite for multi-tab)

**Files:** Replace `supabase/functions/push-to-sheet/index.ts`

- [ ] **Step 1: Replace the entire file with:**

```typescript
// Supabase Edge Function: push-to-sheet (multi-tab)
//
// Receives { tab, sheet_row_id, fields } from the dashboard, upserts into
// public.entries (merging the JSONB data), and relays to the Apps Script Web App
// which writes the same row into the named Sheet tab.
//
// Required secrets:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (runtime)
//   APPS_SCRIPT_WEB_APP_URL
//   APPS_SCRIPT_SHARED_SECRET

// @ts-expect-error: Deno-only import resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: { env: { get(name: string): string | undefined }; serve: (h: (r: Request) => Response | Promise<Response>) => void };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SCRIPT_URL = Deno.env.get('APPS_SCRIPT_WEB_APP_URL')!;
const SCRIPT_SECRET = Deno.env.get('APPS_SCRIPT_SHARED_SECRET')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const OPERATIONAL_TABS = new Set([
  'TP Brand Injection',
  'Rooster Partners',
  'Revolution Casino',
  'Trybet',
  'SilverPlay',
  'SuprPlay Limited',
]);

interface RequestBody {
  tab: string;
  sheet_row_id: string;
  fields: Record<string, string | null>;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  let body: RequestBody;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON' }, 400); }

  if (!body.tab || typeof body.tab !== 'string') return json({ ok: false, error: 'tab required' }, 400);
  if (!OPERATIONAL_TABS.has(body.tab)) return json({ ok: false, error: 'unknown tab' }, 400);
  if (!body.sheet_row_id || typeof body.sheet_row_id !== 'string') return json({ ok: false, error: 'sheet_row_id required' }, 400);

  // Normalize fields: strip empty strings to null, drop bookkeeping keys.
  const cleanFields: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(body.fields ?? {})) {
    if (k === 'id' || k === 'last_sync_tag' || k === '') continue;
    cleanFields[k] = v === '' || v === undefined ? null : (v as string | null);
  }

  const syncTag = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const { data: runRow, error: runErr } = await admin
    .from('sync_runs')
    .insert({ direction: 'db_to_sheet', tab: body.tab, status: 'running', payload_ref: body.sheet_row_id })
    .select('id')
    .single();
  if (runErr) return json({ ok: false, error: runErr.message }, 500);
  const runId = runRow!.id as string;

  try {
    // Merge with existing data so partial updates don't overwrite untouched fields.
    const { data: existing, error: selErr } = await admin
      .from('entries')
      .select('data')
      .eq('tab', body.tab)
      .eq('sheet_row_id', body.sheet_row_id)
      .maybeSingle();
    if (selErr) throw selErr;

    const mergedData: Record<string, string | null> = {
      ...(existing?.data as Record<string, string | null> | null ?? {}),
      ...cleanFields,
    };

    const { error: upsertErr } = await admin
      .from('entries')
      .upsert({
        tab: body.tab,
        sheet_row_id: body.sheet_row_id,
        data: mergedData,
        updated_at: nowIso,
        last_edited_by: 'dashboard',
        last_sync_tag: syncTag,
      }, { onConflict: 'tab,sheet_row_id' });
    if (upsertErr) throw upsertErr;

    const scriptRes = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: SCRIPT_SECRET,
        op: 'upsert_row',
        tab: body.tab,
        sheet_row_id: body.sheet_row_id,
        fields: cleanFields,
        sync_tag: syncTag,
      }),
    });
    if (!scriptRes.ok) {
      const text = await scriptRes.text();
      throw new Error(`Apps Script ${scriptRes.status}: ${text}`);
    }
    const scriptBody = (await scriptRes.json()) as { ok?: boolean; error?: string };
    if (!scriptBody.ok) throw new Error(`Apps Script returned not-ok: ${scriptBody.error ?? '<no error>'}`);

    await admin.from('sync_runs').update({
      finished_at: new Date().toISOString(),
      rows_seen: 1,
      rows_upserted: 1,
      rows_skipped: 0,
      status: 'success',
    }).eq('id', runId);

    return json({ ok: true, sync_tag: syncTag });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from('sync_runs').update({
      finished_at: new Date().toISOString(),
      status: 'error',
      error_message: msg,
    }).eq('id', runId);
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

- [ ] **Step 2: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add supabase/functions/push-to-sheet/index.ts
git commit -m "feat: rewrite push-to-sheet for multi-tab with JSONB merge"
```

---

## Task 6: Deploy + env config

**Files:** Modify `.env.example` and `src/lib/supabase.ts`

- [ ] **Step 1 (operator action):** Re-apply the schema (Task 1 Step 2) since it's destructive.

- [ ] **Step 2 (operator action):** From the project root:

```powershell
supabase login           # if not already logged in
supabase link --project-ref krxnupmhfiduduvvlumc
supabase secrets unset SHEET_CSV_URL   # no longer needed
supabase secrets set `
  APPS_SCRIPT_WEB_APP_URL='<the /exec URL from Task 3 Step 4>' `
  APPS_SCRIPT_SHARED_SECRET='<the secret from Task 3 Step 2>'
supabase secrets list

supabase functions deploy import-tabs
supabase functions deploy push-to-sheet
# Delete the obsolete one if it was previously deployed:
supabase functions delete initial-import 2>$null
```

- [ ] **Step 3 (operator action):** Run `import-tabs` once:

```powershell
$anon = '<VITE_SUPABASE_ANON_KEY>'
Invoke-RestMethod `
  -Uri 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/import-tabs' `
  -Method Post `
  -Headers @{ Authorization = "Bearer $anon" }
```

Expected response: `ok=$true`, `rows_seen` and `rows_upserted` both nonzero, `tabs_failed` empty. Open Supabase Table Editor and confirm:
- `entries` has rows from all 6 tabs (filter `tab='Rooster Partners'` etc to verify each).
- `tab_schemas` has 6 rows.

- [ ] **Step 4 (operator action — push-to-sheet smoke test):** Pick a `sheet_row_id` from any tab and:

```powershell
$body = @{ tab = 'Rooster Partners'; sheet_row_id = '<real UUID>'; fields = @{ Country = 'PUSH-TEST' } } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/push-to-sheet' -Method Post -ContentType 'application/json' -Headers @{ Authorization = "Bearer $anon" } -Body $body
```

Verify: `ok=$true`, the Sheet row in Rooster Partners now shows `PUSH-TEST` in Country, DB `entries.data->>'Country'` matches, `sync_runs` has a `db_to_sheet` success entry with `tab='Rooster Partners'`. Restore the original value afterward.

- [ ] **Step 5: Replace `.env.example`**

```
# Vite (client-side, exposed to browser)
VITE_SUPABASE_URL=https://krxnupmhfiduduvvlumc.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU
VITE_PUSH_TO_SHEET_URL=https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/push-to-sheet

# Supabase Edge Function secrets (set via `supabase secrets set`)
APPS_SCRIPT_WEB_APP_URL=<the /exec URL>
APPS_SCRIPT_SHARED_SECRET=<the secret>
```

- [ ] **Step 6: Replace `src/lib/supabase.ts`**

```typescript
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — check .env');
}

export const supabase = createClient(url ?? '', anonKey ?? '');

export const PUSH_TO_SHEET_URL = import.meta.env.VITE_PUSH_TO_SHEET_URL ?? '';
export const SUPABASE_ANON_KEY = anonKey ?? '';
```

- [ ] **Step 7: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add .env.example src/lib/supabase.ts
git commit -m "feat: configure env + supabase client for multi-tab"
```

---

## Task 7: Rewrite `src/lib/queries.ts` for multi-tab

**Files:** Modify `src/lib/queries.ts` (full rewrite)

- [ ] **Step 1: Replace with:**

```typescript
import { supabase } from './supabase';
import type { Entry, EntryData } from '../types/entry';
import type { TabSchema } from '../types/tab-schema';
import type { SyncRun } from '../types/sync';

export async function fetchEntriesByTab(tab: string, limit = 500): Promise<Entry[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('tab', tab)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Entry[];
}

export async function fetchEntryById(id: string): Promise<Entry | null> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as Entry) ?? null;
}

export async function fetchEntryByTabAndSheetRowId(tab: string, sheetRowId: string): Promise<Entry | null> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('tab', tab)
    .eq('sheet_row_id', sheetRowId)
    .maybeSingle();
  if (error) throw error;
  return (data as Entry) ?? null;
}

export async function fetchTabSchema(tab: string): Promise<TabSchema | null> {
  const { data, error } = await supabase
    .from('tab_schemas')
    .select('*')
    .eq('tab', tab)
    .maybeSingle();
  if (error) throw error;
  return (data as TabSchema) ?? null;
}

export async function fetchAllTabSchemas(): Promise<TabSchema[]> {
  const { data, error } = await supabase.from('tab_schemas').select('*');
  if (error) throw error;
  return (data ?? []) as TabSchema[];
}

export interface OverviewCounts {
  total: number;
  perTab: Array<{ tab: string; count: number }>;
}

export async function fetchOverviewCounts(): Promise<OverviewCounts> {
  const { data, error } = await supabase
    .from('entries')
    .select('tab', { count: 'exact' });
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const t = (row as { tab: string }).tab;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return {
    total: (data ?? []).length,
    perTab: Array.from(counts.entries()).map(([tab, count]) => ({ tab, count })),
  };
}

export async function fetchSyncRuns(limit = 50): Promise<SyncRun[]> {
  const { data, error } = await supabase
    .from('sync_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SyncRun[];
}

export function newSheetRowId(): string {
  return crypto.randomUUID();
}

export type EntrySaveInput = EntryData;
```

- [ ] **Step 2: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add src/lib/queries.ts
git commit -m "feat: rewrite queries for multi-tab entries+tab_schemas"
```

---

## Task 8: `src/lib/sheet-bridge.ts`

**Files:** Create `src/lib/sheet-bridge.ts`

- [ ] **Step 1: Create:**

```typescript
import { PUSH_TO_SHEET_URL, SUPABASE_ANON_KEY } from './supabase';
import type { EntryData } from '../types/entry';

export interface PushResult {
  ok: true;
  sync_tag: string;
}

export class SheetSyncError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'SheetSyncError';
  }
}

export async function pushEntryToSheet(
  tab: string,
  sheet_row_id: string,
  fields: EntryData,
): Promise<PushResult> {
  if (!PUSH_TO_SHEET_URL) {
    throw new SheetSyncError('VITE_PUSH_TO_SHEET_URL is not configured', 0);
  }
  const res = await fetch(PUSH_TO_SHEET_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ tab, sheet_row_id, fields }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; sync_tag?: string; error?: string };
  if (!res.ok || !body.ok || !body.sync_tag) {
    throw new SheetSyncError(body.error ?? `push-to-sheet ${res.status}`, res.status);
  }
  return { ok: true, sync_tag: body.sync_tag };
}
```

- [ ] **Step 2: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add src/lib/sheet-bridge.ts
git commit -m "feat: add multi-tab sheet-bridge client"
```

---

## Task 9: Navigation — Sidebar, Topbar, App routes

**Files:** Modify `src/components/Sidebar.tsx`, `src/components/Topbar.tsx`, `src/App.tsx`

- [ ] **Step 1: Replace `src/components/Sidebar.tsx`:**

```typescript
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, RefreshCw, MessagesSquare, FolderTree } from 'lucide-react';
import { OPERATIONAL_TABS, tabToSlug } from '../lib/tabs';

export default function Sidebar() {
  return (
    <aside className="hidden md:flex md:w-64 flex-col bg-slate-900 text-slate-100">
      <div className="px-5 py-5 flex items-center gap-2 border-b border-slate-800">
        <MessagesSquare className="size-5 text-brand-500" />
        <span className="font-semibold tracking-tight">Brands Partner Forum</span>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            sidebarLinkClasses(isActive)
          }
        >
          <LayoutDashboard className="size-4" />
          Overview
        </NavLink>

        <div className="mt-4 mb-1 px-3 text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <FolderTree className="size-3" /> Tabs
        </div>
        {OPERATIONAL_TABS.map((tab) => (
          <NavLink
            key={tab}
            to={`/tabs/${tabToSlug(tab)}`}
            className={({ isActive }) => sidebarLinkClasses(isActive)}
          >
            <span className="truncate">{tab}</span>
          </NavLink>
        ))}

        <div className="mt-4 border-t border-slate-800 pt-2">
          <NavLink
            to="/sync"
            className={({ isActive }) => sidebarLinkClasses(isActive)}
          >
            <RefreshCw className="size-4" />
            Sync Status
          </NavLink>
        </div>
      </nav>
      <div className="px-4 py-3 text-xs text-slate-500 border-t border-slate-800">
        Internal · v0.1
      </div>
    </aside>
  );
}

function sidebarLinkClasses(isActive: boolean): string {
  return [
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
    isActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
  ].join(' ');
}
```

- [ ] **Step 2: Replace `src/components/Topbar.tsx`:**

```typescript
import { useLocation } from 'react-router-dom';
import { slugToTab } from '../lib/tabs';

export default function Topbar() {
  const { pathname } = useLocation();
  let title = 'Brands Partner Forum';
  if (pathname === '/') title = 'Overview';
  else if (pathname === '/sync') title = 'Sync Status';
  else if (pathname.startsWith('/tabs/')) {
    const rest = pathname.slice('/tabs/'.length);
    const [slug, ...subParts] = rest.split('/');
    const tab = slugToTab(slug);
    if (tab) {
      if (subParts[0] === 'new') title = `${tab} · New entry`;
      else if (subParts[0] === 'entries') title = `${tab} · Entry detail`;
      else title = tab;
    }
  }

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between">
      <h1 className="text-base font-semibold text-slate-800">{title}</h1>
      <div className="text-xs text-slate-500">dailytwists internal</div>
    </header>
  );
}
```

- [ ] **Step 3: Replace `src/App.tsx`:**

```typescript
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Overview from './pages/Overview';
import TabEntriesList from './pages/TabEntriesList';
import EntryDetail from './pages/EntryDetail';
import EntryNew from './pages/EntryNew';
import SyncStatus from './pages/SyncStatus';

export default function App() {
  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-6 md:p-8 overflow-x-hidden">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/tabs/:tabSlug" element={<TabEntriesList />} />
            <Route path="/tabs/:tabSlug/new" element={<EntryNew />} />
            <Route path="/tabs/:tabSlug/entries/:id" element={<EntryDetail />} />
            <Route path="/sync" element={<SyncStatus />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Compile check (expect errors from missing pages — acceptable until Tasks 12–15)**

```powershell
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add src/components/Sidebar.tsx src/components/Topbar.tsx src/App.tsx
git commit -m "feat: multi-tab navigation in sidebar, topbar, app routes"
```

---

## Task 10: `MaskedField` + `DynamicEntryForm`

**Files:** Create `src/components/MaskedField.tsx` and `src/components/DynamicEntryForm.tsx`

- [ ] **Step 1: Create `src/components/MaskedField.tsx`:**

```typescript
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
}

export default function MaskedField({ label, name, value, onChange }: Props) {
  const [revealed, setRevealed] = useState(false);
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <div className="relative">
        <input
          name={name}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          className="w-full rounded-md border border-slate-300 px-3 py-2 pr-10 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        <button
          type="button"
          aria-label={revealed ? 'Hide' : 'Reveal'}
          onClick={() => setRevealed((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
        >
          {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </label>
  );
}
```

- [ ] **Step 2: Create `src/components/DynamicEntryForm.tsx`:**

```typescript
import { useState } from 'react';
import MaskedField from './MaskedField';
import { isSensitiveHeader, isEditableHeader } from '../lib/tabs';
import type { EntryData } from '../types/entry';

export interface DynamicEntryFormProps {
  headers: string[];
  initial: EntryData;
  onSave: (fields: EntryData) => Promise<void>;
  saving: boolean;
  saveLabel?: string;
}

function toFormState(headers: string[], initial: EntryData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    if (!isEditableHeader(h)) continue;
    const v = initial[h];
    out[h] = v == null ? '' : String(v);
  }
  return out;
}

function fromFormState(state: Record<string, string>): EntryData {
  const out: EntryData = {};
  for (const [k, v] of Object.entries(state)) {
    out[k] = v === '' ? null : v;
  }
  return out;
}

export default function DynamicEntryForm({ headers, initial, onSave, saving, saveLabel = 'Save' }: DynamicEntryFormProps) {
  const [state, setState] = useState(() => toFormState(headers, initial));
  const setField = (k: string, v: string) => setState((prev) => ({ ...prev, [k]: v }));
  const editableHeaders = headers.filter(isEditableHeader);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(fromFormState(state));
      }}
      className="space-y-6"
    >
      <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {editableHeaders.map((h) => {
            if (isSensitiveHeader(h)) {
              return (
                <MaskedField
                  key={h}
                  label={h}
                  name={h}
                  value={state[h] ?? ''}
                  onChange={(v) => setField(h, v)}
                />
              );
            }
            return (
              <label key={h} className="flex flex-col gap-1 text-sm">
                <span className="text-slate-600">{h}</span>
                <input
                  name={h}
                  type="text"
                  value={state[h] ?? ''}
                  onChange={(e) => setField(h, e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add src/components/MaskedField.tsx src/components/DynamicEntryForm.tsx
git commit -m "feat: dynamic form built from tab headers + masked field"
```

---

## Task 11: `EntriesTable` component

**Files:** Create `src/components/EntriesTable.tsx`

- [ ] **Step 1: Create:**

```typescript
import { Link } from 'react-router-dom';
import { tabToSlug } from '../lib/tabs';
import type { Entry } from '../types/entry';

const MAX_PREVIEW_COLUMNS = 6;

export interface EntriesTableProps {
  rows: Entry[];
  headers: string[];     // ordered headers from tab_schemas
}

export default function EntriesTable({ rows, headers }: EntriesTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No entries.</p>;
  }
  // Pick a few key columns to preview. Skip bookkeeping columns.
  const previewHeaders = headers
    .filter((h) => h !== 'id' && h !== 'last_sync_tag' && h !== '')
    .slice(0, MAX_PREVIEW_COLUMNS);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {previewHeaders.map((h) => (
              <th key={h} className="px-4 py-2 whitespace-nowrap">{h}</th>
            ))}
            <th className="px-4 py-2 whitespace-nowrap">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              {previewHeaders.map((h, idx) => {
                const val = row.data[h] ?? '';
                if (idx === 0) {
                  return (
                    <td key={h} className="px-4 py-2">
                      <Link
                        to={`/tabs/${tabToSlug(row.tab)}/entries/${row.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {String(val) || '—'}
                      </Link>
                    </td>
                  );
                }
                return (
                  <td key={h} className="px-4 py-2 max-w-xs truncate" title={String(val)}>
                    {String(val) || '—'}
                  </td>
                );
              })}
              <td className="px-4 py-2 text-slate-500 whitespace-nowrap">
                {new Date(row.updated_at).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add src/components/EntriesTable.tsx
git commit -m "feat: generic EntriesTable driven by tab headers"
```

---

## Task 12: `TabEntriesList` page

**Files:** Create `src/pages/TabEntriesList.tsx`

- [ ] **Step 1: Create:**

```typescript
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import EntriesTable from '../components/EntriesTable';
import { fetchEntriesByTab, fetchTabSchema } from '../lib/queries';
import { slugToTab, tabToSlug } from '../lib/tabs';
import type { Entry } from '../types/entry';

export default function TabEntriesList() {
  const { tabSlug } = useParams<{ tabSlug: string }>();
  const tab = tabSlug ? slugToTab(tabSlug) : null;
  const [rows, setRows] = useState<Entry[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tab) {
      setError('Unknown tab');
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([fetchEntriesByTab(tab), fetchTabSchema(tab)])
      .then(([entries, schema]) => {
        setRows(entries);
        setHeaders(schema?.headers ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [tab]);

  if (!tab) return <p className="text-sm text-red-600">Unknown tab.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">{tab}</h2>
        <Link
          to={`/tabs/${tabToSlug(tab)}/new`}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          New entry
        </Link>
      </div>
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && <EntriesTable rows={rows} headers={headers} />}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add src/pages/TabEntriesList.tsx
git commit -m "feat: TabEntriesList page driven by tab URL slug"
```

---

## Task 13: `EntryDetail` page

**Files:** Create `src/pages/EntryDetail.tsx`

- [ ] **Step 1: Create:**

```typescript
import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import DynamicEntryForm from '../components/DynamicEntryForm';
import { fetchEntryById, fetchTabSchema } from '../lib/queries';
import { pushEntryToSheet } from '../lib/sheet-bridge';
import { slugToTab, tabToSlug } from '../lib/tabs';
import type { Entry, EntryData } from '../types/entry';

export default function EntryDetail() {
  const { tabSlug, id } = useParams<{ tabSlug: string; id: string }>();
  const tab = tabSlug ? slugToTab(tabSlug) : null;
  const navigate = useNavigate();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!tab || !id) {
      setError('Unknown tab or entry');
      setLoading(false);
      return;
    }
    Promise.all([fetchEntryById(id), fetchTabSchema(tab)])
      .then(([e, schema]) => {
        setEntry(e);
        setHeaders(schema?.headers ?? []);
        if (!e) setError('Entry not found');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [tab, id]);

  async function handleSave(fields: EntryData) {
    if (!entry || !tab) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      await pushEntryToSheet(tab, entry.sheet_row_id, fields);
      setStatus('Saved & synced to Sheet');
      const fresh = await fetchEntryById(entry.id);
      if (fresh) setEntry(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error && !entry) return <p className="text-sm text-red-600">{error}</p>;
  if (!entry || !tab) return null;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <Link to={`/tabs/${tabToSlug(tab)}`} className="text-sm text-slate-500 hover:underline">
            ← {tab}
          </Link>
          <h2 className="text-lg font-semibold text-slate-800 mt-1">
            Entry · {entry.sheet_row_id.slice(0, 8)}
          </h2>
          <p className="text-xs text-slate-500">
            Last updated {new Date(entry.updated_at).toLocaleString()} ({entry.last_edited_by})
          </p>
        </div>
        <button
          onClick={() => navigate(`/tabs/${tabToSlug(tab)}`)}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          Close
        </button>
      </div>
      {status && <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{status}</div>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <DynamicEntryForm
        headers={headers}
        initial={entry.data}
        onSave={handleSave}
        saving={saving}
        saveLabel="Save & sync"
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add src/pages/EntryDetail.tsx
git commit -m "feat: EntryDetail page with dynamic form per tab"
```

---

## Task 14: `EntryNew` page

**Files:** Create `src/pages/EntryNew.tsx`

- [ ] **Step 1: Create:**

```typescript
import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import DynamicEntryForm from '../components/DynamicEntryForm';
import { fetchEntryByTabAndSheetRowId, fetchTabSchema, newSheetRowId } from '../lib/queries';
import { pushEntryToSheet } from '../lib/sheet-bridge';
import { slugToTab, tabToSlug } from '../lib/tabs';
import type { EntryData } from '../types/entry';

export default function EntryNew() {
  const { tabSlug } = useParams<{ tabSlug: string }>();
  const tab = tabSlug ? slugToTab(tabSlug) : null;
  const navigate = useNavigate();
  const [headers, setHeaders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tab) {
      setError('Unknown tab');
      setLoading(false);
      return;
    }
    fetchTabSchema(tab)
      .then((s) => setHeaders(s?.headers ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [tab]);

  async function handleSave(fields: EntryData) {
    if (!tab) return;
    setSaving(true);
    setError(null);
    const rowId = newSheetRowId();
    try {
      await pushEntryToSheet(tab, rowId, fields);
      const created = await fetchEntryByTabAndSheetRowId(tab, rowId);
      if (created) navigate(`/tabs/${tabToSlug(tab)}/entries/${created.id}`);
      else navigate(`/tabs/${tabToSlug(tab)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!tab) return <p className="text-sm text-red-600">Unknown tab.</p>;
  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link to={`/tabs/${tabToSlug(tab)}`} className="text-sm text-slate-500 hover:underline">
          ← {tab}
        </Link>
        <h2 className="text-lg font-semibold text-slate-800 mt-1">New entry</h2>
      </div>
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <DynamicEntryForm
        headers={headers}
        initial={{}}
        onSave={handleSave}
        saving={saving}
        saveLabel="Create & sync"
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add src/pages/EntryNew.tsx
git commit -m "feat: EntryNew page for creating rows in any tab"
```

---

## Task 15: Rewrite `Overview` page

**Files:** Modify `src/pages/Overview.tsx` (full rewrite)

- [ ] **Step 1: Replace:**

```typescript
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import KpiCard from '../components/KpiCard';
import { fetchOverviewCounts } from '../lib/queries';
import type { OverviewCounts } from '../lib/queries';
import { tabToSlug } from '../lib/tabs';

export default function Overview() {
  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOverviewCounts()
      .then(setCounts)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!counts) return null;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total entries (all tabs)" value={counts.total} />
        <KpiCard label="Tabs in use" value={counts.perTab.length} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Entries per tab</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {counts.perTab.map(({ tab, count }) => (
            <Link
              key={tab}
              to={`/tabs/${tabToSlug(tab)}`}
              className="rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-brand-500 hover:shadow-sm transition"
            >
              <div className="text-sm font-medium text-slate-800">{tab}</div>
              <div className="text-2xl font-semibold text-slate-900 mt-1">{count}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify `src/components/KpiCard.tsx` accepts `{ label, value }`**

```powershell
cat src/components/KpiCard.tsx
```

If not, adapt the JSX. Most likely it already does.

- [ ] **Step 3: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add src/pages/Overview.tsx
git commit -m "feat: Overview cross-tab counts and tab cards"
```

---

## Task 16: Update `SyncStatus`

**Files:** Modify `src/pages/SyncStatus.tsx` (full rewrite)

- [ ] **Step 1: Replace:**

```typescript
import { useEffect, useState } from 'react';
import { fetchSyncRuns } from '../lib/queries';
import type { SyncRun } from '../types/sync';

export default function SyncStatus() {
  const [rows, setRows] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSyncRuns(50)
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-800">Sync runs</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Direction</th>
              <th className="px-4 py-2">Tab</th>
              <th className="px-4 py-2">Started</th>
              <th className="px-4 py-2">Finished</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Rows</th>
              <th className="px-4 py-2">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">{r.direction}</td>
                <td className="px-4 py-2 text-slate-700">{r.tab ?? '—'}</td>
                <td className="px-4 py-2 text-slate-500">{new Date(r.started_at).toLocaleString()}</td>
                <td className="px-4 py-2 text-slate-500">
                  {r.finished_at ? new Date(r.finished_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-2">{r.status}</td>
                <td className="px-4 py-2">{r.rows_upserted ?? 0} / {r.rows_seen ?? 0}</td>
                <td className="px-4 py-2 text-red-600 max-w-md truncate" title={r.error_message ?? ''}>
                  {r.error_message ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Full TS compile**

```powershell
npx tsc --noEmit
```

Expected: **zero errors**. Fix any inline.

- [ ] **Step 3: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add src/pages/SyncStatus.tsx
git commit -m "feat: SyncStatus shows tab column for multi-tab runs"
```

---

## Task 17: Delete obsolete files

**Files to delete:**
- `src/pages/MentionDetail.tsx`
- `src/components/MentionsTable.tsx`
- `src/types/mention.ts`
- `src/types/review-entry.ts`
- `supabase/functions/sync-sheet/` (entire dir)
- `supabase/functions/initial-import/` (entire dir)

- [ ] **Step 1: Remove files**

```powershell
Remove-Item -Force src/pages/MentionDetail.tsx 2>$null
Remove-Item -Force src/components/MentionsTable.tsx 2>$null
Remove-Item -Force src/types/mention.ts 2>$null
Remove-Item -Force src/types/review-entry.ts 2>$null
Remove-Item -Recurse -Force supabase/functions/sync-sheet 2>$null
Remove-Item -Recurse -Force supabase/functions/initial-import 2>$null
```

- [ ] **Step 2: Search for lingering references**

```powershell
Select-String -Path src/**/*.ts*,supabase/**/* -Pattern 'MentionDetail|MentionsTable|ReviewEntry|sync-sheet|initial-import|VITE_SYNC_FUNCTION_URL|review_entries|review-entry|mention\.ts' -List
```

If anything matches, open and fix that file.

- [ ] **Step 3: Final build**

```powershell
npm run build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add -A
git commit -m "chore: delete obsolete single-tab and mention files"
```

---

## Task 18: Update CLAUDE.md

**Files:** Modify `CLAUDE.md` (Data Model, Architecture Rules, Current Tasks, Recent Changes sections)

- [ ] **Step 1:** Open `CLAUDE.md` and replace the relevant sections with:

```markdown
## Architecture Rules
- **Multi-tab data flow:** 6 Google Sheet tabs ↔ Dashboard. Dashboard is the source of truth. Edits go through the `push-to-sheet` Edge Function which updates Supabase and relays to the bound Apps Script Web App, which writes the named tab. Reverse sync (Sheet → DB) is Phase 2.
- **Initial seed:** `import-tabs` Edge Function calls Apps Script `doGet(op='dump')` and bulk-upserts every operational tab's rows. Run once at cutover, idempotent on re-run.
- **Auth:** none in app — Vercel password protection guards the deploy. Treat anon key as effectively public.
- **Tab config:** the operational tab list lives in `src/lib/tabs.ts` (also mirrored in `apps-script/Code.gs` and `supabase/functions/push-to-sheet/index.ts`).
- **Data access:** all Supabase queries live in `src/lib/queries.ts`. The dashboard's write path goes through `src/lib/sheet-bridge.ts` → `push-to-sheet` Edge Function.
- **Routing:** React Router v7. Routes: `/`, `/tabs/:tabSlug`, `/tabs/:tabSlug/new`, `/tabs/:tabSlug/entries/:id`, `/sync`.
- **Sensitive fields** (Password, Casino Password, Backup Codes, Authenticator Backup, etc.): rendered masked based on header regex `password|backup|authenticator|secret|token|2fa|otp`.

## Data Model
- `entries(id, tab, sheet_row_id, data jsonb, updated_at, last_edited_by, last_sync_tag, unique(tab, sheet_row_id))` — one row per Sheet row across all operational tabs. All column values live in `data` keyed by Sheet header.
- `tab_schemas(tab, headers jsonb, refreshed_at)` — cached column order per tab; refreshed by `import-tabs`.
- `sync_runs(id, direction, tab, started_at, finished_at, rows_seen, rows_upserted, rows_skipped, status, error_message, payload_ref)` — sync history.
- `sheet_row_id` is column A of the Sheet (UUID). `(tab, sheet_row_id)` is the idempotency key for upserts.
```

Update "Recent Changes" with: `*2026-05-15:* Pivoted to multi-tab architecture. Replaced single-tab `review_entries` with polymorphic `entries` + `tab_schemas`. Apps Script handles all 6 operational tabs via doGet/doPost. Phase 1 ships writes only; reverse sync deferred to Phase 2.`

- [ ] **Step 2: Commit**

```bash
cd "c:/Users/Leo/OneDrive/Desktop/AI Automation/Internal Projects/Forums Dashboard"
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for multi-tab architecture"
```

---

## Task 19: End-to-end smoke test

**Files:** none — operator verification.

- [ ] **Step 1: Start dev server**

```powershell
npm run dev
```

- [ ] **Step 2: Overview**

Navigate to `/`. Verify: 2 KPI cards (total + tabs in use), 6 tab cards each showing a count. Click a tab card → routes to that tab's list.

- [ ] **Step 3: Tab list + detail**

On any tab's `/tabs/...` page: verify rows render with a few key columns. Click a row → editor with all that tab's columns. Sensitive fields (Password, Casino Password, Backup Codes, Authenticator Backup) render masked with eye toggles.

- [ ] **Step 4: Edit round-trip**

Change a non-sensitive field (e.g. `Country`) to a sentinel value `E2E-<timestamp>`. Click Save & sync. Confirm:
- Green banner shows success.
- The matching row in the corresponding Google Sheet tab now has the sentinel value.
- Reset.

- [ ] **Step 5: New entry**

In a tab, click "New entry". Fill at minimum: Account, Country, Brand-ish columns. Save. Verify navigation to the new entry's detail page, and a new row at the bottom of that tab's Sheet (with UUID in column A).

- [ ] **Step 6: Sync status**

Navigate to `/sync`. Confirm: `initial_import` row from earlier (success), several `db_to_sheet` success rows with the right tab name in the Tab column.

- [ ] **Step 7: Failure path**

Temporarily invalidate `APPS_SCRIPT_WEB_APP_URL` secret:

```powershell
supabase secrets set APPS_SCRIPT_WEB_APP_URL='https://bad.example.com/exec'
```

Attempt a save → red error banner. Confirm `sync_runs` has a `db_to_sheet error` row. Restore the correct secret.

- [ ] **Step 8: Commit any follow-ups**

```powershell
git status
# if there are fixes:
git add -A
git commit -m "fix: smoke-test follow-ups"
```

---

## Self-Review Coverage Map

| Spec section | Task(s) |
|---|---|
| §2 OPERATIONAL_TABS constant | 2 (`src/lib/tabs.ts`), 3 (Apps Script), 5 (push-to-sheet) |
| §3 Architecture (import-tabs, push-to-sheet, Apps Script) | 3, 4, 5, 6 |
| §4 `entries` table | 1 |
| §4 `tab_schemas` table | 1, 4 (populated by import-tabs) |
| §4 `sync_runs` (with `tab`) | 1, 4, 5 |
| §5 Sheet layout per tab (id + last_sync_tag) | 3 (Apps Script backfill, syncTagColumnIndex) |
| §6.1 Initial import (import-tabs) | 4, 6 |
| §6.2 Dashboard edit → DB → Sheet | 5, 8, 13 |
| §6.3 Reverse sync (Phase 2 — deferred) | — |
| §7.1 Routes | 9 |
| §7.2 Sidebar with tab list | 9 |
| §7.3 Overview cross-tab | 15 |
| §7.4 Tab entries list | 11, 12 |
| §7.5 Dynamic entry editor with sensitive masking | 10, 13 |
| §7.6 New entry form | 14 |
| §7.7 Sync status with tab column | 16 |
| §9 Env / secrets | 6 |
| §10 Sensitive field heuristic | 2 (`isSensitiveHeader`), 10 (`DynamicEntryForm`) |
| §11 Error handling (per-call, retries deferred) | 4, 5, 13 |
| §12 Testing | 19 |
| §13 Migration / cutover | 1, 3, 4, 6, 19 |
| §14 Phasing (Phase 1 only here) | covered |
| §15 Out of scope | — |
