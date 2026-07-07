# One-time setup: registers scripts/watchdog.ps1 as a Windows Scheduled Task
# that runs every 5 minutes, indefinitely. Run this once as the user who
# should own the task (the same user status_server.py normally runs as).
$scriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$watchdogPath = Join-Path $scriptDir 'watchdog.ps1'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchdogPath`""
# [TimeSpan]::MaxValue fails to serialize to a valid Task Scheduler XML
# duration (Register-ScheduledTask throws HRESULT 0x80041318 -- "The task
# XML contains a value which is incorrectly formatted or out of range").
# 10 years is the standard practical stand-in for "indefinitely".
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -DontStopOnIdleEnd -AllowStartIfOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName 'ForumsDashboardWatchdog' `
    -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Pings status_server.py /health every 5 min; restarts it if unresponsive.' `
    -Force

Write-Host "[watchdog] Scheduled task 'ForumsDashboardWatchdog' registered -- runs every 5 minutes."
