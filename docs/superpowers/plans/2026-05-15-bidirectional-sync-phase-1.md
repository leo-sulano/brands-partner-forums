# Bidirectional Sync — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the read-only "forum mentions" scaffold with a write-capable ops tool whose edits round-trip from the dashboard back to the source Google Sheet.

**Architecture:** Supabase Postgres is the source of truth. Two Edge Functions handle (a) one-shot CSV import and (b) DB-update + relay to the Google Sheet via a bound Apps Script Web App. The Apps Script runs as the Sheet owner, removing all GCP service-account dependencies. Reverse sync (Sheet→DB) is deferred to Phase 2.

**Tech Stack:** Vite 6, React 19, TypeScript, Tailwind v4, React Router v7, Supabase Edge Functions (Deno), Google Apps Script.

**Reference spec:** [docs/superpowers/specs/2026-05-15-bidirectional-sync-ops-tool-design.md](../specs/2026-05-15-bidirectional-sync-ops-tool-design.md)

---

## Pre-flight: Required external setup

Before any tasks run, the operator must:

1. Have access to the Supabase project (URL `https://krxnupmhfiduduvvlumc.supabase.co`) and its service-role key.
2. Have **Editor** access on the Google Sheet at `1YufhZ3Wpq8vUdZhmTX96-3w4KrAQm8roXDJncXvf0wk` (the Apps Script is bound to it).
3. Have the Supabase CLI installed locally: `npm i -g supabase`, then `supabase login`.

These are not code tasks — verify they're done before starting Task 1.

---

## File Structure (Phase 1)

```
supabase/
├── schema.sql                          # REWRITE (Task 1)
└── functions/
    ├── initial-import/index.ts         # CREATE (Task 4)
    ├── push-to-sheet/index.ts          # CREATE (Task 5)
    └── sync-sheet/                     # DELETE (Task 18)

apps-script/
└── Code.gs                             # CREATE (Task 3)

src/
├── App.tsx                             # MODIFY (Task 9)
├── lib/
│   ├── queries.ts                      # REWRITE (Task 7)
│   ├── sheet-bridge.ts                 # CREATE (Task 8)
│   └── supabase.ts                     # MODIFY (Task 6)
├── pages/
│   ├── Overview.tsx                    # REWRITE (Task 15)
│   ├── EntriesList.tsx                 # CREATE (Task 12)
│   ├── EntryDetail.tsx                 # CREATE (Task 13)
│   ├── EntryNew.tsx                    # CREATE (Task 14)
│   ├── SyncStatus.tsx                  # MODIFY (Task 16)
│   └── MentionDetail.tsx               # DELETE (Task 17)
├── components/
│   ├── Sidebar.tsx                     # MODIFY (Task 9)
│   ├── Topbar.tsx                      # MODIFY (Task 9)
│   ├── MentionsTable.tsx               # DELETE (Task 17)
│   ├── EntriesTable.tsx                # CREATE (Task 11)
│   ├── EntryForm.tsx                   # CREATE (Task 10)
│   └── MaskedField.tsx                 # CREATE (Task 10)
└── types/
    ├── review-entry.ts                 # CREATE (Task 2)
    ├── sync.ts                         # MODIFY (Task 2)
    └── mention.ts                      # DELETE (Task 17)

.env.example                            # MODIFY (Task 6)
CLAUDE.md                               # MODIFY (Task 18)
```

---

## Task 1: Replace database schema

**Files:**
- Modify: `supabase/schema.sql` (full rewrite)

- [ ] **Step 1: Replace the entire contents of `supabase/schema.sql`**

```sql
-- Brands Partner Forum — Supabase schema
-- Run in the Supabase SQL editor, or via `supabase db push` against a linked project.

-- Drop legacy tables from the prior design.
drop table if exists public.mentions cascade;
drop table if exists public.sync_runs cascade;

create extension if not exists "pgcrypto";

create table public.review_entries (
  id              uuid primary key default gen_random_uuid(),
  sheet_row_id    text unique not null,

  agent                       text,
  account                     text,
  country                     text,
  proxy_used                  text,
  email                       text,
  password                    text,
  account_name                text,
  account_surname             text,

  process                     text,
  details                     text,
  brand                       text,

  status_date                 date,
  score_added                 int,
  trustpilot_date             date,
  profile_url                 text,
  review_status               text,

  redirection_search_engine   text,
  redirection_word            text,
  review_language             text,
  native_language             text,

  register_from_google        text,
  leaving_review_after_email  text,
  sticky_ip_mobile            text,
  photo_in_account            text,
  device                      text,
  opening_via_useful          text,
  opening_via_register        text,
  scrolling_hovering          text,
  smart_paste                 text,
  mentioning_time_frames      text,
  mentioning_amounts          text,
  mentioning_agent_name       text,
  review_length               text,

  updated_at        timestamptz not null default now(),
  last_edited_by    text not null default 'dashboard',
  last_sync_tag     text
);

create index review_entries_brand_idx       on public.review_entries (brand);
create index review_entries_agent_idx       on public.review_entries (agent);
create index review_entries_country_idx     on public.review_entries (country);
create index review_entries_status_idx      on public.review_entries (review_status);
create index review_entries_updated_at_idx  on public.review_entries (updated_at desc);

create table public.sync_runs (
  id             uuid primary key default gen_random_uuid(),
  direction      text not null check (direction in ('sheet_to_db','db_to_sheet','initial_import')),
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

- [ ] **Step 2: Apply the schema in Supabase SQL editor**

Open https://supabase.com/dashboard/project/krxnupmhfiduduvvlumc/sql, paste the file contents, and run. Verify success in the result panel.

- [ ] **Step 3: Verify tables exist**

Open the Table Editor in the Supabase dashboard and confirm `review_entries` and `sync_runs` are present with the expected columns. The legacy `mentions` table should be gone.

- [ ] **Step 4: Commit**

```powershell
git add supabase/schema.sql
git commit -m "schema: replace mentions with review_entries for ops tool"
```

---

## Task 2: TypeScript types

**Files:**
- Create: `src/types/review-entry.ts`
- Modify: `src/types/sync.ts`

- [ ] **Step 1: Create `src/types/review-entry.ts`**

```typescript
export interface ReviewEntry {
  id: string;
  sheet_row_id: string;

  agent: string | null;
  account: string | null;
  country: string | null;
  proxy_used: string | null;
  email: string | null;
  password: string | null;
  account_name: string | null;
  account_surname: string | null;

  process: string | null;
  details: string | null;
  brand: string | null;

  status_date: string | null;       // ISO date 'YYYY-MM-DD'
  score_added: number | null;
  trustpilot_date: string | null;   // ISO date 'YYYY-MM-DD'
  profile_url: string | null;
  review_status: string | null;

  redirection_search_engine: string | null;
  redirection_word: string | null;
  review_language: string | null;
  native_language: string | null;

  register_from_google: string | null;
  leaving_review_after_email: string | null;
  sticky_ip_mobile: string | null;
  photo_in_account: string | null;
  device: string | null;
  opening_via_useful: string | null;
  opening_via_register: string | null;
  scrolling_hovering: string | null;
  smart_paste: string | null;
  mentioning_time_frames: string | null;
  mentioning_amounts: string | null;
  mentioning_agent_name: string | null;
  review_length: string | null;

  updated_at: string;
  last_edited_by: 'dashboard' | 'sheet';
  last_sync_tag: string | null;
}

export type ReviewEntryDraft = Omit<
  ReviewEntry,
  'id' | 'sheet_row_id' | 'updated_at' | 'last_edited_by' | 'last_sync_tag'
>;

export const REVIEW_ENTRY_EDITABLE_FIELDS = [
  'agent', 'account', 'country', 'proxy_used', 'email', 'password',
  'account_name', 'account_surname',
  'process', 'details', 'brand',
  'status_date', 'score_added', 'trustpilot_date', 'profile_url', 'review_status',
  'redirection_search_engine', 'redirection_word', 'review_language', 'native_language',
  'register_from_google', 'leaving_review_after_email', 'sticky_ip_mobile',
  'photo_in_account', 'device', 'opening_via_useful', 'opening_via_register',
  'scrolling_hovering', 'smart_paste', 'mentioning_time_frames',
  'mentioning_amounts', 'mentioning_agent_name', 'review_length',
] as const satisfies ReadonlyArray<keyof ReviewEntryDraft>;
```

- [ ] **Step 2: Replace `src/types/sync.ts`**

```typescript
export type SyncRunStatus = 'running' | 'success' | 'error' | 'skipped';
export type SyncDirection = 'sheet_to_db' | 'db_to_sheet' | 'initial_import';

export interface SyncRun {
  id: string;
  direction: SyncDirection;
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

- [ ] **Step 3: Verify TS compiles**

```powershell
npx tsc --noEmit
```

Expected: errors about uses of the removed `Mention` type and old `SyncRun` shape. These will be fixed in later tasks. Note the errors — they should diminish to zero by Task 16.

- [ ] **Step 4: Commit**

```powershell
git add src/types/review-entry.ts src/types/sync.ts
git commit -m "types: add ReviewEntry, expand SyncRun for direction"
```

---

## Task 3: Apps Script — `backfillIds()` and `doPost()`

**Files:**
- Create: `apps-script/Code.gs` (source-controlled copy for reference)

The Apps Script is installed inside Google Sheets, not deployed from this repo. We keep a copy in `apps-script/` so the canonical source is in git.

- [ ] **Step 1: Create `apps-script/Code.gs`**

```javascript
// Brands Partner Forum — Sheet bridge
// Bound to the Google Sheet at id 1YufhZ3Wpq8vUdZhmTX96-3w4KrAQm8roXDJncXvf0wk.
//
// Responsibilities (Phase 1):
//   - backfillIds(): one-shot, fills column A with UUIDs for all existing rows
//   - doPost():      receives row updates from the push-to-sheet Edge Function
//                    and writes them back into the sheet
//
// Phase 2 will add an onEdit() installable trigger and reverse-sync POST.

var SHEET_NAME = 'Sheet1'; // operator: change if the data tab is named differently
var ID_COLUMN = 1;         // column A
var SYNC_TAG_COLUMN = 35;  // column AI = column A (id) + 33 data columns + 1

var SHARED_SECRET = 'REPLACE_ME_WITH_APPS_SCRIPT_SHARED_SECRET';

// Order MUST match the DB column order used in push-to-sheet/index.ts ENTRY_FIELDS.
var ENTRY_FIELDS = [
  'agent', 'account', 'country', 'proxy_used', 'email', 'password',
  'account_name', 'account_surname',
  'process', 'details', 'brand',
  'status_date', 'score_added', 'trustpilot_date', 'profile_url', 'review_status',
  'redirection_search_engine', 'redirection_word', 'review_language',
  'register_from_google', 'leaving_review_after_email', 'sticky_ip_mobile',
  'photo_in_account', 'device', 'opening_via_useful', 'opening_via_register',
  'scrolling_hovering', 'smart_paste', 'mentioning_time_frames',
  'mentioning_amounts', 'mentioning_agent_name', 'review_length', 'native_language'
];

function backfillIds() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);

  // Idempotency: only insert/seed the id column if it's not already there.
  var firstHeader = sheet.getRange(1, ID_COLUMN).getValue();
  if (firstHeader !== 'id') {
    // Shift all existing data right by one column to make room for the id column.
    sheet.insertColumnsBefore(ID_COLUMN, 1);
    sheet.getRange(1, ID_COLUMN).setValue('id');
  }

  // Ensure the last_sync_tag header exists at SYNC_TAG_COLUMN.
  var syncHeader = sheet.getRange(1, SYNC_TAG_COLUMN).getValue();
  if (syncHeader !== 'last_sync_tag') {
    sheet.getRange(1, SYNC_TAG_COLUMN).setValue('last_sync_tag');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
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
  Logger.log('Backfilled %s UUIDs', changed);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
    }
    var op = body.op;
    if (op === 'upsert_row') return handleUpsertRow(body);
    return jsonResponse({ ok: false, error: 'unknown op: ' + op }, 400);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}

function handleUpsertRow(body) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  var rowId = body.sheet_row_id;
  var fields = body.fields || {};
  var syncTag = body.sync_tag;
  if (!rowId) return jsonResponse({ ok: false, error: 'sheet_row_id required' }, 400);

  var rowIdx = findRowById(sheet, rowId);
  if (rowIdx === -1) {
    rowIdx = sheet.getLastRow() + 1;
    sheet.getRange(rowIdx, ID_COLUMN).setValue(rowId);
  }

  for (var i = 0; i < ENTRY_FIELDS.length; i++) {
    var fieldName = ENTRY_FIELDS[i];
    if (Object.prototype.hasOwnProperty.call(fields, fieldName)) {
      var col = ID_COLUMN + 1 + i; // data starts in column B
      sheet.getRange(rowIdx, col).setValue(fields[fieldName] == null ? '' : fields[fieldName]);
    }
  }
  if (syncTag) {
    sheet.getRange(rowIdx, SYNC_TAG_COLUMN).setValue(syncTag);
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

function jsonResponse(obj, status) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 2: Install the script in the Google Sheet**

1. Open the Sheet at https://docs.google.com/spreadsheets/d/1YufhZ3Wpq8vUdZhmTX96-3w4KrAQm8roXDJncXvf0wk/edit
2. **Extensions → Apps Script** — opens the bound script editor.
3. Delete any boilerplate code in `Code.gs`. Paste the contents of `apps-script/Code.gs` from the repo.
4. **Replace `REPLACE_ME_WITH_APPS_SCRIPT_SHARED_SECRET`** with a fresh secret string. Generate one in a PowerShell terminal:
   ```powershell
   [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
   ```
   Save the secret — it'll go into Supabase function secrets in Task 6.
5. **Confirm the sheet tab name** matches `SHEET_NAME` in the script (default `Sheet1`). The original Sheet has gid `1713728328` for the data tab — open the Sheet, click that tab, note its actual name, and update `SHEET_NAME` if different.
6. **Save** the script (Ctrl+S).
7. Click **Run** with `backfillIds` selected from the dropdown. Approve the OAuth prompt when asked (script runs as your Google account; needed once). Wait for "Execution completed".
8. Switch back to the Sheet — verify column A on all 54 rows now contains UUIDs.

- [ ] **Step 3: Deploy as Web App**

In the Apps Script editor:
1. Click **Deploy → New deployment**.
2. Gear icon → **Web app**.
3. Description: `push-to-sheet bridge v1`.
4. Execute as: **Me** (your Google account).
5. Who has access: **Anyone**. (The shared secret in POST body provides auth.)
6. Click **Deploy**. Authorize again if prompted.
7. **Copy the Web App URL** — looks like `https://script.google.com/macros/s/AKfycb.../exec`. Save it. It goes into Supabase secrets in Task 6.

- [ ] **Step 4: Smoke-test the deployment**

In PowerShell:

```powershell
$secret = '<the secret you generated>'
$url = '<the Web App URL>'
$body = @{
  secret = $secret
  op = 'upsert_row'
  sheet_row_id = 'smoke-test-fake-id'
  fields = @{ agent = 'SMOKE'; brand = 'Test Brand' }
  sync_tag = 'smoke-tag-1'
} | ConvertTo-Json -Compress
Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json' -Body $body
```

Expected response: `@{ok=$true; row=56}` (or similar — row number = first empty row after 54 + 1 header). Verify in the Sheet: a new row appears with `smoke-test-fake-id` in column A, `SMOKE` in column B, and `Test Brand` in column L (brand position).

After verifying, **delete that test row** from the Sheet.

- [ ] **Step 5: Commit**

```powershell
git add apps-script/Code.gs
git commit -m "apps-script: add backfillIds and doPost handler for sheet writes"
```

---

## Task 4: Edge Function — `initial-import`

**Files:**
- Create: `supabase/functions/initial-import/index.ts`

- [ ] **Step 1: Create `supabase/functions/initial-import/index.ts`**

```typescript
// Supabase Edge Function: initial-import
//
// One-shot: fetches the published CSV of the source Google Sheet and bulk-upserts
// rows into public.review_entries. Run this once during cutover, after the
// Apps Script backfillIds() has populated column A with UUIDs.
//
// Required secrets:
//   SUPABASE_URL                — runtime
//   SUPABASE_SERVICE_ROLE_KEY   — runtime
//   SHEET_CSV_URL               — published CSV URL

// @ts-expect-error: Deno-only import resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: { env: { get(name: string): string | undefined }; serve: (h: (r: Request) => Response | Promise<Response>) => void };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CSV_URL = Deno.env.get('SHEET_CSV_URL')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Sheet header → DB column. Exact match (case-sensitive after trim).
const HEADER_TO_COLUMN: Record<string, string> = {
  'id': 'sheet_row_id',
  'Agent': 'agent',
  'Account': 'account',
  'Country': 'country',
  'Proxy Used': 'proxy_used',
  'Email': 'email',
  'Password': 'password',
  'Account Name': 'account_name',
  'Account Surname': 'account_surname',
  'Process': 'process',
  'Details': 'details',
  'Brand / TP URL PAGE': 'brand',
  'Removed / Not Published / stil published date': 'status_date',
  'Score added': 'score_added',
  'Trust Pilot': 'trustpilot_date',
  'Link to the profile': 'profile_url',
  'Review Status': 'review_status',
  'Redirection from Search Engine (which one?)': 'redirection_search_engine',
  'Redirection Word used (Casino, Trustpilot)': 'redirection_word',
  'Reveiw Language': 'review_language',
  'Register from Google acount': 'register_from_google',
  'Leaving Review After redirected from  welcome Email': 'leaving_review_after_email',
  'Sticky IP (Mobile) (Y/N)': 'sticky_ip_mobile',
  'Photo in Account?': 'photo_in_account',
  'Mobile or deskstop ?': 'device',
  'Opening the account via "usefull"': 'opening_via_useful',
  'Opening the account via "Register" when leaving review': 'opening_via_register',
  'Scrolling and houvering?': 'scrolling_hovering',
  'Smart Paste?/ Paste as human typing?': 'smart_paste',
  'Mentioning time frames': 'mentioning_time_frames',
  'Mentioning Amounts?': 'mentioning_amounts',
  'Mentioning Agent name?': 'mentioning_agent_name',
  'Short review  / Long': 'review_length',
  '`Native Language?': 'native_language',
};

const DATE_COLUMNS = new Set(['status_date', 'trustpilot_date']);
const INT_COLUMNS = new Set(['score_added']);

Deno.serve(async () => {
  const { data: runRow, error: startErr } = await admin
    .from('sync_runs')
    .insert({ direction: 'initial_import', status: 'running' })
    .select('id')
    .single();
  if (startErr) {
    return json({ ok: false, error: startErr.message }, 500);
  }
  const runId = runRow!.id as string;

  try {
    const csv = await fetchCsv(CSV_URL);
    const rows = parseCsv(csv);
    if (rows.length < 2) throw new Error('CSV had no data rows');

    const header = rows[0];
    const mapped: Array<Record<string, unknown>> = [];
    let skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = sheetRowToEntry(header, rows[i]);
      if (!row || !row.sheet_row_id) {
        skipped++;
        continue;
      }
      mapped.push(row);
    }

    if (mapped.length === 0) throw new Error('No rows mapped — check column A is populated by backfillIds()');

    const { error: upsertErr } = await admin
      .from('review_entries')
      .upsert(mapped, { onConflict: 'sheet_row_id' });
    if (upsertErr) throw upsertErr;

    await admin.from('sync_runs').update({
      finished_at: new Date().toISOString(),
      rows_seen: rows.length - 1,
      rows_upserted: mapped.length,
      rows_skipped: skipped,
      status: 'success',
    }).eq('id', runId);

    return json({ ok: true, rows_seen: rows.length - 1, rows_upserted: mapped.length, rows_skipped: skipped });
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

async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  return res.text();
}

// Minimal CSV parser — handles quoted fields with commas and escaped quotes.
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function sheetRowToEntry(header: string[], cols: string[]): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < header.length; i++) {
    const key = header[i].trim();
    const dbCol = HEADER_TO_COLUMN[key];
    if (!dbCol) continue;
    const raw = (cols[i] ?? '').trim();
    if (raw === '') {
      out[dbCol] = null;
    } else if (DATE_COLUMNS.has(dbCol)) {
      out[dbCol] = parseSheetDate(raw);
    } else if (INT_COLUMNS.has(dbCol)) {
      const n = parseInt(raw, 10);
      out[dbCol] = Number.isFinite(n) ? n : null;
    } else {
      out[dbCol] = raw;
    }
  }
  return out;
}

// Sheet dates are formatted DD/MM/YYYY. Convert to ISO 'YYYY-MM-DD' or null.
function parseSheetDate(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  return `${m[3]}-${mm}-${dd}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: Verify no syntax issues by checking the file imports**

This file uses Deno-only imports; `tsc` will flag them. That's expected. Confirm visually that the function is well-formed and self-contained.

- [ ] **Step 3: Commit**

```powershell
git add supabase/functions/initial-import/index.ts
git commit -m "feat: add initial-import Edge Function for one-shot CSV seed"
```

Deployment of this function happens in Task 6 alongside `push-to-sheet`.

---

## Task 5: Edge Function — `push-to-sheet`

**Files:**
- Create: `supabase/functions/push-to-sheet/index.ts`

- [ ] **Step 1: Create `supabase/functions/push-to-sheet/index.ts`**

```typescript
// Supabase Edge Function: push-to-sheet
//
// Receives a row update from the dashboard, applies it to public.review_entries,
// and relays the same change to the bound Apps Script Web App which writes the
// row back into the Google Sheet.
//
// Required secrets:
//   SUPABASE_URL                          — runtime
//   SUPABASE_SERVICE_ROLE_KEY             — runtime
//   APPS_SCRIPT_WEB_APP_URL               — the /exec URL from the deployment
//   APPS_SCRIPT_SHARED_SECRET             — must match SHARED_SECRET in Code.gs

// @ts-expect-error: Deno-only import resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: { env: { get(name: string): string | undefined }; serve: (h: (r: Request) => Response | Promise<Response>) => void };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SCRIPT_URL = Deno.env.get('APPS_SCRIPT_WEB_APP_URL')!;
const SCRIPT_SECRET = Deno.env.get('APPS_SCRIPT_SHARED_SECRET')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Order MUST match ENTRY_FIELDS in apps-script/Code.gs.
const ENTRY_FIELDS = [
  'agent', 'account', 'country', 'proxy_used', 'email', 'password',
  'account_name', 'account_surname',
  'process', 'details', 'brand',
  'status_date', 'score_added', 'trustpilot_date', 'profile_url', 'review_status',
  'redirection_search_engine', 'redirection_word', 'review_language',
  'register_from_google', 'leaving_review_after_email', 'sticky_ip_mobile',
  'photo_in_account', 'device', 'opening_via_useful', 'opening_via_register',
  'scrolling_hovering', 'smart_paste', 'mentioning_time_frames',
  'mentioning_amounts', 'mentioning_agent_name', 'review_length', 'native_language',
];

const FIELD_SET = new Set(ENTRY_FIELDS);

interface RequestBody {
  sheet_row_id: string;           // required: existing or new UUID
  fields: Record<string, unknown>; // any subset of ENTRY_FIELDS
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400);
  }
  if (!body.sheet_row_id || typeof body.sheet_row_id !== 'string') {
    return json({ ok: false, error: 'sheet_row_id required' }, 400);
  }

  // Filter fields to known columns only — silently drop anything else.
  const cleanFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body.fields ?? {})) {
    if (FIELD_SET.has(k)) cleanFields[k] = v === '' ? null : v;
  }

  const syncTag = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const { data: runRow, error: runErr } = await admin
    .from('sync_runs')
    .insert({ direction: 'db_to_sheet', status: 'running', payload_ref: body.sheet_row_id })
    .select('id')
    .single();
  if (runErr) return json({ ok: false, error: runErr.message }, 500);
  const runId = runRow!.id as string;

  try {
    const { error: upsertErr } = await admin
      .from('review_entries')
      .upsert({
        sheet_row_id: body.sheet_row_id,
        ...cleanFields,
        updated_at: nowIso,
        last_edited_by: 'dashboard',
        last_sync_tag: syncTag,
      }, { onConflict: 'sheet_row_id' });
    if (upsertErr) throw upsertErr;

    const scriptRes = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: SCRIPT_SECRET,
        op: 'upsert_row',
        sheet_row_id: body.sheet_row_id,
        fields: cleanFields,
        sync_tag: syncTag,
      }),
    });
    if (!scriptRes.ok) {
      const text = await scriptRes.text();
      throw new Error(`Apps Script ${scriptRes.status}: ${text}`);
    }

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

```powershell
git add supabase/functions/push-to-sheet/index.ts
git commit -m "feat: add push-to-sheet Edge Function relaying writes to Apps Script"
```

---

## Task 6: Deploy Edge Functions, set secrets, update env

**Files:**
- Modify: `.env.example`
- Modify: `src/lib/supabase.ts`

- [ ] **Step 1: Link the Supabase project**

```powershell
supabase link --project-ref krxnupmhfiduduvvlumc
```

Provide the database password when prompted (find it in Supabase dashboard → Project Settings → Database → Connection string).

- [ ] **Step 2: Set Edge Function secrets**

```powershell
supabase secrets set `
  SHEET_CSV_URL='https://docs.google.com/spreadsheets/d/e/2PACX-1vRDBr3PKhXUgVqjmxURLOOXjSW3Nf6OEA_ekoInoHD5Q8rglp9h0OTI9KpssUTdQTGNrfpPLvMIwgP7/pub?output=csv' `
  APPS_SCRIPT_WEB_APP_URL='<the /exec URL from Task 3 Step 3>' `
  APPS_SCRIPT_SHARED_SECRET='<the secret from Task 3 Step 2>'
```

Verify with `supabase secrets list`.

- [ ] **Step 3: Deploy both functions**

```powershell
supabase functions deploy initial-import
supabase functions deploy push-to-sheet
```

Each command should output a deployment URL. Note the `push-to-sheet` URL — needed for the frontend `.env`.

- [ ] **Step 4: Run `initial-import` once**

⚠️ **Wait first.** Google publish-to-web caches the CSV for up to ~5 minutes. After `backfillIds()` inserted the new column A, the published CSV may still serve the old (pre-backfill) version for a few minutes. Verify the CSV is current before running this step:

```powershell
Invoke-WebRequest -Uri 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRDBr3PKhXUgVqjmxURLOOXjSW3Nf6OEA_ekoInoHD5Q8rglp9h0OTI9KpssUTdQTGNrfpPLvMIwgP7/pub?output=csv' -OutFile current.csv
Get-Content current.csv -TotalCount 1
```

The first column of the first line must be `id`. If it's still `Agent`, wait 60 seconds and re-check.

Once `id` appears in the header:

```powershell
$anon = '<VITE_SUPABASE_ANON_KEY value from .env>'
Invoke-RestMethod `
  -Uri 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/initial-import' `
  -Method Post `
  -Headers @{ Authorization = "Bearer $anon" }
```

Expected response: `{ ok: true, rows_seen: 54, rows_upserted: 54, rows_skipped: 0 }` (or similar). Open Supabase Table Editor → `review_entries` — verify 54 rows present.

If `rows_upserted` is 0, the most likely cause is that the CSV cache hasn't refreshed yet (column A still says `Agent`, not `id`). Wait and re-run. If it persists, manually re-publish the Sheet: **File → Share → Publish to web → Stop publishing → re-publish** (forces a fresh URL with the same path).

- [ ] **Step 5: Smoke-test `push-to-sheet`**

Pick any `sheet_row_id` from the `review_entries` table.

```powershell
$anon = '<VITE_SUPABASE_ANON_KEY>'
$body = @{
  sheet_row_id = '<a real UUID from review_entries>'
  fields = @{ review_status = 'PUSH-TEST' }
} | ConvertTo-Json -Compress
Invoke-RestMethod `
  -Uri 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/push-to-sheet' `
  -Method Post `
  -ContentType 'application/json' `
  -Headers @{ Authorization = "Bearer $anon" } `
  -Body $body
```

Expected: `{ ok = $true; sync_tag = '<uuid>' }`. Verify:
1. The corresponding Sheet row now has `PUSH-TEST` in the Review Status column.
2. `review_entries.review_status` is `PUSH-TEST` in the DB.
3. `sync_runs` has a new `db_to_sheet` row with status `success`.

Reset the field back to its original value in the DB once verified.

- [ ] **Step 6: Replace `.env.example`**

```
# Vite (client-side, exposed to browser)
VITE_SUPABASE_URL=https://krxnupmhfiduduvvlumc.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU
VITE_PUSH_TO_SHEET_URL=https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/push-to-sheet

# Supabase Edge Function (server-side, never exposed)
# Set these via `supabase secrets set` for each function.
SHEET_CSV_URL=https://docs.google.com/spreadsheets/d/e/2PACX-1vRDBr3PKhXUgVqjmxURLOOXjSW3Nf6OEA_ekoInoHD5Q8rglp9h0OTI9KpssUTdQTGNrfpPLvMIwgP7/pub?output=csv
APPS_SCRIPT_WEB_APP_URL=<the /exec URL from Task 3>
APPS_SCRIPT_SHARED_SECRET=<the secret from Task 3>
```

- [ ] **Step 7: Update local `.env` (if exists)**

If `.env` exists, add `VITE_PUSH_TO_SHEET_URL`. Remove `VITE_SYNC_FUNCTION_URL`.

- [ ] **Step 8: Replace `src/lib/supabase.ts`**

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

- [ ] **Step 9: Commit**

```powershell
git add .env.example src/lib/supabase.ts
git commit -m "feat: wire Edge Function URLs, deploy initial-import and push-to-sheet"
```

---

## Task 7: Rewrite `src/lib/queries.ts`

**Files:**
- Modify: `src/lib/queries.ts` (full rewrite)

- [ ] **Step 1: Replace `src/lib/queries.ts`**

```typescript
import { supabase } from './supabase';
import type { ReviewEntry, ReviewEntryDraft } from '../types/review-entry';
import type { SyncRun } from '../types/sync';

export async function fetchEntries(limit = 200): Promise<ReviewEntry[]> {
  const { data, error } = await supabase
    .from('review_entries')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ReviewEntry[];
}

export async function fetchEntryById(id: string): Promise<ReviewEntry | null> {
  const { data, error } = await supabase
    .from('review_entries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as ReviewEntry) ?? null;
}

export interface EntryCounts {
  total: number;
  published: number;
  removed: number;
  other: number;
}

export async function fetchEntryCounts(): Promise<EntryCounts> {
  const [total, pub, rem] = await Promise.all([
    supabase.from('review_entries').select('id', { count: 'exact', head: true }),
    supabase.from('review_entries').select('id', { count: 'exact', head: true }).eq('review_status', 'Published'),
    supabase.from('review_entries').select('id', { count: 'exact', head: true }).eq('review_status', 'Removed'),
  ]);
  if (total.error) throw total.error;
  if (pub.error) throw pub.error;
  if (rem.error) throw rem.error;
  const t = total.count ?? 0;
  const p = pub.count ?? 0;
  const r = rem.count ?? 0;
  return { total: t, published: p, removed: r, other: Math.max(0, t - p - r) };
}

export async function fetchSyncRuns(limit = 20): Promise<SyncRun[]> {
  const { data, error } = await supabase
    .from('sync_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SyncRun[];
}

// Used by EntryNew to pre-generate the sheet_row_id client-side so that the
// push-to-sheet round-trip writes both DB and Sheet in one call.
export function newSheetRowId(): string {
  return crypto.randomUUID();
}

export type EntrySaveInput = ReviewEntryDraft;
```

- [ ] **Step 2: Compile check**

```powershell
npx tsc --noEmit
```

Expected: errors only in files that import the deleted `Mention` type or call removed functions. Note them — Task 9–17 fix each one.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/queries.ts
git commit -m "feat: rewrite queries for review_entries data model"
```

---

## Task 8: Create `src/lib/sheet-bridge.ts`

**Files:**
- Create: `src/lib/sheet-bridge.ts`

- [ ] **Step 1: Create `src/lib/sheet-bridge.ts`**

```typescript
import { PUSH_TO_SHEET_URL, SUPABASE_ANON_KEY } from './supabase';
import type { ReviewEntryDraft } from '../types/review-entry';

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
  sheet_row_id: string,
  fields: Partial<ReviewEntryDraft>,
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
    body: JSON.stringify({ sheet_row_id, fields }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; sync_tag?: string; error?: string };
  if (!res.ok || !body.ok || !body.sync_tag) {
    throw new SheetSyncError(body.error ?? `push-to-sheet ${res.status}`, res.status);
  }
  return { ok: true, sync_tag: body.sync_tag };
}
```

- [ ] **Step 2: Commit**

```powershell
git add src/lib/sheet-bridge.ts
git commit -m "feat: add sheet-bridge client for push-to-sheet Edge Function"
```

---

## Task 9: Update navigation (Sidebar + Topbar + App routes)

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Topbar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace `src/components/Sidebar.tsx`**

```typescript
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, RefreshCw, MessagesSquare, ListChecks, Plus } from 'lucide-react';

const links = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/entries', label: 'Entries', icon: ListChecks, end: false },
  { to: '/entries/new', label: 'New entry', icon: Plus, end: true },
  { to: '/sync', label: 'Sync Status', icon: RefreshCw, end: false },
];

export default function Sidebar() {
  return (
    <aside className="hidden md:flex md:w-60 flex-col bg-slate-900 text-slate-100">
      <div className="px-5 py-5 flex items-center gap-2 border-b border-slate-800">
        <MessagesSquare className="size-5 text-brand-500" />
        <span className="font-semibold tracking-tight">Brands Partner Forum</span>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
              ].join(' ')
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 text-xs text-slate-500 border-t border-slate-800">
        Internal · v0.1
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Replace `src/components/Topbar.tsx`**

```typescript
import { useLocation } from 'react-router-dom';

const titles: Record<string, string> = {
  '/': 'Overview',
  '/entries': 'Entries',
  '/entries/new': 'New entry',
  '/sync': 'Sync Status',
};

export default function Topbar() {
  const { pathname } = useLocation();
  let title = titles[pathname];
  if (!title) {
    if (pathname.startsWith('/entries/')) title = 'Entry detail';
    else title = 'Brands Partner Forum';
  }

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between">
      <h1 className="text-base font-semibold text-slate-800">{title}</h1>
      <div className="text-xs text-slate-500">dailytwists internal</div>
    </header>
  );
}
```

- [ ] **Step 3: Replace `src/App.tsx`**

```typescript
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Overview from './pages/Overview';
import EntriesList from './pages/EntriesList';
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
            <Route path="/entries" element={<EntriesList />} />
            <Route path="/entries/new" element={<EntryNew />} />
            <Route path="/entries/:id" element={<EntryDetail />} />
            <Route path="/sync" element={<SyncStatus />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Compile (will fail — pages don't exist yet)**

```powershell
npx tsc --noEmit
```

Expected: errors for missing `EntriesList`, `EntryDetail`, `EntryNew`. Acceptable until Task 12–14.

- [ ] **Step 5: Commit**

```powershell
git add src/components/Sidebar.tsx src/components/Topbar.tsx src/App.tsx
git commit -m "feat: route to entries pages, update nav for ops tool"
```

---

## Task 10: `MaskedField` and `EntryForm` components

**Files:**
- Create: `src/components/MaskedField.tsx`
- Create: `src/components/EntryForm.tsx`

- [ ] **Step 1: Create `src/components/MaskedField.tsx`**

```typescript
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'password' | 'email';
}

export default function MaskedField({ label, name, value, onChange, type = 'password' }: Props) {
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
          autoComplete={type === 'email' ? 'off' : 'new-password'}
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

- [ ] **Step 2: Create `src/components/EntryForm.tsx`**

```typescript
import { useState } from 'react';
import MaskedField from './MaskedField';
import type { ReviewEntryDraft } from '../types/review-entry';

type FieldKey = keyof ReviewEntryDraft;

interface Section {
  title: string;
  fields: { key: FieldKey; label: string; type?: 'text' | 'date' | 'number' | 'email' | 'password' | 'textarea' }[];
}

const SECTIONS: Section[] = [
  { title: 'Identity', fields: [
    { key: 'agent', label: 'Agent' },
    { key: 'account', label: 'Account' },
    { key: 'country', label: 'Country' },
    { key: 'proxy_used', label: 'Proxy Used' },
  ]},
  { title: 'Credentials', fields: [
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'password', label: 'Password', type: 'password' },
  ]},
  { title: 'Names', fields: [
    { key: 'account_name', label: 'Account Name' },
    { key: 'account_surname', label: 'Account Surname' },
  ]},
  { title: 'Process', fields: [
    { key: 'process', label: 'Process' },
    { key: 'details', label: 'Details' },
    { key: 'brand', label: 'Brand / TP URL PAGE' },
  ]},
  { title: 'Status', fields: [
    { key: 'review_status', label: 'Review Status' },
    { key: 'status_date', label: 'Status Date', type: 'date' },
    { key: 'trustpilot_date', label: 'Trust Pilot Date', type: 'date' },
    { key: 'profile_url', label: 'Profile URL' },
    { key: 'score_added', label: 'Score Added', type: 'number' },
  ]},
  { title: 'Redirection & language', fields: [
    { key: 'redirection_search_engine', label: 'Redirection from Search Engine' },
    { key: 'redirection_word', label: 'Redirection Word' },
    { key: 'review_language', label: 'Review Language' },
    { key: 'native_language', label: 'Native Language?' },
  ]},
  { title: 'Behaviour flags', fields: [
    { key: 'register_from_google', label: 'Register from Google account' },
    { key: 'leaving_review_after_email', label: 'Leaving review after welcome email' },
    { key: 'sticky_ip_mobile', label: 'Sticky IP (Mobile)' },
    { key: 'photo_in_account', label: 'Photo in account?' },
    { key: 'device', label: 'Mobile or desktop?' },
    { key: 'opening_via_useful', label: 'Opening via "useful"' },
    { key: 'opening_via_register', label: 'Opening via "Register" when leaving review' },
    { key: 'scrolling_hovering', label: 'Scrolling and hovering?' },
    { key: 'smart_paste', label: 'Smart paste / Paste as human typing?' },
  ]},
  { title: 'Review content', fields: [
    { key: 'review_length', label: 'Short / Long' },
    { key: 'mentioning_time_frames', label: 'Mentioning time frames' },
    { key: 'mentioning_amounts', label: 'Mentioning amounts?' },
    { key: 'mentioning_agent_name', label: 'Mentioning agent name?' },
  ]},
];

export interface EntryFormProps {
  initial: Partial<ReviewEntryDraft>;
  onSave: (draft: ReviewEntryDraft) => Promise<void>;
  saving: boolean;
  saveLabel?: string;
}

function toFormState(initial: Partial<ReviewEntryDraft>): Record<FieldKey, string> {
  const out = {} as Record<FieldKey, string>;
  for (const section of SECTIONS) {
    for (const f of section.fields) {
      const v = initial[f.key];
      out[f.key] = v == null ? '' : String(v);
    }
  }
  return out;
}

function fromFormState(state: Record<FieldKey, string>): ReviewEntryDraft {
  const out = {} as ReviewEntryDraft;
  for (const section of SECTIONS) {
    for (const f of section.fields) {
      const raw = state[f.key];
      if (raw === '') {
        // assign null to nullable fields
        (out as Record<string, unknown>)[f.key] = null;
      } else if (f.type === 'number') {
        const n = Number(raw);
        (out as Record<string, unknown>)[f.key] = Number.isFinite(n) ? n : null;
      } else {
        (out as Record<string, unknown>)[f.key] = raw;
      }
    }
  }
  return out;
}

export default function EntryForm({ initial, onSave, saving, saveLabel = 'Save' }: EntryFormProps) {
  const [state, setState] = useState(() => toFormState(initial));
  const setField = (k: FieldKey, v: string) => setState((prev) => ({ ...prev, [k]: v }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(fromFormState(state));
      }}
      className="space-y-8"
    >
      {SECTIONS.map((section) => (
        <fieldset key={section.title} className="rounded-lg border border-slate-200 bg-white p-5">
          <legend className="text-sm font-semibold text-slate-700 px-2">{section.title}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {section.fields.map((f) => {
              if (f.type === 'password' || f.type === 'email') {
                return (
                  <MaskedField
                    key={f.key}
                    label={f.label}
                    name={f.key}
                    type={f.type}
                    value={state[f.key]}
                    onChange={(v) => setField(f.key, v)}
                  />
                );
              }
              return (
                <label key={f.key} className="flex flex-col gap-1 text-sm">
                  <span className="text-slate-600">{f.label}</span>
                  <input
                    name={f.key}
                    type={f.type ?? 'text'}
                    value={state[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="flex justify-end gap-3">
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

```powershell
git add src/components/MaskedField.tsx src/components/EntryForm.tsx
git commit -m "feat: add EntryForm and MaskedField for ops editor"
```

---

## Task 11: `EntriesTable` component

**Files:**
- Create: `src/components/EntriesTable.tsx`

- [ ] **Step 1: Create `src/components/EntriesTable.tsx`**

```typescript
import { Link } from 'react-router-dom';
import type { ReviewEntry } from '../types/review-entry';

export interface EntriesTableProps {
  rows: ReviewEntry[];
}

export default function EntriesTable({ rows }: EntriesTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No entries yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Agent</th>
            <th className="px-4 py-2">Brand</th>
            <th className="px-4 py-2">Country</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Trustpilot date</th>
            <th className="px-4 py-2">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="px-4 py-2">
                <Link to={`/entries/${r.id}`} className="text-brand-700 hover:underline">
                  {r.agent ?? '—'}
                </Link>
              </td>
              <td className="px-4 py-2">{r.brand ?? '—'}</td>
              <td className="px-4 py-2">{r.country ?? '—'}</td>
              <td className="px-4 py-2">{r.review_status ?? '—'}</td>
              <td className="px-4 py-2">{r.trustpilot_date ?? '—'}</td>
              <td className="px-4 py-2 text-slate-500">{new Date(r.updated_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
git add src/components/EntriesTable.tsx
git commit -m "feat: add EntriesTable for list view"
```

---

## Task 12: `EntriesList` page

**Files:**
- Create: `src/pages/EntriesList.tsx`

- [ ] **Step 1: Create `src/pages/EntriesList.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EntriesTable from '../components/EntriesTable';
import { fetchEntries } from '../lib/queries';
import type { ReviewEntry } from '../types/review-entry';

export default function EntriesList() {
  const [rows, setRows] = useState<ReviewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEntries()
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">All entries</h2>
        <Link
          to="/entries/new"
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          New entry
        </Link>
      </div>
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && <EntriesTable rows={rows} />}
    </div>
  );
}
```

- [ ] **Step 2: Compile check**

```powershell
npx tsc --noEmit
```

The errors from Task 7 in this file (if any) should now be resolved. Note any remaining unrelated errors.

- [ ] **Step 3: Commit**

```powershell
git add src/pages/EntriesList.tsx
git commit -m "feat: add EntriesList page"
```

---

## Task 13: `EntryDetail` page

**Files:**
- Create: `src/pages/EntryDetail.tsx`

- [ ] **Step 1: Create `src/pages/EntryDetail.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import EntryForm from '../components/EntryForm';
import { fetchEntryById } from '../lib/queries';
import { pushEntryToSheet } from '../lib/sheet-bridge';
import type { ReviewEntry, ReviewEntryDraft } from '../types/review-entry';

export default function EntryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<ReviewEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchEntryById(id)
      .then((e) => {
        setEntry(e);
        if (!e) setError('Entry not found');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave(draft: ReviewEntryDraft) {
    if (!entry) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      await pushEntryToSheet(entry.sheet_row_id, draft);
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
  if (!entry) return null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/entries" className="text-sm text-slate-500 hover:underline">← All entries</Link>
          <h2 className="text-lg font-semibold text-slate-800 mt-1">
            {entry.agent ?? 'Untitled'} · {entry.brand ?? 'Unknown brand'}
          </h2>
          <p className="text-xs text-slate-500">
            Last updated {new Date(entry.updated_at).toLocaleString()} ({entry.last_edited_by})
          </p>
        </div>
        <button
          onClick={() => navigate('/entries')}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          Close
        </button>
      </div>
      {status && <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{status}</div>}
      {error && entry && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <EntryForm initial={entry} onSave={handleSave} saving={saving} saveLabel="Save & sync" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
git add src/pages/EntryDetail.tsx
git commit -m "feat: add EntryDetail page with save + push-to-sheet"
```

---

## Task 14: `EntryNew` page

**Files:**
- Create: `src/pages/EntryNew.tsx`

- [ ] **Step 1: Create `src/pages/EntryNew.tsx`**

```typescript
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import EntryForm from '../components/EntryForm';
import { newSheetRowId } from '../lib/queries';
import { pushEntryToSheet } from '../lib/sheet-bridge';
import type { ReviewEntryDraft } from '../types/review-entry';
import { supabase } from '../lib/supabase';

export default function EntryNew() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(draft: ReviewEntryDraft) {
    setSaving(true);
    setError(null);
    const rowId = newSheetRowId();
    try {
      await pushEntryToSheet(rowId, draft);
      // Look up the newly-created row's DB id so we can navigate to its detail page.
      const { data, error: lookupErr } = await supabase
        .from('review_entries')
        .select('id')
        .eq('sheet_row_id', rowId)
        .maybeSingle();
      if (lookupErr) throw lookupErr;
      if (data?.id) navigate(`/entries/${data.id}`);
      else navigate('/entries');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link to="/entries" className="text-sm text-slate-500 hover:underline">← All entries</Link>
        <h2 className="text-lg font-semibold text-slate-800 mt-1">New entry</h2>
      </div>
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <EntryForm initial={{}} onSave={handleSave} saving={saving} saveLabel="Create & sync" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
git add src/pages/EntryNew.tsx
git commit -m "feat: add EntryNew page for creating entries"
```

---

## Task 15: Rewrite `Overview` page (counter strip only)

**Files:**
- Modify: `src/pages/Overview.tsx` (full rewrite)

- [ ] **Step 1: Replace `src/pages/Overview.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchEntryCounts, fetchEntries } from '../lib/queries';
import type { EntryCounts } from '../lib/queries';
import type { ReviewEntry } from '../types/review-entry';
import KpiCard from '../components/KpiCard';
import EntriesTable from '../components/EntriesTable';

export default function Overview() {
  const [counts, setCounts] = useState<EntryCounts | null>(null);
  const [recent, setRecent] = useState<ReviewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchEntryCounts(), fetchEntries(10)])
      .then(([c, r]) => {
        setCounts(c);
        setRecent(r);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total entries" value={counts?.total ?? 0} />
        <KpiCard label="Published" value={counts?.published ?? 0} />
        <KpiCard label="Removed" value={counts?.removed ?? 0} />
        <KpiCard label="Other / pending" value={counts?.other ?? 0} />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Recently updated</h2>
          <Link to="/entries" className="text-xs text-slate-500 hover:underline">View all →</Link>
        </div>
        <EntriesTable rows={recent} />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Read `src/components/KpiCard.tsx` to verify its prop shape**

```powershell
cat src/components/KpiCard.tsx
```

If `KpiCard` doesn't accept `{ label, value }` as plain props, adapt the Overview JSX to match its actual API. Most likely it does — confirm and continue.

- [ ] **Step 3: Commit**

```powershell
git add src/pages/Overview.tsx
git commit -m "feat: rewrite Overview with entry counters and recent list"
```

---

## Task 16: Update `SyncStatus` page

**Files:**
- Modify: `src/pages/SyncStatus.tsx` (full rewrite)

- [ ] **Step 1: Replace `src/pages/SyncStatus.tsx`**

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
                <td className="px-4 py-2 text-slate-500">{new Date(r.started_at).toLocaleString()}</td>
                <td className="px-4 py-2 text-slate-500">
                  {r.finished_at ? new Date(r.finished_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-2">{r.status}</td>
                <td className="px-4 py-2">
                  {r.rows_upserted ?? 0} / {r.rows_seen ?? 0}
                </td>
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

- [ ] **Step 2: Full compile check**

```powershell
npx tsc --noEmit
```

Expected: **zero errors**. If there are any, fix them inline before committing — the most likely culprits are unused imports left over from the old code or type mismatches against the new `SyncRun` shape.

- [ ] **Step 3: Commit**

```powershell
git add src/pages/SyncStatus.tsx
git commit -m "feat: rewrite SyncStatus with direction column for both flows"
```

---

## Task 17: Delete obsolete files

**Files:**
- Delete: `src/pages/MentionDetail.tsx`
- Delete: `src/components/MentionsTable.tsx`
- Delete: `src/types/mention.ts`
- Delete: `supabase/functions/sync-sheet/` (entire directory)

- [ ] **Step 1: Delete files**

```powershell
Remove-Item src/pages/MentionDetail.tsx
Remove-Item src/components/MentionsTable.tsx
Remove-Item src/types/mention.ts
Remove-Item -Recurse -Force supabase/functions/sync-sheet
```

- [ ] **Step 2: Search for any lingering references**

```powershell
# These should return nothing.
Select-String -Path src/**/*.ts*,supabase/**/* -Pattern 'MentionDetail|MentionsTable|sync-sheet|VITE_SYNC_FUNCTION_URL|mention\.ts' -List
```

If anything matches, open and fix that file.

- [ ] **Step 3: Final build verification**

```powershell
npm run build
```

Expected: clean build, `dist/` produced. Any errors must be fixed before continuing.

- [ ] **Step 4: Commit**

```powershell
git add -A
git commit -m "chore: remove obsolete mention/* and sync-sheet function"
```

---

## Task 18: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the "Data Model", "Architecture Rules", "Current Tasks" and "Recent Changes" sections of `CLAUDE.md` to reflect the new design**

Open `CLAUDE.md` and replace the relevant sections with:

```markdown
## Architecture Rules
- **Data flow:** Google Sheet ↔ Dashboard. Dashboard is the source of truth; edits in the dashboard call the `push-to-sheet` Edge Function which writes to the DB and relays to the bound Apps Script Web App, which updates the Sheet. Reverse sync (Sheet → DB) is Phase 2.
- **Initial seed:** `initial-import` Edge Function is run once at cutover to populate `review_entries` from the published Sheet CSV. Requires column A of the Sheet to contain UUIDs (run Apps Script `backfillIds()` first).
- **Auth:** none in app — Vercel password protection guards the deploy. Treat anon key as effectively public.
- **Data access:** all Supabase queries live in `src/lib/queries.ts`. The dashboard's write path goes through `src/lib/sheet-bridge.ts` → `push-to-sheet` Edge Function.
- **Routing:** React Router v7 declarative routes. Routes: `/`, `/entries`, `/entries/new`, `/entries/:id`, `/sync`.
- **Styling:** Tailwind v4 utility classes. No global CSS beyond `index.css` (resets, base tokens).

## Data Model
- `review_entries(id, sheet_row_id, agent, account, country, proxy_used, email, password, account_name, account_surname, process, details, brand, status_date, score_added, trustpilot_date, profile_url, review_status, redirection_search_engine, redirection_word, review_language, native_language, register_from_google, leaving_review_after_email, sticky_ip_mobile, photo_in_account, device, opening_via_useful, opening_via_register, scrolling_hovering, smart_paste, mentioning_time_frames, mentioning_amounts, mentioning_agent_name, review_length, updated_at, last_edited_by, last_sync_tag)`
- `sync_runs(id, direction, started_at, finished_at, rows_seen, rows_upserted, rows_skipped, status, error_message, payload_ref)`
- `sheet_row_id` matches column A of the Sheet (UUID). It is the idempotency key for upserts in both directions.
- Y/N-style fields are stored as `text` for now (mixed values in source data); promotion to `boolean` deferred.
```

Also update "Recent Changes" with a new dated entry, and replace "Current Tasks" to reflect the new phasing.

- [ ] **Step 2: Commit**

```powershell
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for ops-tool architecture"
```

---

## Task 19: End-to-end smoke test

**Files:** none — operator verification.

- [ ] **Step 1: Run dev server**

```powershell
npm run dev
```

Wait for "ready in N ms" output; open the URL in a browser.

- [ ] **Step 2: Overview page**

- Navigate to `/`. Counter strip shows 4 numbers (total + 3 statuses). Recent-updated table shows ~10 rows.

- [ ] **Step 3: Entries list**

- Click "Entries" in sidebar. All 54 rows render.
- Click any row. Detail page opens with all fields populated.

- [ ] **Step 4: Edit & sync round-trip**

- On the detail page, change `Review Status` to a sentinel value like `E2E-TEST-<timestamp>`.
- Click "Save & sync". Wait for green confirmation banner.
- Open the Google Sheet in another tab. Find the same row (match by `sheet_row_id` in column A) and verify the new value appears in the `Review Status` column.
- Reset the field back to its original value in the dashboard; verify the Sheet updates again.

- [ ] **Step 5: New entry**

- Click "New entry". Fill in at minimum: Agent, Account, Brand, Review Status, Trust Pilot date.
- Click "Create & sync". Browser should navigate to the new entry's detail page.
- Verify the new row appears at the bottom of the Sheet with a UUID in column A.
- Verify the row appears in the dashboard entries list.

- [ ] **Step 6: Sync status page**

- Navigate to `/sync`. Confirm at least 3 recent rows: one `initial_import` (success), and multiple `db_to_sheet` (success) corresponding to the saves above.

- [ ] **Step 7: Failure path**

- Briefly invalidate the `APPS_SCRIPT_WEB_APP_URL` secret (`supabase secrets set APPS_SCRIPT_WEB_APP_URL=https://bad.example.com/exec`).
- Try saving a row in the dashboard. Confirm red error banner appears with the failure message.
- Confirm `sync_runs` has a new `db_to_sheet` row with `status='error'`.
- Restore the correct secret and verify saves work again.

- [ ] **Step 8: Final commit (only if smoke test surfaced any tweaks)**

If the smoke test required any code adjustments, commit them now. Otherwise, no commit needed for this task.

```powershell
# Only if changes were made:
git status
git add -A
git commit -m "fix: smoke-test follow-ups"
```

---

## Self-Review Coverage Map

Mapping spec sections to plan tasks:

| Spec section | Task(s) |
|---|---|
| §3 Architecture (initial-import, push-to-sheet, Apps Script) | 3, 4, 5, 6 |
| §4 `review_entries` schema | 1 |
| §4 `sync_runs` schema (refined) | 1 |
| §4.1 Y/N as text (deferred) | 1 (schema), 2 (types) |
| §5 Hidden Sheet columns (id, last_sync_tag) | 3 (Apps Script SHEET_NAME / ID_COLUMN / SYNC_TAG_COLUMN) |
| §6.1 Initial import | 4, 6 |
| §6.2 Dashboard edit → DB → Sheet | 5, 8, 13 |
| §6.3 Sheet → DB (Phase 2 — deferred) | — |
| §6.4 Loop prevention (last_sync_tag column) | 3 (script writes tag), 5 (function generates tag) — full suppression activates in Phase 2 |
| §6.5 Reconciliation backstop (Phase 3 — deferred) | — |
| §7.1 Routes | 9 |
| §7.2 KPI Overview | 15 |
| §7.3 Entries table | 11, 12 |
| §7.4 Entry editor (all 33 fields sectioned) | 10, 13, 14 |
| §7.5 Sync status page | 16 |
| §9 Env / secrets | 6 |
| §10 Error handling (per-call, retries deferred) | 4, 5, 13 |
| §11 Testing (manual E2E) | 19 |
| §12 Migration / cutover | 1, 3, 4, 6, 19 |
| §13 Out of scope | — |

Phase 1 deliberately omits §6.3, §6.5, retry job, and the masked-field-only KPI charts. Those are Phase 2/3.
