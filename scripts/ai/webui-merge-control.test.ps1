<#
.SYNOPSIS
    Fixture-based tests for WebUI merge control wrapper.
    Validates allowlist resolution, manifest structure, and mode semantics
    without contacting GitHub or performing real merges.

.DESCRIPTION
    Exercises the core functions of webui-merge-control.ps1 with controlled
    fixtures covering all documented paths:

    - Inline allowlist resolution
    - File-based allowlist resolution (comments, blanks, valid entries)
    - Allowlist error cases (empty file, invalid entries, missing file)
    - WebUI manifest structure (schema version, batch ID, mode, PR numbers)
    - WebUI manifest with failure (health gate fail, guard fail)
    - Manifest JSON validity
    - Confirmation abort path (simulated)

    Each test constructs a fixture, invokes the function, and asserts expected
    values. Exit code 0 = all passed, non-zero = at least one failure.

.EXAMPLE
    pwsh ./scripts/ai/webui-merge-control.test.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Source the script functions (suppress Main execution)
# ---------------------------------------------------------------------------

$scriptPath = Join-Path $PSScriptRoot 'webui-merge-control.ps1'
if (-not (Test-Path $scriptPath)) {
    Write-Host "FATAL: webui-merge-control.ps1 not found at $scriptPath"
    exit 1
}

# Extract function definitions by dot-sourcing with Main suppression
$scriptContent = Get-Content $scriptPath -Raw
$scriptContent = $scriptContent -replace '(?s)\r?\nMain\r?\n$', "`n# Main call suppressed for testing`n"
Invoke-Expression $scriptContent

# ---------------------------------------------------------------------------
# Test harness
# ---------------------------------------------------------------------------

$script:testDir = Join-Path ([System.IO.Path]::GetTempPath()) "webui-merge-test-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $script:testDir -Force | Out-Null

$script:pass = 0
$script:fail = 0
$script:total = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    $script:total++
    if ($Condition) {
        Write-Host "  PASS: $Message"
        $script:pass++
    } else {
        Write-Host "  FAIL: $Message"
        $script:fail++
    }
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    $script:total++
    if ($Expected -eq $Actual) {
        Write-Host "  PASS: $Message"
        $script:pass++
    } else {
        Write-Host "  FAIL: $Message (expected='$Expected', actual='$Actual')"
        $script:fail++
    }
}

function Assert-Match {
    param([string]$Pattern, [string]$Actual, [string]$Message)
    $script:total++
    if ($Actual -match $Pattern) {
        Write-Host "  PASS: $Message"
        $script:pass++
    } else {
        Write-Host "  FAIL: $Message (pattern='$Pattern', actual='$Actual')"
        $script:fail++
    }
}

function Assert-Null {
    param($Value, [string]$Message)
    $script:total++
    if ($null -eq $Value) {
        Write-Host "  PASS: $Message"
        $script:pass++
    } else {
        Write-Host "  FAIL: $Message (expected null, got='$Value')"
        $script:fail++
    }
}

function Assert-NotNull {
    param($Value, [string]$Message)
    $script:total++
    if ($null -ne $Value) {
        Write-Host "  PASS: $Message"
        $script:pass++
    } else {
        Write-Host "  FAIL: $Message (expected non-null)"
        $script:fail++
    }
}

# ---------------------------------------------------------------------------
# TEST 1: Resolve-Allowlist with inline PRs
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 1: Resolve-Allowlist with inline PRs"
$result1 = Resolve-Allowlist -InlinePRs @(42, 45) -FilePath $null
Assert-Equal 2 $result1.Count "inline allowlist returns 2 PRs"
Assert-Equal 42 $result1[0] "first PR is 42"
Assert-Equal 45 $result1[1] "second PR is 45"

# ---------------------------------------------------------------------------
# TEST 2: Resolve-Allowlist with file (comments, blanks, valid entries)
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 2: Resolve-Allowlist with file"
$allowlistFile = Join-Path $script:testDir "allowlist.txt"
@"
# This is a comment
42
45

# Another comment
51
"@ | Set-Content $allowlistFile -Encoding UTF8
$result2 = Resolve-Allowlist -InlinePRs $null -FilePath $allowlistFile
Assert-Equal 3 $result2.Count "file allowlist returns 3 PRs"
Assert-Equal 42 $result2[0] "first PR from file is 42"
Assert-Equal 45 $result2[1] "second PR from file is 45"
Assert-Equal 51 $result2[2] "third PR from file is 51"

# ---------------------------------------------------------------------------
# TEST 3: Resolve-Allowlist — empty file (should error)
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 3: Resolve-Allowlist with empty file (should error)"
$emptyFile = Join-Path $script:testDir "empty.txt"
"" | Set-Content $emptyFile -Encoding UTF8
$error3 = $null
try {
    Resolve-Allowlist -InlinePRs $null -FilePath $emptyFile
} catch {
    $error3 = $_.Exception.Message
}
Assert-NotNull $error3 "empty file raises error"

# ---------------------------------------------------------------------------
# TEST 4: Resolve-Allowlist — invalid entry (should error)
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 4: Resolve-Allowlist with invalid entry (should error)"
$invalidFile = Join-Path $script:testDir "invalid.txt"
"abc" | Set-Content $invalidFile -Encoding UTF8
$error4 = $null
try {
    Resolve-Allowlist -InlinePRs $null -FilePath $invalidFile
} catch {
    $error4 = $_.Exception.Message
}
Assert-NotNull $error4 "invalid entry raises error"

# ---------------------------------------------------------------------------
# TEST 5: Resolve-Allowlist — missing file (should error)
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 5: Resolve-Allowlist with missing file (should error)"
$error5 = $null
try {
    Resolve-Allowlist -InlinePRs $null -FilePath "C:\nonexistent\file.txt"
} catch {
    $error5 = $_.Exception.Message
}
Assert-NotNull $error5 "missing file raises error"

# ---------------------------------------------------------------------------
# TEST 6: Write-WebUIManifest structure (dry-run, success)
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 6: Write-WebUIManifest structure (dry-run, success)"
$manifestPath6 = Write-WebUIManifest -BatchId "test-batch-001" -Mode "dry-run" -PRNumbers @(42, 45) -Repository "owner/repo" -HealthResult "skipped" -GuardResult "skipped" -FailureReason $null -ManifestDir $script:testDir
$raw6 = Get-Content $manifestPath6 -Raw
$m6 = $raw6 | ConvertFrom-Json

Assert-Equal 1 $m6.schemaVersion "schemaVersion is 1"
Assert-Equal "test-batch-001" $m6.batchId "batchId is set"
Assert-Equal "dry-run" $m6.mode "mode is dry-run"
Assert-Equal "owner/repo" $m6.repository "repository is set"
Assert-Equal 2 $m6.prNumbers.Count "prNumbers has 2 entries"
Assert-Equal 42 $m6.prNumbers[0] "first PR number is 42"
Assert-Equal 45 $m6.prNumbers[1] "second PR number is 45"
Assert-Equal "skipped" $m6.healthGate "healthGate is skipped"
Assert-Equal "skipped" $m6.guards "guards is skipped"
Assert-Null $m6.failureReason "failureReason is null on success"

# ---------------------------------------------------------------------------
# TEST 7: Write-WebUIManifest — execute with failure
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 7: Write-WebUIManifest with failure"
$manifestPath7 = Write-WebUIManifest -BatchId "test-batch-002" -Mode "execute" -PRNumbers @(60) -Repository "owner/repo" -HealthResult "fail" -GuardResult "pass" -FailureReason "Health gate failed" -ManifestDir $script:testDir
$m7 = (Get-Content $manifestPath7 -Raw) | ConvertFrom-Json

Assert-Equal "execute" $m7.mode "mode is execute on failure"
Assert-Equal "fail" $m7.healthGate "healthGate is fail"
Assert-Equal "pass" $m7.guards "guards is pass"
Assert-Equal "Health gate failed" $m7.failureReason "failureReason is set"

# ---------------------------------------------------------------------------
# TEST 8: Write-WebUIManifest — manifest is valid JSON
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 8: Manifest is valid JSON"
$manifestPath8 = Write-WebUIManifest -BatchId "test-batch-003" -Mode "dry-run" -PRNumbers @(1) -Repository "r" -HealthResult "skipped" -GuardResult "skipped" -FailureReason $null -ManifestDir $script:testDir
$json8 = Get-Content $manifestPath8 -Raw
$parsed8 = $null
try {
    $parsed8 = $json8 | ConvertFrom-Json
    Assert-True ($null -ne $parsed8) "manifest is valid JSON"
} catch {
    Assert-True $false "manifest is valid JSON (parse threw: $_)"
}

# ---------------------------------------------------------------------------
# TEST 9: Write-WebUIManifest — timestamp is ISO 8601
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 9: Timestamp is ISO 8601 format"
$manifestPath9 = Write-WebUIManifest -BatchId "test-batch-004" -Mode "dry-run" -PRNumbers @(1) -Repository "r" -HealthResult "skipped" -GuardResult "skipped" -FailureReason $null -ManifestDir $script:testDir
$raw9 = Get-Content $manifestPath9 -Raw
Assert-Match '"timestamp"\s*:\s*"\d{4}-\d{2}-\d{2}T' $raw9 "timestamp is ISO 8601 format"

# ---------------------------------------------------------------------------
# TEST 10: Write-WebUIManifest — batchId pattern
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 10: batchId pattern validation"
$manifestPath10 = Write-WebUIManifest -BatchId "webui-merge-2026-05-11T22-17-21Z" -Mode "dry-run" -PRNumbers @(1) -Repository "r" -HealthResult "skipped" -GuardResult "skipped" -FailureReason $null -ManifestDir $script:testDir
$m10 = (Get-Content $manifestPath10 -Raw) | ConvertFrom-Json
Assert-Match '^webui-merge-' $m10.batchId "batchId starts with webui-merge-"

# ---------------------------------------------------------------------------
# TEST 11: Write-WebUIManifest — multiple PRs
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 11: Multiple PRs in manifest"
$manifestPath11 = Write-WebUIManifest -BatchId "test-batch-005" -Mode "dry-run" -PRNumbers @(10, 20, 30, 40, 50) -Repository "r" -HealthResult "skipped" -GuardResult "skipped" -FailureReason $null -ManifestDir $script:testDir
$m11 = (Get-Content $manifestPath11 -Raw) | ConvertFrom-Json
Assert-Equal 5 $m11.prNumbers.Count "manifest contains 5 PRs"
Assert-Equal 10 $m11.prNumbers[0] "first PR is 10"
Assert-Equal 50 $m11.prNumbers[4] "last PR is 50"

# ---------------------------------------------------------------------------
# TEST 12: Write-WebUIManifest — aborted mode
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 12: Aborted mode manifest"
$manifestPath12 = Write-WebUIManifest -BatchId "test-batch-006" -Mode "aborted" -PRNumbers @(42) -Repository "r" -HealthResult "skipped" -GuardResult "skipped" -FailureReason "User declined confirmation" -ManifestDir $script:testDir
$m12 = (Get-Content $manifestPath12 -Raw) | ConvertFrom-Json
Assert-Equal "aborted" $m12.mode "mode is aborted"
Assert-Equal "User declined confirmation" $m12.failureReason "failure reason captured"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "============================================"
Write-Host "  Results: $($script:pass) passed, $($script:fail) failed ($($script:total) total)"
Write-Host "============================================"

# Cleanup
Remove-Item -Path $script:testDir -Recurse -Force -ErrorAction SilentlyContinue

if ($script:fail -gt 0) {
    Write-Host "WEBUI MERGE CONTROL TESTS FAILED"
    exit 1
}
Write-Host "ALL WEBUI MERGE CONTROL TESTS PASSED"
exit 0
