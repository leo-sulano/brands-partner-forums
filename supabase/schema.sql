-- Brands Partner Forum — Supabase schema (multi-tab)
-- Run in the Supabase SQL editor. This is a destructive migration:
-- review_entries from the prior single-tab attempt is dropped.

drop table if exists public.review_entries cascade;
drop table if exists public.entries cascade;
drop table if exists public.tab_schemas cascade;
drop table if exists public.sync_runs cascade;
drop table if exists public.mentions cascade;

create extension if not exists "pgcrypto";

create table public.entries (
  id              uuid primary key default gen_random_uuid(),
  tab             text not null,
  sheet_row_id    text not null,
  data            jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now(),
  last_edited_by  text not null default 'dashboard',
  last_sync_tag   text,
  unique (tab, sheet_row_id)
);

create index entries_tab_idx         on public.entries (tab);
create index entries_tab_updated_idx on public.entries (tab, updated_at desc);
create index entries_data_gin        on public.entries using gin (data);

create table public.tab_schemas (
  tab          text primary key,
  headers      jsonb not null,
  refreshed_at timestamptz not null default now()
);

create table public.sync_runs (
  id             uuid primary key default gen_random_uuid(),
  direction      text not null check (direction in ('sheet_to_db','db_to_sheet','initial_import')),
  tab            text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  rows_seen      int,
  rows_upserted  int,
  rows_skipped   int,
  status         text not null default 'running' check (status in ('running','success','error','skipped')),
  error_message  text,
  payload_ref    text
);

create index sync_runs_started_at_idx on public.sync_runs (started_at desc);
create index sync_runs_direction_idx  on public.sync_runs (direction);

-- ---------------------------------------------------------------------------
-- Trustpilot review status check — runs every 3 days at 23:50 UTC
-- Requires pg_cron and pg_net extensions to be enabled in the Supabase dashboard.
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'check-tp-review-status-daily',
  '50 23 */3 * *',
  $$
    SELECT net.http_post(
      url     := 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/check-review-status',
      body    := '{}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU"}'::jsonb
    )
  $$
);

-- =============================================================================
-- Auth: profiles table, auto-insert trigger, and RLS policies
-- Run this block in the Supabase SQL editor after the schema above.
-- =============================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  approved    boolean not null default false,
  role        text not null default 'member' check (role in ('admin', 'member')),
  created_at  timestamptz not null default now()
);

-- Auto-insert a profile row whenever a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''));
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Helper: returns true if the current session user is approved
create or replace function public.is_approved()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and approved = true
  )
$$ language sql security definer stable;

-- Helper: returns true if the current session user is an approved admin
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and approved = true and role = 'admin'
  )
$$ language sql security definer stable;

-- Enable RLS on all data tables
alter table public.entries     enable row level security;
alter table public.tab_schemas enable row level security;
alter table public.sync_runs   enable row level security;
alter table public.profiles    enable row level security;

-- entries
create policy "anyone can read entries"
  on public.entries for select using (true);
create policy "approved users can insert entries"
  on public.entries for insert with check (public.is_approved());
create policy "approved users can update entries"
  on public.entries for update using (public.is_approved()) with check (public.is_approved());

-- tab_schemas
create policy "anyone can read tab_schemas"
  on public.tab_schemas for select using (true);

-- sync_runs
create policy "approved users can read sync_runs"
  on public.sync_runs for select using (public.is_approved());
create policy "approved users can insert sync_runs"
  on public.sync_runs for insert with check (public.is_approved());
create policy "approved users can update sync_runs"
  on public.sync_runs for update using (public.is_approved()) with check (public.is_approved());

-- profiles: each user can read their own row; admins can read and update all rows
create policy "users can read own profile"
  on public.profiles for select using (id = auth.uid());
create policy "admins can read all profiles"
  on public.profiles for select using (public.is_admin());
create policy "admins can update profiles"
  on public.profiles for update
  using (public.is_admin() and id <> auth.uid())
  with check (public.is_admin() and id <> auth.uid());
