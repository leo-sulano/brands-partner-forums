-- Delete/edit audit log for accounts (profiles) and rows (entries), with
-- admin-only restore. Snapshot the row before every delete/update so a
-- deleted account/row can be recreated, and an edit can be reverted.
-- See docs/superpowers/specs/2026-07-02-delete-edit-audit-restore-design.md

create table if not exists public.delete_log (
  id                 uuid primary key default gen_random_uuid(),
  entity_type        text not null check (entity_type in ('account','entry')),
  entity_id          uuid not null,
  tab                text,
  before_data        jsonb not null,
  actor_id           uuid references auth.users(id) on delete set null,
  actor_email        text not null,
  restored_at        timestamptz,
  restored_by_email  text,
  created_at         timestamptz not null default now()
);

create table if not exists public.edit_log (
  id                 uuid primary key default gen_random_uuid(),
  entity_type        text not null check (entity_type in ('account','entry')),
  entity_id          uuid not null,
  tab                text,
  before_data        jsonb not null,
  actor_id           uuid references auth.users(id) on delete set null,
  actor_email        text not null,
  restored_at        timestamptz,
  restored_by_email  text,
  created_at         timestamptz not null default now()
);

create index if not exists delete_log_created_at_idx on public.delete_log (created_at desc);
create index if not exists edit_log_created_at_idx   on public.edit_log (created_at desc);

alter table public.delete_log enable row level security;
alter table public.edit_log   enable row level security;

-- entries: same read visibility as the entries table itself
create policy "approved users can read entry rows in delete_log"
  on public.delete_log for select
  using (entity_type = 'entry' and public.is_approved());
create policy "approved users can read entry rows in edit_log"
  on public.edit_log for select
  using (entity_type = 'entry' and public.is_approved());

-- accounts: admin-only, matching admin_logs
create policy "admins can read account rows in delete_log"
  on public.delete_log for select
  using (entity_type = 'account' and public.is_admin());
create policy "admins can read account rows in edit_log"
  on public.edit_log for select
  using (entity_type = 'account' and public.is_admin());

-- insert: any approved user performing a delete/edit writes its own log row
create policy "approved users can insert delete_log"
  on public.delete_log for insert with check (public.is_approved());
create policy "approved users can insert edit_log"
  on public.edit_log for insert with check (public.is_approved());

-- restore (setting restored_at) is admin-only
create policy "admins can update delete_log"
  on public.delete_log for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can update edit_log"
  on public.edit_log for update using (public.is_admin()) with check (public.is_admin());

-- profiles has no insert policy today (accounts are only ever created via the
-- handle_new_user trigger, which runs as security definer and bypasses RLS).
-- Restoring a deleted account needs a client-side insert into profiles.
create policy "admins can insert profiles"
  on public.profiles for insert with check (public.is_admin());
