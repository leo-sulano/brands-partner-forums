-- supabase/migrations/20260829120000_add_tab_icon_overrides.sql
-- Consolidates and replaces `custom_tabs.icon`/`custom_tabs.favicon_domain`
-- (added 2026-08-28) with one table keyed by tab NAME rather than the
-- `custom_tabs` row id — the 11 hardcoded tabs (TAB_COLUMN_CONFIGS in
-- src/lib/tab-configs.ts) have no `custom_tabs` row at all, so a column on
-- that table could never cover them. This table lets ANY tab, hardcoded or
-- dynamic, override its icon.
--
-- The three columns are mutually exclusive by construction at the
-- application layer (IconPicker's source toggle clears the other two on
-- save) — src/lib/tabIcons.ts's resolveTabIconKind() checks image, then
-- favicon_domain, then icon, in that priority order, so an unexpected
-- multi-column row degrades safely rather than erroring.
create table public.tab_icon_overrides (
  tab            text primary key,
  icon           text,
  favicon_domain text,
  image_url      text,
  updated_by     text,
  updated_at     timestamptz not null default now()
);

alter table public.tab_icon_overrides enable row level security;

create policy "anyone can read tab_icon_overrides"
  on public.tab_icon_overrides for select using (true);
create policy "approved users can insert tab_icon_overrides"
  on public.tab_icon_overrides for insert with check (public.is_approved());
create policy "approved users can update tab_icon_overrides"
  on public.tab_icon_overrides for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete tab_icon_overrides"
  on public.tab_icon_overrides for delete using (public.is_approved());

-- Carry over any icon/favicon a dynamic tab already had (the feature is one
-- day old, so this is expected to move at most a handful of rows).
insert into public.tab_icon_overrides (tab, icon, favicon_domain)
select name, icon, favicon_domain
from public.custom_tabs
where icon is not null or favicon_domain is not null
on conflict (tab) do nothing;

alter table public.custom_tabs drop column icon;
alter table public.custom_tabs drop column favicon_domain;

-- Storage bucket for uploaded tab icons: public read, 2MB cap, image types
-- only — same shape as the `avatars` bucket (20260716120000_add_profile_avatar.sql).
-- Unlike avatars (owned by exactly one user, path `<user_id>/avatar`), a tab
-- icon can be set by any approved user and isn't tied to a stable per-tab
-- path (a brand-new tab in AddBrandTabModal has no confirmed name yet, and a
-- dynamic tab can be renamed later) — so object paths use a client-generated
-- random id instead of the tab name, linked only via tab_icon_overrides.image_url.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tab-icons', 'tab-icons', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "tab icon images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'tab-icons');

create policy "approved users can upload tab icons"
  on storage.objects for insert
  with check (bucket_id = 'tab-icons' and public.is_approved());

create policy "approved users can update tab icons"
  on storage.objects for update
  using (bucket_id = 'tab-icons' and public.is_approved());

create policy "approved users can delete tab icons"
  on storage.objects for delete
  using (bucket_id = 'tab-icons' and public.is_approved());
