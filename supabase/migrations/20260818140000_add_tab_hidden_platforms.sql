-- supabase/migrations/20260818140000_add_tab_hidden_platforms.sql
-- Hardcoded Brand Tab platform visibility
-- (docs/superpowers/specs/2026-08-18-hardcoded-tab-platform-visibility-design.md):
--
-- A row's existence here means that platform is currently hidden for that
-- tab -- same shape as removed_platform_brands/schedule_hidden_brands, both
-- already in this project. Applies to any tab (hardcoded or dynamic), but
-- in practice the UI only ever writes rows for the 11 hardcoded tabs --
-- dynamic tabs keep using custom_tabs.platforms (Task 236) since that
-- mechanism also controls which columns get generated in the first place,
-- which a hardcoded tab's fixed schema doesn't need.
--
-- No FK on `tab` -- a tab's identity is a free-text string everywhere else
-- in this project (entries.tab, custom_tabs.name).

create table public.tab_hidden_platforms (
  id         uuid primary key default gen_random_uuid(),
  tab        text not null,
  platform   text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  hidden_by  text,
  hidden_at  timestamptz not null default now(),
  unique (tab, platform)
);

alter table public.tab_hidden_platforms enable row level security;

create policy "anyone can read tab_hidden_platforms"
  on public.tab_hidden_platforms for select using (true);
create policy "approved users can insert tab_hidden_platforms"
  on public.tab_hidden_platforms for insert with check (public.is_approved());
create policy "approved users can update tab_hidden_platforms"
  on public.tab_hidden_platforms for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete tab_hidden_platforms"
  on public.tab_hidden_platforms for delete using (public.is_approved());
