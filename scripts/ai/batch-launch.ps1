#Requires -Version 7.0
<#
.SYNOPSIS
    Self-hosted AI batch launcher for lian-nest-server.

.DESCRIPTION
    Reads a task JSON file (single object or array), validates each task
    against the contract, runs the launch gate check, and launches Claude
    Code workers in isolated git worktrees.

    Supports both single-task and array-task files. When an array is
    provided, each task is processed sequentially — the launcher enforces
    conflict-group rules and rejects duplicate non-doc groups before any
    worker dispatch.

    The launch gate (check-launch-gate.ps1) runs automatically before any
    worker dispatch. In execute mode, blocked tasks are refused. In dry-run
    mode, the gate decision is displayed for review.

.PARAMETER TaskFile
    Path to a task JSON file conforming to scripts/ai/task.schema.json.
    Must be a single task object or an array of task objects.

.PARAMETER DryRun
    Print the launch plan without executing. Default mode.

.PARAMETER MainHealthStatePath
    Path to the main health state marker JSON. Defaults to
    .github/ai-state/main-health.json

.EXAMPLE
    # Single task dry-run
    ./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/issue-86.json

.EXAMPLE
    # Array task dry-run
    ./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/batch-wave-1.json

.EXAMPLE
    # Execute a single task
    ./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/issue-86.json -Execute
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TaskFile,

    [switch]$DryRun = $true,
    [switch]$Execute,

    [string]$MainHealthStatePath = ".github/ai-state/main-health.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   WARN: $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "   FAIL: $msg" -ForegroundColor Red; exit 1 }

# ── Load task JSON ───────────────────────────────────────────────────────────

Write-Step "Loading task file: $TaskFile"

if (-not (Test-Path $TaskFile)) {
    Write-Fail "Task file not found: $TaskFile"
}

try {
    $raw = Get-Content $TaskFile -Raw
    $parsed = $raw | ConvertFrom-Json
} catch {
    Write-Fail "Invalid JSON: $_"
}

# Normalize to array — supports both single object and array input
if ($parsed -is [System.Array]) {
    $tasks = @($parsed)
} else {
    $tasks = @($parsed)
}

if ($tasks.Count -eq 0) {
    Write-Fail "Task file contains no tasks."
}

Write-Step "Loaded $($tasks.Count) task(s)"

# ── Validate required fields ─────────────────────────────────────────────────

Write-Step "Validating task contracts"

$requiredFields = @(
    "taskType", "risk", "conflictGroup", "targetIssue",
    "allowedFiles", "forbiddenFiles", "validationCommands", "rolePacket"
)

$validTaskTypes = @("execution", "research", "review")
$validRisks = @("low", "medium", "high")

foreach ($task in $tasks) {
    foreach ($field in $requiredFields) {
        if (-not ($task.PSObject.Properties.Name -contains $field)) {
            Write-Fail "Task #$($task.targetIssue): missing required field: $field"
        }
    }

    if ($task.taskType -notin $validTaskTypes) {
        Write-Fail "Task #$($task.targetIssue): invalid taskType: $($task.taskType). Must be one of: $($validTaskTypes -join ', ')"
    }

    if ($task.risk -notin $validRisks) {
        Write-Fail "Task #$($task.targetIssue): invalid risk: $($task.risk). Must be one of: $($validRisks -join ', ')"
    }

    if ($task.allowedFiles.Count -eq 0) {
        Write-Fail "Task #$($task.targetIssue): allowedFiles must not be empty"
    }

    if (-not $task.rolePacket.actorRole) {
        Write-Fail "Task #$($task.targetIssue): rolePacket.actorRole is required"
    }
}

Write-Ok "All $($tasks.Count) task contract(s) valid"

# ── Reject duplicate non-doc conflict groups ─────────────────────────────────

Write-Step "Checking for duplicate conflict groups"

$groupCounts = @{}
foreach ($task in $tasks) {
    $g = $task.conflictGroup
    if ($g) {
        if ($groupCounts.ContainsKey($g)) {
            $groupCounts[$g]++
        } else {
            $groupCounts[$g] = 1
        }
    }
}

# Classify whether a group is docs-only (all tasks in the group have only docs/ allowedFiles)
$groupIsDocsOnly = @{}
foreach ($task in $tasks) {
    $g = $task.conflictGroup
    if (-not $g) { continue }

    $allowed = @($task.allowedFiles)
    $allDocs = ($allowed.Count -gt 0) -and ($allowed | Where-Object { $_ -notmatch "^docs/" }).Count -eq 0

    if (-not $groupIsDocsOnly.ContainsKey($g)) {
        $groupIsDocsOnly[$g] = $allDocs
    } else {
        # If any task in the group is NOT docs-only, the group is not docs-only
        $groupIsDocsOnly[$g] = $groupIsDocsOnly[$g] -and $allDocs
    }
}

$hasDuplicateConflict = $false
foreach ($g in $groupCounts.Keys) {
    if ($groupCounts[$g] -gt 1 -and -not $groupIsDocsOnly[$g]) {
        Write-Host "   CONFLICT: duplicate non-doc group '$g' ($($groupCounts[$g])x)" -ForegroundColor Red
        $hasDuplicateConflict = $true
    }
}

if ($hasDuplicateConflict) {
    if ($Execute) {
        Write-Fail "Duplicate non-doc conflict groups detected. Resolve before using -Execute."
    } else {
        Write-Warn "Dry-run: duplicate non-doc conflict groups would block execution."
    }
} else {
    Write-Ok "No duplicate non-doc conflict groups"
}

# ── Launch gate check ────────────────────────────────────────────────────────

Write-Step "Running launch gate check"

$gateArgs = @{ TaskFile = $TaskFile; Json = $true }
if (Test-Path $MainHealthStatePath) {
    $gateArgs["HealthFile"] = $MainHealthStatePath
}

try {
    $gateJson = & $PSScriptRoot/check-launch-gate.ps1 @gateArgs 2>&1
    $gateExit = $LASTEXITCODE
} catch {
    Write-Fail "Launch gate check failed to run: $_"
}

$gateReport = $null
try {
    $gateReport = $gateJson | Out-String | ConvertFrom-Json
} catch {
    Write-Warn "Could not parse gate report JSON — skipping gate enforcement"
}

if ($gateReport) {
    $gateState = $gateReport.mainState
    $gateAllowed = $gateReport.allAllowed

    if ($gateAllowed) {
        Write-Ok "Gate PASS — main=$gateState, $($gateReport.taskCount) task(s) cleared"
    } else {
        Write-Warn "Gate BLOCK — main=$gateState"
        foreach ($t in $gateReport.tasks) {
            if (-not $t.allowed) {
                Write-Host "   BLOCKED: issue #$($t.targetIssue) type=$($t.workerType) — $($t.reason)" -ForegroundColor Red
            }
        }
        foreach ($dg in $gateReport.duplicateConflictGroups) {
            Write-Host "   CONFLICT: duplicate group '$($dg.conflictGroup)' ($($dg.count)x)" -ForegroundColor Red
        }
        foreach ($sl in $gateReport.sharedLockConflicts) {
            Write-Host "   CONFLICT: shared lock '$($sl.sharedLock)' contested by issues: $($sl.issues -join ', ')" -ForegroundColor Red
        }

        if ($Execute) {
            Write-Fail "Launch gate blocked this task. Resolve the issue or override with -MainState."
        } else {
            Write-Warn "Dry-run: gate would block execution. Fix before using -Execute."
        }
    }
} else {
    Write-Warn "Gate check produced no report — proceeding without gate enforcement"
}

# ── Build per-task plan ──────────────────────────────────────────────────────

Write-Step "Building launch plan for $($tasks.Count) task(s)"

$taskPlans = @()

foreach ($task in $tasks) {
    $branchName = "claude/issue-$($task.targetIssue)-$($task.conflictGroup -replace '[^a-zA-Z0-9-]', '-')"
    $worktreeDir = ".claude/worktrees/$branchName"

    $taskPlans += [ordered]@{
        Task        = $task
        BranchName  = $branchName
        WorktreeDir = $worktreeDir
    }
}

# ── Show plan ────────────────────────────────────────────────────────────────

foreach ($plan in $taskPlans) {
    $task = $plan.Task
    Write-Host ""
    Write-Host "   Task #$($task.targetIssue) — $($task.conflictGroup)" -ForegroundColor White
    Write-Host "     Branch:  $($plan.BranchName)" -ForegroundColor Gray
    Write-Host "     Worktree: $($plan.WorktreeDir)" -ForegroundColor Gray
    Write-Host "     Allowed:" -ForegroundColor Gray
    foreach ($pattern in $task.allowedFiles) {
        Write-Host "       + $pattern" -ForegroundColor Gray
    }
    Write-Host "     Forbidden:" -ForegroundColor Gray
    foreach ($pattern in $task.forbiddenFiles) {
        Write-Host "       - $pattern" -ForegroundColor Gray
    }
}

# ── Dry run exit ─────────────────────────────────────────────────────────────

if ($DryRun -and -not $Execute) {
    Write-Host ""
    Write-Step "DRY RUN — no changes made (gate decision shown above)"
    Write-Host ""
    Write-Host "To execute:" -ForegroundColor Yellow
    Write-Host "  ./scripts/ai/batch-launch.ps1 -TaskFile $TaskFile -Execute" -ForegroundColor Yellow
    Write-Host ""
    foreach ($plan in $taskPlans) {
        Write-Host "Worker command for issue #$($plan.Task.targetIssue):" -ForegroundColor Yellow
        Write-Host "  ./scripts/ai/run-claude-print.ps1 -TaskFile $TaskFile -Branch $($plan.BranchName) -Worktree $($plan.WorktreeDir)" -ForegroundColor Yellow
    }
    exit 0
}

# ── Execute mode ─────────────────────────────────────────────────────────────

Write-Step "EXECUTE mode — launching $($tasks.Count) worker(s)"

foreach ($plan in $taskPlans) {
    $task = $plan.Task
    $branchName = $plan.BranchName
    $worktreeDir = $plan.WorktreeDir

    Write-Host ""
    Write-Step "Processing task #$($task.targetIssue) (group=$($task.conflictGroup))"

    # Create worktree
    Write-Step "Creating git worktree: $worktreeDir"
    git worktree add -b $branchName $worktreeDir main 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Failed to create worktree for issue #$($task.targetIssue) (branch may already exist)"
    }
    Write-Ok "Worktree created"

    # Run worker
    Write-Step "Running Claude Code worker for issue #$($task.targetIssue)"
    & ./scripts/ai/run-claude-print.ps1 -TaskFile $TaskFile -Branch $branchName -Worktree $worktreeDir

    Write-Ok "Worker complete for issue #$($task.targetIssue)"
}

Write-Host ""
Write-Step "Batch launcher complete — $($tasks.Count) task(s) processed"
