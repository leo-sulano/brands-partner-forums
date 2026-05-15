# Brands Partner Forum — Multi-Tab Operational Tool Design

**Date:** 2026-05-15
**Status:** Design — awaiting user review
**Supersedes:** [2026-05-15-bidirectional-sync-ops-tool-design.md](2026-05-15-bidirectional-sync-ops-tool-design.md) (single-tab design)
**Background:** The original spec was based on a CSV from one tab (`TP Brand Injection`). On discovery that the spreadsheet has 6+ operational tabs with overlapping-but-divergent schemas (Rooster Partners includes `Casino Password`, `Backup Codes`, `Authenticator Backup`; other brand tabs differ further), the design pivots to a generic, tab-agnostic model.

---

## 1. Purpose

The dashboard becomes the team's primary interface for managing **multiple brand operations**, each tracked as its own Google Sheet tab. The Sheet remains a live mirror — edits round-trip in both directions. Each tab represents one brand-tracking workflow with its own column set.

## 2. In-Scope Operational Tabs (v1)

Configured in code as a constant list:

```typescript
export const OPERATIONAL_TABS = [
  'TP Brand Injection',
  'Rooster Partners',
  'Revolution Casino',
  'Trybet',
  'SilverPlay',
  'SuprPlay Limited',
] as const;
```

Adding a new tab later requires only updating this constant; the rest of the system adapts.

**Out of scope (v1):** reference/list tabs (`Links to FORUMS`, `New emails-Credentials`, `Hanan`, `HazEmirates UAE`, `REUSE...`). Those remain Sheet-only.

## 3. Architecture

```
┌─────────────────────────────┐
│  Dashboard (React)          │
│  ┌─────────────────────┐    │
│  │ Sidebar tab nav     │    │   /tabs/Rooster%20Partners
│  │ • TP Brand Injection│    │
│  │ • Rooster Partners  │←┐  │
│  │ • Revolution Casino │ │  │
│  │ • Trybet            │ │  │
│  │ • SilverPlay        │ │  │
│  │ • SuprPlay Limited  │ │  │
│  └─────────────────────┘ │  │
│  Each tab page:          │  │
│    list, detail/editor,  │  │
│    new entry             │  │
└────┬─────────────────────┴──┘
     │ POST {tab, sheet_row_id, fields}
     ▼
┌─────────────────────────────┐         ┌─────────────────────────────┐
│  Supabase                   │         │  Google Sheet               │
│  entries(                   │◀───────▶│  ┌─────┐ ┌──────┐ ...       │
│    id, tab, sheet_row_id,   │         │  │tab A│ │tab B │            │
│    data jsonb,              │         │  └─────┘ └──────┘            │
│    updated_at,              │         │                              │
│    last_edited_by,          │         │  Apps Script Web App         │
│    last_sync_tag            │         │   - doPost: write any tab    │
│  )                          │         │   - doGet:  list tabs +      │
│  tab_schemas(               │         │             headers          │
│    tab, columns jsonb)      │         │   - backfillAllTabIds()      │
│  sync_runs(...)             │         │                              │
└─────────────────────────────┘         └─────────────────────────────┘
```

**Components:**

- **`entries` table** — single, polymorphic, one row per Sheet row across all tabs. All column values live in `data jsonb`.
- **`tab_schemas` table** — captured column order/headers per tab, populated by the Apps Script on import. Used by the frontend to render forms in the right order with the right labels.
- **`sync_runs` table** — sync history (unchanged from prior design but adds optional `tab` column).
- **`import-tabs` Edge Function** — replaces single-tab `initial-import`. For each configured tab, fetches rows via the Apps Script `doGet` endpoint and bulk-upserts into `entries`. Also refreshes `tab_schemas`.
- **`push-to-sheet` Edge Function** — accepts `{ tab, sheet_row_id, fields }`. Updates `entries`, relays to Apps Script `doPost`.
- **Apps Script Web App (bound to the Sheet)** — three endpoints:
  - `doPost` with `op='upsert_row'`: writes a row into the named tab.
  - `doGet` with `op='dump'`: returns `{ tabs: [{ name, headers, rows }] }` for the configured tab list. Used by `import-tabs`.
  - `doGet` with `op='structure'`: returns `[{ name, headers }]` only. Used by the dashboard on load to render forms.
  - `backfillAllTabIds()` function: idempotently inserts `id` column (column A) and `last_sync_tag` column (column AI) into each configured tab and seeds UUIDs.

**Key architectural shift from prior design:** drop the published-to-web CSV mechanism. All Sheet→DB reads go through the Apps Script `doGet` endpoint. Live data, no caching, no per-tab publish step.

## 4. Data Model

### `entries`

```sql
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

create index entries_tab_idx on public.entries (tab);
create index entries_tab_updated_idx on public.entries (tab, updated_at desc);
create index entries_data_gin on public.entries using gin (data);
```

The `entries_data_gin` index supports general `data @>` lookups. If specific keys (e.g. `country`, `review_status`) become hot filters, add expression indexes on `(data->>'country')` etc.

### `tab_schemas`

```sql
create table public.tab_schemas (
  tab          text primary key,
  headers      jsonb not null,             -- string[] in order
  refreshed_at timestamptz not null default now()
);
```

Stores the column ordering for each tab so forms render in Sheet order. Refreshed every time `import-tabs` runs or the dashboard hits the `structure` endpoint.

### `sync_runs` (refined)

```sql
create table public.sync_runs (
  id             uuid primary key default gen_random_uuid(),
  direction      text not null check (direction in ('sheet_to_db','db_to_sheet','initial_import')),
  tab            text,                     -- nullable; null for cross-tab operations
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
```

## 5. Sheet Layout Per Tab

Apps Script `backfillAllTabIds()` ensures **each configured tab** has:

- **Column A — `id`**: UUID for every row (inserted as a new column shifting existing data right).
- **Column AI (35) — `last_sync_tag`**: UUID written on every `push-to-sheet` call; used for loop suppression in Phase 2.

For tabs with more than 33 data columns, `last_sync_tag` is placed at `lastDataColumn + 1` instead of a fixed column 35. The Apps Script computes this per tab.

## 6. Sync Flows

### 6.1 Initial import (`import-tabs`)

```
Edge Function: import-tabs
  ├─ Insert sync_runs row (direction='initial_import', tab=null)
  ├─ Call Apps Script doGet(op='dump', tabs=OPERATIONAL_TABS)
  │   → { tabs: [{ name, headers, rows: [[id,col1,col2,...], ...] }] }
  ├─ For each returned tab:
  │   ├─ Upsert tab_schemas (tab, headers)
  │   ├─ Build entries[] from rows using headers as keys for data
  │   └─ Bulk upsert into entries on (tab, sheet_row_id)
  └─ Update sync_runs row with totals
```

### 6.2 Dashboard edit → DB → Sheet

```
User saves a row on the editor page for some tab
  └─ POST /functions/v1/push-to-sheet { tab, sheet_row_id, fields }
        ├─ syncTag = uuid()
        ├─ Upsert into entries:
        │     INSERT (tab, sheet_row_id, data, updated_at, last_edited_by, last_sync_tag)
        │     ON CONFLICT (tab, sheet_row_id) DO UPDATE SET
        │       data = entries.data || excluded.data,    -- merge JSON
        │       updated_at, last_edited_by='dashboard', last_sync_tag=syncTag
        ├─ POST Apps Script Web App with { tab, sheet_row_id, fields, sync_tag }
        ├─ Apps Script writes the row in the named tab, stamps sync_tag in column AI
        └─ Update sync_runs (direction='db_to_sheet', tab=<tab>)
```

### 6.3 Sheet → DB (deferred to Phase 2)

Same mechanism as the prior single-tab design: Apps Script `onEdit` installable trigger detects which tab fired, POSTs `{ tab, sheet_row_id, fields, sheet_updated_at }` to `receive-from-sheet`. LWW via `updated_at`. Loop suppression via `last_sync_tag`.

### 6.4 Reconciliation backstop (deferred to Phase 3)

A scheduled function periodically re-fetches every configured tab via `doGet(op='dump')` and applies any drift to `entries` (LWW).

## 7. Frontend

### 7.1 Routes

| Route | Purpose |
|-------|---------|
| `/` | Cross-tab overview (KPIs aggregated across all tabs) |
| `/tabs/:tabName` | Entries list for one tab |
| `/tabs/:tabName/new` | New-entry form for one tab |
| `/tabs/:tabName/entries/:id` | Detail/editor for one entry |
| `/sync` | Sync status across all tabs |

`tabName` is URL-encoded (e.g. `Rooster%20Partners`).

### 7.2 Sidebar

```
Brands Partner Forum
─────────────────────
🏠 Overview
─────────────────────
TABS
  TP Brand Injection
▶ Rooster Partners        ← active
  Revolution Casino
  Trybet
  SilverPlay
  SuprPlay Limited
─────────────────────
🔄 Sync Status
```

Each tab entry links to `/tabs/<TabName>`.

### 7.3 Overview

Cross-tab KPIs:

- Total entries (sum across all tabs)
- Entries per tab (table or bar chart)
- Recently updated rows across tabs (table with tab column)
- Last successful sync timestamp

### 7.4 Tab entries list (`/tabs/:tabName`)

- Header: tab name + "+ New entry" button
- Table of rows in that tab. Columns: a curated subset based on `tab_schemas.headers` (first 5–6 columns), plus `updated_at`.
- Row click → detail editor.
- Future: filters/search (Phase 3).

### 7.5 Entry editor (`/tabs/:tabName/entries/:id`)

- Form built dynamically from `tab_schemas.headers[tabName]`.
- One input per column. **Field type:**
  - Headers matching `/password|backup|authenticator|secret|token/i` → masked input with reveal toggle.
  - All other headers → plain text input.
  - No date/number typing in v1 (everything text). Phase 3 can add per-column type metadata.
- Save button: POST to `push-to-sheet` with `{ tab, sheet_row_id, fields: { ...allFields } }`. Optimistic update, toast on result.
- The `id` and `last_sync_tag` columns are not editable in the form (skipped by the renderer).

### 7.6 New-entry form (`/tabs/:tabName/new`)

- Same as the editor, blank values.
- On save: dashboard generates a `sheet_row_id` (uuid v4 client-side), POSTs to `push-to-sheet`, then navigates to the new entry's detail.

### 7.7 Sync status (`/sync`)

- Table of last 50 `sync_runs` rows. Columns: direction, tab (nullable), started_at, finished_at, status, rows_upserted/seen, error.
- Manual "Re-import all tabs" button (calls `import-tabs`).

## 8. File Layout (high level)

```
supabase/
├── schema.sql                          # NEW (replaces prior single-tab schema)
└── functions/
    ├── import-tabs/index.ts            # NEW (replaces initial-import)
    └── push-to-sheet/index.ts          # REWRITE for multi-tab

apps-script/
└── Code.gs                             # REWRITE for multi-tab

src/
├── App.tsx                             # MODIFY (routes)
├── lib/
│   ├── tabs.ts                         # NEW (OPERATIONAL_TABS constant, sensitive-field heuristic)
│   ├── queries.ts                      # REWRITE (entries CRUD by tab)
│   ├── sheet-bridge.ts                 # MODIFY (takes tab parameter)
│   └── supabase.ts                     # MODIFY (PUSH_TO_SHEET_URL var name)
├── pages/
│   ├── Overview.tsx                    # REWRITE (cross-tab KPIs)
│   ├── TabEntriesList.tsx              # NEW (replaces EntriesList)
│   ├── EntryDetail.tsx                 # REWRITE (uses tab from URL, dynamic form)
│   ├── EntryNew.tsx                    # REWRITE (uses tab from URL, dynamic form)
│   └── SyncStatus.tsx                  # MODIFY (tab column, multi-tab)
├── components/
│   ├── Sidebar.tsx                     # REWRITE (tab list)
│   ├── Topbar.tsx                      # MODIFY
│   ├── DynamicEntryForm.tsx            # NEW (form built from headers)
│   ├── MaskedField.tsx                 # KEEP from prior plan
│   ├── EntriesTable.tsx                # NEW (generic columns)
│   ├── KpiCard.tsx                     # KEEP
│   └── (others retained as-is)
└── types/
    ├── entry.ts                        # NEW (Entry interface + helpers)
    ├── tab-schema.ts                   # NEW
    └── sync.ts                         # MODIFY (add tab column)
```

The previous single-tab files (`review-entry.ts`, the single-tab Edge Function `initial-import/`, single-tab Apps Script body) are replaced. Git history retains them.

## 9. Secrets / Env

**Frontend (`.env`):**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PUSH_TO_SHEET_URL`
- `VITE_APPS_SCRIPT_URL` — needed for the dashboard to fetch `tab_schemas` via `doGet(op='structure')` (alternative: cache in DB and read from there to avoid extra round trip)

**Edge Functions (Supabase secrets):**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (runtime)
- `APPS_SCRIPT_WEB_APP_URL`
- `APPS_SCRIPT_SHARED_SECRET`

Removed: `SHEET_CSV_URL` (no longer needed — Apps Script `doGet` replaces it).

## 10. Security / Sensitive Fields

Per-column masking is driven by a heuristic on column-header text:

```typescript
const SENSITIVE_PATTERNS = /password|backup|authenticator|secret|token|2fa|otp/i;
function isSensitive(header: string): boolean { return SENSITIVE_PATTERNS.test(header); }
```

In the form, sensitive fields render as masked inputs with a reveal toggle (same `MaskedField` component as before, but applied based on header match rather than a hardcoded field name).

The DB stores sensitive values as plaintext (same threat model as before — anon key + Vercel password). RLS remains out of scope for v1.

## 11. Error Handling

- Every Edge Function call writes a `sync_runs` row.
- `push-to-sheet` failure to reach Apps Script: DB is already updated; return non-200; dashboard shows a "saved locally, sheet push failed" toast with a manual retry button (no automatic retry job in v1).
- `import-tabs` failure on one tab: skip that tab, continue with the others, mark `sync_runs.status='error'` with the failing tab in `payload_ref`.
- Apps Script handler exceptions: caught at the top, returned as JSON `{ ok: false, error }`.

## 12. Testing Strategy

- **Schema:** apply migration on the existing project (drop old `review_entries`, create `entries` + `tab_schemas`).
- **Apps Script:** install in the Sheet, run `backfillAllTabIds()`, verify column A and column AI for each configured tab.
- **End-to-end manual:**
  1. Run `import-tabs` → verify all 6 tabs appear in DB with rows.
  2. Edit a row in the dashboard → verify the corresponding row in the corresponding Sheet tab updates.
  3. Create a new row in a tab via dashboard → verify it appears at the bottom of the Sheet tab.
  4. Switch tabs in the sidebar → verify the entries list and editor adapt.
  5. Verify sensitive fields (Password, Casino Password, Backup Codes, Authenticator Backup) render masked.

## 13. Migration / Cutover Plan

1. Apply new `schema.sql` (drops `review_entries`/old `sync_runs`, creates `entries` + `tab_schemas` + new `sync_runs`).
2. Replace the Apps Script in the bound editor with the new multi-tab `Code.gs`. Update SHARED_SECRET. Run `backfillAllTabIds()` once — verify column A + AI populated on all 6 tabs.
3. Deploy two Edge Functions (`import-tabs`, `push-to-sheet`).
4. Set Supabase secrets (drop `SHEET_CSV_URL`, keep/update Apps Script ones).
5. Run `import-tabs` once → seeds DB from all 6 tabs.
6. Deploy frontend.
7. Team starts using the dashboard. Sheet edits still propagate to the dashboard only after Phase 2 ships.

## 14. Phasing

Same write-first priority as before:

- **Phase 1 — Writes end-to-end across tabs (MVP):**
  - New schema, Apps Script (`backfillAllTabIds`, `doPost`, `doGet`), `import-tabs`, `push-to-sheet`.
  - Frontend: tab nav, list, dynamic editor, new entry. Overview as a counter strip per tab.
  - No reverse sync. No retry job.
- **Phase 2 — Reverse sync (Sheet → DB):**
  - Apps Script `onEdit` per-tab.
  - `receive-from-sheet` Edge Function.
  - Loop suppression via `last_sync_tag`.
- **Phase 3 — Hardening & polish:**
  - Scheduled retry & reconciliation.
  - Filters/search on entries list.
  - Per-column type metadata (dates, numbers, enums).
  - Cross-tab analytics charts.

## 15. Out of Scope (v1)

- Reverse sync (Phase 2).
- Field type metadata beyond the sensitive-field heuristic.
- Bulk-edit UI.
- Reference tabs (Links to FORUMS, etc.).
- Per-tab access control.
- Adding/removing tabs via UI — tab list lives in code.
- Renaming a tab in the Sheet — would require manual DB migration of the `tab` column. Document as a "don't do this lightly" caveat.

## 16. Open Questions

None blocking. The biggest assumption is that the operational tabs all roughly fit the "one row = one tracked entity" pattern. If any tab is structured differently (e.g. summary rows, merged cells, multi-row entries), `backfillAllTabIds` and `doGet` may need per-tab handling — escalate during implementation if discovered.
