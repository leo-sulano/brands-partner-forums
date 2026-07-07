# Fully Disconnect Google Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the last remaining Google Sheet integration surface — 4 dead Supabase Edge Functions (repo + live deployment), the frontend code that only served them, stale env var declarations, and the doc/copy that still describes the Sheet as part of the architecture.

**Architecture:** This is deletion-only. The Sheet→DB sync direction was disabled 2026-06-26; the DB→Sheet push call sites are already gone from the frontend. What's left is 4 orphaned Edge Functions still deployed on Supabase, a handful of frontend functions/types that only existed to read what those functions wrote, stale env var declarations, and two docs (`HowItWorks.tsx`, `CLAUDE.md`) that still describe the old Sheet-fed architecture.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase Edge Functions (Deno), Supabase CLI.

## Global Constraints

- Do not touch `apps-script/Code.gs` or the Google Sheet itself — including the unrelated hourly AG/CG email-parsing trigger. Out of scope per spec.
- Do not touch the `sync_runs` table/schema, or the `last_sync_tag`/`sheet_row_id` columns on `entries` — still written by `check-review-status` and `initial-import`, which stay in service. Out of scope per spec.
- Do not touch `initial-import`, `check-review-status`, `proxy-check-status`, `ai-assistant`, `bright-endpoint`, or `hyper-service` Edge Functions — none are part of the Sheet-sync system being removed.
- Only delete these 4 Edge Functions (repo source + live Supabase deployment): `sync-sheet`, `push-to-sheet`, `import-tabs`, `backfill-brand-hrefs`.
- All frontend changes must pass `npm run build` with zero TypeScript errors and keep `npm test` passing.
- Live Supabase Edge Function deletion happens last, after all repo changes are committed.

---

### Task 1: Remove dead frontend code

**Files:**
- Modify: `src/lib/queries.ts` (remove `SyncRun` import at line 4, remove `fetchSyncRuns` at lines 170-178)
- Modify: `src/lib/realtime.ts` (remove `subscribeSyncRuns` at lines 58-67)
- Modify: `src/vite-env.d.ts` (remove `VITE_PUSH_TO_SHEET_URL` from `ImportMetaEnv`, lines 90-94)
- Delete: `src/types/sync.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by later tasks — this is pure removal. `queries.ts`, `realtime.ts` remain otherwise unchanged and still export everything else they did before.

- [ ] **Step 1: Remove `fetchSyncRuns` and its import from `src/lib/queries.ts`**

Current top-of-file imports (lines 1-9):

```ts
import { supabase, SUPABASE_ANON_KEY, CHECK_STATUS_URL, CHECK_STATUS_BASE_URL, CHECK_STATUS_TOKEN, CHECK_AG_STATUS_URL, CHECK_AG_STATUS_BASE_URL } from './supabase';
import { inDateRange } from './dateUtils';
import type { Mention, MentionStatus } from '../types/mention';
import type { SyncRun } from '../types/sync';
import type { Entry } from '../types/entry';
import type { Profile } from '../types/profile';
import type { BrandEntry, TabKpis } from '../types/brand-entry';
import type { AuditEntityType, AuditLogEntry } from '../types/audit-log';
import type { Platform, RemovedEntryRow } from './removedEntriesDiff';
```

Remove the `SyncRun` import line so it reads:

```ts
import { supabase, SUPABASE_ANON_KEY, CHECK_STATUS_URL, CHECK_STATUS_BASE_URL, CHECK_STATUS_TOKEN, CHECK_AG_STATUS_URL, CHECK_AG_STATUS_BASE_URL } from './supabase';
import { inDateRange } from './dateUtils';
import type { Mention, MentionStatus } from '../types/mention';
import type { Entry } from '../types/entry';
import type { Profile } from '../types/profile';
import type { BrandEntry, TabKpis } from '../types/brand-entry';
import type { AuditEntityType, AuditLogEntry } from '../types/audit-log';
import type { Platform, RemovedEntryRow } from './removedEntriesDiff';
```

Then find this function (currently lines 170-178, between `tallyTop` and `EditEvent`):

```ts
export async function fetchSyncRuns(limit = 500): Promise<SyncRun[]> {
  const { data, error } = await supabase
    .from('sync_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SyncRun[];
}

export interface EditEvent {
```

Delete the whole `fetchSyncRuns` function (keep one blank line before `export interface EditEvent {`, matching the file's existing spacing convention):

```ts
export interface EditEvent {
```

- [ ] **Step 2: Remove `subscribeSyncRuns` from `src/lib/realtime.ts`**

The file currently ends with (lines 54-67):

```ts
  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeSyncRuns(onChange: () => void): () => void {
  const channel = supabase
    .channel(`sync-runs-realtime-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_runs' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
```

Delete the `subscribeSyncRuns` function and the blank line before it, so the file ends with:

```ts
  return () => {
    supabase.removeChannel(channel);
  };
}
```

- [ ] **Step 3: Delete `src/types/sync.ts`**

The file currently contains:

```ts
export type SyncRunStatus = 'running' | 'success' | 'error' | 'skipped';
export type SyncDirection = 'sheet_to_db' | 'db_to_sheet' | 'initial_import' | 'status_check';

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

Delete the file entirely — after Steps 1-2, nothing imports from it.

- [ ] **Step 4: Remove `VITE_PUSH_TO_SHEET_URL` from `src/vite-env.d.ts`**

Current (lines 90-94):

```ts
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_PUSH_TO_SHEET_URL: string;
}
```

Change to:

```ts
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}
```

- [ ] **Step 5: Verify build and tests**

Run: `npm run build`
Expected: Exits 0, no TypeScript errors. If TypeScript complains about a missing `SyncRun`, `fetchSyncRuns`, or `subscribeSyncRuns` reference, search the whole `src/` tree for that name — a caller was missed and must be removed too (per the spec's dead-code verification, there should be none, but this is the safety net).

Run: `npm test`
Expected: All existing tests still pass (the two test files, `removedEntriesDiff.test.ts` and `tab-configs.test.ts`, don't touch any of the removed code, so the count and pass/fail status should be identical to before this task).

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts src/lib/realtime.ts src/vite-env.d.ts
git rm src/types/sync.ts
git commit -m "chore: remove dead sync_runs frontend code (sync-sheet/push-to-sheet cleanup)"
```

---

### Task 2: Update copy and documentation

**Files:**
- Modify: `src/pages/HowItWorks.tsx` (rewrite `DATA_FLOW` constant, line 30)
- Modify: `CLAUDE.md` (7 edits — see steps below)
- Modify: `.env.example` (remove 2 stale blocks)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rewrite `DATA_FLOW` in `src/pages/HowItWorks.tsx`**

Current (line 29-30):

```tsx
const DATA_FLOW =
  "Entries used to live in a shared Google Sheet that synced into this dashboard. Today the dashboard is edited directly and is the live source of truth — the Sheet is no longer the operational record. Status changes (live vs. removed) come from the automated Check Status runs below, not manual edits.";
```

Change to:

```tsx
const DATA_FLOW =
  "Entries are created and edited directly in the dashboard, which is the single source of truth for all data. Status changes (live vs. removed) come from the automated Check Status runs below, not manual edits.";
```

- [ ] **Step 2: Update `CLAUDE.md` — Purpose (line 4)**

Current:

```markdown
Internal brand-monitoring dashboard. Reads forum-mention data that an upstream Edge Function pulls from a Google Sheet into Supabase, and presents it as an overview, per-mention detail, and a sync-status admin page.
```

Change to:

```markdown
Internal brand-monitoring dashboard. Entries are created and edited directly in Supabase, the dashboard's sole data store with no external sync, and presented as an overview, per-mention detail, and a sync-status admin page.
```

- [ ] **Step 3: Update `CLAUDE.md` — Project Structure tree (lines 18-21)**

Current:

```markdown
├── supabase/
│   ├── schema.sql          # mentions + sync_runs tables, indexes
│   └── functions/
│       └── sync-sheet/     # Deno Edge Function: Google Sheet → mentions upsert
```

Change to:

```markdown
├── supabase/
│   ├── schema.sql          # mentions + sync_runs tables, indexes
│   └── functions/          # Supabase Edge Functions (ai-assistant, check-review-status, etc.)
```

- [ ] **Step 4: Update `CLAUDE.md` — Architecture Rules Data flow bullet (line 27)**

Current:

```markdown
- **Data flow:** Google Sheet → `sync-sheet` Edge Function → `mentions` table → React reads via supabase-js
```

Change to:

```markdown
- **Data flow:** Supabase is the sole data store — entries are created and edited directly in the dashboard via `supabase-js`. No external sync (the Google Sheet integration was fully disconnected 2026-07-07).
```

- [ ] **Step 5: Update `CLAUDE.md` — Data Model (line 37)**

Current (lines 34-37):

```markdown
## Data Model
- `mentions(id, source_row_id, forum, thread_title, mention_text, url, author, posted_at, keyword, sentiment, status, synced_at)`
- `sync_runs(id, started_at, finished_at, rows_seen, rows_upserted, rows_skipped, error_message, status)`
- `source_row_id` is the idempotency key for upserts from the Sheet.
```

Remove the last bullet (no more Sheet upserts to be idempotent about):

```markdown
## Data Model
- `mentions(id, source_row_id, forum, thread_title, mention_text, url, author, posted_at, keyword, sentiment, status, synced_at)`
- `sync_runs(id, started_at, finished_at, rows_seen, rows_upserted, rows_skipped, error_message, status)`
```

- [ ] **Step 6: Update `CLAUDE.md` — Development Guidelines (line 43)**

Current (lines 39-43):

```markdown
## Development Guidelines
- TypeScript strict mode. No `any` unless commented why.
- Pages own data fetching via `lib/queries.ts`; components stay presentational.
- Env vars are read once in `src/lib/supabase.ts`. Never hardcode URLs or keys.
- Sync function (`supabase/functions/sync-sheet/index.ts`) must write a `sync_runs` row for every invocation, even on failure.
```

Remove the last bullet (the function no longer exists):

```markdown
## Development Guidelines
- TypeScript strict mode. No `any` unless commented why.
- Pages own data fetching via `lib/queries.ts`; components stay presentational.
- Env vars are read once in `src/lib/supabase.ts`. Never hardcode URLs or keys.
```

- [ ] **Step 7: Update `CLAUDE.md` — Known Issues / Backlog (line 80) and Recent Changes**

Current Known Issues / Backlog (lines 76-80):

```markdown
### Known Issues / Backlog
- Recharts pinned to v2; revisit if a major upgrade is available at install time.
- No dedicated `/mentions` list view — Overview's recent-mentions table is the only path to detail. Revisit if filtering needs grow.
- Sentiment column is passthrough; classification deferred.
- Cron schedule for `sync-sheet` not yet defined (proposed hourly).
```

Remove the last bullet:

```markdown
### Known Issues / Backlog
- Recharts pinned to v2; revisit if a major upgrade is available at install time.
- No dedicated `/mentions` list view — Overview's recent-mentions table is the only path to detail. Revisit if filtering needs grow.
- Sentiment column is passthrough; classification deferred.
```

Current Recent Changes top entry (lines 63-64):

```markdown
### Recent Changes
- *2026-06-02:* Added AI assistant (OpenAI **gpt-4o-mini**). Floating chat widget on
```

Insert a new entry above it, so it reads:

```markdown
### Recent Changes
- *2026-07-07:* Fully disconnected the Google Sheet from the dashboard — deleted the
  `sync-sheet`, `push-to-sheet`, `import-tabs`, and `backfill-brand-hrefs` Edge Functions
  (repo source + live Supabase deployment) along with the frontend code that only served
  them (`fetchSyncRuns`, `subscribeSyncRuns`, `src/types/sync.ts`). The Sheet→DB direction
  was already disabled 2026-06-26; this removes the now-unused DB→Sheet path and its dead
  readers. `apps-script/Code.gs` and the Sheet itself are untouched. Spec:
  `docs/superpowers/specs/2026-07-07-google-sheet-disconnect-design.md`.
- *2026-06-02:* Added AI assistant (OpenAI **gpt-4o-mini**). Floating chat widget on
```

- [ ] **Step 8: Update `.env.example` — remove the `VITE_PUSH_TO_SHEET_URL` block**

Current (lines 5-14):

```
VITE_SUPABASE_URL=https://krxnupmhfiduduvvlumc.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU

# Edge Function URLs — triggered from the dashboard.
# VITE_PUSH_TO_SHEET_URL: write-back path when dashboard edits a row (Supabase → Sheet)
VITE_PUSH_TO_SHEET_URL=https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/push-to-sheet

# VITE_AI_ASSISTANT_URL : floating AI assistant (gpt-4o-mini). The ai-assistant Edge
#   Function holds OPENAI_API_KEY (set via `supabase secrets set OPENAI_API_KEY=...`).
VITE_AI_ASSISTANT_URL=https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/ai-assistant
```

Change to:

```
VITE_SUPABASE_URL=https://krxnupmhfiduduvvlumc.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU

# VITE_AI_ASSISTANT_URL : floating AI assistant (gpt-4o-mini). The ai-assistant Edge
#   Function holds OPENAI_API_KEY (set via `supabase secrets set OPENAI_API_KEY=...`).
VITE_AI_ASSISTANT_URL=https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/ai-assistant
```

- [ ] **Step 9: Update `.env.example` — remove the Apps Script secrets block**

Current (lines 25-38):

```
VITE_CHECK_STATUS_TOKEN=replace-with-a-long-random-string

# =========================================================================
# Supabase Edge Function secrets — server-side, never exposed to browser.
# Set these via the Supabase dashboard (Edge Functions → Secrets) or:
#   supabase secrets set APPS_SCRIPT_URL=... APPS_SCRIPT_SECRET=...
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by the runtime.
#
# IMPORTANT: The Edge Functions (import-tabs, push-to-sheet) read the names
# APPS_SCRIPT_URL and APPS_SCRIPT_SECRET — use exactly these names in Supabase.
# =========================================================================
APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR-DEPLOYMENT-ID/exec
APPS_SCRIPT_SECRET=replace-with-the-same-value-set-in-apps-script-Code.gs

# Auto-provided by the Supabase Edge Function runtime; listed here for reference only:
```

Change to:

```
VITE_CHECK_STATUS_TOKEN=replace-with-a-long-random-string

# Auto-provided by the Supabase Edge Function runtime; listed here for reference only:
```

- [ ] **Step 10: Verify build**

Run: `npm run build`
Expected: Exits 0, no TypeScript errors (only the `.tsx` change in this task affects compilation; `CLAUDE.md` and `.env.example` are not part of the build).

- [ ] **Step 11: Commit**

```bash
git add src/pages/HowItWorks.tsx CLAUDE.md .env.example
git commit -m "docs: remove Google Sheet references from CLAUDE.md, .env.example, and How It Works page"
```

---

### Task 3: Delete the 4 dead Edge Function source directories

**Files:**
- Delete: `supabase/functions/sync-sheet/`
- Delete: `supabase/functions/push-to-sheet/`
- Delete: `supabase/functions/import-tabs/`
- Delete: `supabase/functions/backfill-brand-hrefs/`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: nothing consumed by Task 4 (Task 4 acts on the live Supabase project directly, not on repo files) — but Task 4 should run after this task's commit exists, so the repo and the live deployment state change together in the same logical unit of work.

- [ ] **Step 1: Delete the 4 directories**

```bash
git rm -r supabase/functions/sync-sheet
git rm -r supabase/functions/push-to-sheet
git rm -r supabase/functions/import-tabs
git rm -r supabase/functions/backfill-brand-hrefs
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Exits 0, no TypeScript errors. (These are Deno server files under `supabase/functions/`, not part of the Vite/tsc build graph — this step confirms nothing frontend accidentally depended on their presence as files, e.g. no import path pointed into `supabase/functions/`.)

- [ ] **Step 3: Confirm no remaining references**

Run: `grep -rn "sync-sheet\|push-to-sheet\|import-tabs\|backfill-brand-hrefs" src/ supabase/ --include="*.ts" --include="*.tsx" --include="*.sql"`
Expected: No matches (or only comment-only mentions in `src/pages/BrandGroup.tsx` referencing `import-tabs` conceptually, which is fine — those are prose comments, not code that calls the function, and were already present before this plan per the spec's verification section).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete dead sync-sheet, push-to-sheet, import-tabs, backfill-brand-hrefs Edge Functions"
```

---

### Task 4: Undeploy the 4 Edge Functions from the live Supabase project

**Files:** None (no repo changes — this acts on the live Supabase project directly).

**Interfaces:**
- Consumes: Task 3 must be committed first (Global Constraint: live deletion happens last).

- [ ] **Step 1: Confirm the Supabase project is linked**

Run: `cat supabase/.temp/project-ref`
Expected: prints `krxnupmhfiduduvvlumc`. If this file is missing (e.g. you're in a fresh worktree — `.temp` is gitignored and per-checkout), run `supabase link --project-ref krxnupmhfiduduvvlumc` first, then re-check.

- [ ] **Step 2: List currently deployed functions (baseline)**

Run: `supabase functions list`
Expected: a table including `sync-sheet`, `push-to-sheet`, `import-tabs`, `backfill-brand-hrefs`, all `ACTIVE`, alongside the untouched ones (`initial-import`, `check-review-status`, `ai-assistant`, `proxy-check-status`, and any others). Record this output — it's what Step 4 compares against.

- [ ] **Step 3: Delete each of the 4 functions**

```bash
supabase functions delete sync-sheet
supabase functions delete push-to-sheet
supabase functions delete import-tabs
supabase functions delete backfill-brand-hrefs
```

Expected for each: a confirmation message that the function was deleted (the CLI may prompt for confirmation — confirm each one).

- [ ] **Step 4: Verify**

Run: `supabase functions list`
Expected: `sync-sheet`, `push-to-sheet`, `import-tabs`, and `backfill-brand-hrefs` no longer appear in the table. Every other function from Step 2's baseline (`initial-import`, `check-review-status`, `ai-assistant`, `proxy-check-status`, and any others) still appears, unchanged — this confirms no over-deletion.

No commit — this task has no repo changes. Report the before/after `supabase functions list` output as evidence.

---

## Post-Implementation Verification

- [ ] `npm run build` and `npm test` both pass on the final state of the branch.
- [ ] `supabase functions list` shows exactly the 4 target functions removed and every other function untouched.
- [ ] Open `/how-it-works` in the app and confirm the "Where the data comes from" card no longer mentions Google Sheet.
- [ ] Read the final `CLAUDE.md` Purpose, Architecture Rules, Data Model, Development Guidelines, Known Issues, and Recent Changes sections top to bottom — confirm no remaining reference to `sync-sheet`, Google Sheet upserts, or the deleted functions outside of the new dated Recent Changes entry (which documents the removal, not a live dependency).
