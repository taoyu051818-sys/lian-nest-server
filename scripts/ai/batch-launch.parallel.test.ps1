#Requires -Version 7.0
<#
.SYNOPSIS
    Fixture tests for bounded parallel planning in batch-launch.ps1.

.DESCRIPTION
    Uses dry-run mode only. No Claude worker is launched, no self-cycle execute
    runs, and no real active-workers.json is modified.
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

function New-Task {
    param(
        [int]$Issue,
        [string]$Group,
        [string[]]$Locks = @(),
        [string]$Risk = "low"
    )

    return [ordered]@{
        taskType = "execution"
        risk = $Risk
        conflictGroup = $Group
        targetIssue = $Issue
        allowedFiles = @("scripts/ai/$Group/**")
        forbiddenFiles = @("src/**", "prisma/**")
        validationCommands = @("node --version")
        sharedLocks = $Locks
        rolePacket = [ordered]@{
            actorRole = "test-worker"
            description = "Fixture worker for bounded parallel launcher tests."
        }
    }
}

function Write-FixtureJson($Path, $Value) {
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $Value | ConvertTo-Json -Depth 12 | Set-Content -Path $Path -Encoding UTF8
}

function Invoke-Launcher($TempDir, $Tasks, $ProviderSlots, $ResourceSlots, [switch]$Sequential) {
    $taskFile = Join-Path $TempDir "tasks.json"
    $providerFile = Join-Path $TempDir "provider-pool.json"
    $resourceFile = Join-Path $TempDir "local-resource.json"
    $manifestFile = Join-Path $TempDir "active-workers.preview.json"
    $logDir = Join-Path $TempDir "worker-logs"

    Write-FixtureJson $taskFile $Tasks
    Write-FixtureJson $providerFile ([ordered]@{
        stateVersion = 1
        providers = @([ordered]@{ id = "fixture"; status = "available"; currentConcurrency = 0; maxConcurrency = $ProviderSlots })
        global = [ordered]@{ totalActiveWorkers = 0; globalMaxWorkers = $ProviderSlots; availableProviders = 1; exhaustedProviders = 0; disabledProviders = 0 }
    })
    Write-FixtureJson $resourceFile ([ordered]@{
        stateVersion = 1
        process = [ordered]@{ runningCount = 0; maxAllowed = $ResourceSlots }
        global = [ordered]@{ resourceState = "healthy"; capturedAt = (Get-Date).ToUniversalTime().ToString("o") }
    })

    $args = @(
        "-NoProfile", "-File", (Join-Path $PSScriptRoot "batch-launch.ps1"),
        "-TaskFile", $taskFile,
        "-ProviderPoolStatePath", $providerFile,
        "-LocalResourceStatePath", $resourceFile,
        "-MainHealthStatePath", (Join-Path $TempDir "missing-main-health.json"),
        "-WorkerManifestPath", $manifestFile,
        "-LogDir", $logDir
    )
    if (-not $Sequential) {
        $args += @("-Parallel", "-MaxParallelWorkers", "30")
    }

    $output = & pwsh @args 2>&1
    return [ordered]@{
        output = ($output | Out-String)
        manifestPath = $manifestFile
        logDir = $logDir
        exitCode = $LASTEXITCODE
    }
}

function Invoke-LauncherExecuteMock($TempDir, $Tasks, $ProviderSlots, $ResourceSlots) {
    $taskFile = Join-Path $TempDir "tasks.json"
    $providerFile = Join-Path $TempDir "provider-pool.json"
    $resourceFile = Join-Path $TempDir "local-resource.json"
    $manifestFile = Join-Path $TempDir "active-workers.execute.json"
    $logDir = Join-Path $TempDir "worker-logs"

    Write-FixtureJson $taskFile $Tasks
    Write-FixtureJson $providerFile ([ordered]@{
        stateVersion = 1
        providers = @([ordered]@{ id = "fixture"; status = "available"; currentConcurrency = 0; maxConcurrency = $ProviderSlots })
        global = [ordered]@{ totalActiveWorkers = 0; globalMaxWorkers = $ProviderSlots; availableProviders = 1; exhaustedProviders = 0; disabledProviders = 0 }
    })
    Write-FixtureJson $resourceFile ([ordered]@{
        stateVersion = 1
        process = [ordered]@{ runningCount = 0; maxAllowed = $ResourceSlots }
        global = [ordered]@{ resourceState = "healthy"; capturedAt = (Get-Date).ToUniversalTime().ToString("o") }
    })

    $output = & pwsh -NoProfile -File (Join-Path $PSScriptRoot "batch-launch.ps1") `
        -TaskFile $taskFile `
        -ProviderPoolStatePath $providerFile `
        -LocalResourceStatePath $resourceFile `
        -MainHealthStatePath (Join-Path $TempDir "missing-main-health.json") `
        -WorkerManifestPath $manifestFile `
        -LogDir $logDir `
        -Execute `
        -Parallel `
        -MaxParallelWorkers 2 `
        -SkipWorktreeSetup `
        -WorkerCommand 'Start-Sleep -Milliseconds 50' 2>&1

    return [ordered]@{
        output = ($output | Out-String)
        manifestPath = $manifestFile
        exitCode = $LASTEXITCODE
    }
}

Write-Host ""
Write-Host "batch-launch bounded parallel tests" -ForegroundColor Cyan

$root = Join-Path ([System.IO.Path]::GetTempPath()) "batch-parallel-test-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $root -Force | Out-Null

try {
    $case1 = Join-Path $root "sequential"
    $result = Invoke-Launcher $case1 @((New-Task 9001 "seq-a")) 5 5 -Sequential
    Assert ($result.exitCode -eq 0) "sequential dry-run exits 0"
    Assert ($result.output -match "Requested parallelism: 1") "sequential dry-run keeps requested parallelism 1"

    $case2 = Join-Path $root "parallel-cap"
    $tasks = @((New-Task 9002 "cap-a"), (New-Task 9003 "cap-b"), (New-Task 9004 "cap-c"))
    $result = Invoke-Launcher $case2 $tasks 5 2
    Assert ($result.exitCode -eq 0) "parallel dry-run exits 0"
    Assert ($result.output -match "Requested parallelism: 30") "parallel dry-run prints requested 30"
    Assert ($result.output -match "Provider slots: 5") "parallel dry-run prints provider slots"
    Assert ($result.output -match "Resource slots: 2") "parallel dry-run prints resource slots"
    Assert ($result.output -match "Effective parallelism: 2") "resource slots cap effective parallelism"

    $manifest = Get-Content $result.manifestPath -Raw | ConvertFrom-Json
    Assert ($manifest.mode -eq "dry-run") "explicit dry-run manifest is written"
    Assert ($manifest.workers.Count -eq 3) "manifest has all planned workers"
    Assert ((Test-Path $manifest.workers[0].taskFile)) "single-task temp fixture is generated"

    $case3 = Join-Path $root "duplicate-conflict"
    $tasks = @((New-Task 9005 "same"), (New-Task 9006 "same"), (New-Task 9007 "other"))
    $result = Invoke-Launcher $case3 $tasks 30 30
    Assert ($result.output -match "duplicate non-doc group 'same'") "duplicate conflict group is detected"
    Assert ($result.output -match "Wave 1/2|Wave 1/") "duplicate conflict group is serialized into waves"

    $case4 = Join-Path $root "shared-lock"
    $tasks = @((New-Task 9008 "lock-a" @("app-module")), (New-Task 9009 "lock-b" @("app-module")), (New-Task 9010 "lock-c"))
    $result = Invoke-Launcher $case4 $tasks 30 30
    Assert ($result.output -match "SERIALIZED: shared lock 'app-module'") "shared lock overlap is serialized"
    Assert ($result.output -match "Effective parallelism: 2") "shared lock limits conflict-safe parallelism"

    $case5 = Join-Path $root "high-risk-independent"
    $tasks = @((New-Task 9011 "safe-a"), (New-Task 9012 "risky" @() "high"))
    $result = Invoke-Launcher $case5 $tasks 30 30
    Assert ($result.output -match "Risk surface info:.*1 high-risk") "high-risk task reports per-surface risk info"
    Assert ($result.output -match "Effective parallelism: 2") "high-risk + low-risk independent surfaces have parallelism 2"

    $case5b = Join-Path $root "high-risk-serialize"
    $tasks = @((New-Task 9020 "risky-a" @() "high"), (New-Task 9021 "risky-b" @() "high"))
    $result = Invoke-Launcher $case5b $tasks 30 30
    Assert ($result.output -match "Effective parallelism: 1") "two high-risk tasks serialize to parallelism 1"

    $case5c = Join-Path $root "high-risk-same-group"
    $tasks = @((New-Task 9022 "shared"), (New-Task 9023 "shared" @() "high"))
    $result = Invoke-Launcher $case5c $tasks 30 30
    Assert ($result.output -match "Effective parallelism: 1") "high-risk + low-risk same conflictGroup serialize"

    $case6 = Join-Path $root "execute-mock"
    $tasks = @((New-Task 9013 "mock-a"), (New-Task 9014 "mock-b"))
    $result = Invoke-LauncherExecuteMock $case6 $tasks 2 2
    Assert ($result.exitCode -eq 0) "parallel execute mock exits 0"
    $manifest = Get-Content $result.manifestPath -Raw | ConvertFrom-Json
    Assert ($manifest.lastWaitSummary.completed -eq 2) "parallel execute mock completes both workers"
    Assert (($manifest.workers | Where-Object { $_.pid -ne $null }).Count -eq 2) "parallel execute mock records worker pids"
} finally {
    Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "batch-launch bounded parallel tests: $script:passed passed, $script:failed failed"
if ($script:failed -gt 0) { exit 1 }
