-- supabase/migrations/20260908120000_add_schedule_manual_pauses.sql
-- Schedule Planner: records WHO manually paused a specific day cell (via the
-- day cell's click-to-cycle or the per-day Pause button), so the day-cell
-- tooltip can show "Paused by: <name>" the same way an override-driven
-- (brand_platform_override) pause already does. Mirrors
-- schedule_cancellations exactly -- pure display/audit trail, never read by
-- the scheduler engine, generation logic, or PMS sync. A per-day manual
-- pause has no other durable row to carry this on (unlike an override pause,
-- which has brand_platform_override.set_by, or a scheduler auto-pause, which
-- has no "who" at all since nobody clicked anything).
--
-- brand_key follows this project's standing convention (brand_schedule,
-- schedule_cancellations, schedule_pms_links, etc.): raw `brand` stored,
-- `brand_key` generated (lower+trim) so brand matching is
-- case/whitespace-insensitive everywhere.
--
-- Re-pausing the same exact day (a rare double-click race, or pausing again
-- after a Resume/Pause round-trip) upserts rather than erroring, refreshing
-- paused_at/paused_by to the latest action -- same as schedule_cancellations.

create table public.schedule_manual_pauses (
  id         uuid primary key default gen_random_uuid(),
  tab        text not null,
  brand      text not null,
  brand_key  text generated always as (lower(btrim(brand))) stored,
  platform   text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  week_start date not null,
  weekday    text not null check (weekday in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday')),
  paused_at  timestamptz not null default now(),
  paused_by  text,
  unique (tab, brand_key, platform, week_start, weekday)
);

alter table public.schedule_manual_pauses enable row level security;

create policy "anyone can read schedule_manual_pauses"
  on public.schedule_manual_pauses for select using (true);
create policy "approved users can insert schedule_manual_pauses"
  on public.schedule_manual_pauses for insert with check (public.is_approved());
create policy "approved users can update schedule_manual_pauses"
  on public.schedule_manual_pauses for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete schedule_manual_pauses"
  on public.schedule_manual_pauses for delete using (public.is_approved());
