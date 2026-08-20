-- Schedule Planner -> PMS status sync (docs/superpowers/specs/2026-08-20-schedule-planner-pms-status-sync-design.md):
--
-- Tracks which status was last successfully reflected onto a linked PMS
-- task's column, so the browser-driven sync only calls the PMS move API for
-- links whose resolved status has actually changed since the last sync --
-- without this, every tab visit would re-issue a move call for every linked
-- task regardless of whether anything changed.
--
-- Existing rows (all created before this column existed, sitting in PMS's To
-- Do column, never moved) default to 'active', which is correct: nothing has
-- ever moved them, so 'active' (-> To Do) is an accurate record of their
-- last-known-synced state.
alter table public.schedule_pms_links
  add column synced_status text not null default 'active'
    check (synced_status in ('active', 'pending', 'done', 'published', 'removed'));
