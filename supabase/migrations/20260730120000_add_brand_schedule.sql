-- Schedule Planner: which weekdays a brand's outreach/posting is active vs
-- paused. One recurring Mon-Fri template per (tab, brand) -- not tied to any
-- specific calendar week (docs/superpowers/specs/2026-07-30-schedule-planner-design.md).
-- A NULL day column means "not set" (renders as a blank cell); every write
-- is a plain upsert of one column -- unlike removed_platform_brands, row
-- existence itself carries no meaning here, so there's no delete-to-clear step.
--
-- brand_key is a generated, normalized (lower+trim) column, mirroring the
-- fix already applied to removed_platform_brands
-- (20260729140000_add_removed_tp_brands_update_policy.sql) so brand values
-- differing only in case/whitespace still match the same row.

create table public.brand_schedule (
  id          uuid primary key default gen_random_uuid(),
  tab         text not null,
  brand       text not null,
  brand_key   text generated always as (lower(btrim(brand))) stored,
  monday      text check (monday in ('active', 'paused')),
  tuesday     text check (tuesday in ('active', 'paused')),
  wednesday   text check (wednesday in ('active', 'paused')),
  thursday    text check (thursday in ('active', 'paused')),
  friday      text check (friday in ('active', 'paused')),
  updated_at  timestamptz not null default now(),
  unique (tab, brand_key)
);

alter table public.brand_schedule enable row level security;

create policy "anyone can read brand_schedule"
  on public.brand_schedule for select using (true);
create policy "approved users can insert brand_schedule"
  on public.brand_schedule for insert with check (public.is_approved());
create policy "approved users can update brand_schedule"
  on public.brand_schedule for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete brand_schedule"
  on public.brand_schedule for delete using (public.is_approved());
