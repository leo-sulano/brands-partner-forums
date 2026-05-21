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
-- Trustpilot review status check — runs every 3 days at 08:00 UTC (days 1, 4, 7, ...)
-- Requires pg_cron and pg_net extensions to be enabled in the Supabase dashboard.
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'check-tp-review-status-daily',
  '0 8 */3 * *',
  $$
    SELECT net.http_post(
      url     := 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/check-review-status',
      body    := '{}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU"}'::jsonb
    )
  $$
);
