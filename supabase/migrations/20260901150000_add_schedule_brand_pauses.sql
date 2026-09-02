-- supabase/migrations/20260901150000_add_schedule_brand_pauses.sql
-- Schedule Planner "Paused / Noted Brands" section
-- (docs/superpowers/specs/2026-09-01-schedule-planner-paused-brands-design.md):
--
-- A whole-brand-level pause, distinct from every other Schedule-Planner-only
-- flag table: schedule_hidden_brands (fully hides, no UI, no reason),
-- schedule_platform_restrictions (per-brand, restricts to one platform),
-- brand_platform_pause (auto-detected, per-platform, ~1-week auto-expiry),
-- brand_platform_override (manual, per-platform, no reason/dates). This
-- table's row existence means the whole brand is pulled out of the active
-- grid (via the same getSchedulableBrandPlatforms/resolveBrandPlatforms
-- choke point schedule_hidden_brands already uses) and instead shown in a
-- dedicated "Paused / Noted Brands" section with its reason and dates.
--
-- paused_until is purely informational -- it does NOT auto-clear the row
-- (confirmed with user: manual unpause only). One row per (tab, brand);
-- editing a pause upserts the same row.

create table public.schedule_brand_pauses (
  id            uuid primary key default gen_random_uuid(),
  tab           text not null,
  brand         text not null,
  brand_key     text generated always as (lower(btrim(brand))) stored,
  reason        text not null,
  paused_since  date not null,
  paused_until  date,
  created_by    text,
  created_at    timestamptz not null default now(),
  unique (tab, brand_key)
);

alter table public.schedule_brand_pauses enable row level security;

create policy "anyone can read schedule_brand_pauses"
  on public.schedule_brand_pauses for select using (true);
create policy "approved users can insert schedule_brand_pauses"
  on public.schedule_brand_pauses for insert with check (public.is_approved());
create policy "approved users can update schedule_brand_pauses"
  on public.schedule_brand_pauses for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete schedule_brand_pauses"
  on public.schedule_brand_pauses for delete using (public.is_approved());
