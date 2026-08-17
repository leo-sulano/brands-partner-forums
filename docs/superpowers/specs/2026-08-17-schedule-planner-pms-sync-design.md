# Schedule Planner → PMS Task Sync

**Requested by:** Leo, via chat — "connect the schedule planner to our PMS
task management: scheduling a task on the calendar creates a task in PMS's
To Do column, same date as the schedule, as the PMS task's due date." Scope
worked out interactively — see decisions below.

## Current behavior (for reference)

- Schedule Planner (`src/pages/SchedulePlanner.tsx` → `TabScheduleSection.tsx`)
  tracks one row per `(tab, brand_key, platform, week_start)` in
  `brand_schedule`, with five nullable day columns (`monday`…`friday`, each
  `'active' | 'paused' | null`). A cell click cycles
  blank → active → paused → blank via `setBrandScheduleDay` (single day) or
  `bulkUpsertBrandSchedule` (whole rows) in `src/lib/queries.ts`.
- Most active cells are never clicked by a human — they come from
  `ensureWeekGenerated`/`recalculatePauses` (`src/lib/scheduler/
  schedulerService.ts`), which runs lazily whenever a tab's Schedule Planner
  section is opened for the current week, and (once deployed — see Known
  Issues in `CLAUDE.md`) will also run from a Monday cron
  (`generate-weekly-schedule` Edge Function). Both paths write through the
  same `bulkUpsertBrandSchedule`. `ensureWeekGenerated` only generates for a
  `(brand, platform)` combo that has no existing row for that week yet
  (`alreadyHasRowCombos` in `schedulerService.ts`) — so any row it writes is,
  by construction, new for that week.
- `brand_schedule` already holds 1000+ historical rows going back to
  2025-10, many `'active'`, from the per-week import (2026-07-31) and months
  of real generation since.
- There is a separate PMS project ("**Forum Team**", id
  `cmsoh1uvs000004l4fbdvqmir`) already pointed at this dashboard's Schedule
  Planner URL as its `websiteUrl` — distinct from the "Forums Sheet
  Dashboard" project (`cmpe8l7f1...`) this repo's own dev task-history sync
  uses (see `project_pms_workflow` memory). Its columns:
  `Backlog cmsoh1uxz000104l4rcliasen`, `To Do cmsoh1uxz000204l46gf88k3f`,
  `In Progress cmsoh1uxz000304l4zynwy7vw`, `Review/QA cmsoh1uxz000404l44x2m2b9a`,
  `Blocked cmsoh1uxz000504l46ytlrxes`, `Done cmsoh1uxz000604l4j5loen7g`.
  Existing labels: `AG`, `CG`, `TP`, `Client`, `Project` — no `WO` label
  exists yet. An example real card there: title `"Rooster Partner |
  FortunePlay"`, labels `TP` + `Client`, due date `Aug 18`.
- `PMS_API_TOKEN` is already in `.env` but is **not** `VITE_`-prefixed — it
  has never been reachable from the browser bundle, only from the
  PowerShell dev-task-sync script. This integration must go through a new
  Supabase Edge Function, the same pattern `ai-assistant`/
  `notify-brand-removed`/`review-removal-assessment` already use to keep a
  secret server-side while the frontend calls a public function URL.

## Decisions (confirmed interactively)

1. **Trigger scope:** every cell that becomes `'active'` creates a PMS task
   — both manual clicks and auto-generated rows (from `ensureWeekGenerated`
   and, later, the cron function). Not gated to a subset of tabs or to
   manual-only actions.
2. **Backfill:** forward-only. Sync only fires for cells that become active
   *after* this feature ships. The 1000+ pre-existing historical rows are
   never touched or backfilled — a bulk backfill would create a one-time
   flood of tasks, many with due dates already in the past.
3. **Lifecycle after creation:** create-only. The sync never deletes or
   edits a task because a cell was later un-scheduled, paused, or the
   day's real outcome came in as confirmed/removed. Any such cleanup is a
   manual PMS action.
4. **Due-date drift:** PMS due-date edits are the one thing that syncs back.
   If someone manually changes a linked task's due date directly in PMS,
   Schedule Planner detects the drift on next load of that tab and moves the
   active flag to the new day. There is no reverse "move" gesture in
   Schedule Planner itself — toggling a different day active for the same
   brand/platform/week is indistinguishable from any other new active cell,
   so it creates a **new**, independently-linked task rather than editing
   the old one. This is a deliberate consequence of decision 3, not a bug to
   fix later.
5. **Task content:** title `"<Tab display name> | <Brand>"` (matching the
   existing example exactly), one label matching the platform (`TP`/`AG`/
   `CG`/`WO`) plus the existing `Client` label, column = To Do, due date =
   the cell's exact calendar date. No assignee, no description body.
6. **Missing `WO` label:** auto-created in the PMS project (via the labels
   API) the first time a Wizard of Odds cell needs tagging, then reused.
7. **Tab scope:** all 11 operational tabs from day one — no phased rollout.

## Data model

New table `schedule_pms_links`:

```sql
create table schedule_pms_links (
  id uuid primary key default gen_random_uuid(),
  tab text not null,
  brand_key text not null,
  platform text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  date date not null,
  pms_task_id text not null,
  created_at timestamptz not null default now()
);
create unique index schedule_pms_links_combo_idx
  on schedule_pms_links (tab, brand_key, platform, date);
```

This is the single source of truth for two questions:
- **Idempotency (push):** "has this exact `(tab, brand_key, platform, date)`
  already got a task?" — checked before creating one.
- **Ownership (pull):** "which PMS task does this exact scheduled day
  belong to, so I can tell if its due date has drifted?"

`brand_key` (not raw `brand`) matches every other table in this codebase
that keys off brand identity (`removed_platform_brands`,
`brand_platform_pause`, `brand_schedule` itself) — same
`normalizeBrandKey` from `src/lib/removedPlatformBrands.ts`.

RLS: read allowed for any approved user (consistent with every other table
here); insert/update/delete restricted to the service-role client the Edge
Function uses — no browser code writes this table directly. All four
policies (select/insert/update/delete) are defined explicitly per this
project's standing RLS convention, even though the browser only ever needs
select.

## New Edge Function: `sync-schedule-pms`

Holds `PMS_API_TOKEN` as a Supabase secret. Two actions, one function
(mirrors `ai-assistant` bundling multiple tools into one deployed function):

### `action: "push"`

**Request:** `{ action: "push", items: [{ tab, brand, platform, date }] }`
— one entry per cell that just became active. Callers batch everything
they wrote in one call rather than firing one request per cell (relevant
for `ensureWeekGenerated`, which can activate many combos at once).

**Behavior**, per item:
1. Compute `brand_key` (same normalization as everywhere else) and check
   `schedule_pms_links` for an existing row on
   `(tab, brand_key, platform, date)`. If found, skip — already linked.
2. Resolve the platform's label id from a small in-function cache of the
   PMS project's labels (fetched once per invocation); if the platform is
   `wo` and no `WO` label exists yet, create it first via the labels API,
   then use the new id.
3. `POST /api/projects/{FORUM_TEAM_PROJECT_ID}/tasks` with
   `{ title: "<tabDisplayName> | <brand>", columnId: TODO_COLUMN_ID,
   dueDate: date }`, then `PATCH /api/tasks/{id}` with
   `{ labelIds: [platformLabelId, clientLabelId] }` — two calls, matching
   the documented PMS API shape (`labelIds` isn't accepted on create).
4. Insert the new `schedule_pms_links` row.

Failures (PMS API error, network) are caught per-item and logged in the
response (`{ failed: [...] }`) rather than aborting the whole batch — one
bad item shouldn't block the rest.

**Response:** `{ created: [...], skipped: [...], failed: [...] }`.

### `action: "pull"`

**Request:** `{ action: "pull", tab }`.

**Behavior:**
1. Load every `schedule_pms_links` row for that `tab`.
2. `GET /api/projects/{FORUM_TEAM_PROJECT_ID}/tasks` once (not one GET per
   linked task) and build a lookup by task id.
3. For each link whose task still exists and whose live `dueDate` differs
   from the link's stored `date`, report it as drifted. A link whose task
   was deleted in PMS is reported too (`deleted: true`) so the frontend can
   decide whether to clear that cell's active flag — matching "the PMS task
   is now the source of truth for this day" implied by decision 4; if the
   task is gone, the day it was tracking is treated as unscheduled.

**Response:** `{ drifted: [{ tab, brand, platform, oldDate, newDate }],
deleted: [{ tab, brand, platform, date }] }`.

`schedule_pms_links` writes are restricted to the service-role client (see
RLS above), so the function itself applies both corrections to that table
*before* responding — a drifted link's `date` is updated in place to the
live PMS due date; a deleted link's row is removed entirely. The response
only tells the frontend what changed so it can do the one write it's
actually allowed to make: move `brand_schedule`. For a drifted item, it
clears the old day and sets the new day active (via the existing
`withDayStatus`/`setBrandScheduleDay` path); for a deleted item, it just
clears the old day. Clearing a day this way does **not** trigger a new
push (it's a correction, not a new schedule action) — only setting a new
day active does, and it's always safe to push, since the link now already
points at the new date (updated server-side, above), so the push's own
idempotency check sees it as already-linked and no-ops.

## Frontend integration points

- `TabScheduleSection.tsx`'s manual-click handlers (`handleCellClick`,
  `handleSetDayStatus`) call `push` with the single cell that just went
  active, immediately after `setBrandScheduleDay` succeeds. Non-blocking —
  a push failure surfaces as a toast but never reverts the schedule write
  that already succeeded.
- `ensureWeekGenerated` (`schedulerService.ts`) is extended to return the
  list of `(brand, platform, date)` combos it just activated (derivable
  from the rows it's about to write, before calling
  `bulkUpsertBrandSchedule` — every day column with `'active'` in a
  newly-generated row is one). Its caller in `TabScheduleSection.tsx` batches
  these into one `push` call.
- The not-yet-deployed `generate-weekly-schedule` cron function gets the
  same treatment when it's eventually deployed — it already calls
  `bulkUpsertBrandSchedule` via an injected client, so it can call
  `sync-schedule-pms` (`push`) the same way, server-to-server. Wiring this
  in now (even though that function's own deploy is still pending per
  `CLAUDE.md`'s Known Issues) means there's no follow-up gap once it ships.
- `TabScheduleSection.tsx` calls `pull` once per tab when it loads (mirrors
  the existing per-tab-visit pattern this page already uses for hidden
  brands / restrictions / removed-platform sets), then applies any drifted
  or deleted entries before rendering.

## Config

- Supabase secrets: `PMS_API_TOKEN` (already exists as a plain env var,
  needs `supabase secrets set`).
- Constants baked into the function (not env-configurable — this is a 1:1
  integration with one specific PMS project, not a general-purpose
  connector): `FORUM_TEAM_PROJECT_ID = "cmsoh1uvs000004l4fbdvqmir"`,
  `TODO_COLUMN_ID = "cmsoh1uxz000204l46gf88k3f"`.
- New frontend env var `VITE_SYNC_SCHEDULE_PMS_URL`, same pattern as
  `VITE_AI_ASSISTANT_URL` — added to `.env`/`.env.example`/Vercel.

## Testing

- `schedule_pms_links` idempotency and the push/pull payload-shaping logic
  are pure enough to unit test without hitting the real PMS API (mock the
  fetch calls, same pattern `notify-brand-removed`'s own tests use for
  Gmail).
- `ensureWeekGenerated`'s new "what did I just activate" return value gets
  a regression test alongside its existing `schedulerService.test.ts`
  coverage.
- Live verification against the real PMS API (creating a real task, editing
  its due date, confirming the pull picks it up) is a manual pre-deploy
  step, not something to fake in the test suite.

## Deployment (pending, deferred like every other Edge-Function feature here)

1. `supabase secrets set PMS_API_TOKEN=...`
2. `supabase functions deploy sync-schedule-pms`
3. Add `VITE_SYNC_SCHEDULE_PMS_URL=<deployed function URL>` to Vercel env,
   redeploy.

Until all three are done, pushes/pulls fail silently as non-blocking
toasts (per the error-handling design above) — Schedule Planner itself
keeps working exactly as it does today.
