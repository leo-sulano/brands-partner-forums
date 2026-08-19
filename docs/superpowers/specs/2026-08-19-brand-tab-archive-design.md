# Brand Tab Archive (Delete, Reversibly) — All Tabs, With a Required Reason

**Requested by:** Leo, via chat — reported that hardcoded Brand Tabs (e.g. Rooster
Partners) have no delete option at all (only dynamic/self-service tabs do, by
design as of Task 232/239), and asked for one, plus a required reason captured
on delete. Scope was narrowed interactively — see decisions below; several of
them reverse decisions Task 232/238/239 deliberately made, on purpose, per this
conversation.

## Current behavior (for reference)

- `BrandGroup.tsx`'s toolbar shows a pencil ("Edit Brand Tab") for every tab
  (`isApproved` gate only), and a trash icon **only when `isDynamicTab(tab)`**
  — hardcoded tabs (the 11 in `TAB_COLUMN_CONFIGS`) have no delete affordance
  at all. This was intentional: Task 232's design explicitly scoped deletion to
  self-service tabs only.
- The existing dynamic-tab delete (`deleteCustomTab`, `src/lib/queries.ts`) is
  a **hard delete**: blocked while the tab still has any `entries` rows,
  otherwise snapshots the `custom_tabs` row into `delete_log` (`entity_type =
  'tab'`, `entity_id` = the row's uuid) and deletes it. Restorable via the
  existing `restoreDeletedEntity`/Activity Log mechanism (Task 238).
- `delete_log.entity_id` is `uuid not null` — there is no uuid for a hardcoded
  tab to key off, since it has no row in any table. The existing mechanism
  cannot represent a hardcoded tab at all without a schema change.
- `OPERATIONAL_TABS` (`src/lib/tabs.ts`) starts as `Object.keys(TAB_COLUMN_CONFIGS)`
  (the 11 hardcoded tabs) and is mutated **in place** by
  `dynamicTabRegistry.ts`'s `registerDynamicTabs`/`unregisterDynamicTab` to
  add/remove dynamic tabs — this in-place mutation is what gives every one of
  its ~12 existing readers (Sidebar, Overview, Score Summary, Schedule
  Planner, both entry modals, BrandGroup) a live update with zero call-site
  changes, via a shared `tab-platforms-changed` window event.
- Ask AI's `list_tabs` tool (`supabase/functions/ai-assistant/tools.ts`) does a
  live distinct-scan of real `entries.tab` values — it does not read
  `OPERATIONAL_TABS`/`TAB_COLUMN_CONFIGS` at all.
- `generate-weekly-schedule` (undeployed, pending — see Known Issues) resets
  and re-registers dynamic tabs from scratch on every invocation, since Deno
  isolates persist across invocations.

## Decisions (confirmed interactively)

1. **Scope: all tabs, hardcoded and dynamic alike.** The 11 hardcoded tabs
   become archivable, reversing Task 232's original scoping decision.
2. **Semantics: archive (hide), never hard-delete, for any tab.** Nothing is
   destroyed — no entries, no `custom_tabs` row, nothing. This also reverses
   Task 232/238's hard-delete-when-empty behavior for dynamic tabs: that path
   is retired, not kept alongside the new one. An archived tab's name stays
   permanently reserved until explicitly unarchived.
3. **Required reason**, captured at archive time.
4. **Reason visibility: Activity Log only** — no separate "Archived Tabs"
   admin page. Unarchiving therefore also happens through the Activity Log's
   existing restore-button pattern, not a dedicated management screen.
5. **Access: `isApproved`**, matching every other tab-management action in this
   feature area (rename, toolbar filters, dynamic-tab create) — not
   admin-only, despite hardcoded tabs carrying real production data.
6. **Reach: fully excluded everywhere** — Sidebar, Overview, Score Summary,
   Schedule Planner (including its weekly cron and PMS push), and Ask AI. Not
   just a Sidebar/routing-level hide.
7. **Known trade-off, accepted:** a throwaway dynamic tab created to test this
   live can no longer be cleanly removed afterward through the app UI — only
   archived. Test residue needs a manual SQL delete via the Supabase SQL
   editor (the same ad hoc pattern already used for other one-off test-data
   cleanup in this project), not the app UI.

## Data model

### New table: `tab_archive_log`

Shaped like the existing `delete_log`/`edit_log` audit tables, but keyed by
`tab` (text) instead of `entity_id` (uuid) — deliberately **not** reusing
`delete_log`, whose `entity_id uuid not null` column has nothing to point at
for a hardcoded tab (no row, no uuid, anywhere). A fresh, single-purpose table
keeps this feature isolated from the already-shipped, already-tested
entry/account restore code in `delete_log`/`edit_log`, rather than risking a
regression there.

```sql
create table public.tab_archive_log (
  id                 uuid primary key default gen_random_uuid(),
  tab                text not null,
  reason             text not null,
  actor_email        text not null,
  created_at         timestamptz not null default now(),
  restored_at        timestamptz,
  restored_by_email  text
);

-- only one *active* (non-restored) archive row per tab at a time
create unique index tab_archive_log_active_idx
  on public.tab_archive_log (tab) where restored_at is null;

alter table public.tab_archive_log enable row level security;

create policy "approved users can read tab_archive_log"
  on public.tab_archive_log for select using (public.is_approved());
create policy "approved users can insert tab_archive_log"
  on public.tab_archive_log for insert with check (public.is_approved());
create policy "approved users can restore tab_archive_log"
  on public.tab_archive_log for update
  using (public.is_approved()) with check (public.is_approved());
```

A row with `restored_at is null` means that `tab` is currently archived —
this is the single source of truth for "is X archived," both for the
frontend's bootstrap fetch and for the two Edge Functions. "Unarchive" sets
`restored_at`/`restored_by_email` on that same row (same restore vocabulary
already used everywhere else in this app).

The existing `delete_log('tab')` rows, its migration, and
`restoreDeletedEntity`'s `'tab'` branch are left completely untouched — they
represent real history from before this change and remain harmless; nothing
new is ever written there again (see "Retiring hard-delete" below).

## Frontend mechanism

### New module: `src/lib/archivedTabRegistry.ts`

Same Deno-safety constraints as `dynamicTabRegistry.ts` (no React/npm
imports, no I/O) — this module is also imported by the
`generate-weekly-schedule` Edge Function.

- `archiveTabLocally(tab: string): void` — adds `tab` to an in-memory
  `archivedTabNames: Set<string>`, splices it out of `OPERATIONAL_TABS` if
  present, fires the existing `tab-platforms-changed` event (imported from
  `dynamicTabRegistry.ts`, or a shared helper factored out — implementation
  detail for the plan).
- `unarchiveTabLocally(tab: string): void` — removes `tab` from
  `archivedTabNames`, re-inserts it into `OPERATIONAL_TABS` if not already
  present (append at the end is fine — sidebar order isn't load-bearing here,
  unlike rename's position-preserving splice), fires the same event.
- `applyArchivedTabs(rows: { tab: string }[]): void` — calls
  `archiveTabLocally` for each row; used once at bootstrap and once per cron
  invocation.
- `resetArchivedTabs(): void` — calls `unarchiveTabLocally` for everything
  currently in `archivedTabNames`; mirrors `dynamicTabRegistry.ts`'s
  `resetDynamicTabs`, needed by the same warm-Deno-isolate concern.
- `isTabArchived(tab: string): boolean`.

### `AuthContext.tsx` bootstrap

Add a fourth parallel fetch, `fetchArchivedTabs()`, same fail-open
`.catch(() => [])` pattern as the other three. Critically, it's applied via
`applyArchivedTabs(...)` **after** `registerDynamicTabs(...)` in the same
`.then(...)` — a dynamic tab that's since been archived must be registered
and then immediately removed again in that order, not the reverse, or it
would incorrectly reappear.

### `generate-weekly-schedule` (Deno, already undeployed/pending)

After its existing per-invocation `resetDynamicTabs()` +
`registerDynamicTabs(...)`, it also calls `resetArchivedTabs()` +
`applyArchivedTabs(...)` (freshly fetched) before its per-tab generation
loop runs — same reasoning, same shape as the dynamic-tab reset it already
does. Code change now; deploy stays pending, consistent with this function's
existing Known Issues entry.

## `queries.ts` changes

- **Remove** `deleteCustomTab` entirely (entries-count guard,
  `delete_log('tab')` write, the actual delete) — retired per decision 2.
- `archiveTab(tab: string, reason: string): Promise<void>` — inserts into
  `tab_archive_log`; a `23505` (unique-index violation, i.e. already
  archived) is translated into a friendly `Error`.
- `unarchiveTab(logId: string): Promise<void>` — updates the row
  (`restored_at`, `restored_by_email`) `where id = logId and restored_at is
  null`; throws a friendly error if zero rows were affected (already
  restored, or an RLS-denied silent no-op — same `count: 'exact'` trap this
  file's other restore paths already guard against).
- `fetchArchivedTabs(client?): Promise<{ tab: string }[]>` — active
  (`restored_at is null`) rows only; used by `AuthContext`'s bootstrap and by
  both Edge Functions.
- `fetchRecentTabArchives(limit = 50): Promise<TabArchivedEvent[]>` — **all**
  rows (active and already-restored), ordered by `created_at desc`, for the
  Activity Log feed.

## UI changes

### `BrandGroup.tsx`

- The trash-icon button's guard changes from `isApproved && isDynamicTab(tab)`
  to `isApproved` only — same position, every tab. Swapping the icon from
  `Trash2` to `Archive` (both already available via `lucide-react`) since
  "trash" now reads as more destructive than what this action actually does.
- The confirmation modal (currently inline state:
  `showDeleteTabModal`/`deleteTabConfirmText`) is reworked in place —
  renamed state, new copy: "Archive '\<tab\>'?", explaining it disappears
  from the whole dashboard for everyone until unarchived (no longer "cannot
  be undone" — it can). Gains a **required** reason textarea. Keeps the
  existing type-`yes`-to-confirm step. The old "blocked while entries exist"
  check is removed — archiving is always safe regardless of entry count.
- On confirm: `archiveTab(tab, reason)` → `archiveTabLocally(tab)` → navigate
  away (same as today's post-delete navigate-to-Overview).
- **New early guard:** if `isTabArchived(decodedTab)`, render a small "This
  tab has been archived" message with a link back to Overview instead of the
  normal table — covers direct navigation to a bookmarked/stale
  `/brands/:tab` URL for a tab no longer in `OPERATIONAL_TABS`.

### `tabValidation.ts`

`validateNewTabName` gains an `isTabArchived(trimmed)` check, alongside its
existing `OPERATIONAL_TABS`/`TAB_COLUMN_CONFIGS` collision check — otherwise,
once an archived *dynamic* tab is spliced out of `OPERATIONAL_TABS`, someone
could create a brand-new tab with the exact same name while the archived
one's `custom_tabs` row and `entries` still exist. (Hardcoded names are safe
either way, since `TAB_COLUMN_CONFIGS` is static and never touched by
archiving.) Same message shape as the existing collision error, naming the
archived state explicitly so it's clear unarchiving is the fix.

### `ActivityLog.tsx`

A fourth `Promise.allSettled` source, `fetchRecentTabArchives()`, merged
alongside the existing three (entry edits, admin logs, tab creations). New
feed-entry rendering: "Brand Tab archived by X — Reason: \<reason\>", with a
Restore control while `restored_at` is null (wired to `unarchiveTab` →
`unarchiveTabLocally`, so the Sidebar/etc. update immediately with no
reload) — same UI shape as the existing account/entry/tab-delete restore
affordance, just pointed at the new table. This is a genuinely new
event kind, distinct from any historical `delete_log('tab')` rows (which
keep rendering exactly as they do today, unaffected).

## Ask AI (`supabase/functions/ai-assistant/tools.ts`)

- `list_tabs` (a live `entries.tab` distinct-scan, not
  `OPERATIONAL_TABS`-based) gets an explicit exclusion against
  `tab_archive_log`'s currently-active rows, via a new
  `fetchArchivedTabNames(supabase)` helper matching this file's existing
  style (e.g. `fetchRemovedPlatformBrandSet`).
- Tools that return tab-scoped data without an explicit `tab` argument
  (`query_entries`, `get_score_summary`, `get_schedule`, `get_paused_combos`,
  `get_success_rate_by_field`, etc.) exclude archived tabs' rows from their
  results by default, and their descriptions disclose this — same
  "may be archived" wording pattern Task 220 already established for
  hidden/restricted/removed-brand exclusions, so the model says that instead
  of wrongly claiming a tab "doesn't exist."
- Own Deno tests (`tools_test.ts`) cover the new exclusion. Code change now;
  `supabase functions deploy ai-assistant` stays a documented pending step,
  the same established pattern as every other Ask AI change in this
  project's history.

## Verified-for-free vs. verified-in-review

Overview, Score Summary, and the export helpers (`brandExport.ts`,
`scoreSummaryExport.ts`) enumerate tabs via `OPERATIONAL_TABS`, so archiving
should reach them automatically through the in-place mutation, with no
separate code change. This will be **explicitly checked** during the
whole-branch review rather than assumed — Task 219 found exactly this shape
of surface (`TAB_ICONS`) had quietly drifted into an independent,
un-synced copy before.

## Error handling

- **Double-archive:** the partial unique index makes a second archive
  attempt fail with `23505`; `archiveTab` translates this into "X is already
  archived."
- **Double-unarchive / stale restore click:** `unarchiveTab`'s
  `where restored_at is null` guard means a second click (e.g. two open
  browser tabs) affects zero rows; surfaced as a friendly "already
  unarchived" error rather than a silent no-op.
- **Archived-name reuse:** blocked by `validateNewTabName`'s new check (see
  above), before either the create or rename RPC is ever called.

## Testing

- Unit tests for `archivedTabRegistry.ts`: `archiveTabLocally`/
  `unarchiveTabLocally` correctly splice `OPERATIONAL_TABS` for both a
  hardcoded and a dynamic tab name, `isTabArchived` reflects state, event
  fires, `resetArchivedTabs` clears everything.
- `queries.test.ts`: `archiveTab` (success, `23505` → friendly error),
  `unarchiveTab` (success, zero-rows-affected → friendly error),
  `fetchArchivedTabs`, `fetchRecentTabArchives`. Existing `deleteCustomTab`
  tests are removed along with the function.
- `tabValidation.test.ts`: new case for a candidate name colliding with a
  currently-archived tab.
- Ask AI's `tools_test.ts`: `list_tabs` excludes an archived tab; at least
  one tab-scoped data tool excludes archived-tab rows by default.
- Full existing suite + `npm run build` must still pass.
- **Live verification**, given the stakes of touching a real hardcoded tab:
  1. Archive a real, low-traffic hardcoded tab (GRG - Gulf Recovery Group, 14
     entries) with a reason; confirm it vanishes from the Sidebar, Overview,
     and Score Summary immediately (no reload), and that navigating directly
     to its old URL shows the "archived" message instead of its data.
  2. Confirm the Activity Log shows the archive event with the reason, and
     that clicking Restore brings it back everywhere with no reload.
  3. Separately, create a throwaway dynamic tab, archive it, confirm the
     same reach, then unarchive it, then clean up its `custom_tabs`/`entries`
     rows via a manual SQL delete in the Supabase SQL editor (per the
     accepted trade-off above — there is no in-app way to remove it anymore).
  4. Confirm creating a new tab with the same name as a currently-archived
     one is rejected with the new collision message.

## Non-goals

- A dedicated "Archived Tabs" management page/list (reason visibility is
  Activity Log only, per decision 4).
- Any hard-delete path for any tab, hardcoded or dynamic (decision 2).
- Changing anything about `delete_log`/`edit_log`'s existing entry/account
  restore behavior.
- Automatically running the two pending Edge Function deploys
  (`generate-weekly-schedule`, `ai-assistant`) — both stay documented,
  pending, manual steps, matching this project's established practice.
