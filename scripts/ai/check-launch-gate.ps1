<#
.SYNOPSIS
    Pre-launch gate checker that validates planned tasks against main health
    state and conflict metadata before worker dispatch.

.DESCRIPTION
    Reads a task JSON file (single object or array) and an optional main health
    state marker. For each task the checker:

    1. Resolves main health state (green / yellow / red / black).
    2. Classifies each task as a worker type based on mainHealthPolicy,
       allowedFiles, and risk.
    3. Applies the main-health launch policy matrix to decide allow / block.
    4. Detects duplicate conflictGroup values in the batch.
    5. Detects sharedLocks overlap between tasks (when the field is present).
    6. Detects running-worker conflictGroup collisions (when a running tasks
       manifest is provided).

    This is a dry-run checker only. It does NOT modify any files or launch
    workers. The orchestrator calls this before batch-launch.ps1.

.PARAMETER TaskFile
    Path to a task JSON file. Must be a single task object or an array of tasks.

.PARAMETER HealthFile
    Path to the main health state marker JSON. Defaults to
    ./.github/ai-state/main-health.json

.PARAMETER MainState
    Override the health state instead of reading from HealthFile.
    One of: green, yellow, red, black. Ignored when HealthFile exists and
    contains a valid state.

.PARAMETER RunningTasksFile
    Path to a JSON file listing currently active worker conflict groups.
    Format: an array of objects with a "conflictGroup" string field, e.g.
    [{ "conflictGroup": "auth-core", "issue": 258 }]
    Tasks whose conflictGroup matches an active group will be blocked.
    When omitted, running-worker conflict detection is skipped.

.PARAMETER Json
    Output the report as JSON instead of console text.

.EXAMPLE
    # Check a batch of tasks against the current main health state
    ./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json

.EXAMPLE
    # Force a red state override for testing
    ./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json -MainState red

.EXAMPLE
    # Check against running workers manifest
    ./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json -RunningTasksFile ./active-workers.json

.EXAMPLE
    # JSON output for CI consumption
    ./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json -Json
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TaskFile,

    [string]$HealthFile = "./.github/ai-state/main-health.json",

    [ValidateSet("green", "yellow", "red", "black")]
    [string]$MainState = "",

    [string]$RunningTasksFile = "",

    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step { param([string]$Msg) if (-not $Json) { Write-Host "[step] $Msg" -ForegroundColor Cyan } }
function Write-Ok   { param([string]$Msg) if (-not $Json) { Write-Host "[ok]   $Msg" -ForegroundColor Green } }
function Write-Warn { param([string]$Msg) if (-not $Json) { Write-Host "[warn] $Msg" -ForegroundColor Yellow } }
function Write-Fail {
    param([string]$Msg)
    if ($Json) {
        [Console]::Error.WriteLine("[fail] $Msg")
    } else {
        Write-Host "[fail] $Msg" -ForegroundColor Red
    }
}

# Safe property access for PSCustomObject (strict-mode safe)
function Get-Prop {
    param($Obj, [string]$Name, $Default = $null)
    if ($Obj.PSObject.Properties.Name -contains $Name) { return $Obj.$Name }
    return $Default
}

# ---------------------------------------------------------------------------
# Load task file
# ---------------------------------------------------------------------------

if (-not (Test-Path $TaskFile)) {
    Write-Fail "Task file not found: $TaskFile"
    exit 2
}

$raw = Get-Content -Path $TaskFile -Raw -Encoding UTF8
$tasks = $raw | ConvertFrom-Json

# Normalize to array
if ($tasks -is [System.Array]) {
    $taskList = @($tasks)
} else {
    $taskList = @($tasks)
}

if ($taskList.Count -eq 0) {
    Write-Fail "Task file contains no tasks."
    exit 2
}

Write-Step "Loaded $($taskList.Count) task(s) from $TaskFile"

# ---------------------------------------------------------------------------
# Resolve main health state
# ---------------------------------------------------------------------------

$resolvedState = "green"

if ($MainState -ne "") {
    $resolvedState = $MainState
    Write-Step "Using override state: $resolvedState"
} elseif (Test-Path $HealthFile) {
    try {
        $healthRaw = Get-Content -Path $HealthFile -Raw -Encoding UTF8
        $health = $healthRaw | ConvertFrom-Json
        $healthState = Get-Prop $health "state"
        if ($healthState) {
            $resolvedState = $healthState
            Write-Step "Read health state from ${HealthFile}: $resolvedState"
        }
    } catch {
        Write-Warn "Could not parse $HealthFile — assuming red (fail-safe)"
        $resolvedState = "red"
    }
} else {
    Write-Warn "No health file at $HealthFile and no -MainState override. Assuming green."
}

# ---------------------------------------------------------------------------
# Load running tasks manifest (optional)
# ---------------------------------------------------------------------------

$runningGroups = @{}

if ($RunningTasksFile -ne "") {
    if (-not (Test-Path $RunningTasksFile)) {
        Write-Fail "Running tasks file not found: $RunningTasksFile"
        exit 2
    }

    try {
        $runningRaw = Get-Content -Path $RunningTasksFile -Raw -Encoding UTF8
        $runningTasks = $runningRaw | ConvertFrom-Json

        if ($runningTasks -is [System.Array]) {
            $runningList = @($runningTasks)
        } else {
            $runningList = @($runningTasks)
        }

        foreach ($rt in $runningList) {
            $rg = Get-Prop $rt "conflictGroup"
            if ($rg -and $rg -ne "") {
                $runningGroups[$rg] = [ordered]@{
                    issue  = (Get-Prop $rt "issue" "?")
                    branch = (Get-Prop $rt "branch" "")
                }
            }
        }

        Write-Step "Loaded $($runningGroups.Count) running conflict group(s) from $RunningTasksFile"
    } catch {
        Write-Fail "Could not parse running tasks file: $RunningTasksFile"
        exit 2
    }
}

# ---------------------------------------------------------------------------
# Policy: worker type classification and launch permission
# ---------------------------------------------------------------------------

# Classify worker type from task metadata.
# Priority: explicit mainHealthPolicy > heuristic from allowedFiles/risk.
function Get-WorkerType {
    param($Task)

    # Explicit mainHealthPolicy field (backend tasks)
    $policy = Get-Prop $Task "mainHealthPolicy"

    if ($policy -eq "gate-docs-only") {
        return "docs"
    }
    if ($policy -eq "gate-none") {
        return "research"
    }

    # Heuristic classification for tasks without explicit mainHealthPolicy
    $allowedRaw = Get-Prop $Task "allowedFiles"
    $allowed = @()
    if ($null -ne $allowedRaw) {
        $allowed = @($allowedRaw)
    }

    $nonDocs = @($allowed | Where-Object { $_ -notmatch "^docs/" })
    $allDocs = ($allowed.Count -gt 0) -and ($nonDocs.Count -eq 0)
    $nonScripts = @($allowed | Where-Object { $_ -notmatch "^scripts/" })
    $allScripts = ($allowed.Count -gt 0) -and ($nonScripts.Count -eq 0)
    $touchesSrc = @($allowed | Where-Object { $_ -match "^src/" })
    $risk = Get-Prop $Task "risk" "medium"

    if ((Get-Prop $Task "taskType") -eq "research") {
        return "research"
    }
    if ($allDocs) {
        return "docs"
    }
    if ($allScripts -and -not $touchesSrc) {
        return "health-repair"
    }
    if ($touchesSrc -and $risk -eq "high") {
        return "foundation-fix"
    }
    if ($touchesSrc) {
        return "runtime-feature"
    }
    # Fallback: scripts or mixed non-src
    return "health-repair"
}

# Permission matrix: state -> allowed worker types
$permissionMatrix = @{
    "green"  = @("runtime-feature", "foundation-fix", "docs", "health-repair", "test-only", "research")
    "yellow" = @("foundation-fix", "docs", "health-repair", "research")
    "red"    = @("foundation-fix", "health-repair")
    "black"  = @()
}

function Test-LaunchAllowed {
    param([string]$State, [string]$WorkerType)

    $allowed = $permissionMatrix[$State]
    if (-not $allowed) { return $false }
    return $allowed -contains $WorkerType
}

# ---------------------------------------------------------------------------
# Validate each task
# ---------------------------------------------------------------------------

$results = @()
$anyBlocked = $false

foreach ($task in $taskList) {
    $issueNum = Get-Prop $task "targetIssue" "?"
    $workerType = Get-WorkerType $task
    $allowed = Test-LaunchAllowed -State $resolvedState -WorkerType $workerType

    $conflictGroup = Get-Prop $task "conflictGroup" ""
    $risk = Get-Prop $task "risk" "unknown"

    $result = [ordered]@{
        targetIssue   = $issueNum
        conflictGroup = $conflictGroup
        risk          = $risk
        workerType    = $workerType
        mainState     = $resolvedState
        allowed       = $allowed
        reason        = $null
    }

    if (-not $allowed) {
        $anyBlocked = $true
        $result["reason"] = "Worker type '$workerType' is not permitted when main is $resolvedState."
    }

    $results += $result
}

# ---------------------------------------------------------------------------
# Detect duplicate conflictGroup
# ---------------------------------------------------------------------------

$duplicateGroups = @()
$groupCounts = @{}

foreach ($r in $results) {
    $g = $r.conflictGroup
    if ($g -ne "") {
        if ($groupCounts.ContainsKey($g)) {
            $groupCounts[$g]++
        } else {
            $groupCounts[$g] = 1
        }
    }
}

foreach ($g in $groupCounts.Keys) {
    if ($groupCounts[$g] -gt 1) {
        $duplicateGroups += [ordered]@{
            conflictGroup = $g
            count         = $groupCounts[$g]
        }
        $anyBlocked = $true
    }
}

# ---------------------------------------------------------------------------
# Detect sharedLocks overlap
# ---------------------------------------------------------------------------

$sharedLockConflicts = @()

$lockOwners = @{}

foreach ($r in $results) {
    $idx = $results.IndexOf($r)
    $task = $taskList[$idx]
    $locksRaw = Get-Prop $task "sharedLocks"
    $locks = @()
    if ($null -ne $locksRaw) {
        $locks = @($locksRaw)
    }

    foreach ($lock in $locks) {
        if (-not $lockOwners.ContainsKey($lock)) {
            $lockOwners[$lock] = @()
        }
        $lockOwners[$lock] += (Get-Prop $task "targetIssue" "?")
    }
}

foreach ($lock in $lockOwners.Keys) {
    $owners = $lockOwners[$lock]
    if ($owners.Count -gt 1) {
        $sharedLockConflicts += [ordered]@{
            sharedLock = $lock
            issues     = $owners
        }
        $anyBlocked = $true
    }
}

# ---------------------------------------------------------------------------
# Detect running-worker conflictGroup collisions
# ---------------------------------------------------------------------------

$runningWorkerConflicts = @()

if ($runningGroups.Count -gt 0) {
    foreach ($r in $results) {
        $g = $r.conflictGroup
        if ($g -ne "" -and $runningGroups.ContainsKey($g)) {
            $runningInfo = $runningGroups[$g]
            $runningWorkerConflicts += [ordered]@{
                conflictGroup = $g
                taskIssue     = $r.targetIssue
                runningIssue  = $runningInfo.issue
                runningBranch = $runningInfo.branch
            }
            $r["allowed"] = $false
            $r["reason"] = "Conflict group '$g' is already being worked on by active worker (issue #$($runningInfo.issue))."
            $anyBlocked = $true
        }
    }
}

# ---------------------------------------------------------------------------
# Build report
# ---------------------------------------------------------------------------

$now = [DateTime]::UtcNow

$report = [ordered]@{
    reportVersion = 1
    capturedAt    = $now.ToString("o")
    mainState     = $resolvedState
    taskCount     = $taskList.Count
    tasks         = $results
    duplicateConflictGroups = $duplicateGroups
    sharedLockConflicts     = $sharedLockConflicts
    runningWorkerConflicts  = $runningWorkerConflicts
    allAllowed    = (-not $anyBlocked)
}

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

if ($Json) {
    $report | ConvertTo-Json -Depth 6
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Launch Gate Report" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Main state: " -NoNewline
    $color = switch ($resolvedState) {
        "green"  { "Green" }
        "yellow" { "Yellow" }
        "red"    { "Red" }
        "black"  { "DarkRed" }
    }
    Write-Host $resolvedState -ForegroundColor $color
    Write-Host "Tasks evaluated: $($taskList.Count)"
    Write-Host ""

    foreach ($r in $results) {
        $status = if ($r.allowed) { "ALLOW" } else { "BLOCK" }
        $statusColor = if ($r.allowed) { "Green" } else { "Red" }

        Write-Host "  issue #$($r.targetIssue)" -NoNewline
        Write-Host "  [$status]" -ForegroundColor $statusColor -NoNewline
        Write-Host "  type=$($r.workerType)  group=$($r.conflictGroup)  risk=$($r.risk)"

        if ($r.reason) {
            Write-Host "    reason: $($r.reason)" -ForegroundColor Yellow
        }
    }

    Write-Host ""

    if ($duplicateGroups.Count -gt 0) {
        Write-Host "Duplicate conflictGroup violations:" -ForegroundColor Red
        foreach ($dg in $duplicateGroups) {
            Write-Host "  '$($dg.conflictGroup)' appears $($dg.count) times in batch" -ForegroundColor Red
        }
        Write-Host ""
    }

    if ($sharedLockConflicts.Count -gt 0) {
        Write-Host "SharedLock conflicts:" -ForegroundColor Red
        foreach ($sl in $sharedLockConflicts) {
            $issueList = ($sl.issues -join ", ")
            Write-Host "  lock '$($sl.sharedLock)' contested by issues: $issueList" -ForegroundColor Red
        }
        Write-Host ""
    }

    if ($runningWorkerConflicts.Count -gt 0) {
        Write-Host "Running-worker conflicts:" -ForegroundColor Red
        foreach ($rw in $runningWorkerConflicts) {
            Write-Host "  group '$($rw.conflictGroup)' — task issue #$($rw.taskIssue) blocked by active worker issue #$($rw.runningIssue)" -ForegroundColor Red
        }
        Write-Host ""
    }

    if ($anyBlocked) {
        Write-Fail "Gate CHECK FAILED — one or more tasks blocked or conflicts detected."
    } else {
        Write-Ok "Gate CHECK PASSED — all tasks cleared for launch."
    }
}

# Exit code
if ($anyBlocked) { exit 1 } else { exit 0 }
