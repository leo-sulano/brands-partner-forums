-- supabase/migrations/20260818130000_add_custom_tabs.sql
-- Self-service Brand Tab creation
-- (docs/superpowers/specs/2026-08-18-self-service-brand-tab-creation-design.md):
--
-- custom_tabs is the source of truth for dynamically-created Brand Tabs —
-- the 11 legacy tabs stay hardcoded in src/lib/tab-configs.ts and never
-- appear here. `platforms` is validated at the application layer
-- (src/lib/dynamicTabRegistry.ts) rather than a check constraint, since the
-- allowed set only needs to stay in sync with one TypeScript module, not
-- with every possible future writer of this table.
--
-- All four RLS policies are defined explicitly even though the v1 UI only
-- exercises select/insert/delete, matching every other flag/config table in
-- this project (see schedule_pms_links, brand_schedule).

create table public.custom_tabs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  platforms  text[] not null,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.custom_tabs enable row level security;

create policy "anyone can read custom_tabs"
  on public.custom_tabs for select using (true);
create policy "approved users can insert custom_tabs"
  on public.custom_tabs for insert with check (public.is_approved());
create policy "approved users can update custom_tabs"
  on public.custom_tabs for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete custom_tabs"
  on public.custom_tabs for delete using (public.is_approved());
