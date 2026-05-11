<#
.SYNOPSIS
    Fixture-based tests for check-launch-gate.ps1 provider pool warning behavior.

.DESCRIPTION
    Creates temporary provider-pool.json fixtures and runs check-launch-gate.ps1
    in dry-run mode to verify that warnings are emitted correctly for exhausted,
    disabled, at-capacity, and mixed-state provider pools.

    Does NOT modify any live files. All fixtures are written to a temp directory
    and cleaned up after the test run.

.EXAMPLE
    pwsh ./scripts/ai/check-launch-gate.provider-pool.test.ps1
#>

#Requires -Version 7.0

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$passed = 0
$failed = 0
$tempDir = $null

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

# Create a minimal task JSON for gate invocation
$taskJson = @'
[
  {
    "targetIssue": 999,
    "conflictGroup": "test-fixture",
    "risk": "low",
    "allowedFiles": ["scripts/ai/test.ps1"],
    "taskType": "execution"
  }
]
'@

$gateScript = Join-Path $PSScriptRoot "check-launch-gate.ps1"

function Invoke-GateWithFixture {
    param(
        [string]$FixtureJson,
        [string]$Description
    )
    $poolFile = Join-Path $tempDir "provider-pool.json"
    Set-Content -Path $poolFile -Value $FixtureJson -Encoding UTF8

    $taskFile = Join-Path $tempDir "task.json"
    Set-Content -Path $taskFile -Value $taskJson -Encoding UTF8

    try {
        $output = & pwsh -NoProfile -File $gateScript `
            -TaskFile $taskFile `
            -ProviderPoolFile $poolFile `
            -MainState green `
            -Json 2>&1
        return $output
    } catch {
        return $_.Exception.Message
    }
}

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "check-launch-gate provider-pool fixture tests" -ForegroundColor Cyan
Write-Host ""

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "launch-gate-fixtures-$([guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {

    # -----------------------------------------------------------------------
    # Fixture: all providers available — no provider warnings
    # -----------------------------------------------------------------------

    $fixture = @{
        stateVersion = 1
        providers = @(
            @{
                id = "provider-a"
                status = "available"
                currentConcurrency = 0
                maxConcurrency = 2
            }
        )
        global = @{
            totalActiveWorkers = 0
            globalMaxWorkers = 3
        }
    } | ConvertTo-Json -Depth 4

    $out = Invoke-GateWithFixture -FixtureJson $fixture
    $report = $out | ConvertFrom-Json

    Assert ($report.providerPoolLoaded -eq $true) "all-available: providerPoolLoaded is true"
    Assert ($report.providerPoolWarnings.Count -eq 0) "all-available: no warnings"
    Assert ($report.allAllowed -eq $true) "all-available: gate passes"

    # -----------------------------------------------------------------------
    # Fixture: one exhausted provider
    # -----------------------------------------------------------------------

    $fixture = @{
        stateVersion = 1
        providers = @(
            @{
                id = "provider-a"
                status = "exhausted"
                currentConcurrency = 0
                maxConcurrency = 2
                cooldownExpiresAt = "2099-12-31T23:59:59Z"
            }
        )
        global = @{
            totalActiveWorkers = 0
            globalMaxWorkers = 3
        }
    } | ConvertTo-Json -Depth 4

    $out = Invoke-GateWithFixture -FixtureJson $fixture
    $report = $out | ConvertFrom-Json

    Assert ($report.providerPoolLoaded -eq $true) "exhausted: providerPoolLoaded is true"
    Assert ($report.providerPoolWarnings.Count -ge 1) "exhausted: at least 1 warning"
    $exhaustedWarn = $report.providerPoolWarnings | Where-Object { $_ -match "exhausted" }
    Assert ($null -ne $exhaustedWarn) "exhausted: warning mentions exhausted"

    # -----------------------------------------------------------------------
    # Fixture: one disabled provider
    # -----------------------------------------------------------------------

    $fixture = @{
        stateVersion = 1
        providers = @(
            @{
                id = "provider-a"
                status = "disabled"
                currentConcurrency = 0
                maxConcurrency = 2
            }
        )
        global = @{
            totalActiveWorkers = 0
            globalMaxWorkers = 3
        }
    } | ConvertTo-Json -Depth 4

    $out = Invoke-GateWithFixture -FixtureJson $fixture
    $report = $out | ConvertFrom-Json

    Assert ($report.providerPoolWarnings.Count -ge 1) "disabled: at least 1 warning"
    $disabledWarn = $report.providerPoolWarnings | Where-Object { $_ -match "disabled" }
    Assert ($null -ne $disabledWarn) "disabled: warning mentions disabled"

    # -----------------------------------------------------------------------
    # Fixture: provider at capacity
    # -----------------------------------------------------------------------

    $fixture = @{
        stateVersion = 1
        providers = @(
            @{
                id = "provider-a"
                status = "available"
                currentConcurrency = 2
                maxConcurrency = 2
            }
        )
        global = @{
            totalActiveWorkers = 2
            globalMaxWorkers = 3
        }
    } | ConvertTo-Json -Depth 4

    $out = Invoke-GateWithFixture -FixtureJson $fixture
    $report = $out | ConvertFrom-Json

    Assert ($report.providerPoolWarnings.Count -ge 1) "at-capacity: at least 1 warning"
    $capacityWarn = $report.providerPoolWarnings | Where-Object { $_ -match "capacity" }
    Assert ($null -ne $capacityWarn) "at-capacity: warning mentions capacity"

    # -----------------------------------------------------------------------
    # Fixture: all providers exhausted — CRITICAL warning
    # -----------------------------------------------------------------------

    $fixture = @{
        stateVersion = 1
        providers = @(
            @{
                id = "provider-a"
                status = "exhausted"
                currentConcurrency = 0
                maxConcurrency = 2
                cooldownExpiresAt = "2099-12-31T23:59:59Z"
            },
            @{
                id = "provider-b"
                status = "exhausted"
                currentConcurrency = 0
                maxConcurrency = 1
                cooldownExpiresAt = "2099-12-31T23:59:59Z"
            }
        )
        global = @{
            totalActiveWorkers = 0
            globalMaxWorkers = 3
        }
    } | ConvertTo-Json -Depth 4

    $out = Invoke-GateWithFixture -FixtureJson $fixture
    $report = $out | ConvertFrom-Json

    Assert ($report.providerPoolWarnings.Count -ge 3) "all-exhausted: at least 3 warnings (2 per-provider + 1 critical)"
    $criticalWarn = $report.providerPoolWarnings | Where-Object { $_ -match "CRITICAL" }
    Assert ($null -ne $criticalWarn) "all-exhausted: CRITICAL warning present"

    # -----------------------------------------------------------------------
    # Fixture: all providers disabled — CRITICAL warning
    # -----------------------------------------------------------------------

    $fixture = @{
        stateVersion = 1
        providers = @(
            @{
                id = "provider-a"
                status = "disabled"
                currentConcurrency = 0
                maxConcurrency = 2
            },
            @{
                id = "provider-b"
                status = "disabled"
                currentConcurrency = 0
                maxConcurrency = 1
            }
        )
        global = @{
            totalActiveWorkers = 0
            globalMaxWorkers = 3
        }
    } | ConvertTo-Json -Depth 4

    $out = Invoke-GateWithFixture -FixtureJson $fixture
    $report = $out | ConvertFrom-Json

    $criticalWarn = $report.providerPoolWarnings | Where-Object { $_ -match "CRITICAL" }
    Assert ($null -ne $criticalWarn) "all-disabled: CRITICAL warning present"

    # -----------------------------------------------------------------------
    # Fixture: mixed states — one available, one exhausted
    # -----------------------------------------------------------------------

    $fixture = @{
        stateVersion = 1
        providers = @(
            @{
                id = "provider-a"
                status = "available"
                currentConcurrency = 0
                maxConcurrency = 2
            },
            @{
                id = "provider-b"
                status = "exhausted"
                currentConcurrency = 0
                maxConcurrency = 1
                cooldownExpiresAt = "2099-12-31T23:59:59Z"
            }
        )
        global = @{
            totalActiveWorkers = 0
            globalMaxWorkers = 3
        }
    } | ConvertTo-Json -Depth 4

    $out = Invoke-GateWithFixture -FixtureJson $fixture
    $report = $out | ConvertFrom-Json

    Assert ($report.providerPoolWarnings.Count -eq 1) "mixed: exactly 1 warning (exhausted provider only)"
    $exhaustedWarn = $report.providerPoolWarnings | Where-Object { $_ -match "exhausted" }
    Assert ($null -ne $exhaustedWarn) "mixed: warning is for exhausted provider"
    $criticalWarn = $report.providerPoolWarnings | Where-Object { $_ -match "CRITICAL" }
    Assert ($null -eq $criticalWarn) "mixed: no CRITICAL warning (some providers available)"

    # -----------------------------------------------------------------------
    # Fixture: empty providers array
    # -----------------------------------------------------------------------

    $fixture = @{
        stateVersion = 1
        providers = @()
        global = @{
            totalActiveWorkers = 0
            globalMaxWorkers = 3
        }
    } | ConvertTo-Json -Depth 4

    $out = Invoke-GateWithFixture -FixtureJson $fixture
    $report = $out | ConvertFrom-Json

    Assert ($report.providerPoolLoaded -eq $true) "empty-providers: providerPoolLoaded is true"
    Assert ($report.providerPoolWarnings.Count -eq 0) "empty-providers: no warnings (no providers to warn about)"

    # -----------------------------------------------------------------------
    # Fixture: exhausted provider with expired cooldown
    # -----------------------------------------------------------------------

    $fixture = @{
        stateVersion = 1
        providers = @(
            @{
                id = "provider-a"
                status = "exhausted"
                currentConcurrency = 0
                maxConcurrency = 2
                cooldownExpiresAt = "2020-01-01T00:00:00Z"
            }
        )
        global = @{
            totalActiveWorkers = 0
            globalMaxWorkers = 3
        }
    } | ConvertTo-Json -Depth 4

    $out = Invoke-GateWithFixture -FixtureJson $fixture
    $report = $out | ConvertFrom-Json

    $exhaustedWarn = $report.providerPoolWarnings | Where-Object { $_ -match "exhausted" }
    Assert ($null -ne $exhaustedWarn) "expired-cooldown: still reports exhausted warning"

    # -----------------------------------------------------------------------
    # Fixture: missing provider pool file — graceful skip
    # -----------------------------------------------------------------------

    $missingFile = Join-Path $tempDir "nonexistent-pool.json"
    $taskFile = Join-Path $tempDir "task-missing.json"
    Set-Content -Path $taskFile -Value $taskJson -Encoding UTF8

    $out = & pwsh -NoProfile -File $gateScript `
        -TaskFile $taskFile `
        -ProviderPoolFile $missingFile `
        -MainState green `
        -Json 2>&1
    $report = $out | ConvertFrom-Json

    Assert ($report.providerPoolLoaded -eq $false) "missing-file: providerPoolLoaded is false"
    Assert ($report.providerPoolWarnings.Count -eq 0) "missing-file: no warnings"

    # -----------------------------------------------------------------------
    # Fixture: malformed provider pool JSON — graceful skip
    # -----------------------------------------------------------------------

    $malformedFile = Join-Path $tempDir "malformed-pool.json"
    Set-Content -Path $malformedFile -Value "{ invalid json" -Encoding UTF8
    $taskFile = Join-Path $tempDir "task-malformed.json"
    Set-Content -Path $taskFile -Value $taskJson -Encoding UTF8

    $out = & pwsh -NoProfile -File $gateScript `
        -TaskFile $taskFile `
        -ProviderPoolFile $malformedFile `
        -MainState green `
        -Json 2>&1
    $report = $out | ConvertFrom-Json

    Assert ($report.providerPoolLoaded -eq $false) "malformed-json: providerPoolLoaded is false"
    Assert ($report.providerPoolWarnings.Count -eq 0) "malformed-json: no warnings"

    # -----------------------------------------------------------------------
    # DryRun mode: fixture warnings appear in dry-run output
    # -----------------------------------------------------------------------

    $fixture = @{
        stateVersion = 1
        providers = @(
            @{
                id = "provider-a"
                status = "exhausted"
                currentConcurrency = 0
                maxConcurrency = 2
                cooldownExpiresAt = "2099-12-31T23:59:59Z"
            }
        )
        global = @{
            totalActiveWorkers = 0
            globalMaxWorkers = 3
        }
    } | ConvertTo-Json -Depth 4

    $poolFile = Join-Path $tempDir "provider-pool-dryrun.json"
    Set-Content -Path $poolFile -Value $fixture -Encoding UTF8
    $taskFile = Join-Path $tempDir "task-dryrun.json"
    Set-Content -Path $taskFile -Value $taskJson -Encoding UTF8

    $dryOut = & pwsh -NoProfile -File $gateScript `
        -TaskFile $taskFile `
        -ProviderPoolFile $poolFile `
        -MainState green `
        -Json `
        -DryRun 2>&1
    $dryReport = $dryOut | ConvertFrom-Json

    Assert ($dryReport.mode -eq "dry-run") "dry-run: mode is dry-run"
    Assert ($dryReport.providerPoolLoaded -eq $true) "dry-run: providerPoolLoaded is true"
    Assert ($dryReport.providerPoolWarnings.Count -ge 1) "dry-run: warnings present in dry-run output"

    # -----------------------------------------------------------------------
    # Fixture: at-capacity with exhausted — both warnings emitted
    # -----------------------------------------------------------------------

    $fixture = @{
        stateVersion = 1
        providers = @(
            @{
                id = "provider-a"
                status = "available"
                currentConcurrency = 2
                maxConcurrency = 2
            },
            @{
                id = "provider-b"
                status = "exhausted"
                currentConcurrency = 0
                maxConcurrency = 1
                cooldownExpiresAt = "2099-12-31T23:59:59Z"
            }
        )
        global = @{
            totalActiveWorkers = 2
            globalMaxWorkers = 3
        }
    } | ConvertTo-Json -Depth 4

    $out = Invoke-GateWithFixture -FixtureJson $fixture
    $report = $out | ConvertFrom-Json

    $capacityWarn = $report.providerPoolWarnings | Where-Object { $_ -match "capacity" }
    $exhaustedWarn = $report.providerPoolWarnings | Where-Object { $_ -match "exhausted" }
    Assert ($null -ne $capacityWarn) "at-capacity+exhausted: capacity warning present"
    Assert ($null -ne $exhaustedWarn) "at-capacity+exhausted: exhausted warning present"

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
