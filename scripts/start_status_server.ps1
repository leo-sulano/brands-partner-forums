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
