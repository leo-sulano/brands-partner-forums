# Schedule Planner — Paused Brand Tabs Section

## Correction note

This supersedes `2026-09-01-schedule-planner-paused-brands-design.md` (deleted),
which built a whole-**brand** pause (`schedule_brand_pauses`, a new table).
That was a misread — "Brand Tabs" is this project's existing proper noun for
the per-tab pages themselves (see `feedback_brand_tabs_terminology` project
history), and this project already has a whole-**tab** pause feature
(`paused_tabs` / `src/lib/pausedTabRegistry.ts`, spec
`2026-08-20-brand-tab-pause-design.md`) — confirmed directly with the user
after they pointed at the Sidebar's existing paused-tab badges. The wrongly-
built table had zero real rows (confirmed live via REST before dropping) and
is fully reverted in the same session: migration
`20260901160000_drop_schedule_brand_pauses.sql`, plus removing its UI/query
code. `buildLastPostIndex` (`scheduleUtils.ts`) survives the revert — it's a
generic "last post per platform" helper with no dependency on the dropped
table, and this design reuses it.

## Goal

Schedule Planner's landing overview only ever showed active-tab cards — a
whole-tab-paused Brand Tab (already visible in the Sidebar with a "Paused"
badge) was invisible there, since `getActiveOperationalTabs()` excludes it
from every iteration on that page. Add a "Paused Brand Tabs" section below
the active grid, one card per paused tab, showing why it's paused, since
when, until when (if not indefinite), and every one of its brands' last
known post per platform — so someone can review a paused tab's history and
judge when to resume it, without it polluting active scheduling.

## Data model

Extends the existing `paused_tabs` table (migration
`20260901170000_add_paused_tabs_reason_and_until.sql`) rather than adding a
new one:

```sql
alter table public.paused_tabs
  add column reason text,
  add column paused_until date;

create policy "admins can update paused_tabs"
  on public.paused_tabs for update using (public.is_admin()) with check (public.is_admin());
```

`paused_at` (existing, set once at insert time) doubles as "paused since" —
no new since-column, so the two can never disagree. `paused_until` is
purely informational (does not auto-unpause), same convention the reverted
feature used. The table's original "insert-or-delete only" design gets one
real UPDATE path now: editing reason/`paused_until` on a tab that stays
paused, via a new admin-only UPDATE policy — `paused_at`/`paused_by_email`
are untouched by that path, since they mark the original pause moment, not
the latest edit.

## Query functions (`src/lib/queries.ts`)

- `pauseTab(tab, { reason?, pausedUntil? })` — extended (was `pauseTab(tab)`)
  to insert the two new fields; still insert-only, `23505` (already paused)
  still silently ignored.
- `updatePausedTabDetails(tab, { reason, pausedUntil })` — new, UPDATE only.
- `fetchPausedTabDetails()` — new, full rows (`tab`, `reason`, `pausedUntil`,
  `pausedAt`, `pausedByEmail`) for the two surfaces that display them
  (EditBrandTabModal's pause form, the new Schedule Planner section). Kept
  separate from the existing name-only `fetchPausedTabs()` so
  `pausedTabRegistry.ts`'s Deno-safe, exclusion-only bootstrap
  (`AuthContext.tsx`, `tabRegistryBootstrap.ts`, both Edge Functions) never
  needs to change shape — `isTabPaused`/`getActiveOperationalTabs`/
  `getPausedOperationalTabs` are all untouched.

## UI

- **`EditBrandTabModal.tsx`**: when Status is (or becomes) "Paused", show a
  Reason textarea and a Paused-until date input (blank = indefinite),
  pre-filled from `fetchPausedTabDetails()` on open when the tab is already
  paused. On submit: a fresh active→paused transition calls the extended
  `pauseTab`; staying paused with edited fields calls
  `updatePausedTabDetails`; paused→active is the unchanged `unpauseTab`.
- **New Schedule Planner section**, `PausedTabsSection.tsx`, rendered below
  the active-tab grid on the landing page (`showGrid` branch of
  `SchedulePlanner.tsx`) — one card per tab in `getPausedOperationalTabs()`:
  tab icon/name, reason, since (`pausedAt`) → until (or "Permanent"), and a
  table of every one of that tab's brands with their last known post per
  platform (`buildLastPostIndex`, reused unchanged from the reverted
  feature — it only ever needed `Entry[]`, never the dropped table). An
  admin-only "Resume" button calls `unpauseTab` + `unpauseTabLocally`
  directly, without needing to open Edit Brand Tab.
- Section renders nothing when `getPausedOperationalTabs()` is empty.

## Testing

- `queries.test.ts`: `pauseTab` with reason/pausedUntil, `updatePausedTabDetails`,
  `fetchPausedTabDetails` round-trips.
- `buildLastPostIndex` tests already exist (kept from the reverted feature,
  unaffected by this change).
- Build + full suite; no live Supabase credentials in this session, so live
  browser verification (pausing a tab with a reason, seeing its card, editing
  reason/until, resuming) is deferred to a follow-up check.
