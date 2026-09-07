-- supabase/migrations/20260907120000_add_custom_platforms.sql
-- Lets any approved user define a new review platform (beyond the 4
-- built-in TP/AG/CG/WO) and enable it on any tab -- hardcoded or dynamic --
-- with no code change or deploy. Spec:
-- docs/superpowers/specs/2026-09-07-custom-platforms-design.md
--
-- status_column/date_column are computed once at creation time
-- ("<name> Review Status" / "<name> Review Added") and frozen -- renaming a
-- custom platform is not supported in v1 (see spec Non-goals), since that
-- would require rewriting the key across every entry on every tab that uses
-- it. `tab` on tab_custom_platforms is a plain text column named `tab`, so
-- rename_hardcoded_tab/rename_custom_tab (which discover every table with a
-- `tab` text column via information_schema) automatically keep it in sync on
-- a tab rename with no code change here -- same mechanism brand_catalog
-- already relies on.
create table public.custom_platforms (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  platform_key   text generated always as (lower(btrim(name))) stored,
  short_label    text not null,
  status_column  text not null,
  date_column    text not null,
  max_score      integer,
  created_by     text not null,
  created_at     timestamptz not null default now(),
  constraint custom_platforms_platform_key_unique unique (platform_key),
  constraint custom_platforms_max_score_check check (max_score is null or max_score > 0)
);

alter table public.custom_platforms enable row level security;

create policy "anyone can read custom_platforms"
  on public.custom_platforms for select using (true);
create policy "approved users can insert custom_platforms"
  on public.custom_platforms for insert with check (public.is_approved());
create policy "approved users can delete custom_platforms"
  on public.custom_platforms for delete using (public.is_approved());

create table public.tab_custom_platforms (
  id           uuid primary key default gen_random_uuid(),
  tab          text not null,
  platform_id  uuid not null references public.custom_platforms(id) on delete restrict,
  enabled_by   text not null,
  enabled_at   timestamptz not null default now(),
  constraint tab_custom_platforms_unique unique (tab, platform_id)
);

alter table public.tab_custom_platforms enable row level security;

create policy "anyone can read tab_custom_platforms"
  on public.tab_custom_platforms for select using (true);
create policy "approved users can insert tab_custom_platforms"
  on public.tab_custom_platforms for insert with check (public.is_approved());
create policy "approved users can delete tab_custom_platforms"
  on public.tab_custom_platforms for delete using (public.is_approved());
