# Schedule Planner → PMS Status Sync

## Problem

Schedule Planner already syncs to PMS in two ways (Task 231, `docs/superpowers/specs/2026-08-17-schedule-planner-pms-sync-design.md`): activating a cell creates a linked PMS task (with Agent → Assignee), and PMS due-date/assignee edits pull back onto the calendar. Neither direction touches the PMS task's own column — every linked task sits in To Do for its entire life, regardless of what the calendar cell shows.

Meanwhile the calendar cell itself already tracks real status via `dateStatusIndex`/`buildDateStatusIndex` (`src/lib/scheduler/scheduleUtils.ts`, Tasks 165/168/243/245): Removed, Confirmed ("Published" on-screen), Pending, Done, on top of the raw scheduler plan (Active/Paused). None of that is visible from the PMS side — someone working the PMS board has no way to tell which linked tasks are done, published, removed, or still pending without opening the dashboard.

This adds a third, one-way sync: dashboard cell status → PMS column. Purely additive — the two existing sync directions (push-on-activate, pull due-date/assignee drift) are unchanged.

## Design

### 1. Column mapping

| Cell status | PMS column | Column ID |
|---|---|---|
| Active (plan-only, no evidence yet) | To Do | `cmsoh1uxz000204l46gf88k3f` |
| Pending | In Progress | `cmsoh1uxz000304l4zynwy7vw` |
| Done | In Progress | `cmsoh1uxz000304l4zynwy7vw` |
| Published (Confirmed) | Review/QA | `cmsoh1uxz000404l44x2m2b9a` |
| Removed | Review/QA | `cmsoh1uxz000404l44x2m2b9a` |
| Paused | *(not synced — task stays wherever it currently is)* | — |

IDs confirmed live against the real "Forum Team" PMS project (`cmsoh1uvs000004l4fbdvqmir`) via `GET /api/projects/{id}`, cross-checked against that project's own `doneColumnId` field. Backlog and Done are not used by this feature at all — nothing currently maps to them.

Status precedence when resolving a single cell mirrors `ScheduleCell`'s existing render logic exactly (`src/lib/scheduler/calendarRenderer.tsx`), so PMS can never show a different status than the calendar itself: `Removed > Confirmed (Published) > Pending > Done > Paused > Active`. Paused is checked so it can be *excluded* from syncing (a paused platform's chip is dimmed/non-interactive and never mutates), not because it maps to any column.

### 2. Direction and trigger

One-way: dashboard → PMS only. The dashboard's entry data is the source of truth for status everywhere else in this app (Score Summary, Brand Tabs, the calendar itself); a PMS column move never writes back to `brand_schedule` or any dashboard state. This is a deliberate asymmetry from the existing due-date/assignee pull, which does write back — status here is read-only from PMS's perspective.

Checked automatically once per tab visit, alongside the existing `pullScheduleDrift` call in `TabScheduleSection.tsx` (the effect at line ~349, keyed on `[tab]`). No new button, no per-click sync — best-effort and fire-and-forget like every other PMS call in this feature, so a sync failure never blocks or is mistaken for a dashboard write failing.

### 3. Data model: tracking what's already synced

New nullable `synced_status` column on `schedule_pms_links` (migration `20260820130000_add_schedule_pms_links_synced_status.sql`), one of `'active' | 'pending' | 'done' | 'published' | 'removed'` (no `'paused'` value — a paused link is simply skipped, its `synced_status` stays whatever it last was). Defaults to `'active'` at the column level (`not null default 'active'`), covering both a newly-created link and every pre-existing row — a newly-created task already sits in To Do, which already matches, so no immediate move call is needed for a brand-new link, and no app-code change to `insertSchedulePmsLink` was needed.

Without this column, every tab visit would re-issue a `move` API call for every linked task regardless of whether its status actually changed — `synced_status` lets the sync diff against "what PMS was last told" and only call the API for links whose resolved status has actually changed since the last successful sync.

### 4. Where the computation happens

`schedule_pms_links` already has an "anyone can read" RLS policy (`20260817120000_add_schedule_pms_links.sql`), so the browser computes target statuses itself rather than duplicating entry-evidence logic into the Deno edge function. `TabScheduleSection.tsx` already builds, once per tab load:

- `dateStatusIndex` (`buildDateStatusIndex(liveEntries)`) — the same Removed/Confirmed/Pending/Done evidence the calendar renders from, keyed `brandKey::platform::date`, valid for *any* date, not just the currently-displayed week.
- `pauses` (`BrandPlatformPause[]`, fetched tab-wide via `fetchActiveBrandPlatformPauses`) — every currently-active scheduler auto-pause, each carrying its own `paused_week_start`. This is **not** scoped to whichever week happens to be displayed (an earlier draft of this section incorrectly assumed pauses had no date component at all) — a link's own week is computed independently via `weekdayAndWeekStartFor(link.date)` and matched against `paused_week_start` directly, so pause exclusion works correctly regardless of which week the user is currently viewing.

The new sync step, run in its own effect keyed on `[tab, dateStatusIndex, pauses, isApproved, scheduleLoading]` (gated on `!scheduleLoading` so it never runs against a stale, not-yet-populated `pauses` array):

1. Fetch this tab's links via the existing `fetchSchedulePmsLinks(tab, supabase)`.
2. For each link, first skip it entirely if its platform isn't in that brand's currently-allowed platform list (`brandPlatforms(link.brand)`, the same hidden/restricted/removed-platform-brand exclusion the calendar itself applies) — a combo the dashboard doesn't display anywhere must never move a PMS card either.
3. Resolve its status: check `dateStatusIndex` for that exact `brandKey::platform::date` (Removed > Confirmed > Pending > Done, matching the precedence above); if no evidence matched, check whether a `pauses` row matches both the combo and the link's own week — if paused, skip this link entirely (no sync, `synced_status` untouched); otherwise resolve to `'active'`.
4. Filter to links where the resolved status differs from `synced_status`.
5. Send the filtered list (`{ linkId, pmsTaskId, targetStatus }[]`) to a new `pushScheduleStatusSync()` wrapper in `src/lib/schedulePmsSync.ts`, mirroring `pushScheduleActivations`'s fire-and-forget/catch-and-toast pattern exactly.

**Known limitation, accepted:** this resolver only recognizes a *scheduler* auto-pause (`brand_platform_pause`), not a brand_schedule day manually cycled to `'paused'`, nor a day with no schedule row and no evidence at all — both of those currently resolve to `'active'` rather than being excluded. See CLAUDE.md's Known Issues for the full writeup and why this was deliberately scoped out rather than fixed in this pass.

### 5. Edge function / shared logic

New `syncScheduleStatusToPms()` exported from `src/lib/scheduler/pmsSync.ts` (the shared module already used by both `sync-schedule-pms` and `generate-weekly-schedule`), and a new `action: 'syncStatus'` branch in `supabase/functions/sync-schedule-pms/index.ts`.

For each `{ linkId, pmsTaskId, targetStatus }`:
- `paused` never reaches this function (filtered out client-side per step 2 above) — no special-case needed here.
- Resolve `targetStatus` to a column ID via the mapping table above.
- `PATCH /api/tasks/{pmsTaskId}/move` with `{ columnId, position: 0 }` (per the documented PMS API pattern — a dedicated endpoint, not the general task PATCH).
- On success, update `schedule_pms_links.synced_status = targetStatus` for `linkId` via the service-role client.
- Per-item try/catch, exactly like `pushScheduleToPms`'s existing loop — one failed move never blocks the rest of the batch.

### Out of scope

- **No PMS → dashboard status pull.** A human moving a PMS card by hand does not change `brand_schedule` or anything the calendar renders. Only due-date and assignee drift pull back, as today.
- **CSV/Excel export and the landing-grid mini-calendars** are untouched — this is a PMS-facing change only, no new dashboard-visible column mapping/data.
- **`generate-weekly-schedule`'s own push call** (server-side, cron-triggered) does not need this status-sync step added — that function only ever *creates* new links (always `'active'` at creation, matching To Do already), it never observes evidence changing after the fact. Status sync is a `TabScheduleSection.tsx`/tab-visit-only concern.

## Testing

- Unit tests for the new pure status-resolution/column-mapping helper (precedence order, paused exclusion, active fallback for out-of-week dates).
- Unit tests for `syncScheduleStatusToPms()` in `pmsSync.test.ts` (mocked fetch): correct column ID per status, `synced_status` updated only on a successful move, one item's failure doesn't block others, paused items are never passed in (defensive but not silently mismapped if they were).
- Unit tests for the new `pushScheduleStatusSync()` browser wrapper in `schedulePmsSync.test.ts`, matching the existing `pushScheduleActivations`/`pullScheduleDrift` test shapes.
- Migration test/spot-check: a freshly-inserted link's `synced_status` defaults to `'active'`.
