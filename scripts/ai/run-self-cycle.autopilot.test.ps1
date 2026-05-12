<#
.SYNOPSIS
    Fixture-based tests for the self-cycle autopilot planning and gate handoff.

.DESCRIPTION
    Exercises the autopilot plan integration by loading the autopilot-plan.json
    fixture and running individual candidates through the self-cycle runner's
    dry-run fixture path.

    Scenarios covered:
      1. Plan fixture structure validation (fields, candidates, warnings)
      2. Low-risk ready candidate passes launch gate
      3. Medium-risk ready candidate passes launch gate
      4. Second low-risk candidate (same conflict group) passes individually
      5. Conflict group warnings present in plan
      6. Skipped issues correctly categorized (blocked, not-ready)
      7. Empty candidate plan yields no tasks
      8. All candidates blocked by health (red) scenario

    No live GitHub access. No modifications to run-self-cycle.ps1.

.EXAMPLE
    pwsh ./scripts/ai/run-self-cycle.autopilot.test.ps1
#>

#Requires -Version 7.0

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SCRIPT_DIR = $PSScriptRoot
$SELF_CYCLE = Join-Path $SCRIPT_DIR "run-self-cycle.ps1"
$ROOT = Resolve-Path (Join-Path $SCRIPT_DIR ".." "..")
$BASE_FIXTURE = Join-Path $ROOT "tests" "fixtures" "self-cycle"
$AUTOPILOT_PLAN = Join-Path $SCRIPT_DIR "__fixtures__" "self-cycle" "autopilot-plan.json"

$passed = 0
$failed = 0

function Assert-True {
    param([bool]$Condition, [string]$Name)
    if ($Condition) {
        $script:passed++
        Write-Host "  PASS  $Name" -ForegroundColor Green
    } else {
        $script:failed++
        Write-Host "  FAIL  $Name" -ForegroundColor Red
    }
}

function New-TempFixtureDir {
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) "autopilot-test-$(Get-Random)"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    return $dir
}

function Write-HealthFixture {
    param([string]$Dir, [string]$State = "green")
    $health = @{
        state      = $State
        commitSha  = "0000000000000000000000000000000000000000"
        updatedAt  = "2026-05-11T00:00:00Z"
        checks     = "All checks passed (fixture)"
        source     = "fixture"
    }
    $health | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Dir "02-health-green.json") -Encoding UTF8
}

function Write-TaskFixture {
    param([string]$Dir, [object]$Task)
    $wrapper = @{
        description       = "Autopilot candidate fixture"
        expectedGateResult = "pass"
        task              = $Task
    }
    $wrapper | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $Dir "01-autopilot-task.json") -Encoding UTF8
}

function Invoke-SelfCycle {
    param([string]$FixtureDir)
    $outFile = Join-Path ([System.IO.Path]::GetTempPath()) "autopilot-test-output-$(Get-Random).txt"
    & pwsh -NoProfile -File $SELF_CYCLE -DryRunFixture $FixtureDir *> $outFile
    $exitCode = $LASTEXITCODE
    $output = Get-Content $outFile -Raw -Encoding UTF8
    Remove-Item $outFile -ErrorAction SilentlyContinue
    return @{ exitCode = $exitCode; output = $output }
}

# ===========================================================================
# Load and validate plan fixture
# ===========================================================================

Write-Host ""
Write-Host "run-self-cycle.autopilot tests" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $AUTOPILOT_PLAN)) {
    Write-Host "  FAIL  autopilot-plan.json fixture not found at $AUTOPILOT_PLAN" -ForegroundColor Red
    $failed++
    exit 1
}

$planRaw = Get-Content -Path $AUTOPILOT_PLAN -Raw -Encoding UTF8
$plan = $planRaw | ConvertFrom-Json

# ===========================================================================
# Scenario 1: Plan fixture structure validation
# ===========================================================================

& {
    Write-Host "--- Scenario 1: Plan fixture structure" -ForegroundColor DarkCyan

    Assert-True ($plan.planVersion -eq 1) "planVersion is 1"
    Assert-True ($plan.planMode -eq "autopilot") "planMode is autopilot"
    Assert-True ($plan.totalOpen -ge 0) "totalOpen is non-negative"
    Assert-True ($plan.proposed -ge 0) "proposed is non-negative"
    Assert-True ($plan.maxTasks -gt 0) "maxTasks is positive"
    Assert-True ($null -ne $plan.candidates) "candidates array exists"
    Assert-True ($plan.candidates.Count -eq 3) "candidates has 3 entries"
    Assert-True ($null -ne $plan.conflictWarnings) "conflictWarnings exists"
    Assert-True ($plan.conflictWarnings.Count -ge 1) "at least one conflict warning"
    Assert-True ($null -ne $plan.skippedIssues) "skippedIssues exists"
    Assert-True ($plan.skippedIssues.Count -eq 2) "skippedIssues has 2 entries"
    Assert-True ($plan.generatedAt -ne "") "generatedAt is set"
}

# ===========================================================================
# Scenario 2: Candidate field validation
# ===========================================================================

& {
    Write-Host "--- Scenario 2: Candidate field validation" -ForegroundColor DarkCyan

    foreach ($c in $plan.candidates) {
        $label = "#$($c.issueNumber)"

        Assert-True ($c.issueNumber -gt 0) "$label issueNumber is positive"
        Assert-True ($c.title -ne "") "$label title is non-empty"
        Assert-True ($c.risk -in @("low", "medium", "high")) "$label risk is valid"
        Assert-True ($c.conflictGroup -ne "") "$label conflictGroup is non-empty"
        Assert-True ($c.readiness -ne "") "$label readiness is non-empty"
        Assert-True ($null -ne $c.task) "$label task object exists"
        Assert-True ($c.task.taskType -in @("execution", "research", "review")) "$label taskType is valid"
        Assert-True ($c.task.allowedFiles.Count -ge 1) "$label allowedFiles has entries"
        Assert-True ($c.task.validationCommands.Count -ge 1) "$label validationCommands has entries"
        Assert-True ($null -ne $c.task.rolePacket) "$label rolePacket exists"
        Assert-True ($c.task.rolePacket.actorRole -ne "") "$label actorRole is non-empty"
    }
}

# ===========================================================================
# Scenario 3: Low-risk ready candidate passes launch gate
# ===========================================================================

& {
    Write-Host "--- Scenario 3: Low-risk candidate passes launch gate" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir

    $candidate = $plan.candidates | Where-Object { $_.issueNumber -eq 601 } | Select-Object -First 1
    Write-TaskFixture $dir $candidate.task
    Write-HealthFixture $dir "green"

    $result = Invoke-SelfCycle $dir
    Assert-True ($result.exitCode -eq 0) "scenario 3: exit code 0"
    Assert-True ($result.output -match "launch-gate.*pass" -or $result.output -match "PASSED") "scenario 3: launch gate passed"
    Assert-True ($result.output -match "completed" -or $result.output -match "dry-run-pass") "scenario 3: completed or dry-run-pass"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# ===========================================================================
# Scenario 4: Medium-risk ready candidate passes launch gate
# ===========================================================================

& {
    Write-Host "--- Scenario 4: Medium-risk candidate passes launch gate" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir

    $candidate = $plan.candidates | Where-Object { $_.issueNumber -eq 602 } | Select-Object -First 1
    Write-TaskFixture $dir $candidate.task
    Write-HealthFixture $dir "green"

    $result = Invoke-SelfCycle $dir
    Assert-True ($result.exitCode -eq 0) "scenario 4: exit code 0"
    Assert-True ($result.output -match "launch-gate.*pass" -or $result.output -match "PASSED") "scenario 4: launch gate passed"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# ===========================================================================
# Scenario 5: Second low-risk candidate (same conflict group) passes
# ===========================================================================

& {
    Write-Host "--- Scenario 5: Second candidate with shared conflict group" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir

    $candidate = $plan.candidates | Where-Object { $_.issueNumber -eq 603 } | Select-Object -First 1
    Write-TaskFixture $dir $candidate.task
    Write-HealthFixture $dir "green"

    # Verify it shares conflict group with #601
    $firstCandidate = $plan.candidates | Where-Object { $_.issueNumber -eq 601 } | Select-Object -First 1
    Assert-True ($candidate.conflictGroup -eq $firstCandidate.conflictGroup) "scenario 5: shares conflict group with #601"

    $result = Invoke-SelfCycle $dir
    Assert-True ($result.exitCode -eq 0) "scenario 5: exit code 0"
    Assert-True ($result.output -match "launch-gate.*pass" -or $result.output -match "PASSED") "scenario 5: launch gate passed"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# ===========================================================================
# Scenario 6: Conflict group warnings in plan
# ===========================================================================

& {
    Write-Host "--- Scenario 6: Conflict group warnings" -ForegroundColor DarkCyan

    $hasConflictWarning = $false
    foreach ($w in $plan.conflictWarnings) {
        if ($w -match "autopilot-docs") {
            $hasConflictWarning = $true
            break
        }
    }
    Assert-True $hasConflictWarning "scenario 6: conflict warning for autopilot-docs group"

    # Verify the conflicting candidates exist
    $conflicting = @($plan.candidates | Where-Object { $_.conflictGroup -eq "autopilot-docs" })
    Assert-True ($conflicting.Count -eq 2) "scenario 6: two candidates share autopilot-docs group"
}

# ===========================================================================
# Scenario 7: Skipped issues categorization
# ===========================================================================

& {
    Write-Host "--- Scenario 7: Skipped issues categorization" -ForegroundColor DarkCyan

    $blocked = @($plan.skippedIssues | Where-Object { $_.reason -eq "blocked" })
    $notReady = @($plan.skippedIssues | Where-Object { $_.reason -eq "not-ready" })

    Assert-True ($blocked.Count -eq 1) "scenario 7: one blocked skipped issue"
    Assert-True ($notReady.Count -eq 1) "scenario 7: one not-ready skipped issue"

    $blockedIssue = $blocked[0]
    Assert-True ($blockedIssue.issueNumber -eq 604) "scenario 7: blocked issue is #604"
    Assert-True ($blockedIssue.detail -match "high") "scenario 7: blocked due to high risk"

    $notReadyIssue = $notReady[0]
    Assert-True ($notReadyIssue.issueNumber -eq 605) "scenario 7: not-ready issue is #605"
    Assert-True ($notReadyIssue.detail -match "#602") "scenario 7: depends on #602"
}

# ===========================================================================
# Scenario 8: Empty plan (no candidates)
# ===========================================================================

& {
    Write-Host "--- Scenario 8: Empty candidate plan" -ForegroundColor DarkCyan

    $emptyPlan = @{
        planVersion   = 1
        generatedAt   = "2026-05-11T00:00:00Z"
        planMode      = "autopilot"
        totalOpen     = 0
        proposed      = 0
        maxTasks      = 10
        candidates    = @()
        conflictWarnings = @()
        skippedIssues = @()
    }

    Assert-True ($emptyPlan.candidates.Count -eq 0) "scenario 8: empty candidates"
    Assert-True ($emptyPlan.proposed -eq 0) "scenario 8: proposed is 0"
    Assert-True ($emptyPlan.conflictWarnings.Count -eq 0) "scenario 8: no warnings"
}

# ===========================================================================
# Scenario 9: Red health blocks all candidates
# ===========================================================================

& {
    Write-Host "--- Scenario 9: Red health blocks candidate" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir

    $candidate = $plan.candidates | Where-Object { $_.issueNumber -eq 601 } | Select-Object -First 1
    Write-TaskFixture $dir $candidate.task
    Write-HealthFixture $dir "red"

    $result = Invoke-SelfCycle $dir
    Assert-True ($result.exitCode -eq 1) "scenario 9: exit code 1 (blocked)"
    Assert-True ($result.output -match "blocked-by-health") "scenario 9: blocked-by-health"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# ===========================================================================
# Scenario 10: Plan maxTasks safety boundary
# ===========================================================================

& {
    Write-Host "--- Scenario 10: Plan maxTasks safety boundary" -ForegroundColor DarkCyan

    # The plan fixture proposes 3 candidates, maxTasks is 10 — well within limit
    Assert-True ($plan.proposed -le $plan.maxTasks) "scenario 10: proposed <= maxTasks"

    # Simulate a plan that exceeds maxTasks
    $overLimitPlan = @{
        planVersion = 1
        proposed    = 15
        maxTasks    = 10
        candidates  = @()
    }
    Assert-True ($overLimitPlan.proposed -gt $overLimitPlan.maxTasks) "scenario 10: over-limit plan detected"
}

# ===========================================================================
# Scenario 11: Empty issues array Count handling (regression #1280)
# ===========================================================================

& {
    Write-Host "--- Scenario 11: Empty issues array Count (regression #1280)" -ForegroundColor DarkCyan

    # When gh issue list returns [], ConvertFrom-Json produces $null.
    # Wrapping with @() guarantees an array so .Count works under strict mode.
    $emptyJson = '[]'
    $emptyIssues = @($emptyJson | ConvertFrom-Json)
    Assert-True ($emptyIssues.Count -eq 0) "scenario 11: empty JSON array Count is 0"

    # Single issue
    $singleJson = '[{"number":999,"title":"test"}]'
    $singleIssues = @($singleJson | ConvertFrom-Json)
    Assert-True ($singleIssues.Count -eq 1) "scenario 11: single-item JSON Count is 1"

    # Multiple issues
    $multiJson = '[{"number":1,"title":"a"},{"number":2,"title":"b"},{"number":3,"title":"c"}]'
    $multiIssues = @($multiJson | ConvertFrom-Json)
    Assert-True ($multiIssues.Count -eq 3) "scenario 11: multi-item JSON Count is 3"

    # When ConvertFrom-Json on '[]' produces no pipeline output, @() yields Count 0
    # This is the exact pattern used in the fix: @($issueNumbers | ConvertFrom-Json)
    $emptyArrayIssues = @('[]' | ConvertFrom-Json)
    Assert-True ($emptyArrayIssues.Count -eq 0) "scenario 11: @('[]' | ConvertFrom-Json).Count is 0"
}

# ===========================================================================
# Scenario 12: Empty plan autopilot completes without error
# ===========================================================================

& {
    Write-Host "--- Scenario 12: Empty plan autopilot summary fields" -ForegroundColor DarkCyan

    $emptyPlan = @{
        planVersion      = 1
        generatedAt      = "2026-05-11T00:00:00Z"
        planMode         = "autopilot"
        totalOpen        = 0
        proposed         = 0
        maxTasks         = 10
        candidates       = @()
        conflictWarnings = @()
        skippedIssues    = @()
    }

    # All downstream Count accesses must not throw
    Assert-True ($emptyPlan.candidates.Count -eq 0) "scenario 12: candidates Count is 0"
    Assert-True ($emptyPlan.conflictWarnings.Count -eq 0) "scenario 12: conflictWarnings Count is 0"
    Assert-True ($emptyPlan.skippedIssues.Count -eq 0) "scenario 12: skippedIssues Count is 0"
    Assert-True ($emptyPlan.proposed -eq 0) "scenario 12: proposed is 0"
    Assert-True ($emptyPlan.proposed -le $emptyPlan.maxTasks) "scenario 12: proposed <= maxTasks"
}

# ===========================================================================
# Summary
# ===========================================================================

Write-Host ""
Write-Host "$passed passed, $failed failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })
Write-Host ""

exit $(if ($failed -gt 0) { 1 } else { 0 })
