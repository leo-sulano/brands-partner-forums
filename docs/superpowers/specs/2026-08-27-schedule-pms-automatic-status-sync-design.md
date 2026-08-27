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

**Correction from the version reviewed in chat:** `TabScheduleSection.tsx` cannot call
`resolveAndSyncTabStatuses` directly — it takes `credentials: PmsCredentials` (the raw PMS API
token), which is a server-only secret (`pmsSync.ts`'s own header comment: "the browser never sees
it"). So both triggers reach this one function over HTTP, through the Edge Function — the browser
never gets a second, parallel implementation of the resolution rules:

- **Cron trigger** → `action: 'syncAllStatuses'` with no `tab` → server loops over every active tab.
- **On-visit trigger** (replaces today's `pushScheduleStatusSync(items)` call) → same
  `action: 'syncAllStatuses'` with `{ tab }` → server resolves just that one tab.

Either way, `resolveAndSyncTabStatuses` is the only place the resolution rules are implemented —
there is exactly one implementation, not "one the browser computes and one the cron computes that
happen to agree." The existing per-item `action: 'syncStatus'` (and its now-unused browser wrapper
`pushScheduleStatusSync`/`PmsStatusSyncItem` in `schedulePmsSync.ts`) are removed as dead code once
nothing calls them anymore — `syncScheduleStatusToPms` itself (the "move a pre-resolved batch"
primitive) stays, now called internally by `resolveAndSyncTabStatuses` instead of reached directly
over HTTP.

### 3. New Edge Function action + cron

`supabase/functions/sync-schedule-pms/index.ts` gains a new `action: 'syncAllStatuses'` branch,
accepting an optional `body.tab?: string`. It must bootstrap the same tab-registry state
`generate-weekly-schedule/index.ts` already bootstraps per invocation — **four** registries, not
three: dynamic (custom) tabs, **hidden tab platforms** (`getTabPlatforms(tab)` reads this — easy to
miss, since it's a separate registry from the hidden-*brand* set `resolveBrandPlatforms` reads),
archived tabs, and paused tabs (`resetPausedTabs()` + `applyPausedTabs(rows)` before calling
`getActiveOperationalTabs()`). This is needed even when `tab` is explicitly provided (a single
dynamically-created tab's own column/platform config still depends on the dynamic-tab and
hidden-platform registries being populated first).

This exact 4-registry sequence is currently hand-copied inline in `generate-weekly-schedule/index.ts`
(lines 142–190) — this spec extracts it into a new shared `bootstrapTabRegistries(client, logPrefix)`
in a new `src/lib/tabRegistryBootstrap.ts`, used by both Edge Functions, so this second copy can't
drift from the first the way this project's Known Issues have repeatedly flagged for other
duplicated-logic classes. `generate-weekly-schedule/index.ts` is refactored to call it too
(behavior-preserving — same calls, same order, just no longer inlined).

For each tab in scope (either just `body.tab`, or every `getActiveOperationalTabs()` tab when
omitted): call `resolveAndSyncTabStatuses(tab, ...)` inside its own `try/catch` — one tab's failure
(e.g. a transient PMS API error) must never block the rest. After each tab, call
`invalidateTabCache(tab)` (`src/lib/queries.ts`) — `fetchRawEntriesByTab` caches a tab's full entry
list (heavy `data` jsonb, 1,700+ rows on the largest tabs) in a module-level Map with no write-side
eviction; `generateAllTabs` already evicts per-tab for exactly this reason (Edge isolates are reused
across invocations, and this cron runs every minute — far more often than the weekly job — so
skipping this would accumulate every active tab's full entry set in memory indefinitely).

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
  combo is skipped; a link already matching its resolved status makes no API call; empty-links
  short-circuit with no other calls made.
- Unit tests for `bootstrapTabRegistries` in a new `tabRegistryBootstrap.test.ts` (mocked client):
  populates all four registries from table rows; a failed fetch for one registry degrades to empty
  (fail-open) without blocking the others.
- New `supabase/functions/sync-schedule-pms/index_test.ts` (this function has no test file today):
  `syncAllStatuses` with no `tab` processes every `getActiveOperationalTabs()` tab, isolates one
  tab's failure from the rest, and calls `invalidateTabCache` per tab; with `tab` set, processes
  only that one tab.
- `deno check` on both edge functions (`sync-schedule-pms`, `generate-weekly-schedule`) and on
  `pmsSync.ts`/`tabRegistryBootstrap.ts`.
- `TabScheduleSection.tsx`'s on-visit behavior is unchanged from a user's perspective (still syncs
  that tab immediately on visit, just via one HTTP call instead of client-side resolution) —
  verified by the full frontend suite passing after the refactor; `pushScheduleStatusSync`/
  `PmsStatusSyncItem` are removed from `schedulePmsSync.ts` along with their tests, replaced by a
  new `syncTabStatusToPms(tab: string)` wrapper with its own tests mirroring
  `pushScheduleActivations`'s existing shape.
- Live verification after deploy: change a real entry's status via the dashboard (or wait for a
  scraper run), confirm the linked PMS card moves within ~60 seconds without opening that tab's
  Schedule Planner page; also confirm opening a tab still syncs it immediately (on-visit path).
