# Schedule Planner → PMS Status Sync: Automatic (Cron-Driven), Not Visit-Only

## Problem

Task 247 (`docs/superpowers/specs/2026-08-20-schedule-planner-pms-status-sync-design.md`) added a
one-way dashboard → PMS status sync: a linked task's PMS column moves to match its calendar cell's
real status (Removed/Confirmed/Pending/Done → Done; Paused → Project Paused; otherwise To Do). That
sync only runs from `TabScheduleSection.tsx`'s own effect, gated on a tab actually being open in the
browser — there is no background trigger.

Task 279 (same day as this spec) found this gap live: a Wizard of Odds entry's status flipped to
`Done`, but its PMS card sat un-moved for hours because nobody had opened that tab's Schedule Planner
page. It was fixed by hand (a one-off Playwright walkthrough), which is not a repeatable fix — the
underlying gap is real and will recur for any tab nobody happens to visit.

This spec makes the sync run on its own, independent of page visits, while keeping it cheap and safe
against the EC2 Check Status scraper's write pattern (one `PATCH` per entry — a single scraper run
can touch 50+ rows on one tab in quick succession).

## Design

### 1. Approach: a short-interval cron sweep, not a DB trigger

Two designs were considered. A Postgres `AFTER UPDATE` trigger on `entries` would be instantaneous,
but would fire once per row — a single scraper run touching 50 rows on Rooster Partners (1,791
entries) would trigger 50 near-simultaneous whole-tab resyncs. Coalescing that properly needs a
queue table plus a drain job, which is real added complexity for a board people only glance at
periodically.

Instead: a `pg_cron` job every minute (`* * * * *`, `pg_cron`'s practical floor) re-resolves every
currently-active tab's linked statuses, exactly the same computation `TabScheduleSection.tsx`'s
effect already does today. Worst-case staleness is ~60 seconds — indistinguishable from "real time"
for a Kanban board a human is looking at, and it naturally coalesces any burst of writes within that
window into a single resync per tab. Only 11 operational tabs exist today, so a blind full sweep
every minute is cheap; no new table, no new trigger.

### 2. Extract the shared resolution logic (no more duplicated in one place)

Today, the entire resolve-and-sync computation lives inline inside `TabScheduleSection.tsx`'s status
effect (~line 497). This spec extracts it into a new exported function in
`src/lib/scheduler/pmsSync.ts` (the module already shared by `sync-schedule-pms` and
`generate-weekly-schedule`):

```ts
export async function resolveAndSyncTabStatuses(
  tab: string,
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<PmsStatusSyncResult>
```

It reassembles pieces that already exist and are already Deno-safe (confirmed via `deno check`),
mirroring `TabScheduleSection.tsx`'s effect exactly:

1. `fetchSchedulePmsLinks(tab, client)` — this tab's links. Return early (no-op) if empty.
2. `fetchRawEntriesByTab(tab, client)` (→ `fetchAllTabEntries`, already paginated) →
   `buildDateStatusIndex(entries)`.
3. `fetchActiveBrandPlatformPauses(tab, client)` for scheduler auto-pauses; for manual per-day
   pauses, fetch `brand_schedule` rows for every distinct week the links' dates fall in
   (`fetchBrandSchedule(tab, weekStart, client)` per distinct `weekdayAndWeekStartFor(link.date)`),
   matching `TabScheduleSection.tsx`'s existing manual-pause check.
4. The hidden/restricted/removed-platform-brand filter: `fetchRemovedPlatformBrandSet`,
   `buildHiddenBrandSet`/`fetchScheduleHiddenBrands`, `buildPlatformRestrictionMap`/
   `fetchScheduleRestrictedBrands`, then `resolveBrandPlatforms` per link — a link whose platform
   isn't currently allowed for that brand is skipped, same as today.
5. For each remaining link: `resolvePmsSyncStatus(brandKey, platform, date, dateStatusIndex,
   isPaused)`; skip if it matches `synced_status` already.
6. Batch the diffs through the existing `syncScheduleStatusToPms()` (unchanged — already handles
   the PMS move + `synced_status` write + per-item isolation + Task 278's grouped positioning).

`TabScheduleSection.tsx`'s own effect is refactored to call this same function instead of
duplicating the logic inline — so the on-visit path and the new cron path can never independently
drift out of agreement with each other (this project has hit that exact class of bug — two
independently-written copies of one rule silently diverging — more than once; see CLAUDE.md's
cross-dashboard-consistency note).

### 3. New Edge Function action + cron

`supabase/functions/sync-schedule-pms/index.ts` gains a new `action: 'syncAllStatuses'` branch
(no request body needed beyond the action). It must bootstrap the same tab-registry state
`generate-weekly-schedule/index.ts` already bootstraps per invocation (dynamic tabs, archived tabs,
**paused tabs** — `resetPausedTabs()` + `applyPausedTabs(rows)` before calling
`getActiveOperationalTabs()`), since this is a fresh Edge Function isolate that starts with no
registry state. Skipping this would either crash on an incomplete dynamic-tab list or silently
include tabs that are currently paused at the Brand-Tab level (a different, existing "paused" concept
from Schedule Planner's own auto/manual pause — see `pausedTabRegistry.ts`).

For each tab in `getActiveOperationalTabs()`: call `resolveAndSyncTabStatuses(tab, ...)` inside its
own `try/catch` — one tab's failure (e.g. a transient PMS API error) must never block the rest.

New migration adds the cron job, same `net.http_post` shape and the same real anon-key JWT already
inlined in the existing `generate-weekly-schedule-monday` job's migration (`20260805100000_add_
generate_weekly_schedule_cron.sql`) — that JWT is `anon`-role and long-lived (per the same file's
own comment), so reusing the identical literal value here is consistent with existing practice, not
a new secret to mint:

```sql
select cron.schedule(
  'sync-schedule-pms-status-minutely',
  '* * * * *',
  $$
    select net.http_post(
      url     := 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/sync-schedule-pms',
      body    := '{"action":"syncAllStatuses"}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer <same anon-key JWT as the existing weekly cron migration>"}'::jsonb
    )
  $$
);
```

### 4. Error handling

- Per-tab isolation (one tab's exception is caught and logged, others still run).
- Per-link isolation already exists inside `syncScheduleStatusToPms`.
- A transient PMS API outage just means that minute's run finds nothing to update for the affected
  tab(s); the next minute's run re-resolves from scratch and catches up — no queue, no retry state
  needed.
- No overlap lock. At 11 tabs, a run should complete well within a minute; if two invocations were
  ever to overlap, the second is a safe no-op for anything the first already synced (same
  `synced_status`-diff guard that makes the on-visit path idempotent today). Accepted as a
  vanishingly unlikely edge case, not engineered around.

### Out of scope

- **No change to the column-mapping table or precedence rules** from Task 247 — this spec only
  changes *when* the existing computation runs, not *what* it computes.
- **No PMS → dashboard pull changes.** Untouched.
- **No debounce/queue table.** Deliberately simpler than that — see Design §1.
- **Sub-minute latency.** Not pursued; `pg_cron`'s practical floor is 1 minute, and that's judged
  close enough to "real time" for this use case.

## Testing

- Unit tests for `resolveAndSyncTabStatuses` in `pmsSync.test.ts` (mocked client/fetch): a
  Done/Pending/Published/Removed entry moves its link to the right column; an active
  scheduler-paused or manually-paused combo is skipped; a hidden/restricted/removed-flagged
  combo is skipped; a link already matching its resolved status makes no API call; multiple tabs
  processed independently (one tab's fetch failure doesn't affect another's result).
- `deno check` on the updated `sync-schedule-pms/index.ts` and `pmsSync.ts`.
- `TabScheduleSection.tsx`'s existing behavior is unchanged from a user's perspective — verified by
  the full frontend suite passing after the refactor (no new component-level test needed; the
  extracted logic is now covered directly in `pmsSync.test.ts`).
- Live verification after deploy: change a real entry's status via the dashboard (or wait for a
  scraper run), confirm the linked PMS card moves within ~60 seconds without opening that tab's
  Schedule Planner page.
