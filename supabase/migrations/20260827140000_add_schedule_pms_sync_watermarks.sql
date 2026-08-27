-- supabase/migrations/20260827140000_add_schedule_pms_sync_watermarks.sql
-- Lets resolveAndSyncTabStatuses (src/lib/scheduler/pmsSync.ts) skip its
-- expensive full-entries fetch when nothing has changed for a tab since the
-- last successful resolve -- the 1-minute cron
-- (sync-schedule-pms-status-minutely, 20260827120000) was re-pulling every
-- active tab's entire entries table every minute forever, a real resource
-- cost the original spec's "cheap" reasoning measured in query count, not
-- data volume (flagged, parked, and now addressed in a same-day follow-up).
--
-- One row per tab: last_seen_max_updated_at is the entries.updated_at value
-- (as returned by Postgres, stored verbatim as text -- a simple equality
-- check, not date arithmetic) that was in effect the last time this tab was
-- successfully resolved. resolveAndSyncTabStatuses compares this against a
-- fresh, cheap `select updated_at ... order by updated_at desc limit 1`
-- (entries_tab_updated_idx, already present in schema.sql, makes this
-- effectively an index-only scan) before doing the heavy `select *` full
-- entries pull -- unchanged means nothing for this tab could have changed,
-- so the whole resolve is skipped for that tick.
--
-- Deliberately scoped to entries.updated_at only, not the exclusion tables
-- (removed_platform_brands, schedule_hidden_brands,
-- schedule_platform_restrictions, brand_platform_pause, brand_schedule) --
-- those change far less often, and a config-only change (no entries write)
-- is still caught by the on-visit trigger the next time someone opens that
-- tab, or by the next entries change on that tab. Same RLS shape as
-- schedule_pms_links (the sibling sync-state table): anyone can read,
-- approved users can write -- only the service-role Edge Function actually
-- writes it, but every policy is still defined explicitly per this
-- project's established convention rather than relying on that as an
-- implicit guarantee.
create table public.schedule_pms_sync_watermarks (
  tab                     text primary key,
  last_seen_max_updated_at text not null,
  updated_at              timestamptz not null default now()
);

alter table public.schedule_pms_sync_watermarks enable row level security;

create policy "anyone can read schedule_pms_sync_watermarks"
  on public.schedule_pms_sync_watermarks for select using (true);
create policy "approved users can insert schedule_pms_sync_watermarks"
  on public.schedule_pms_sync_watermarks for insert with check (public.is_approved());
create policy "approved users can update schedule_pms_sync_watermarks"
  on public.schedule_pms_sync_watermarks for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete schedule_pms_sync_watermarks"
  on public.schedule_pms_sync_watermarks for delete using (public.is_approved());
