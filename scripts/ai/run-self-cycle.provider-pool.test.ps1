<#
.SYNOPSIS
    Fixture-based tests for the provider pool preflight (Step 2.5) in run-self-cycle.ps1.

.DESCRIPTION
    Exercises the provider pool preflight logic by running run-self-cycle.ps1
    with -DryRunFixture and different provider pool fixture combinations.

    Scenarios covered:
      1. Available provider with capacity       → pass
      2. All providers exhausted                → block (exit 1)
      3. All providers at max concurrency       → block (exit 1)
      4. Mixed (available + exhausted)          → pass
      5. Disabled provider only                 → block (exit 1)
      6. No provider-pool.json                  → skip (pass with warning)
      7. Policy disables blockWhenAllExhausted  → pass despite exhaustion

    No live GitHub access. No modifications to run-self-cycle.ps1.

.EXAMPLE
    pwsh ./scripts/ai/run-self-cycle.provider-pool.test.ps1
#>

#Requires -Version 7.0

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SCRIPT_DIR = $PSScriptRoot
$SELF_CYCLE = Join-Path $SCRIPT_DIR "run-self-cycle.ps1"
$ROOT = Resolve-Path (Join-Path $SCRIPT_DIR ".." "..")
$BASE_FIXTURE = Join-Path $ROOT "tests" "fixtures" "self-cycle"

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
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) "pp-preflight-test-$(Get-Random)"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    return $dir
}

function Copy-BaseFixtures {
    param([string]$TargetDir)
    Copy-Item (Join-Path $BASE_FIXTURE "01-planner-output-task.json") (Join-Path $TargetDir "01-planner-output-task.json")
    Copy-Item (Join-Path $BASE_FIXTURE "02-health-green.json") (Join-Path $TargetDir "02-health-green.json")
}

function Write-ProviderPoolState {
    param([string]$Dir, [object]$State)
    $State | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $Dir "provider-pool.json") -Encoding UTF8
}

function Write-ProviderPoolPolicy {
    param([string]$Dir, [object]$Policy)
    $Policy | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $Dir "provider-pool-policy.json") -Encoding UTF8
}

function Invoke-SelfCycle {
    param([string]$FixtureDir)
    $outFile = Join-Path ([System.IO.Path]::GetTempPath()) "pp-test-output-$(Get-Random).txt"
    & pwsh -NoProfile -File $SELF_CYCLE -DryRunFixture $FixtureDir *> $outFile
    $exitCode = $LASTEXITCODE
    $output = Get-Content $outFile -Raw -Encoding UTF8
    Remove-Item $outFile -ErrorAction SilentlyContinue
    return @{ exitCode = $exitCode; output = $output }
}

# --- Helper: build fixture state objects ---

function Make-State {
    param([object[]]$Providers, [int]$ActiveWorkers = 0, [int]$GlobalMax = 3)
    $avail = @($Providers | Where-Object { $_.status -eq "available" -and $_.currentConcurrency -lt $_.maxConcurrency })
    $exhaust = @($Providers | Where-Object { $_.status -eq "exhausted" })
    $disabl = @($Providers | Where-Object { $_.status -eq "disabled" })
    return @{
        stateVersion = 1
        providers    = $Providers
        global       = @{
            totalActiveWorkers  = $ActiveWorkers
            globalMaxWorkers    = $GlobalMax
            availableProviders  = $avail.Count
            exhaustedProviders  = $exhaust.Count
            disabledProviders   = $disabl.Count
            lastUpdatedBy       = "test"
            capturedAt          = "2026-05-11T00:00:00Z"
        }
    }
}

function Make-Policy {
    param([object[]]$Providers, [bool]$BlockExhausted = $true, [bool]$BlockAtCapacity = $true, [int]$GlobalMax = 3)
    return @{
        policyVersion = 1
        providers     = $Providers
        concurrency   = @{ globalMaxWorkers = $GlobalMax }
        launchGateIntegration = @{
            blockWhenAllExhausted = $BlockExhausted
            blockWhenAtCapacity   = $BlockAtCapacity
        }
    }
}

function Make-Provider {
    param([string]$Id, [string]$Status, [int]$Current, [int]$Max, [string]$Cooldown = $null)
    return @{
        id                  = $Id
        status              = $Status
        currentConcurrency  = $Current
        maxConcurrency      = $Max
        lastHealthCheckAt   = $null
        lastFailureClass    = $null
        cooldownExpiresAt   = $Cooldown
        consecutiveFailures = 0
        totalQuotaEvents    = 0
    }
}

# ===========================================================================
# Tests
# ===========================================================================

Write-Host ""
Write-Host "run-self-cycle.provider-pool tests" -ForegroundColor Cyan
Write-Host ""

# --- Scenario 1: Available provider with capacity → pass ---

& {
    Write-Host "--- Scenario 1: Available provider with capacity" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Copy-BaseFixtures $dir

    $prov = Make-Provider "provider-default" "available" 0 3
    Write-ProviderPoolState $dir (Make-State @($prov))
    Write-ProviderPoolPolicy $dir (Make-Policy @(@{ id = "provider-default"; label = "Default"; maxConcurrency = 3 }))

    $result = Invoke-SelfCycle $dir
    Assert-True ($result.exitCode -eq 0) "scenario 1: exit code 0"
    Assert-True ($result.output -match "provider-pool-preflight.*pass" -or $result.output -match "PASSED") "scenario 1: preflight passed"
    Assert-True ($result.output -match "available") "scenario 1: provider listed as available"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 2: All providers exhausted → block ---

& {
    Write-Host "--- Scenario 2: All providers exhausted" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Copy-BaseFixtures $dir

    $prov = Make-Provider "provider-default" "exhausted" 0 1 "2099-12-31T23:59:59Z"
    Write-ProviderPoolState $dir (Make-State @($prov))
    Write-ProviderPoolPolicy $dir (Make-Policy @(@{ id = "provider-default"; label = "Default"; maxConcurrency = 1 }))

    $result = Invoke-SelfCycle $dir
    Assert-True ($result.exitCode -eq 1) "scenario 2: exit code 1"
    Assert-True ($result.output -match "blocked-by-provider-pool") "scenario 2: blocked-by-provider-pool"
    Assert-True ($result.output -match "exhausted") "scenario 2: provider listed as exhausted"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 3: All providers at max concurrency → block ---

& {
    Write-Host "--- Scenario 3: All providers at max concurrency" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Copy-BaseFixtures $dir

    $prov = Make-Provider "provider-default" "available" 1 1
    Write-ProviderPoolState $dir (Make-State @($prov))
    Write-ProviderPoolPolicy $dir (Make-Policy @(@{ id = "provider-default"; label = "Default"; maxConcurrency = 1 }))

    $result = Invoke-SelfCycle $dir
    Assert-True ($result.exitCode -eq 1) "scenario 3: exit code 1"
    Assert-True ($result.output -match "blocked-by-provider-pool") "scenario 3: blocked-by-provider-pool"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 4: Mixed (available + exhausted) → pass ---

& {
    Write-Host "--- Scenario 4: Mixed providers (available + exhausted)" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Copy-BaseFixtures $dir

    $provA = Make-Provider "provider-a" "available" 0 2
    $provB = Make-Provider "provider-b" "exhausted" 0 1 "2099-12-31T23:59:59Z"
    Write-ProviderPoolState $dir (Make-State @($provA, $provB))

    $policyProviders = @(
        @{ id = "provider-a"; label = "A"; maxConcurrency = 2 },
        @{ id = "provider-b"; label = "B"; maxConcurrency = 1 }
    )
    Write-ProviderPoolPolicy $dir (Make-Policy $policyProviders)

    $result = Invoke-SelfCycle $dir
    Assert-True ($result.exitCode -eq 0) "scenario 4: exit code 0"
    Assert-True ($result.output -match "PASSED") "scenario 4: preflight passed"
    Assert-True ($result.output -match "1 available" -or $result.output -match "1 provider") "scenario 4: reports available count"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 5: Disabled provider only → block ---

& {
    Write-Host "--- Scenario 5: Disabled provider only" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Copy-BaseFixtures $dir

    $prov = Make-Provider "provider-default" "disabled" 0 1
    Write-ProviderPoolState $dir (Make-State @($prov))
    Write-ProviderPoolPolicy $dir (Make-Policy @(@{ id = "provider-default"; label = "Default"; maxConcurrency = 1 }))

    $result = Invoke-SelfCycle $dir
    Assert-True ($result.exitCode -eq 1) "scenario 5: exit code 1"
    Assert-True ($result.output -match "blocked-by-provider-pool") "scenario 5: blocked-by-provider-pool"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 6: No provider-pool.json → skip (pass) ---

& {
    Write-Host "--- Scenario 6: No provider-pool.json (skip)" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Copy-BaseFixtures $dir

    # No provider-pool.json or policy — preflight should skip with warning

    $result = Invoke-SelfCycle $dir
    Assert-True ($result.exitCode -eq 0) "scenario 6: exit code 0"
    Assert-True ($result.output -match "skipped" -or $result.output -match "no provider") "scenario 6: preflight skipped"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 7: Policy disables blockWhenAllExhausted → pass despite exhaustion ---

& {
    Write-Host "--- Scenario 7: blockWhenAllExhausted=false" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Copy-BaseFixtures $dir

    $prov = Make-Provider "provider-default" "exhausted" 0 1 "2099-12-31T23:59:59Z"
    Write-ProviderPoolState $dir (Make-State @($prov))

    # Policy with blockWhenAllExhausted=false — should not block
    $policyProviders = @(@{ id = "provider-default"; label = "Default"; maxConcurrency = 1 })
    Write-ProviderPoolPolicy $dir (Make-Policy $policyProviders -BlockExhausted $false)

    $result = Invoke-SelfCycle $dir
    Assert-True ($result.exitCode -eq 0) "scenario 7: exit code 0 (exhaustion not blocking)"
    Assert-True ($result.output -match "PASSED" -or $result.output -match "pass") "scenario 7: preflight passed"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# ===========================================================================
# Summary
# ===========================================================================

Write-Host ""
Write-Host "$passed passed, $failed failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })
Write-Host ""

exit $(if ($failed -gt 0) { 1 } else { 0 })
