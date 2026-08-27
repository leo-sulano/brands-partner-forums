-- supabase/migrations/20260827130000_add_paused_to_schedule_pms_links_synced_status.sql
-- Widens schedule_pms_links.synced_status's CHECK constraint to allow 'paused'.
--
-- Found live via Task 7's deploy verification for the automatic PMS status
-- sync (docs/superpowers/plans/2026-08-27-schedule-pms-automatic-status-sync.md):
-- the original migration (20260820130000_add_schedule_pms_links_synced_status.sql,
-- Task 247) only allowed 'active' | 'pending' | 'done' | 'published' | 'removed'
-- -- 'paused' was deliberately left out at the time, since the v1 design simply
-- skipped a paused link client-side rather than ever writing 'paused' to this
-- column. Task 267 (2026-08-26, three weeks later) shipped the "move a paused
-- combo's task to the real Project Paused PMS column" feature and started
-- writing synced_status = 'paused' -- but never widened this constraint to
-- match, so every such write has been silently rejected at the DB layer ever
-- since (a real, pre-existing bug, not introduced by this branch).
--
-- This went undetected because the PMS move itself (movePmsTask, a separate
-- HTTP call) always succeeded first -- the board looked correct -- and the
-- failed DB write was swallowed by syncScheduleStatusToPms's per-item
-- try/catch into a generic "N link(s) failed to move" count, with no
-- visibility into *why*. It surfaced clearly only once this branch's
-- automatic sync exercised the paused path at real scale in one sweep (25
-- Hanan + 7 Rooster Partners + 2 TP Brand Injection links, all resolving to
-- 'paused' simultaneously on the first post-deploy tick) -- live-verified via
-- a direct PMS API check confirming the affected tasks were already sitting
-- in the real Project Paused column while their schedule_pms_links rows still
-- read a stale pre-pause status.
alter table public.schedule_pms_links drop constraint schedule_pms_links_synced_status_check;
alter table public.schedule_pms_links add constraint schedule_pms_links_synced_status_check
  check (synced_status = any (array['active', 'pending', 'done', 'published', 'removed', 'paused']));
