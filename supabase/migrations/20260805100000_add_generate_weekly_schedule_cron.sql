-- supabase/migrations/20260805100000_add_generate_weekly_schedule_cron.sql
-- Runs Schedule Planner generation every Monday via the new
-- generate-weekly-schedule Edge Function, so a tab's schedule generates
-- even if nobody opens that tab's Schedule Planner page that week. The
-- existing page-visit trigger (SchedulePlanner.tsx's isCurrentWeek-gated
-- effect) stays in place as an idempotent fallback. See
-- docs/superpowers/specs/2026-08-05-schedule-planner-weekly-cron-design.md.
--
-- 01:00 UTC Monday = 09:00 Asia/Manila Monday, the team's operating
-- timezone (see ai-assistant's system-message +8h offset and
-- scheduleBrands.ts's toISODate) — safely past local midnight, so the job
-- never fires while it's still Sunday there.
--
-- Requires pg_cron and pg_net extensions to be enabled in the Supabase
-- dashboard (already required by check-tp-review-status-daily below in
-- schema.sql, so almost certainly already on).
select cron.schedule(
  'generate-weekly-schedule-monday',
  '0 1 * * 1',
  $$
    select net.http_post(
      url     := 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/generate-weekly-schedule',
      body    := '{}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU"}'::jsonb
    )
  $$
);
