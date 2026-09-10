-- supabase/migrations/20260910130000_add_cron_failure_alerting.sql
-- Cron-failure alerting: pg_cron already records every job's success/failure
-- in cron.job_run_details, but nothing surfaced a failure until now -- a
-- silently-failing job (e.g. generate-weekly-schedule-monday) would only be
-- noticed when someone spotted a missing schedule or a stale PMS card.
--
-- Generic by design: watches every currently-active job in cron.job, not a
-- hardcoded list of today's 4 job names, so a future job is covered with no
-- code change.
--
-- cron_alert_state tracks, per job, the highest runid already alerted on --
-- so a job stuck failing every 15 minutes emails once, not every 15 minutes
-- forever, and a job that starts failing again after being fixed (a new,
-- higher runid) correctly alerts again.
create table public.cron_alert_state (
  jobname             text primary key,
  last_alerted_runid  bigint not null default 0,
  updated_at          timestamptz not null default now()
);

alter table public.cron_alert_state enable row level security;

create policy "approved users can read cron_alert_state"
  on public.cron_alert_state for select using (public.is_approved());

-- Seed every job currently registered with its CURRENT max runid, so this
-- feature never alerts on historical failures that predate it -- only on a
-- failure that happens after this migration is applied.
insert into public.cron_alert_state (jobname, last_alerted_runid)
select j.jobname, coalesce(max(d.runid), 0)
from cron.job j
left join cron.job_run_details d on d.jobid = j.jobid
group by j.jobname
on conflict (jobname) do nothing;

-- Atomically returns every active job's failed runs newer than its
-- last-alerted runid, and advances that watermark in the same transaction --
-- so two overlapping invocations of the check can't both send the same
-- alert (an unlikely race at a 15-minute cadence, but atomic costs nothing
-- extra). SECURITY DEFINER (owned by the migration role) because
-- cron.job_run_details isn't otherwise readable by service_role.
create or replace function public.claim_new_cron_failures()
returns table (jobname text, runid bigint, start_time timestamptz, return_message text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select j.jobname, d.runid, d.start_time, d.return_message
    from cron.job j
    join cron.job_run_details d on d.jobid = j.jobid
    left join public.cron_alert_state s on s.jobname = j.jobname
    where j.active
      and d.status = 'failed'
      and d.runid > coalesce(s.last_alerted_runid, 0)
    order by j.jobname, d.runid;

  -- Only jobs with at least one new failure appear here (the where clause
  -- matches the query above), so this can never insert a NULL watermark.
  insert into public.cron_alert_state (jobname, last_alerted_runid)
  select j.jobname, max(d.runid)
  from cron.job j
  join cron.job_run_details d on d.jobid = j.jobid
  left join public.cron_alert_state s on s.jobname = j.jobname
  where j.active
    and d.status = 'failed'
    and d.runid > coalesce(s.last_alerted_runid, 0)
  group by j.jobname
  on conflict (jobname) do update
    set last_alerted_runid = excluded.last_alerted_runid,
        updated_at = now();
end;
$$;

revoke all on function public.claim_new_cron_failures() from public;
grant execute on function public.claim_new_cron_failures() to service_role;

-- Runs every 15 minutes; hits the new cron-failure-alert Edge Function,
-- same net.http_post + long-lived anon-role JWT pattern already used by
-- every other cron job in this project (see e.g.
-- 20260901140000_add_pms_daily_status_audit_cron.sql).
select cron.schedule(
  'cron-failure-alert-check',
  '*/15 * * * *',
  $$
    select net.http_post(
      url     := 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/cron-failure-alert',
      body    := '{}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU"}'::jsonb
    )
  $$
);
