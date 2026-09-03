# Weekly Schedule Approval Gate

## Goal

Every Monday an admin must approve each Brand Tab's weekly plan before it
populates the external PMS board. Until a `(tab, week)` is approved:

- the draft plan still auto-generates (cron + page visit) — it just never
  reaches the PMS;
- any approved user can edit the draft, as today.

Once approved:

- the plan's active slots are pushed to the PMS;
- only an admin can make further manual changes to that week;
- automatic pause/resume is exempt from the lock and keeps working.

## Decisions (from brainstorming)

| Question | Answer |
|---|---|
| Approval unit | Per `(tab, week_start)` — matches per-tab generation |
| Pre-approval edits | Any approved user, as today; locks to admins on approval |
| Post-approval change path | Read-only for non-admins; admin edits directly (re-syncs to PMS). No in-app request queue |
| Auto-pause vs approval | `recalculatePauses` still runs on approved weeks; exempt from the admin lock; its PMS effects still land |
| Existing data | Grandfather every already-generated `(tab, week)` as `approved` |
| Revoke | Admin can revoke → back to `pending`; existing PMS tasks are NOT deleted |
| Approach | **A** — gate at the single shared push chokepoint (`pushScheduleToPms`); approve = write row + re-run existing push. No new Edge Function action. |

## Data model

New table (`supabase/migrations/<ts>_add_weekly_schedule_approvals.sql`):

```sql
create table public.weekly_schedule_approvals (
  tab          text not null,
  week_start   date not null,
  status       text not null default 'pending' check (status in ('pending','approved')),
  approved_by  text,
  approved_at  timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (tab, week_start)
);
alter table public.weekly_schedule_approvals enable row level security;

create policy "weekly_schedule_approvals read"
  on public.weekly_schedule_approvals for select using (public.is_approved());
create policy "weekly_schedule_approvals admin insert"
  on public.weekly_schedule_approvals for insert with check (public.is_admin());
create policy "weekly_schedule_approvals admin update"
  on public.weekly_schedule_approvals for update using (public.is_admin()) with check (public.is_admin());
create policy "weekly_schedule_approvals admin delete"
  on public.weekly_schedule_approvals for delete using (public.is_admin());
```

**Not approved** = no row, or `status='pending'`. **Approved** = `status='approved'`
with `approved_by` (actor email) and `approved_at` set. **Revoke** = set
`status='pending'`, null out `approved_by`/`approved_at`, bump `updated_at`
(row kept for history).

**Grandfather (same migration):**

```sql
insert into public.weekly_schedule_approvals (tab, week_start, status, approved_by, approved_at)
select distinct tab, week_start, 'approved', 'system:grandfathered', now()
from public.brand_schedule
where platform is not null
on conflict (tab, week_start) do nothing;
```

**`brand_schedule` write-lock (same migration):** replace the existing
approved-user insert/update/delete policies with ones that additionally
require admin once the week is approved:

```sql
-- for insert / update / delete, using / with check:
public.is_approved() and (
  public.is_admin()
  or not exists (
    select 1 from public.weekly_schedule_approvals a
    where a.tab = brand_schedule.tab
      and a.week_start = brand_schedule.week_start
      and a.status = 'approved'
  )
)
```

The cron writes `brand_schedule` via the service role (bypasses RLS) so it
is unaffected. `ensureWeekGenerated` only writes *non-pinned* combos — an
approved week is fully generated (every combo pinned) so it writes nothing
regardless; the policy just formalises "no manual non-admin edits to an
approved week."

## The push gate (only server-side logic change)

`pushScheduleToPms(items, client, credentials)` in
`src/lib/scheduler/pmsSync.ts` is the one function both the cron
(`generate-weekly-schedule`) and the Edge Function (`sync-schedule-pms`)
call to create PMS tasks. At its top, filter items to approved weeks only:

```ts
const weekStartOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);       // parse local, not UTC
  return toISODate(mondayOf(new Date(y, m - 1, d)));
};
const tabs = [...new Set(items.map((i) => i.tab))];
const { data: approvedRows } = await client
  .from('weekly_schedule_approvals')
  .select('tab, week_start')
  .eq('status', 'approved')
  .in('tab', tabs);
const approvedSet = new Set((approvedRows ?? []).map((r) => `${r.tab}::${r.week_start}`));
const gated = items.filter((i) => approvedSet.has(`${i.tab}::${weekStartOf(i.date)}`));
if (gated.length === 0) return { created: 0, linked: 0, skipped: items.length };
// rest of the function runs over `gated`
```

(Exact return shape matches whatever `pushScheduleToPms` returns today —
adjust the early-return literal to that shape.)

Consequences, no other push-path code changes:

- **Cron** still generates every tab's draft; its push no-ops for any tab
  whose current week is `pending`.
- **Page-visit effect** (`TabScheduleSection.tsx` → `pushScheduleActivations`
  → `sync-schedule-pms` → `pushScheduleToPms`): draft `brand_schedule`
  rows still written; PMS push filtered out until approval.
- **Manual chip edits** pre-approval: `brand_schedule` write happens, PMS
  push filtered.
- **`pullScheduleDrift` / status sync** operate on `schedule_pms_links`,
  which only exist after a push — inert for un-approved weeks.

`toISODate` / `mondayOf` come from `../scheduleBrands.ts` with the explicit
`.ts` extension (Deno bundler requirement). `deno check` on both consumers
must stay clean.

## Approve / revoke

### Queries (`src/lib/queries.ts`)

- `fetchWeekApproval(tab, weekStart, client?)` → `{ status, approvedBy, approvedAt } | null`
- `fetchTabWeekApprovals(tab, client?)` → all rows for a tab (per-week pill
  as an admin navigates, plus the landing-grid badge)
- `approveWeek(tab, weekStart, actorEmail, client?)` → upsert
  `{ tab, week_start, status:'approved', approved_by, approved_at, updated_at }`.
  Non-admin → `42501`.
- `revokeWeekApproval(tab, weekStart, client?)` → update
  `{ status:'pending', approved_by:null, approved_at:null, updated_at }`.

### Approve flow (client, admin only — in `TabScheduleSection.tsx`)

1. `await approveWeek(tab, weekStartISO, profile.email)`.
2. Enumerate that `(tab, weekStart)`'s `active` `brand_schedule` slots,
   build `PmsSyncItem[]` (reuse this file's existing `resolveAgentForPlatform`
   agent resolution), `await pushScheduleActivations(items)` — gate now
   passes; `schedule_pms_links` idempotency means only new slots create
   tasks.
3. `await syncTabStatusToPms(tab)` — move already-evidenced slots to their
   PMS column.
4. Refetch approval state → header pill flips.

Steps 2–3 are best-effort/toasted, same as every existing PMS call; the row
is already written so a re-approve or a revisit re-flushes.

**Revoke:** `revokeWeekApproval(...)` → pill back to Draft. Existing PMS
tasks are left in place (documented). Further pushes stop until re-approved.

### Edit lock

`canEditSchedule = isApproved && (weekApproved ? isAdmin : true)` per
displayed week.

- The `isApproved={…}` prop already threaded to `ScheduleCell` /
  add-platform / pause controls (the same switch legacy weeks use) becomes
  `isApproved={canEditSchedule && !isLegacyWeekAt(col.weekStartISO)}`.
- `handleCellClick` / `handleSetDayStatus` / the cancel handler: their
  `if (!isApproved) return` guards become `if (!canEditSchedule) return`.
- DB enforcement via the `brand_schedule` RLS swap above.

## UI

**`TabScheduleSection.tsx` header, per displayed week:**
- Draft: amber pill "Draft — pending approval" + subtext "Schedule changes
  won't reach the PMS board until an admin approves this week."
- Approved: green pill "Approved by {name} · {date}".
- Admin + draft + (current or future week): "Approve week" button.
- Admin + approved: quiet "Revoke" text button.

**`SchedulePlanner.tsx` landing grid:** small amber "Pending approval"
badge on an active-tab card when its *current* week is not approved.
Nothing for approved tabs.

**Cells when `weekApproved && !isAdmin`:** read-only via the existing
legacy-week rendering path (no new branch).

## Auto-pause exemption

No code needed. `recalculatePauses` writes only `brand_platform_pause` /
`brand_platform_override`, never `brand_schedule`, so the write-lock RLS
never applies to it. A resume that generates a new slot on an
already-approved current week flows through `pushScheduleToPms` and passes
the gate. The status-sync effect that moves a paused slot's PMS card is
gated on user-`isApproved` only. So automatic pause/resume keeps working on
approved weeks and its PMS effects still land.

## Testing

- `pmsSync.test.ts`: push drops items for a `pending`/absent `(tab, week)`;
  keeps them for `approved`; mixed batch filters correctly; empty-after-
  filter returns the skip summary without hitting the PMS API.
- `queries` tests: `approveWeek` / `revokeWeekApproval` / `fetchWeekApproval`
  round-trips; non-admin `approveWeek` → `42501`.
- `generate-weekly-schedule/index_test.ts`: cron generates the draft but
  pushes nothing for an unapproved week; pushes for an approved one.
- `schedulerService.test.ts`: unchanged (no push path).
- `TabScheduleSection.tsx`: no test coverage (project norm) → `npm run build`
  + manual check.
- Full suite + `npm run build` + `deno check` on `sync-schedule-pms` and
  `generate-weekly-schedule`.

## Deploy order (strict — Task 247 lesson)

1. `supabase db push` — table + grandfather rows + `brand_schedule` RLS
   swap. **First**: `pushScheduleToPms`'s new `select` throws `42P01` if
   the table is missing, breaking all PMS pushes.
2. `supabase functions deploy sync-schedule-pms` and
   `supabase functions deploy generate-weekly-schedule` — gate logic.
3. `git push origin main` — frontend.
4. Live-verify: fresh un-approved week creates no PMS tasks on chip
   activation; admin "Approve week" flushes them; non-admin sees the week
   read-only after approval; revoke stops new pushes and leaves existing
   tasks.

## Risks / notes

- The `brand_schedule` RLS policy swap is on the scheduler's core table.
  Keep the change to exactly the added admin/approval clause; the cron's
  service-role writes bypass RLS and are unaffected.
- If `pushScheduleToPms`'s current return type is not an object, adjust the
  early-return to match (e.g. return `[]` / `undefined`) so callers don't
  break.
- Future weeks: the page-visit effect only generates the *current* week, so
  future weeks are blank until they become current — no approval needed
  ahead of time. An admin may still pre-approve a future week; harmless.
