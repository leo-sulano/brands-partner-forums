-- supabase/migrations/20260911120000_add_removed_custom_platform_brands.sql
-- A brand's page on a custom (user-defined) platform can be delisted
-- entirely, independent of any single review's status -- the same concept
-- removed_platform_brands covers for the 4 built-in platforms, generalized
-- here for a custom platform identified by custom_platforms.id instead of a
-- closed platform code. Spec:
-- docs/superpowers/specs/2026-09-11-custom-platform-removed-flag-design.md

create table public.removed_custom_platform_brands (
  id            uuid primary key default gen_random_uuid(),
  tab           text not null,
  brand         text not null,
  brand_key     text generated always as (lower(btrim(brand))) stored,
  platform_id   uuid not null references public.custom_platforms(id) on delete restrict,
  removed_by    text,
  removed_at    timestamptz not null default now(),
  unique (tab, brand_key, platform_id)
);

alter table public.removed_custom_platform_brands enable row level security;

create policy "anyone can read removed_custom_platform_brands"
  on public.removed_custom_platform_brands for select using (true);
create policy "approved users can insert removed_custom_platform_brands"
  on public.removed_custom_platform_brands for insert with check (public.is_approved());
create policy "approved users can update removed_custom_platform_brands"
  on public.removed_custom_platform_brands for update using (public.is_approved());
create policy "approved users can delete removed_custom_platform_brands"
  on public.removed_custom_platform_brands for delete using (public.is_approved());
