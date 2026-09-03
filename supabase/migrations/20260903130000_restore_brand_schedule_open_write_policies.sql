-- Revert the brand_schedule write-lock added in
-- 20260903120000_add_weekly_schedule_approvals.sql.
--
-- Product decision after that migration: the weekly approval gate controls
-- ONLY whether a (tab, week)'s plan reaches the PMS board (enforced in
-- src/lib/scheduler/pmsSync.ts's pushScheduleToPms). It does NOT lock editing
-- -- an approved week stays editable by any approved user, and mid-week
-- adjustments sync live (cancel deletes the PMS card, activate/move creates
-- one), same as before the approval feature existed.
--
-- The weekly_schedule_approvals table, its RLS, the grandfather rows, and the
-- PMS push gate all stay. Only these three brand_schedule policies revert to
-- their original 20260730120000 form.

drop policy "insert brand_schedule (approved week is admin-only)" on public.brand_schedule;
drop policy "update brand_schedule (approved week is admin-only)" on public.brand_schedule;
drop policy "delete brand_schedule (approved week is admin-only)" on public.brand_schedule;

create policy "approved users can insert brand_schedule"
  on public.brand_schedule for insert with check (public.is_approved());
create policy "approved users can update brand_schedule"
  on public.brand_schedule for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete brand_schedule"
  on public.brand_schedule for delete using (public.is_approved());
