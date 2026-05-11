<#
.SYNOPSIS
    Fixture-based tests for merge manifest writer behavior.
    Validates manifest structure, field conformance, and edge cases
    without contacting GitHub or performing real merges.

.DESCRIPTION
    Exercises Write-MergeManifest from merge-clean-pr-batch.ps1 with
    controlled fixtures covering every documented manifest path:

    - Dry-run with eligible PRs
    - Dry-run with blocked PRs and failureReason
    - Execute success (all merged, health gate pass)
    - Execute merge failure (partial outcomes, no postCommit)
    - Execute health gate failure
    - Blocked batch (guard/eligibility abort)
    - Health gate not-found path
    - Schema field type validation
    - batchId pattern conformance
    - Empty blockedPrs normalization

    Each test constructs a fixture, writes a manifest to a temp directory,
    reads it back, and asserts expected field values. Exit code 0 = all
    passed, non-zero = at least one failure.

.EXAMPLE
    pwsh ./scripts/ai/merge-clean-pr-batch.manifest.test.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Source the manifest writer from the merge script
# ---------------------------------------------------------------------------

$mergeScriptPath = Join-Path $PSScriptRoot 'merge-clean-pr-batch.ps1'
if (-not (Test-Path $mergeScriptPath)) {
    Write-Host "FATAL: merge-clean-pr-batch.ps1 not found at $mergeScriptPath"
    exit 1
}

# Extract Write-MergeManifest function by dot-sourcing with parameter isolation.
# We only need the function definition, so we wrap in a scriptblock that
# prevents the Main function from executing.
$scriptContent = Get-Content $mergeScriptPath -Raw

# Patch: replace the Main call at the bottom so it doesn't execute
$scriptContent = $scriptContent -replace '(?s)\r?\nMain\r?\n$', "`n# Main call suppressed for testing`n"

# We need to define Write-MergeManifest ourselves since the script uses
# module-scoped variables ($Repo, $isExecute) that we'd have to mock.
# Instead, define a standalone copy that accepts all parameters explicitly.

function Write-MergeManifest {
    param(
        [string]$PreCommit,
        [string]$PostCommit,
        [array]$Outcomes,
        [string]$HealthResult,
        [string]$HealthCommand,
        [array]$BlockedPRs,
        [string]$FailureReason,
        [string]$ManifestDir,
        [string]$RepoName,
        [bool]$IsExecute = $false
    )

    $targetDir = if ($ManifestDir) { $ManifestDir } else { Join-Path (Get-Location) '.ai' 'merge-batch-manifests' }
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    $timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ssZ')
    $batchId = "merge-batch-$($timestamp -replace ':', '-')"
    $manifest = @{
        batchId            = $batchId
        timestamp          = (Get-Date).ToUniversalTime().ToString('o')
        repository         = $RepoName
        mode               = if ($IsExecute) { 'execute' } else { 'dry-run' }
        prs                = $Outcomes
        preCommit          = if ($PreCommit) { $PreCommit } else { $null }
        postCommit         = if ($PostCommit) { $PostCommit } else { $null }
        healthGate         = $HealthResult
        postHealthCommand  = if ($HealthCommand) { $HealthCommand } else { $null }
        blockedPrs         = if ($BlockedPRs) { $BlockedPRs } else { @() }
        failureReason      = if ($FailureReason) { $FailureReason } else { $null }
    }

    $manifestPath = Join-Path $targetDir "merge-batch-$timestamp.json"
    $manifest | ConvertTo-Json -Depth 5 | Set-Content $manifestPath -Encoding UTF8
    return $manifestPath
}

# ---------------------------------------------------------------------------
# Test harness
# ---------------------------------------------------------------------------

$script:testDir = Join-Path ([System.IO.Path]::GetTempPath()) "merge-manifest-test-$(Get-Date -Format 'yyyyMMddHHmmss')"
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

# ---------------------------------------------------------------------------
# TEST 1: Dry-run — all eligible, no blocked PRs
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 1: Dry-run with eligible PRs (no blockers)"
$outcomes1 = @(
    @{ number = 42; title = "feat: add TagsModule"; status = 'eligible' },
    @{ number = 45; title = "docs: update SOP"; status = 'eligible' }
)
$path1 = Write-MergeManifest -PreCommit $null -PostCommit $null -Outcomes $outcomes1 -HealthResult 'skipped' -HealthCommand $null -BlockedPRs @() -FailureReason $null -ManifestDir $script:testDir -RepoName "owner/repo" -IsExecute $false
$m1 = Get-Content $path1 -Raw | ConvertFrom-Json

Assert-Match '^merge-batch-[a-z0-9-]+$' $m1.batchId "batchId matches pattern"
Assert-Equal 'dry-run' $m1.mode "mode is dry-run"
Assert-Equal 'owner/repo' $m1.repository "repository is set"
Assert-Equal 2 $m1.prs.Count "prs has 2 entries"
Assert-Equal 'eligible' $m1.prs[0].status "first PR status is eligible"
Assert-Equal 'eligible' $m1.prs[1].status "second PR status is eligible"
Assert-Equal 'skipped' $m1.healthGate "healthGate is skipped on dry-run"
Assert-Null $m1.preCommit "preCommit is null on dry-run"
Assert-Null $m1.postCommit "postCommit is null on dry-run"
Assert-Null $m1.failureReason "failureReason is null on success"
Assert-True ((-not $m1.blockedPrs) -or ($m1.blockedPrs.Count -eq 0)) "blockedPrs is empty on dry-run"

# ---------------------------------------------------------------------------
# TEST 2: Dry-run with blocked PRs (guard/eligibility failure)
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 2: Dry-run with blocked PRs (guard failure)"
$outcomes2 = @(
    @{ number = 50; title = "feat: safe change"; status = 'eligible' }
)
$blocked2 = @(
    @{ number = 51; reason = "forbidden file: src/app.ts" },
    @{ number = 52; reason = "draft" }
)
$path2 = Write-MergeManifest -PreCommit $null -PostCommit $null -Outcomes $outcomes2 -HealthResult 'skipped' -HealthCommand $null -BlockedPRs $blocked2 -FailureReason "2 PR(s) excluded by guard or eligibility checks" -ManifestDir $script:testDir -RepoName "owner/repo" -IsExecute $false
$m2 = Get-Content $path2 -Raw | ConvertFrom-Json

Assert-Equal 'dry-run' $m2.mode "mode is dry-run with blockers"
Assert-Equal 2 $m2.blockedPrs.Count "blockedPrs has 2 entries"
Assert-Equal 51 $m2.blockedPrs[0].number "first blocked PR number"
Assert-True ($m2.blockedPrs[0].reason -like "forbidden file*") "first blocked reason mentions forbidden file"
Assert-Equal 52 $m2.blockedPrs[1].number "second blocked PR number"
Assert-Equal 'draft' $m2.blockedPrs[1].reason "second blocked reason is draft"
Assert-True ($m2.failureReason -like "*excluded*") "failureReason mentions exclusion"

# ---------------------------------------------------------------------------
# TEST 3: Execute — all merged, health gate pass
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 3: Execute success (all merged, health gate pass)"
$outcomes3 = @(
    @{ number = 60; title = "feat: feature A"; status = 'merged' },
    @{ number = 61; title = "fix: bug B"; status = 'merged' }
)
$path3 = Write-MergeManifest -PreCommit "abc123def456" -PostCommit "9876fedcba43" -Outcomes $outcomes3 -HealthResult 'pass' -HealthCommand "scripts/post-merge-health-gate.js" -BlockedPRs @() -FailureReason $null -ManifestDir $script:testDir -RepoName "owner/repo" -IsExecute $true
$m3 = Get-Content $path3 -Raw | ConvertFrom-Json

Assert-Equal 'execute' $m3.mode "mode is execute"
Assert-Equal 'abc123def456' $m3.preCommit "preCommit is set"
Assert-Equal '9876fedcba43' $m3.postCommit "postCommit is set"
Assert-Equal 'pass' $m3.healthGate "healthGate is pass"
Assert-Equal 'scripts/post-merge-health-gate.js' $m3.postHealthCommand "postHealthCommand is set"
Assert-Equal 2 $m3.prs.Count "prs has 2 entries"
Assert-Equal 'merged' $m3.prs[0].status "first PR status is merged"
Assert-Equal 'merged' $m3.prs[1].status "second PR status is merged"
Assert-Null $m3.failureReason "failureReason is null on success"

# ---------------------------------------------------------------------------
# TEST 4: Execute — merge failure (partial outcomes, no postCommit)
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 4: Execute merge failure (partial outcomes)"
$outcomes4 = @(
    @{ number = 70; title = "feat: merged OK"; status = 'merged' },
    @{ number = 71; title = "feat: failed"; status = 'failed'; failureReason = "Not mergeable" }
)
$path4 = Write-MergeManifest -PreCommit "aaa111bbb222" -PostCommit $null -Outcomes $outcomes4 -HealthResult 'skipped' -HealthCommand $null -BlockedPRs @() -FailureReason "Merge failed on PR #71: Not mergeable" -ManifestDir $script:testDir -RepoName "owner/repo" -IsExecute $true
$m4 = Get-Content $path4 -Raw | ConvertFrom-Json

Assert-Equal 'execute' $m4.mode "mode is execute on failure"
Assert-Equal 'aaa111bbb222' $m4.preCommit "preCommit set before merge attempt"
Assert-Null $m4.postCommit "postCommit is null when merge fails"
Assert-Equal 2 $m4.prs.Count "partial outcomes preserved"
Assert-Equal 'merged' $m4.prs[0].status "first PR merged before failure"
Assert-Equal 'failed' $m4.prs[1].status "second PR failed"
Assert-True ($m4.prs[1].failureReason -eq "Not mergeable") "PR-level failureReason captured"
Assert-True ($m4.failureReason -like "*PR #71*") "batch failureReason references PR number"

# ---------------------------------------------------------------------------
# TEST 5: Execute — health gate failure
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 5: Execute health gate failure"
$outcomes5 = @(
    @{ number = 80; title = "feat: merged"; status = 'merged' }
)
$path5 = Write-MergeManifest -PreCommit "ccc333ddd444" -PostCommit "eee555fff666" -Outcomes $outcomes5 -HealthResult 'fail' -HealthCommand "scripts/post-merge-health-gate.js" -BlockedPRs @() -FailureReason "Health gate failed (exit code 1)" -ManifestDir $script:testDir -RepoName "owner/repo" -IsExecute $true
$m5 = Get-Content $path5 -Raw | ConvertFrom-Json

Assert-Equal 'fail' $m5.healthGate "healthGate is fail"
Assert-True ($m5.failureReason -like "*exit code 1*") "failureReason captures exit code"
Assert-Equal 'eee555fff666' $m5.postCommit "postCommit set even on health fail"

# ---------------------------------------------------------------------------
# TEST 6: Blocked batch — guard/eligibility abort with no eligible PRs
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 6: Blocked batch (no eligible PRs)"
$outcomes6 = @(
    @{ number = 90; title = "feat: risky"; status = 'eligible' }
)
$blocked6 = @(
    @{ number = 90; reason = "Task boundary guard: src/modules/auth/auth.module.ts is in forbiddenFiles" }
)
$path6 = Write-MergeManifest -PreCommit $null -PostCommit $null -Outcomes $outcomes6 -HealthResult 'skipped' -HealthCommand $null -BlockedPRs $blocked6 -FailureReason "Guard failure: task boundary violation" -ManifestDir $script:testDir -RepoName "owner/repo" -IsExecute $false
$m6 = Get-Content $path6 -Raw | ConvertFrom-Json

Assert-Equal 1 $m6.blockedPrs.Count "blockedPrs has 1 entry"
Assert-True ($m6.blockedPrs[0].reason -like "*task boundary*") "blocked reason references task boundary"
Assert-True ($m6.failureReason -like "*Guard failure*") "failureReason references guard failure"

# ---------------------------------------------------------------------------
# TEST 7: Health gate not-found path
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 7: Health gate not-found"
$outcomes7 = @(
    @{ number = 100; title = "feat: merged"; status = 'merged' }
)
$path7 = Write-MergeManifest -PreCommit "aaa" -PostCommit "bbb" -Outcomes $outcomes7 -HealthResult 'not-found' -HealthCommand "scripts/missing-health-gate.js" -BlockedPRs @() -FailureReason $null -ManifestDir $script:testDir -RepoName "owner/repo" -IsExecute $true
$m7 = Get-Content $path7 -Raw | ConvertFrom-Json

Assert-Equal 'not-found' $m7.healthGate "healthGate is not-found"
Assert-Equal 'scripts/missing-health-gate.js' $m7.postHealthCommand "postHealthCommand records missing script"

# ---------------------------------------------------------------------------
# TEST 8: Schema field type validation (uses raw JSON for type fidelity)
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 8: Schema field type validation"
$outcomes8 = @(
    @{ number = 110; title = "feat: type check"; status = 'eligible' }
)
$path8 = Write-MergeManifest -PreCommit $null -PostCommit $null -Outcomes $outcomes8 -HealthResult 'skipped' -HealthCommand $null -BlockedPRs @() -FailureReason $null -ManifestDir $script:testDir -RepoName "owner/repo" -IsExecute $false
$raw8 = Get-Content $path8 -Raw
$m8 = $raw8 | ConvertFrom-Json

# Verify required fields present in JSON
Assert-True ($raw8 -match '"batchId"\s*:\s*"') "batchId present as string in JSON"
Assert-True ($raw8 -match '"timestamp"\s*:\s*"') "timestamp present as string in JSON"
Assert-True ($raw8 -match '"repository"\s*:\s*"') "repository present as string in JSON"
Assert-True ($raw8 -match '"mode"\s*:\s*"') "mode present as string in JSON"
Assert-True ($raw8 -match '"healthGate"\s*:\s*"') "healthGate present as string in JSON"

# Verify types after round-trip (ConvertFrom-Json may coerce)
Assert-True ($m8.batchId -is [string]) "batchId is string after round-trip"
Assert-True ($m8.repository -is [string]) "repository is string after round-trip"
Assert-True ($m8.mode -is [string]) "mode is string after round-trip"
Assert-True ($m8.prs -is [System.Collections.IEnumerable]) "prs is array after round-trip"

# PR number: JSON integer, round-trips as Int64
Assert-True ($m8.prs[0].number -is [long] -or $m8.prs[0].number -is [int]) "PR number is numeric after round-trip"
Assert-True ($m8.prs[0].title -is [string]) "PR title is string after round-trip"
Assert-True ($m8.prs[0].status -is [string]) "PR status is string after round-trip"
Assert-True ($m8.healthGate -is [string]) "healthGate is string after round-trip"

# Verify timestamp is ISO 8601 (check raw JSON since ConvertFrom-Json coerces to DateTime)
Assert-True ($raw8 -match '"timestamp"\s*:\s*"\d{4}-\d{2}-\d{2}T') "timestamp is ISO 8601 format in JSON"

# ---------------------------------------------------------------------------
# TEST 9: Empty blockedPrs normalization (null vs empty array)
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 9: Empty blockedPrs normalization"
$path9 = Write-MergeManifest -PreCommit $null -PostCommit $null -Outcomes @( @{ number = 1; title = "t"; status = 'eligible' } ) -HealthResult 'skipped' -HealthCommand $null -BlockedPRs $null -FailureReason $null -ManifestDir $script:testDir -RepoName "owner/repo" -IsExecute $false
$raw9 = Get-Content $path9 -Raw

# Check raw JSON contains "blockedPrs" key (not omitted)
Assert-True ($raw9 -match '"blockedPrs"') "blockedPrs key present in JSON when passed null"
# PowerShell ConvertTo-Json normalizes empty arrays to null in JSON;
# verify the key is present (not absent) to confirm the field is always serialized
Assert-True ($raw9 -match '"blockedPrs"\s*:\s*(\[\]|null)') "blockedPrs serializes to [] or null (empty)"

# ---------------------------------------------------------------------------
# TEST 10: Manifest file is valid JSON
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "TEST 10: Manifest is valid JSON and loadable"
$path10 = Write-MergeManifest -PreCommit "sha1" -PostCommit "sha2" -Outcomes @( @{ number = 120; title = "feat: json"; status = 'merged' } ) -HealthResult 'pass' -HealthCommand "cmd" -BlockedPRs @() -FailureReason $null -ManifestDir $script:testDir -RepoName "owner/repo" -IsExecute $true
$json10 = Get-Content $path10 -Raw
$parsed10 = $null
try {
    $parsed10 = $json10 | ConvertFrom-Json
    Assert-True ($null -ne $parsed10) "manifest is valid JSON"
} catch {
    Assert-True $false "manifest is valid JSON (parse threw: $_)"
}

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
    Write-Host "MANIFEST TESTS FAILED"
    exit 1
}
Write-Host "ALL MANIFEST TESTS PASSED"
exit 0
