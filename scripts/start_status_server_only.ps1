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
