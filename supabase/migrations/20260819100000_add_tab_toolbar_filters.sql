-- Per-tab toolbar filter customization
-- (docs/superpowers/specs/2026-08-19-brand-tab-rename-and-toolbar-filters-design.md):
-- a sparse opt-in overlay, same shape as tab_hidden_platforms — a row's
-- existence means that tab's toolbar is restricted to exactly the filters
-- listed; no row means all 6 filters are allowed (still subject to each
-- filter's own auto-hide-on-sparse-data rule in BrandGroup.tsx).
create table public.tab_toolbar_filters (
  tab              text primary key,
  enabled_filters  text[] not null,
  updated_by       text,
  updated_at       timestamptz not null default now(),
  constraint tab_toolbar_filters_valid_keys check (
    enabled_filters <@ array['brand','agent','proxy','country','status','platform']::text[]
  )
);

alter table public.tab_toolbar_filters enable row level security;

create policy "anyone can read tab_toolbar_filters"
  on public.tab_toolbar_filters for select using (true);
create policy "approved users can insert tab_toolbar_filters"
  on public.tab_toolbar_filters for insert with check (public.is_approved());
create policy "approved users can update tab_toolbar_filters"
  on public.tab_toolbar_filters for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete tab_toolbar_filters"
  on public.tab_toolbar_filters for delete using (public.is_approved());
