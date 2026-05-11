<#
.SYNOPSIS
    Exercises active-worker projection drift fixtures against state-reconciler.ps1.
.DESCRIPTION
    Creates temporary fixture JSON files that cover the three projection drift
    rules (stale-worker-projection, running-missing-from-projection,
    stale-projection) plus a clean no-drift case. Invokes state-reconciler
    with -FixtureDir and asserts expected exit code and rule output.
    No network calls; fully offline.
.EXAMPLE
    pwsh ./scripts/ai/state-reconciler.active-workers.test.ps1
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$reconciler = Join-Path $scriptDir "state-reconciler.ps1"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "aw-fixtures-$(Get-Date -Format 'yyyyMMddHHmmss')"

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

try {
    # -----------------------------------------------------------------------
    # Setup: write fixture files to temp directory
    # -----------------------------------------------------------------------

    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    # Fixture 1: stale-worker-projection
    # Worker in projection but issue label is agent:done.
    # Issue is CLOSED with a merged PR so no label-based drifts fire.
    @"
{
  "description": "Worker in projection but issue is agent:done",
  "expectedRules": ["stale-worker-projection"],
  "expectedCount": 1,
  "issues": [
    {
      "number": 301,
      "title": "Completed auth work",
      "state": "CLOSED",
      "labels": [{"name": "agent:done"}],
      "updatedAt": "2026-05-10T12:00:00Z",
      "linkedPRs": [
        {
          "number": 351,
          "title": "Auth work PR",
          "state": "MERGED",
          "mergedAt": "2026-05-10T11:00:00Z"
        }
      ]
    }
  ],
  "activeWorkers": {
    "markerVersion": 1,
    "capturedAt": "2026-05-11T12:00:00Z",
    "workers": [
      {
        "conflictGroup": "auth-core",
        "issue": 301,
        "branch": "claude/wave10-issue-301"
      }
    ]
  }
}
"@ | Set-Content (Join-Path $tempDir "01-stale-worker-projection.json") -Encoding UTF8

    # Fixture 2: running-missing-from-projection
    # Issue is agent:running but has no matching entry in the projection.
    # updatedAt is recent so stale-running does not fire.
    @"
{
  "description": "agent:running issue missing from active-workers projection",
  "expectedRules": ["running-missing-from-projection"],
  "expectedCount": 1,
  "issues": [
    {
      "number": 302,
      "title": "New feature in progress",
      "state": "OPEN",
      "labels": [{"name": "agent:running"}],
      "updatedAt": "2026-05-11T10:00:00Z",
      "linkedPRs": []
    }
  ],
  "activeWorkers": {
    "markerVersion": 1,
    "capturedAt": "2026-05-11T12:00:00Z",
    "workers": []
  }
}
"@ | Set-Content (Join-Path $tempDir "02-running-missing-from-projection.json") -Encoding UTF8

    # Fixture 3: stale-projection
    # Projection capturedAt is older than the stale threshold (72h).
    # A dummy issue with no agent label is included so the fixture is not skipped.
    @"
{
  "description": "Projection timestamp exceeds stale threshold",
  "expectedRules": ["stale-projection"],
  "expectedCount": 1,
  "issues": [
    {
      "number": 304,
      "title": "Dummy issue for stale projection test",
      "state": "OPEN",
      "labels": [],
      "updatedAt": "2026-05-11T10:00:00Z",
      "linkedPRs": []
    }
  ],
  "activeWorkers": {
    "markerVersion": 1,
    "capturedAt": "2026-04-01T00:00:00Z",
    "workers": []
  }
}
"@ | Set-Content (Join-Path $tempDir "03-stale-projection.json") -Encoding UTF8

    # Fixture 4: clean -- no projection drift
    # Worker in projection matches an agent:running issue; projection is fresh.
    @"
{
  "description": "No projection drift - worker and label are consistent",
  "expectedRules": [],
  "expectedCount": 0,
  "issues": [
    {
      "number": 303,
      "title": "Healthy running issue",
      "state": "OPEN",
      "labels": [{"name": "agent:running"}],
      "updatedAt": "2026-05-11T10:00:00Z",
      "linkedPRs": []
    }
  ],
  "activeWorkers": {
    "markerVersion": 1,
    "capturedAt": "2026-05-11T12:00:00Z",
    "workers": [
      {
        "conflictGroup": "guard-infra",
        "issue": 303,
        "branch": "claude/wave10-issue-303"
      }
    ]
  }
}
"@ | Set-Content (Join-Path $tempDir "04-clean-no-projection-drift.json") -Encoding UTF8

    # -----------------------------------------------------------------------
    # Tests
    # -----------------------------------------------------------------------

    Write-Host ""
    Write-Host "=== ACTIVE WORKER FIXTURE TESTS ==="
    Write-Host ""

    # Test 1: stale-worker-projection is detected
    Invoke-Test "stale-worker-projection detected" {
        $out = & pwsh -NonInteractive -File $reconciler -FixtureDir $tempDir -StaleHours 72 2>&1
        $text = $out | Out-String
        if ($LASTEXITCODE -ne 0) { throw "Expected exit 0, got $LASTEXITCODE" }
        if ($text -notmatch "stale-worker-projection") { throw "stale-worker-projection rule not found in output" }
    }

    # Test 2: running-missing-from-projection is detected
    Invoke-Test "running-missing-from-projection detected" {
        $out = & pwsh -NonInteractive -File $reconciler -FixtureDir $tempDir -StaleHours 72 2>&1
        $text = $out | Out-String
        if ($LASTEXITCODE -ne 0) { throw "Expected exit 0, got $LASTEXITCODE" }
        if ($text -notmatch "running-missing-from-projection") { throw "running-missing-from-projection rule not found in output" }
    }

    # Test 3: stale-projection is detected
    Invoke-Test "stale-projection detected" {
        $out = & pwsh -NonInteractive -File $reconciler -FixtureDir $tempDir -StaleHours 72 2>&1
        $text = $out | Out-String
        if ($LASTEXITCODE -ne 0) { throw "Expected exit 0, got $LASTEXITCODE" }
        if ($text -notmatch "stale-projection") { throw "stale-projection rule not found in output" }
    }

    # Test 4: clean fixture passes with 0 drifts
    Invoke-Test "clean fixture shows no projection drift" {
        $out = & pwsh -NonInteractive -File $reconciler -FixtureDir $tempDir -StaleHours 72 2>&1
        $text = $out | Out-String
        if ($LASTEXITCODE -ne 0) { throw "Expected exit 0, got $LASTEXITCODE" }
        if ($text -notmatch "04-clean-no-projection-drift.json -- PASS") {
            throw "Clean fixture did not report PASS"
        }
    }

    # Test 5: all four fixtures pass validation (exit code 0)
    Invoke-Test "fixture directory validation exits 0" {
        & pwsh -NonInteractive -File $reconciler -FixtureDir $tempDir -StaleHours 72 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Expected exit 0, got $LASTEXITCODE" }
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
