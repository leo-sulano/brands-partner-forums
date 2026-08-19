-- Brand Tab archive (reversible delete + reason)
-- (docs/superpowers/specs/2026-08-19-brand-tab-archive-design.md): a fresh,
-- standalone audit table, shaped like the existing delete_log/edit_log but
-- keyed by `tab` (text) instead of `entity_id` (uuid) -- a hardcoded tab has
-- no row/uuid anywhere to key off, unlike an entry or account. Deliberately
-- not reusing delete_log, to avoid touching its already-shipped, already-
-- tested entry/account restore code.
create table public.tab_archive_log (
  id                 uuid primary key default gen_random_uuid(),
  tab                text not null,
  reason             text not null,
  actor_email        text not null,
  created_at         timestamptz not null default now(),
  restored_at        timestamptz,
  restored_by_email  text
);

-- only one *active* (non-restored) archive row per tab at a time
create unique index tab_archive_log_active_idx
  on public.tab_archive_log (tab) where restored_at is null;

alter table public.tab_archive_log enable row level security;

-- Same access model as every other tab-management table in this feature
-- area (tab_hidden_platforms, tab_toolbar_filters, custom_tabs): any
-- approved user, not admin-only. No delete policy -- this is an append-only
-- audit table, matching the existing delete_log/edit_log precedent, which
-- also has no delete policy.
create policy "approved users can read tab_archive_log"
  on public.tab_archive_log for select using (public.is_approved());
create policy "approved users can insert tab_archive_log"
  on public.tab_archive_log for insert with check (public.is_approved());
create policy "approved users can restore tab_archive_log"
  on public.tab_archive_log for update
  using (public.is_approved()) with check (public.is_approved());
