-- supabase/migrations/20260901130000_add_hardcoded_tab_renames.sql
-- Maps a hardcoded tab's permanent TAB_COLUMN_CONFIGS key (original_name) to
-- its current live name, so the 11 hardcoded tabs in
-- src/lib/tab-configs.ts can be truly renamed without a code deploy.
-- Mirrors tab_icon_overrides' shape and RLS exactly
-- (docs/superpowers/specs/2026-09-01-hardcoded-tab-rename-design.md).
-- A hardcoded tab that has never been renamed has no row here at all --
-- src/lib/hardcodedTabRenameRegistry.ts's resolveHardcodedTabKey() treats
-- "no row" as "current name == original name."
create table public.hardcoded_tab_renames (
  original_name text primary key,
  current_name  text not null unique,
  updated_by    text,
  updated_at    timestamptz not null default now()
);

alter table public.hardcoded_tab_renames enable row level security;

create policy "anyone can read hardcoded_tab_renames"
  on public.hardcoded_tab_renames for select using (true);
create policy "approved users can insert hardcoded_tab_renames"
  on public.hardcoded_tab_renames for insert with check (public.is_approved());
create policy "approved users can update hardcoded_tab_renames"
  on public.hardcoded_tab_renames for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete hardcoded_tab_renames"
  on public.hardcoded_tab_renames for delete using (public.is_approved());
