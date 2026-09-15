-- supabase/migrations/20260915140000_add_schedule_pms_links_entry_id_index.sql
-- Final whole-branch review of the per-account PMS task cards feature
-- (docs/superpowers/specs/2026-09-15-pms-per-account-tasks-design.md, Minor
-- finding M3): schedule_pms_links.entry_id (added in
-- 20260915130000_add_schedule_pms_links_entry_id.sql) had no index of its
-- own -- every entry-tied-link lookup keyed by entry_id (e.g. resolving a
-- specific entry's own link during resolveAndSyncTabStatuses) fell back to a
-- full table scan. Partial (where entry_id is not null) since the column is
-- null for every pre-existing generic link and stays null for most rows even
-- as entry-tied links accumulate -- additive-only, no data risk.

create index schedule_pms_links_entry_id_idx
  on public.schedule_pms_links (entry_id)
  where entry_id is not null;
