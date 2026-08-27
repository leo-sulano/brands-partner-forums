# PMS Column-Drift Reconcile — Design

**Date:** 2026-08-27
**Status:** implemented + deployed 2026-08-27 (migration applied, `sync-schedule-pms`
redeployed, cron `sync-schedule-pms-column-reconcile-minutely` active and confirmed
firing; a manual invoke moved 42 stragglers then converged to 0, board-wide column
mismatch count 0)

## Problem

The dashboard → PMS status sync (`resolveAndSyncTabStatuses`, `src/lib/scheduler/pmsSync.ts`)
decides whether to move a linked PMS card using exactly one test:

```ts
if (targetStatus !== link.synced_status) { /* queue a column move */ }
```

It never reads the task's actual PMS `columnId`. That makes it blind to two real drift
classes:

1. **A `PMS_STATUS_COLUMN_IDS` remap.** Task 267 (2026-08-26) repointed pending/done from
   the "In Progress" column and published/removed from "Review/QA" to a single "Done"
   column, and moved paused → "Project Paused" — but shipped no backfill. Every already-
   synced link had `targetStatus === synced_status`, so nothing was ever queued, and its
   card stayed stranded in the pre-267 column. Task 281's watermark short-circuit then
   froze the affected tabs so the 1-minute status cron never revisited them. This surfaced
   live on 2026-08-27: ~190 cards showing settled/Done on the Schedule Planner but sitting
   in "In Progress" / "Review/QA" on the PMS board. Reconciled once by hand (reset
   `synced_status`, cleared watermarks, moved 47 stragglers via the PMS API) — this design
   is the durable fix so it can't recur.
2. **A human dragging a card in the PMS UI.** The integration is one-way (dashboard → PMS);
   an out-of-band move should be reverted on the next pass, but today nothing does.

## Approach

A **separate** concern from status resolution, wired as its **own** 1-minute `pg_cron`
job and its own Edge Function action (`reconcileColumns`), not folded into
`syncAllStatuses`. Rationale:

- Matches the "separate reconcile cron" decision made during brainstorming.
- Zero churn to the existing watermark-gated status sweep and its tests.
- Independently observable in `cron.job_run_details`.
- The status cron owns `synced_status` (fresh vs. entry evidence, watermark-gated,
  active tabs only); the reconcile cron owns **card placement** (cheap, watermark-
  independent, every tab). Clean division: one decides *what the status is*, the other
  *where the card sits*.

The reconcile does **not** re-derive status from evidence. It trusts `synced_status`
(which the status cron keeps current) and simply enforces
`PMS_STATUS_COLUMN_IDS[synced_status]`.

## Components

### `enforcePmsColumns(links, credentials, fetchFn)` — `src/lib/scheduler/pmsSync.ts`

Pure, testable, no Supabase client (no DB writes — `synced_status` is already correct;
only PMS was wrong).

- One `GET /projects/:id/tasks` (via existing `fetchPmsProjectTasks`). Not wrapped in
  try/catch — a fetch failure throws and the caller surfaces it as one visible
  `error: …` string rather than a silent no-op (the exact failure mode this whole
  feature line exists to prevent — Task 279).
- For each link: skip if its `pms_task_id` is absent from the task list
  (`pullScheduleFromPms` owns stale-link deletion); skip if `synced_status` maps to an
  unknown column or the task is already there; otherwise `movePmsTask` to the mapped
  column.
- Grouped insert position via the existing `computeGroupedInsertPosition` (grouped by
  due-date then `tabDisplayName(link.tab)`), with the same in-memory task-list
  bookkeeping `syncScheduleStatusToPms` uses so a batch's later moves see earlier ones.
- Per-item try/catch: one failed move never blocks the rest.
- Returns `{ moved: {linkId, pmsTaskId, from, to}[], failed: {linkId, pmsTaskId, error}[] }`.

### `fetchAllSchedulePmsLinks(client)` — `src/lib/queries.ts`

Every link, all tabs (the per-tab `fetchSchedulePmsLinks` can't reach schedule-paused /
archived tabs, which a mapping change also strands). Paginated at 1000 like
`fetchEntryCredentials` — an unpaginated select silently caps at PostgREST's default.

### `handleReconcileColumns(...)` — `supabase/functions/sync-schedule-pms/index.ts`

`bootstrapTabRegistries` (so `tabDisplayName` resolves dynamic tabs) → `fetchAllSchedulePmsLinks`
→ `enforcePmsColumns` → `{ moved: n, failed: n, errors: string[] (first 5) }`.
`bootstrapFn` / `fetchLinksFn` / `enforceFn` injectable, mirroring `handleSyncAllStatuses`.
Reached via `action: 'reconcileColumns'` on the existing Edge Function.

### `pg_cron` job — `supabase/migrations/20260827160000_add_pms_column_reconcile_cron.sql`

`sync-schedule-pms-column-reconcile-minutely`, `* * * * *`, `net.http_post` to the
function with `{"action":"reconcileColumns"}`. Same JWT literal and shape as the two
existing jobs.

## Cost

Steady state: one `GET /tasks` per minute (~300 tasks), zero PATCHes. A PATCH only for a
card actually in the wrong column. Negligible; the user approved the 1-minute cadence.

## Known interactions / limitations

- **Transient 1-tick disagreement with the status cron.** Both run every minute. If the
  status cron updates a link's `synced_status` and moves its card in the same window the
  reconcile cron reads the pre-update `synced_status`, the reconcile could move the card
  to the old column; the next tick converges. Both operations are idempotent column
  moves — accepted, not locked.
- **No on-visit enforce.** Opening a tab's Schedule Planner does not trigger an immediate
  column reconcile for that tab; the cron catches it within ~60s. Deliberate — avoids
  touching `TabScheduleSection.tsx` for a marginal latency win.
- **Stale links** (link points at a PMS-deleted task) are skipped, not deleted — that
  stays `pullScheduleFromPms`'s job.

## Deploy

1. `supabase db push` — applies the cron migration.
2. `supabase functions deploy sync-schedule-pms` — ships the `reconcileColumns` action.
3. Confirm `select jobname, schedule, active from cron.job where jobname like '%reconcile%'`
   and watch `cron.job_run_details` for a clean run.
4. The ~33 schedule-paused-tab cards left stranded by the 2026-08-27 manual reconcile
   (Revolution Casino / SuprPlay / HazEmirates / GRG, `synced_status='active'`) will be
   moved to To Do by the first reconcile pass — no extra manual step.

## Out of scope

Reverse sync (PMS → dashboard); re-checking evidence in the reconcile pass; a shared
`GET /tasks` between the two crons.
