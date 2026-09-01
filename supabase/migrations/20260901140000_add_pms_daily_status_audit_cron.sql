-- supabase/migrations/20260901140000_add_pms_daily_status_audit_cron.sql
-- Adds a once-daily pg_cron job for the dashboard -> PMS status sync's
-- self-healing safety net: the 'auditAllStatuses' action on sync-schedule-pms
-- (Task 302, docs/task-history.md).
--
-- Distinct from sync-schedule-pms-status-minutely (20260827120000): that job
-- is watermark-gated for cost reasons (skips a tab whose entries haven't
-- changed since its last fully-successful resolve) -- a real optimization,
-- but one that trusts "the last resolve completed with zero exceptions" as
-- proof every individual link was actually synced correctly. This project
-- has repeatedly found new, different ways for that trust to be misplaced
-- (Tasks 287, 288, 302), each one only discovered because a human noticed a
-- stuck PMS card and asked -- there was no automatic self-healing. This job
-- forces every active+paused tab's resolve past its watermark once a day,
-- reproducing the exact manual remediation (clear the tab's watermark,
-- re-run syncAllStatuses) that fixed all 3 of those incidents, automatically,
-- regardless of whether the underlying cause is one already seen before.
--
-- 18:00 UTC = 02:00 Manila (this team's timezone, see scheduleBrands.ts's
-- toISODate) -- overnight, after the day's posting/review activity, so a
-- same-day Done status is caught by the very next minutely tick anyway and
-- this audit only ever needs to catch what the minutely cron missed.
--
-- Same net.http_post shape and the same long-lived anon-role JWT literal
-- already inlined in the two existing sync-schedule-pms cron jobs
-- (sync-schedule-pms-status-minutely, sync-schedule-pms-column-reconcile-
-- minutely) -- consistent with existing practice, not a new secret. Requires
-- pg_cron and pg_net (already enabled).
select cron.schedule(
  'sync-schedule-pms-daily-status-audit',
  '0 18 * * *',
  $$
    select net.http_post(
      url     := 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/sync-schedule-pms',
      body    := '{"action":"auditAllStatuses"}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU"}'::jsonb
    )
  $$
);
