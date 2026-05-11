<#
.SYNOPSIS
    Preview-first self-cycle launch wrapper for WebUI.

.DESCRIPTION
    Controlled wrapper that gates run-self-cycle.ps1 behind label allowlists,
    health/provider capacity checks, and MaxTasks caps. Defaults to plan-only
    (dry-run) mode — no workers are launched unless -Execute is explicitly
    passed AND the label passes the allowlist.

    Pipeline:
        1. Label allowlist validation
        2. MaxTasks cap enforcement
        3. Main health state gate (green/yellow/red/black)
        4. Provider pool capacity gate
        5. Delegate to run-self-cycle.ps1 (dry-run or execute)

    Mutating/privileged actions require -Execute AND an allowed label.
    Without -Execute the wrapper produces a dry-run plan showing what
    would happen.

    Does NOT modify run-self-cycle.ps1.

.PARAMETER IssueLabel
    GitHub issue label for discovery. Must be in the allowlist.
    Default: "agent:codex-action-needed"

.PARAMETER MaxTasks
    Maximum tasks per cycle. Hard cap — blocks if exceeded.
    Valid range: 1-50. Default: 10.

.PARAMETER Execute
    Switch from plan-only to execute mode. Without this flag the wrapper
    produces a dry-run plan. Requires the label to be in the allowlist.

.PARAMETER Repo
    GitHub repository in OWNER/NAME format. Defaults to GH_REPO env var.

.PARAMETER HealthFile
    Path to the main health state marker. Defaults to
    ./.github/ai-state/main-health.json

.PARAMETER ProviderPoolStateFile
    Path to provider pool state. Defaults to
    ./.github/ai-state/provider-pool.json

.PARAMETER ProviderPoolPolicyFile
    Path to provider pool policy. Defaults to
    ./.github/ai-policy/provider-pool-policy.json

.PARAMETER LabelAllowlistFile
    Path to a JSON file containing allowed labels. If not provided,
    uses the built-in default allowlist.

.EXAMPLE
    # Plan-only (default) — shows what would happen
    ./scripts/ai/webui-launch-control.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name

.EXAMPLE
    # Execute mode — launches workers after gate checks
    ./scripts/ai/webui-launch-control.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name -Execute

.EXAMPLE
    # Custom MaxTasks cap
    ./scripts/ai/webui-launch-control.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name -MaxTasks 5
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter()]
    [string]$IssueLabel = "agent:codex-action-needed",

    [Parameter()]
    [ValidateRange(1, 50)]
    [int]$MaxTasks = 10,

    [Parameter()]
    [switch]$Execute,

    [Parameter()]
    [string]$Repo = $env:GH_REPO,

    [Parameter()]
    [string]$HealthFile,

    [Parameter()]
    [string]$ProviderPoolStateFile,

    [Parameter()]
    [string]$ProviderPoolPolicyFile,

    [Parameter()]
    [string]$LabelAllowlistFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SCRIPT_DIR = $PSScriptRoot
$SELF_CYCLE = Join-Path $SCRIPT_DIR "run-self-cycle.ps1"
$ROOT = Resolve-Path (Join-Path $SCRIPT_DIR ".." "..")

# --- Defaults ----------------------------------------------------------------

if (-not $HealthFile) {
    $HealthFile = Join-Path $ROOT ".github" "ai-state" "main-health.json"
}
if (-not $ProviderPoolStateFile) {
    $ProviderPoolStateFile = Join-Path $ROOT ".github" "ai-state" "provider-pool.json"
}
if (-not $ProviderPoolPolicyFile) {
    $ProviderPoolPolicyFile = Join-Path $ROOT ".github" "ai-policy" "provider-pool-policy.json"
}

# --- Color helpers -----------------------------------------------------------

function Write-Step {
    param([string]$Msg)
    Write-Host "  $Msg" -ForegroundColor Cyan
}

function Write-Pass {
    param([string]$Msg)
    Write-Host "  PASS  $Msg" -ForegroundColor Green
}

function Write-Fail {
    param([string]$Msg)
    Write-Host "  FAIL  $Msg" -ForegroundColor Red
}

function Write-Warn {
    param([string]$Msg)
    Write-Host "  WARN  $Msg" -ForegroundColor Yellow
}

function Write-Info {
    param([string]$Msg)
    Write-Host "  $Msg" -ForegroundColor Gray
}

# --- Label allowlist ---------------------------------------------------------

$defaultLabelAllowlist = @(
    "agent:codex-action-needed"
    "agent:codex-docs"
    "agent:codex-health"
    "agent:codex-research"
)

function Resolve-LabelAllowlist {
    param([string]$AllowlistFile)

    if ($AllowlistFile -and (Test-Path $AllowlistFile)) {
        $raw = Get-Content $AllowlistFile -Raw -Encoding UTF8
        $parsed = $raw | ConvertFrom-Json
        if ($parsed -is [array]) {
            return $parsed
        }
        if ($parsed.allowedLabels) {
            return @($parsed.allowedLabels)
        }
        Write-Warn "Allowlist file format not recognized, using defaults"
    }

    return $defaultLabelAllowlist
}

# --- Health gate -------------------------------------------------------------

function Test-HealthGate {
    param([string]$Path)

    $result = @{
        state    = "unknown"
        blocked  = $false
        message  = ""
    }

    if (-not (Test-Path $Path)) {
        $result.state = "missing"
        $result.message = "Health file not found at $Path — treating as unknown (fail-closed)"
        $result.blocked = $true
        return $result
    }

    try {
        $health = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
        $result.state = $health.state

        switch ($health.state) {
            "green" {
                $result.message = "Health: green — all worker types allowed"
                $result.blocked = $false
            }
            "yellow" {
                $result.message = "Health: yellow — restricted worker types only"
                $result.blocked = $false
            }
            "red" {
                $result.message = "Health: red — only foundation-fix and health-repair allowed"
                $result.blocked = $true
            }
            "black" {
                $result.message = "Health: black — no workers allowed"
                $result.blocked = $true
            }
            default {
                $result.message = "Health: unknown state '$($health.state)' — fail-closed"
                $result.blocked = $true
            }
        }
    } catch {
        $result.state = "error"
        $result.message = "Health file read error: $_"
        $result.blocked = $true
    }

    return $result
}

# --- Provider pool capacity gate ---------------------------------------------

function Test-ProviderCapacity {
    param(
        [string]$StatePath,
        [string]$PolicyPath
    )

    $result = @{
        status   = "unknown"
        blocked  = $false
        message  = ""
        providers = @()
    }

    if (-not (Test-Path $StatePath)) {
        $result.status = "skip"
        $result.message = "Provider pool state not found — skipping capacity check"
        return $result
    }

    try {
        $state = Get-Content $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
        $policy = $null
        if (Test-Path $PolicyPath) {
            $policy = Get-Content $PolicyPath -Raw -Encoding UTF8 | ConvertFrom-Json
        }

        $blockWhenAllExhausted = $true
        $blockWhenAtCapacity = $true
        if ($policy -and $policy.launchGateIntegration) {
            if ($null -ne $policy.launchGateIntegration.blockWhenAllExhausted) {
                $blockWhenAllExhausted = $policy.launchGateIntegration.blockWhenAllExhausted
            }
            if ($null -ne $policy.launchGateIntegration.blockWhenAtCapacity) {
                $blockWhenAtCapacity = $policy.launchGateIntegration.blockWhenAtCapacity
            }
        }

        $providers = @($state.providers)
        $available = @($providers | Where-Object {
            $_.status -eq "available" -and $_.currentConcurrency -lt $_.maxConcurrency
        })
        $exhausted = @($providers | Where-Object { $_.status -eq "exhausted" })
        $disabled = @($providers | Where-Object { $_.status -eq "disabled" })
        $atCapacity = @($providers | Where-Object {
            $_.status -eq "available" -and $_.currentConcurrency -ge $_.maxConcurrency
        })

        $result.providers = @($providers | ForEach-Object {
            @{
                id      = $_.id
                status  = $_.status
                current = $_.currentConcurrency
                max     = $_.maxConcurrency
            }
        })

        # All exhausted or disabled
        if ($available.Count -eq 0 -and ($exhausted.Count + $disabled.Count) -eq $providers.Count) {
            if ($blockWhenAllExhausted) {
                $result.status = "blocked"
                $result.blocked = $true
                $result.message = "All providers exhausted/disabled — blocking launch"
                return $result
            }
            $result.status = "warn"
            $result.message = "All providers exhausted/disabled (policy: warn-only)"
            return $result
        }

        # All available providers at capacity
        if ($available.Count -eq 0 -and $atCapacity.Count -gt 0) {
            if ($blockWhenAtCapacity) {
                $result.status = "blocked"
                $result.blocked = $true
                $result.message = "All available providers at max concurrency — blocking launch"
                return $result
            }
            $result.status = "warn"
            $result.message = "All available providers at max concurrency (policy: warn-only)"
            return $result
        }

        $result.status = "pass"
        $result.message = "$($available.Count) provider(s) available with capacity"
    } catch {
        $result.status = "error"
        $result.message = "Provider pool read error: $_"
        $result.blocked = $true
    }

    return $result
}

# --- Summary printer ---------------------------------------------------------

function Write-CycleSummary {
    param($Result)

    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor White
    Write-Host "  WebUI Launch Control Summary" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor White
    Write-Host ""

    foreach ($step in $Result.steps.GetEnumerator()) {
        $color = switch ($step.Value) {
            "pass"    { "Green" }
            "blocked" { "Red" }
            "warn"    { "Yellow" }
            default   { "Gray" }
        }
        Write-Host "  $($step.Key): $($step.Value)" -ForegroundColor $color
    }

    Write-Host ""
    Write-Host "  Final: $($Result.finalStatus)" -ForegroundColor $(if ($Result.exitCode -eq 0) { "Green" } else { "Red" })
    Write-Host ""
}

# --- Main --------------------------------------------------------------------

Write-Host ""
Write-Host "==========================================================" -ForegroundColor White
Write-Host "  WebUI Launch Control" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor White
Write-Host ""

$cycleResult = [ordered]@{
    label          = $IssueLabel
    maxTasks       = $MaxTasks
    executeMode    = $Execute.IsPresent
    steps          = [ordered]@{}
    finalStatus    = "pending"
    exitCode       = 0
}

# ===========================================================================
# Step 1: Label allowlist validation
# ===========================================================================

Write-Step "Step 1: Label allowlist validation"

$allowlist = Resolve-LabelAllowlist $LabelAllowlistFile
$labelAllowed = $IssueLabel -in $allowlist

if (-not $labelAllowed) {
    Write-Fail "Label '$IssueLabel' is not in the allowlist"
    Write-Info "Allowed labels: $($allowlist -join ', ')"
    $cycleResult.steps["label-allowlist"] = "blocked"
    $cycleResult.finalStatus = "blocked-by-label-allowlist"
    $cycleResult.exitCode = 1
    Write-CycleSummary $cycleResult
    exit 1
}

Write-Pass "Label '$IssueLabel' is allowed"
$cycleResult.steps["label-allowlist"] = "pass"

# ===========================================================================
# Step 2: MaxTasks cap enforcement
# ===========================================================================

Write-Step "Step 2: MaxTasks cap ($MaxTasks)"

# We can't know the actual task count until discovery, but we enforce
# the cap parameter validity here. The actual count is enforced by
# run-self-cycle.ps1 -MaxTasks.
$warnThreshold = [Math]::Floor($MaxTasks * 0.8)
Write-Info "MaxTasks: $MaxTasks (warn at >= $warnThreshold)"
$cycleResult.steps["max-tasks-cap"] = "pass"

# ===========================================================================
# Step 3: Main health state gate
# ===========================================================================

Write-Step "Step 3: Main health state gate"

$healthResult = Test-HealthGate $HealthFile

if ($healthResult.blocked) {
    Write-Fail $healthResult.message
    $cycleResult.steps["health-gate"] = "blocked"
    $cycleResult.finalStatus = "blocked-by-health"
    $cycleResult.exitCode = 1
    Write-CycleSummary $cycleResult
    exit 1
}

if ($healthResult.state -eq "yellow") {
    Write-Warn $healthResult.message
} else {
    Write-Pass $healthResult.message
}
$cycleResult.steps["health-gate"] = "pass"

# ===========================================================================
# Step 4: Provider pool capacity gate
# ===========================================================================

Write-Step "Step 4: Provider pool capacity gate"

$providerResult = Test-ProviderCapacity $ProviderPoolStateFile $ProviderPoolPolicyFile

if ($providerResult.blocked) {
    Write-Fail $providerResult.message
    $cycleResult.steps["provider-gate"] = "blocked"
    $cycleResult.finalStatus = "blocked-by-provider-pool"
    $cycleResult.exitCode = 1
    Write-CycleSummary $cycleResult
    exit 1
}

if ($providerResult.status -eq "warn") {
    Write-Warn $providerResult.message
} elseif ($providerResult.status -eq "skip") {
    Write-Info $providerResult.message
} else {
    Write-Pass $providerResult.message
}
$cycleResult.steps["provider-gate"] = "pass"

# ===========================================================================
# Step 5: Delegate to run-self-cycle.ps1
# ===========================================================================

Write-Step "Step 5: Self-cycle delegation"

$isDryRun = -not $Execute
$modeLabel = if ($isDryRun) { "plan-only (dry-run)" } else { "execute" }

if ($Execute) {
    Write-Host ""
    Write-Host "  *** EXECUTE MODE ***" -ForegroundColor Yellow
    Write-Host "  This will launch workers. Ensure gates above are green." -ForegroundColor Yellow
    Write-Host ""
}

Write-Info "Mode: $modeLabel"
Write-Info "Delegating to run-self-cycle.ps1 -IssueLabel '$IssueLabel' -MaxTasks $MaxTasks"

$selfCycleArgs = @(
    "-NoProfile"
    "-File", $SELF_CYCLE
    "-IssueLabel", $IssueLabel
    "-MaxTasks", $MaxTasks
)

if ($Repo) {
    $selfCycleArgs += @("-Repo", $Repo)
    Write-Info "Repo: $Repo"
}

if ($isDryRun) {
    # run-self-cycle.ps1 is dry-run by default (no -Execute)
    Write-Info "Dry-run: no -Execute flag passed to run-self-cycle.ps1"
} else {
    $selfCycleArgs += "-Execute"
}

Write-Host ""
Write-Host "  Running: pwsh $($selfCycleArgs -join ' ')" -ForegroundColor Gray
Write-Host ""

& pwsh @selfCycleArgs
$delegateExit = $LASTEXITCODE

# ===========================================================================
# Summary
# ===========================================================================

if ($delegateExit -ne 0) {
    Write-Fail "run-self-cycle.ps1 exited with code $delegateExit"
    $cycleResult.finalStatus = "delegate-failed"
    $cycleResult.exitCode = $delegateExit
} else {
    $cycleResult.finalStatus = if ($isDryRun) { "plan-complete" } else { "execute-complete" }
    $cycleResult.exitCode = 0
}

Write-CycleSummary $cycleResult
exit $cycleResult.exitCode
