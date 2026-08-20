-- Brand Tab Pause (lightweight, reversible aggregation exclusion)
-- (docs/superpowers/specs/2026-08-20-brand-tab-pause-design.md): a
-- current-state-only table -- a row's mere presence means that tab is
-- currently paused. Deliberately NOT shaped like tab_archive_log (no
-- reason, no restored_at/history) -- this is a quick, reversible toggle,
-- not an audited event. No UPDATE policy: a status change is always an
-- insert (pause) or a delete (unpause), never an update to an existing row.
create table public.paused_tabs (
  tab             text primary key,
  paused_by_email text not null,
  paused_at       timestamptz not null default now()
);

alter table public.paused_tabs enable row level security;

-- Read access is is_approved() (not is_admin()) because every consuming
-- surface -- the Sidebar badge, Overview/Score Summary/Schedule Planner
-- filtering -- is reached by any approved user, not just admins. Only the
-- toggle itself (insert/delete) is admin-gated, matching this feature's
-- "admin-only" decision -- stricter than every other tab-management policy
-- in this project (tab_hidden_platforms, tab_toolbar_filters, custom_tabs,
-- tab_archive_log all gate writes behind is_approved()).
create policy "approved users can read paused_tabs"
  on public.paused_tabs for select using (public.is_approved());
create policy "admins can insert paused_tabs"
  on public.paused_tabs for insert with check (public.is_admin());
create policy "admins can delete paused_tabs"
  on public.paused_tabs for delete using (public.is_admin());
