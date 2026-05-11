<#
.SYNOPSIS
    Dry-run self-cycle runner that chains state reconciliation, health gate,
    launch gate, and batch launch into a single orchestrated loop.

.DESCRIPTION
    Top-level orchestrator for the self-hosted AI cycle. Runs the following
    steps in sequence:

        1. State Reconciler  — detect drift across issues/PRs
        2. Main Health       — read current main health state marker
        3. Launch Gate       — validate task(s) against health + conflict policy
        4. Batch Launch      — dry-run or execute the worker dispatch

    The runner stops at human-required gates and summarizes the next required
    human decision after each step.

    DRY-RUN BY DEFAULT. Pass -Execute to actually launch workers.

.PARAMETER TaskFile
    Path to a task JSON file (single object or array). Required.

.PARAMETER Repo
    GitHub repository in OWNER/NAME format. Defaults to GH_REPO env var.

.PARAMETER HealthFile
    Path to the main health state marker. Defaults to
    ./.github/ai-state/main-health.json

.PARAMETER Execute
    Switch from dry-run to execute mode. Without this flag the runner
    prints every step but makes no changes.

.PARAMETER SkipReconcile
    Skip the state-reconciler step (useful when reconciler is not needed
    for the current task batch).

.EXAMPLE
    # Full dry-run cycle
    ./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/issue-148.json

.EXAMPLE
    # Execute mode (launches worker)
    ./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/issue-148.json -Execute

.EXAMPLE
    # Skip reconciliation for a quick gate check
    ./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/issue-148.json -SkipReconcile
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TaskFile,

    [string]$Repo = $env:GH_REPO,

    [string]$HealthFile = "./.github/ai-state/main-health.json",

    [switch]$Execute,

    [switch]$SkipReconcile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

$SCRIPT_DIR = $PSScriptRoot
$RECONCILER  = Join-Path $SCRIPT_DIR "state-reconciler.ps1"
$HEALTH_WRITER = Join-Path $SCRIPT_DIR "write-main-health-state.ps1"
$LAUNCH_GATE = Join-Path $SCRIPT_DIR "check-launch-gate.ps1"
$BATCH_LAUNCH = Join-Path $SCRIPT_DIR "batch-launch.ps1"

$CYCLE_MARKER_BEGIN = "<!-- ai-self-cycle:report:begin -->"
$CYCLE_MARKER_END   = "<!-- ai-self-cycle:report:end -->"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step    { param([string]$Msg) Write-Host "[cycle] $Msg" -ForegroundColor Cyan }
function Write-Ok      { param([string]$Msg) Write-Host "[  ok]  $Msg" -ForegroundColor Green }
function Write-Warn    { param([string]$Msg) Write-Host "[warn]  $Msg" -ForegroundColor Yellow }
function Write-Fail    { param([string]$Msg) Write-Host "[fail]  $Msg" -ForegroundColor Red }
function Write-Gate    { param([string]$Msg) Write-Host "[gate]  $Msg" -ForegroundColor Magenta }

function Write-HumanStop {
    param([string]$Reason, [string]$NextAction)
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Magenta
    Write-Host "  HUMAN DECISION REQUIRED" -ForegroundColor Magenta
    Write-Host "==========================================================" -ForegroundColor Magenta
    Write-Host "  Reason: $Reason" -ForegroundColor White
    Write-Host "  Next:   $NextAction" -ForegroundColor White
    Write-Host "==========================================================" -ForegroundColor Magenta
    Write-Host ""
}

function Write-SectionHeader {
    param([string]$Title)
    Write-Host ""
    Write-Host "----------------------------------------------------------" -ForegroundColor DarkCyan
    Write-Host "  $Title" -ForegroundColor DarkCyan
    Write-Host "----------------------------------------------------------" -ForegroundColor DarkCyan
}

# ---------------------------------------------------------------------------
# Cycle result tracking
# ---------------------------------------------------------------------------

$cycleResult = [ordered]@{
    cycleVersion    = 1
    startedAt       = ([DateTime]::UtcNow).ToString("o")
    mode            = if ($Execute) { "execute" } else { "dry-run" }
    taskFile        = $TaskFile
    steps           = @()
    humanStops      = @()
    finalStatus     = "unknown"
    completedAt     = $null
}

function Add-StepResult {
    param([string]$Name, [string]$Status, [string]$Detail = "", [bool]$HumanStop = $false)

    $step = [ordered]@{
        name      = $Name
        status    = $Status
        detail    = $Detail
        humanStop = $HumanStop
        timestamp = ([DateTime]::UtcNow).ToString("o")
    }
    $cycleResult.steps += $step

    if ($HumanStop) {
        $cycleResult.humanStops += [ordered]@{
            step   = $Name
            reason = $Detail
        }
    }
}

# ---------------------------------------------------------------------------
# Validate inputs
# ---------------------------------------------------------------------------

if (-not (Test-Path $TaskFile)) {
    Write-Fail "Task file not found: $TaskFile"
    exit 2
}

$modeLabel = if ($Execute) { "EXECUTE" } else { "DRY-RUN" }
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Self-Cycle Runner [$modeLabel]" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Step "Task file: $TaskFile"
Write-Step "Health file: $HealthFile"
if ($Repo) { Write-Step "Repo: $Repo" }
Write-Host ""

# ===========================================================================
# STEP 1: State Reconciler
# ===========================================================================

Write-SectionHeader "STEP 1 — State Reconciler"

if ($SkipReconcile) {
    Write-Warn "Skipped (--SkipReconcile)"
    Add-StepResult -Name "reconcile" -Status "skipped"
} else {
    $reconcileArgs = @()
    if ($Repo) { $reconcileArgs += "-Repo"; $reconcileArgs += $Repo }
    $reconcileArgs += "-FixturePath"; $reconcileArgs += ""  # no fixture, use live data

    # Remove empty fixture path arg if no fixture
    if (-not $Repo) {
        Write-Warn "No -Repo specified and no GH_REPO env var. Reconciler will need a repo."
        Write-HumanStop -Reason "Repository not specified for state reconciliation." `
                        -NextAction "Pass -Repo OWNER/NAME or set GH_REPO env var."
        Add-StepResult -Name "reconcile" -Status "blocked" `
                       -Detail "Repo not specified" -HumanStop $true
    } else {
        Write-Step "Running state reconciler..."
        try {
            & pwsh -NoProfile -File $RECONCILER -Repo $Repo
            $reconcileExit = $LASTEXITCODE
            if ($reconcileExit -eq 0) {
                Write-Ok "State reconciliation passed (no drift or informational only)"
                Add-StepResult -Name "reconcile" -Status "pass"
            } else {
                Write-Warn "State reconciler exited with code $reconcileExit"
                Add-StepResult -Name "reconcile" -Status "warning" `
                               -Detail "Exit code $reconcileExit — review drift report above"
            }
        } catch {
            Write-Fail "State reconciler failed: $_"
            Add-StepResult -Name "reconcile" -Status "error" -Detail "$_"
        }
    }
}

# ===========================================================================
# STEP 2: Main Health State
# ===========================================================================

Write-SectionHeader "STEP 2 — Main Health State"

$mainHealthState = "green"

if (Test-Path $HealthFile) {
    try {
        $healthRaw = Get-Content -Path $HealthFile -Raw -Encoding UTF8
        $health = $healthRaw | ConvertFrom-Json
        if ($health.state) {
            $mainHealthState = $health.state
            Write-Ok "Main health: $mainHealthState (commit: $($health.commitSha.Substring(0, [Math]::Min(8, $health.commitSha.Length))))"
            Add-StepResult -Name "health" -Status "read" -Detail "state=$mainHealthState"
        }
    } catch {
        Write-Warn "Could not parse $HealthFile — assuming red (fail-safe)"
        $mainHealthState = "red"
        Add-StepResult -Name "health" -Status "warning" -Detail "Parse error, assumed red"
    }
} else {
    Write-Warn "No health marker at $HealthFile — assuming green"
    Add-StepResult -Name "health" -Status "default" -Detail "No marker file, assumed green"
}

# Human stop for red/black states
if ($mainHealthState -eq "red" -or $mainHealthState -eq "black") {
    Write-HumanStop -Reason "Main health is $mainHealthState. Automated launches are blocked." `
                    -NextAction "Fix main health before running the self-cycle. Check post-merge-health-gate."
    Add-StepResult -Name "health-gate" -Status "blocked" `
                   -Detail "Main is $mainHealthState" -HumanStop $true

    # Exit early — no point checking launch gate
    $cycleResult.finalStatus = "blocked-by-health"
    $cycleResult.completedAt = ([DateTime]::UtcNow).ToString("o")
    Write-Host ""
    Write-Host "Cycle result: $($cycleResult.finalStatus)" -ForegroundColor Red
    exit 1
}

# ===========================================================================
# STEP 3: Launch Gate
# ===========================================================================

Write-SectionHeader "STEP 3 — Launch Gate"

Write-Step "Running launch gate check against task file..."

try {
    $gateOutput = & pwsh -NoProfile -File $LAUNCH_GATE -TaskFile $TaskFile -HealthFile $HealthFile 2>&1
    $gateExit = $LASTEXITCODE

    Write-Host $gateOutput

    if ($gateExit -eq 0) {
        Write-Ok "Launch gate PASSED — all tasks cleared"
        Add-StepResult -Name "launch-gate" -Status "pass"
    } else {
        Write-Fail "Launch gate FAILED — one or more tasks blocked"
        Write-HumanStop -Reason "Launch gate blocked task(s). See report above." `
                        -NextAction "Review blocked tasks, fix conflicts or wait for main health to improve."
        Add-StepResult -Name "launch-gate" -Status "blocked" `
                       -Detail "Gate check failed" -HumanStop $true

        $cycleResult.finalStatus = "blocked-by-gate"
        $cycleResult.completedAt = ([DateTime]::UtcNow).ToString("o")
        Write-Host ""
        Write-Host "Cycle result: $($cycleResult.finalStatus)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Fail "Launch gate errored: $_"
    Add-StepResult -Name "launch-gate" -Status "error" -Detail "$_"
    $cycleResult.finalStatus = "error"
    $cycleResult.completedAt = ([DateTime]::UtcNow).ToString("o")
    exit 2
}

# ===========================================================================
# STEP 4: Batch Launch (dry-run or execute)
# ===========================================================================

Write-SectionHeader "STEP 4 — Batch Launch"

if ($Execute) {
    Write-Step "EXECUTE mode — launching worker via batch-launch.ps1"
    Write-HumanStop -Reason "About to launch worker in execute mode." `
                    -NextAction "Confirm launch by re-running with -Execute, or review the dry-run output first."
    Add-StepResult -Name "batch-launch" -Status "human-gate" `
                   -Detail "Execute mode requires explicit human confirmation" -HumanStop $true

    # NOTE: In the skeleton we do NOT auto-launch even in execute mode.
    # The human must re-run or explicitly confirm. This is the primary safety gate.
    Write-Warn "Skeleton mode: worker not launched automatically."
    Write-Warn "To launch: ./scripts/ai/batch-launch.ps1 -TaskFile $TaskFile -Execute"
} else {
    Write-Step "DRY-RUN mode — printing launch plan"

    try {
        & pwsh -NoProfile -File $BATCH_LAUNCH -TaskFile $TaskFile -DryRun
        $launchExit = $LASTEXITCODE

        if ($launchExit -eq 0) {
            Write-Ok "Dry-run launch plan complete"
            Add-StepResult -Name "batch-launch" -Status "dry-run-pass"
        } else {
            Write-Warn "Batch launch dry-run exited with code $launchExit"
            Add-StepResult -Name "batch-launch" -Status "warning" `
                           -Detail "Exit code $launchExit"
        }
    } catch {
        Write-Fail "Batch launch failed: $_"
        Add-StepResult -Name "batch-launch" -Status "error" -Detail "$_"
    }
}

# ===========================================================================
# STEP 5: Summary & Next Human Decision
# ===========================================================================

Write-SectionHeader "STEP 5 — Cycle Summary"

$cycleResult.completedAt = ([DateTime]::UtcNow).ToString("o")

# Determine final status
$blockedSteps = @($cycleResult.steps | Where-Object { $_.humanStop })
$failedSteps  = @($cycleResult.steps | Where-Object { $_.status -in @("error", "blocked") })
$warnSteps    = @($cycleResult.steps | Where-Object { $_.status -eq "warning" })

if ($failedSteps.Count -gt 0) {
    $cycleResult.finalStatus = "blocked"
} elseif ($blockedSteps.Count -gt 0) {
    $cycleResult.finalStatus = "human-stop"
} elseif ($warnSteps.Count -gt 0) {
    $cycleResult.finalStatus = "completed-with-warnings"
} else {
    $cycleResult.finalStatus = "completed"
}

# Print summary table
Write-Host ""
Write-Host "  Step               | Status" -ForegroundColor White
Write-Host "  -------------------|--------" -ForegroundColor Gray
foreach ($s in $cycleResult.steps) {
    $statusColor = switch ($s.status) {
        "pass"            { "Green" }
        "dry-run-pass"    { "Green" }
        "read"            { "Green" }
        "default"         { "Yellow" }
        "warning"         { "Yellow" }
        "skipped"         { "DarkGray" }
        "blocked"         { "Red" }
        "error"           { "Red" }
        "human-gate"      { "Magenta" }
        default           { "White" }
    }
    $namePadded = $s.name.PadRight(19)
    Write-Host "  $namePadded| " -NoNewline -ForegroundColor White
    Write-Host $s.status -ForegroundColor $statusColor
}

Write-Host ""
Write-Host "  Final status: " -NoNewline -ForegroundColor White
$finalColor = switch ($cycleResult.finalStatus) {
    "completed"                { "Green" }
    "completed-with-warnings"  { "Yellow" }
    "human-stop"               { "Magenta" }
    "blocked"                  { "Red" }
    "blocked-by-health"        { "Red" }
    "blocked-by-gate"          { "Red" }
    default                    { "White" }
}
Write-Host $cycleResult.finalStatus -ForegroundColor $finalColor

# Next action recommendation
Write-Host ""
switch ($cycleResult.finalStatus) {
    "completed" {
        Write-Host "Next: Review dry-run output above. If satisfied, re-run with -Execute." -ForegroundColor Green
    }
    "completed-with-warnings" {
        Write-Host "Next: Review warnings above. Consider fixing before launching." -ForegroundColor Yellow
    }
    "human-stop" {
        Write-Host "Next: Address human decision points above before proceeding." -ForegroundColor Magenta
    }
    "blocked" {
        Write-Host "Next: Fix blocked steps before the cycle can proceed." -ForegroundColor Red
    }
    "blocked-by-health" {
        Write-Host "Next: Fix main health (run post-merge-health-gate) before launching." -ForegroundColor Red
    }
    "blocked-by-gate" {
        Write-Host "Next: Resolve launch gate conflicts (duplicates, shared locks, health policy)." -ForegroundColor Red
    }
}

# Build markdown report for optional posting
$mdLines = @()
$mdLines += $CYCLE_MARKER_BEGIN
$mdLines += ""
$mdLines += "### Self-Cycle Runner Report"
$mdLines += ""
$mdLines += "**Mode:** $modeLabel"
$mdLines += "**Status:** $($cycleResult.finalStatus)"
$mdLines += "**Main health:** $mainHealthState"
$mdLines += ""
$mdLines += "| Step | Status |"
$mdLines += "|------|--------|"
foreach ($s in $cycleResult.steps) {
    $mdLines += "| $($s.name) | $($s.status) |"
}
$mdLines += ""
$mdLines += $CYCLE_MARKER_END
$cycleMarkdown = $mdLines -join "`n"

Write-Host ""
Write-Host "Cycle complete." -ForegroundColor Cyan
exit 0
