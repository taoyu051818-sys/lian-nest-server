<#
.SYNOPSIS
    Pre-launch gate checker that validates planned tasks against main health
    state, launch policy, provider pool, and conflict metadata before worker
    dispatch.

.DESCRIPTION
    Reads a task JSON file (single object or array) and an optional main health
    state marker. For each task the checker:

    1. Resolves main health state (green / yellow / red / black).
    2. Loads the machine-readable launch policy (permission matrix, timeout
       defaults) from .github/ai-policy/launch-policy.json.
    3. Reads provider pool availability from .github/ai-state/provider-pool.json
       and warns when providers are exhausted or at capacity.
    4. Classifies each task as a worker type based on mainHealthPolicy,
       allowedFiles, and risk.
    5. Applies the launch policy permission matrix to decide allow / block.
    6. Detects duplicate conflictGroup values in the batch.
    7. Detects sharedLocks overlap between tasks (when the field is present).
    8. Detects running-worker conflictGroup collisions (when a running tasks
       manifest is provided).

    This is a dry-run checker only. It does NOT modify any files or launch
    workers. The orchestrator calls this before batch-launch.ps1.

    When the launch policy JSON is absent, the checker falls back to a
    hardcoded default matrix that preserves backwards compatibility.

.PARAMETER TaskFile
    Path to a task JSON file. Must be a single task object or an array of tasks.

.PARAMETER HealthFile
    Path to the main health state marker JSON. Defaults to
    ./.github/ai-state/main-health.json

.PARAMETER MainState
    Override the health state instead of reading from HealthFile.
    One of: green, yellow, red, black. Ignored when HealthFile exists and
    contains a valid state.

.PARAMETER PolicyFile
    Path to the machine-readable launch policy JSON. Defaults to
    ./.github/ai-policy/launch-policy.json. When present, the permission
    matrix and timeout defaults are read from this file instead of using
    hardcoded values.

.PARAMETER ProviderPoolFile
    Path to the provider pool state JSON. Defaults to
    ./.github/ai-state/provider-pool.json. When present, provider
    availability is checked and warnings are emitted when providers are
    exhausted or at capacity.

.PARAMETER RunningTasksFile
    Path to a JSON file listing currently active worker conflict groups.
    Format: an array of objects with a "conflictGroup" string field, e.g.
    [{ "conflictGroup": "auth-core", "issue": 258 }]
    Tasks whose conflictGroup matches an active group will be blocked.
    When omitted, running-worker conflict detection is skipped.

.PARAMETER ResourceFile
    Path to the local resource state JSON. Defaults to
    ./.github/ai-state/local-resource.json. When present, CPU, memory,
    disk, and process capacity are checked against resource policy
    thresholds. Blocks launch when any resource is at critical level.
    When omitted, local resource checks are skipped.

.PARAMETER ResourcePolicyFile
    Path to the local resource policy JSON. Defaults to
    ./.github/ai-policy/local-resource-policy.json. Provides thresholds
    for CPU, memory, disk, and process count evaluation.

.PARAMETER Json
    Output the report as JSON instead of console text.

.PARAMETER DryRun
    Print the files that would be loaded and the effective configuration,
    then exit without evaluating tasks. Useful for validating that the
    policy and provider pool files resolve correctly.

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

.EXAMPLE
    # Dry-run: show effective configuration without evaluating tasks
    ./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json -DryRun
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TaskFile,

    [string]$HealthFile = "./.github/ai-state/main-health.json",

    [ValidateSet("green", "yellow", "red", "black")]
    [string]$MainState = "",

    [string]$PolicyFile = "./.github/ai-policy/launch-policy.json",

    [string]$ProviderPoolFile = "./.github/ai-state/provider-pool.json",

    [string]$RunningTasksFile = "",

    [string]$ResourceFile = "./.github/ai-state/local-resource.json",

    [string]$ResourcePolicyFile = "./.github/ai-policy/local-resource-policy.json",

    [switch]$Json,

    [switch]$DryRun
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
    param([string]$Msg)    if (-not $Json) {
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
        Write-Warn "Could not parse $HealthFile 鈥?assuming red (fail-safe)"
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
        } elseif ($runningTasks.PSObject.Properties.Name -contains "workers" -and $runningTasks.workers) {
            $runningList = @($runningTasks.workers)
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
# Load launch policy (optional, backwards-compatible)
# ---------------------------------------------------------------------------

$policyLoaded = $false
$policyVersion = $null
$policyTimeoutDefaults = $null
$policyPermissionMatrix = $null

# Hardcoded default matrix 鈥?matches current behavior when policy file is absent
$defaultPermissionMatrix = @{
    "green"  = @("runtime-feature", "foundation-fix", "docs", "health-repair", "test-only", "research")
    "yellow" = @("foundation-fix", "docs", "health-repair", "research")
    "red"    = @("foundation-fix", "health-repair")
    "black"  = @()
}

if (Test-Path $PolicyFile) {
    try {
        $policyRaw = Get-Content -Path $PolicyFile -Raw -Encoding UTF8
        $policy = $policyRaw | ConvertFrom-Json
        $policyVersion = Get-Prop $policy "policyVersion"
        Write-Step "Loaded launch policy from ${PolicyFile} (version $policyVersion)"

        # Extract permission matrix from policy
        $lpm = Get-Prop $policy "launchPermissionMatrix"
        if ($lpm) {
            $matrixObj = Get-Prop $lpm "matrix"
            if ($matrixObj) {
                $policyPermissionMatrix = @{}
                foreach ($state in @("green", "yellow", "red", "black")) {
                    $stateVal = Get-Prop $matrixObj $state
                    if ($null -ne $stateVal) {
                        $policyPermissionMatrix[$state] = @($stateVal)
                    } else {
                        $policyPermissionMatrix[$state] = $defaultPermissionMatrix[$state]
                    }
                }
                Write-Step "Using permission matrix from policy file"
            }
        }

        # Extract timeout defaults from policy
        $td = Get-Prop $policy "timeoutDefaults"
        if ($td) {
            $byType = Get-Prop $td "byWorkerType"
            if ($byType) {
                $policyTimeoutDefaults = @{}
                foreach ($prop in $byType.PSObject.Properties) {
                    $policyTimeoutDefaults[$prop.Name] = $prop.Value
                }
                Write-Step "Loaded timeout defaults for $($policyTimeoutDefaults.Count) worker type(s)"
            }
        }

        $policyLoaded = $true
    } catch {
        Write-Warn "Could not parse $PolicyFile 鈥?using hardcoded defaults"
    }
} else {
    Write-Warn "No launch policy at $PolicyFile 鈥?using hardcoded defaults"
}

# Use policy matrix if loaded, otherwise fall back to defaults
$permissionMatrix = if ($policyLoaded -and $null -ne $policyPermissionMatrix) {
    $policyPermissionMatrix
} else {
    $defaultPermissionMatrix
}

# ---------------------------------------------------------------------------
# Load provider pool state (optional, warning mode)
# ---------------------------------------------------------------------------

$providerPoolLoaded = $false
$providerPool = $null
$providerPoolWarnings = @()

if (Test-Path $ProviderPoolFile) {
    try {
        $poolRaw = Get-Content -Path $ProviderPoolFile -Raw -Encoding UTF8
        $providerPool = $poolRaw | ConvertFrom-Json
        $providerPoolLoaded = $true
        $stateVersion = Get-Prop $providerPool "stateVersion"
        Write-Step "Loaded provider pool state from ${ProviderPoolFile} (version $stateVersion)"

        $providers = @()
        $providersRaw = Get-Prop $providerPool "providers"
        if ($null -ne $providersRaw) {
            $providers = @($providersRaw)
        }

        $availableCount = 0
        $totalCapacity = 0
        $totalUsed = 0
        $exhaustedProviders = @()
        $disabledProviders = @()

        foreach ($p in $providers) {
            $provId = Get-Prop $p "id" "unknown"
            $provStatus = Get-Prop $p "status" "unknown"
            $provMax = [int](Get-Prop $p "maxConcurrency" 0)
            $provCurrent = [int](Get-Prop $p "currentConcurrency" 0)
            $provCooldown = Get-Prop $p "cooldownExpiresAt"

            $totalCapacity += $provMax
            $totalUsed += $provCurrent

            if ($provStatus -eq "available") {
                # Check if at capacity
                if ($provCurrent -lt $provMax) {
                    $availableCount++
                } else {
                    $providerPoolWarnings += "Provider '$provId' is at capacity ($provCurrent/$provMax)."
                }
            } elseif ($provStatus -eq "exhausted") {
                $exhaustedProviders += $provId
                $cooldownMsg = if ($provCooldown) { " (cooldown until $provCooldown)" } else { "" }
                $providerPoolWarnings += "Provider '$provId' is exhausted$cooldownMsg."
            } elseif ($provStatus -eq "disabled") {
                $disabledProviders += $provId
                $providerPoolWarnings += "Provider '$provId' is disabled (manual intervention required)."
            }
        }

        if ($availableCount -eq 0 -and $providers.Count -gt 0) {
            $providerPoolWarnings += "CRITICAL: No providers available. All providers are exhausted, disabled, or at capacity."
        }

        foreach ($w in $providerPoolWarnings) {
            Write-Warn "Provider pool: $w"
        }
    } catch {
        Write-Warn "Could not parse $ProviderPoolFile 鈥?provider pool checks skipped"
    }
} else {
    Write-Step "No provider pool file at $ProviderPoolFile 鈥?provider pool checks skipped"
}

# ---------------------------------------------------------------------------
# Load local resource state (optional, fail-closed)
# ---------------------------------------------------------------------------

$resourceLoaded = $false
$resourcePolicyLoaded = $false
$resourceState = $null
$resourcePolicy = $null
$resourceWarnings = @()
$resourceBlocking = $false
$resourceGlobalState = "unknown"
$resourceChecks = $null

# Resource policy thresholds (hardcoded fallback when policy file absent)
$defaultResourceThresholds = @{
    "cpu"         = @{ warn = 75;  block = 90 }
    "memory"      = @{ warn = 80;  block = 92 }
    "disk"        = @{ warn = 85;  block = 95 }
    "processCount" = @{ warn = 25; block = 30 }
}

$resourceThresholds = $defaultResourceThresholds

# Load resource policy
if (Test-Path $ResourcePolicyFile) {
    try {
        $rpRaw = Get-Content -Path $ResourcePolicyFile -Raw -Encoding UTF8
        $resourcePolicy = $rpRaw | ConvertFrom-Json
        $resourcePolicyLoaded = $true
        $rpVersion = Get-Prop $resourcePolicy "policyVersion"
        Write-Step "Loaded local resource policy from ${ResourcePolicyFile} (version $rpVersion)"

        # Extract thresholds from policy
        foreach ($resName in @("cpu", "memory", "disk", "processCount")) {
            $resSection = Get-Prop $resourcePolicy $resName
            if ($resSection) {
                $thresholds = Get-Prop $resSection "thresholds"
                if ($thresholds) {
                    $blockVal = $null
                    $warnVal = $null
                    $launchBlock = Get-Prop $thresholds "launchBlock"
                    if ($launchBlock) { $blockVal = [double](Get-Prop $launchBlock "value" 0) }
                    $launchWarn = Get-Prop $thresholds "launchWarn"
                    if ($launchWarn) { $warnVal = [double](Get-Prop $launchWarn "value" 0) }
                    if ($null -ne $blockVal -or $null -ne $warnVal) {
                        $resourceThresholds[$resName] = @{
                            warn  = if ($null -ne $warnVal)  { $warnVal }  else { $resourceThresholds[$resName].warn }
                            block = if ($null -ne $blockVal) { $blockVal } else { $resourceThresholds[$resName].block }
                        }
                    }
                }
            }
        }
        Write-Step "Using resource thresholds from policy file"
    } catch {
        Write-Warn "Could not parse $ResourcePolicyFile 鈥?using hardcoded defaults"
    }
} else {
    Write-Step "No local resource policy at $ResourcePolicyFile 鈥?using hardcoded defaults"
}

# Load local resource state
if (Test-Path $ResourceFile) {
    try {
        $resRaw = Get-Content -Path $ResourceFile -Raw -Encoding UTF8
        $resourceState = $resRaw | ConvertFrom-Json
        $resourceLoaded = $true

        # Read global resource state
        $globalObj = Get-Prop $resourceState "global"
        if ($globalObj) {
            $resourceGlobalState = Get-Prop $globalObj "resourceState" "unknown"
        }

        Write-Step "Loaded local resource state from ${ResourceFile} (state: $resourceGlobalState)"

        # Check global resource state
        if ($resourceGlobalState -eq "critical") {
            $resourceBlocking = $true
            $resourceWarnings += "Local resources CRITICAL 鈥?launch blocked."
        } elseif ($resourceGlobalState -eq "unknown") {
            $resourceBlocking = $true
            $resourceWarnings += "Local resource state unknown (stale or missing data) 鈥?launch blocked (fail-closed)."
        } elseif ($resourceGlobalState -eq "constrained") {
            $resourceWarnings += "Local resources CONSTRAINED 鈥?one or more resources above warning threshold."
        }

        # Evaluate individual resource metrics against policy thresholds
        $resourceChecks = [ordered]@{}

        # CPU check
        $cpuObj = Get-Prop $resourceState "cpu"
        if ($cpuObj) {
            $cpuPct = Get-Prop $cpuObj "usagePercent"
            if ($null -ne $cpuPct) {
                $cpuPct = [double]$cpuPct
                $cpuThreshold = $resourceThresholds["cpu"]
                $cpuLevel = "healthy"
                if ($cpuPct -ge $cpuThreshold.block) {
                    $cpuLevel = "block"
                    $resourceBlocking = $true
                    $resourceWarnings += "CPU at ${cpuPct}% 鈥?exceeds block threshold ($($cpuThreshold.block)%)."
                } elseif ($cpuPct -ge $cpuThreshold.warn) {
                    $cpuLevel = "warn"
                    $resourceWarnings += "CPU at ${cpuPct}% 鈥?exceeds warning threshold ($($cpuThreshold.warn)%)."
                }
                $resourceChecks["cpu"] = [ordered]@{
                    usagePercent = $cpuPct
                    level        = $cpuLevel
                    warn         = $cpuThreshold.warn
                    block        = $cpuThreshold.block
                }
            }
        }

        # Memory check
        $memObj = Get-Prop $resourceState "memory"
        if ($memObj) {
            $memPct = Get-Prop $memObj "usagePercent"
            if ($null -ne $memPct) {
                $memPct = [double]$memPct
                $memThreshold = $resourceThresholds["memory"]
                $memLevel = "healthy"
                if ($memPct -ge $memThreshold.block) {
                    $memLevel = "block"
                    $resourceBlocking = $true
                    $resourceWarnings += "Memory at ${memPct}% 鈥?exceeds block threshold ($($memThreshold.block)%)."
                } elseif ($memPct -ge $memThreshold.warn) {
                    $memLevel = "warn"
                    $resourceWarnings += "Memory at ${memPct}% 鈥?exceeds warning threshold ($($memThreshold.warn)%)."
                }
                $resourceChecks["memory"] = [ordered]@{
                    usagePercent = $memPct
                    level        = $memLevel
                    warn         = $memThreshold.warn
                    block        = $memThreshold.block
                }
            }
        }

        # Disk check
        $diskObj = Get-Prop $resourceState "disk"
        if ($diskObj) {
            $diskPct = Get-Prop $diskObj "usagePercent"
            if ($null -ne $diskPct) {
                $diskPct = [double]$diskPct
                $diskThreshold = $resourceThresholds["disk"]
                $diskLevel = "healthy"
                if ($diskPct -ge $diskThreshold.block) {
                    $diskLevel = "block"
                    $resourceBlocking = $true
                    $resourceWarnings += "Disk at ${diskPct}% 鈥?exceeds block threshold ($($diskThreshold.block)%)."
                } elseif ($diskPct -ge $diskThreshold.warn) {
                    $diskLevel = "warn"
                    $resourceWarnings += "Disk at ${diskPct}% 鈥?exceeds warning threshold ($($diskThreshold.warn)%)."
                }
                $resourceChecks["disk"] = [ordered]@{
                    usagePercent = $diskPct
                    level        = $diskLevel
                    warn         = $diskThreshold.warn
                    block        = $diskThreshold.block
                }
            }
        }

        # Process count check
        $procObj = Get-Prop $resourceState "process"
        if ($procObj) {
            $procCount = Get-Prop $procObj "runningCount"
            if ($null -ne $procCount) {
                $procCount = [int]$procCount
                $procThreshold = $resourceThresholds["processCount"]
                $procLevel = "healthy"
                if ($procCount -ge $procThreshold.block) {
                    $procLevel = "block"
                    $resourceBlocking = $true
                    $resourceWarnings += "Process count at $procCount 鈥?exceeds block threshold ($($procThreshold.block))."
                } elseif ($procCount -ge $procThreshold.warn) {
                    $procLevel = "warn"
                    $resourceWarnings += "Process count at $procCount 鈥?exceeds warning threshold ($($procThreshold.warn))."
                }
                $resourceChecks["processCount"] = [ordered]@{
                    runningCount = $procCount
                    level        = $procLevel
                    warn         = $procThreshold.warn
                    block        = $procThreshold.block
                }
            }
        }

        foreach ($w in $resourceWarnings) {
            if ($resourceBlocking) {
                Write-Fail "Resource guard: $w"
            } else {
                Write-Warn "Resource guard: $w"
            }
        }
    } catch {
        Write-Fail "Could not parse $ResourceFile 鈥?blocking launch (fail-closed)"
        $resourceBlocking = $true
        $resourceWarnings += "Failed to parse resource state file 鈥?fail-closed enforcement."
    }
} else {
    Write-Step "No local resource file at $ResourceFile 鈥?resource checks skipped"
}

# ---------------------------------------------------------------------------
# Dry-run mode: print config and exit
# ---------------------------------------------------------------------------

if ($DryRun) {
    $dryRunReport = [ordered]@{
        mode             = "dry-run"
        taskFile         = $TaskFile
        healthFile       = $HealthFile
        policyFile       = $PolicyFile
        providerPoolFile = $ProviderPoolFile
        runningTasksFile = $RunningTasksFile
        resourceFile     = $ResourceFile
        resourcePolicyFile = $ResourcePolicyFile
        policyLoaded     = $policyLoaded
        policyVersion    = $policyVersion
        providerPoolLoaded = $providerPoolLoaded
        resourceLoaded   = $resourceLoaded
        resourcePolicyLoaded = $resourcePolicyLoaded
        resourceGlobalState  = $resourceGlobalState
        resourceThresholds   = $resourceThresholds
        permissionMatrixSource = if ($policyLoaded) { "policy-file" } else { "hardcoded-defaults" }
        permissionMatrix = $permissionMatrix
        providerPoolWarnings = $providerPoolWarnings
        resourceWarnings     = $resourceWarnings
    }
    if ($Json) {
        $dryRunReport | ConvertTo-Json -Depth 6
    } else {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  Launch Gate Dry Run" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Task file:         $TaskFile"
        Write-Host "Health file:       $HealthFile"
        Write-Host "Policy file:       $PolicyFile (loaded: $policyLoaded)"
        Write-Host "Provider pool:     $ProviderPoolFile (loaded: $providerPoolLoaded)"
        Write-Host "Running tasks:     $(if ($RunningTasksFile) { $RunningTasksFile } else { '(none)' })"
        Write-Host "Resource state:    $ResourceFile (loaded: $resourceLoaded, state: $resourceGlobalState)"
        Write-Host "Resource policy:   $ResourcePolicyFile (loaded: $resourcePolicyLoaded)"
        Write-Host "Matrix source:     $(if ($policyLoaded) { 'policy-file' } else { 'hardcoded-defaults' })"
        if ($policyVersion) { Write-Host "Policy version:    $policyVersion" }
        Write-Host ""
        Write-Host "Permission matrix:" -ForegroundColor Cyan
        foreach ($state in @("green", "yellow", "red", "black")) {
            $types = $permissionMatrix[$state] -join ", "
            Write-Host "  $state : $types"
        }
        Write-Host ""
        if ($providerPoolWarnings.Count -gt 0) {
            Write-Host "Provider pool warnings:" -ForegroundColor Yellow
            foreach ($w in $providerPoolWarnings) {
                Write-Host "  $w" -ForegroundColor Yellow
            }
        } else {
            Write-Host "Provider pool: no warnings" -ForegroundColor Green
        }

        if ($resourceWarnings.Count -gt 0) {
            Write-Host "Resource guard warnings:" -ForegroundColor Yellow
            foreach ($w in $resourceWarnings) {
                Write-Host "  $w" -ForegroundColor Yellow
            }
        } else {
            Write-Host "Resource guard: $(if ($resourceLoaded) { 'no warnings' } else { 'not loaded' })" -ForegroundColor $(if ($resourceLoaded) { 'Green' } else { 'DarkGray' })
        }
        Write-Host ""
        Write-Ok "Dry run complete. No tasks evaluated."
    }
    exit 0
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

# Permission matrix: loaded from policy file or hardcoded defaults (set above)

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

    # Attach timeout defaults from policy when available
    if ($null -ne $policyTimeoutDefaults -and $policyTimeoutDefaults.ContainsKey($workerType)) {
        $td = $policyTimeoutDefaults[$workerType]
        $result["timeoutDefaults"] = [ordered]@{
            softTimeMinutes    = (Get-Prop $td "softTimeMinutes" $null)
            hardTimeMinutes    = (Get-Prop $td "hardTimeMinutes" $null)
            maxExtensionMinutes = (Get-Prop $td "maxExtensionMinutes" $null)
        }
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
    policyLoaded  = $policyLoaded
    policyVersion = $policyVersion
    providerPoolLoaded = $providerPoolLoaded
    providerPoolWarnings = $providerPoolWarnings
    resourceLoaded       = $resourceLoaded
    resourcePolicyLoaded = $resourcePolicyLoaded
    resourceGlobalState  = $resourceGlobalState
    resourceBlocking     = $resourceBlocking
    resourceWarnings     = $resourceWarnings
    resourceChecks       = if ($resourceChecks) { $resourceChecks } else { $null }
    taskCount     = $taskList.Count
    tasks         = $results
    duplicateConflictGroups = $duplicateGroups
    sharedLockConflicts     = $sharedLockConflicts
    runningWorkerConflicts  = $runningWorkerConflicts
    allAllowed    = ((-not $anyBlocked) -and (-not $resourceBlocking))
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
    Write-Host "Policy:          $(if ($policyLoaded) { "loaded (v$policyVersion)" } else { "hardcoded defaults" })"
    Write-Host "Provider pool:   $(if ($providerPoolLoaded) { "loaded ($(($providerPoolWarnings.Count)) warnings)" } else { "not loaded" })"
    Write-Host "Resource guard:  " -NoNewline
    if ($resourceLoaded) {
        $resColor = switch ($resourceGlobalState) {
            "healthy"    { "Green" }
            "constrained" { "Yellow" }
            "critical"   { "Red" }
            default      { "Red" }
        }
        Write-Host "$resourceGlobalState" -ForegroundColor $resColor -NoNewline
        Write-Host " ($($resourceWarnings.Count) warnings)"
    } else {
        Write-Host "not loaded" -ForegroundColor DarkGray
    }
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
            Write-Host "  group '$($rw.conflictGroup)' 鈥?task issue #$($rw.taskIssue) blocked by active worker issue #$($rw.runningIssue)" -ForegroundColor Red
        }
        Write-Host ""
    }

    if ($providerPoolWarnings.Count -gt 0) {
        Write-Host "Provider pool warnings:" -ForegroundColor Yellow
        foreach ($pw in $providerPoolWarnings) {
            Write-Host "  $pw" -ForegroundColor Yellow
        }
        Write-Host ""
    }

    if ($resourceWarnings.Count -gt 0) {
        Write-Host "Resource guard warnings:" -ForegroundColor $(if ($resourceBlocking) { "Red" } else { "Yellow" })
        foreach ($rw in $resourceWarnings) {
            Write-Host "  $rw" -ForegroundColor $(if ($resourceBlocking) { "Red" } else { "Yellow" })
        }
        Write-Host ""
    }

    if ($anyBlocked -or $resourceBlocking) {
        Write-Fail "Gate CHECK FAILED 鈥?one or more tasks blocked, conflicts detected, or resources critical."
    } else {
        Write-Ok "Gate CHECK PASSED 鈥?all tasks cleared for launch."
    }
}

# Exit code
if ($anyBlocked -or $resourceBlocking) { exit 1 } else { exit 0 }

