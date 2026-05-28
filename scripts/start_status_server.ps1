<#
start_status_server.ps1
Starts the Selenium status server AND an ngrok tunnel on your permanent static
domain, so the deployed dashboard can reach this machine's "Check Status"
backend over HTTPS at a URL that never changes.

Run this on the always-on PC (residential IP) that owns the checks.

Usage:
  ./start_status_server.ps1                 # uses the default static domain below
  ./start_status_server.ps1 -Headless       # run Chrome headless
  ./start_status_server.ps1 -Domain my.ngrok-free.dev   # override the domain

Prereqs (one-time):
  - ngrok installed + authtoken saved (ngrok config add-authtoken <token>)
  - CHECK_STATUS_TOKEN set in scripts/.env (must match VITE_CHECK_STATUS_TOKEN on Vercel)
  - Vercel VITE_CHECK_STATUS_URL = https://<Domain>/check-status  (+ redeploy)

Keep this window open while teammates need Check Status. Ctrl+C stops the tunnel.
#>
param(
    [string]$Domain = 'unmade-stargazer-absurd.ngrok-free.dev',
    [switch]$Headless,
    [int]$Port = 5001
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Resolve ngrok: prefer PATH, fall back to the winget install location.
$ngrok = $null
try { $ngrok = (Get-Command ngrok -ErrorAction Stop).Source } catch {
    $cand = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
    if (Test-Path $cand) { $ngrok = $cand }
}
if (-not $ngrok) { throw "ngrok not found. Install it (winget install ngrok) and run: ngrok config add-authtoken <token>" }

# 1. Start the Flask + Selenium server in its own window so its logs stay visible.
$pyArgs = "`"$scriptDir\status_server.py`" --port $Port"
if ($Headless) { $pyArgs += ' --headless' }
Write-Host "[start] Launching status server (python status_server.py --port $Port)..."
Start-Process -FilePath 'python' -ArgumentList $pyArgs -WorkingDirectory $scriptDir

# Give Flask a moment to bind, then confirm it's up.
# Use 127.0.0.1 (not localhost): Flask binds IPv4 only, but localhost can resolve
# to IPv6 (::1) on Windows, which would look like a failure.
Start-Sleep -Seconds 3
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5 | Out-Null
    Write-Host "[start] Status server is healthy on http://127.0.0.1:$Port"
} catch {
    Write-Warning "Status server did not answer /health yet - check the server window before relying on the tunnel."
}

# 2. Start the ngrok tunnel on the permanent static domain (foreground; Ctrl+C to stop).
Write-Host "[start] Public URL: https://$Domain/check-status"
& $ngrok http --domain=$Domain "127.0.0.1:$Port"
