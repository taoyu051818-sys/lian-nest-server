<#
.SYNOPSIS
    Fixture-based tests for rotate-claude-settings-provider.ps1.

.DESCRIPTION
    Creates temporary policy and state fixtures and runs the rotation bridge
    script to verify dry-run preview, rotation state transitions, safety
    gates, backup/restore behavior, atomic write, and error handling.

    All fixtures use dry-run mode (default) or test apply behavior against
    temp files.  No live files or real credentials modified.

.EXAMPLE
    pwsh ./scripts/ai/rotate-claude-settings-provider.test.ps1
#>

#Requires -Version 7.0

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$passed = 0
$failed = 0
$tempDir = $null

$rotateScript = Join-Path $PSScriptRoot "rotate-claude-settings-provider.ps1"

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
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) "rotate-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    return $dir
}

function Write-Policy {
    param([string]$Dir, [object[]]$Providers)
    $path = Join-Path $Dir "policy.json"
    @{ providers = $Providers } | ConvertTo-Json -Depth 10 | Set-Content -Path $path -Encoding UTF8
    return $path
}

function Write-State {
    param([string]$Dir, [object[]]$Providers, [int]$GlobalMax = 6)
    $path = Join-Path $Dir "state.json"
    $totalActive = 0
    $avail = 0; $exhaust = 0; $disabl = 0
    foreach ($p in $Providers) {
        $totalActive += $p.currentConcurrency
        switch ($p.status) {
            "available" { $avail++ }
            "exhausted" { $exhaust++ }
            "disabled"  { $disabl++ }
        }
    }
    $state = @{
        stateVersion = 1
        providers    = $Providers
        global       = @{
            totalActiveWorkers  = $totalActive
            globalMaxWorkers    = $GlobalMax
            availableProviders  = $avail
            exhaustedProviders  = $exhaust
            disabledProviders   = $disabl
            lastUpdatedBy       = "test"
            capturedAt          = "2026-05-11T00:00:00Z"
        }
    }
    $state | ConvertTo-Json -Depth 10 | Set-Content -Path $path -Encoding UTF8
    return $path
}

function Make-PolicyProvider {
    param(
        [string]$Id,
        [string]$Source = "env-var",
        [string]$SecretSource = $null
    )
    $entry = @{
        id     = $Id
        source = $Source
    }
    if ($SecretSource) {
        $entry["secretSource"] = $SecretSource
    }
    return $entry
}

function Make-StateProvider {
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

function Invoke-Rotator {
    param(
        [string]$PolicyPath,
        [string]$StatePath,
        [string[]]$Arguments
    )
    $allArgs = @("-NoProfile", "-File", $rotateScript, "-PolicyPath", $PolicyPath, "-StatePath", $StatePath) + $Arguments
    $outFile = Join-Path ([System.IO.Path]::GetTempPath()) "rotate-out-$(Get-Random).txt"
    & pwsh @allArgs *> $outFile
    $exitCode = $LASTEXITCODE
    $output = Get-Content $outFile -Raw -Encoding UTF8
    Remove-Item $outFile -ErrorAction SilentlyContinue
    return @{ exitCode = $exitCode; output = $output }
}

function Invoke-RotatorJson {
    param(
        [string]$PolicyPath,
        [string]$StatePath,
        [string[]]$Arguments
    )
    $allArgs = @("-NoProfile", "-File", $rotateScript, "-PolicyPath", $PolicyPath, "-StatePath", $StatePath, "-Json") + $Arguments
    $outFile = Join-Path ([System.IO.Path]::GetTempPath()) "rotate-json-out-$(Get-Random).txt"
    & pwsh @allArgs *> $outFile
    $exitCode = $LASTEXITCODE
    $output = Get-Content $outFile -Raw -Encoding UTF8
    Remove-Item $outFile -ErrorAction SilentlyContinue
    $parsed = $null
    try { $parsed = $output | ConvertFrom-Json } catch {}
    return @{ exitCode = $exitCode; output = $output; parsed = $parsed }
}

function Read-StateFile {
    param([string]$Path)
    return (Get-Content $Path -Raw -Encoding UTF8) | ConvertFrom-Json
}

# ===========================================================================
# Setup
# ===========================================================================

Write-Host ""
Write-Host "rotate-claude-settings-provider fixture tests" -ForegroundColor Cyan
Write-Host ""

$tempDir = New-TempDir

try {

    # -----------------------------------------------------------------------
    # Test 1: Dry-run preview — exit 0, no state changes
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 1: Dry-run preview" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(Make-StateProvider "prov-a" "available" 0 3)

        $r = Invoke-Rotator $policy $state @("-ProviderId", "prov-a")
        Assert ($r.exitCode -eq 0) "dry-run: exit 0"
        Assert-Contains $r.output "dry-run" "dry-run: mentions dry-run"
        Assert-Contains $r.output "Rotation plan" "dry-run: shows rotation plan"

        # State should be unchanged
        $s = Read-StateFile $state
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.status -eq "available") "dry-run: state unchanged"
        Assert ($p.consecutiveFailures -eq 0) "dry-run: failures unchanged"
    }

    # -----------------------------------------------------------------------
    # Test 2: Dry-run JSON output
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 2: Dry-run JSON output" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(Make-StateProvider "prov-a" "available" 0 3)

        $r = Invoke-RotatorJson $policy $state @("-ProviderId", "prov-a")
        Assert ($r.exitCode -eq 0) "json: exit 0"
        Assert ($r.parsed -ne $null) "json: parsed"
        Assert ($r.parsed.tool -eq "rotate-claude-settings-provider") "json: tool name"
        Assert ($r.parsed.dryRun -eq $true) "json: dryRun=true"
        Assert ($r.parsed.providerId -eq "prov-a") "json: providerId"
        Assert ($r.parsed.status -eq "preview") "json: status=preview"
        Assert ($r.parsed.plan -ne $null) "json: plan present"
    }

    # -----------------------------------------------------------------------
    # Test 3: Apply without -ConfirmRotation → error
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 3: Apply without confirmation" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(Make-StateProvider "prov-a" "available" 0 3)

        $r = Invoke-Rotator $policy $state @("-ProviderId", "prov-a", "-Apply")
        Assert ($r.exitCode -eq 1) "no-confirm: exit 1"
        Assert-Contains $r.output "ConfirmRotation" "no-confirm: mentions ConfirmRotation"
    }

    # -----------------------------------------------------------------------
    # Test 4: Apply with confirmation — rotates available provider
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 4: Apply with confirmation" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(Make-StateProvider "prov-a" "available" 1 3)

        $r = Invoke-Rotator $policy $state @("-ProviderId", "prov-a", "-Apply", "-ConfirmRotation")
        Assert ($r.exitCode -eq 0) "apply: exit 0"
        Assert-Contains $r.output "Rotation applied" "apply: success message"

        $s = Read-StateFile $state
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.status -eq "available") "apply: status=available"
        Assert ($p.consecutiveFailures -eq 0) "apply: failures=0"
        Assert ($p.cooldownExpiresAt -eq $null) "apply: cooldown cleared"
        Assert ($p.currentConcurrency -eq 1) "apply: concurrency preserved"
        Assert ($s.global.lastUpdatedBy -eq "rotate-claude-settings-provider.ps1") "apply: updatedBy set"
    }

    # -----------------------------------------------------------------------
    # Test 5: Rotate exhausted provider — clears cooldown and failures
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 5: Rotate exhausted provider" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(
            Make-StateProvider "prov-a" "exhausted" 0 3 "2099-12-31T23:59:59Z" 3 5
        )

        $r = Invoke-Rotator $policy $state @("-ProviderId", "prov-a", "-Apply", "-ConfirmRotation")
        Assert ($r.exitCode -eq 0) "exhausted-rotate: exit 0"

        $s = Read-StateFile $state
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.status -eq "available") "exhausted-rotate: status=available"
        Assert ($p.cooldownExpiresAt -eq $null) "exhausted-rotate: cooldown cleared"
        Assert ($p.consecutiveFailures -eq 0) "exhausted-rotate: failures=0"
        Assert ($p.totalQuotaEvents -eq 5) "exhausted-rotate: totalQuotaEvents preserved"
        Assert ($s.global.exhaustedProviders -eq 0) "exhausted-rotate: global exhausted=0"
        Assert ($s.global.availableProviders -eq 1) "exhausted-rotate: global available=1"
    }

    # -----------------------------------------------------------------------
    # Test 6: Rotate disabled provider — re-enables
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 6: Rotate disabled provider" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(
            Make-StateProvider "prov-a" "disabled" 0 1 $null 0 0
        )

        $r = Invoke-Rotator $policy $state @("-ProviderId", "prov-a", "-Apply", "-ConfirmRotation")
        Assert ($r.exitCode -eq 0) "disabled-rotate: exit 0"
        Assert-Contains $r.output "disabled" "disabled-rotate: mentions disabled"

        $s = Read-StateFile $state
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.status -eq "available") "disabled-rotate: status=available"
        Assert ($s.global.disabledProviders -eq 0) "disabled-rotate: global disabled=0"
        Assert ($s.global.availableProviders -eq 1) "disabled-rotate: global available=1"
    }

    # -----------------------------------------------------------------------
    # Test 7: Non-existent provider → error
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 7: Non-existent provider" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(Make-StateProvider "prov-a" "available" 0 3)

        $r = Invoke-Rotator $policy $state @("-ProviderId", "prov-nonexistent")
        Assert ($r.exitCode -eq 1) "nonexistent: exit 1"
        Assert-Contains $r.output "not found" "nonexistent: error message"
    }

    # -----------------------------------------------------------------------
    # Test 8: Provider in policy but not in state → error
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 8: Policy/state mismatch" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(
            Make-PolicyProvider "prov-a" "env-var"
            Make-PolicyProvider "prov-b" "env-var"
        )
        $state = Write-State $tempDir @(
            Make-StateProvider "prov-a" "available" 0 3
        )

        $r = Invoke-Rotator $policy $state @("-ProviderId", "prov-b")
        Assert ($r.exitCode -eq 1) "mismatch: exit 1"
        Assert-Contains $r.output "not found in state" "mismatch: mentions state"
    }

    # -----------------------------------------------------------------------
    # Test 9: Missing policy file → error
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 9: Missing policy file" -ForegroundColor DarkCyan
        $missingPolicy = Join-Path $tempDir "missing-policy.json"
        Remove-Item $missingPolicy -ErrorAction SilentlyContinue
        $state = Write-State $tempDir @(Make-StateProvider "prov-a" "available" 0 3)

        $r = Invoke-Rotator $missingPolicy $state @("-ProviderId", "prov-a")
        Assert ($r.exitCode -eq 2) "missing-policy: exit 2"
        Assert-Contains $r.output "Policy file not found" "missing-policy: error message"
    }

    # -----------------------------------------------------------------------
    # Test 10: Missing state file → error
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 10: Missing state file" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $missingState = Join-Path $tempDir "missing-state.json"
        Remove-Item $missingState -ErrorAction SilentlyContinue

        $r = Invoke-Rotator $policy $missingState @("-ProviderId", "prov-a")
        Assert ($r.exitCode -eq 2) "missing-state: exit 2"
        Assert-Contains $r.output "State file not found" "missing-state: error message"
    }

    # -----------------------------------------------------------------------
    # Test 11: Malformed policy JSON → error
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 11: Malformed policy JSON" -ForegroundColor DarkCyan
        $badPolicy = Join-Path $tempDir "bad-policy.json"
        Set-Content -Path $badPolicy -Value "{ invalid json" -Encoding UTF8
        $state = Write-State $tempDir @(Make-StateProvider "prov-a" "available" 0 3)

        $r = Invoke-Rotator $badPolicy $state @("-ProviderId", "prov-a")
        Assert ($r.exitCode -eq 2) "bad-policy: exit 2"
        Assert-Contains $r.output "Invalid policy JSON" "bad-policy: error message"
    }

    # -----------------------------------------------------------------------
    # Test 12: Malformed state JSON → error
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 12: Malformed state JSON" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $badState = Join-Path $tempDir "bad-state.json"
        Set-Content -Path $badState -Value "{ invalid json" -Encoding UTF8

        $r = Invoke-Rotator $policy $badState @("-ProviderId", "prov-a")
        Assert ($r.exitCode -eq 2) "bad-state: exit 2"
        Assert-Contains $r.output "Invalid state JSON" "bad-state: error message"
    }

    # -----------------------------------------------------------------------
    # Test 13: Apply creates backup file
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 13: Apply creates backup" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(Make-StateProvider "prov-a" "exhausted" 0 3 "2099-12-31T23:59:59Z" 2 3)

        $r = Invoke-Rotator $policy $state @("-ProviderId", "prov-a", "-Apply", "-ConfirmRotation")
        Assert ($r.exitCode -eq 0) "backup: exit 0"

        # Check that a backup file was created
        $stateDir = Split-Path -Parent $state
        $backups = @(Get-ChildItem -Path $stateDir -Filter "state.json.bak.*")
        Assert ($backups.Count -ge 1) "backup: backup file created"
    }

    # -----------------------------------------------------------------------
    # Test 14: Global summary recomputed after rotation
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 14: Global summary recomputation" -ForegroundColor DarkCyan
        $provA = Make-StateProvider "prov-a" "available" 1 3
        $provB = Make-StateProvider "prov-b" "exhausted" 0 2 "2099-12-31T23:59:59Z" 1 1
        $provC = Make-StateProvider "prov-c" "disabled" 0 1

        $policy = Write-Policy $tempDir @(
            Make-PolicyProvider "prov-a" "env-var"
            Make-PolicyProvider "prov-b" "env-var"
            Make-PolicyProvider "prov-c" "env-var"
        )
        $state = Write-State $tempDir @($provA, $provB, $provC) -GlobalMax 6

        $r = Invoke-Rotator $policy $state @("-ProviderId", "prov-b", "-Apply", "-ConfirmRotation")
        Assert ($r.exitCode -eq 0) "global-recompute: exit 0"

        $s = Read-StateFile $state
        Assert ($s.global.availableProviders -eq 2) "global-recompute: available=2"
        Assert ($s.global.exhaustedProviders -eq 0) "global-recompute: exhausted=0"
        Assert ($s.global.disabledProviders -eq 1) "global-recompute: disabled=1"
        Assert ($s.global.totalActiveWorkers -eq 1) "global-recompute: active=1"
        Assert ($s.global.globalMaxWorkers -eq 6) "global-recompute: maxWorkers=6"
    }

    # -----------------------------------------------------------------------
    # Test 15: Reason parameter appears in output
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 15: Reason parameter" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(Make-StateProvider "prov-a" "available" 0 3)

        $r = Invoke-Rotator $policy $state @("-ProviderId", "prov-a", "-Reason", "key compromised")
        Assert ($r.exitCode -eq 0) "reason: exit 0"
        Assert-Contains $r.output "key compromised" "reason: appears in output"
    }

    # -----------------------------------------------------------------------
    # Test 16: Reason in JSON output
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 16: Reason in JSON" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(Make-StateProvider "prov-a" "available" 0 3)

        $r = Invoke-RotatorJson $policy $state @("-ProviderId", "prov-a", "-Reason", "quota reset")
        Assert ($r.exitCode -eq 0) "reason-json: exit 0"
        Assert ($r.parsed.reason -eq "quota reset") "reason-json: reason in output"
    }

    # -----------------------------------------------------------------------
    # Test 17: Rotation plan includes validation checks
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 17: Validation checks in plan" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(Make-StateProvider "prov-a" "available" 0 3)

        $r = Invoke-RotatorJson $policy $state @("-ProviderId", "prov-a")
        Assert ($r.exitCode -eq 0) "checks: exit 0"
        Assert ($null -ne $r.parsed.plan.validationChecks) "checks: validationChecks present"
        $checks = @($r.parsed.plan.validationChecks)
        Assert ($checks.Count -eq 4) "checks: 4 checks"

        $checkNames = @($checks | ForEach-Object { $_.check })
        Assert ($checkNames -contains "provider-exists-in-policy") "checks: has policy check"
        Assert ($checkNames -contains "provider-exists-in-state") "checks: has state check"
        Assert ($checkNames -contains "state-file-writable") "checks: has writable check"
        Assert ($checkNames -contains "secret-source-exists") "checks: has secret check"
    }

    # -----------------------------------------------------------------------
    # Test 18: Rotation plan includes backup plan
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 18: Backup plan in preview" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(Make-StateProvider "prov-a" "available" 0 3)

        $r = Invoke-RotatorJson $policy $state @("-ProviderId", "prov-a")
        Assert ($r.exitCode -eq 0) "backup-plan: exit 0"
        Assert ($r.parsed.plan.backupPlan -ne $null) "backup-plan: present"
        Assert ($r.parsed.plan.backupPlan.willBackupState -eq $true) "backup-plan: willBackupState=true"
        Assert ($r.parsed.plan.backupPlan.backupPath -ne $null) "backup-plan: backupPath set"
    }

    # -----------------------------------------------------------------------
    # Test 19: Concurrency preserved after rotation
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 19: Concurrency preserved" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(Make-StateProvider "prov-a" "available" 2 3)

        $r = Invoke-Rotator $policy $state @("-ProviderId", "prov-a", "-Apply", "-ConfirmRotation")
        Assert ($r.exitCode -eq 0) "concurrency: exit 0"

        $s = Read-StateFile $state
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.currentConcurrency -eq 2) "concurrency: preserved at 2"
    }

    # -----------------------------------------------------------------------
    # Test 20: totalQuotaEvents preserved after rotation
    # -----------------------------------------------------------------------

    & {
        Write-Host "--- Test 20: totalQuotaEvents preserved" -ForegroundColor DarkCyan
        $policy = Write-Policy $tempDir @(Make-PolicyProvider "prov-a" "env-var")
        $state  = Write-State $tempDir @(
            Make-StateProvider "prov-a" "exhausted" 0 3 "2099-12-31T23:59:59Z" 5 12
        )

        $r = Invoke-Rotator $policy $state @("-ProviderId", "prov-a", "-Apply", "-ConfirmRotation")
        Assert ($r.exitCode -eq 0) "quota-events: exit 0"

        $s = Read-StateFile $state
        $p = $s.providers | Where-Object { $_.id -eq "prov-a" }
        Assert ($p.totalQuotaEvents -eq 12) "quota-events: preserved at 12"
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
