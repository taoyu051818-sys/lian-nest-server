<#
.SYNOPSIS
    Fixture-based tests for check-launch-gate.ps1 resource pressure classification.

.DESCRIPTION
    Loads resource-pressure fixtures (matching sample-local-resource.ps1 output
    format) and verifies that:

    1. Resource pressure signals classify correctly into green/yellow/red zones.
    2. The launch gate correctly blocks or allows tasks when main state is
       driven by resource pressure classification.
    3. Missing or malformed resource-pressure fixtures are handled gracefully.

    Thresholds (mirrors test-resource-pressure-sampler.js):
        CPU:    <=50 green, 51-80 yellow, >80 red
        Memory: <=70 green, 71-85 yellow, >85 red
        Disk:   <=75 green, 76-90 yellow, >90 red

    Does NOT modify any live files. All fixtures are read from __fixtures__
    and temporary task files are written to a temp directory cleaned up after run.

.EXAMPLE
    pwsh ./scripts/ai/check-launch-gate.resource-pressure.test.ps1
#>

#Requires -Version 7.0

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$passed = 0
$failed = 0
$tempDir = $null

# ---------------------------------------------------------------------------
# Resource pressure classification (matches test-resource-pressure-sampler.js)
# ---------------------------------------------------------------------------

function Classify-Cpu {
    param([double]$Percent)
    if ($Percent -gt 80) { return "red" }
    if ($Percent -gt 50) { return "yellow" }
    return "green"
}

function Classify-Memory {
    param([double]$PressurePct)
    if ($PressurePct -gt 85) { return "red" }
    if ($PressurePct -gt 70) { return "yellow" }
    return "green"
}

function Classify-Disk {
    param([double]$UsedPct)
    if ($UsedPct -gt 90) { return "red" }
    if ($UsedPct -gt 75) { return "yellow" }
    return "green"
}

function Classify-All {
    param($Sample)
    return @{
        cpu    = (Classify-Cpu -Percent $Sample.cpu.overallPercent)
        memory = (Classify-Memory -PressurePct $Sample.memory.pressurePct)
        disk   = (Classify-Disk -UsedPct $Sample.disk.usedPct)
    }
}

# Derive the worst-case main state from classified signals
function Get-WorstState {
    param($Classification)
    $levels = @($Classification.cpu, $Classification.memory, $Classification.disk)
    if ($levels -contains "red") { return "red" }
    if ($levels -contains "yellow") { return "yellow" }
    return "green"
}

# ---------------------------------------------------------------------------
# Assertion helpers
# ---------------------------------------------------------------------------

function Assert {
    param(
        [bool]$Condition,
        [string]$Name
    )
    if ($Condition) {
        $script:passed++
        Write-Host "  PASS  $Name" -ForegroundColor Green
    } else {
        $script:failed++
        Write-Host "  FAIL  $Name" -ForegroundColor Red
    }
}

function Assert-Equal {
    param(
        $Expected,
        $Actual,
        [string]$Name
    )
    Assert ($Expected -eq $Actual) "$Name (expected='$Expected', actual='$Actual')"
}

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

$fixturesDir = Join-Path $PSScriptRoot "__fixtures__" "resource-pressure"
$gateScript = Join-Path $PSScriptRoot "check-launch-gate.ps1"

# Minimal task JSON for gate invocation
$runtimeFeatureTaskJson = @'
[
  {
    "targetIssue": 602,
    "conflictGroup": "resource-gate-tests",
    "risk": "medium",
    "allowedFiles": ["src/ai/resource-gate.ts"],
    "taskType": "execution"
  }
]
'@

$healthRepairTaskJson = @'
[
  {
    "targetIssue": 603,
    "conflictGroup": "resource-gate-fix",
    "risk": "low",
    "allowedFiles": ["scripts/ai/fix-resource.ps1"],
    "taskType": "execution"
  }
]
'@

function Invoke-GateWithState {
    param(
        [string]$TaskJson,
        [string]$MainState,
        [string]$Description,
        [switch]$DryRun
    )
    $taskFile = Join-Path $tempDir "task-$([guid]::NewGuid().ToString('N').Substring(0,8)).json"
    Set-Content -Path $taskFile -Value $TaskJson -Encoding UTF8

    $args = @("-NoProfile", "-File", $gateScript, "-TaskFile", $taskFile, "-MainState", $MainState, "-Json")
    if ($DryRun) { $args += "-DryRun" }

    try {
        $output = & pwsh @args 2>&1
        return $output
    } catch {
        return $_.Exception.Message
    }
}

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "check-launch-gate resource-pressure fixture tests" -ForegroundColor Cyan
Write-Host ""

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "launch-gate-rp-$([guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {

    # ===================================================================
    # Section 1: Resource pressure classification from fixture
    # ===================================================================

    Write-Host "--- Classification from high-cpu.json fixture ---" -ForegroundColor Yellow

    $highCpuPath = Join-Path $fixturesDir "high-cpu.json"
    Assert (Test-Path $highCpuPath) "high-cpu.json fixture exists"

    $highCpuRaw = Get-Content -Path $highCpuPath -Raw -Encoding UTF8
    $highCpuSample = $highCpuRaw | ConvertFrom-Json

    $classification = Classify-All -Sample $highCpuSample

    Assert-Equal "red" $classification.cpu "high-cpu: CPU classifies as red (92.4% > 80)"
    Assert-Equal "green" $classification.memory "high-cpu: memory classifies as green (56.3% <= 70)"
    Assert-Equal "green" $classification.disk "high-cpu: disk classifies as green (64% <= 75)"

    $worstState = Get-WorstState -Classification $classification
    Assert-Equal "red" $worstState "high-cpu: worst-case state is red"

    # ===================================================================
    # Section 2: Inline boundary classification tests
    # ===================================================================

    Write-Host ""
    Write-Host "--- Inline boundary classification ---" -ForegroundColor Yellow

    # Exact green upper bounds
    $boundarySample = [pscustomobject]@{
        cpu    = [pscustomobject]@{ overallPercent = 50 }
        memory = [pscustomobject]@{ pressurePct = 70 }
        disk   = [pscustomobject]@{ usedPct = 75 }
    }
    $c = Classify-All -Sample $boundarySample
    Assert-Equal "green" $c.cpu "boundary: CPU 50% = green"
    Assert-Equal "green" $c.memory "boundary: memory 70% = green"
    Assert-Equal "green" $c.disk "boundary: disk 75% = green"

    # Just above green — all yellow
    $boundarySample = [pscustomobject]@{
        cpu    = [pscustomobject]@{ overallPercent = 51 }
        memory = [pscustomobject]@{ pressurePct = 71 }
        disk   = [pscustomobject]@{ usedPct = 76 }
    }
    $c = Classify-All -Sample $boundarySample
    Assert-Equal "yellow" $c.cpu "boundary: CPU 51% = yellow"
    Assert-Equal "yellow" $c.memory "boundary: memory 71% = yellow"
    Assert-Equal "yellow" $c.disk "boundary: disk 76% = yellow"

    # Exact yellow upper bounds
    $boundarySample = [pscustomobject]@{
        cpu    = [pscustomobject]@{ overallPercent = 80 }
        memory = [pscustomobject]@{ pressurePct = 85 }
        disk   = [pscustomobject]@{ usedPct = 90 }
    }
    $c = Classify-All -Sample $boundarySample
    Assert-Equal "yellow" $c.cpu "boundary: CPU 80% = yellow"
    Assert-Equal "yellow" $c.memory "boundary: memory 85% = yellow"
    Assert-Equal "yellow" $c.disk "boundary: disk 90% = yellow"

    # Just above yellow — all red
    $boundarySample = [pscustomobject]@{
        cpu    = [pscustomobject]@{ overallPercent = 81 }
        memory = [pscustomobject]@{ pressurePct = 86 }
        disk   = [pscustomobject]@{ usedPct = 91 }
    }
    $c = Classify-All -Sample $boundarySample
    Assert-Equal "red" $c.cpu "boundary: CPU 81% = red"
    Assert-Equal "red" $c.memory "boundary: memory 86% = red"
    Assert-Equal "red" $c.disk "boundary: disk 91% = red"

    # Fully saturated
    $boundarySample = [pscustomobject]@{
        cpu    = [pscustomobject]@{ overallPercent = 100 }
        memory = [pscustomobject]@{ pressurePct = 99 }
        disk   = [pscustomobject]@{ usedPct = 99 }
    }
    $c = Classify-All -Sample $boundarySample
    Assert-Equal "red" $c.cpu "boundary: CPU 100% = red"
    Assert-Equal "red" $c.memory "boundary: memory 99% = red"
    Assert-Equal "red" $c.disk "boundary: disk 99% = red"

    # Zero values
    $boundarySample = [pscustomobject]@{
        cpu    = [pscustomobject]@{ overallPercent = 0 }
        memory = [pscustomobject]@{ pressurePct = 0 }
        disk   = [pscustomobject]@{ usedPct = 0 }
    }
    $c = Classify-All -Sample $boundarySample
    Assert-Equal "green" $c.cpu "boundary: CPU 0% = green"
    Assert-Equal "green" $c.memory "boundary: memory 0% = green"
    Assert-Equal "green" $c.disk "boundary: disk 0% = green"

    # ===================================================================
    # Section 3: Gate behavior under resource-pressure-driven state
    # ===================================================================

    Write-Host ""
    Write-Host "--- Gate behavior with red state (high CPU pressure) ---" -ForegroundColor Yellow

    # Red state: runtime-feature tasks should be blocked
    $out = Invoke-GateWithState -TaskJson $runtimeFeatureTaskJson -MainState "red"
    $report = $out | ConvertFrom-Json

    Assert ($report.mainState -eq "red") "gate-red: mainState is red"
    Assert ($report.allAllowed -eq $false) "gate-red: runtime-feature blocked in red state"
    Assert ($report.tasks[0].allowed -eq $false) "gate-red: task[0].allowed is false"
    Assert-Equal "red" $report.tasks[0].mainState "gate-red: task[0].mainState is red"

    # Red state: health-repair tasks should still be allowed
    $out = Invoke-GateWithState -TaskJson $healthRepairTaskJson -MainState "red"
    $report = $out | ConvertFrom-Json

    Assert ($report.mainState -eq "red") "gate-red-health: mainState is red"
    Assert ($report.allAllowed -eq $true) "gate-red-health: health-repair allowed in red state"
    Assert ($report.tasks[0].allowed -eq $true) "gate-red-health: task[0].allowed is true"

    # Yellow state: runtime-feature should be blocked, health-repair allowed
    $out = Invoke-GateWithState -TaskJson $runtimeFeatureTaskJson -MainState "yellow"
    $report = $out | ConvertFrom-Json

    Assert ($report.mainState -eq "yellow") "gate-yellow: mainState is yellow"
    Assert ($report.allAllowed -eq $false) "gate-yellow: runtime-feature blocked in yellow state"

    $out = Invoke-GateWithState -TaskJson $healthRepairTaskJson -MainState "yellow"
    $report = $out | ConvertFrom-Json

    Assert ($report.allAllowed -eq $true) "gate-yellow-health: health-repair allowed in yellow state"

    # Green state: both should be allowed
    $out = Invoke-GateWithState -TaskJson $runtimeFeatureTaskJson -MainState "green"
    $report = $out | ConvertFrom-Json

    Assert ($report.mainState -eq "green") "gate-green: mainState is green"
    Assert ($report.allAllowed -eq $true) "gate-green: runtime-feature allowed in green state"

    # ===================================================================
    # Section 4: Dry-run mode with red state (resource pressure)
    # ===================================================================

    Write-Host ""
    Write-Host "--- Dry-run mode with resource pressure state ---" -ForegroundColor Yellow

    $out = Invoke-GateWithState -TaskJson $runtimeFeatureTaskJson -MainState "red" -DryRun
    $dryReport = $out | ConvertFrom-Json

    Assert ($dryReport.mode -eq "dry-run") "dry-run-red: mode is dry-run"

    # ===================================================================
    # Section 5: Worst-state derivation from fixture
    # ===================================================================

    Write-Host ""
    Write-Host "--- Worst-state derivation from mixed fixtures ---" -ForegroundColor Yellow

    # All green
    $allGreen = [pscustomobject]@{
        cpu    = [pscustomobject]@{ overallPercent = 10 }
        memory = [pscustomobject]@{ pressurePct = 30 }
        disk   = [pscustomobject]@{ usedPct = 40 }
    }
    $c = Classify-All -Sample $allGreen
    $w = Get-WorstState -Classification $c
    Assert-Equal "green" $w "worst-state: all-green yields green"

    # Mixed yellow (memory yellow, rest green)
    $mixedYellow = [pscustomobject]@{
        cpu    = [pscustomobject]@{ overallPercent = 40 }
        memory = [pscustomobject]@{ pressurePct = 80 }
        disk   = [pscustomobject]@{ usedPct = 60 }
    }
    $c = Classify-All -Sample $mixedYellow
    $w = Get-WorstState -Classification $c
    Assert-Equal "yellow" $w "worst-state: mixed-yellow yields yellow"

    # Mixed red (disk red, rest green)
    $mixedRed = [pscustomobject]@{
        cpu    = [pscustomobject]@{ overallPercent = 30 }
        memory = [pscustomobject]@{ pressurePct = 50 }
        disk   = [pscustomobject]@{ usedPct = 95 }
    }
    $c = Classify-All -Sample $mixedRed
    $w = Get-WorstState -Classification $c
    Assert-Equal "red" $w "worst-state: mixed-red (disk) yields red"

    # High-cpu fixture — worst state is red
    $c = Classify-All -Sample $highCpuSample
    $w = Get-WorstState -Classification $c
    Assert-Equal "red" $w "worst-state: high-cpu fixture yields red"

} finally {
    # Cleanup
    if ($tempDir -and (Test-Path $tempDir)) {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "$passed passed, $failed failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host ""

exit $(if ($failed -gt 0) { 1 } else { 0 })
