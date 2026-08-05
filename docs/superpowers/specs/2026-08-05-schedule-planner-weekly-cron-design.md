# Schedule Planner: Automatic Weekly Generation via Cron

## Purpose
Schedule Planner's weekly generation (`recalculatePauses` + `ensureWeekGenerated`,
`src/lib/scheduler/schedulerService.ts`) currently only fires when an approved user happens
to open that tab's Schedule Planner page while it is the current calendar week
(`isCurrentWeek` gate in `SchedulePlanner.tsx`). If nobody opens a given tab that week, its
schedule never generates. This adds a true server-side trigger so generation happens every
Monday regardless of whether anyone visits the page.

## Decisions (confirmed with user)
1. **True server-side cron**, not a broadened client-side trigger — must run even if nobody
   is logged into the dashboard that day.
2. **Reuse the real scheduler code**, not a ported/duplicated copy — this repo already has a
   documented drift bug from exactly that pattern (`ai-assistant/tools.ts`'s ported `pick()`
   silently diverging from `scoreSummary.ts`'s real one, noted in CLAUDE.md's Known Issues).
   The scheduler's actual logic (day-load balancing, pause rules, carryover) is materially
   more complex than `pick()`, so the same class of bug would be worse here.
3. **The existing page-visit trigger stays**, unchanged, as a harmless idempotent fallback
   (e.g. if the cron job fails one week) — not replaced.

## Architecture

### 1. Trigger: pg_cron + pg_net → new Edge Function
A new migration adds a weekly `cron.schedule(...)` job calling `net.http_post` against a new
`generate-weekly-schedule` Edge Function — the same pattern already live in
`supabase/schema.sql` for the TP-status-check cron, and in
`20260727150000_add_sso_replay_and_revocation.sql` for the SSO daily job.

Cron expression: `0 1 * * 1` (01:00 UTC every Monday = 09:00 Asia/Manila Monday). This repo
already treats Asia/Manila (UTC+8) as the team's operating timezone (see the `+8h` system-
message offset in `ai-assistant`, and `scheduleBrands.ts`'s `toISODate`) — 01:00 UTC lands
safely inside Monday in Manila with over an hour of buffer past local midnight, so the job
never fires while it's still Sunday locally.

### 2. New Edge Function `generate-weekly-schedule`
Shape follows `check-review-status`/`sso-callback`: builds its own service-role Supabase
client from `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (both auto-injected by Supabase into
every Edge Function — no new secrets to configure).

For each tab in `OPERATIONAL_TABS` (`src/lib/tabs.ts`), it reproduces the same tab-context
assembly `SchedulePlanner.tsx`'s brand-loading effect does today:
- `fetchRawEntriesByTab(tab)`, `fetchTabHeaders(tab)`, `fetchRemovedPlatformBrands()`
- derive `brands` (unique brand-column values, falling back to `TAB_DEFAULT_BRAND[tab]`) and
  `activePlatforms` (`getTabPlatforms(tab)`)
- build the `TabContext` and call `recalculatePauses(tab, weekStart, ctx, client)` then
  `ensureWeekGenerated(tab, weekStart, ctx, resumed, client)`, where `weekStart` is the
  Monday of the run date.

One tab's failure (e.g. a malformed entry) must not abort the others — each tab's pair of
calls is wrapped individually; failures are logged (`console.error`) and the loop continues.

### 3. Reuse, not duplication (the refactor)
To let the Edge Function call the *actual* scheduler code:

- **`queries.ts`**: add an optional `client: SupabaseClient = supabase` parameter to the 8
  functions the scheduler pipeline touches — `fetchRawEntriesByTab`, `fetchTabHeaders`,
  `fetchRemovedPlatformBrands`, `fetchBrandSchedule`, `bulkUpsertBrandSchedule`,
  `fetchActiveBrandPlatformPauses`, `upsertBrandPlatformPause`, `deleteBrandPlatformPause`.
  Every internal `supabase.from(...)` call in those 8 functions becomes `client.from(...)`.
  All existing browser call sites are unaffected (default arg = today's singleton).
- **`schedulerService.ts`**: thread the same `client` parameter through `recalculatePauses`,
  `ensureWeekGenerated`, and the internal `buildCarryover` helper, down to their calls into
  the 8 functions above.
- **`supabase.ts`**: change `import.meta.env.VITE_SUPABASE_URL` /
  `import.meta.env.VITE_SUPABASE_ANON_KEY` to optional-chained
  `import.meta.env?.VITE_SUPABASE_URL` / `?.VITE_SUPABASE_ANON_KEY`. Deno has no
  `import.meta.env`, so the unmodified code throws on import; the browser behavior is
  unchanged (Vite still statically replaces `import.meta.env` at build time either way — the
  `?.` only guards the case where the whole object is absent, i.e. Deno).
- **Explicit `.ts` extensions**: add them to the relative imports across the dependency chain
  reachable from `schedulerService.ts` — `queries.ts`, `supabase.ts`, `schedulerService.ts`,
  `schedulerEngine.ts`, `scheduleUtils.ts`, `schedulerRules.ts`, `scoreSummary.ts`,
  `removedPlatformBrands.ts`, `scheduleBrands.ts`, `tab-configs.ts`, `tabs.ts`,
  `dateUtils.ts`. Deno requires explicit extensions for relative imports; confirmed safe on
  the Vite/tsc side since `tsconfig.app.json` already sets `allowImportingTsExtensions: true`.
  Import-line edits only — no logic changes.
- The Edge Function imports these `src/lib/**` modules directly by relative path from
  `supabase/functions/generate-weekly-schedule/index.ts`. This is a first for the repo (no
  existing function shares code with `src/lib`) — every other function's logic is
  self-contained within `supabase/functions/`.

### 4. Migration
New file `supabase/migrations/<timestamp>_add_generate_weekly_schedule_cron.sql`, following
the `cron.schedule(name, expr, $$ select net.http_post(...) $$)` shape already in
`supabase/schema.sql` (TP-status-check job) and the SSO migration — `Authorization: Bearer
<anon key>` header, JSON body `{}`.

## Out of Scope
- Re-enabling completion-based carryover (`CARRYOVER_RULES.completionThreshold` stays `0`).
- The success-rate pause oscillation issue (documented, accepted tradeoff).
- Removing or changing the existing page-visit trigger in `SchedulePlanner.tsx`.
- Run-history/logging table for the new cron job (existing functions log to `console`
  only, except the legacy `sync_runs` table which is specific to the old Sheet sync and
  TP-status-check path — not reused here).
- Any change to `entries`' RLS policy or the credential-exposure issue already documented in
  CLAUDE.md's Known Issues (the new Edge Function uses a service-role client, which bypasses
  RLS entirely regardless).

## Testing
- Existing Vitest suites for `schedulerEngine`/`schedulerService`/`scoreSummary`/`queries`
  are unaffected by the new optional `client` parameters (backward-compatible default).
- New `schedulerService.test.ts` cases: assert an explicitly-passed mock client is used
  instead of the default singleton, for both `recalculatePauses` and `ensureWeekGenerated`.
- New Deno test (`generate-weekly-schedule`, mirroring `ai-assistant/tools_test.ts`'s
  structure) covering the per-tab orchestration loop, including the one-tab-failure-doesn't-
  abort-others behavior.
- Manual/live verification after deploy: confirm the migration's `cron.schedule` row exists
  (`select * from cron.job`), and either wait for a real Monday run or manually invoke the
  deployed function once to confirm it writes the expected `brand_schedule` rows without
  needing a Schedule Planner page visit.

## Deployment (manual steps, not run by this session)
1. `supabase db push` (or apply the migration SQL directly in the Supabase SQL Editor, per
   this repo's established fallback when no DB credential is available in-session).
2. `supabase functions deploy generate-weekly-schedule`.
3. Confirm `pg_cron`/`pg_net` extensions are enabled (already required by the existing
   TP-status-check job, so almost certainly already on).
