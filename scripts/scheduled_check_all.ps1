# Scheduled 6pm daily check — POSTs to the local Flask server to check all brand tabs.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile   = Join-Path $scriptDir 'scheduled_check.log'
$envFile   = Join-Path $scriptDir '.env'

# Read CHECK_STATUS_TOKEN from scripts/.env
$token = ''
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^CHECK_STATUS_TOKEN=(.+)$') { $token = $Matches[1].Trim() }
    }
}

$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

try {
    $res = Invoke-RestMethod -Uri 'http://127.0.0.1:5001/check-status' `
        -Method POST `
        -Headers @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' } `
        -Body '{"include_published": true}' `
        -TimeoutSec 1800
    Add-Content $logFile "$timestamp  OK  checked=$($res.checked) updated=$($res.updated) errors=$($res.errors)"
} catch {
    Add-Content $logFile "$timestamp  FAIL  $_"
}
