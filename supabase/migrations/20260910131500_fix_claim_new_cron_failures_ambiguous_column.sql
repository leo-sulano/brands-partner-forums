-- supabase/migrations/20260910131500_fix_claim_new_cron_failures_ambiguous_column.sql
-- Fixes a real bug in claim_new_cron_failures() (20260910130000), found via
-- live testing with a deliberately-broken test cron job: the function's own
-- RETURNS TABLE column "jobname" is an implicit PL/pgSQL variable in scope,
-- which PL/pgSQL's naive identifier-substitution pass treats as a candidate
-- for the bare "jobname" in the second query's INSERT column list and
-- "select j.jobname" -- Postgres then refuses the statement outright
-- ("column reference \"jobname\" is ambiguous") rather than guessing.
-- #variable_conflict use_column tells PL/pgSQL to always prefer the table
-- column over a same-named variable for the rest of this function, which is
-- the correct choice here (there's no reason this function would ever want
-- its own jobname/runid OUT variables instead of the query's own columns).
create or replace function public.claim_new_cron_failures()
returns table (jobname text, runid bigint, start_time timestamptz, return_message text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
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
