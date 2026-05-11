<#
.SYNOPSIS
    Preview-first WebUI merge control wrapper around controlled auto-merge.

.DESCRIPTION
    Provides a WebUI-friendly interface to merge-clean-pr-batch.ps1 with
    enforced safety defaults:

    - DRY-RUN by default: no merges unless -Execute is passed explicitly
    - Explicit PR allowlist only: never discovers or guesses PRs
    - Health gate ON by default: post-merge health check runs unless -SkipHealthGate
    - Confirmation prompt: execute mode prints the plan and requires -Confirm
    - Manifest output: every run writes a JSON manifest for WebUI consumption
    - Guard integration: runs guards by default in execute mode

    This script is the final WebUI control-console layer. It wraps
    merge-clean-pr-batch.ps1 without modifying it, adding UI-oriented
    validation, preview, and confirmation semantics.

.PARAMETER PRs
    One or more PR numbers to process. Required. Inline allowlist mode.

.PARAMETER AllowlistFile
    Path to a text file with one PR number per line. Mutually exclusive
    with -PRs.

.PARAMETER Repo
    Target repository in OWNER/NAME format. Falls back to GH_REPO env var.

.PARAMETER Execute
    Actually merge the PRs. Without this flag, the script runs in dry-run
    mode and only prints what it would do.

.PARAMETER SkipHealthGate
    Skip the post-merge health gate. By default, health gate runs in
    execute mode.

.PARAMETER SkipGuards
    Skip local guard checks before merge. By default, guards run in
    execute mode.

.PARAMETER Force
    Skip the confirmation prompt in execute mode. Use with caution.

.PARAMETER SelfTest
    Run inline self-test assertions without contacting GitHub.

.EXAMPLE
    # Preview what would happen (dry-run)
    .\scripts\ai\webui-merge-control.ps1 -PRs 42,45 -Repo owner/name

.EXAMPLE
    # Execute with confirmation prompt
    .\scripts\ai\webui-merge-control.ps1 -PRs 42 -Repo owner/name -Execute

.EXAMPLE
    # Execute without confirmation (CI/automation)
    .\scripts\ai\webui-merge-control.ps1 -PRs 42 -Repo owner/name -Execute -Force

.EXAMPLE
    # Execute from allowlist file
    .\scripts\ai\webui-merge-control.ps1 -AllowlistFile .\pr-allowlist.txt -Repo owner/name -Execute

.EXAMPLE
    # Run self-test
    .\scripts\ai\webui-merge-control.ps1 -SelfTest

.NOTES
    Exit codes:
        0 — success (dry-run preview or completed merges)
        1 — validation failure, guard failure, merge failure, or health gate failure
        2 — invalid arguments or confirmation declined
#>

[CmdletBinding(DefaultParameterSetName = 'InlinePRs')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'InlinePRs', Position = 0)]
    [int[]]$PRs,

    [Parameter(Mandatory = $true, ParameterSetName = 'File')]
    [string]$AllowlistFile,

    [Parameter(Mandatory = $true, ParameterSetName = 'SelfTest')]
    [switch]$SelfTest,

    [string]$Repo,

    [switch]$Execute,

    [switch]$SkipHealthGate,

    [switch]$SkipGuards,

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Banner {
    param([string]$Text)
    $line = '=' * 72
    Write-Host ""
    Write-Host $line
    Write-Host "  $Text"
    Write-Host $line
    Write-Host ""
}

function Resolve-Repo {
    param([string]$RepoParam)
    if ($RepoParam) { return $RepoParam }
    if ($env:GH_REPO) { return $env:GH_REPO }
    Write-Error "Repository not specified. Pass -Repo OWNER/NAME or set GH_REPO env var."
    exit 2
}

function Resolve-Allowlist {
    param([int[]]$InlinePRs, [string]$FilePath)

    if ($InlinePRs) {
        return $InlinePRs
    }

    if (-not (Test-Path $FilePath)) {
        Write-Error "Allowlist file not found: $FilePath"
        exit 2
    }

    $lines = Get-Content $FilePath
    $prNumbers = @()
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if (-not $trimmed) { continue }
        if ($trimmed.StartsWith('#')) { continue }
        $parsed = 0
        if ([int]::TryParse($trimmed, [ref]$parsed)) {
            $prNumbers += $parsed
        } else {
            Write-Error "Invalid PR number in allowlist: '$trimmed'"
            exit 2
        }
    }

    if ($prNumbers.Count -eq 0) {
        Write-Error "Allowlist file contains no valid PR numbers: $FilePath"
        exit 2
    }

    return $prNumbers
}

function Invoke-MergeBatch {
    param(
        [int[]]$PRNumbers,
        [string]$Repository,
        [bool]$IsExecute,
        [bool]$RunHealthGate,
        [bool]$RunGuards
    )

    $mergeScript = Join-Path $PSScriptRoot 'merge-clean-pr-batch.ps1'
    if (-not (Test-Path $mergeScript)) {
        Write-Error "merge-clean-pr-batch.ps1 not found at $mergeScript"
        exit 1
    }

    $args = @(
        '-PRs', ($PRNumbers -join ','),
        '-Repo', $Repository
    )

    if ($IsExecute) {
        $args += '-Execute'
        if ($RunHealthGate) { $args += '-RunHealthGate' }
        if ($RunGuards) { $args += '-RunGuards' }
    }

    Write-Host "Invoking merge-clean-pr-batch.ps1 with args: $($args -join ' ')"
    & pwsh $mergeScript @args
    return $LASTEXITCODE
}

function Write-WebUIManifest {
    param(
        [string]$BatchId,
        [string]$Mode,
        [int[]]$PRNumbers,
        [string]$Repository,
        [string]$HealthResult,
        [string]$GuardResult,
        [string]$FailureReason,
        [string]$ManifestDir
    )

    $targetDir = if ($ManifestDir) { $ManifestDir } else { Join-Path (Get-Location) '.ai' 'webui-merge-manifests' }
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    $timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ssZ')
    $manifest = @{
        schemaVersion = 1
        batchId       = $BatchId
        timestamp     = (Get-Date).ToUniversalTime().ToString('o')
        repository    = $Repository
        mode          = $Mode
        prNumbers     = $PRNumbers
        healthGate    = $HealthResult
        guards        = $GuardResult
        failureReason = if ($FailureReason) { $FailureReason } else { $null }
    }

    $manifestPath = Join-Path $targetDir "webui-merge-$timestamp.json"
    $manifest | ConvertTo-Json -Depth 5 | Set-Content $manifestPath -Encoding UTF8
    return $manifestPath
}

# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

function Invoke-SelfTest {
    Write-Banner "WebUI Merge Control — Self-Test"

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

    # Test 1: Resolve-Allowlist with inline PRs
    Write-Host ""
    Write-Host "TEST 1: Resolve-Allowlist with inline PRs"
    $result1 = Resolve-Allowlist -InlinePRs @(42, 45) -FilePath $null
    Assert-Equal 2 $result1.Count "inline allowlist returns 2 PRs"
    Assert-Equal 42 $result1[0] "first PR is 42"
    Assert-Equal 45 $result1[1] "second PR is 45"

    # Test 2: Resolve-Allowlist with file
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

    # Test 3: Resolve-Allowlist with empty file
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
    Assert-True ($null -ne $error3) "empty file raises error"

    # Test 4: Resolve-Allowlist with invalid entry
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
    Assert-True ($null -ne $error4) "invalid entry raises error"

    # Test 5: Write-WebUIManifest structure
    Write-Host ""
    Write-Host "TEST 5: Write-WebUIManifest structure"
    $manifestPath = Write-WebUIManifest -BatchId "test-batch-001" -Mode "dry-run" -PRNumbers @(42, 45) -Repository "owner/repo" -HealthResult "skipped" -GuardResult "skipped" -FailureReason $null -ManifestDir $script:testDir
    $raw = Get-Content $manifestPath -Raw
    $parsed = $raw | ConvertFrom-Json

    Assert-Equal 1 $parsed.schemaVersion "schemaVersion is 1"
    Assert-Equal "test-batch-001" $parsed.batchId "batchId is set"
    Assert-Equal "dry-run" $parsed.mode "mode is dry-run"
    Assert-Equal "owner/repo" $parsed.repository "repository is set"
    Assert-Equal 2 $parsed.prNumbers.Count "prNumbers has 2 entries"
    Assert-Equal 42 $parsed.prNumbers[0] "first PR number is 42"
    Assert-Equal "skipped" $parsed.healthGate "healthGate is skipped"
    Assert-Equal "skipped" $parsed.guards "guards is skipped"
    Assert-True ($null -eq $parsed.failureReason) "failureReason is null on success"

    # Test 6: Write-WebUIManifest with failure
    Write-Host ""
    Write-Host "TEST 6: Write-WebUIManifest with failure"
    $manifestPath2 = Write-WebUIManifest -BatchId "test-batch-002" -Mode "execute" -PRNumbers @(60) -Repository "owner/repo" -HealthResult "fail" -GuardResult "pass" -FailureReason "Health gate failed" -ManifestDir $script:testDir
    $parsed2 = (Get-Content $manifestPath2 -Raw) | ConvertFrom-Json

    Assert-Equal "execute" $parsed2.mode "mode is execute on failure"
    Assert-Equal "fail" $parsed2.healthGate "healthGate is fail"
    Assert-Equal "pass" $parsed2.guards "guards is pass"
    Assert-Equal "Health gate failed" $parsed2.failureReason "failureReason is set"

    # Test 7: Manifest is valid JSON
    Write-Host ""
    Write-Host "TEST 7: Manifest is valid JSON"
    $manifestPath3 = Write-WebUIManifest -BatchId "test-batch-003" -Mode "dry-run" -PRNumbers @(1) -Repository "r" -HealthResult "skipped" -GuardResult "skipped" -FailureReason $null -ManifestDir $script:testDir
    $json3 = Get-Content $manifestPath3 -Raw
    $parsed3 = $null
    try {
        $parsed3 = $json3 | ConvertFrom-Json
        Assert-True ($null -ne $parsed3) "manifest is valid JSON"
    } catch {
        Assert-True $false "manifest is valid JSON (parse threw: $_)"
    }

    # Summary
    Write-Host ""
    Write-Host "============================================"
    Write-Host "  Results: $($script:pass) passed, $($script:fail) failed ($($script:total) total)"
    Write-Host "============================================"

    # Cleanup
    Remove-Item -Path $script:testDir -Recurse -Force -ErrorAction SilentlyContinue

    if ($script:fail -gt 0) {
        Write-Host "SELF-TEST FAILED"
        exit 1
    }
    Write-Host "ALL SELF-TESTS PASSED"
    exit 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

function Main {
    # Self-test mode
    if ($SelfTest) {
        Invoke-SelfTest
        return
    }

    $isExecute = $Execute.IsPresent
    $modeLabel = if ($isExecute) { 'EXECUTE' } else { 'DRY-RUN' }
    $resolvedRepo = Resolve-Repo -RepoParam $Repo

    # Resolve allowlist
    $prNumbers = Resolve-Allowlist -InlinePRs $PRs -FilePath $AllowlistFile

    # Health gate: ON by default in execute mode, OFF if explicitly skipped
    $runHealthGate = $isExecute -and (-not $SkipHealthGate)

    # Guards: ON by default in execute mode, OFF if explicitly skipped
    $runGuards = $isExecute -and (-not $SkipGuards)

    # Generate batch ID
    $timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ssZ')
    $batchId = "webui-merge-$($timestamp -replace ':', '-')"

    Write-Banner "WebUI Merge Control — $modeLabel"
    Write-Host "  Repository:    $resolvedRepo"
    Write-Host "  PRs:           $($prNumbers -join ', ')"
    Write-Host "  Health Gate:   $(if ($runHealthGate) { 'ON' } else { 'OFF' })"
    Write-Host "  Guards:        $(if ($runGuards) { 'ON' } else { 'OFF' })"
    Write-Host "  Batch ID:      $batchId"
    Write-Host ""

    # Confirmation prompt for execute mode
    if ($isExecute -and (-not $Force)) {
        Write-Host "  WARNING: You are about to MERGE the following PRs:"
        foreach ($pr in $prNumbers) {
            Write-Host "    - PR #$pr"
        }
        Write-Host ""
        Write-Host "  This action is IRREVERSIBLE."
        Write-Host ""
        $response = Read-Host "  Type 'yes' to confirm merge, or anything else to abort"
        if ($response -ne 'yes') {
            Write-Host ""
            Write-Host "  ABORTED by user."
            Write-WebUIManifest -BatchId $batchId -Mode "aborted" -PRNumbers $prNumbers -Repository $resolvedRepo -HealthResult "skipped" -GuardResult "skipped" -FailureReason "User declined confirmation" -ManifestDir $null | Out-Null
            exit 2
        }
        Write-Host ""
    }

    # Invoke the underlying merge script
    $exitCode = Invoke-MergeBatch -PRNumbers $prNumbers -Repository $resolvedRepo -IsExecute $isExecute -RunHealthGate $runHealthGate -RunGuards $runGuards

    # Determine health and guard results from exit code
    $healthResult = if (-not $isExecute) { 'skipped' } elseif ($runHealthGate) { if ($exitCode -eq 0) { 'pass' } else { 'fail' } } else { 'skipped' }
    $guardResult = if (-not $isExecute) { 'skipped' } elseif ($runGuards) { if ($exitCode -eq 0) { 'pass' } else { 'fail' } } else { 'skipped' }
    $failureReason = if ($exitCode -ne 0) { "Merge batch exited with code $exitCode" } else { $null }

    # Write WebUI manifest
    $manifestPath = Write-WebUIManifest -BatchId $batchId -Mode $modeLabel.ToLower() -PRNumbers $prNumbers -Repository $resolvedRepo -HealthResult $healthResult -GuardResult $guardResult -FailureReason $failureReason -ManifestDir $null
    Write-Host ""
    Write-Host "Manifest written to: $manifestPath"

    if ($exitCode -ne 0) {
        Write-Host ""
        Write-Host "  MERGE BATCH FAILED (exit code $exitCode)"
        exit 1
    }

    Write-Host ""
    Write-Host "  MERGE BATCH COMPLETED ($modeLabel)"
    exit 0
}

Main
