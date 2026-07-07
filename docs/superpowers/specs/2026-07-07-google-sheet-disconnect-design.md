# Fully Disconnect Google Sheet — Design Spec

**Date:** 2026-07-07
**Status:** Approved

## Overview

The Sheet↔Dashboard sync was already functionally dead: the Sheet→DB direction was disabled on 2026-06-26 (see `docs/superpowers/plans/2026-06-26-dashboard-as-source-of-truth.md`), and the DB→Sheet push call sites have since been removed from the frontend too — `src/lib/queries.ts` and `src/lib/supabase.ts` have no remaining references to `push-to-sheet`, `sync-sheet`, or `import-tabs`. What's left is dead weight: 4 Supabase Edge Functions still deployed and reachable, a few frontend functions/types that only existed to read the now-orphaned `sync_runs` writes from those functions, stale env var declarations, and doc/copy that still describes the Sheet as part of the data flow (including the new How It Works page, which is what surfaced this).

This is a deletion/cleanup task, not new functionality: remove the dead Edge Functions (repo source + live Supabase deployment), remove the frontend code that only served them, and correct the two places that describe the architecture (How It Works page, `CLAUDE.md`).

## Scope

**In scope:**
- Delete `supabase/functions/{sync-sheet,push-to-sheet,import-tabs,backfill-brand-hrefs}/` and undeploy all four from the live Supabase project (`supabase functions delete <name>`).
- Delete dead frontend code that only existed to serve those functions: `fetchSyncRuns()` (`src/lib/queries.ts`), `subscribeSyncRuns()` (`src/lib/realtime.ts`), `src/types/sync.ts`, and `VITE_PUSH_TO_SHEET_URL` from `src/vite-env.d.ts`.
- Remove the now-dead `VITE_PUSH_TO_SHEET_URL` and `APPS_SCRIPT_URL`/`APPS_SCRIPT_SECRET` blocks from `.env.example` (tracked template file — those secrets were only read by the deleted functions).
- Rewrite `DATA_FLOW` copy in `src/pages/HowItWorks.tsx` to drop the Google Sheet mention.
- Correct `CLAUDE.md`: the "Data flow" architecture bullet, the "Sync function must write a sync_runs row" guideline, and the "Cron schedule for sync-sheet" backlog line.

**Explicitly out of scope:**
- `apps-script/Code.gs` and the Google Sheet itself — stay untouched, including the unrelated hourly AG/CG email-parsing trigger.
- The `sync_runs` table/schema — stays as-is; still written by `check-review-status` and `initial-import`, both of which remain in service.
- The `last_sync_tag` and `sheet_row_id` columns on `entries` — structural schema changes, not requested, riskier than this cleanup.
- `initial-import`, `check-review-status`, `proxy-check-status`, `ai-assistant` Edge Functions, and the two untracked deployed functions with no local source (`bright-endpoint`, `hyper-service`) — none of these are part of the Sheet-sync system being removed; leave them deployed and untouched.

## Verification That the 4 Functions Are Dead

Confirmed via `supabase functions list` (all 4 show `ACTIVE`) cross-referenced against `src/`:
- `grep -r "push-to-sheet\|sync-sheet\|import-tabs\|backfill-brand-hrefs"` across `src/lib/queries.ts` and `src/lib/supabase.ts` (the only place frontend Edge Function calls live) returns no hits — the only remaining hits are in the untracked stray file `src/lib/queries.ts.tmp.24540.e8ca16ed553c` (pre-existing junk from an old commit, not touched by this work) and code comments referencing `import-tabs` conceptually (`src/pages/BrandGroup.tsx:27,863`), not as a live call.
- `fetchSyncRuns` and `subscribeSyncRuns` are each defined once and never imported/called anywhere else in `src/`.

## Repo Changes

| File | Change |
|---|---|
| `supabase/functions/sync-sheet/` | Delete directory |
| `supabase/functions/push-to-sheet/` | Delete directory |
| `supabase/functions/import-tabs/` | Delete directory |
| `supabase/functions/backfill-brand-hrefs/` | Delete directory |
| `src/lib/queries.ts` | Remove `fetchSyncRuns()` (currently lines 170-178) and the now-unused `import type { SyncRun } from '../types/sync'` (line 4) |
| `src/lib/realtime.ts` | Remove `subscribeSyncRuns()` |
| `src/types/sync.ts` | Delete file |
| `src/vite-env.d.ts` | Remove `readonly VITE_PUSH_TO_SHEET_URL: string;` from `ImportMetaEnv` |
| `.env.example` | Remove the `VITE_PUSH_TO_SHEET_URL` block (lines 8-10) and the `APPS_SCRIPT_URL`/`APPS_SCRIPT_SECRET` block (lines 26-36) |
| `src/pages/HowItWorks.tsx` | Rewrite `DATA_FLOW` constant — no Google Sheet mention |
| `CLAUDE.md` | Update "Data flow" bullet, remove the sync_runs guideline bullet and the sync-sheet cron backlog line; add a dated Recent Changes entry |

## Live Infrastructure Change

Run `supabase functions delete sync-sheet`, `supabase functions delete push-to-sheet`, `supabase functions delete import-tabs`, `supabase functions delete backfill-brand-hrefs` against the linked project (already confirmed linked to `krxnupmhfiduduvvlumc` in this checkout). This is the one irreversible step — functions can be redeployed from git history if ever needed again, but the live endpoints stop responding immediately once deleted.

## HowItWorks.tsx Copy

Replace the current `DATA_FLOW` string (which says entries "used to live in a shared Google Sheet") with copy describing the dashboard as fully self-contained: entries are created and edited directly in the dashboard, which is the only data store — no external sync exists. Everything else on the page (intro, feature grid) is unaffected.

## CLAUDE.md Changes

- **Architecture Rules → Data flow bullet:** replace "Google Sheet → `sync-sheet` Edge Function → `mentions` table → React reads via supabase-js" with a statement that the dashboard is the sole data store (no external sync); leave the rest of the Architecture Rules section (auth, data access, routing, styling, charts) untouched.
- **Development Guidelines:** remove the bullet "Sync function (`supabase/functions/sync-sheet/index.ts`) must write a `sync_runs` row for every invocation, even on failure."
- **Known Issues / Backlog:** remove "Cron schedule for `sync-sheet` not yet defined (proposed hourly)."
- **Recent Changes:** add a dated entry (2026-07-07) noting the Sheet was fully disconnected and why.

## Testing

No unit-testable logic changes hands here — this is deletion of unused code plus copy/doc edits. Verification is `npm run build` (must stay at zero TypeScript errors after each deletion, since removing a type or function that's still referenced somewhere would surface as a compile error) and `npm test` (existing suite must keep passing — confirms nothing in the 2 tested lib files depended on removed code). The live Edge Function deletions are verified with `supabase functions list` showing the 4 names gone.
