<#
.SYNOPSIS
    Exercises write-mode (Apply) cases against state-reconciler.ps1.
.DESCRIPTION
    Loads test cases from write-mode-cases.json, invokes state-reconciler with
    -Apply (and/or -DryRun for the mutually-exclusive case), and asserts expected
    output strings and exit codes. Covers:
      - Single-drift suggestion output
      - Multiple-drift suggestion output
      - No-drift path (documents strict-mode null-COUNT bug in reconciler main flow)
      - Mixed issues (drift + clean)
      - Merged-PR stale-label suggestions
      - -Apply / -DryRun mutual exclusion error
    No network calls; fully offline via -FixturePath.
.EXAMPLE
    pwsh ./scripts/ai/state-reconciler.write-mode.test.ps1
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$reconciler = Join-Path $scriptDir "state-reconciler.ps1"
$fixtureFile = Join-Path $scriptDir "__fixtures__/state-reconciler/write-mode-cases.json"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "wm-fixtures-$(Get-Date -Format 'yyyyMMddHHmmss')"

$passed = 0
$failed = 0

function Invoke-Test {
    param(
        [string]$Name,
        [scriptblock]$Assertion
    )
    try {
        & $Assertion
        $script:passed++
        Write-Host "  [OK] $Name"
    } catch {
        $script:failed++
        Write-Host "  [!!] $Name -- $($_.Exception.Message)"
    }
}

function Assert-Contains {
    param([string]$Text, [string]$Pattern, [string]$Message)
    if ($Text -notmatch [regex]::Escape($Pattern)) {
        throw "$Message -- '$Pattern' not found in output"
    }
}

function Assert-NotContains {
    param([string]$Text, [string]$Pattern, [string]$Message)
    if ($Text -match [regex]::Escape($Pattern)) {
        throw "$Message -- '$Pattern' unexpectedly found in output"
    }
}

try {
    # -----------------------------------------------------------------------
    # Setup: load cases and write per-case fixture files
    # -----------------------------------------------------------------------

    if (-not (Test-Path $fixtureFile)) {
        Write-Error "Fixture file not found: $fixtureFile"
        exit 1
    }

    $cases = Get-Content $fixtureFile -Raw | ConvertFrom-Json
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    foreach ($case in $cases) {
        $caseJson = @{ issues = $case.issues } | ConvertTo-Json -Depth 10
        $casePath = Join-Path $tempDir "$($case.case).json"
        Set-Content -Path $casePath -Value $caseJson -Encoding UTF8
    }

    # -----------------------------------------------------------------------
    # Tests
    # -----------------------------------------------------------------------

    Write-Host ""
    Write-Host "=== WRITE-MODE (Apply) TESTS ==="
    Write-Host ""

    foreach ($case in $cases) {
        $caseName = $case.case
        $casePath = Join-Path $tempDir "$caseName.json"
        $expectedExit = if ($case.PSObject.Properties['expectedExitCode'] -and $null -ne $case.expectedExitCode) { $case.expectedExitCode } else { 0 }

        # Build argument list
        $pwshArgs = @("-NonInteractive", "-File", $reconciler)
        $pwshArgs += "-FixturePath", $casePath
        $pwshArgs += "-StaleHours", "72"

        $wantApply = [bool]$case.applyMode
        $wantDryRun = [bool]($case.PSObject.Properties['dryRunMode'] -and $case.dryRunMode)

        if ($wantApply -and -not $wantDryRun) {
            $pwshArgs += "-Apply"
        }
        if ($wantDryRun -and -not $wantApply) {
            $pwshArgs += "-DryRun"
        }
        if ($wantApply -and $wantDryRun) {
            $pwshArgs += "-Apply", "-DryRun"
        }

        Invoke-Test "$caseName" {
            $out = & pwsh @pwshArgs 2>&1
            $text = $out | Out-String

            # Assert exit code
            if ($LASTEXITCODE -ne $expectedExit) {
                throw "Expected exit $expectedExit, got $LASTEXITCODE`nOutput: $text"
            }

            # Assert expected strings in output
            foreach ($pattern in $case.expectedInOutput) {
                Assert-Contains -Text $text -Pattern $pattern -Message "Missing expected output"
            }

            # Assert not-expected strings absent from output
            $notExpected = if ($case.PSObject.Properties['notExpectedInOutput']) { $case.notExpectedInOutput } else { @() }
            if ($notExpected) {
                foreach ($pattern in $notExpected) {
                    Assert-NotContains -Text $text -Pattern $pattern -Message "Unexpected output found"
                }
            }
        }
    }

    # -----------------------------------------------------------------------
    # Summary
    # -----------------------------------------------------------------------

    Write-Host ""
    Write-Host "=== TEST SUMMARY ==="
    Write-Host "  Passed: $passed"
    Write-Host "  Failed: $failed"
    Write-Host "=== END TESTS ==="
    Write-Host ""

    if ($failed -gt 0) {
        exit 1
    }
    exit 0

} finally {
    # Cleanup temp directory
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
