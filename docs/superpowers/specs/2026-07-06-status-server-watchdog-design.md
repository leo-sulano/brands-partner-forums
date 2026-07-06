# Status Server Watchdog — Design

**Date:** 2026-07-06
**Status:** Approved (design); pending implementation plan

## Problem

`scripts/status_server.py` is the local Flask bridge between the dashboard's
"Check Status" button and the Selenium checkers (`check_review_status.py`,
`check_ag_status.py`, `check_cg_status.py`, `check_wo_status.py`). It runs as a
long-lived background process on a local Windows PC, fronted by an `ngrok`
tunnel so the deployed dashboard can reach it.

This process intermittently stops responding to requests — TCP connections are
accepted but no HTTP response is ever returned, even for the trivial `/health`
route. This has been observed directly during this investigation (a fresh
restart still hung on plain `GET /health`) and matches a pattern of "operation
timed out" failures already present in `scripts/scheduled_check.log` going back
several weeks (2026-06-04 through 2026-07-06). Today, recovery is manual: someone
has to notice, find the process, kill it, and restart it by hand.

## Goal

Detect when `status_server.py` stops responding and recover automatically,
with a visible record of when this happened — without requiring anyone to
notice a hung server on their own.

## Non-Goals

- **No change to `status_server.py`, `check_ag_status.py`, `check_cg_status.py`,
  or any check logic.** This is purely an external monitor/recovery layer. It
  does not attempt to diagnose *why* the server hangs (suspected but unconfirmed:
  Werkzeug's single-process dev server contending with a long-running Selenium
  request; not root-caused here).
- **No CloudWatch / AWS monitoring.** The server runs on a local Windows PC, not
  EC2 — CloudWatch would require agent installation and AWS cost for a
  single-machine check and was explicitly ruled out in favor of a local watchdog.
- **No new dedicated dashboard tab.** Watchdog events surface as a new section
  on the existing "Check Status" page (`SyncStatus.tsx`), not a new page or the
  unrelated "Log" (`ActivityLog.tsx`) audit-trail page.
- **No `ngrok` monitoring/restart.** Only `status_server.py`'s Python process is
  checked and restarted; `ngrok` has not shown the same hanging behavior and
  restarting it unnecessarily would churn the public tunnel URL/session.

## Approach

### 1. Trigger: Windows Task Scheduler, not a background loop

A new `scripts/watchdog.ps1`, registered as a Windows Scheduled Task that runs
**every 5 minutes**. Each run is a single, short-lived check-and-exit — not a
long-running loop. This matches the existing pattern (`scheduled_check_all.ps1`
is already a Task-Scheduler-triggered script) and deliberately avoids
introducing *another* always-on background process that could itself silently
die — the exact failure mode this feature exists to catch.

### 2. Health check and restart

Each run:

1. `GET http://127.0.0.1:5001/health` with a 10-second timeout.
2. **Success (HTTP 200 within 10s):** exit immediately. No log line, no
   Supabase write, no email — a healthy check produces zero output by design
   (288 checks/day of "all good" would be pure noise).
3. **Failure** (timeout, connection refused, or non-200 response):
   - Locate the `python.exe` process(es) running `status_server.py` via
     `Get-CimInstance Win32_Process` filtered on `CommandLine` containing
     `status_server.py` (not a fixed PID — it changes across restarts). If more
     than one match is found (seen once during this investigation, likely a
     stale/orphaned process from a prior forced kill), stop all of them, not
     just the first — a leftover duplicate bound to the same port is exactly
     the kind of state that caused confusing behavior earlier in this session.
     Stop each with `Stop-Process -Force`.
   - Relaunch it via a new shared helper, `scripts/start_status_server_only.ps1`
     (extracted from the existing `start_status_server.ps1`, which today starts
     both the Python server *and* ngrok together). The watchdog calls only the
     Python-starting half — **`ngrok` is left untouched**, since it hasn't shown
     the hanging behavior and restarting it would needlessly cycle the tunnel.
   - Wait ~6 seconds, then re-check `/health` once more to determine whether the
     restart actually worked.
   - Regardless of that outcome, perform all three of: append a line to
     `scripts/watchdog.log`, insert one row into the new `watchdog_events`
     Supabase table, and send one alert email. Each of these three is
     independent and best-effort (see Error Handling) — a failure in one must
     not skip or block the others, and none of them may block or delay the
     restart itself, which is the only step that matters for recovery.

### 3. Data model

New table, added to `supabase/schema.sql`:

```sql
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
```

No insert/update/delete policy is added. The only writer is `watchdog.ps1`,
using `SUPABASE_SERVICE_ROLE_KEY` (same credential and REST pattern as
`check_review_status.py`'s `update_entry`), which bypasses RLS entirely. This
mirrors how `entries` and `sync_runs` are written by the Python checkers today.

`detail` holds a short human-readable summary, e.g. `"no response from
/health after 10s; PID 18772 stopped and relaunched"` or `"no response from
/health after 10s; relaunch attempted but /health still unresponsive after
6s — manual attention needed"`.

### 4. Dashboard UI

- `src/lib/queries.ts`: new `fetchWatchdogEvents(limit = 20)`, reading
  `watchdog_events` ordered by `occurred_at desc` — same shape as
  `fetchFullCheckRuns`.
- New component `src/components/WatchdogEventsTable.tsx`: a flat list (no
  expand/collapse, unlike `RunHistoryTable`) showing timestamp, an outcome
  badge (green "Recovered" for `restarted`, red "Restart Failed" for
  `restart_failed`), and the `detail` text.
- `src/pages/SyncStatus.tsx`: renders a new "Server Health" section below the
  existing Run History table, titled e.g. "Server Health — status check
  server". If `fetchWatchdogEvents` returns zero rows, the section renders
  nothing at all, matching `RunHistoryTable`'s existing `if (runs.length ===
  0) return null;` convention — no empty-state placeholder.

### 5. Email alert

Sent via Gmail SMTP (`smtp.gmail.com:587`) using an app password — the
project has no existing email-sending code, so this introduces the pattern
fresh, using PowerShell's `Send-MailMessage`. New env vars in `scripts/.env`
(documented in `scripts/.env.example`, following the existing `ENIGMA_*`
convention):

```
WATCHDOG_ALERT_TO=leo@optinetsolutions.com
WATCHDOG_SMTP_USER=<a Gmail address used only for sending>
WATCHDOG_SMTP_APP_PASSWORD=<16-character Gmail App Password, not the account password>
```

If `WATCHDOG_SMTP_USER` or `WATCHDOG_SMTP_APP_PASSWORD` is unset, the script
skips the email step entirely (logging still happens) rather than failing —
this lets the rest of the feature ship and be tested before those credentials
exist.

## Data Flow

```
Windows Task Scheduler (every 5 min)
  → scripts/watchdog.ps1
      → GET http://127.0.0.1:5001/health  (10s timeout)
          ├─ 200 OK  → exit, no output
          └─ fail    → stop status_server.py python.exe process (ngrok untouched)
                       → scripts/start_status_server_only.ps1 (relaunch)
                       → re-check /health after ~6s
                       → [best-effort, independent, non-blocking:]
                           - append scripts/watchdog.log
                           - INSERT into watchdog_events (service-role key)
                           - Send-MailMessage via Gmail SMTP → WATCHDOG_ALERT_TO

Dashboard "Check Status" page
  → fetchWatchdogEvents() → watchdog_events (RLS: approved users, read-only)
  → WatchdogEventsTable renders recent anomalies (empty → section hidden)
```

## Error Handling

| Condition | Behavior |
|---|---|
| `/health` succeeds | No log, no DB write, no email. Silent success. |
| `/health` fails, restart succeeds (confirmed by re-check) | Log + DB row + email, outcome `restarted`. |
| `/health` fails, restart's re-check still fails | Log + DB row + email, outcome `restart_failed`, detail flags manual attention needed. |
| No `python.exe` process matching `status_server.py` found to stop | Treated as already-down; skip the stop step and proceed straight to relaunch. |
| Supabase insert fails (network/credential issue) | Log the failure locally in `watchdog.log`; do not retry, do not block the email step. |
| Email send fails (bad credentials, network) | Log the failure locally in `watchdog.log`; do not retry, do not block the Supabase write (already attempted independently). |
| `WATCHDOG_SMTP_USER`/`WATCHDOG_SMTP_APP_PASSWORD` unset | Skip email step silently (this is expected until credentials are configured), still log + write to Supabase. |

## Testing

1. Manual: stop `status_server.py` by hand, run `watchdog.ps1` directly (not
   waiting for the schedule) and confirm it detects the failure, restarts the
   process, writes the log line, inserts the Supabase row, and sends the email.
2. Manual: with `status_server.py` healthy, run `watchdog.ps1` directly and
   confirm it exits with zero output/side effects.
3. Manual: temporarily rename/break `status_server.py` so the relaunch itself
   fails, and confirm the `restart_failed` outcome path (log + DB row + email
   all still fire, with wording indicating manual attention is needed).
4. Frontend: with a manually-inserted `watchdog_events` row, confirm the new
   "Server Health" section renders it correctly; with the table empty, confirm
   the section doesn't render at all.
5. Register the Scheduled Task and confirm it actually fires every 5 minutes
   (check Task Scheduler's history/last-run-result).

## Manual setup the user must do (outside the code)

1. Generate a Gmail App Password for the sending account (Google Account →
   Security → 2-Step Verification → App Passwords) and add `WATCHDOG_SMTP_USER`
   / `WATCHDOG_SMTP_APP_PASSWORD` to `scripts/.env`.
2. Register `scripts/watchdog.ps1` as a Windows Scheduled Task running every 5
   minutes (exact registration command to be provided in the implementation
   plan).
3. Apply the `watchdog_events` table migration to Supabase.
