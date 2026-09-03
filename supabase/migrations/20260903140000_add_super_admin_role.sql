-- Add a `super_admin` role tier above `admin`.
--
-- super_admin is a strict superset of admin: is_admin() is true for both.
-- Only a super_admin can:
--   * approve / revoke a weekly schedule (weekly_schedule_approvals writes)
--   * grant or remove the super_admin role on another user
-- A plain admin keeps every existing power EXCEPT it can no longer act on a
-- row whose role is (or would become) super_admin.
--
-- profiles.role, is_admin(), and the profiles RLS policies were all created
-- directly in the Supabase dashboard (no prior migration), so this migration
-- redefines them in place against their current live form:
--   is_admin():  approved and role = 'admin'
--   profiles UPDATE/DELETE: is_admin() and id <> auth.uid()

-- is_admin now also covers super_admin.
create or replace function public.is_admin()
returns boolean
language sql
stable security definer
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and approved = true and role in ('admin', 'super_admin')
  )
$$;

-- New: strict super-admin check.
create or replace function public.is_super_admin()
returns boolean
language sql
stable security definer
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and approved = true and role = 'super_admin'
  )
$$;

-- Weekly schedule approval writes: admin -> super_admin only.
drop policy "weekly_schedule_approvals admin insert" on public.weekly_schedule_approvals;
drop policy "weekly_schedule_approvals admin update" on public.weekly_schedule_approvals;
drop policy "weekly_schedule_approvals admin delete" on public.weekly_schedule_approvals;

create policy "weekly_schedule_approvals super admin insert"
  on public.weekly_schedule_approvals for insert
  with check (public.is_super_admin());
create policy "weekly_schedule_approvals super admin update"
  on public.weekly_schedule_approvals for update
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy "weekly_schedule_approvals super admin delete"
  on public.weekly_schedule_approvals for delete
  using (public.is_super_admin());

-- profiles write policies: a plain admin may only touch rows where BOTH the
-- existing role (USING) and the resulting role (WITH CHECK) are not
-- super_admin. A super_admin bypasses that. Self-edit stays blocked.
drop policy "admins can update profiles" on public.profiles;
create policy "admins can update profiles"
  on public.profiles for update
  using (
    id <> auth.uid()
    and (public.is_super_admin() or (public.is_admin() and role <> 'super_admin'))
  )
  with check (
    id <> auth.uid()
    and (public.is_super_admin() or (public.is_admin() and role <> 'super_admin'))
  );

drop policy "admins can delete profiles" on public.profiles;
create policy "admins can delete profiles"
  on public.profiles for delete
  using (
    id <> auth.uid()
    and (public.is_super_admin() or (public.is_admin() and role <> 'super_admin'))
  );

-- Widen the role CHECK constraint to allow the new value.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role = any (array['super_admin'::text, 'admin'::text, 'member'::text]));

-- Seed the first super_admin.
update public.profiles set role = 'super_admin' where email = 'leo@optinetsolutions.com';
