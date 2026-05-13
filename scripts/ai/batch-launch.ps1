#Requires -Version 7.0
<#
.SYNOPSIS
    Self-hosted AI batch launcher for lian-nest-server.

.DESCRIPTION
    Reads a task JSON file (single object or array), validates each task,
    runs the launch gate check, and launches Claude Code workers in isolated
    git worktrees.

    Default execution remains sequential. Pass -Parallel to enable bounded
    asynchronous wave execution. Parallel execution is conservative: the
    launcher computes effective parallelism from requested concurrency,
    provider slots, local resource slots, conflict groups, shared locks, risk
    policy, review capacity, merge capacity, and failure budget.

    Dry-run never launches workers. When -WorkerManifestPath is explicitly
    supplied in dry-run mode, the launcher writes a planned manifest and
    per-worker single-task fixture files for regression tests and Command
    Steward previews.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TaskFile,

    [switch]$DryRun = $true,
    [switch]$Execute,

    [string]$MainHealthStatePath = ".github/ai-state/main-health.json",

    [switch]$Parallel,
    [ValidateRange(1, 30)]
    [int]$MaxParallelWorkers = 1,
    [string]$WorkerManifestPath = ".github/ai-state/active-workers.json",
    [string]$LogDir = ".ai/worker-logs",

    [string]$ProviderPoolStatePath = ".github/ai-state/provider-pool.json",
    [string]$LocalResourceStatePath = ".github/ai-state/local-resource.json",
    [string]$LocalResourcePolicyPath = ".github/ai-policy/local-resource-policy.json",

    [int]$ReviewCapacity = 30,
    [int]$MergeCapacity = 30,
    [int]$FailureBudget = 30,

    [string]$WorkerCommand = "",
    [switch]$SkipWorktreeSetup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   WARN: $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "   FAIL: $msg" -ForegroundColor Red; exit 1 }

function Get-Prop($Obj, [string]$Name, $Default = $null) {
    if ($null -eq $Obj) { return $Default }
    if ($Obj.PSObject.Properties.Name -contains $Name) {
        $value = $Obj.$Name
        if ($null -eq $value) { return $Default }
        return $value
    }
    return $Default
}

function Get-ArrayProp($Obj, [string]$Name) {
    $value = Get-Prop $Obj $Name @()
    if ($null -eq $value) { return @() }
    return @($value)
}

function Get-IsoNow {
    return (Get-Date).ToUniversalTime().ToString("o")
}

function Ensure-Directory([string]$Path) {
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Write-HookSettings {
    <#
    .SYNOPSIS
        Writes .claude/settings.json into a worktree with PreToolUse hooks
        for forbiddenFiles enforcement.
    #>
    param([string]$WorktreeDir)

    $hookScript = Join-Path (Get-Location).Path "scripts/ai/hook-forbidden-files-enforcer.js"
    $hookCommand = "node $hookScript"

    $settings = @{
        hooks = @{
            Write = @(
                @{ type = "command"; command = $hookCommand }
            )
            Edit = @(
                @{ type = "command"; command = $hookCommand }
            )
            NotebookEdit = @(
                @{ type = "command"; command = $hookCommand }
            )
        }
    }

    $claudeDir = Join-Path $WorktreeDir ".claude"
    Ensure-Directory $claudeDir
    $settingsPath = Join-Path $claudeDir "settings.json"
    $settings | ConvertTo-Json -Depth 10 | Set-Content -Path $settingsPath -Encoding UTF8
    Write-Ok "Hook settings written to $settingsPath"
}

function Ensure-Worktree {
    <#
    .SYNOPSIS
        Idempotent worktree setup. Reuses existing worktrees when safe.
    #>
    param(
        [string]$BranchName,
        [string]$WorktreeDir
    )

    # Check if git still tracks a worktree at this path
    $existingList = git worktree list --porcelain 2>$null
    $trackedPath = $null
    $trackedBranch = $null
    $currentEntry = @{}

    foreach ($line in @($existingList)) {
        if ($line -eq "") {
            if ($currentEntry.ContainsKey("path")) {
                $normExisting = ($currentEntry["path"] -replace "\\", "/").TrimEnd("/")
                $normTarget = ($WorktreeDir -replace "\\", "/").TrimEnd("/")
                if ($normExisting -eq $normTarget) {
                    $trackedPath = $currentEntry["path"]
                    $trackedBranch = $currentEntry["branch"]
                }
            }
            $currentEntry = @{}
            continue
        }
        if ($line -match "^worktree (.+)$") { $currentEntry["path"] = $Matches[1] }
        elseif ($line -match "^branch (.+)$") { $currentEntry["branch"] = $Matches[1] }
    }
    # Flush last entry
    if ($currentEntry.ContainsKey("path")) {
        $normExisting = ($currentEntry["path"] -replace "\\", "/").TrimEnd("/")
        $normTarget = ($WorktreeDir -replace "\\", "/").TrimEnd("/")
        if ($normExisting -eq $normTarget) {
            $trackedPath = $currentEntry["path"]
            $trackedBranch = $currentEntry["branch"]
        }
    }

    if ($trackedPath) {
        # Git tracks a worktree at this path — reuse if branch matches
        $expectedRef = "refs/heads/$BranchName"
        if ($trackedBranch -eq $expectedRef) {
            Write-Ok "Reusing existing worktree: $WorktreeDir (branch=$BranchName)"
            # Mark directory as safe for git operations (handles Windows path changes)
            git config --global --add safe.directory ($WorktreeDir -replace "\\", "/") 2>$null
            return
        }
        # Branch mismatch — remove stale worktree and recreate
        Write-Warn "Worktree branch mismatch (expected=$BranchName, actual=$trackedBranch). Recreating."
        git worktree remove $WorktreeDir --force 2>&1 | Out-Null
        git branch -D $BranchName 2>&1 | Out-Null
    }

    # No tracked worktree — try creating one
    # First, try creating with a new branch
    $output = git worktree add -b $BranchName $WorktreeDir main 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Worktree created (new branch): $WorktreeDir"
        return
    }

    # Branch already exists — attach worktree to existing branch
    Write-Step "Branch '$BranchName' already exists — attaching worktree"
    git branch -D $BranchName 2>&1 | Out-Null
    $output = git worktree add -b $BranchName $WorktreeDir main 2>&1
    if ($LASTEXITCODE -ne 0) {
        # Last resort: prune stale references and retry
        git worktree prune 2>$null
        $output = git worktree add -b $BranchName $WorktreeDir main 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "Failed to create worktree for branch '$BranchName': $output"
        }
    }
    Write-Ok "Worktree created: $WorktreeDir"
}

function Read-JsonFile($Path) {
    if (-not (Test-Path $Path)) { return $null }
    try {
        return (Get-Content -Path $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
        Write-Warn "Could not parse JSON file: $Path"
        return $null
    }
}

function Test-HumanRequired($Task) {
    if ((Get-Prop $Task "humanRequired" $false) -eq $true) { return $true }
    if ((Get-Prop $Task "requiresHuman" $false) -eq $true) { return $true }
    $labels = Get-ArrayProp $Task "labels"
    foreach ($label in $labels) {
        if ([string]$label -match "human-required|AI_HUMAN_REQUIRED") { return $true }
    }
    return $false
}

function Get-ProviderSlots([string]$Path, [int]$Requested) {
    $pool = Read-JsonFile $Path
    if (-not $pool) {
        return [ordered]@{ slots = 1; loaded = $false; reason = "provider-pool missing; conservative slot=1" }
    }

    $providerSlots = 0
    foreach ($provider in @($pool.providers)) {
        $status = [string](Get-Prop $provider "status" "")
        if ($status -ne "available") { continue }
        $max = [int](Get-Prop $provider "maxConcurrency" 0)
        $current = [int](Get-Prop $provider "currentConcurrency" 0)
        $headroom = [Math]::Max(0, $max - $current)
        $providerSlots += $headroom
    }

    $global = Get-Prop $pool "global" $null
    if ($global) {
        $globalMax = [int](Get-Prop $global "globalMaxWorkers" $Requested)
        $active = [int](Get-Prop $global "totalActiveWorkers" 0)
        $globalHeadroom = [Math]::Max(0, $globalMax - $active)
        $providerSlots = [Math]::Min($providerSlots, $globalHeadroom)
    }

    return [ordered]@{ slots = [Math]::Max(0, $providerSlots); loaded = $true; reason = "provider pool capacity" }
}

function Get-ResourceSlots([string]$Path, [int]$Requested) {
    $resource = Read-JsonFile $Path
    if (-not $resource) {
        return [ordered]@{ slots = 1; loaded = $false; reason = "local-resource missing; conservative slot=1" }
    }

    $global = Get-Prop $resource "global" $null
    $state = if ($global) { [string](Get-Prop $global "resourceState" "unknown") } else { "unknown" }
    if ($state -match "critical|red|black") {
        return [ordered]@{ slots = 0; loaded = $true; reason = "local resource state is $state" }
    }

    $process = Get-Prop $resource "process" $null
    if ($process) {
        $running = [int](Get-Prop $process "runningCount" 0)
        $maxAllowed = [int](Get-Prop $process "maxAllowed" $Requested)
        return [ordered]@{ slots = [Math]::Max(0, $maxAllowed - $running); loaded = $true; reason = "process headroom" }
    }

    $concurrency = Get-Prop $resource "concurrency" $null
    if ($concurrency) {
        $activeWorkers = [int](Get-Prop $concurrency "activeWorkers" 0)
        $maxWorkers = [int](Get-Prop $concurrency "maxWorkers" $Requested)
        return [ordered]@{ slots = [Math]::Max(0, $maxWorkers - $activeWorkers); loaded = $true; reason = "concurrency headroom" }
    }

    return [ordered]@{ slots = 1; loaded = $true; reason = "resource file lacks process/concurrency headroom; conservative slot=1" }
}

function Get-TaskLocks($Task) {
    return Get-ArrayProp $Task "sharedLocks"
}

function Build-Waves($Plans, [int]$MaxPerWave) {
    $waves = @()
    $cap = [Math]::Max(1, $MaxPerWave)

    foreach ($plan in $Plans) {
        $task = $plan.Task
        $group = [string]$task.conflictGroup
        $locks = @(Get-TaskLocks $task)
        $isHuman = Test-HumanRequired $task
        $isHighRisk = ([string]$task.risk -eq "high") -or $isHuman
        $placed = $false

        for ($i = 0; $i -lt $waves.Count; $i++) {
            $wave = $waves[$i]
            if ($wave.Count -ge $cap) { continue }

            # Per-surface risk serialization: high-risk tasks serialize only
            # with other high-risk/humanRequired tasks, not globally.
            if ($isHighRisk) {
                $waveHasHighRisk = $false
                foreach ($existing in $wave) {
                    if (([string]$existing.Task.risk -eq "high") -or (Test-HumanRequired $existing.Task)) {
                        $waveHasHighRisk = $true
                        break
                    }
                }
                if ($waveHasHighRisk) { continue }
            }

            # Check existing wave for conflicts
            $waveGroups = @{}
            $waveLocks = @{}
            foreach ($existing in $wave) {
                $waveGroups[[string]$existing.Task.conflictGroup] = $true
                foreach ($existingLock in @(Get-TaskLocks $existing.Task)) {
                    $waveLocks[[string]$existingLock] = $true
                }
            }

            if ($waveGroups.ContainsKey($group)) { continue }

            $lockConflict = $false
            foreach ($lock in $locks) {
                if ($waveLocks.ContainsKey([string]$lock)) {
                    $lockConflict = $true
                    break
                }
            }
            if ($lockConflict) { continue }

            $wave += $plan
            $waves[$i] = $wave
            $placed = $true
            break
        }

        if (-not $placed) {
            $waves += ,@($plan)
        }
    }

    return @($waves)
}

function Get-ConflictSafeSlots($Plans) {
    $waves = @(Build-Waves $Plans 30)
    $max = 1
    foreach ($wave in $waves) {
        if ($wave.Count -gt $max) { $max = $wave.Count }
    }
    return $max
}

function New-Manifest($BatchId, $Mode, $Requested, $Effective, $Reason = $null) {
    return [ordered]@{
        markerVersion = 2
        capturedAt = Get-IsoNow
        batchId = $BatchId
        mode = $Mode
        requestedParallelism = $Requested
        effectiveParallelism = $Effective
        blockedParallelismReason = $Reason
        workers = @()
    }
}

function Write-Manifest($Manifest, [string]$Path) {
    $parent = Split-Path -Parent $Path
    if ($parent) { Ensure-Directory $parent }
    $Manifest.capturedAt = Get-IsoNow
    $Manifest | ConvertTo-Json -Depth 12 | Set-Content -Path $Path -Encoding UTF8
}

function Write-SingleTaskFile($Task, [string]$Path) {
    $parent = Split-Path -Parent $Path
    if ($parent) { Ensure-Directory $parent }
    $Task | ConvertTo-Json -Depth 12 | Set-Content -Path $Path -Encoding UTF8
}

function New-WorkerRunnerScript($Plan, [string]$RunnerPath, [string]$ResultPath, [string]$TaskFilePath) {
    $repoRoot = (Get-Location).Path
    $workerScript = Join-Path $repoRoot "scripts/ai/run-claude-print.ps1"
    $task = $Plan.Task
    $issue = [int]$task.targetIssue
    $branch = [string]$Plan.BranchName
    $worktree = [string]$Plan.WorktreeDir
    $actorRole = [string](Get-Prop (Get-Prop $task "rolePacket" $null) "actorRole" "")
    $command = $WorkerCommand

    $content = @"
#Requires -Version 7.0
`$ErrorActionPreference = "Continue"
`$env:LIAN_WORKER_TASK_FILE = @'
$TaskFilePath
'@
`$env:LIAN_WORKER_ISSUE = "$issue"
`$env:LIAN_WORKER_BRANCH = @'
$branch
'@
`$env:LIAN_WORKER_WORKTREE = @'
$worktree
'@
`$startedAt = (Get-Date).ToUniversalTime().ToString("o")
`$exitCode = 0
try {
  `$customCommand = @'
$command
'@
  if (`$customCommand.Trim().Length -gt 0) {
    Invoke-Expression `$customCommand
  } else {
    & @'
$workerScript
'@ -TaskFile @'
$TaskFilePath
'@ -Branch @'
$branch
'@ -Worktree @'
$worktree
'@
  }
  if (`$null -ne `$LASTEXITCODE) { `$exitCode = [int]`$LASTEXITCODE }
} catch {
  Write-Error `$_.Exception.Message
  `$exitCode = 1
}
`$endedAt = (Get-Date).ToUniversalTime().ToString("o")
`$result = [ordered]@{
  issueNumber = $issue
  branch = @'
$branch
'@
  worktree = @'
$worktree
'@
  taskFile = @'
$TaskFilePath
'@
  status = if (`$exitCode -eq 0) { "completed" } else { "failed" }
  startedAt = `$startedAt
  endedAt = `$endedAt
  exitCode = `$exitCode
  conflictGroup = @'
$($task.conflictGroup)
'@
  risk = @'
$($task.risk)
'@
  actorRole = @'
$actorRole
'@
}
`$result | ConvertTo-Json -Depth 8 | Set-Content -Path @'
$ResultPath
'@ -Encoding UTF8
exit `$exitCode
"@

    $parent = Split-Path -Parent $RunnerPath
    if ($parent) { Ensure-Directory $parent }
    Set-Content -Path $RunnerPath -Value $content -Encoding UTF8
}

Write-Step "Loading task file: $TaskFile"
if (-not (Test-Path $TaskFile)) { Write-Fail "Task file not found: $TaskFile" }

try {
    $raw = Get-Content $TaskFile -Raw -Encoding UTF8
    $parsed = $raw | ConvertFrom-Json
} catch {
    Write-Fail "Invalid JSON: $_"
}

if ($parsed -is [System.Array]) { $tasks = @($parsed) } else { $tasks = @($parsed) }
if ($tasks.Count -eq 0) { Write-Fail "Task file contains no tasks." }
Write-Step "Loaded $($tasks.Count) task(s)"

Write-Step "Validating task contracts"
$requiredFields = @("taskType", "risk", "conflictGroup", "targetIssue", "allowedFiles", "forbiddenFiles", "validationCommands", "rolePacket")
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
    if (@($task.allowedFiles).Count -eq 0) { Write-Fail "Task #$($task.targetIssue): allowedFiles must not be empty" }
    if (-not (Get-Prop $task.rolePacket "actorRole" $null)) {
        Write-Fail "Task #$($task.targetIssue): rolePacket.actorRole is required"
    }
}
Write-Ok "All $($tasks.Count) task contract(s) valid"

Write-Step "Checking for duplicate conflict groups"
$groupCounts = @{}
$groupIsDocsOnly = @{}
foreach ($task in $tasks) {
    $g = [string]$task.conflictGroup
    if (-not $g) { continue }
    if ($groupCounts.ContainsKey($g)) { $groupCounts[$g]++ } else { $groupCounts[$g] = 1 }
    $allowed = @($task.allowedFiles)
    $nonDocs = @($allowed | Where-Object { $_ -notmatch "^docs/" })
    $allDocs = ($allowed.Count -gt 0) -and ($nonDocs.Count -eq 0)
    if (-not $groupIsDocsOnly.ContainsKey($g)) { $groupIsDocsOnly[$g] = $allDocs } else { $groupIsDocsOnly[$g] = $groupIsDocsOnly[$g] -and $allDocs }
}

$hasDuplicateConflict = $false
foreach ($g in $groupCounts.Keys) {
    if ($groupCounts[$g] -gt 1 -and -not $groupIsDocsOnly[$g]) {
        Write-Host "   CONFLICT: duplicate non-doc group '$g' ($($groupCounts[$g])x)" -ForegroundColor Red
        $hasDuplicateConflict = $true
    }
}

if ($hasDuplicateConflict) {
    if ($Execute -and -not $Parallel) {
        Write-Fail "Duplicate non-doc conflict groups detected. Resolve before using sequential -Execute."
    } elseif ($Parallel) {
        Write-Warn "Parallel mode will serialize duplicate non-doc conflict groups into separate waves."
    } else {
        Write-Warn "Dry-run: duplicate non-doc conflict groups would block sequential execution."
    }
} else {
    Write-Ok "No duplicate non-doc conflict groups"
}

Write-Step "Running launch gate check"
$gateArgs = @{ TaskFile = $TaskFile; Json = $true; ProviderPoolFile = $ProviderPoolStatePath; ResourceFile = $LocalResourceStatePath; ResourcePolicyFile = $LocalResourcePolicyPath }
if (Test-Path $MainHealthStatePath) { $gateArgs["HealthFile"] = $MainHealthStatePath }
if (Test-Path $WorkerManifestPath) { $gateArgs["RunningTasksFile"] = $WorkerManifestPath }

try {
    $gateJson = & $PSScriptRoot/check-launch-gate.ps1 @gateArgs 2>&1
} catch {
    Write-Fail "Launch gate check failed to run: $_"
}

$gateReport = $null
try { $gateReport = $gateJson | Out-String | ConvertFrom-Json } catch { Write-Warn "Could not parse gate report JSON — skipping gate enforcement" }

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
        foreach ($dg in @($gateReport.duplicateConflictGroups)) {
            Write-Host "   CONFLICT: duplicate group '$($dg.conflictGroup)' ($($dg.count)x)" -ForegroundColor Red
        }
        foreach ($sl in @($gateReport.sharedLockConflicts)) {
            Write-Host "   CONFLICT: shared lock '$($sl.sharedLock)' contested by issues: $($sl.issues -join ', ')" -ForegroundColor Red
        }
        if ($Execute) {
            Write-Fail "Launch gate blocked this task. Resolve the issue before execute."
        } else {
            Write-Warn "Dry-run: gate would block execution. Fix before using -Execute."
        }
    }
} else {
    Write-Warn "Gate check produced no report — proceeding without gate enforcement"
}

Write-Step "Building launch plan for $($tasks.Count) task(s)"
$taskPlans = @()
foreach ($task in $tasks) {
    $branchName = "claude/issue-$($task.targetIssue)-$($task.conflictGroup -replace '[^a-zA-Z0-9-]', '-')"
    $worktreeDir = ".claude/worktrees/$branchName"
    $taskPlans += [ordered]@{ Task = $task; BranchName = $branchName; WorktreeDir = $worktreeDir }
}

$requestedParallelism = if ($Parallel) { [Math]::Min(30, [Math]::Max(1, $MaxParallelWorkers)) } else { 1 }
$provider = Get-ProviderSlots $ProviderPoolStatePath $requestedParallelism
$resource = Get-ResourceSlots $LocalResourceStatePath $requestedParallelism
$conflictSafeSlots = Get-ConflictSafeSlots $taskPlans
# Risk safety is now per-surface via Build-Waves, not a global scalar.
# High-risk tasks serialize only with other high-risk/humanRequired tasks,
# not with unrelated low/medium tasks on independent surfaces.
$reviewSafeSlots = [Math]::Max(1, $ReviewCapacity)
$mergeSafeSlots = [Math]::Max(1, $MergeCapacity)
$failureSafeSlots = [Math]::Max(1, $FailureBudget)
$parallelInputs = @(
    $requestedParallelism,
    [int]$provider.slots,
    [int]$resource.slots,
    $conflictSafeSlots,
    $reviewSafeSlots,
    $mergeSafeSlots,
    $failureSafeSlots
)
$effectiveParallelism = [int](($parallelInputs | Measure-Object -Minimum).Minimum)

$blockedReason = $null
if ($effectiveParallelism -lt $requestedParallelism) {
    $reasons = @()
    if ([int]$provider.slots -lt $requestedParallelism) { $reasons += "provider slots=$($provider.slots)" }
    if ([int]$resource.slots -lt $requestedParallelism) { $reasons += "resource slots=$($resource.slots)" }
    if ($conflictSafeSlots -lt $requestedParallelism) { $reasons += "conflict-safe slots=$conflictSafeSlots" }
    if ($reviewSafeSlots -lt $requestedParallelism) { $reasons += "review capacity=$reviewSafeSlots" }
    if ($mergeSafeSlots -lt $requestedParallelism) { $reasons += "merge capacity=$mergeSafeSlots" }
    if ($failureSafeSlots -lt $requestedParallelism) { $reasons += "failure budget=$failureSafeSlots" }
    $blockedReason = $reasons -join "; "
}

# Per-surface risk info for output
$highRiskCount = @($tasks | Where-Object { ([string]$_.risk -eq "high") -or (Test-HumanRequired $_) }).Count
$riskInfo = if ($highRiskCount -gt 0) { "$highRiskCount high-risk task(s) — serialized per-surface via Build-Waves" } else { "none" }

Write-Step "Parallel capacity plan"
Write-Host "   Requested parallelism: $requestedParallelism"
Write-Host "   Provider slots: $($provider.slots) ($($provider.reason))"
Write-Host "   Resource slots: $($resource.slots) ($($resource.reason))"
Write-Host "   Conflict-safe slots: $conflictSafeSlots"
Write-Host "   Risk surface info: $riskInfo"
Write-Host "   Review capacity: $reviewSafeSlots"
Write-Host "   Merge capacity: $mergeSafeSlots"
Write-Host "   Failure budget: $failureSafeSlots"
Write-Host "   Effective parallelism: $effectiveParallelism"
if ($blockedReason) { Write-Warn "Parallelism reduced: $blockedReason" }
if ($Parallel -and $effectiveParallelism -lt 1 -and $Execute) { Write-Fail "Effective parallelism is 0; dispatch blocked." }

$batchId = "worker-batch-$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))"
$batchLogDir = Join-Path $LogDir $batchId
$manifestWasExplicit = $PSBoundParameters.ContainsKey("WorkerManifestPath")
$waves = @(Build-Waves $taskPlans ([Math]::Max(1, $effectiveParallelism)))

Write-Step "Launch plan"
for ($i = 0; $i -lt $waves.Count; $i++) {
    $wave = @($waves[$i])
    Write-Host ""
    Write-Host "   Wave $($i + 1)/$($waves.Count) — $($wave.Count) task(s)" -ForegroundColor White
    foreach ($plan in $wave) {
        $task = $plan.Task
        Write-Host "     Task #$($task.targetIssue) — $($task.conflictGroup) risk=$($task.risk)" -ForegroundColor White
        Write-Host "       Branch:  $($plan.BranchName)" -ForegroundColor Gray
        Write-Host "       Worktree: $($plan.WorktreeDir)" -ForegroundColor Gray
        $locks = @(Get-TaskLocks $task)
        if ($locks.Count -gt 0) {
            Write-Host "       SharedLocks: $($locks -join ', ')" -ForegroundColor Magenta
        }
    }
}

Write-Step "Shared-lock preflight"
$allLocks = @{}
foreach ($plan in $taskPlans) {
    foreach ($lock in @(Get-TaskLocks $plan.Task)) {
        if (-not $allLocks.ContainsKey($lock)) { $allLocks[$lock] = @() }
        $allLocks[$lock] += $plan.Task.targetIssue
    }
}
if ($allLocks.Count -eq 0) {
    Write-Ok "No shared locks declared in this batch"
} else {
    foreach ($lock in $allLocks.Keys) {
        $owners = $allLocks[$lock]
        if ($owners.Count -gt 1) {
            Write-Host "   SERIALIZED: shared lock '$lock' claimed by issues: $($owners -join ', ')" -ForegroundColor Yellow
        } else {
            Write-Host "   Lock '$lock' -> issue #$($owners[0]) (sole owner)" -ForegroundColor Gray
        }
    }
}

if ($DryRun -and -not $Execute) {
    Write-Host ""
    Write-Step "DRY RUN — no workers launched"
    Write-Host ""
    Write-Host "To execute sequentially:" -ForegroundColor Yellow
    Write-Host "  ./scripts/ai/batch-launch.ps1 -TaskFile $TaskFile -Execute" -ForegroundColor Yellow
    Write-Host "To execute bounded parallel:" -ForegroundColor Yellow
    Write-Host "  ./scripts/ai/batch-launch.ps1 -TaskFile $TaskFile -Execute -Parallel -MaxParallelWorkers $requestedParallelism" -ForegroundColor Yellow

    if ($manifestWasExplicit) {
        Ensure-Directory $batchLogDir
        $manifest = New-Manifest $batchId "dry-run" $requestedParallelism $effectiveParallelism $blockedReason
        foreach ($plan in $taskPlans) {
            $task = $plan.Task
            $issue = [int]$task.targetIssue
            $taskOut = Join-Path $batchLogDir "issue-$issue.task.json"
            $outLog = Join-Path $batchLogDir "issue-$issue.out.log"
            $errLog = Join-Path $batchLogDir "issue-$issue.err.log"
            $resultPath = Join-Path $batchLogDir "issue-$issue.result.json"
            Write-SingleTaskFile $task $taskOut
            $manifest.workers += [ordered]@{
                issueNumber = $issue
                issue = $issue
                branch = $plan.BranchName
                worktree = $plan.WorktreeDir
                taskFile = $taskOut
                pid = $null
                status = "planned"
                startedAt = $null
                endedAt = $null
                exitCode = $null
                logPath = $outLog
                stderrPath = $errLog
                resultPath = $resultPath
                conflictGroup = [string]$task.conflictGroup
                risk = [string]$task.risk
                actorRole = [string](Get-Prop (Get-Prop $task "rolePacket" $null) "actorRole" "")
                providerSlot = $null
            }
        }
        Write-Manifest $manifest $WorkerManifestPath
        Write-Ok "Dry-run manifest written: $WorkerManifestPath"
    }
    exit 0
}

Write-Step "EXECUTE mode — launching $($tasks.Count) worker(s)"

if (-not $Parallel) {
    foreach ($plan in $taskPlans) {
        $task = $plan.Task
        Write-Host ""
        Write-Step "Processing task #$($task.targetIssue) (group=$($task.conflictGroup))"
        if (-not $SkipWorktreeSetup) {
            Ensure-Worktree -BranchName $plan.BranchName -WorktreeDir $plan.WorktreeDir
        }
        $singleTaskFile = Join-Path ([System.IO.Path]::GetTempPath()) "single-task-$($task.targetIssue).json"
        Write-SingleTaskFile $task $singleTaskFile
        Write-HookSettings -WorktreeDir $plan.WorktreeDir
        Write-Step "Running Claude Code worker for issue #$($task.targetIssue)"
        if ($WorkerCommand.Trim().Length -gt 0) {
            $env:LIAN_WORKER_TASK_FILE = $singleTaskFile
            $env:LIAN_WORKER_ISSUE = [string]$task.targetIssue
            Invoke-Expression $WorkerCommand
        } else {
            $env:LIAN_WORKER_TASK_FILE = $singleTaskFile
            & ./scripts/ai/run-claude-print.ps1 -TaskFile $singleTaskFile -Branch $plan.BranchName -Worktree $plan.WorktreeDir
        }
        Remove-Item $singleTaskFile -ErrorAction SilentlyContinue
        Write-Ok "Worker complete for issue #$($task.targetIssue)"
    }
    Write-Host ""
    Write-Step "Batch launcher complete — $($tasks.Count) task(s) processed sequentially"
    exit 0
}

Ensure-Directory $batchLogDir
$manifest = New-Manifest $batchId "execute" $requestedParallelism $effectiveParallelism $blockedReason
Write-Manifest $manifest $WorkerManifestPath

for ($i = 0; $i -lt $waves.Count; $i++) {
    $wave = @($waves[$i])
    Write-Step "Launching parallel wave $($i + 1)/$($waves.Count) with $($wave.Count) worker(s)"

    foreach ($plan in $wave) {
        $task = $plan.Task
        $issue = [int]$task.targetIssue
        if (-not $SkipWorktreeSetup) {
            Ensure-Worktree -BranchName $plan.BranchName -WorktreeDir $plan.WorktreeDir
        }
        Write-HookSettings -WorktreeDir $plan.WorktreeDir

        $singleTaskFile = Join-Path $batchLogDir "issue-$issue.task.json"
        $outLog = Join-Path $batchLogDir "issue-$issue.out.log"
        $errLog = Join-Path $batchLogDir "issue-$issue.err.log"
        $resultPath = Join-Path $batchLogDir "issue-$issue.result.json"
        $runnerPath = Join-Path $batchLogDir "issue-$issue.runner.ps1"
        Write-SingleTaskFile $task $singleTaskFile
        New-WorkerRunnerScript $plan $runnerPath $resultPath $singleTaskFile

        $process = Start-Process -FilePath "pwsh" `
            -ArgumentList @("-NoProfile", "-File", $runnerPath) `
            -RedirectStandardOutput $outLog `
            -RedirectStandardError $errLog `
            -WindowStyle Hidden `
            -PassThru

        $manifest.workers += [ordered]@{
            issueNumber = $issue
            issue = $issue
            branch = $plan.BranchName
            worktree = $plan.WorktreeDir
            taskFile = $singleTaskFile
            pid = $process.Id
            status = "running"
            startedAt = Get-IsoNow
            endedAt = $null
            exitCode = $null
            logPath = $outLog
            stderrPath = $errLog
            resultPath = $resultPath
            conflictGroup = [string]$task.conflictGroup
            risk = [string]$task.risk
            actorRole = [string](Get-Prop (Get-Prop $task "rolePacket" $null) "actorRole" "")
            providerSlot = $null
        }
        Write-Manifest $manifest $WorkerManifestPath
        Write-Ok "Started issue #$issue as PID $($process.Id)"
    }

    & $PSScriptRoot/wait-parallel-workers.ps1 -WorkerManifestPath $WorkerManifestPath -BatchId $batchId
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Parallel wave $($i + 1) completed with failures. See $WorkerManifestPath and $batchLogDir."
    }
    $manifest = Read-JsonFile $WorkerManifestPath
}

Write-Host ""
Write-Step "Batch launcher complete — $($tasks.Count) task(s) processed in $($waves.Count) bounded parallel wave(s)"
