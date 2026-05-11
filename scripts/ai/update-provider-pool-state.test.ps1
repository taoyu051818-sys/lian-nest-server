<#
.SYNOPSIS
    Fixture-based tests for update-provider-pool-state.ps1.

.DESCRIPTION
    Creates temporary provider-pool.json fixtures and runs the updater
    script to verify status transitions, concurrency adjustments, failure
    tracking, cooldown management, global summary recomputation, and
    schema validation.

    All fixtures use -DryRun or -ValidateOnly.  No live files modified.

.EXAMPLE
    pwsh ./scripts/ai/update-provider-pool-state.test.ps1
#>

#Requires -Version 7.0

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$passed = 0
$failed = 0
$tempDir = $null

$updaterScript = Join-Path $PSScriptRoot "update-provider-pool-state.ps1"

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

function Assert-Contains {
    param(
        [string]$Haystack,
        [string]$Needle,
        [string]$Name
    )
    Assert ($Haystack -match [regex]::Escape($Needle)) $Name
}

function Assert-NotContains {
    param(
        [string]$Haystack,
        [string]$Needle,
        [string]$Name
    )
    Assert ($Haystack -notmatch [regex]::Escape($Needle)) $Name
}

function New-TempDir {
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) "pp-update-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    return $dir
}

function Write-PoolState {
    param([string]$Dir, [object]$State)
    $path = Join-Path $Dir "provider-pool.json"
    $State | ConvertTo-Json -Depth 10 | Set-Content -Path $path -Encoding UTF8
    return $path
}

function Make-Provider {
    param(
        [string]$Id,
        [string]$Status = "available",
        [int]$Current = 0,
        [int]$Max = 3,
        [string]$Cooldown = $null,
        [int]$ConsecutiveFailures = 0,
        [int]$TotalQuotaEvents = 0
    )
    return @{
        id                  = $Id
        status              = $Status
        currentConcurrency  = $Current
        maxConcurrency      = $Max
        lastHealthCheckAt   = $null
        lastFailureClass    = $null
        cooldownExpiresAt   = $Cooldown
        consecutiveFailures = $ConsecutiveFailures
        totalQuotaEvents    = $TotalQuotaEvents
    }
}

function Make-State {
    param([object[]]$Providers, [int]$GlobalMax = 3)
    $avail = @($Providers | Where-Object { $_.status -eq "available" })
    $exhaust = @($Providers | Where-Object { $_.status -eq "exhausted" })
    $disabl = @($Providers | Where-Object { $_.status -eq "disabled" })
    $totalActive = 0
    foreach ($p in $Providers) { $totalActive += $p.currentConcurrency }
    return @{
        stateVersion = 1
        providers    = $Providers
        global       = @{
            totalActiveWorkers  = $totalActive
            globalMaxWorkers    = $GlobalMax
            availableProviders  = $avail.Count
            exhaustedProviders  = $exhaust.Count
            disabledProviders   = $disabl.Count
            lastUpdatedBy       = "test"
            capturedAt          = "2026-05-11T00:00:00Z"
        }
    }
}

function Invoke-Updater {
    param(
        [string]$StateFile,
        [string[]]$Arguments
    )
    $allArgs = @("-NoProfile", "-File", $updaterScript, "-StateFile", $StateFile) + $Arguments
    $outFile = Join-Path ([System.IO.Path]::GetTempPath()) "pp-update-out-$(Get-Random).txt"
    & pwsh @allArgs *> $outFile
    $exitCode = $LASTEXITCODE
    $output = Get-Content $outFile -Raw -Encoding UTF8
    Remove-Item $outFile -ErrorAction SilentlyContinue
    return @{ exitCode = $exitCode; output = $output }
}

function Read-PoolState {
    param([string]$Path)
    return (Get-Content $Path -Raw -Encoding UTF8) | ConvertFrom-Json
}

# ===========================================================================
# Setup
# ===========================================================================

Write-Host ""
Write-Host "update-provider-pool-state fixture tests" -ForegroundColor Cyan
Write-Host ""

$tempDir = New-TempDir

try {

    # -----------------------------------------------------------------------
    # Test 1: SetStatus to exhausted — sets cooldown, increments failures
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 1: SetStatus exhausted" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "available" 0 3)
        $file = Write-PoolState $tempDir $state

        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "SetStatus", "-Status", "exhausted", "-CooldownSeconds", "600", "-ValidateOnly")
        Assert ($r.exitCode -eq 0) "exhausted: exit 0"

        # Now apply and check the state
        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "SetStatus", "-Status", "exhausted", "-CooldownSeconds", "600", "-Apply")
        Assert ($r.exitCode -eq 0) "exhausted apply: exit 0"
        Assert-Contains $r.output "available -> exhausted" "exhausted: transition logged"

        $s = Read-PoolState $file
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.status -eq "exhausted") "exhausted: status is exhausted"
        Assert ($p.cooldownExpiresAt -ne $null) "exhausted: cooldownExpiresAt set"
        Assert ($p.consecutiveFailures -eq 1) "exhausted: consecutiveFailures=1"
        Assert ($p.totalQuotaEvents -eq 1) "exhausted: totalQuotaEvents=1"
        Assert ($p.lastFailureClass -eq "exhaustion") "exhausted: lastFailureClass=exhaustion"
        Assert ($s.global.exhaustedProviders -eq 1) "exhausted: global.exhaustedProviders=1"
        Assert ($s.global.availableProviders -eq 0) "exhausted: global.availableProviders=0"
    }

    # -----------------------------------------------------------------------
    # Test 2: SetStatus to available — clears cooldown, resets failures
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 2: SetStatus available" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "exhausted" 0 3 "2099-12-31T23:59:59Z" 3 5)
        $file = Write-PoolState $tempDir $state

        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "SetStatus", "-Status", "available", "-Apply")
        Assert ($r.exitCode -eq 0) "available apply: exit 0"
        Assert-Contains $r.output "exhausted -> available" "available: transition logged"
        Assert-Contains $r.output "cooldown cleared" "available: cooldown cleared in output"

        $s = Read-PoolState $file
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.status -eq "available") "available: status is available"
        Assert ($p.cooldownExpiresAt -eq $null) "available: cooldownExpiresAt is null"
        Assert ($p.consecutiveFailures -eq 0) "available: consecutiveFailures reset to 0"
        Assert ($s.global.availableProviders -eq 1) "available: global.availableProviders=1"
        Assert ($s.global.exhaustedProviders -eq 0) "available: global.exhaustedProviders=0"
    }

    # -----------------------------------------------------------------------
    # Test 3: SetStatus to disabled
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 3: SetStatus disabled" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "available" 0 3)
        $file = Write-PoolState $tempDir $state

        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "SetStatus", "-Status", "disabled", "-Apply")
        Assert ($r.exitCode -eq 0) "disabled apply: exit 0"
        Assert-Contains $r.output "available -> disabled" "disabled: transition logged"

        $s = Read-PoolState $file
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.status -eq "disabled") "disabled: status is disabled"
        Assert ($p.cooldownExpiresAt -eq $null) "disabled: cooldownExpiresAt is null"
        Assert ($s.global.disabledProviders -eq 1) "disabled: global.disabledProviders=1"
    }

    # -----------------------------------------------------------------------
    # Test 4: IncrementConcurrency
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 4: IncrementConcurrency" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "available" 1 3)
        $file = Write-PoolState $tempDir $state

        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "IncrementConcurrency", "-Apply")
        Assert ($r.exitCode -eq 0) "increment: exit 0"
        Assert-Contains $r.output "1 -> 2" "increment: 1 -> 2"

        $s = Read-PoolState $file
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.currentConcurrency -eq 2) "increment: currentConcurrency=2"
        Assert ($s.global.totalActiveWorkers -eq 2) "increment: global.totalActiveWorkers=2"
    }

    # -----------------------------------------------------------------------
    # Test 5: DecrementConcurrency
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 5: DecrementConcurrency" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "available" 2 3)
        $file = Write-PoolState $tempDir $state

        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "DecrementConcurrency", "-Apply")
        Assert ($r.exitCode -eq 0) "decrement: exit 0"
        Assert-Contains $r.output "2 -> 1" "decrement: 2 -> 1"

        $s = Read-PoolState $file
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.currentConcurrency -eq 1) "decrement: currentConcurrency=1"
    }

    # -----------------------------------------------------------------------
    # Test 6: DecrementConcurrency min 0
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 6: DecrementConcurrency min 0" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "available" 0 3)
        $file = Write-PoolState $tempDir $state

        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "DecrementConcurrency", "-Apply")
        Assert ($r.exitCode -eq 0) "decrement-min: exit 0"

        $s = Read-PoolState $file
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.currentConcurrency -eq 0) "decrement-min: currentConcurrency stays 0"
    }

    # -----------------------------------------------------------------------
    # Test 7: ResetFailures
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 7: ResetFailures" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "exhausted" 0 3 "2099-12-31T23:59:59Z" 5 10)
        $file = Write-PoolState $tempDir $state

        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "ResetFailures", "-Apply")
        Assert ($r.exitCode -eq 0) "reset-failures: exit 0"
        Assert-Contains $r.output "reset to 0" "reset-failures: logged"

        $s = Read-PoolState $file
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.consecutiveFailures -eq 0) "reset-failures: consecutiveFailures=0"
        Assert ($p.totalQuotaEvents -eq 10) "reset-failures: totalQuotaEvents unchanged"
    }

    # -----------------------------------------------------------------------
    # Test 8: Non-existent provider → error
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 8: Non-existent provider" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "available" 0 3)
        $file = Write-PoolState $tempDir $state

        $r = Invoke-Updater $file @("-ProviderId", "prov-nonexistent", "-Operation", "SetStatus", "-Status", "exhausted")
        Assert ($r.exitCode -eq 1) "nonexistent: exit 1"
        Assert-Contains $r.output "not found" "nonexistent: error message"
    }

    # -----------------------------------------------------------------------
    # Test 9: Missing -Status with SetStatus → error
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 9: Missing -Status" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "available" 0 3)
        $file = Write-PoolState $tempDir $state

        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "SetStatus")
        Assert ($r.exitCode -eq 1) "missing-status: exit 1"
        Assert-Contains $r.output "Status" "missing-status: error mentions Status"
    }

    # -----------------------------------------------------------------------
    # Test 10: DryRun mode — no file modification
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 10: DryRun mode" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "available" 0 3)
        $file = Write-PoolState $tempDir $state

        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "SetStatus", "-Status", "exhausted", "-DryRun")
        Assert ($r.exitCode -eq 0) "dryrun: exit 0"
        Assert-Contains $r.output "Dry-run" "dryrun: mentions dry-run"
        Assert-Contains $r.output "exhausted" "dryrun: shows exhausted in preview"

        # State should be unchanged
        $s = Read-PoolState $file
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.status -eq "available") "dryrun: state unchanged"
    }

    # -----------------------------------------------------------------------
    # Test 11: ValidateOnly mode
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 11: ValidateOnly mode" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "available" 0 3)
        $file = Write-PoolState $tempDir $state

        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "SetStatus", "-Status", "exhausted", "-ValidateOnly")
        Assert ($r.exitCode -eq 0) "validate-only: exit 0"
        Assert-Contains $r.output "schema-compliant" "validate-only: mentions compliant"
        Assert-Contains $r.output "Validate-only" "validate-only: mentions mode"

        # State should be unchanged
        $s = Read-PoolState $file
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.status -eq "available") "validate-only: state unchanged"
    }

    # -----------------------------------------------------------------------
    # Test 12: Global summary recomputation with multiple providers
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 12: Global summary recomputation" -ForegroundColor DarkCyan
        $provA = Make-Provider "prov-a" "available" 1 3
        $provB = Make-Provider "prov-b" "exhausted" 0 2 "2099-12-31T23:59:59Z" 1 1
        $provC = Make-Provider "prov-c" "disabled" 0 1
        $state = Make-State @($provA, $provB, $provC) -GlobalMax 6
        $file = Write-PoolState $tempDir $state

        # Mark prov-b as available
        $r = Invoke-Updater $file @("-ProviderId", "prov-b", "-Operation", "SetStatus", "-Status", "available", "-Apply")
        Assert ($r.exitCode -eq 0) "global-recompute: exit 0"

        $s = Read-PoolState $file
        Assert ($s.global.availableProviders -eq 2) "global-recompute: availableProviders=2"
        Assert ($s.global.exhaustedProviders -eq 0) "global-recompute: exhaustedProviders=0"
        Assert ($s.global.disabledProviders -eq 1) "global-recompute: disabledProviders=1"
        Assert ($s.global.totalActiveWorkers -eq 1) "global-recompute: totalActiveWorkers=1"
        Assert ($s.global.globalMaxWorkers -eq 6) "global-recompute: globalMaxWorkers preserved=6"
    }

    # -----------------------------------------------------------------------
    # Test 13: Schema validation — malformed state file
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 13: Malformed state file" -ForegroundColor DarkCyan
        $file = Join-Path $tempDir "malformed-pool.json"
        Set-Content -Path $file -Value "{ invalid json" -Encoding UTF8

        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "SetStatus", "-Status", "exhausted")
        Assert ($r.exitCode -eq 1) "malformed: exit 1"
        Assert-Contains $r.output "Failed to parse" "malformed: parse error"
    }

    # -----------------------------------------------------------------------
    # Test 14: Missing state file — creates minimal state
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 14: Missing state file" -ForegroundColor DarkCyan
        $missingFile = Join-Path $tempDir "missing-pool.json"
        # Ensure file does not exist
        Remove-Item $missingFile -ErrorAction SilentlyContinue

        $r = Invoke-Updater $missingFile @("-ProviderId", "prov-a", "-Operation", "SetStatus", "-Status", "exhausted", "-ValidateOnly")
        Assert ($r.exitCode -eq 1) "missing-file: exit 1 (provider not in empty state)"
        Assert-Contains $r.output "not found" "missing-file: provider not found"
    }

    # -----------------------------------------------------------------------
    # Test 15: Multiple consecutive exhaustion increments failures
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 15: Multiple exhaustion increments" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "available" 0 3)
        $file = Write-PoolState $tempDir $state

        # First exhaustion
        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "SetStatus", "-Status", "exhausted", "-CooldownSeconds", "60", "-Apply")
        Assert ($r.exitCode -eq 0) "multi-exhaust 1: exit 0"

        # Recover
        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "SetStatus", "-Status", "available", "-Apply")
        Assert ($r.exitCode -eq 0) "multi-recover 1: exit 0"

        # Second exhaustion
        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "SetStatus", "-Status", "exhausted", "-CooldownSeconds", "60", "-Apply")
        Assert ($r.exitCode -eq 0) "multi-exhaust 2: exit 0"

        $s = Read-PoolState $file
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        # After recover (resets to 0) + second exhaust (increments to 1)
        Assert ($p.consecutiveFailures -eq 1) "multi-exhaust: consecutiveFailures=1 after recover+re-exhaust"
        Assert ($p.totalQuotaEvents -eq 2) "multi-exhaust: totalQuotaEvents=2"
    }

    # -----------------------------------------------------------------------
    # Test 16: Reason parameter appears in output
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 16: Reason parameter" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "available" 0 3)
        $file = Write-PoolState $tempDir $state

        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "SetStatus", "-Status", "exhausted", "-Reason", "Rate limit hit", "-DryRun")
        Assert ($r.exitCode -eq 0) "reason: exit 0"
        Assert-Contains $r.output "Rate limit hit" "reason: appears in output"
    }

    # -----------------------------------------------------------------------
    # Test 17: Apply + DryRun conflict
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 17: Apply + DryRun conflict" -ForegroundColor DarkCyan
        $state = Make-State @(Make-Provider "prov-a" "available" 0 3)
        $file = Write-PoolState $tempDir $state

        $r = Invoke-Updater $file @("-ProviderId", "prov-a", "-Operation", "SetStatus", "-Status", "exhausted", "-Apply", "-DryRun")
        Assert ($r.exitCode -eq 1) "conflict: exit 1"
    }

} finally {
    # Cleanup
    if ($tempDir -and (Test-Path $tempDir)) {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ===========================================================================
# Summary
# ===========================================================================

Write-Host ""
Write-Host "$passed passed, $failed failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host ""

exit $(if ($failed -gt 0) { 1 } else { 0 })
