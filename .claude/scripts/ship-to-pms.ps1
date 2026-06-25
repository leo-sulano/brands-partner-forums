# .claude/scripts/ship-to-pms.ps1
# Runs on every session Stop. Reads docs/task-history.md, finds tasks not yet
# in .claude/pms-synced-tasks.txt, and creates them in PMS Review/QA with
# title, description, due date, auto-detected label, and assignee.
# Silent on all errors so it never blocks Claude.

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$HistoryFile = Join-Path $ProjectRoot "docs\task-history.md"
$SyncedFile  = Join-Path $ProjectRoot ".claude\pms-synced-tasks.txt"
$EnvFile     = Join-Path $ProjectRoot ".env"

# --- PMS constants ---
$PMS_PROJECT  = 'cmpe8l7f1000004l7ytcbmxhb'
$PMS_COLUMN   = 'cmpe8l7g5000404l7n0yw9tua'   # Review/QA
$PMS_ASSIGNEE = 'cmnsnexfw000004l8726zp7rd'    # Leo Sulano
$LABEL_BUG    = 'cmqjmmtwc000104lbi4cqzvpp'    # Bug Fix
$LABEL_FEAT   = 'cmqjmmtl9000004lbbuly4jj7'    # Feature
$LABEL_INFRA  = 'cmqjmmu6q000204lbmyw8s6bl'    # Infrastructure
$LABEL_UI     = 'cmqjmmuh9000304lbblbmozik'    # UI

function Get-LabelId($title, $desc) {
    $text = "$title $desc".ToLower()
    $bugWords   = 'fix','bug','error','crash','broken','violation','issue','repair','resolve','incorrect'
    $uiWords    = ' ui ','design','modal','component','sidebar','topbar','chart','widget','button','layout','style','visual','page','render','icon','color','font','spacing','animation'
    $infraWords = 'deploy','build','config','setup','hook','script','migration','schema','database','edge function','vercel','supabase','auth','permission','env','docker','ci'
    foreach ($w in $bugWords)   { if ($text -match [regex]::Escape($w)) { return $LABEL_BUG } }
    foreach ($w in $uiWords)    { if ($text -match [regex]::Escape($w)) { return $LABEL_UI } }
    foreach ($w in $infraWords) { if ($text -match [regex]::Escape($w)) { return $LABEL_INFRA } }
    return $LABEL_FEAT
}

# --- Read PMS token ---
$token = ''
if (Test-Path $EnvFile) {
    $line = Get-Content $EnvFile | Where-Object { $_ -match '^PMS_API_TOKEN=' } | Select-Object -First 1
    if ($line) { $token = $line.Split('=', 2)[1].Trim() }
}
if (-not $token) { exit 0 }

# --- Load already-synced task numbers ---
$synced = @()
if (Test-Path $SyncedFile) {
    $synced = Get-Content $SyncedFile |
              Where-Object { $_ -match '^\d+$' } |
              ForEach-Object { [int]$_ }
}

if (-not (Test-Path $HistoryFile)) { exit 0 }
$content = Get-Content $HistoryFile -Raw

# Split on "---" dividers to isolate each task block
$sections = $content -split '\r?\n---\r?\n'

$headers = @{
    'Authorization' = "Bearer $token"
    'Content-Type'  = 'application/json'
}

$newSynced = [System.Collections.Generic.List[int]]::new()
foreach ($n in $synced) { $newSynced.Add($n) }

foreach ($section in $sections) {
    $m = [regex]::Match($section, '## Task (\d+): (.+)')
    if (-not $m.Success) { continue }

    $num   = [int]$m.Groups[1].Value
    $title = $m.Groups[2].Value.Trim()

    if ($num -in $synced) { continue }

    # Strip heading + date line; keep the description body
    $desc = $section -replace '(?s).*## Task \d+: [^\r\n]+\r?\n', ''
    $desc = ($desc -replace '\*\*Date:\*\*[^\n]+\n?', '').Trim()

    $labelId = Get-LabelId $title $desc
    $dueDate = (Get-Date).ToString('yyyy-MM-dd') + 'T23:59:59.000Z'

    $createBody = [ordered]@{
        title       = "Task $num`: $title"
        description = $desc
        columnId    = $PMS_COLUMN
        priority    = 'MEDIUM'
        dueDate     = $dueDate
    } | ConvertTo-Json -Compress

    try {
        $res = Invoke-RestMethod `
            -Uri     "https://pms-nu-eight.vercel.app/api/projects/$PMS_PROJECT/tasks" `
            -Method  POST `
            -Headers $headers `
            -Body    $createBody `
            -ErrorAction Stop

        # Assign + label in one PATCH
        $patchBody = @{
            assigneeIds = @($PMS_ASSIGNEE)
            labelIds    = @($labelId)
        } | ConvertTo-Json -Compress

        Invoke-RestMethod `
            -Uri     "https://pms-nu-eight.vercel.app/api/tasks/$($res.id)" `
            -Method  PATCH `
            -Headers $headers `
            -Body    $patchBody `
            -ErrorAction Stop | Out-Null

        $newSynced.Add($num)
    } catch {
        # Silent fail — never block the session
    }
}

# Persist updated synced list
($newSynced | Sort-Object -Unique) -join "`n" | Set-Content $SyncedFile -Encoding utf8
