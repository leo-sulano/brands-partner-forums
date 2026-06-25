# .claude/scripts/ship-to-pms.ps1
# Runs on every session Stop. Reads docs/task-history.md, finds tasks not yet
# in .claude/pms-synced-tasks.txt, and creates them in PMS Review/QA.
#
# Grouping: tasks with the same **Group:** marker are merged into ONE PMS task
# titled with the group name and a combined description listing each sub-task.
# Ungrouped tasks create individual PMS tasks as before.
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

function Invoke-PmsJson($method, $uri, $obj) {
    $json  = $obj | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $req   = [System.Net.HttpWebRequest]::Create($uri)
    $req.Method        = $method
    $req.ContentType   = 'application/json; charset=utf-8'
    $req.ContentLength = $bytes.Length
    $req.Headers.Add('Authorization', "Bearer $token")
    $stream = $req.GetRequestStream(); $stream.Write($bytes, 0, $bytes.Length); $stream.Close()
    $resp   = $req.GetResponse()
    $body   = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
    $resp.Close()
    return $body | ConvertFrom-Json
}

function Invoke-PmsCreate($title, $desc, $labelText, $taskDate) {
    $labelId = Get-LabelId $title $labelText
    if ($taskDate) {
        try { $dueDate = ([datetime]::ParseExact($taskDate.Trim(), 'MMMM d, yyyy', $null)).ToString('yyyy-MM-dd') + 'T23:59:59.000Z' }
        catch { $dueDate = (Get-Date).ToString('yyyy-MM-dd') + 'T23:59:59.000Z' }
    } else {
        $dueDate = (Get-Date).ToString('yyyy-MM-dd') + 'T23:59:59.000Z'
    }
    $res = Invoke-PmsJson 'POST' "https://pms-nu-eight.vercel.app/api/projects/$PMS_PROJECT/tasks" ([ordered]@{
        title       = $title
        description = $desc
        columnId    = $PMS_COLUMN
        priority    = 'MEDIUM'
        dueDate     = $dueDate
    })
    Invoke-PmsJson 'PATCH' "https://pms-nu-eight.vercel.app/api/tasks/$($res.id)" @{
        assigneeIds = @($PMS_ASSIGNEE)
        labelIds    = @($labelId)
    } | Out-Null
}

# --- Read PMS token ---
$token = ''
if (Test-Path $EnvFile) {
    $line = Get-Content $EnvFile | Where-Object { $_ -match '^PMS_API_TOKEN=' } | Select-Object -First 1
    if ($line) { $token = $line.Split('=', 2)[1].Trim() }
}
if (-not $token) { exit 0 }

$headers = @{
    'Authorization' = "Bearer $token"
    'Content-Type'  = 'application/json'
}

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

$newSynced = [System.Collections.Generic.List[int]]::new()
foreach ($n in $synced) { $newSynced.Add($n) }

# --- Parse all unsynced tasks ---
$parsed = [System.Collections.Generic.List[PSCustomObject]]::new()
foreach ($section in $sections) {
    $m = [regex]::Match($section, '## Task (\d+): (.+)')
    if (-not $m.Success) { continue }

    $num   = [int]$m.Groups[1].Value
    $title = $m.Groups[2].Value.Trim()
    if ($num -in $synced) { continue }

    # Extract optional group name
    $gm    = [regex]::Match($section, '\*\*Group:\*\*\s*([^\r\n]+)')
    $group = if ($gm.Success) { $gm.Groups[1].Value.Trim() } else { $null }

    # Extract date
    $dm   = [regex]::Match($section, '\*\*Date:\*\*\s*([^\r\n]+)')
    $date = if ($dm.Success) { $dm.Groups[1].Value.Trim() -replace '–.*','' } else { $null }

    # Strip heading, group, and date lines to isolate description
    $desc = $section -replace '(?s).*## Task \d+: [^\r\n]+\r?\n', ''
    $desc = ($desc -replace '\*\*Group:\*\*[^\n]+\n?', '').Trim()
    $desc = ($desc -replace '\*\*Date:\*\*[^\n]+\n?', '').Trim()

    $parsed.Add([PSCustomObject]@{
        Num   = $num
        Title = $title
        Group = $group
        Date  = $date
        Desc  = $desc
    })
}

# --- Ship grouped tasks (one PMS task per group) ---
$grouped = $parsed | Where-Object { $_.Group } | Group-Object Group
foreach ($g in $grouped) {
    $members = @($g.Group)
    # Only create the group task if ALL members are unsynced (avoids partial re-ship)
    $anyAlreadySynced = $members | Where-Object { $_.Num -in $synced }
    if ($anyAlreadySynced) { continue }

    $groupName    = $g.Name
    $combinedDesc = ($members | ForEach-Object {
        "### $($_.Title)`n$($_.Desc)"
    }) -join "`n`n"
    $labelText    = $groupName + ' ' + $combinedDesc
    $groupDate    = ($members | Select-Object -First 1).Date

    try {
        Invoke-PmsCreate "[$groupName]" $combinedDesc $labelText $groupDate
        foreach ($t in $members) { $newSynced.Add($t.Num) }
    } catch { }
}

# --- Ship ungrouped tasks individually ---
$ungrouped = $parsed | Where-Object { -not $_.Group }
foreach ($task in $ungrouped) {
    try {
        Invoke-PmsCreate "Task $($task.Num): $($task.Title)" $task.Desc "$($task.Title) $($task.Desc)" $task.Date
        $newSynced.Add($task.Num)
    } catch { }
}

# Persist updated synced list
($newSynced | Sort-Object -Unique) -join "`n" | Set-Content $SyncedFile -Encoding utf8
