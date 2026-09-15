-- Re-open an approved week's brand_schedule writes to admins.
--
-- Product decision (supersedes 20260903150000, which had locked this to
-- super_admin only): a plain admin should be able to edit/pause/cancel a
-- schedule even after its week is approved, same as a super_admin. Only
-- approving/revoking the week itself (weekly_schedule_approvals writes,
-- locked in 20260903140000) and role escalation stay super_admin-only.

drop policy "insert brand_schedule (approved week is super-admin-only)" on public.brand_schedule;
drop policy "update brand_schedule (approved week is super-admin-only)" on public.brand_schedule;
drop policy "delete brand_schedule (approved week is super-admin-only)" on public.brand_schedule;

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
