#Requires -Version 7.0
<#
.SYNOPSIS
    Fixture tests for wait-parallel-workers.ps1.

.DESCRIPTION
    Creates local manifests and result/log fixtures. Does not launch workers.
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

function Write-Json($Path, $Value) {
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $Value | ConvertTo-Json -Depth 12 | Set-Content -Path $Path -Encoding UTF8
}

Write-Host ""
Write-Host "wait-parallel-workers tests" -ForegroundColor Cyan

$root = Join-Path ([System.IO.Path]::GetTempPath()) "wait-parallel-test-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $root -Force | Out-Null

try {
    $manifestPath = Join-Path $root "active-workers.json"
    $okResult = Join-Path $root "issue-9101.result.json"
    $failResult = Join-Path $root "issue-9102.result.json"
    $failErr = Join-Path $root "issue-9102.err.log"

    Write-Json $okResult ([ordered]@{
        issueNumber = 9101
        status = "completed"
        startedAt = "2026-01-01T00:00:00Z"
        endedAt = "2026-01-01T00:01:00Z"
        exitCode = 0
    })

    Write-Json $failResult ([ordered]@{
        issueNumber = 9102
        status = "failed"
        startedAt = "2026-01-01T00:00:00Z"
        endedAt = "2026-01-01T00:01:00Z"
        exitCode = 1
    })
    Set-Content -Path $failErr -Value "Failed to create worktree for issue #9102 (branch may already exist)" -Encoding UTF8

    Write-Json $manifestPath ([ordered]@{
        markerVersion = 2
        capturedAt = (Get-Date).ToUniversalTime().ToString("o")
        batchId = "wait-fixture"
        mode = "execute"
        requestedParallelism = 3
        effectiveParallelism = 3
        blockedParallelismReason = $null
        workers = @(
            [ordered]@{
                issueNumber = 9101
                issue = 9101
                conflictGroup = "ok"
                status = "running"
                pid = 999999
                resultPath = $okResult
                logPath = (Join-Path $root "issue-9101.out.log")
                stderrPath = (Join-Path $root "issue-9101.err.log")
                startedAt = "2026-01-01T00:00:00Z"
            },
            [ordered]@{
                issueNumber = 9102
                issue = 9102
                conflictGroup = "fail"
                status = "running"
                pid = 999998
                resultPath = $failResult
                logPath = (Join-Path $root "issue-9102.out.log")
                stderrPath = $failErr
                startedAt = "2026-01-01T00:00:00Z"
            },
            [ordered]@{
                issueNumber = 9103
                issue = 9103
                conflictGroup = "stale"
                status = "running"
                pid = $PID
                resultPath = (Join-Path $root "issue-9103.result.json")
                logPath = (Join-Path $root "issue-9103.out.log")
                stderrPath = (Join-Path $root "issue-9103.err.log")
                startedAt = "2026-01-01T00:00:00Z"
            }
        )
    })

    & pwsh -NoProfile -File (Join-Path $PSScriptRoot "wait-parallel-workers.ps1") -WorkerManifestPath $manifestPath -BatchId "wait-fixture" -Once -StaleMinutes 0 | Out-Null
    $exitCode = $LASTEXITCODE
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

    Assert ($exitCode -ne 0) "wait returns non-zero when failures/stale exist"
    Assert ($manifest.lastWaitSummary.completed -eq 1) "summary records completed worker"
    Assert ($manifest.lastWaitSummary.failed -eq 1) "summary records failed worker"
    Assert ($manifest.lastWaitSummary.stale -eq 1) "summary records stale worker"
    $failedWorker = $manifest.workers | Where-Object { $_.issueNumber -eq 9102 } | Select-Object -First 1
    Assert ($failedWorker.status -eq "failed") "failed worker status updated"
    Assert ($failedWorker.failureClass -eq "WORKTREE_STALE") "failure classifier invoked for failed worker log"
    $staleWorker = $manifest.workers | Where-Object { $_.issueNumber -eq 9103 } | Select-Object -First 1
    Assert ($staleWorker.status -eq "stale") "stale running process identified"
} finally {
    Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "wait-parallel-workers tests: $script:passed passed, $script:failed failed"
if ($script:failed -gt 0) { exit 1 }
