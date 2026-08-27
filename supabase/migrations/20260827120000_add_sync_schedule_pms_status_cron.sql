-- supabase/migrations/20260827120000_add_sync_schedule_pms_status_cron.sql
-- Makes the dashboard -> PMS status sync (Task 247/279) run automatically
-- instead of only when a human visits a tab's Schedule Planner page. See
-- docs/superpowers/specs/2026-08-27-schedule-pms-automatic-status-sync-design.md.
--
-- '* * * * *' is pg_cron's practical floor (1-minute granularity) -- a
-- single scraper run can PATCH 50+ individual entries in quick succession
-- (one row per request, not one bulk statement), so this cron sweep
-- naturally coalesces any burst of writes within a given minute into one
-- resync per tab, rather than firing once per row the way a database
-- trigger would.
--
-- Same net.http_post shape and the same real anon-role JWT already inlined
-- in the existing generate-weekly-schedule-monday job's migration
-- (20260805100000_add_generate_weekly_schedule_cron.sql) -- that JWT is
-- long-lived per that file's own comment, so reusing the identical literal
-- value here is consistent with existing practice, not a new secret.
--
-- Requires pg_cron and pg_net extensions to be enabled (already required by
-- the two existing cron jobs in this project).
select cron.schedule(
  'sync-schedule-pms-status-minutely',
  '* * * * *',
  $$
    select net.http_post(
      url     := 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/sync-schedule-pms',
      body    := '{"action":"syncAllStatuses"}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU"}'::jsonb
    )
  $$
);
