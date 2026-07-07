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
# Matches both python.exe (direct launch) and pythonw.exe (how
# start_status_server_only.ps1 launches it, to run hidden) -- a hung server
# started via the helper would otherwise never be found here.
$procs = Get-CimInstance Win32_Process -Filter "Name='python.exe' or Name='pythonw.exe'" |
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
            -Body $body -UserAgent 'forums-dashboard-watchdog/1.0' | Out-Null
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
