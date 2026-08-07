-- supabase/migrations/20260807110000_add_flagged_platform_brands_and_override.sql
-- Schedule Planner rules update (docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md):
--
-- flagged_platform_brands: a manual "ops received an email saying this
-- brand+platform was flagged" toggle. No automated email detection exists,
-- so this is purely operator-set, same shape/semantics as
-- removed_platform_brands (a row's mere existence is the flag). One of three
-- OR-conditions recalculatePauses now checks (alongside two-consecutive-
-- removed and the monthly success-rate check).
--
-- brand_platform_override: a manual override that beats whatever
-- recalculatePauses' automatic detection would otherwise compute for a
-- brand+platform combo. 'pause' forces a pause regardless of auto
-- conditions; 'active' forces continued posting even if auto-detection
-- would otherwise pause it (e.g. a client wants a review pushed despite a
-- low score). A row's mere existence is the override; no row means "auto"
-- (today's behavior, unchanged). Unlike an auto-detected pause, an override
-- does not auto-expire after a week — it persists until the row is deleted.

create table public.flagged_platform_brands (
  id          uuid primary key default gen_random_uuid(),
  tab         text not null,
  brand       text not null,
  brand_key   text generated always as (lower(btrim(brand))) stored,
  platform    text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  flagged_by  text,
  flagged_at  timestamptz not null default now(),
  unique (tab, brand_key, platform)
);

alter table public.flagged_platform_brands enable row level security;

create policy "anyone can read flagged_platform_brands"
  on public.flagged_platform_brands for select using (true);
create policy "approved users can insert flagged_platform_brands"
  on public.flagged_platform_brands for insert with check (public.is_approved());
create policy "approved users can update flagged_platform_brands"
  on public.flagged_platform_brands for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete flagged_platform_brands"
  on public.flagged_platform_brands for delete using (public.is_approved());

create table public.brand_platform_override (
  id              uuid primary key default gen_random_uuid(),
  tab             text not null,
  brand           text not null,
  brand_key       text generated always as (lower(btrim(brand))) stored,
  platform        text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  override_state  text not null check (override_state in ('pause', 'active')),
  set_by          text,
  created_at      timestamptz not null default now(),
  unique (tab, brand_key, platform)
);

alter table public.brand_platform_override enable row level security;

create policy "anyone can read brand_platform_override"
  on public.brand_platform_override for select using (true);
create policy "approved users can insert brand_platform_override"
  on public.brand_platform_override for insert with check (public.is_approved());
create policy "approved users can update brand_platform_override"
  on public.brand_platform_override for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete brand_platform_override"
  on public.brand_platform_override for delete using (public.is_approved());
