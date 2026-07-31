-- Intelligent Schedule Planner: adds a platform dimension to brand_schedule
-- and a pause-tracking table for the auto-pause/resume rule.
-- docs/superpowers/specs/2026-07-31-intelligent-schedule-planner-design.md
--
-- `platform` stays nullable. The 1,133 existing rows keep platform = NULL —
-- they predate platform-awareness and are never migrated; they render
-- read-only in the old checkmark style. Every row this feature writes going
-- forward always has an explicit platform. Postgres treats each NULL as
-- distinct under a unique constraint, so legacy rows never collide with new
-- platform-tagged rows for the same (tab, brand_key, week_start).

alter table public.brand_schedule
  add column platform text check (platform in ('tp', 'ag', 'cg', 'wo'));

alter table public.brand_schedule drop constraint brand_schedule_tab_brand_key_week_start_key;
alter table public.brand_schedule
  add constraint brand_schedule_tab_brand_key_platform_week_start_key
  unique (tab, brand_key, platform, week_start);

create table public.brand_platform_pause (
  id                 uuid primary key default gen_random_uuid(),
  tab                text not null,
  brand              text not null,
  brand_key          text generated always as (lower(btrim(brand))) stored,
  platform           text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  paused_week_start  date not null,
  reason             text not null,
  created_at         timestamptz not null default now(),
  unique (tab, brand_key, platform)
);

alter table public.brand_platform_pause enable row level security;

create policy "anyone can read brand_platform_pause"
  on public.brand_platform_pause for select using (true);
create policy "approved users can insert brand_platform_pause"
  on public.brand_platform_pause for insert with check (public.is_approved());
create policy "approved users can update brand_platform_pause"
  on public.brand_platform_pause for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete brand_platform_pause"
  on public.brand_platform_pause for delete using (public.is_approved());
