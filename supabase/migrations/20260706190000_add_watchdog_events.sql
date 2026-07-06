-- Watchdog anomaly log: scripts/watchdog.ps1 (Windows Task Scheduler, every 5
-- min) pings status_server.py's /health and records a row here whenever it
-- had to restart the unresponsive process. Only ever written by the watchdog
-- script using the service-role key, so no insert/update/delete policy is
-- needed for the app itself.
create table public.watchdog_events (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  outcome      text not null check (outcome in ('restarted', 'restart_failed')),
  detail       text not null
);

create index watchdog_events_occurred_at_idx on public.watchdog_events (occurred_at desc);

alter table public.watchdog_events enable row level security;

create policy "approved users can read watchdog_events"
  on public.watchdog_events for select using (public.is_approved());
