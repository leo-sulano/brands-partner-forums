-- supabase/migrations/20260811150000_add_schedule_brand_visibility.sql
-- Schedule Planner per-brand hide/restrict (docs/superpowers/specs/2026-08-11-schedule-planner-brand-visibility-design.md):
--
-- schedule_hidden_brands: a brand's row existence here means it must never
-- appear in the Schedule Planner grid at all -- distinct from
-- removed_platform_brands, which also affects Score Summary/Brand Tabs and
-- is keyed per-platform, not per-brand.
--
-- schedule_platform_restrictions: a brand's row existence here means it may
-- only be scheduled on `allowed_platform`, for Schedule Planner purposes
-- only (auto-generation, auto-pause, and the day-cell grid) -- Score
-- Summary/Brand Tabs still show the brand's data on every platform normally.
--
-- Both are DB-seeded only for this task -- no admin UI exists yet to toggle
-- them, but RLS is kept complete (all 4 policies) to match every other flag
-- table in this project, so a future UI or manual edit doesn't hit a
-- missing-policy surprise.

create table public.schedule_hidden_brands (
  id         uuid primary key default gen_random_uuid(),
  tab        text not null,
  brand      text not null,
  brand_key  text generated always as (lower(btrim(brand))) stored,
  created_at timestamptz not null default now(),
  unique (tab, brand_key)
);

alter table public.schedule_hidden_brands enable row level security;

create policy "anyone can read schedule_hidden_brands"
  on public.schedule_hidden_brands for select using (true);
create policy "approved users can insert schedule_hidden_brands"
  on public.schedule_hidden_brands for insert with check (public.is_approved());
create policy "approved users can update schedule_hidden_brands"
  on public.schedule_hidden_brands for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete schedule_hidden_brands"
  on public.schedule_hidden_brands for delete using (public.is_approved());

create table public.schedule_platform_restrictions (
  id               uuid primary key default gen_random_uuid(),
  tab              text not null,
  brand            text not null,
  brand_key        text generated always as (lower(btrim(brand))) stored,
  allowed_platform text not null check (allowed_platform in ('tp', 'ag', 'cg', 'wo')),
  created_at       timestamptz not null default now(),
  unique (tab, brand_key)
);

alter table public.schedule_platform_restrictions enable row level security;

create policy "anyone can read schedule_platform_restrictions"
  on public.schedule_platform_restrictions for select using (true);
create policy "approved users can insert schedule_platform_restrictions"
  on public.schedule_platform_restrictions for insert with check (public.is_approved());
create policy "approved users can update schedule_platform_restrictions"
  on public.schedule_platform_restrictions for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete schedule_platform_restrictions"
  on public.schedule_platform_restrictions for delete using (public.is_approved());

-- Seed data for PMS task "Update Brand Scheduling Planner". Brand values are
-- the exact live entries.data.Brands strings (verified via REST, not the
-- PMS task's shorthand): "GOC" = God Of Casino, "Revolution 1" = Revolution1
-- (no space). Case/whitespace differences from the PMS task text elsewhere
-- (Novadreams vs "NovaDreams") don't matter -- brand_key normalizes both.

insert into public.schedule_hidden_brands (tab, brand) values
  ('Rooster Partners', 'Novadreams'),
  ('Revolution Casino', 'Midasluck'),
  ('Revolution Casino', 'Revolution1');

insert into public.schedule_platform_restrictions (tab, brand, allowed_platform) values
  ('Rooster Partners', 'Novadreams2', 'tp'),
  ('Revolution Casino', 'God Of Casino', 'ag');
