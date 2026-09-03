-- Weekly schedule approval gate.
--
-- Every Monday an admin must approve each Brand Tab's weekly plan before it
-- populates the external PMS board. Until a (tab, week) is approved the draft
-- still auto-generates (cron + page visit) but never reaches the PMS; once
-- approved, only an admin can make further MANUAL changes to that week
-- (automatic pause/resume is exempt -- it writes brand_platform_pause, never
-- brand_schedule).
--
-- Design: docs/superpowers/specs/2026-09-03-weekly-schedule-approval-gate-design.md
-- The PMS push gate itself lives in src/lib/scheduler/pmsSync.ts
-- (pushScheduleToPms), which reads this table via fetchApprovedScheduleWeeks.

create table public.weekly_schedule_approvals (
  tab          text not null,
  week_start   date not null,
  status       text not null default 'pending' check (status in ('pending', 'approved')),
  approved_by  text,
  approved_at  timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (tab, week_start)
);

alter table public.weekly_schedule_approvals enable row level security;

create policy "weekly_schedule_approvals read"
  on public.weekly_schedule_approvals for select
  using (public.is_approved());
create policy "weekly_schedule_approvals admin insert"
  on public.weekly_schedule_approvals for insert
  with check (public.is_admin());
create policy "weekly_schedule_approvals admin update"
  on public.weekly_schedule_approvals for update
  using (public.is_admin()) with check (public.is_admin());
create policy "weekly_schedule_approvals admin delete"
  on public.weekly_schedule_approvals for delete
  using (public.is_admin());

-- Grandfather: every (tab, week) that already has a real (platform-tagged)
-- schedule at ship time is marked approved, so nothing currently on the PMS
-- board is disturbed. Only weeks generated after this migration start as
-- pending.
insert into public.weekly_schedule_approvals (tab, week_start, status, approved_by, approved_at)
select distinct tab, week_start, 'approved', 'system:grandfathered', now()
from public.brand_schedule
where platform is not null
on conflict (tab, week_start) do nothing;

-- brand_schedule write lock: after a week is approved, only an admin may
-- insert/update/delete its rows manually. The weekly cron writes via the
-- service role, which bypasses RLS, so it is unaffected. ensureWeekGenerated
-- only writes non-pinned combos, and an approved week is fully generated
-- (every combo pinned), so it writes nothing regardless -- this policy just
-- formalises "no manual non-admin edits to an approved week".
drop policy "approved users can insert brand_schedule" on public.brand_schedule;
drop policy "approved users can update brand_schedule" on public.brand_schedule;
drop policy "approved users can delete brand_schedule" on public.brand_schedule;

create policy "insert brand_schedule (approved week is admin-only)"
  on public.brand_schedule for insert
  with check (
    public.is_approved() and (
      public.is_admin()
      or not exists (
        select 1 from public.weekly_schedule_approvals a
        where a.tab = brand_schedule.tab
          and a.week_start = brand_schedule.week_start
          and a.status = 'approved'
      )
    )
  );
create policy "update brand_schedule (approved week is admin-only)"
  on public.brand_schedule for update
  using (
    public.is_approved() and (
      public.is_admin()
      or not exists (
        select 1 from public.weekly_schedule_approvals a
        where a.tab = brand_schedule.tab
          and a.week_start = brand_schedule.week_start
          and a.status = 'approved'
      )
    )
  )
  with check (
    public.is_approved() and (
      public.is_admin()
      or not exists (
        select 1 from public.weekly_schedule_approvals a
        where a.tab = brand_schedule.tab
          and a.week_start = brand_schedule.week_start
          and a.status = 'approved'
      )
    )
  );
create policy "delete brand_schedule (approved week is admin-only)"
  on public.brand_schedule for delete
  using (
    public.is_approved() and (
      public.is_admin()
      or not exists (
        select 1 from public.weekly_schedule_approvals a
        where a.tab = brand_schedule.tab
          and a.week_start = brand_schedule.week_start
          and a.status = 'approved'
      )
    )
  );
