-- Re-lock an approved week's schedule to super admins.
--
-- Product decision (supersedes 20260903130000, which had opened editing back
-- up): once a (tab, week) is approved, only a super_admin may make further
-- manual changes to its brand_schedule rows. A pending (not-yet-approved)
-- week stays editable by any approved user. The weekly cron writes via the
-- service role and bypasses RLS; ensureWeekGenerated only writes non-pinned
-- combos and an approved week is fully generated, so it writes nothing to an
-- approved week regardless -- this policy formalises the manual-edit lock.
--
-- Automatic pause/resume is unaffected: recalculatePauses writes
-- brand_platform_pause / brand_platform_override, never brand_schedule.

drop policy "approved users can insert brand_schedule" on public.brand_schedule;
drop policy "approved users can update brand_schedule" on public.brand_schedule;
drop policy "approved users can delete brand_schedule" on public.brand_schedule;

create policy "insert brand_schedule (approved week is super-admin-only)"
  on public.brand_schedule for insert
  with check (
    public.is_approved() and (
      public.is_super_admin()
      or not exists (
        select 1 from public.weekly_schedule_approvals a
        where a.tab = brand_schedule.tab
          and a.week_start = brand_schedule.week_start
          and a.status = 'approved'
      )
    )
  );
create policy "update brand_schedule (approved week is super-admin-only)"
  on public.brand_schedule for update
  using (
    public.is_approved() and (
      public.is_super_admin()
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
      public.is_super_admin()
      or not exists (
        select 1 from public.weekly_schedule_approvals a
        where a.tab = brand_schedule.tab
          and a.week_start = brand_schedule.week_start
          and a.status = 'approved'
      )
    )
  );
create policy "delete brand_schedule (approved week is super-admin-only)"
  on public.brand_schedule for delete
  using (
    public.is_approved() and (
      public.is_super_admin()
      or not exists (
        select 1 from public.weekly_schedule_approvals a
        where a.tab = brand_schedule.tab
          and a.week_start = brand_schedule.week_start
          and a.status = 'approved'
      )
    )
  );
