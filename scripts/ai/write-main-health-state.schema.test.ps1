<#
.SYNOPSIS
    Schema fixture coverage tests for write-main-health-state.ps1.

.DESCRIPTION
    Exercises the main health state writer's schema validation against a set of
    fixture cases covering every state, validation rule, and edge case defined in
    schemas/health-state.schema.json and the writer's procedural checks.

    Each fixture invokes the writer in -ValidateOnly mode (no file writes) and
    asserts the expected exit code. A summary is printed at the end.

    This script is the acceptance gate for issue #455.

.EXAMPLE
    pwsh ./scripts/ai/write-main-health-state.schema.test.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$writerPath = Join-Path $scriptDir "write-main-health-state.ps1"
$passCount = 0
$failCount = 0
$results = @()

function Invoke-Fixture {
    param(
        [string]$Name,
        [string[]]$Arguments,
        [int]$ExpectedExitCode
    )

    $stdout = ""
    $stderr = ""
    $exitCode = 0

    try {
        $output = & pwsh -NoProfile -File $writerPath @Arguments 2>&1
        $exitCode = $LASTEXITCODE
        $stdout = ($output | Out-String).Trim()
    } catch {
        $exitCode = 1
        $stderr = $_.Exception.Message
    }

    $passed = ($exitCode -eq $ExpectedExitCode)
    $status = if ($passed) { "PASS" } else { "FAIL" }

    $script:results += [ordered]@{
        name     = $Name
        status   = $status
        expected = $ExpectedExitCode
        actual   = $exitCode
    }

    if ($passed) {
        $script:passCount++
        Write-Host "[PASS] $Name" -ForegroundColor Green
    } else {
        $script:failCount++
        Write-Host "[FAIL] $Name (expected exit $ExpectedExitCode, got $exitCode)" -ForegroundColor Red
        if ($stdout) { Write-Host "  stdout: $stdout" -ForegroundColor DarkGray }
        if ($stderr) { Write-Host "  stderr: $stderr" -ForegroundColor DarkGray }
    }
}

# ===========================================================================
# Fixture definitions
# ===========================================================================

Write-Host ""
Write-Host "=== write-main-health-state schema fixture tests ===" -ForegroundColor Cyan
Write-Host ""

# --- Green state fixtures ---

Invoke-Fixture -Name "green: minimal valid marker" -Arguments @(
    "-State", "green",
    "-CommitSha", "abc1234",
    "-Checks", "tsc,build",
    "-ValidateOnly"
) -ExpectedExitCode 0

Invoke-Fixture -Name "green: all checks pass, empty failedChecks" -Arguments @(
    "-State", "green",
    "-CommitSha", "aabbccddee",
    "-Checks", "tsc,build,prisma,test",
    "-FailedChecks", "",
    "-ValidateOnly"
) -ExpectedExitCode 0

Invoke-Fixture -Name "green: with reason" -Arguments @(
    "-State", "green",
    "-CommitSha", "abc1234",
    "-Checks", "tsc",
    "-Reason", "All checks passed after recovery",
    "-ValidateOnly"
) -ExpectedExitCode 0

Invoke-Fixture -Name "green: explicit allowedWorkerClasses=all" -Arguments @(
    "-State", "green",
    "-CommitSha", "abc1234",
    "-Checks", "tsc",
    "-AllowedWorkerClasses", "all",
    "-ValidateOnly"
) -ExpectedExitCode 0

Invoke-Fixture -Name "green: 40-char SHA (max length)" -Arguments @(
    "-State", "green",
    "-CommitSha", "abcdef0123456789abcdef0123456789abcdef01",
    "-Checks", "tsc",
    "-ValidateOnly"
) -ExpectedExitCode 0

Invoke-Fixture -Name "green: 7-char SHA (min length)" -Arguments @(
    "-State", "green",
    "-CommitSha", "abc1234",
    "-Checks", "tsc",
    "-ValidateOnly"
) -ExpectedExitCode 0

# --- Yellow state fixtures ---

Invoke-Fixture -Name "yellow: single failed check" -Arguments @(
    "-State", "yellow",
    "-CommitSha", "abc1234",
    "-Checks", "tsc,build,prisma",
    "-FailedChecks", "prisma",
    "-ValidateOnly"
) -ExpectedExitCode 0

Invoke-Fixture -Name "yellow: default allowedWorkerClasses" -Arguments @(
    "-State", "yellow",
    "-CommitSha", "abc1234",
    "-Checks", "tsc",
    "-FailedChecks", "tsc",
    "-ValidateOnly"
) -ExpectedExitCode 0

Invoke-Fixture -Name "yellow: explicit allowedWorkerClasses=fix-only,docs" -Arguments @(
    "-State", "yellow",
    "-CommitSha", "abc1234",
    "-Checks", "tsc,build",
    "-FailedChecks", "build",
    "-AllowedWorkerClasses", "fix-only,docs",
    "-ValidateOnly"
) -ExpectedExitCode 0

Invoke-Fixture -Name "yellow: with reason" -Arguments @(
    "-State", "yellow",
    "-CommitSha", "abc1234",
    "-Checks", "tsc,build",
    "-FailedChecks", "build",
    "-Reason", "Boundary guard warning",
    "-ValidateOnly"
) -ExpectedExitCode 0

# --- Red state fixtures ---

Invoke-Fixture -Name "red: multiple failed checks" -Arguments @(
    "-State", "red",
    "-CommitSha", "abc1234",
    "-Checks", "tsc,build,prisma",
    "-FailedChecks", "tsc,build",
    "-ValidateOnly"
) -ExpectedExitCode 0

Invoke-Fixture -Name "red: empty allowedWorkerClasses" -Arguments @(
    "-State", "red",
    "-CommitSha", "abc1234",
    "-Checks", "tsc",
    "-FailedChecks", "tsc",
    "-AllowedWorkerClasses", "",
    "-ValidateOnly"
) -ExpectedExitCode 0

Invoke-Fixture -Name "red: with reason" -Arguments @(
    "-State", "red",
    "-CommitSha", "abc1234",
    "-Checks", "tsc,build",
    "-FailedChecks", "tsc,build",
    "-Reason", "Type-check and build broken",
    "-ValidateOnly"
) -ExpectedExitCode 0

# --- Black state fixtures ---

Invoke-Fixture -Name "black: unrecoverable state" -Arguments @(
    "-State", "black",
    "-CommitSha", "abc1234",
    "-Checks", "tsc,build",
    "-FailedChecks", "tsc,build",
    "-ValidateOnly"
) -ExpectedExitCode 0

Invoke-Fixture -Name "black: empty checks and failedChecks" -Arguments @(
    "-State", "black",
    "-CommitSha", "abc1234",
    "-Checks", "",
    "-FailedChecks", "",
    "-ValidateOnly"
) -ExpectedExitCode 0

# --- Validation failure fixtures (expect exit 1) ---

Invoke-Fixture -Name "reject: invalid SHA (too short)" -Arguments @(
    "-State", "green",
    "-CommitSha", "abc12",
    "-Checks", "tsc",
    "-ValidateOnly"
) -ExpectedExitCode 1

Invoke-Fixture -Name "reject: invalid SHA (non-hex)" -Arguments @(
    "-State", "green",
    "-CommitSha", "zzzzzzz",
    "-Checks", "tsc",
    "-ValidateOnly"
) -ExpectedExitCode 1

Invoke-Fixture -Name "reject: invalid SHA (too long)" -Arguments @(
    "-State", "green",
    "-CommitSha", "abcdef0123456789abcdef0123456789abcdef012",
    "-Checks", "tsc",
    "-ValidateOnly"
) -ExpectedExitCode 1

Invoke-Fixture -Name "reject: failedCheck not in checks" -Arguments @(
    "-State", "yellow",
    "-CommitSha", "abc1234",
    "-Checks", "tsc,build",
    "-FailedChecks", "prisma",
    "-ValidateOnly"
) -ExpectedExitCode 1

Invoke-Fixture -Name "reject: failedChecks provided but checks empty" -Arguments @(
    "-State", "red",
    "-CommitSha", "abc1234",
    "-Checks", "",
    "-FailedChecks", "tsc",
    "-ValidateOnly"
) -ExpectedExitCode 1

Invoke-Fixture -Name "reject: invalid allowedWorkerClass" -Arguments @(
    "-State", "green",
    "-CommitSha", "abc1234",
    "-Checks", "tsc",
    "-AllowedWorkerClasses", "invalid-class",
    "-ValidateOnly"
) -ExpectedExitCode 1

# --- DryRun mode fixture ---

Invoke-Fixture -Name "dryrun: green state prints JSON" -Arguments @(
    "-State", "green",
    "-CommitSha", "abc1234",
    "-Checks", "tsc,build",
    "-DryRun"
) -ExpectedExitCode 0

Invoke-Fixture -Name "dryrun: red state prints JSON" -Arguments @(
    "-State", "red",
    "-CommitSha", "abc1234",
    "-Checks", "tsc",
    "-FailedChecks", "tsc",
    "-DryRun"
) -ExpectedExitCode 0

# ===========================================================================
# Summary
# ===========================================================================

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "  Passed: $passCount" -ForegroundColor Green
Write-Host "  Failed: $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })
Write-Host "  Total:  $($passCount + $failCount)"
Write-Host ""

if ($failCount -gt 0) {
    Write-Host "FAILED fixtures:" -ForegroundColor Red
    foreach ($r in $script:results) {
        if ($r.status -eq "FAIL") {
            Write-Host "  - $($r.name) (expected=$($r.expected), actual=$($r.actual))" -ForegroundColor Red
        }
    }
    Write-Host ""
    exit 1
}

Write-Host "All fixtures passed." -ForegroundColor Green
exit 0
