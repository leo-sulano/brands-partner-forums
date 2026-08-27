-- supabase/migrations/20260827160000_add_pms_column_reconcile_cron.sql
-- Adds a second 1-minute pg_cron job for the dashboard -> PMS integration:
-- the column-drift reconcile ('reconcileColumns' action on sync-schedule-pms).
-- See docs/superpowers/specs/2026-08-27-pms-column-drift-reconcile-design.md.
--
-- Distinct from sync-schedule-pms-status-minutely (20260827120000): that job
-- keeps schedule_pms_links.synced_status fresh against entry evidence, but
-- only for currently-active tabs, and it is watermark-gated -- so it
-- structurally cannot fix a card that is in the wrong column while
-- synced_status is already correct. That happens when PMS_STATUS_COLUMN_IDS
-- is repointed (Task 267 moved pending/done from "In Progress" to "Done" with
-- no backfill, stranding every already-synced card) or when a human drags a
-- card in the PMS UI. This job makes every linked card -- every tab,
-- including schedule-paused/archived -- obey the column its current
-- synced_status maps to. One GET /tasks per run; a PATCH only per drifted
-- card, so a steady state costs one read and no writes.
--
-- Same net.http_post shape and the same long-lived anon-role JWT literal as
-- the two existing cron jobs (generate-weekly-schedule-monday,
-- sync-schedule-pms-status-minutely) -- consistent with existing practice,
-- not a new secret. Requires pg_cron and pg_net (already enabled).
select cron.schedule(
  'sync-schedule-pms-column-reconcile-minutely',
  '* * * * *',
  $$
    select net.http_post(
      url     := 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/sync-schedule-pms',
      body    := '{"action":"reconcileColumns"}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU"}'::jsonb
    )
  $$
);
