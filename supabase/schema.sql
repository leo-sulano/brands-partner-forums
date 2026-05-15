-- Brands Partner Forum — Supabase schema
-- Run in the Supabase SQL editor, or via `supabase db push` against a linked project.

-- Drop legacy tables from the prior design.
drop table if exists public.mentions cascade;
drop table if exists public.sync_runs cascade;

create extension if not exists "pgcrypto";

create table public.review_entries (
  id              uuid primary key default gen_random_uuid(),
  sheet_row_id    text unique not null,

  agent                       text,
  account                     text,
  country                     text,
  proxy_used                  text,
  email                       text,
  password                    text,
  account_name                text,
  account_surname             text,

  process                     text,
  details                     text,
  brand                       text,

  status_date                 date,
  score_added                 int,
  trustpilot_date             date,
  profile_url                 text,
  review_status               text,

  redirection_search_engine   text,
  redirection_word            text,
  review_language             text,
  native_language             text,

  register_from_google        text,
  leaving_review_after_email  text,
  sticky_ip_mobile            text,
  photo_in_account            text,
  device                      text,
  opening_via_useful          text,
  opening_via_register        text,
  scrolling_hovering          text,
  smart_paste                 text,
  mentioning_time_frames      text,
  mentioning_amounts          text,
  mentioning_agent_name       text,
  review_length               text,

  updated_at        timestamptz not null default now(),
  last_edited_by    text not null default 'dashboard',
  last_sync_tag     text
);

create index review_entries_brand_idx       on public.review_entries (brand);
create index review_entries_agent_idx       on public.review_entries (agent);
create index review_entries_country_idx     on public.review_entries (country);
create index review_entries_status_idx      on public.review_entries (review_status);
create index review_entries_updated_at_idx  on public.review_entries (updated_at desc);

create table public.sync_runs (
  id             uuid primary key default gen_random_uuid(),
  direction      text not null check (direction in ('sheet_to_db','db_to_sheet','initial_import')),
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
