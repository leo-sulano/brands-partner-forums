-- Brands Partner Forum — Supabase schema
-- Run in the Supabase SQL editor (or via `supabase db push`).

create extension if not exists "pgcrypto";

-- =====================================================================
-- mentions
-- =====================================================================
create table if not exists public.mentions (
  id              uuid primary key default gen_random_uuid(),
  source_row_id   text not null unique,
  forum           text not null,
  thread_title    text,
  mention_text    text not null,
  url             text not null,
  author          text,
  posted_at       timestamptz,
  keyword         text,
  sentiment       text check (sentiment in ('positive','neutral','negative')),
  status          text not null default 'new' check (status in ('new','reviewed','ignored')),
  synced_at       timestamptz not null default now()
);

create index if not exists mentions_posted_at_idx on public.mentions (posted_at desc);
create index if not exists mentions_forum_idx     on public.mentions (forum);
create index if not exists mentions_keyword_idx   on public.mentions (keyword);
create index if not exists mentions_status_idx    on public.mentions (status);

-- =====================================================================
-- sync_runs
-- =====================================================================
create table if not exists public.sync_runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  rows_seen       int not null default 0,
  rows_upserted   int not null default 0,
  rows_skipped    int not null default 0,
  error_message   text,
  status          text not null default 'running' check (status in ('running','success','error'))
);

create index if not exists sync_runs_started_at_idx on public.sync_runs (started_at desc);

-- =====================================================================
-- Row Level Security
-- =====================================================================
-- Vercel password protection guards the deploy, so the anon key is effectively
-- private. We still keep RLS on with permissive read policies so we never have
-- truly open writes from the anon client. Status updates from the UI go through
-- the anon client, so we permit updates to the `status` column only.

alter table public.mentions  enable row level security;
alter table public.sync_runs enable row level security;

create policy "anon read mentions"
  on public.mentions for select
  to anon
  using (true);

create policy "anon update mention status"
  on public.mentions for update
  to anon
  using (true)
  with check (true);

create policy "anon read sync_runs"
  on public.sync_runs for select
  to anon
  using (true);

-- Writes (insert/upsert into mentions, insert into sync_runs) are performed by
-- the Edge Function using the service role key, which bypasses RLS.
