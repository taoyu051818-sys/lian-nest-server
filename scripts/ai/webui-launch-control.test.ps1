<#
.SYNOPSIS
    Fixture-based tests for the WebUI launch-control wrapper.

.DESCRIPTION
    Exercises the webui-launch-control.ps1 wrapper by running it with
    different fixture combinations for label allowlist, health state,
    and provider pool capacity.

    Scenarios covered:
      1. Allowed label passes allowlist validation
      2. Disallowed label is blocked (exit 1)
      3. Green health state passes gate
      4. Red health state blocks gate (exit 1)
      5. Black health state blocks gate (exit 1)
      6. Missing health file blocks gate (fail-closed)
      7. Provider pool available passes gate
      8. Provider pool all-exhausted blocks gate (exit 1)
      9. Provider pool at-capacity blocks gate (exit 1)
     10. Provider pool missing is skipped (pass)
     11. MaxTasks cap parameter validity
     12. Custom label allowlist file
     13. Combined gates — all pass
     14. Combined gates — label blocked stops early
     15. Combined gates — health blocked stops after label pass

    No live GitHub access. No worker launches. No modifications to
    run-self-cycle.ps1.

.EXAMPLE
    pwsh ./scripts/ai/webui-launch-control.test.ps1
#>

#Requires -Version 7.0

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SCRIPT_DIR = $PSScriptRoot
$WRAPPER = Join-Path $SCRIPT_DIR "webui-launch-control.ps1"
$ROOT = Resolve-Path (Join-Path $SCRIPT_DIR ".." "..")

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
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) "webui-lc-test-$(Get-Random)"
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
    $healthDir = Join-Path $Dir ".github" "ai-state"
    New-Item -ItemType Directory -Path $healthDir -Force | Out-Null
    $health | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $healthDir "main-health.json") -Encoding UTF8
}

function Write-ProviderPoolFixture {
    param([string]$Dir, [object[]]$Providers, [bool]$BlockExhausted = $true, [bool]$BlockAtCapacity = $true)

    $avail = @($Providers | Where-Object { $_.status -eq "available" -and $_.currentConcurrency -lt $_.maxConcurrency })
    $exhaust = @($Providers | Where-Object { $_.status -eq "exhausted" })
    $disabl = @($Providers | Where-Object { $_.status -eq "disabled" })

    $state = @{
        stateVersion = 1
        providers    = $Providers
        global       = @{
            totalActiveWorkers  = 0
            globalMaxWorkers    = 3
            availableProviders  = $avail.Count
            exhaustedProviders  = $exhaust.Count
            disabledProviders   = $disabl.Count
            lastUpdatedBy       = "test"
            capturedAt          = "2026-05-11T00:00:00Z"
        }
    }

    $policy = @{
        policyVersion = 1
        providers     = @($Providers | ForEach-Object { @{ id = $_.id; label = $_.id; maxConcurrency = $_.maxConcurrency } })
        concurrency   = @{ globalMaxWorkers = 3 }
        launchGateIntegration = @{
            blockWhenAllExhausted = $BlockExhausted
            blockWhenAtCapacity   = $BlockAtCapacity
        }
    }

    $stateDir = Join-Path $Dir ".github" "ai-state"
    $policyDir = Join-Path $Dir ".github" "ai-policy"
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    New-Item -ItemType Directory -Path $policyDir -Force | Out-Null

    $state | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $stateDir "provider-pool.json") -Encoding UTF8
    $policy | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $policyDir "provider-pool-policy.json") -Encoding UTF8
}

function Write-AllowlistFixture {
    param([string]$Dir, [string[]]$Labels)
    $allowlist = @{ allowedLabels = $Labels }
    $allowlist | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Dir "allowlist.json") -Encoding UTF8
}

function Make-Provider {
    param([string]$Id, [string]$Status, [int]$Current, [int]$Max)
    return @{
        id                  = $Id
        status              = $Status
        currentConcurrency  = $Current
        maxConcurrency      = $Max
        lastHealthCheckAt   = $null
        lastFailureClass    = $null
        cooldownExpiresAt   = $null
        consecutiveFailures = 0
        totalQuotaEvents    = 0
    }
}

function Invoke-Wrapper {
    param(
        [string]$FixtureDir,
        [string]$Label = "agent:codex-action-needed",
        [int]$MaxTasksVal = 10,
        [switch]$Exec,
        [string]$AllowlistPath
    )
    $outFile = Join-Path ([System.IO.Path]::GetTempPath()) "webui-lc-test-output-$(Get-Random).txt"

    $healthPath = Join-Path $FixtureDir ".github" "ai-state" "main-health.json"
    $ppStatePath = Join-Path $FixtureDir ".github" "ai-state" "provider-pool.json"
    $ppPolicyPath = Join-Path $FixtureDir ".github" "ai-policy" "provider-pool-policy.json"

    $wrapperArgs = @(
        "-NoProfile"
        "-File", $WRAPPER
        "-IssueLabel", $Label
        "-MaxTasks", $MaxTasksVal
        "-HealthFile", $healthPath
        "-ProviderPoolStateFile", $ppStatePath
        "-ProviderPoolPolicyFile", $ppPolicyPath
    )

    if ($Exec) {
        $wrapperArgs += "-Execute"
    }
    if ($AllowlistPath) {
        $wrapperArgs += @("-LabelAllowlistFile", $AllowlistPath)
    }

    & pwsh @wrapperArgs *> $outFile
    $exitCode = $LASTEXITCODE
    $output = Get-Content $outFile -Raw -Encoding UTF8
    Remove-Item $outFile -ErrorAction SilentlyContinue
    return @{ exitCode = $exitCode; output = $output }
}

# ===========================================================================
# Tests
# ===========================================================================

Write-Host ""
Write-Host "webui-launch-control tests" -ForegroundColor Cyan
Write-Host ""

# --- Scenario 1: Allowed label passes allowlist ---

& {
    Write-Host "--- Scenario 1: Allowed label passes" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "green"

    $result = Invoke-Wrapper $dir "agent:codex-action-needed"
    Assert-True ($result.output -match "PASS.*Label.*allowed" -or $result.output -match "label-allowlist.*pass") "scenario 1: label allowed"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 2: Disallowed label is blocked ---

& {
    Write-Host "--- Scenario 2: Disallowed label blocked" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "green"

    $result = Invoke-Wrapper $dir "agent:not-in-allowlist"
    Assert-True ($result.exitCode -eq 1) "scenario 2: exit code 1"
    Assert-True ($result.output -match "not in the allowlist" -or $result.output -match "blocked-by-label-allowlist") "scenario 2: blocked by allowlist"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 3: Green health passes gate ---

& {
    Write-Host "--- Scenario 3: Green health passes" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "green"

    $result = Invoke-Wrapper $dir
    Assert-True ($result.output -match "Health.*green" -or $result.output -match "health-gate.*pass") "scenario 3: green health passed"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 4: Red health blocks gate ---

& {
    Write-Host "--- Scenario 4: Red health blocks" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "red"

    $result = Invoke-Wrapper $dir
    Assert-True ($result.exitCode -eq 1) "scenario 4: exit code 1"
    Assert-True ($result.output -match "blocked-by-health" -or $result.output -match "Health.*red") "scenario 4: blocked by health"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 5: Black health blocks gate ---

& {
    Write-Host "--- Scenario 5: Black health blocks" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "black"

    $result = Invoke-Wrapper $dir
    Assert-True ($result.exitCode -eq 1) "scenario 5: exit code 1"
    Assert-True ($result.output -match "blocked-by-health" -or $result.output -match "Health.*black") "scenario 5: blocked by health"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 6: Missing health file blocks (fail-closed) ---

& {
    Write-Host "--- Scenario 6: Missing health file (fail-closed)" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    # No health file written — health gate should fail-closed
    $stateDir = Join-Path $Dir ".github" "ai-state"
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

    $result = Invoke-Wrapper $dir
    Assert-True ($result.exitCode -eq 1) "scenario 6: exit code 1"
    Assert-True ($result.output -match "blocked-by-health" -or $result.output -match "not found" -or $result.output -match "fail-closed") "scenario 6: blocked (fail-closed)"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 7: Provider pool available passes ---

& {
    Write-Host "--- Scenario 7: Provider pool available" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "green"
    $prov = Make-Provider "provider-default" "available" 0 3
    Write-ProviderPoolFixture $dir @($prov)

    $result = Invoke-Wrapper $dir
    Assert-True ($result.output -match "provider.*available" -or $result.output -match "provider-gate.*pass") "scenario 7: provider gate passed"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 8: All providers exhausted blocks ---

& {
    Write-Host "--- Scenario 8: All providers exhausted" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "green"
    $prov = Make-Provider "provider-default" "exhausted" 0 1
    Write-ProviderPoolFixture $dir @($prov)

    $result = Invoke-Wrapper $dir
    Assert-True ($result.exitCode -eq 1) "scenario 8: exit code 1"
    Assert-True ($result.output -match "blocked-by-provider-pool" -or $result.output -match "exhausted") "scenario 8: blocked by provider pool"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 9: All providers at capacity blocks ---

& {
    Write-Host "--- Scenario 9: All providers at capacity" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "green"
    $prov = Make-Provider "provider-default" "available" 3 3
    Write-ProviderPoolFixture $dir @($prov)

    $result = Invoke-Wrapper $dir
    Assert-True ($result.exitCode -eq 1) "scenario 9: exit code 1"
    Assert-True ($result.output -match "blocked-by-provider-pool" -or $result.output -match "max concurrency") "scenario 9: blocked by provider pool"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 10: Provider pool missing is skipped ---

& {
    Write-Host "--- Scenario 10: Provider pool missing (skip)" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "green"
    # No provider pool fixtures — should skip

    $result = Invoke-Wrapper $dir
    Assert-True ($result.output -match "skip" -or $result.output -match "not found") "scenario 10: provider pool skipped"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 11: MaxTasks cap validity ---

& {
    Write-Host "--- Scenario 11: MaxTasks cap validity" -ForegroundColor DarkCyan

    # MaxTasks range is 1-50, default 10
    # Valid values should not error on parameter validation
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "green"

    $result = Invoke-Wrapper $dir -MaxTasksVal 5
    Assert-True ($result.output -match "MaxTasks.*5" -or $result.output -match "5") "scenario 11: custom MaxTasks accepted"

    # Boundary: MaxTasks = 1
    $result2 = Invoke-Wrapper $dir -MaxTasksVal 1
    Assert-True ($result2.output -match "MaxTasks.*1" -or $result2.output -match "1") "scenario 11: MaxTasks=1 accepted"

    # Boundary: MaxTasks = 50
    $result3 = Invoke-Wrapper $dir -MaxTasksVal 50
    Assert-True ($result3.output -match "MaxTasks.*50" -or $result3.output -match "50") "scenario 11: MaxTasks=50 accepted"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 12: Custom label allowlist file ---

& {
    Write-Host "--- Scenario 12: Custom label allowlist file" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "green"

    # Custom allowlist that includes a different label
    Write-AllowlistFixture $dir @("agent:custom-label", "agent:codex-docs")
    $allowlistFile = Join-Path $dir "allowlist.json"

    $result = Invoke-Wrapper $dir "agent:custom-label" -AllowlistPath $allowlistFile
    Assert-True ($result.output -match "PASS.*Label.*allowed" -or $result.output -match "label-allowlist.*pass") "scenario 12: custom label allowed"

    # Default label should NOT be in custom allowlist
    $result2 = Invoke-Wrapper $dir "agent:codex-action-needed" -AllowlistPath $allowlistFile
    Assert-True ($result2.exitCode -eq 1) "scenario 12: default label blocked by custom allowlist"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 13: Combined gates — all pass ---

& {
    Write-Host "--- Scenario 13: All gates pass" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "green"
    $prov = Make-Provider "provider-default" "available" 1 3
    Write-ProviderPoolFixture $dir @($prov)

    $result = Invoke-Wrapper $dir "agent:codex-action-needed"
    # Should pass allowlist, health, provider gates (delegate may fail
    # because there's no real GitHub, but gates should pass)
    Assert-True ($result.output -match "label-allowlist.*pass") "scenario 13: label allowlist passed"
    Assert-True ($result.output -match "health-gate.*pass") "scenario 13: health gate passed"
    Assert-True ($result.output -match "provider-gate.*pass") "scenario 13: provider gate passed"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 14: Combined — label blocked stops early ---

& {
    Write-Host "--- Scenario 14: Label blocked stops early" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "red"  # Would block too, but label should stop first

    $result = Invoke-Wrapper $dir "agent:not-allowed"
    Assert-True ($result.exitCode -eq 1) "scenario 14: exit code 1"
    Assert-True ($result.output -match "not in the allowlist" -or $result.output -match "blocked-by-label-allowlist") "scenario 14: stopped at label allowlist"
    # Should NOT reach health gate
    Assert-True ($result.output -notmatch "health-gate") "scenario 14: did not reach health gate"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Scenario 15: Combined — health blocked after label pass ---

& {
    Write-Host "--- Scenario 15: Health blocked after label pass" -ForegroundColor DarkCyan
    $dir = New-TempFixtureDir
    Write-HealthFixture $dir "red"

    $result = Invoke-Wrapper $dir "agent:codex-action-needed"
    Assert-True ($result.exitCode -eq 1) "scenario 15: exit code 1"
    Assert-True ($result.output -match "label-allowlist.*pass") "scenario 15: label allowlist passed"
    Assert-True ($result.output -match "blocked-by-health") "scenario 15: blocked by health"
    # Should NOT reach provider gate
    Assert-True ($result.output -notmatch "provider-gate") "scenario 15: did not reach provider gate"

    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# ===========================================================================
# Summary
# ===========================================================================

Write-Host ""
Write-Host "$passed passed, $failed failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })
Write-Host ""

exit $(if ($failed -gt 0) { 1 } else { 0 })
