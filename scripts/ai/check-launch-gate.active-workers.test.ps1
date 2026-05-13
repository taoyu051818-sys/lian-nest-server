#Requires -Version 7.0
<#
.SYNOPSIS
    Tests for stale active-worker filtering in check-launch-gate.ps1.

.DESCRIPTION
    Verifies that completed/failed workers in the active-workers manifest
    do not block future launches as running conflict groups.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:passed = 0
$script:failed = 0

function Assert {
    param([bool]$Condition, [string]$Name)
    if ($Condition) {
        $script:passed++
        Write-Host "  PASS  $Name" -ForegroundColor Green
    } else {
        $script:failed++
        Write-Host "  FAIL  $Name" -ForegroundColor Red
    }
}

function Write-FixtureJson($Path, $Value) {
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    ConvertTo-Json -InputObject $Value -Depth 12 | Set-Content -Path $Path -Encoding UTF8
}

function New-Task {
    param([int]$Issue, [string]$Group)
    return [ordered]@{
        taskType = "execution"
        risk = "low"
        conflictGroup = $Group
        targetIssue = $Issue
        allowedFiles = @("scripts/ai/test-$Group/**")
        forbiddenFiles = @("src/**")
        validationCommands = @("node --version")
        rolePacket = [ordered]@{ actorRole = "test-worker"; description = "Test" }
    }
}

function New-Worker {
    param([int]$Issue, [string]$Group, [string]$Status, $EndedAt = $null)
    return [ordered]@{
        issueNumber = $Issue
        issue = $Issue
        branch = "claude/issue-$Issue-$Group"
        worktree = ".claude/worktrees/claude/issue-$Issue-$Group"
        conflictGroup = $Group
        risk = "low"
        actorRole = "test-worker"
        status = $Status
        startedAt = "2026-05-13T00:00:00Z"
        endedAt = $EndedAt
    }
}

function Invoke-Gate($TempDir, $Tasks, $Workers) {
    $taskFile = Join-Path $TempDir "tasks.json"
    $workersFile = Join-Path $TempDir "active-workers.json"
    $healthFile = Join-Path $TempDir "health.json"
    $resourceFile = Join-Path $TempDir "local-resource.json"

    Write-FixtureJson $taskFile $Tasks
    Write-FixtureJson $workersFile @{
        markerVersion = 2
        capturedAt = (Get-Date).ToUniversalTime().ToString("o")
        batchId = "test-batch"
        mode = "execute"
        workers = $Workers
    }
    Write-FixtureJson $healthFile @{
        state = "green"
        commitSha = "abc12345"
        capturedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    Write-FixtureJson $resourceFile @{
        stateVersion = 1
        global = @{ resourceState = "healthy"; capturedAt = (Get-Date).ToUniversalTime().ToString("o") }
    }

    $output = & pwsh -NoProfile -File (Join-Path $PSScriptRoot "check-launch-gate.ps1") `
        -TaskFile $taskFile `
        -RunningTasksFile $workersFile `
        -HealthFile $healthFile `
        -ResourceFile $resourceFile `
        -Json 2>&1

    $json = $null
    try { $json = ($output | Out-String | ConvertFrom-Json) } catch {}
    return [ordered]@{
        output = ($output | Out-String)
        json = $json
        exitCode = $LASTEXITCODE
    }
}

Write-Host ""
Write-Host "check-launch-gate active-worker stale filter tests" -ForegroundColor Cyan

$root = Join-Path ([System.IO.Path]::GetTempPath()) "gate-active-workers-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $root -Force | Out-Null

try {
    # Case 1: completed worker does NOT block new task on same conflict group
    $case1 = Join-Path $root "completed-worker"
    $tasks = @((New-Task 8001 "test-group"))
    $workers = @((New-Worker 8000 "test-group" "completed" "2026-05-13T01:00:00Z"))
    $result = Invoke-Gate $case1 $tasks $workers
    Assert ($result.exitCode -eq 0) "completed worker: gate passes (exit 0)"
    Assert ($result.json.runningWorkerConflicts.Count -eq 0) "completed worker: no running-worker conflict"
    Assert ($result.json.allAllowed -eq $true) "completed worker: allAllowed is true"

    # Case 2: failed worker does NOT block new task on same conflict group
    $case2 = Join-Path $root "failed-worker"
    $tasks = @((New-Task 8002 "test-group"))
    $workers = @((New-Worker 8000 "test-group" "failed" "2026-05-13T01:00:00Z"))
    $result = Invoke-Gate $case2 $tasks $workers
    Assert ($result.exitCode -eq 0) "failed worker: gate passes (exit 0)"
    Assert ($result.json.runningWorkerConflicts.Count -eq 0) "failed worker: no running-worker conflict"

    # Case 3: running worker DOES block new task on same conflict group
    $case3 = Join-Path $root "running-worker"
    $tasks = @((New-Task 8003 "test-group"))
    $workers = @((New-Worker 8000 "test-group" "running"))
    $result = Invoke-Gate $case3 $tasks $workers
    Assert ($result.exitCode -eq 1) "running worker: gate blocks (exit 1)"
    Assert ($result.json.runningWorkerConflicts.Count -eq 1) "running worker: has running-worker conflict"
    Assert ($result.json.allAllowed -eq $false) "running worker: allAllowed is false"

    # Case 4: planned worker does NOT block
    $case4 = Join-Path $root "planned-worker"
    $tasks = @((New-Task 8004 "test-group"))
    $workers = @((New-Worker 8000 "test-group" "planned"))
    $result = Invoke-Gate $case4 $tasks $workers
    Assert ($result.exitCode -eq 0) "planned worker: gate passes (exit 0)"
    Assert ($result.json.runningWorkerConflicts.Count -eq 0) "planned worker: no running-worker conflict"

    # Case 5: mixed batch — completed worker + running worker
    $case5 = Join-Path $root "mixed-workers"
    $tasks = @((New-Task 8005 "group-a"), (New-Task 8006 "group-b"))
    $workers = @(
        (New-Worker 8000 "group-a" "completed" "2026-05-13T01:00:00Z"),
        (New-Worker 8001 "group-b" "running")
    )
    $result = Invoke-Gate $case5 $tasks $workers
    Assert ($result.exitCode -eq 1) "mixed: gate blocks (exit 1)"
    $groupAConflict = @($result.json.runningWorkerConflicts | Where-Object { $_.conflictGroup -eq "group-a" })
    $groupBConflict = @($result.json.runningWorkerConflicts | Where-Object { $_.conflictGroup -eq "group-b" })
    Assert ($groupAConflict.Count -eq 0) "mixed: completed worker in group-a does not block"
    Assert ($groupBConflict.Count -eq 1) "mixed: running worker in group-b blocks"

    # Case 6: empty workers manifest — no conflicts
    $case6 = Join-Path $root "empty-workers"
    $tasks = @((New-Task 8007 "test-group"))
    $workers = @()
    $result = Invoke-Gate $case6 $tasks $workers
    Assert ($result.exitCode -eq 0) "empty manifest: gate passes (exit 0)"
    Assert ($result.json.runningWorkerConflicts.Count -eq 0) "empty manifest: no conflicts"

} finally {
    Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "active-worker stale filter tests: $script:passed passed, $script:failed failed" -ForegroundColor $(if ($script:failed -gt 0) { "Red" } else { "Green" })
if ($script:failed -gt 0) { exit 1 }
exit 0
