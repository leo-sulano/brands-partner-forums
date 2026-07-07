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

# Poll instead of a single fixed-delay check -- a cold-cache interpreter
# start (heavy Flask/Selenium/undetected-chromedriver imports) can take much
# longer than a few seconds, and a single check-after-sleep falsely reports
# failure even though the server comes up moments later.
$deadline = (Get-Date).AddSeconds(30)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2 | Out-Null
        $healthy = $true
        break
    } catch {}
}
if ($healthy) {
    Write-Host '[start] Flask healthy'
} else {
    Write-Warning '[start] Flask did not answer /health'
}
