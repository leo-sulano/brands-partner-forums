-- Reconstructed migration file: this migration was already applied to the
-- linked project (version 20260702120000) but its file was never committed
-- to this repo, causing a local/remote migration-history drift. Content is
-- copied verbatim from docs/superpowers/specs/2026-07-02-delete-edit-audit-restore-design.md
-- and verified column-for-column and policy-for-policy against the live
-- schema before being added here — this file is not being (re)applied, only
-- restoring the repo's record of what's already live.
create table public.delete_log (
  id                 uuid primary key default gen_random_uuid(),
  entity_type        text not null check (entity_type in ('account','entry')),
  entity_id          uuid not null,
  tab                text,               -- entries only; null for accounts
  before_data        jsonb not null,     -- full row snapshot immediately before the delete
  actor_id           uuid references auth.users(id) on delete set null,
  actor_email        text not null,
  restored_at        timestamptz,
  restored_by_email  text,
  created_at         timestamptz not null default now()
);

create table public.edit_log (
  id                 uuid primary key default gen_random_uuid(),
  entity_type        text not null check (entity_type in ('account','entry')),
  entity_id          uuid not null,
  tab                text,
  before_data        jsonb not null,     -- full row snapshot immediately before the edit
  actor_id           uuid references auth.users(id) on delete set null,
  actor_email        text not null,
  restored_at        timestamptz,
  restored_by_email  text,
  created_at         timestamptz not null default now()
);

create index delete_log_created_at_idx on public.delete_log (created_at desc);
create index edit_log_created_at_idx   on public.edit_log (created_at desc);

alter table public.delete_log enable row level security;
alter table public.edit_log   enable row level security;

-- entries: same visibility as the entries table itself
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

-- insert: any approved user performing a delete/edit can write the log entry
create policy "approved users can insert delete_log"
  on public.delete_log for insert with check (public.is_approved());
create policy "approved users can insert edit_log"
  on public.edit_log for insert with check (public.is_approved());

-- restore (marking restored_at) is admin-only
create policy "admins can update delete_log"
  on public.delete_log for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can update edit_log"
  on public.edit_log for update using (public.is_admin()) with check (public.is_admin());

create policy "admins can insert profiles"
  on public.profiles for insert with check (public.is_admin());
