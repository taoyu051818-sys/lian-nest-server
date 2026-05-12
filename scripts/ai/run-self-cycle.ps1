<#
.SYNOPSIS
    Dry-run self-cycle runner that chains issue discovery, state reconciliation,
    health gate, launch gate, and batch launch into a single orchestrated loop.
    Supports autopilot plan mode for non-stop dry-run planning.

.DESCRIPTION
    Top-level orchestrator for the self-hosted AI cycle. Runs the following
    steps in sequence:

        0. Issue Discovery        鈥?discover issues by label, compile to task JSON
        1. State Reconciler       鈥?detect drift across issues/PRs
        2. Main Health            鈥?read current main health state marker
        2.5. Provider Pool Preflight 鈥?check provider availability and capacity
        3. Launch Gate            鈥?validate task(s) against health + conflict policy
        4. Batch Launch           鈥?dry-run or execute the worker dispatch

    The runner stops at human-required gates and summarizes the next required
    human decision after each step.

    DRY-RUN BY DEFAULT. Pass -Execute to actually launch workers.

    Either -TaskFile or -IssueLabel must be provided. When -IssueLabel is used,
    the runner discovers open issues with that label, compiles them into a task
    JSON file, and feeds the result into the standard pipeline.

    AUTOPILOT PLAN MODE (-AutopilotPlan): Chains all dry-run steps without
    stopping for human review between steps. Always dry-run (never launches
    workers). Produces a comprehensive plan showing what would happen if
    -Execute were passed. Useful for unattended batch planning and CI pipelines.

.PARAMETER TaskFile
    Path to a task JSON file (single object or array). Mutually exclusive
    with -IssueLabel.

.PARAMETER IssueLabel
    GitHub issue label to discover open issues (e.g. "agent:codex-action-needed").
    The runner fetches issues with this label, compiles each into a task JSON
    contract, and merges them into a single task array for the pipeline.
    Mutually exclusive with -TaskFile.

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

.PARAMETER DryRunFixture
    Path to a fixture directory containing pre-built task and health JSON.
    Loads fixtures, extracts the task object, and runs through the launch
    gate without live GitHub access. Mutually exclusive with -TaskFile
    and -IssueLabel. Implies dry-run mode with -SkipReconcile.

.PARAMETER MaxTasks
    Maximum number of tasks allowed in a single cycle. Safety cap to prevent
    runaway parallelism. If the task count exceeds this limit, the runner
    blocks with exit code 1. A warning is emitted at 80% capacity.
    Valid range: 1-100. Default: 10.

.PARAMETER AutopilotPlan
    Autopilot plan mode. Chains all dry-run steps (discovery, reconciliation,
    health check, provider pool preflight, launch gate) without stopping for
    human review between steps. Always dry-run 鈥?never launches workers.
    Produces a comprehensive plan at the end showing what would happen if
    -Execute were passed. Useful for unattended batch planning and CI
    pipelines. Requires -IssueLabel and -Repo.

.EXAMPLE
    # Full dry-run cycle with explicit task file
    ./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/issue-148.json

.EXAMPLE
    # Discover and compile issues by label (dry-run)
    ./scripts/ai/run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name

.EXAMPLE
    # Execute mode (launches worker)
    ./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/issue-148.json -Execute

.EXAMPLE
    # Skip reconciliation for a quick gate check
    ./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/issue-148.json -SkipReconcile

.EXAMPLE
    # Validate fixture through launch gate (no live GitHub needed)
    ./scripts/ai/run-self-cycle.ps1 -DryRunFixture ./tests/fixtures/self-cycle

.EXAMPLE
    # Autopilot plan mode 鈥?non-stop dry-run planning through all steps
    ./scripts/ai/run-self-cycle.ps1 -AutopilotPlan -IssueLabel "agent:codex-action-needed" -Repo owner/name
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(ParameterSetName = "TaskFile", Mandatory = $true)]
    [string]$TaskFile,

    [Parameter(ParameterSetName = "IssueLabel", Mandatory = $true)]
    [string]$IssueLabel,

    [Parameter(ParameterSetName = "DryRunFixture", Mandatory = $true)]
    [string]$DryRunFixture,

    [Parameter(ParameterSetName = "DryRunExecute", Mandatory = $true)]
    [string]$DryRunExecute,

    [string]$Repo = $env:GH_REPO,

    [string]$HealthFile = "./.github/ai-state/main-health.json",

    [switch]$Execute,

    [switch]$SkipReconcile,

    [switch]$PlanFirst,

    [switch]$AutopilotPlan,

    [ValidateRange(1, 100)]
    [int]$MaxTasks = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Default resource snapshot used by provider/resource-aware launch gates.
# Fixture modes may override this below.
$ResourceFile = "./.github/ai-state/local-resource.json"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

$SCRIPT_DIR = $PSScriptRoot
$RECONCILER  = Join-Path $SCRIPT_DIR "state-reconciler.ps1"
$HEALTH_WRITER = Join-Path $SCRIPT_DIR "write-main-health-state.ps1"
$LAUNCH_GATE = Join-Path $SCRIPT_DIR "check-launch-gate.ps1"
$BATCH_LAUNCH = Join-Path $SCRIPT_DIR "batch-launch.ps1"
$COMPILER = Join-Path $SCRIPT_DIR "compile-issue-to-task-json.ps1"
$PLANNER  = Join-Path $SCRIPT_DIR "plan-next-batch.ps1"

$CYCLE_MARKER_BEGIN = "<!-- ai-self-cycle:report:begin -->"
$CYCLE_MARKER_END   = "<!-- ai-self-cycle:report:end -->"

# ---------------------------------------------------------------------------
# AutopilotPlan validation
# ---------------------------------------------------------------------------

if ($AutopilotPlan) {
    if (-not $IssueLabel) {
        Write-Host "[fail]  -AutopilotPlan requires -IssueLabel to discover candidate issues." -ForegroundColor Red
        exit 2
    }
    if (-not $Repo) {
        Write-Host "[fail]  -AutopilotPlan requires -Repo or GH_REPO env var." -ForegroundColor Red
        exit 2
    }
    # Autopilot plan mode is always dry-run
    $Execute = $false
}

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
# DryRunExecute: fixture-based execute-path simulation (for testing)
# ---------------------------------------------------------------------------

if ($DryRunExecute) {
    if (-not (Test-Path $DryRunExecute)) {
        Write-Fail "DryRunExecute fixture directory not found: $DryRunExecute"
        exit 2
    }

    $taskFixtureFile = Get-ChildItem -Path $DryRunExecute -Filter "*-task.json" | Select-Object -First 1
    $healthFixtureFile = Join-Path $DryRunExecute "02-health-green.json"
    $resourceFixtureFile = Join-Path $DryRunExecute "local-resource.json"

    if (-not $taskFixtureFile) {
        Write-Fail "No *-task.json fixture found in $DryRunExecute"
        exit 2
    }

    $fixtureRaw = Get-Content -Path $taskFixtureFile.FullName -Raw -Encoding UTF8
    $fixtureJson = $fixtureRaw | ConvertFrom-Json
    $taskObj = if ($fixtureJson.task) { $fixtureJson.task } else { $fixtureJson }

    $tempTaskFile = Join-Path ([System.IO.Path]::GetTempPath()) "self-cycle-execute-fixture-task.json"
    $taskObj | ConvertTo-Json -Depth 10 | Set-Content $tempTaskFile -Encoding UTF8

    $TaskFile = $tempTaskFile
    $HealthFile = $healthFixtureFile
    $Execute = $true
    $SkipReconcile = $true
    $DryRunExecuteFlag = $true

    # Override resource file if fixture provides one
    if (Test-Path $resourceFixtureFile) {
        $ResourceFile = $resourceFixtureFile
    }
}

# ---------------------------------------------------------------------------
# Cycle result tracking
# ---------------------------------------------------------------------------

$cycleResult = [ordered]@{
    cycleVersion    = 1
    startedAt       = ([DateTime]::UtcNow).ToString("o")
    mode            = if ($DryRunFixture) { "fixture-dry-run" } elseif ($DryRunExecute) { "dry-run-execute" } elseif ($AutopilotPlan) { "autopilot-plan" } elseif ($Execute) { "execute" } else { "dry-run" }
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
# DryRunFixture: load fixture files and wire into pipeline
# ---------------------------------------------------------------------------

if ($DryRunFixture) {
    Write-SectionHeader "FIXTURE 鈥?Loading dry-run fixtures"

    if (-not (Test-Path $DryRunFixture)) {
        Write-Fail "Fixture directory not found: $DryRunFixture"
        exit 2
    }

    $taskFixtureFile = Get-ChildItem -Path $DryRunFixture -Filter "*-task.json" | Select-Object -First 1
    $healthFixtureFile = Join-Path $DryRunFixture "02-health-green.json"
    $resourceFixtureFile = Join-Path $DryRunFixture "local-resource.json"

    if (-not $taskFixtureFile) {
        Write-Fail "No *-task.json fixture found in $DryRunFixture"
        exit 2
    }

    Write-Step "Task fixture: $($taskFixtureFile.FullName)"
    Write-Step "Health fixture: $healthFixtureFile"

    # Load the fixture wrapper and extract the task object
    $fixtureRaw = Get-Content -Path $taskFixtureFile.FullName -Raw -Encoding UTF8
    $fixtureJson = $fixtureRaw | ConvertFrom-Json
    $taskObj = if ($fixtureJson.task) { $fixtureJson.task } else { $fixtureJson }

    # Write extracted task to a temp file for downstream scripts
    $tempTaskFile = Join-Path ([System.IO.Path]::GetTempPath()) "self-cycle-fixture-task.json"
    $taskObj | ConvertTo-Json -Depth 10 | Set-Content $tempTaskFile -Encoding UTF8

    # Override pipeline inputs
    $TaskFile = $tempTaskFile
    $HealthFile = $healthFixtureFile
    $Execute = $false
    $SkipReconcile = $true

    # Override resource file if fixture provides one
    if (Test-Path $resourceFixtureFile) {
        $ResourceFile = $resourceFixtureFile
    }

    # Update cycle result to reflect fixture mode
    $cycleResult.taskFile = $TaskFile

    Write-Ok "Fixture loaded 鈥?dry-run through launch gate"
    Add-StepResult -Name "fixture-load" -Status "pass" -Detail "Loaded from $DryRunFixture"
    Write-Host ""
}

# ---------------------------------------------------------------------------
# PlanFirst: run plan-next-batch.ps1 and stop for human review
# ---------------------------------------------------------------------------

if ($PlanFirst) {
    $planModeLabel = "PLAN-FIRST"
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  Self-Cycle Runner [$planModeLabel]" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host ""

    if (-not $IssueLabel) {
        Write-Fail "-PlanFirst requires -IssueLabel to discover candidate issues."
    }
    if (-not $Repo) {
        Write-Fail "-PlanFirst requires -Repo or GH_REPO env var."
    }

    Write-SectionHeader "STEP 0 鈥?Plan Next Batch (dry-run proposal)"

    Write-Step "Running plan-next-batch.ps1 -Json..."
    Write-Step "  Label: $IssueLabel"
    Write-Step "  Repo:  $Repo"

    try {
        $planJson = & pwsh -NoProfile -File $PLANNER -IssueLabel $IssueLabel -Repo $Repo -Json 2>&1
        $planExit = $LASTEXITCODE

        if ($planExit -ne 0) {
            Write-Fail "plan-next-batch.ps1 exited with code $planExit"
            exit 2
        }

        $plan = $planJson | ConvertFrom-Json
    } catch {
        Write-Fail "plan-next-batch.ps1 failed: $_"
        exit 2
    }

    # Save proposal to temp file for downstream use
    $proposalFile = Join-Path ([System.IO.Path]::GetTempPath()) "self-cycle-proposal.json"
    $planJson | Set-Content $proposalFile -Encoding UTF8

    Write-Ok "Proposal captured: $($plan.proposed) candidate(s) from $($plan.totalOpen) open issue(s)"
    Add-StepResult -Name "plan-proposal" -Status "pass" `
                   -Detail "$($plan.proposed) candidate(s) proposed"

    # Display proposal summary
    Write-Host ""
    Write-Host "  Proposed Batch:" -ForegroundColor White
    foreach ($c in $plan.candidates) {
        $riskColor = switch ($c.risk) {
            "low"    { "Green" }
            "medium" { "Yellow" }
            "high"   { "Red" }
        }
        $readyColor = switch ($c.readiness) {
            "ready"   { "Green" }
            "blocked" { "Red" }
            default   { "White" }
        }
        Write-Host "    #$($c.issueNumber)" -NoNewline -ForegroundColor White
        Write-Host "  " -NoNewline
        Write-Host "[$($c.risk)]" -NoNewline -ForegroundColor $riskColor
        Write-Host "  " -NoNewline
        Write-Host "$($c.conflictGroup)" -NoNewline -ForegroundColor DarkCyan
        Write-Host "  " -NoNewline
        Write-Host "$($c.readiness)" -ForegroundColor $readyColor
        Write-Host "      $($c.title)" -ForegroundColor Gray
    }

    if ($plan.conflictWarnings -and $plan.conflictWarnings.Count -gt 0) {
        Write-Host ""
        Write-Host "  Conflict Warnings:" -ForegroundColor Yellow
        foreach ($w in $plan.conflictWarnings) {
            Write-Host "    - $w" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Ok "Full proposal saved to: $proposalFile"

    if (-not $AutopilotPlan) {
        Write-HumanStop -Reason "Plan-first dry-run complete. Review proposed batch above." `
                        -NextAction "Re-run with -IssueLabel '$IssueLabel' -Repo $Repo -Execute to compile and launch, or adjust issues and re-plan."

        $cycleResult.finalStatus = "plan-proposed"
        $cycleResult.completedAt = ([DateTime]::UtcNow).ToString("o")
        Write-Host ""
        Write-Host "Cycle result: $($cycleResult.finalStatus)" -ForegroundColor Green
        exit 0
    } else {
        Write-Step "Autopilot plan mode 鈥?continuing through full pipeline (no human stop)"
        Add-StepResult -Name "plan-proposal" -Status "autopilot-continue" `
                       -Detail "Plan-first proposal captured, continuing autopilot pipeline"
        Write-Host ""
    }
}

# ---------------------------------------------------------------------------
# Validate inputs
# ---------------------------------------------------------------------------

$modeLabel = if ($DryRunFixture) { "FIXTURE-DRY-RUN" } elseif ($DryRunExecute) { "DRY-RUN-EXECUTE" } elseif ($AutopilotPlan) { "AUTOPILOT-PLAN" } elseif ($Execute) { "EXECUTE" } else { "DRY-RUN" }
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Self-Cycle Runner [$modeLabel]" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# STEP 0: Issue Discovery (when -IssueLabel is used instead of -TaskFile)
# ---------------------------------------------------------------------------

if ($IssueLabel) {
    Write-SectionHeader "STEP 0 鈥?Issue Discovery & Task Compilation"

    if (-not $Repo) {
        Write-Fail "Issue discovery requires -Repo or GH_REPO env var."
    }

    Write-Step "Discovering issues with label: $IssueLabel"

    try {
        $issueNumbers = & gh issue list --repo $Repo --label $IssueLabel --state open --json number,title --limit 50 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "gh issue list failed: $issueNumbers"
        }
        $issues = @($issueNumbers | ConvertFrom-Json)
    } catch {
        Write-Fail "Issue discovery failed: $_"
    }

    if ($issues.Count -eq 0) {
        Write-Warn "No open issues found with label '$IssueLabel'."
        Add-StepResult -Name "issue-discovery" -Status "empty" `
                       -Detail "No issues found with label '$IssueLabel'"
        $cycleResult.finalStatus = "completed"
        $cycleResult.completedAt = ([DateTime]::UtcNow).ToString("o")
        Write-Host ""
        Write-Host "Cycle result: $($cycleResult.finalStatus)" -ForegroundColor Green
        exit 0
    }

    Write-Ok "Found $($issues.Count) issue(s) with label '$IssueLabel'"
    Add-StepResult -Name "issue-discovery" -Status "pass" `
                   -Detail "Found $($issues.Count) issue(s)"

    # Build task JSON array from discovered issues.
    # Each issue gets a minimal task contract with conservative defaults.
    # The CONTROL APPENDIX from the issue body supplies metadata when available.
    Write-Step "Compiling issues to task contracts..."

    $compiledTasks = @()
    $compileErrors = @()

    foreach ($issueEntry in $issues) {
        $issueNum = $issueEntry.number
        Write-Step "  Compiling issue #${issueNum}: $($issueEntry.title)"

        # Fetch full issue body to extract CONTROL APPENDIX metadata
        try {
            $bodyJson = & gh issue view $issueNum --repo $Repo --json body 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "  Could not fetch body for #$issueNum 鈥?using defaults"
                $body = ""
            } else {
                $bodyData = $bodyJson | ConvertFrom-Json
                $body = $bodyData.body
            }
        } catch {
            Write-Warn "  Could not fetch body for #$issueNum 鈥?using defaults"
            $body = ""
        }

        # Parse CONTROL APPENDIX fields from body (best-effort)
        $taskType = "execution"
        $risk = "medium"
        $conflictGroup = "ai-auto"
        $allowedFiles = @()
        $forbiddenFiles = @()
        $validationCommands = @()
        $actorRole = "automation-cycle-worker"

        if ($body) {
            # Extract allowed files
            $allowedMatch = [regex]::Match($body, '(?s)Allowed files:\s*\n((?:- .+\n?)+)')
            if ($allowedMatch.Success) {
                $allowedFiles = ($allowedMatch.Groups[1].Value -split "`n") |
                    Where-Object { $_ -match '^- ' } |
                    ForEach-Object { $_ -replace '^- ', '' } |
                    Where-Object { $_ -ne '' }
            }

            # Extract forbidden files
            $forbiddenMatch = [regex]::Match($body, '(?s)Forbidden files:\s*\n((?:- .+\n?)+)')
            if ($forbiddenMatch.Success) {
                $forbiddenFiles = ($forbiddenMatch.Groups[1].Value -split "`n") |
                    Where-Object { $_ -match '^- ' } |
                    ForEach-Object { $_ -replace '^- ', '' } |
                    Where-Object { $_ -ne '' }
            }

            # Extract validation commands
            $valMatch = [regex]::Match($body, '(?s)Validation commands:\s*\n((?:- .+\n?)+)')
            if ($valMatch.Success) {
                $validationCommands = ($valMatch.Groups[1].Value -split "`n") |
                    Where-Object { $_ -match '^- ' } |
                    ForEach-Object { $_ -replace '^- ', '' } |
                    Where-Object { $_ -ne '' }
            }

            # Extract risk level
            $riskMatch = [regex]::Match($body, '(?im)^Risk:\s*(low|medium|high)')
            if ($riskMatch.Success) { $risk = $riskMatch.Groups[1].Value.ToLower() }

            # Extract conflict group
            $cgMatch = [regex]::Match($body, '(?im)^Conflict group:\s*(\S+)')
            if ($cgMatch.Success) { $conflictGroup = $cgMatch.Groups[1].Value }

            # Extract task type
            $ttMatch = [regex]::Match($body, '(?im)^Task type:\s*(execution|research|review)')
            if ($ttMatch.Success) { $taskType = $ttMatch.Groups[1].Value.ToLower() }

            # Extract actor role
            $roleMatch = [regex]::Match($body, '(?im)^Actor role:\s*(.+)')
            if ($roleMatch.Success) { $actorRole = $roleMatch.Groups[1].Value.Trim() }
        }

        # Apply defaults for missing required fields
        if ($allowedFiles.Count -eq 0) {
            $allowedFiles = @("docs/**")
        }
        if ($validationCommands.Count -eq 0) {
            $validationCommands = @("npm run check")
        }

        $task = [ordered]@{
            taskType           = $taskType
            risk               = $risk
            conflictGroup      = $conflictGroup
            targetIssue        = $issueNum
            targetPR           = $null
            issues             = @($issueNum)
            expectedPR         = $true
            allowedFiles       = @($allowedFiles)
            forbiddenFiles     = @($forbiddenFiles)
            validationCommands = @($validationCommands)
            rolePacket         = @{
                actorRole   = $actorRole
                description = "Auto-compiled from issue #$issueNum"
            }
        }
        $compiledTasks += $task
    }

    # Write compiled tasks to temp file
    $discoveredTaskFile = Join-Path ([System.IO.Path]::GetTempPath()) "self-cycle-discovered-tasks.json"
    $compiledTasks | ConvertTo-Json -Depth 10 | Set-Content $discoveredTaskFile -Encoding UTF8
    $TaskFile = $discoveredTaskFile

    # --- Max-task safety contract ---
    $taskCount = $compiledTasks.Count
    $warnThreshold = [Math]::Floor($MaxTasks * 0.8)

    if ($taskCount -gt $MaxTasks) {
        Write-Fail "Task count ($taskCount) exceeds -MaxTasks limit ($MaxTasks)."
        Write-Fail "Reduce the batch size or increase -MaxTasks (max 100)."
        Write-HumanStop -Reason "Too many tasks ($taskCount > $MaxTasks). Safety limit breached." `
                        -NextAction "Reduce issues in batch, or re-run with -MaxTasks $taskCount to override."
        Add-StepResult -Name "task-compilation" -Status "blocked" `
                       -Detail "Task count $taskCount exceeds -MaxTasks $MaxTasks" -HumanStop $true
        $cycleResult.finalStatus = "blocked-by-max-tasks"
        $cycleResult.completedAt = ([DateTime]::UtcNow).ToString("o")
        Write-Host ""
        Write-Host "Cycle result: $($cycleResult.finalStatus)" -ForegroundColor Red
        exit 1
    } elseif ($taskCount -ge $warnThreshold -and $taskCount -gt 1) {
        Write-Warn "Task count ($taskCount) approaching -MaxTasks limit ($MaxTasks)."
    }

    Write-Ok "Compiled $($compiledTasks.Count) task(s) to $TaskFile"
    Add-StepResult -Name "task-compilation" -Status "pass" `
                   -Detail "Compiled $($compiledTasks.Count) task(s) to temp file (max $MaxTasks)"

    # Dry-run: print compiled tasks, save to file, and stop for human review.
    # Autopilot plan mode: print compiled tasks but continue through pipeline.
    # Execute mode: continue through the full pipeline.
    if ($AutopilotPlan) {
        Write-Step "AUTOPILOT-PLAN: Compiled $($compiledTasks.Count) task(s), continuing through pipeline"
        Add-StepResult -Name "autopilot-discovery" -Status "pass" `
                       -Detail "$($compiledTasks.Count) task(s) compiled, pipeline continues"
    } elseif (-not $Execute) {
        Write-Step "DRY-RUN: Compiled task contracts saved to $TaskFile"
        Write-Host ""
        $compiledTasks | ConvertTo-Json -Depth 10 | Write-Host
        Write-Host ""
        Write-Ok "Task file ready for pipeline: $TaskFile"
        Write-HumanStop -Reason "Review compiled task contracts above. File saved for next run." `
                        -NextAction "Re-run with -TaskFile $TaskFile -Execute to proceed, or adjust issue metadata and re-discover."

        $cycleResult.finalStatus = "discovery-complete"
        $cycleResult.completedAt = ([DateTime]::UtcNow).ToString("o")
        Write-Host ""
        Write-Host "Cycle result: $($cycleResult.finalStatus)" -ForegroundColor Green
        exit 0
    }

    Write-Host ""
}

# Validate task file exists
if (-not (Test-Path $TaskFile)) {
    Write-Fail "Task file not found: $TaskFile"
    exit 2
}

Write-Step "Task file: $TaskFile"
Write-Step "Health file: $HealthFile"
Write-Step "Max tasks: $MaxTasks"
if ($Repo) { Write-Step "Repo: $Repo" }

# --- Max-task safety contract (TaskFile path) ---
$taskFileRaw = Get-Content -Path $TaskFile -Raw -Encoding UTF8
$taskFileJson = $taskFileRaw | ConvertFrom-Json
$taskFileCount = if ($taskFileJson -is [array]) { $taskFileJson.Count } else { 1 }
$warnThresholdTf = [Math]::Floor($MaxTasks * 0.8)

if ($taskFileCount -gt $MaxTasks) {
    Write-Fail "Task file contains $taskFileCount task(s), exceeding -MaxTasks limit ($MaxTasks)."
    Write-Fail "Reduce the task count or increase -MaxTasks (max 100)."
    Write-HumanStop -Reason "Too many tasks ($taskFileCount > $MaxTasks). Safety limit breached." `
                    -NextAction "Split the task file, or re-run with -MaxTasks $taskFileCount to override."
    Add-StepResult -Name "task-count-check" -Status "blocked" `
                   -Detail "Task count $taskFileCount exceeds -MaxTasks $MaxTasks" -HumanStop $true
    $cycleResult.finalStatus = "blocked-by-max-tasks"
    $cycleResult.completedAt = ([DateTime]::UtcNow).ToString("o")
    Write-Host ""
    Write-Host "Cycle result: $($cycleResult.finalStatus)" -ForegroundColor Red
    exit 1
} elseif ($taskFileCount -ge $warnThresholdTf -and $taskFileCount -gt 1) {
    Write-Warn "Task count ($taskFileCount) approaching -MaxTasks limit ($MaxTasks)."
}

Write-Step "Task count: $taskFileCount (max $MaxTasks)"
Write-Host ""

# ===========================================================================
# STEP 1: State Reconciler
# ===========================================================================

Write-SectionHeader "STEP 1 鈥?State Reconciler"

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
                               -Detail "Exit code $reconcileExit 鈥?review drift report above"
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

Write-SectionHeader "STEP 2 鈥?Main Health State"

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
        Write-Warn "Could not parse $HealthFile 鈥?assuming red (fail-safe)"
        $mainHealthState = "red"
        Add-StepResult -Name "health" -Status "warning" -Detail "Parse error, assumed red"
    }
} else {
    Write-Warn "No health marker at $HealthFile 鈥?assuming green"
    Add-StepResult -Name "health" -Status "default" -Detail "No marker file, assumed green"
}

# Human stop for red/black states
if ($mainHealthState -eq "red" -or $mainHealthState -eq "black") {
    if ($AutopilotPlan) {
        Write-Warn "AUTOPILOT-PLAN: Main health is $mainHealthState 鈥?pipeline would be blocked."
        Add-StepResult -Name "health-gate" -Status "blocked" `
                       -Detail "Main is $mainHealthState (autopilot: recorded, not exited)"
    } else {
        Write-HumanStop -Reason "Main health is $mainHealthState. Automated launches are blocked." `
                        -NextAction "Fix main health before running the self-cycle. Check post-merge-health-gate."
        Add-StepResult -Name "health-gate" -Status "blocked" `
                       -Detail "Main is $mainHealthState" -HumanStop $true

        # Exit early 鈥?no point checking launch gate
        $cycleResult.finalStatus = "blocked-by-health"
        $cycleResult.completedAt = ([DateTime]::UtcNow).ToString("o")
        Write-Host ""
        Write-Host "Cycle result: $($cycleResult.finalStatus)" -ForegroundColor Red
        exit 1
    }
}

# ===========================================================================
# STEP 2.5: Provider Pool Preflight
# ===========================================================================

Write-SectionHeader "STEP 2.5 鈥?Provider Pool Preflight"

$PROVIDER_STATE  = "./.github/ai-state/provider-pool.json"
$PROVIDER_POLICY = "./.github/ai-policy/provider-pool-policy.json"

# Override paths when running from a fixture directory
if ($DryRunFixture) {
    $fixtureProviderState  = Join-Path $DryRunFixture "provider-pool.json"
    $fixtureProviderPolicy = Join-Path $DryRunFixture "provider-pool-policy.json"
    if (Test-Path $fixtureProviderState)  { $PROVIDER_STATE  = $fixtureProviderState }
    if (Test-Path $fixtureProviderPolicy) { $PROVIDER_POLICY = $fixtureProviderPolicy }
}

$providerPreflightPassed = $true

if (-not (Test-Path $PROVIDER_STATE)) {
    Write-Warn "No provider pool state at $PROVIDER_STATE 鈥?skipping preflight (no providers registered)"
    Add-StepResult -Name "provider-pool-preflight" -Status "skipped" `
                   -Detail "No provider-pool.json found"
} else {
    try {
        $poolRaw = Get-Content -Path $PROVIDER_STATE -Raw -Encoding UTF8
        $pool = $poolRaw | ConvertFrom-Json

        # Read policy for launch gate integration flags (defaults to block)
        $blockAllExhausted = $true
        $blockAtCapacity   = $true
        if (Test-Path $PROVIDER_POLICY) {
            try {
                $policyRaw = Get-Content -Path $PROVIDER_POLICY -Raw -Encoding UTF8
                $policy = $policyRaw | ConvertFrom-Json
                if ($null -ne $policy.launchGateIntegration.blockWhenAllExhausted) {
                    $blockAllExhausted = $policy.launchGateIntegration.blockWhenAllExhausted
                }
                if ($null -ne $policy.launchGateIntegration.blockWhenAtCapacity) {
                    $blockAtCapacity = $policy.launchGateIntegration.blockWhenAtCapacity
                }
            } catch {
                Write-Warn "Could not parse $PROVIDER_POLICY 鈥?using default block rules"
            }
        }

        $availableCount  = 0
        $exhaustedCount  = 0
        $disabledCount   = 0
        $atCapacityCount = 0

        foreach ($p in $pool.providers) {
            $isAtCapacity = ($p.currentConcurrency -ge $p.maxConcurrency)
            switch ($p.status) {
                "available" {
                    if ($isAtCapacity) {
                        $atCapacityCount++
                        Write-Warn "  $($p.id): available but at capacity ($($p.currentConcurrency)/$($p.maxConcurrency))"
                    } else {
                        $availableCount++
                        Write-Ok "  $($p.id): available ($($p.currentConcurrency)/$($p.maxConcurrency))"
                    }
                }
                "exhausted" {
                    $exhaustedCount++
                    $cooldownNote = if ($p.cooldownExpiresAt) { " (cooldown: $($p.cooldownExpiresAt))" } else { "" }
                    Write-Warn "  $($p.id): exhausted$cooldownNote"
                }
                "disabled" {
                    $disabledCount++
                    Write-Fail "  $($p.id): disabled (requires manual fix)"
                }
                default {
                    Write-Warn "  $($p.id): unknown status '$($p.status)'"
                }
            }
        }

        $totalProviders = $pool.providers.Count
        Write-Step "Pool summary: $availableCount available, $exhaustedCount exhausted, $disabledCount disabled, $atCapacityCount at-capacity (of $totalProviders)"

        # Block if all providers exhausted/disabled and policy says block
        if ($blockAllExhausted -and $availableCount -eq 0 -and $atCapacityCount -eq 0) {
            if ($AutopilotPlan) {
                Write-Warn "AUTOPILOT-PLAN: All providers exhausted or disabled 鈥?pipeline would be blocked."
                Add-StepResult -Name "provider-pool-preflight" -Status "blocked" `
                               -Detail "All $totalProviders provider(s) unavailable ($exhaustedCount exhausted, $disabledCount disabled) (autopilot: recorded, not exited)"
            } else {
                Write-HumanStop -Reason "All providers exhausted or disabled ($exhaustedCount exhausted, $disabledCount disabled). No capacity for new workers." `
                                -NextAction "Wait for cooldown to expire, fix disabled providers, or add a new provider to the pool."
                Add-StepResult -Name "provider-pool-preflight" -Status "blocked" `
                               -Detail "All $totalProviders provider(s) unavailable ($exhaustedCount exhausted, $disabledCount disabled)" -HumanStop $true
                $providerPreflightPassed = $false
            }
        }
        # Block if all providers at capacity and policy says block
        elseif ($blockAtCapacity -and $availableCount -eq 0 -and $atCapacityCount -gt 0 -and $exhaustedCount -eq 0 -and $disabledCount -eq 0) {
            if ($AutopilotPlan) {
                Write-Warn "AUTOPILOT-PLAN: All available providers at max concurrency 鈥?pipeline would be blocked."
                Add-StepResult -Name "provider-pool-preflight" -Status "blocked" `
                               -Detail "All $totalProviders provider(s) at capacity (autopilot: recorded, not exited)"
            } else {
                Write-HumanStop -Reason "All available providers at max concurrency ($atCapacityCount at-capacity). No room for additional workers." `
                                -NextAction "Wait for active workers to finish or increase provider concurrency limits."
                Add-StepResult -Name "provider-pool-preflight" -Status "blocked" `
                               -Detail "All $totalProviders provider(s) at capacity" -HumanStop $true
                $providerPreflightPassed = $false
            }
        }
        else {
            Write-Ok "Provider pool preflight PASSED 鈥?$availableCount provider(s) available"
            Add-StepResult -Name "provider-pool-preflight" -Status "pass" `
                           -Detail "$availableCount available, $exhaustedCount exhausted, $disabledCount disabled"
        }
    } catch {
        Write-Warn "Could not parse $PROVIDER_STATE 鈥?preflight skipped"
        Add-StepResult -Name "provider-pool-preflight" -Status "warning" -Detail "Parse error: $_"
    }
}

if (-not $providerPreflightPassed -and -not $AutopilotPlan) {
    $cycleResult.finalStatus = "blocked-by-provider-pool"
    $cycleResult.completedAt = ([DateTime]::UtcNow).ToString("o")
    Write-Host ""
    Write-Host "Cycle result: $($cycleResult.finalStatus)" -ForegroundColor Red
    exit 1
}

# ===========================================================================
# STEP 3: Launch Gate
# ===========================================================================

Write-SectionHeader "STEP 3 鈥?Launch Gate"

Write-Step "Running launch gate check against task file..."

try {
    $gateArgs = @("-TaskFile", $TaskFile, "-HealthFile", $HealthFile)
    if ($ResourceFile) {
        $gateArgs += "-ResourceFile"
        $gateArgs += $ResourceFile
    }
    $gateOutput = & pwsh -NoProfile -File $LAUNCH_GATE @gateArgs 2>&1
    $gateExit = $LASTEXITCODE

    Write-Host $gateOutput

    if ($gateExit -eq 0) {
        Write-Ok "Launch gate PASSED 鈥?all tasks cleared"
        Add-StepResult -Name "launch-gate" -Status "pass"
    } else {
        Write-Fail "Launch gate FAILED 鈥?one or more tasks blocked"
        if ($AutopilotPlan) {
            Write-Warn "AUTOPILOT-PLAN: Launch gate would block task(s). See report above."
            Add-StepResult -Name "launch-gate" -Status "blocked" `
                           -Detail "Gate check failed (autopilot: recorded, not exited)"
        } else {
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

Write-SectionHeader "STEP 4 鈥?Batch Launch"

if ($AutopilotPlan) {
    Write-Step "AUTOPILOT-PLAN mode 鈥?generating launch plan (dry-run)"

    try {
        & pwsh -NoProfile -File $BATCH_LAUNCH -TaskFile $TaskFile -DryRun
        $launchExit = $LASTEXITCODE

        if ($launchExit -eq 0) {
            Write-Ok "Autopilot plan: launch plan generated"
            Add-StepResult -Name "batch-launch" -Status "autopilot-plan-pass" `
                           -Detail "Launch plan generated (dry-run). To execute: re-run with -TaskFile $TaskFile -Execute"
        } else {
            Write-Warn "Batch launch dry-run exited with code $launchExit"
            Add-StepResult -Name "batch-launch" -Status "warning" `
                           -Detail "Exit code $launchExit"
        }
    } catch {
        Write-Fail "Batch launch failed: $_"
        Add-StepResult -Name "batch-launch" -Status "error" -Detail "$_"
    }
} elseif ($Execute) {
    Write-Step "EXECUTE mode 鈥?dispatching tasks by risk level"

    # Load task file to partition by risk level
    $taskContent = Get-Content -Path $TaskFile -Raw -Encoding UTF8
    $taskData = $taskContent | ConvertFrom-Json
    $taskArray = if ($taskData -is [array]) { @($taskData) } else { @($taskData) }

    $dispatchableTasks = @()
    $pendingTasks = @()

    foreach ($t in $taskArray) {
        if ($t.risk -in @("low", "medium")) {
            $dispatchableTasks += $t
        } else {
            $pendingTasks += $t
        }
    }

    # Record high-risk tasks as pending facts (do not block cycle)
    foreach ($t in $pendingTasks) {
        Write-Warn "Task #$($t.targetIssue): risk=$($t.risk) 鈥?recorded as pending (requires human gate)"
        Add-StepResult -Name "pending-gate-#$($t.targetIssue)" -Status "pending" `
                       -Detail "Risk $($t.risk) requires human approval"
    }

    # Dispatch low/medium risk tasks through batch-launch
    if ($dispatchableTasks.Count -gt 0) {
        Write-Step "Dispatching $($dispatchableTasks.Count) low/medium risk task(s) via batch-launch"

        $dispatchTaskFile = Join-Path ([System.IO.Path]::GetTempPath()) "self-cycle-dispatch-tasks.json"
        $dispatchableTasks | ConvertTo-Json -Depth 10 | Set-Content $dispatchTaskFile -Encoding UTF8

        try {
            if ($DryRunExecuteFlag) {
                & pwsh -NoProfile -File $BATCH_LAUNCH -TaskFile $dispatchTaskFile -DryRun
            } else {
                & pwsh -NoProfile -File $BATCH_LAUNCH -TaskFile $dispatchTaskFile -Execute
            }
            $launchExit = $LASTEXITCODE

            if ($launchExit -eq 0) {
                Write-Ok "Batch launch dispatched $($dispatchableTasks.Count) task(s)"
                Add-StepResult -Name "batch-launch" -Status "dispatched" `
                               -Detail "$($dispatchableTasks.Count) task(s) dispatched"
            } else {
                Write-Warn "Batch launch exited with code $launchExit"
                Add-StepResult -Name "batch-launch" -Status "warning" `
                               -Detail "Exit code $launchExit"
            }
        } catch {
            Write-Fail "Batch launch failed: $_"
            Add-StepResult -Name "batch-launch" -Status "error" -Detail "$_"
        } finally {
            Remove-Item $dispatchTaskFile -ErrorAction SilentlyContinue
        }
    } else {
        Write-Warn "No low/medium risk tasks to dispatch"
        Add-StepResult -Name "batch-launch" -Status "skipped" `
                       -Detail "No low/medium risk tasks to dispatch"
    }
} else {
    Write-Step "DRY-RUN mode 鈥?printing launch plan"

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

Write-SectionHeader "STEP 5 鈥?Cycle Summary"

$cycleResult.completedAt = ([DateTime]::UtcNow).ToString("o")

# Determine final status
$blockedSteps = @($cycleResult.steps | Where-Object { $_.humanStop })
$failedSteps  = @($cycleResult.steps | Where-Object { $_.status -in @("error", "blocked") })
$warnSteps    = @($cycleResult.steps | Where-Object { $_.status -eq "warning" })
$pendingSteps = @($cycleResult.steps | Where-Object { $_.status -eq "pending" })

if ($AutopilotPlan) {
    if ($failedSteps.Count -gt 0) {
        $cycleResult.finalStatus = "autopilot-plan-blocked"
    } elseif ($warnSteps.Count -gt 0) {
        $cycleResult.finalStatus = "autopilot-plan-warnings"
    } else {
        $cycleResult.finalStatus = "autopilot-plan-ready"
    }
} elseif ($failedSteps.Count -gt 0) {
    $cycleResult.finalStatus = "blocked"
} elseif ($blockedSteps.Count -gt 0) {
    $cycleResult.finalStatus = "human-stop"
} elseif ($pendingSteps.Count -gt 0) {
    $cycleResult.finalStatus = "completed-with-pending"
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
        "pass"              { "Green" }
        "dry-run-pass"      { "Green" }
        "autopilot-plan-pass" { "Green" }
        "autopilot-continue" { "Cyan" }
        "read"              { "Green" }
        "dispatched"        { "Green" }
        "default"           { "Yellow" }
        "warning"           { "Yellow" }
        "skipped"           { "DarkGray" }
        "pending"           { "Yellow" }
        "blocked"           { "Red" }
        "error"             { "Red" }
        "human-gate"        { "Magenta" }
        default             { "White" }
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
    "completed-with-pending"   { "Yellow" }
    "human-stop"               { "Magenta" }
    "blocked"                  { "Red" }
    "blocked-by-health"        { "Red" }
    "blocked-by-gate"          { "Red" }
    "blocked-by-max-tasks"     { "Red" }
    "blocked-by-provider-pool" { "Red" }
    "discovery-complete"       { "Green" }
    "autopilot-plan-ready"     { "Green" }
    "autopilot-plan-warnings"  { "Yellow" }
    "autopilot-plan-blocked"   { "Red" }
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
    "completed-with-pending" {
        Write-Host "Next: High-risk tasks recorded as pending. Review and approve manually before re-running." -ForegroundColor Yellow
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
    "blocked-by-max-tasks" {
        Write-Host "Next: Reduce batch size or increase -MaxTasks to proceed." -ForegroundColor Red
    }
    "blocked-by-provider-pool" {
        Write-Host "Next: Wait for provider cooldown, fix disabled providers, or add capacity." -ForegroundColor Red
    }
    "discovery-complete" {
        Write-Host "Next: Review compiled task contracts. Re-run with -TaskFile <file> -Execute to proceed through the pipeline." -ForegroundColor Green
    }
    "autopilot-plan-ready" {
        Write-Host "Next: All steps passed. Re-run with -TaskFile $TaskFile -Execute to launch workers." -ForegroundColor Green
    }
    "autopilot-plan-warnings" {
        Write-Host "Next: Review warnings above. Re-run with -TaskFile $TaskFile -Execute to launch workers." -ForegroundColor Yellow
    }
    "autopilot-plan-blocked" {
        Write-Host "Next: Fix blocked steps above before launching. Re-run autopilot plan after fixes." -ForegroundColor Red
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
$mdLines += "**Max tasks:** $MaxTasks"
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

# ---------------------------------------------------------------------------
# Autopilot Plan Summary: show what would happen if -Execute were passed
# ---------------------------------------------------------------------------

if ($AutopilotPlan) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  AUTOPILOT PLAN SUMMARY" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host ""

    $allPassed = ($cycleResult.finalStatus -eq "autopilot-plan-ready")
    $hasBlocked = @($cycleResult.steps | Where-Object { $_.status -eq "blocked" }).Count -gt 0

    if ($allPassed) {
        Write-Host "  Status: ALL CHECKS PASSED" -ForegroundColor Green
        Write-Host ""
        Write-Host "  If you run with -Execute, the following would happen:" -ForegroundColor White
        Write-Host "    1. Task contracts would be compiled from discovered issues" -ForegroundColor Gray
        Write-Host "    2. State reconciliation would run" -ForegroundColor Gray
        Write-Host "    3. Health gate would be checked" -ForegroundColor Gray
        Write-Host "    4. Provider pool preflight would run" -ForegroundColor Gray
        Write-Host "    5. Launch gate would validate tasks" -ForegroundColor Gray
        Write-Host "    6. Workers would be dispatched via batch-launch.ps1" -ForegroundColor Gray
        Write-Host ""
        Write-Host "  To execute:" -ForegroundColor White
        Write-Host "    ./scripts/ai/run-self-cycle.ps1 -TaskFile $TaskFile -Execute" -ForegroundColor Yellow
    } elseif ($hasBlocked) {
        Write-Host "  Status: BLOCKED 鈥?fix issues before executing" -ForegroundColor Red
        Write-Host ""
        Write-Host "  Blocked steps prevent worker launch. Review the step table above." -ForegroundColor White
        Write-Host "  Re-run autopilot plan after fixes to verify all checks pass." -ForegroundColor White
    } else {
        Write-Host "  Status: COMPLETED WITH WARNINGS" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Review warnings above. If acceptable, run with -Execute:" -ForegroundColor White
        Write-Host "    ./scripts/ai/run-self-cycle.ps1 -TaskFile $TaskFile -Execute" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host ""
}

exit 0

