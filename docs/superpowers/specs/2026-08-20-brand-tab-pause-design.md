# Brand Tab Pause (Lightweight, Reversible Aggregation Exclusion)

**Requested by:** Leo, via chat — wants a way to pause a whole Brand Tab so it
stops counting anywhere the dashboard aggregates across tabs (Overview, Score
Summary, Schedule Planner, Ask AI), while the tab itself stays fully usable.

## Relationship to the existing Brand Tab Archive feature (Task 240)

This project already shipped a whole-tab, cross-dashboard exclusion mechanism
one day before this request: **Task 240, "Brand Tab Archive"**
(`docs/superpowers/specs/2026-08-19-brand-tab-archive-design.md`,
`src/lib/archivedTabRegistry.ts`). Archive and Pause are two deliberately
different tools, confirmed interactively, not one feature with two names:

| | Archive (existing) | Pause (this spec) |
|---|---|---|
| Reach | Vanishes from Sidebar and everywhere else | Stays visible in Sidebar, marked "Paused" |
| Own page (`BrandGroup.tsx`) | Blocked — shows "This tab has been archived" | Fully functional — view/add/edit entries normally |
| Who can toggle | Any approved user (`isApproved`) | Admins only (`isAdmin`) |
| Friction | Required reason + type-`yes` confirmation modal | Instant toggle, no reason |
| History | Full audit trail (`tab_archive_log`, restore via Activity Log) | Current state only, no log |
| Trigger UI | Trash/Archive icon in `BrandGroup.tsx` toolbar | "Status" select inside the existing Edit Brand Tab modal |

Archive is for tabs that are effectively retired. Pause is for a tab that's
temporarily on hiatus but still needs to be viewed/edited directly — e.g. a
brand group not being actively worked this week, without losing the ability
to open it and make changes.

Both mechanisms are independent and can, in principle, both apply to the same
tab (archiving already-excludes everything pause would; pausing an archived
tab is a no-op in practice since the tab isn't reachable to toggle it from).
No code needs to reconcile the two — they're never both true in a way that
matters, since Archive's own guard already blocks reaching the Edit Brand Tab
modal for an archived tab (`BrandGroup.tsx`'s archived-tab early-return
prevents the toolbar, and therefore the modal, from rendering at all).

## Decisions (confirmed interactively)

1. **Scope: whole Brand Tab**, hardcoded or dynamic alike — same reach as
   Archive's tab-level granularity, not per-brand-within-a-tab.
2. **Sidebar stays visible**, tab gets a small "Paused" badge next to its
   name; still fully clickable/navigable.
3. **`BrandGroup.tsx`'s own page for that tab is unaffected** — viewing,
   searching, adding, and editing entries all work exactly as today. Gets the
   same small "Paused" badge next to the tab name in its header, for
   awareness only.
4. **Admins only** (`isAdmin`), not `isApproved` — a stricter bar than every
   other tab-management action in this feature area, since this affects what
   every approved user sees dashboard-wide.
5. **No required reason, no confirmation modal, no audit log.** A quick
   toggle: current state only (is this tab paused right now, yes/no), not an
   event history.
6. **Trigger UI: a "Status" select (Active / Paused) inside the existing Edit
   Brand Tab modal** (`EditBrandTabModal.tsx`), not a separate toolbar
   button. Only rendered when the current user is an admin — a non-admin
   approved user sees the modal exactly as it looks today, with no visible
   gap where the field would be.
7. **Reach: excluded from Overview, Score Summary, Schedule Planner (grid,
   weekly cron, PMS push), and Ask AI** — the same four external-aggregation
   surfaces Archive's own "reach" decision named, minus the tab's own page
   and minus the tab-picker dropdowns used for direct data entry (see
   "Deliberately NOT filtered" below — this is Pause's one real reach
   difference from Archive, and it's intentional, not an oversight).

## Data model

### New table: `paused_tabs`

Deliberately not reusing `tab_archive_log` (that table's `reason not null`
and audit-history shape don't fit a reasonless, historyless toggle) and not
reusing `custom_tabs` (only covers dynamic tabs, and a hardcoded tab has no
row there to add a column to).

```sql
create table public.paused_tabs (
  tab            text primary key,
  paused_by_email text not null,
  paused_at      timestamptz not null default now()
);

alter table public.paused_tabs enable row level security;

create policy "approved users can read paused_tabs"
  on public.paused_tabs for select using (public.is_approved());
create policy "admins can insert paused_tabs"
  on public.paused_tabs for insert with check (public.is_admin());
create policy "admins can delete paused_tabs"
  on public.paused_tabs for delete using (public.is_admin());
```

A row's mere presence means that `tab` is currently paused — no
`restored_at`-style column, since there is no history to preserve.
`is_admin()`/`is_approved()` are the same existing helper functions
`profiles`/`admin_logs`/`tab_archive_log` already use. Read access is
`is_approved()`, not `is_admin()`, because every consuming surface (Sidebar
badge, Overview/Score Summary/Schedule Planner filtering) is reached by any
approved user, not just admins — only the insert/delete (the toggle itself)
is admin-gated.

No `UPDATE` policy — a status change is always an insert (pause) or a delete
(unpause), never an update to an existing row.

## Frontend mechanism

### New module: `src/lib/pausedTabRegistry.ts`

Same Deno-safety constraints as `dynamicTabRegistry.ts`/
`archivedTabRegistry.ts` (no React/npm imports, no I/O) — also imported by
the `generate-weekly-schedule` Edge Function.

Deliberately does **not** mutate `OPERATIONAL_TABS` in place the way
`archivedTabRegistry.ts` does — that mutation is exactly what makes a tab
disappear from every one of `OPERATIONAL_TABS`' ~12 existing readers,
including the Sidebar, which is the one place this feature needs a paused
tab to keep appearing.

- `pausedTabNames: Set<string>` — module-level state.
- `pauseTabLocally(tab: string): void` — adds to the set, fires the existing
  `tab-platforms-changed` window event (imported from `dynamicTabRegistry.ts`,
  same shared dispatch helper) so already-mounted listeners (Sidebar, Topbar)
  re-render immediately.
- `unpauseTabLocally(tab: string): void` — removes from the set, fires the
  same event.
- `applyPausedTabs(rows: { tab: string }[]): void` — calls
  `pauseTabLocally` for each row; used once at bootstrap and once per cron
  invocation.
- `resetPausedTabs(): void` — clears `pausedTabNames`; mirrors
  `resetDynamicTabs`/`resetArchivedTabs`, needed for the same warm-Deno-isolate
  reset reason.
- `isTabPaused(tab: string): boolean`.
- `getActiveOperationalTabs(): string[]` — `OPERATIONAL_TABS.filter((t) =>
  !isTabPaused(t))`. This is the one new export every aggregation surface
  below switches to in place of reading `OPERATIONAL_TABS` directly.

Reusing `tab-platforms-changed` rather than inventing a `tab-pause-changed`
event is deliberate: Sidebar and Topbar already listen for it (to catch
dynamic-tab and archive changes), so a paused tab's badge appears immediately
with zero new listener code.

### `AuthContext.tsx` bootstrap

A new parallel fetch, `fetchPausedTabs()`, same fail-open `.catch(() => [])`
pattern as the other four bootstrap fetches, applied via
`applyPausedTabs(...)`. Unlike the dynamic-tabs-then-archived-tabs ordering
requirement, order relative to those two doesn't matter here — pause never
touches `OPERATIONAL_TABS` membership, only the separate `pausedTabNames` set.

### `generate-weekly-schedule` (Deno, already pending deploy)

After its existing `resetDynamicTabs`/`registerDynamicTabs` and
`resetArchivedTabs`/`applyArchivedTabs` steps, add the equivalent
`resetPausedTabs()` + `applyPausedTabs(await fetchPausedTabs(client))`, then
change its per-tab generation loop from `generateAllTabs(OPERATIONAL_TABS,
...)` to `generateAllTabs(getActiveOperationalTabs(), ...)` — a paused tab's
weekly schedule (and its PMS task push) stops generating for as long as it
stays paused, and resumes the next Monday after it's unpaused. Code change
now; deploy stays a documented pending step, consistent with this function's
existing Known Issues entry (it was already undeployed before this change).

`TabScheduleSection.tsx` (the per-tab scheduler UI that actually triggers
`ensureWeekGenerated`/the PMS push from the browser) takes a single `tab`
prop and is only ever mounted for the tab currently selected in
`SchedulePlanner.tsx`'s dropdown — since that dropdown excludes paused tabs
(below), this component can never mount for a paused tab through the normal
UI, so it needs no change of its own.

## `queries.ts` changes

- `pauseTab(tab: string): Promise<void>` — plain `insert` into `paused_tabs`
  (`{ tab, paused_by_email: <current user's email> }`), catching a `23505`
  (unique-violation, i.e. already paused) and treating it as a silent no-op
  rather than an error — consistent with this feature's "quick toggle"
  framing (Archive's error-on-double-archive doesn't apply here, since
  there's no audit-log slot a duplicate would corrupt). Deliberately **not**
  an `upsert`: since `tab` is the primary key, upserting an existing row
  requires Postgres to run the `ON CONFLICT DO UPDATE` path, which needs
  `UPDATE` privilege under RLS — and this table intentionally has no UPDATE
  policy (see below). A plain insert-with-conflict-caught avoids needing one.
- `unpauseTab(tab: string): Promise<void>` — deletes the row
  (`where tab = tab`); deleting a row that's already gone is a silent no-op,
  not an error, same reasoning.
- `fetchPausedTabs(client?): Promise<{ tab: string }[]>` — all rows; used by
  `AuthContext`'s bootstrap and by `generate-weekly-schedule`.

## UI changes

### `EditBrandTabModal.tsx`

- Imports `useAuth` for `isAdmin`, and `isTabPaused`/`pauseTabLocally`/
  `unpauseTabLocally` from `pausedTabRegistry.ts`.
- New state: `status: 'active' | 'paused'`, initialized from
  `isTabPaused(tabName) ? 'paused' : 'active'`.
- A new "Status" field (a two-option `<select>`, Active / Paused) renders
  **only when `isAdmin` is true** — positioned after the existing "Platforms"
  section, before "Toolbar Filters". A non-admin approved user's modal is
  visually identical to today's.
- In `handleSubmit`, after the existing platform/filter/rename writes: if
  `status` changed from the initial value, call `pauseTab(tabName)` or
  `unpauseTab(tabName)` (whichever direction), then the matching
  `pauseTabLocally`/`unpauseTabLocally` for the immediate local update — same
  "write to DB, then mutate the local registry" order the platform-toggle
  code in this same function already follows.
- No confirmation step, no reason field — consistent with decision 5.

### Sidebar badge

`Sidebar.tsx`'s existing `OPERATIONAL_TABS.map((tab) => ...)` render (already
unfiltered, showing every tab) gains a small "Paused" pill next to a paused
tab's label, driven by `isTabPaused(tab)`. The tab's link/click behavior is
untouched — still fully navigable.

### `BrandGroup.tsx` header badge

The page header for a tab reads `isTabPaused(decodedTab)` and shows the same
small "Paused" badge next to the tab name — informational only, no gating of
any kind. The existing tab-switcher dropdown (`OPERATIONAL_TABS.map((t) =>
...)` around line 2957) is left unfiltered on purpose (see "Deliberately NOT
filtered" below).

## Aggregation surfaces switched to `getActiveOperationalTabs()`

- **`Overview.tsx`** — both `OPERATIONAL_TABS.map(...)` KPI-fetch loops
  (tab-level KPIs and brand-level KPIs).
- **`ScoreSummary.tsx`** — `fetchAllEntries(OPERATIONAL_TABS)` call.
- **`SchedulePlanner.tsx`** — five call sites: the `TAB_OPTS` dropdown
  (so a paused tab can't be selected to view/generate its schedule), the
  `sessionStorage`-restored tab-selection filter (so a previously-selected,
  since-paused tab doesn't silently restore), the agent-list fetch loop, the
  preview-entries fetch loop, and the landing-grid per-tab preview cards
  (`showGrid` render). If a tab is paused while a user already has its own
  schedule grid open, that session isn't force-navigated away — same
  accepted trade-off Archive's own spec left unaddressed for the analogous
  case.
- **`generate-weekly-schedule`** — per-tab generation loop (see above).
- **Export helpers** (`brandExport.ts`, `scoreSummaryExport.ts`) — verified
  to need **no** change: neither reads `OPERATIONAL_TABS` directly: they
  operate on data already fetched by their caller page, so once
  `ScoreSummary.tsx` filters at the fetch level, its export inherits the
  filtering automatically. Will be re-confirmed in the whole-branch review
  rather than assumed, per this project's established practice.

## Deliberately NOT filtered

These `OPERATIONAL_TABS` readers are left exactly as they are — a real,
intentional difference from Archive's "everywhere" reach, not an oversight:

- **`BrandGroup.tsx`'s tab-switcher dropdown** — navigating directly to a
  paused tab's own page is exactly what decision 3 preserves.
- **`AddReviewAccountModal.tsx` / `EditEntryModal.tsx`'s tab pickers** — a
  paused tab can still receive new/edited entries; pausing only affects
  cross-dashboard aggregation, not data entry.
- **`BrandTabsModal.tsx`** — a Sidebar-adjacent navigation aid, same category
  as the Sidebar itself; stays fully populated. (Optionally gets the same
  "Paused" badge treatment as Sidebar for visual consistency — a small,
  independent addition, not load-bearing for the feature's core behavior.)

## Ask AI (`supabase/functions/ai-assistant/tools.ts`)

Mirrors the Archive precedent exactly, since this file does a live
`entries.tab` distinct-scan and never reads `OPERATIONAL_TABS`:

- New `fetchPausedTabNameSet(supabase)` helper, same shape as the existing
  `fetchArchivedTabNameSet`.
- Every one of the ~7 spots that already exclude `archivedSet` (`list_tabs`,
  `query_entries`, `get_score_summary`, `get_success_rate_by_field`,
  `get_schedule`, `get_paused_combos`, `get_review_texts`) additionally
  excludes `pausedSet` at the same filter point (`!archivedSet.has(e.tab) &&
  !pausedSet.has(e.tab)`).
- Tool descriptions gain "may be paused" alongside the existing "may be
  archived" wording, so the model says that instead of wrongly claiming a
  tab doesn't exist — same anti-hallucination pattern Task 220/240 already
  established.
- Own Deno tests (`tools_test.ts`) cover the new exclusion, mirroring the
  existing archived-tab test shape.
- Code change now; `supabase functions deploy ai-assistant` stays a
  documented pending manual step, the same established pattern as every
  prior Ask AI change in this project.

## Error handling

- **Non-admin somehow triggers a pause/unpause call** (shouldn't be
  reachable — the Status field only renders for `isAdmin`): RLS blocks the
  insert/delete server-side regardless, so this fails closed even if the UI
  gate were ever bypassed.
- **Two admins toggle the same tab concurrently:** upsert-on-pause and
  delete-on-unpause both self-heal to whichever write lands last — no
  special handling needed, consistent with "current state only, no history"
  (decision 5).
- **Pausing an already-paused tab / unpausing an already-active one:**
  no-ops, not errors (see `queries.ts` changes above).

## Testing

- `pausedTabRegistry.test.ts`: `pauseTabLocally`/`unpauseTabLocally` never
  modify `OPERATIONAL_TABS` (regression-locks the one real difference from
  `archivedTabRegistry.ts`'s splice behavior); `isTabPaused` reflects state;
  `getActiveOperationalTabs()` excludes paused tabs and nothing else;
  `applyPausedTabs`/`resetPausedTabs` bulk behavior; the shared event fires.
- `queries.test.ts`: `pauseTab` (insert, and a second call is a no-op, not an
  error), `unpauseTab` (delete, and a second call on an already-absent row is
  a no-op), `fetchPausedTabs`.
- `EditBrandTabModal.test.tsx` (or equivalent): the Status field renders only
  when `isAdmin`; submitting a changed status calls the right
  pause/unpause + local-registry pair; submitting an unchanged status calls
  neither.
- Ask AI's `tools_test.ts`: `list_tabs` excludes a paused tab; at least one
  tab-scoped data tool excludes a paused tab's rows by default.
- Full existing suite + `npm run build` must still pass.
- **Live verification**, same stakes as Archive's:
  1. As an admin, pause a real, low-traffic hardcoded tab (e.g. "GRG - Gulf
     Recovery Group") via Edit Brand Tab; confirm the Sidebar shows a
     "Paused" badge immediately (no reload) while the tab stays clickable.
  2. Confirm its own `BrandGroup.tsx` page still works fully — view, add, and
     edit an entry — while paused.
  3. Navigate to Overview, Score Summary, and Schedule Planner; confirm the
     paused tab is absent from all three (KPI aggregates, tab dropdown/grid,
     landing-grid preview cards).
  4. As a non-admin approved user, open the same tab's Edit Brand Tab modal;
     confirm no Status field is visible and the rest of the modal behaves
     identically to before this feature.
  5. Unpause the tab; confirm it reappears in Overview/Score Summary/Schedule
     Planner and the Sidebar badge disappears, all without a reload.

## Non-goals

- Any Activity Log entry or history of past pause/unpause events (decision
  5) — current state only.
- A required reason or confirmation step of any kind.
- Excluding a paused tab from its own page, its tab-switcher dropdown, or
  either entry-creation/edit modal's tab picker (see "Deliberately NOT
  filtered").
- Per-brand-within-a-tab pausing — this is whole-tab only, matching
  Archive's granularity (decision 1).
- Automatically running the two pending Edge Function deploys
  (`generate-weekly-schedule`, `ai-assistant`) — both stay documented,
  pending, manual steps, matching this project's established practice.
- Reconciling Archive and Pause state beyond what already falls out of
  Archive's existing guard (an archived tab's Edit Brand Tab modal is
  already unreachable, so the two states can't meaningfully conflict).
