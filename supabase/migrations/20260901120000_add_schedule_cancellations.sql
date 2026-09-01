-- supabase/migrations/20260901120000_add_schedule_cancellations.sql
-- Schedule Planner: a day explicitly Cancelled (the new per-cell Cancel
-- button, or the legacy click-to-cycle's paused -> blank leg) writes the
-- day's brand_schedule status back to null -- identical, at the data level,
-- to "never scheduled." This table exists purely to distinguish the two for
-- display: the Schedule Status column's new "Cancelled" icon reads this
-- table to show a day was explicitly cancelled, not just never touched.
--
-- Deliberately NOT read by the scheduler engine, generation logic, or PMS
-- sync (schedule_pms_links/pmsSync.ts) -- those all keep working off the
-- real brand_schedule day value (null) exactly as before this table existed.
-- This is a pure audit/display trail, same spirit as brand_platform_override's
-- set_by column, just its own table since a cancellation is keyed by exact
-- day, not by (tab, brand, platform) alone.
--
-- brand_key follows this project's standing convention (brand_schedule,
-- schedule_pms_links, etc.): raw `brand` stored, `brand_key` generated
-- (lower+trim) so brand matching is case/whitespace-insensitive everywhere.
-- Re-cancelling the same exact day (a rare double-click race) upserts rather
-- than erroring, refreshing cancelled_at/cancelled_by to the latest action.

create table public.schedule_cancellations (
  id           uuid primary key default gen_random_uuid(),
  tab          text not null,
  brand        text not null,
  brand_key    text generated always as (lower(btrim(brand))) stored,
  platform     text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  week_start   date not null,
  weekday      text not null check (weekday in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday')),
  cancelled_at timestamptz not null default now(),
  cancelled_by text,
  unique (tab, brand_key, platform, week_start, weekday)
);

alter table public.schedule_cancellations enable row level security;

create policy "anyone can read schedule_cancellations"
  on public.schedule_cancellations for select using (true);
create policy "approved users can insert schedule_cancellations"
  on public.schedule_cancellations for insert with check (public.is_approved());
create policy "approved users can update schedule_cancellations"
  on public.schedule_cancellations for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete schedule_cancellations"
  on public.schedule_cancellations for delete using (public.is_approved());
