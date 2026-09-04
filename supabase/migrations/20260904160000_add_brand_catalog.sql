-- supabase/migrations/20260904160000_add_brand_catalog.sql
-- Lets a brand exist for a tab before any review-account entry does. Until
-- now, "which brands exist on this tab" was purely derived from entries.data
-- (BRAND_COLS) -- there was no way to register a brand ahead of creating its
-- first entry. Edit Brand Tab's "Add a brand" control now writes here
-- instead of inserting a phantom entries row; deriveTabBrands (tab-configs.ts)
-- merges these in wherever a tab's brand list is computed (Brand Group's own
-- brand filter/Add Review Account's Brand Name picker via brandProfiles, and
-- the Schedule Planner's brand list -- both the per-tab calendar and the
-- landing-grid preview, plus generate-weekly-schedule's Monday cron), so a
-- catalog-only brand is immediately schedulable and pickable even with zero
-- entries. `added_at` also anchors the scheduler's new-brand ramp-up: a
-- brand added this way gets 1 post/platform for its first 2 calendar weeks
-- instead of each platform's normal frequency (see schedulerRules.ts /
-- schedulerEngine.ts's rampBrandKeys).
--
-- Same shape as this project's other small per-tab override/registry tables
-- (brand_platform_override, flagged_platform_brands): generated brand_key
-- for case/whitespace-insensitive uniqueness, `tab` a plain text column so
-- rename_hardcoded_tab/rename_custom_tab (which discover every table with a
-- `tab` column via information_schema) automatically keep this in sync on a
-- tab rename with no code change here.
create table public.brand_catalog (
  id         uuid primary key default gen_random_uuid(),
  tab        text not null,
  brand      text not null,
  brand_key  text generated always as (lower(btrim(brand))) stored,
  link       text,
  added_by   text,
  added_at   timestamptz not null default now(),
  unique (tab, brand_key)
);

alter table public.brand_catalog enable row level security;

create policy "anyone can read brand_catalog"
  on public.brand_catalog for select using (true);
create policy "approved users can insert brand_catalog"
  on public.brand_catalog for insert with check (public.is_approved());
create policy "approved users can update brand_catalog"
  on public.brand_catalog for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete brand_catalog"
  on public.brand_catalog for delete using (public.is_approved());
