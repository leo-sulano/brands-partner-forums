# Brands Partner Forum — Operational Tool & Bidirectional Sync Design

**Date:** 2026-05-15
**Status:** Design — awaiting user review
**Supersedes (partially):** [2026-05-15-forums-dashboard-design.md](2026-05-15-forums-dashboard-design.md) — purpose, schema, and pages change; tech stack and project structure are retained.

---

## 1. Purpose

The dashboard becomes the team's primary interface for managing Trustpilot review-posting operations, replacing day-to-day Google Sheet usage. The Sheet remains as a live mirror — readable and editable — but the dashboard is the canonical UI.

The original "forum mentions" framing in [CLAUDE.md](../../../CLAUDE.md) and the prior design doc is discarded: the actual source data is a Trustpilot account/review tracker, not forum mentions.

## 2. Source Data

A single Google Sheet, currently 54 data rows, with 33 columns. Published to web as CSV at:

```
https://docs.google.com/spreadsheets/d/e/2PACX-1vRDBr3PKhXUgVqjmxURLOOXjSW3Nf6OEA_ekoInoHD5Q8rglp9h0OTI9KpssUTdQTGNrfpPLvMIwgP7/pub?output=csv
```

Columns (verbatim from row 1):

```
Agent, Account, Country, Proxy Used, Email, Password, Account Name, Account Surname,
Process, Details, Brand / TP URL PAGE, Removed / Not Published / still published date,
Score added, Trust Pilot, Link to the profile, Review Status,
Redirection from Search Engine (which one?), Redirection Word used (Casino, Trustpilot),
Review Language, Register from Google account,
Leaving Review After redirected from welcome Email, Sticky IP (Mobile) (Y/N),
Photo in Account?, Mobile or desktop?, Opening the account via "useful",
Opening the account via "Register" when leaving review, Scrolling and hovering?,
Smart Paste? / Paste as human typing?, Mentioning time frames, Mentioning Amounts?,
Mentioning Agent name?, Short review / Long, Native Language?
```

## 3. Architecture

```
┌──────────────────┐
│  Dashboard       │
│  (React/Vite)    │
└────┬─────────▲───┘
     │ write   │ read
     ▼         │
┌──────────────────┐         ┌──────────────────┐
│  Supabase        │         │  Google Sheet    │
│   - review_entries          │   (live mirror)  │
│   - sync_runs    │         │                  │
└─────▲────────┬───┘         └─────▲────────┬───┘
      │        │                    │        │
      │        │ Edge Fn:           │        │ onEdit trigger
      │        │ push-to-sheet      │        │
      │        └────POST JSON──────▶│        │
      │                            ┌─┴────────▼─┐
      │                            │ Apps Script│
      │                            │  Web App   │
      │                            │  (bound)   │
      │   Edge Fn:                 └─────┬──────┘
      └───receive-from-sheet ◀────POST──┘
```

**Components:**

- **`review_entries` table** — canonical store, one row per Sheet row, includes 33 column fields + bookkeeping.
- **`sync_runs` table** — kept from prior design; logs every sync event in both directions.
- **`push-to-sheet` Edge Function** — receives row-change events from the dashboard (or DB trigger), calls the Apps Script Web App to update the Sheet.
- **`receive-from-sheet` Edge Function** — accepts POSTs from the Apps Script `onEdit` trigger and applies changes to the DB with LWW conflict resolution.
- **`initial-import` Edge Function** — one-shot, reads published CSV, bulk-inserts all current rows. Used once during cutover.
- **Apps Script Web App** — bound to the Google Sheet, runs as the Sheet owner. Two responsibilities:
  1. Receive POSTs from `push-to-sheet` and write rows back into the Sheet.
  2. Listen for `onEdit` events and POST changed-row payloads to `receive-from-sheet`.

## 4. Data Model

### `review_entries`

```sql
create table review_entries (
  id              uuid primary key default gen_random_uuid(),
  sheet_row_id    text unique not null,        -- stable id stored in Sheet column A

  -- Identity / ops
  agent                 text,
  account               text,
  country               text,
  proxy_used            text,
  email                 text,                  -- masked in UI by default
  password              text,                  -- masked in UI by default
  account_name          text,
  account_surname       text,

  -- Process / classification
  process               text,
  details               text,
  brand                 text,                  -- "Brand / TP URL PAGE"

  -- Status / dates / scoring
  status_date           date,                  -- "Removed / Not Published / still published date"
  score_added           int,
  trustpilot_date       date,                  -- "Trust Pilot"
  profile_url           text,                  -- "Link to the profile"
  review_status         text,                  -- e.g. Published, Removed

  -- Redirection / language
  redirection_search_engine    text,
  redirection_word             text,
  review_language              text,
  native_language              text,           -- Y/N stored as text until normalization is confirmed

  -- Account/behaviour flags (Y/N stored as text — see §4.1)
  register_from_google         text,
  leaving_review_after_email   text,
  sticky_ip_mobile             text,
  photo_in_account             text,
  device                       text,           -- Mobile / Desktop
  opening_via_useful           text,
  opening_via_register         text,
  scrolling_hovering           text,
  smart_paste                  text,
  mentioning_time_frames       text,
  mentioning_amounts           text,
  mentioning_agent_name        text,
  review_length                text,           -- Short / Long

  -- Sync bookkeeping
  updated_at        timestamptz not null default now(),
  last_edited_by    text not null default 'dashboard',  -- 'dashboard' | 'sheet'
  last_sync_tag     text                                -- correlation id used for loop suppression
);

create index review_entries_brand_idx on review_entries (brand);
create index review_entries_agent_idx on review_entries (agent);
create index review_entries_country_idx on review_entries (country);
create index review_entries_status_idx on review_entries (review_status);
create index review_entries_updated_at_idx on review_entries (updated_at desc);
```

### `sync_runs` (refined from prior design)

```sql
create table sync_runs (
  id             uuid primary key default gen_random_uuid(),
  direction      text not null,            -- 'sheet_to_db' | 'db_to_sheet' | 'initial_import'
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  rows_seen      int,
  rows_upserted  int,
  rows_skipped   int,
  status         text not null default 'running',  -- 'running' | 'success' | 'error'
  error_message  text,
  payload_ref    text                       -- optional: row id(s) involved
);
```

### 4.1 Y/N column normalization (deferred)

The Sheet uses inconsistent values (`Yes`, `No`, blanks, occasional `Y`/`N`). Storing as `text` for v1 keeps imports lossless. A follow-up migration can promote these to `boolean` once we confirm every cell normalizes cleanly. Worth doing before users start filtering on them heavily.

## 5. Row Identity & Hidden Sheet Columns

Apps Script adds **two hidden columns** to the Sheet:

- **Column A — `id`**: stable row UUID. Used as `sheet_row_id` in the DB.
- **Column AH (or last column + 1) — `last_sync_tag`**: stamped with a fresh UUID on every `push-to-sheet` write. Used purely to suppress the `onEdit` loop (see §6.4). Not stored as a meaningful field in the DB; only the row's `last_sync_tag` bookkeeping column is updated transiently.

The Apps Script:

- On initial install: runs `backfillIds()`, filling column A with `crypto.randomUUID()` for all 54 existing rows.
- On new row insert (from Sheet UI or from `push-to-sheet`): assigns a UUID if column A is blank.

`sheet_row_id` matches column A. This survives row inserts, deletes, and reorderings.

## 6. Sync Flows

### 6.1 Initial import (one-time)

```
initial-import Edge Function
  ├─ Fetch CSV via published URL
  ├─ Parse rows
  ├─ For each row:
  │   ├─ If column-A id present: use as sheet_row_id
  │   └─ Else: error (sheet must be backfilled first via Apps Script)
  ├─ Bulk upsert into review_entries
  └─ Write sync_runs row (direction='initial_import')
```

Pre-step: run Apps Script's `backfillIds()` to populate column A for the 54 existing rows.

### 6.2 Dashboard edit → DB → Sheet

```
User saves row in dashboard
  └─ POST /functions/v1/push-to-sheet { sheet_row_id, fields, client_tag }
        ├─ Generate sync_tag (uuid)
        ├─ Update review_entries
        │     SET fields, updated_at = now(),
        │         last_edited_by = 'dashboard',
        │         last_sync_tag = sync_tag
        │     WHERE sheet_row_id = ?
        ├─ POST Apps Script Web App URL
        │     { sheet_row_id, fields, sync_tag }
        ├─ Apps Script writes row in Sheet,
        │     stores sync_tag in a hidden "Last Sync Tag" column
        └─ Write sync_runs (direction='db_to_sheet')
```

### 6.3 Sheet edit → DB

```
User edits cell in Sheet
  └─ onEdit trigger fires
        ├─ Read row's column-A id and all fields
        ├─ Read row's hidden "Last Sync Tag" column
        ├─ If the tag matches the most recent push-to-sheet call: ignore (loop suppression)
        ├─ Else POST /functions/v1/receive-from-sheet
        │     { sheet_row_id, fields, sheet_updated_at }
        └─ Edge Function:
              ├─ LWW: compare sheet_updated_at to review_entries.updated_at
              ├─ If sheet_updated_at >= db.updated_at: apply update
              ├─ Else: discard, log to sync_runs as skipped
              ├─ Set last_edited_by = 'sheet', clear last_sync_tag
              └─ Write sync_runs (direction='sheet_to_db')
```

### 6.4 Loop prevention details

The hidden "Last Sync Tag" column in the Sheet is the key mechanism:

- Every `push-to-sheet` call writes a fresh UUID into this column alongside the row data.
- The Apps Script `onEdit` handler checks: "did the user actually change content, or did my own write just trigger this?" If the only changed cell is the sync tag column (or the row's tag matches a recently-issued tag), skip the POST.
- A short in-memory cache in Apps Script (last 100 issued tags, 60-second TTL) handles the race where `onEdit` fires immediately after a `push-to-sheet` write.

### 6.5 Reconciliation backstop

`onEdit` can miss rapid bulk-paste events. A scheduled job (every 15 min) re-runs CSV fetch, diffs the public CSV against `review_entries`, and applies any drift to the DB with LWW semantics. Cheap insurance.

## 7. Frontend Changes

### 7.1 Routes (replacing current set)

| Route | Purpose |
|-------|---------|
| `/` | KPI overview |
| `/entries` | Filterable table of all entries |
| `/entries/new` | Blank form to add a row |
| `/entries/:id` | Detail view + editor for one row |
| `/sync` | Sync status (both directions, log of recent runs) |

The current `/mentions/:id` route is removed.

### 7.2 KPI Overview

Counters and charts driven by `review_entries`:

- Entries by `review_status` (Published / Removed / pending)
- Top brands by entry count
- Entries per agent
- Country distribution
- Recent activity (last 10 updated rows)

### 7.3 Entries table

- Columns: Agent, Brand, Country, Review Status, Trustpilot Date, last `updated_at`
- Filters: status, country, agent, brand
- Search by account / email / brand
- Click row → `/entries/:id`

### 7.4 Entry editor

Single form, all 33 fields grouped into sections:

- **Identity** (agent, account, country, proxy)
- **Credentials** (email, password — masked behind reveal button)
- **Names** (account name, surname)
- **Process** (process, details, brand)
- **Status** (review status, status date, trustpilot date, profile URL, score)
- **Redirection & language** (search engine, word, review language, native language)
- **Behaviour flags** (the 12-ish Y/N fields and device)
- **Review** (length, mentioning fields)

Save button: optimistic update + POST to `push-to-sheet`. Toast on success/failure. Disables while in-flight.

### 7.5 Sync status page

- Counters: last successful sync timestamp per direction
- Table of last 50 `sync_runs` rows, filterable by direction and status
- Manual "Re-import from Sheet" button (calls `initial-import`)

## 8. File-level Changes

```
supabase/
├── schema.sql                  # full rewrite for review_entries + sync_runs
└── functions/
    ├── initial-import/         # new — one-time CSV bulk import
    │   └── index.ts
    ├── push-to-sheet/          # new — DB → Apps Script
    │   └── index.ts
    ├── receive-from-sheet/     # new — Apps Script → DB
    │   └── index.ts
    ├── sync-sheet/             # DELETE (replaced by the three above)
    └── retry-pending-pushes/   # new — Scheduled Edge Function for retry backoff

src/
├── lib/
│   ├── queries.ts              # rewrite: review_entries CRUD
│   └── sheet-bridge.ts         # new: calls push-to-sheet
├── pages/
│   ├── Overview.tsx            # rewrite: new KPIs
│   ├── EntriesList.tsx         # new (replaces nothing)
│   ├── EntryDetail.tsx         # rewrite (replaces MentionDetail.tsx)
│   ├── EntryNew.tsx            # new
│   ├── SyncStatus.tsx          # update: show both directions
│   └── MentionDetail.tsx       # DELETE
├── components/
│   ├── MentionsTable.tsx       # DELETE
│   ├── EntriesTable.tsx        # new
│   ├── EntryForm.tsx           # new — the big 33-field form, sectioned
│   ├── MaskedField.tsx         # new — reveal/hide for password/email
│   ├── KpiCard.tsx             # keep
│   ├── TopList.tsx             # keep, retarget
│   ├── TimeSeriesChart.tsx     # keep, retarget (status over time, e.g.)
│   ├── StatusBadge.tsx         # keep
│   └── Toast.tsx               # keep
└── types/
    ├── review-entry.ts         # new
    ├── sync.ts                 # keep, expand direction enum
    └── mention.ts              # DELETE

apps-script/
└── Code.gs                     # new — bound to the Sheet, contains:
                                #   - backfillIds()
                                #   - doPost() handler for push-to-sheet
                                #   - onEdit() trigger for sheet→db
                                #   - sync tag tracking
```

## 9. Secrets / Env

**Frontend (`.env`):**
- `VITE_SUPABASE_URL` (kept)
- `VITE_SUPABASE_ANON_KEY` (kept)
- `VITE_PUSH_TO_SHEET_URL` — replaces `VITE_SYNC_FUNCTION_URL`

**Edge Functions (Supabase secrets):**
- `SUPABASE_URL` (runtime)
- `SUPABASE_SERVICE_ROLE_KEY` (runtime)
- `SHEET_CSV_URL` — for `initial-import` and reconciliation backstop
- `APPS_SCRIPT_WEB_APP_URL` — for `push-to-sheet`
- `RECEIVE_FROM_SHEET_SHARED_SECRET` — `receive-from-sheet` validates this header on POSTs from Apps Script

Removed (no longer needed): `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_RANGE`, `GOOGLE_SERVICE_ACCOUNT_JSON`.

## 10. Error Handling

- Every Edge Function writes a `sync_runs` row on entry; updates it on completion (success or failure).
- `push-to-sheet` failure to reach Apps Script: row is already updated in DB; return non-200; dashboard shows toast "Saved locally, Sheet sync failed — will retry". A **Supabase Scheduled Edge Function** (`retry-pending-pushes`, runs every 5 min) re-attempts the Apps Script call for any `review_entries` row whose latest `sync_runs` entry with `direction='db_to_sheet'` is in `status='error'`. Caps at 5 retries; further failures require manual intervention from the Sync Status page.
- `receive-from-sheet` with stale timestamp: skip update, log to `sync_runs` with `status='skipped'`.
- `receive-from-sheet` missing shared secret: 401, no DB write.

## 11. Testing Strategy

- **Schema:** apply migration on a scratch Supabase project; verify constraints.
- **Sheet bridge unit:** test Apps Script `onEdit` payload shape and tag suppression locally (via test trigger).
- **End-to-end manual:**
  1. Edit row in dashboard → assert Sheet updates within ~3s.
  2. Edit row in Sheet → assert DB updates within ~3s.
  3. Edit same row in both within 1s → LWW behaves as expected, no infinite loop.
  4. Bulk paste 20 rows in Sheet → reconciliation backstop catches any onEdit misses within 15 min.
- **Frontend:** form validation (required fields), masked-field reveal, optimistic save with rollback on error.

## 12. Migration / Cutover Plan

1. Apply new `schema.sql` (drops `mentions` table, creates `review_entries` and updated `sync_runs`).
2. Install Apps Script in the Sheet, run `backfillIds()` once to populate column A on all 54 rows.
3. Deploy three Edge Functions.
4. Set all secrets in Supabase.
5. Run `initial-import` once → seeds DB from CSV.
6. Deploy updated frontend to Vercel.
7. Communicate to team: "edit in dashboard going forward; Sheet edits still work but treat dashboard as primary."

## 13. Out of Scope (v1)

- Role-based access (Vercel password protection is the only auth).
- Field-level history / audit log beyond `sync_runs`.
- Promoting Y/N text fields to proper booleans (deferred to v1.1 once data is clean).
- Bulk-edit UI (multi-row select + bulk update).
- Custom views / saved filters.
- CSV export from dashboard.

## 14. Suggested Implementation Phasing

The spec is intentionally one coherent feature. User has prioritized **writes ASAP**, so phasing front-loads the write path and defers anything that doesn't block round-tripping edits to the Sheet:

- **Phase 1 — Writes end-to-end (MVP):** new `review_entries` schema, Apps Script `backfillIds()` + `doPost` handler, `initial-import` function (one-shot seed), `push-to-sheet` Edge Function, frontend list + edit form + new-entry form. Team can use the dashboard as a write-capable ops tool. KPI overview reduced to a single counter strip (no charts yet). No reverse sync, no retry job — `push-to-sheet` failures show a manual-retry button on the row instead.
- **Phase 2 — Reverse sync (Sheet → DB):** Apps Script `onEdit` trigger, `receive-from-sheet` Edge Function, loop suppression via `last_sync_tag`, reconciliation backstop. Direct Sheet edits start flowing back automatically.
- **Phase 3 — Hardening & polish:** `retry-pending-pushes` Scheduled Edge Function, full KPI overview with charts, filters/search on entries list, expanded Sync Status page, masked-field reveal UX refinements.

Each phase is independently shippable. The writing-plans skill should treat these as candidate plan boundaries, with Phase 1 prioritized.

## 15. Open Questions

None blocking. All previously-open decisions resolved in §1–§7.
