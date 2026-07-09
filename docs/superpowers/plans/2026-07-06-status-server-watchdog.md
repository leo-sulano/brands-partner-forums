# Status Server Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect when the local `status_server.py` (the Flask bridge behind the dashboard's "Check Status" button) stops responding, restart it, and surface a visible record of every such anomaly.

**Architecture:** A new `scripts/watchdog.ps1`, registered as a Windows Scheduled Task running every 5 minutes, pings `/health`; on failure it stops and relaunches `status_server.py` (via a small extracted helper, leaving `ngrok` untouched) and writes the anomaly to a local log, a new Supabase table, and an email alert. The dashboard's existing "Check Status" page gains a read-only section showing recent entries from that table.

**Tech Stack:** Windows PowerShell 5.1, Supabase (Postgres + REST), React 19 + TypeScript (Vite), Tailwind v4.

## Global Constraints

- Target shell is **Windows PowerShell 5.1** — no `??`, `?:`, `?.`, no `&&`/`||` pipeline chaining. Use `if/else` and explicit checks (matches the existing `start_status_server.ps1` / `scheduled_check_all.ps1` style).
- Follow the existing per-script `.env` pattern: PowerShell scripts read `scripts/.env` themselves via line-by-line regex matching (as `scheduled_check_all.ps1` already does for `CHECK_STATUS_TOKEN`) — **not** through `src/lib/supabase.ts`, which is frontend-only and unrelated to these standalone scripts.
- Supabase REST writes from PowerShell/Python scripts use the service-role key with headers `apikey`, `Authorization: Bearer <key>`, `Content-Type: application/json`, `Prefer: return=minimal` — the exact pattern already used by `check_review_status.py`'s `update_entry`.
- New database objects go in a new file under `supabase/migrations/` (timestamp-prefixed, e.g. `20260706190000_*.sql`) — **not** `supabase/schema.sql`, which was not kept in sync with the last two migrations (`full_check_runs`, `add_delete_edit_audit_logs`) and is not the live source of truth.
- Frontend: TypeScript strict mode, no `any`. All Supabase queries live in `src/lib/queries.ts` — components and pages never call `supabase.from(...)` directly. Styling is Tailwind v4 utility classes only, matching `RunHistoryTable.tsx`'s existing look (rounded card, `slate`/`emerald`/`rose` palette).
- No automated test framework exists for PowerShell in this repo (no Pester) and no Supabase-mocking harness exists for the frontend `queries.ts` functions (the two existing `*.test.ts` files only cover pure, I/O-free logic). Per YAGNI, this plan does not introduce new test infrastructure for a 4-task feature — verification is manual, with exact commands and expected output given in each task, mirroring the design spec's own "Testing" section.
- After any TypeScript change, verify with `npm run build` (not `tsc --noEmit` alone — the root `tsconfig.json` is references-only and `tsc --noEmit` silently checks nothing).

---

### Task 1: Extract a reusable "start just the Python server" helper

**Files:**
- Create: `scripts/start_status_server_only.ps1`
- Modify: `scripts/start_status_server.ps1` (full rewrite of its body)

**Interfaces:**
- Produces: `scripts/start_status_server_only.ps1`, invoked as `& <path> -Port <int> [-NoHeadless]`. Side effect only (starts `status_server.py` hidden via `pythonw.exe`, waits 6s, checks `/health`, writes `[start] Flask healthy` or a `Write-Warning` to the host). No return value — callers that need to know whether the restart worked must do their own follow-up health check (this is what Task 3 does).
- Consumes: nothing from other tasks.

This existing script currently does two independent things in one file: (1) kill any running Python/ngrok and start a fresh `status_server.py`, (2) start `ngrok`. The watchdog (Task 3) needs only the first half, and must **not** touch `ngrok` or do the blanket "kill every python/pythonw process" step that this script does today (that blanket kill is fine for a human deliberately restarting everything, but wrong for an unattended task running every 5 minutes — it could kill unrelated Python processes on the machine). Splitting out the launch-only logic lets both scripts share it without the watchdog inheriting the blanket-kill or ngrok behavior.

- [x] **Step 1: Create the extracted helper**

Create `scripts/start_status_server_only.ps1`:

```powershell
param(
    [switch]$NoHeadless,
    [int]$Port = 5001
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Use pythonw.exe from the same dir as python.exe (avoids Windows Store stub).
$pyExe = (Get-Command python -ErrorAction Stop).Source
$realPyExe = & python -c "import sys; print(sys.executable)"
$pythonw = Join-Path (Split-Path $realPyExe) 'pythonw.exe'
if (-not (Test-Path $pythonw)) { $pythonw = $realPyExe }

$pyArgs = "`"$scriptDir\status_server.py`" --port $Port"
if ($NoHeadless) { $pyArgs += ' --no-headless' }
Start-Process -FilePath $pythonw -ArgumentList $pyArgs -WorkingDirectory $scriptDir -WindowStyle Hidden

Start-Sleep -Seconds 6
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5 | Out-Null
    Write-Host '[start] Flask healthy'
} catch {
    Write-Warning '[start] Flask did not answer /health'
}
```

This is exactly the "use pythonw / build args / Start-Process / wait / health-check" block that already exists in `start_status_server.ps1` (lines 19–35 today), unchanged, just parameterized without `$Domain`.

- [x] **Step 2: Rewrite `start_status_server.ps1` to call the helper**

Replace the full contents of `scripts/start_status_server.ps1` with:

```powershell
param(
    [string]$Domain = 'unmade-stargazer-absurd.ngrok-free.dev',
    [switch]$NoHeadless,
    [int]$Port = 5001
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Get-Process python,pythonw -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$ngrok = $null
try { $ngrok = (Get-Command ngrok -ErrorAction Stop).Source } catch {
    $cand = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
    if (Test-Path $cand) { $ngrok = $cand }
}
if (-not $ngrok) { throw 'ngrok not found.' }

$helperArgs = @{ Port = $Port }
if ($NoHeadless) { $helperArgs['NoHeadless'] = $true }
& (Join-Path $scriptDir 'start_status_server_only.ps1') @helperArgs

Start-Process -FilePath $ngrok -ArgumentList "http --domain=$Domain 127.0.0.1:$Port" -WindowStyle Hidden
Write-Host '[start] Both processes running hidden in background.'
```

Behavior is unchanged from the reader's perspective: same blanket kill, same `pythonw` launch + health check, same `ngrok` launch — it just delegates the middle part to the new helper instead of duplicating it.

- [x] **Step 3: Verify in isolation, without touching the live server**

The live `status_server.py` (port 5001) is currently relied on by the deployed dashboard via `ngrok`. Do **not** run the full `start_status_server.ps1` against port 5001 as a test — it would kill the running production process. Instead, smoke-test just the new helper on a throwaway port:

Run:
```powershell
powershell -NoProfile -Command "& 'scripts\start_status_server_only.ps1' -Port 5099"
```

Expected output: `[start] Flask healthy` (or the warning, if something else is wrong — but the process should start). Then confirm and clean up:

```powershell
powershell -NoProfile -Command "Invoke-RestMethod http://127.0.0.1:5099/health"
```

Expected: `{"ok":true}` (or equivalent JSON object with `ok: True`). Then stop the test instance so it doesn't linger:

```powershell
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { `$_.CommandLine -like '*--port 5099*' } | ForEach-Object { Stop-Process -Id `$_.ProcessId -Force }"
```

Review (do not execute against port 5001) the rewritten `start_status_server.ps1` by reading it side-by-side with the original to confirm no behavioral change other than the delegation.

- [x] **Step 4: Commit**

```bash
git add scripts/start_status_server_only.ps1 scripts/start_status_server.ps1
git commit -m "refactor: extract start_status_server_only.ps1 helper

Splits the python-launch logic out of start_status_server.ps1 so the
upcoming watchdog script can reuse it without inheriting the blanket
kill-all-python or the ngrok restart, neither of which are safe for an
unattended task running every 5 minutes."
```

---

### Task 2: `watchdog_events` table

**Files:**
- Create: `supabase/migrations/20260706190000_add_watchdog_events.sql`

**Interfaces:**
- Produces: table `public.watchdog_events(id uuid, occurred_at timestamptz, outcome text, detail text)`. Consumed by Task 3 (INSERT via service-role key) and Task 4 (SELECT via `fetchWatchdogEvents`).
- Consumes: `public.is_approved()` (already defined in an earlier migration — used as-is, not redefined).

- [x] **Step 1: Write the migration**

Create `supabase/migrations/20260706190000_add_watchdog_events.sql`:

```sql
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
```

- [x] **Step 2: Apply the migration**

Run (from the repo root; requires this checkout to already be linked — `supabase link --project-ref <ref>` if `supabase status` errors with "not linked"):

```bash
supabase db push
```

Expected output: a line confirming `20260706190000_add_watchdog_events.sql` was applied, with no errors.

- [x] **Step 3: Verify the table and RLS**

Run:
```bash
supabase db execute --sql "select table_name from information_schema.tables where table_name = 'watchdog_events';"
```
Expected: one row, `watchdog_events`.

```bash
supabase db execute --sql "select policyname from pg_policies where tablename = 'watchdog_events';"
```
Expected: one row, `approved users can read watchdog_events`.

- [x] **Step 4: Commit**

```bash
git add supabase/migrations/20260706190000_add_watchdog_events.sql
git commit -m "feat: add watchdog_events table for status-server anomaly log"
```

---

### Task 3: `watchdog.ps1` — detect, recover, and report

**Files:**
- Create: `scripts/watchdog.ps1`
- Create: `scripts/register_watchdog_task.ps1`
- Modify: `scripts/.env.example`

**Interfaces:**
- Consumes: `scripts/start_status_server_only.ps1` (Task 1) invoked as `& <path> -Port 5001`; table `public.watchdog_events` (Task 2) via `POST {SUPABASE_URL}/rest/v1/watchdog_events`.
- Produces: `scripts/watchdog.log` (one line per anomaly); rows in `watchdog_events`; outbound email via Gmail SMTP. Nothing downstream depends on this script's own return value — it's a leaf, invoked only by Windows Task Scheduler.
- Env vars read from `scripts/.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (both already present), plus new `WATCHDOG_ALERT_TO`, `WATCHDOG_SMTP_USER`, `WATCHDOG_SMTP_APP_PASSWORD`.

- [x] **Step 1: Add the new env vars to `.env.example`**

Read `scripts/.env.example`, then append after the existing `ENIGMA_PW_GB=uk-proxy-password` line:

```
# ─── Watchdog alerting (scripts/watchdog.ps1) ───
# Who gets emailed when status_server.py has to be auto-restarted.
WATCHDOG_ALERT_TO=you@example.com
# Gmail account used only to SEND the alert, via smtp.gmail.com:587.
WATCHDOG_SMTP_USER=alerts@example.com
# 16-character Gmail App Password (Google Account -> Security -> 2-Step
# Verification -> App Passwords) — NOT the account's real password. If this
# and WATCHDOG_SMTP_USER are left blank, the watchdog still restarts the
# server and logs the anomaly — it just skips the email step.
WATCHDOG_SMTP_APP_PASSWORD=xxxxxxxxxxxxxxxx
```

- [x] **Step 2: Write `watchdog.ps1`**

Create `scripts/watchdog.ps1`:

```powershell
# Runs every 5 minutes via a Windows Scheduled Task (see
# register_watchdog_task.ps1). Pings the local status_server.py health
# endpoint; if it's unresponsive, restarts it (ngrok is left untouched) and
# records the anomaly to a local log, Supabase, and an email alert.
#
# A healthy check produces zero output and zero side effects by design —
# only anomalies are logged.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile   = Join-Path $scriptDir 'watchdog.log'
$envFile   = Join-Path $scriptDir '.env'
$port      = 5001

function Read-EnvVar([string]$name) {
    if (-not (Test-Path $envFile)) { return '' }
    $pattern = "^$name=(.+)$"
    $line = Get-Content $envFile | Where-Object { $_ -match $pattern } | Select-Object -First 1
    if ($line -and $line -match $pattern) { return $Matches[1].Trim() }
    return ''
}

function Test-Health {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -TimeoutSec 10 -UseBasicParsing
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (Test-Health) {
    exit 0
}

# --- Unresponsive: stop the matching process(es) and relaunch ---
$procs = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*status_server.py*' }

$stoppedIds = @()
foreach ($p in $procs) {
    $stoppedIds += $p.ProcessId
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

& (Join-Path $scriptDir 'start_status_server_only.ps1') -Port $port

$recovered = Test-Health

$idsText = if ($stoppedIds.Count -gt 0) { "PID(s) $($stoppedIds -join ', ')" } else { 'no matching process found' }
if ($recovered) {
    $outcome = 'restarted'
    $detail  = "no response from /health after 10s; $idsText stopped and relaunched"
} else {
    $outcome = 'restart_failed'
    $detail  = "no response from /health after 10s; $idsText stopped and relaunched, but /health still unresponsive after restart -- manual attention needed"
}

$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

# 1. Local log (best-effort — must not block the steps below)
try {
    Add-Content $logFile "$timestamp  $outcome  $detail"
} catch {
    Write-Warning "[watchdog] failed to write local log: $_"
}

# 2. Supabase row (best-effort)
try {
    $supabaseUrl = Read-EnvVar 'SUPABASE_URL'
    $supabaseKey = Read-EnvVar 'SUPABASE_SERVICE_ROLE_KEY'
    if ($supabaseUrl -and $supabaseKey) {
        $body = @{ outcome = $outcome; detail = $detail } | ConvertTo-Json
        Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/watchdog_events" -Method POST `
            -Headers @{
                apikey         = $supabaseKey
                Authorization  = "Bearer $supabaseKey"
                'Content-Type' = 'application/json'
                Prefer         = 'return=minimal'
            } `
            -Body $body | Out-Null
    }
} catch {
    Write-Warning "[watchdog] failed to write watchdog_events row: $_"
}

# 3. Email alert (best-effort, skipped gracefully if unconfigured)
try {
    $alertTo  = Read-EnvVar 'WATCHDOG_ALERT_TO'
    $smtpUser = Read-EnvVar 'WATCHDOG_SMTP_USER'
    $smtpPass = Read-EnvVar 'WATCHDOG_SMTP_APP_PASSWORD'
    if ($alertTo -and $smtpUser -and $smtpPass) {
        $securePass = ConvertTo-SecureString $smtpPass -AsPlainText -Force
        $cred = New-Object System.Management.Automation.PSCredential($smtpUser, $securePass)
        Send-MailMessage -From $smtpUser -To $alertTo `
            -Subject "[Forums Dashboard] status_server.py $outcome" `
            -Body "$timestamp`n`n$detail" `
            -SmtpServer 'smtp.gmail.com' -Port 587 -UseSsl `
            -Credential $cred
    }
} catch {
    Write-Warning "[watchdog] failed to send alert email: $_"
}
```

- [x] **Step 3: Write the Scheduled Task registration helper**

Create `scripts/register_watchdog_task.ps1`:

```powershell
# One-time setup: registers scripts/watchdog.ps1 as a Windows Scheduled Task
# that runs every 5 minutes, indefinitely. Run this once as the user who
# should own the task (the same user status_server.py normally runs as).
$scriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$watchdogPath = Join-Path $scriptDir 'watchdog.ps1'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchdogPath`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration ([TimeSpan]::MaxValue)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -DontStopOnIdleEnd -AllowStartIfOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName 'ForumsDashboardWatchdog' `
    -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Pings status_server.py /health every 5 min; restarts it if unresponsive.' `
    -Force

Write-Host "[watchdog] Scheduled task 'ForumsDashboardWatchdog' registered -- runs every 5 minutes."
```

- [x] **Step 4: Manual test — healthy path (no side effects)**

With the real `status_server.py` running normally on port 5001:

Run:
```powershell
powershell -NoProfile -File scripts\watchdog.ps1
echo "exit code: $LASTEXITCODE"
```
Expected: no console output before the echo, `exit code: 0`, and no new line appended to `scripts\watchdog.log`.

- [x] **Step 5: Manual test — unresponsive path (restart + report)**

Stop the real server to simulate a hang:
```powershell
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*status_server.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Run the watchdog directly:
```powershell
powershell -NoProfile -File scripts\watchdog.ps1
```

Expected:
1. A new `python.exe` process running `status_server.py` exists afterward — confirm with `Get-CimInstance Win32_Process -Filter "Name='python.exe'"`.
2. `scripts\watchdog.log` has a new line starting with today's timestamp and `restarted`.
3. Querying Supabase (`supabase db execute --sql "select outcome, detail from watchdog_events order by occurred_at desc limit 1;"`) shows a matching `restarted` row.
4. If `WATCHDOG_SMTP_USER`/`WATCHDOG_SMTP_APP_PASSWORD` are set, an email arrives at `WATCHDOG_ALERT_TO`; if unset, no error is thrown and steps 1–3 still succeeded.

- [x] **Step 6: Manual test — failed-restart path**

Temporarily rename `status_server.py` so the relaunch itself fails:
```powershell
Rename-Item scripts\status_server.py scripts\status_server.py.bak
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*status_server.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
powershell -NoProfile -File scripts\watchdog.ps1
Rename-Item scripts\status_server.py.bak scripts\status_server.py
```
Expected: `scripts\watchdog.log` gets a line with outcome `restart_failed` and detail text containing "manual attention needed"; the Supabase row matches. Immediately re-run `scripts\watchdog.ps1` once more after restoring the file to confirm it self-heals (outcome `restarted` this time, since the real server can now start).

- [x] **Step 7: Register the task**

```powershell
powershell -NoProfile -File scripts\register_watchdog_task.ps1
Get-ScheduledTask -TaskName 'ForumsDashboardWatchdog' | Select-Object TaskName, State
```
Expected: `State` is `Ready`. Wait 5+ minutes and check `Get-ScheduledTask -TaskName 'ForumsDashboardWatchdog' | Get-ScheduledTaskInfo` — `LastRunTime` should have updated and `LastTaskResult` should be `0`.

- [x] **Step 8: Commit**

```bash
git add scripts/watchdog.ps1 scripts/register_watchdog_task.ps1 scripts/.env.example
git commit -m "feat: add status_server.py watchdog (detect, restart, log, alert)

Windows Scheduled Task, every 5 min: pings /health, and on failure stops
and relaunches status_server.py (ngrok untouched), then best-effort
logs to watchdog.log, writes a watchdog_events row, and emails
WATCHDOG_ALERT_TO. Each of those three is independent so one failing
never blocks the others or the restart itself."
```

---

### Task 4: Dashboard "Server Health" section

> **Deviation note (2026-07-09):** `SyncStatus.tsx` (the standalone Check
> Status page this task targeted) was fully removed on 2026-07-08 (Task 122,
> `297a6c9`) before this task was picked up — along with `RunHistoryTable`,
> `FullCheckScopePicker`, and `fetchFullCheckRuns`. Re-scoped by user decision
> to add a "Server Health" tab to the Log page (`ActivityLog.tsx`) instead,
> as a fourth tab alongside Activity/Edits/Deletes, using that page's inline
> component + card-list styling convention rather than a separate
> `WatchdogEventsTable.tsx`. Also gated to `profile.email ===
> 'leo@optinetsolutions.com'` only, per user request — stricter than the
> page's normal any-approved-user access. The steps below are left as
> originally written for history; see `docs/task-history.md`'s Task 107
> entry for what was actually shipped.

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/pages/ActivityLog.tsx` (inline `ServerHealthFeed` component, not a separate file)

**Interfaces:**
- Consumes: table `public.watchdog_events` (Task 2).
- Produces: `export interface WatchdogEvent { id: string; occurred_at: string; outcome: 'restarted' | 'restart_failed'; detail: string; }` and `export async function fetchWatchdogEvents(limit = 20): Promise<WatchdogEvent[]>` in `src/lib/queries.ts`, consumed by `SyncStatus.tsx`. `WatchdogEventsTable` takes `{ events: WatchdogEvent[] }` and renders `null` when `events.length === 0`.

- [x] **Step 1: Add `WatchdogEvent` + `fetchWatchdogEvents` to `queries.ts`**

Add to `src/lib/queries.ts`, immediately after the existing `fetchFullCheckRuns` function (after line 1092):

```ts
export interface WatchdogEvent {
  id: string;
  occurred_at: string;
  outcome: 'restarted' | 'restart_failed';
  detail: string;
}

export async function fetchWatchdogEvents(limit = 20): Promise<WatchdogEvent[]> {
  const { data, error } = await supabase
    .from('watchdog_events')
    .select('id, occurred_at, outcome, detail')
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as WatchdogEvent[];
}
```

- [x] **Step 2: Create `WatchdogEventsTable.tsx`**

Create `src/components/WatchdogEventsTable.tsx`:

```tsx
import type { WatchdogEvent } from '../lib/queries';

interface WatchdogEventsTableProps {
  events: WatchdogEvent[];
}

export default function WatchdogEventsTable({ events }: WatchdogEventsTableProps) {
  if (events.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="rounded-tl-lg px-4 py-3">When</th>
            <th className="px-4 py-3">Outcome</th>
            <th className="rounded-tr-lg px-4 py-3">Detail</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, i) => {
            const isLast = i === events.length - 1;
            const label = new Date(event.occurred_at).toLocaleString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            });
            return (
              <tr key={event.id} className={!isLast ? 'border-b border-slate-100' : ''}>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{label}</td>
                <td className="px-4 py-3">
                  {event.outcome === 'restarted' ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                      Recovered
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                      Restart Failed
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{event.detail}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [x] **Step 3: Wire into `SyncStatus.tsx`**

In `src/pages/SyncStatus.tsx`, update the import block (currently line 1–7):

```tsx
import { useEffect, useReducer, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { triggerStatusCheck, fetchAllTabsStatusSummary, recordFullCheckRun, fetchFullCheckRuns, fetchWatchdogEvents, type TabStatusRow, type FullCheckRun, type RunScope, type WatchdogEvent } from '../lib/queries';
import Toast, { type ToastKind } from '../components/Toast';
import { TAB_COLUMN_CONFIGS, getTabSequence } from '../lib/tab-configs';
import FullCheckScopePicker from '../components/FullCheckScopePicker';
import RunHistoryTable from '../components/RunHistoryTable';
import WatchdogEventsTable from '../components/WatchdogEventsTable';
```

Add state and a fetch effect, right after the existing `checkHistory` state/effect (currently lines 51 and 71):

```tsx
  const [checkHistory, setCheckHistory] = useState<FullCheckRun[]>([]);
  const [watchdogEvents, setWatchdogEvents] = useState<WatchdogEvent[]>([]);
```

```tsx
  useEffect(() => { fetchFullCheckRuns().then(setCheckHistory).catch(() => setCheckHistory([])); }, []);
  useEffect(() => { fetchWatchdogEvents().then(setWatchdogEvents).catch(() => setWatchdogEvents([])); }, []);
```

Render the new section right after `<RunHistoryTable runs={checkHistory} />` (currently line 195), still inside the outer `<div className="space-y-6">`:

```tsx
        <RunHistoryTable runs={checkHistory} />
      </div>

      {watchdogEvents.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-slate-800">Server Health — status check server</h2>
          <WatchdogEventsTable events={watchdogEvents} />
        </div>
      )}

      {toast ? <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} /> : null}
```

(This closes the existing "Full Check Status" `<div className="space-y-4">` block, then adds the new sibling section before the toast — matching how the existing sections are laid out as siblings inside the top-level `space-y-6` container.)

- [x] **Step 4: Build check**

Run:
```bash
npm run build
```
Expected: builds with no TypeScript errors. (Per project convention, `tsc --noEmit` alone is not a valid check here — always use the full build.)

- [x] **Step 5: Manual verification against real data**

Insert a temporary row:
```bash
supabase db execute --sql "insert into watchdog_events (outcome, detail) values ('restart_failed', 'manual test row — safe to delete');"
```
Run `npm run dev`, open the "Check Status" page, and confirm a "Server Health — status check server" section appears with one row showing a red "Restart Failed" badge and the test detail text. Then delete it:
```bash
supabase db execute --sql "delete from watchdog_events where detail = 'manual test row — safe to delete';"
```
Reload the page and confirm the "Server Health" section disappears entirely (not an empty table — no heading, no card).

- [x] **Step 6: Commit**

```bash
git add src/lib/queries.ts src/components/WatchdogEventsTable.tsx src/pages/SyncStatus.tsx
git commit -m "feat: show watchdog anomalies in a Server Health section on Check Status page"
```
