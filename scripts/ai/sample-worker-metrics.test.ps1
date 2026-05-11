#Requires -Version 7.0
<#
.SYNOPSIS
    Fixture-based tests for sample-active-worker-resources.ps1.

.DESCRIPTION
    Validates manifest loading, dry-run mode, JSON report structure, and
    edge cases (empty workers, missing manifest, null branch) using fixture
    files from scripts/ai/__fixtures__/worker-metrics/.

.EXAMPLE
    pwsh ./scripts/ai/sample-worker-metrics.test.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$passed = 0
$failed = 0
$failures = [System.Collections.Generic.List[string]]::new()

function Assert {
    param([bool]$Condition, [string]$Message)
    if ($Condition) {
        $script:passed++
    } else {
        $script:failed++
        $script:failures.Add($Message)
        Write-Host "  FAIL: $Message" -ForegroundColor Red
    }
}

function Strip-Ansi($Text) {
    return ($Text -replace '\x1b\[[0-9;]*m', '')
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "../..")).Path
$samplerScript = (Resolve-Path (Join-Path $scriptDir "sample-active-worker-resources.ps1")).Path

Write-Host "sample-active-worker-resources fixture tests" -ForegroundColor Cyan
Write-Host ""

# ── Fixture path ──────────────────────────────────────────────────────────────

$fixturesDir = Join-Path $repoRoot "scripts/ai/__fixtures__/worker-metrics"

# ── Schema validation for fixture files ───────────────────────────────────────

Write-Host "fixture schema validation"

$samplePath = Join-Path $fixturesDir "sample-processes.json"
$sampleJson = Get-Content $samplePath -Raw -Encoding UTF8 | ConvertFrom-Json

Assert ($sampleJson.markerVersion -eq 1) "sample fixture has markerVersion=1"
Assert ($null -ne $sampleJson.capturedAt) "sample fixture has capturedAt"
Assert ($sampleJson.workers.Count -eq 3) "sample fixture has 3 worker entries"

$w0 = $sampleJson.workers[0]
Assert ($w0.conflictGroup -eq "worker-metrics-tests") "first worker conflictGroup matches"
Assert ($w0.issue -eq 604) "first worker issue is 604"
Assert ($w0.branch -eq "claude/issue-604-worker-metrics-tests") "first worker branch matches"

$w1 = $sampleJson.workers[1]
Assert ($w1.conflictGroup -eq "control-loop") "second worker conflictGroup matches"
Assert ($w1.issue -eq 605) "second worker issue is 605"
Assert ($w1.branch -eq "claude/issue-605-control-loop") "second worker branch matches"

$w2 = $sampleJson.workers[2]
Assert ($w2.conflictGroup -eq "no-branch-group") "third worker conflictGroup matches"
Assert ($w2.issue -eq 606) "third worker issue is 606"
Assert ($null -eq $w2.branch) "third worker branch is null"

Write-Host ""

# ── Temp dir for inline fixtures ──────────────────────────────────────────────

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "worker-metrics-test-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

try {

    function Write-Fixture($Name, $Content) {
        $p = Join-Path $tmpDir $Name
        $Content | Set-Content $p -Encoding UTF8
        return $p
    }

    function Invoke-Sampler {
        param([string]$ManifestPath, [switch]$DryRun, [switch]$JsonMode)
        $outFile = [System.IO.Path]::GetTempFileName()
        try {
            $cmd = "& `"$samplerScript`" -ManifestFile `"$ManifestPath`""
            if ($DryRun) { $cmd += " -DryRun" }
            if ($JsonMode) { $cmd += " -Json" }
            pwsh -NoProfile -Command "$cmd *> `"$outFile`""
            $text = Get-Content $outFile -Raw -Encoding UTF8
            if ($null -eq $text) { $text = "" }
            return $text
        } finally {
            Remove-Item $outFile -ErrorAction SilentlyContinue
        }
    }

    # ── Test 1: DryRun with JSON output — valid manifest ──────────────────────

    Write-Host "test: dry-run JSON mode — valid manifest"
    $raw = Invoke-Sampler $samplePath -DryRun -JsonMode
    $report = $raw | ConvertFrom-Json

    Assert ($report.mode -eq "dry-run") "dry-run mode field is correct"
    Assert ($report.workerCount -eq 3) "dry-run reports 3 workers"
    Assert ($report.version -eq 1) "dry-run reports manifest version 1"
    Assert ($null -ne $report.capturedAt) "dry-run reports capturedAt"
    Assert ($report.workers.Count -eq 3) "dry-run lists all 3 workers"
    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 2: DryRun with console output — valid manifest ───────────────────

    Write-Host "test: dry-run console mode — valid manifest"
    $raw2 = Invoke-Sampler $samplePath -DryRun
    $out2 = Strip-Ansi $raw2

    Assert ($out2.Contains("Dry run complete")) "console dry-run shows completion message"
    Assert ($out2.Contains("3 worker")) "console dry-run shows worker count"
    Assert ($out2.Contains("worker-metrics-tests")) "console dry-run lists first conflict group"
    Assert ($out2.Contains("no-branch-group")) "console dry-run lists null-branch worker"
    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 3: Empty workers array ────────────────────────────────────────────

    Write-Host "test: dry-run JSON — empty workers"
    $emptyManifest = @{
        markerVersion = 1
        capturedAt    = "2026-05-11T12:00:00Z"
        workers       = @()
    } | ConvertTo-Json -Depth 4
    $emptyPath = Write-Fixture "empty-workers.json" $emptyManifest

    $raw3 = Invoke-Sampler $emptyPath -DryRun -JsonMode
    $report3 = $raw3 | ConvertFrom-Json

    Assert ($report3.workerCount -eq 0) "empty manifest reports 0 workers"
    Assert ($report3.workers.Count -eq 0) "empty manifest workers array is empty"
    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 4: Missing manifest file ─────────────────────────────────────────

    Write-Host "test: missing manifest file — exit code 2"
    $missingPath = Join-Path $tmpDir "nonexistent-manifest.json"
    $exitFile = [System.IO.Path]::GetTempFileName()
    try {
        $cmd = "& `"$samplerScript`" -ManifestFile `"$missingPath`" *> `"$exitFile`""
        pwsh -NoProfile -Command "$cmd"
        $exitCode = $LASTEXITCODE
    } catch {
        $exitCode = 1
    }
    # Script writes to stderr and exits 2; pwsh may return 1 if stderr is non-empty
    Assert ($exitCode -ne 0) "missing manifest exits non-zero (got $exitCode)"
    $errText = Get-Content $exitFile -Raw -Encoding UTF8
    if ($null -eq $errText) { $errText = "" }
    $errClean = Strip-Ansi $errText
    Assert ($errClean -match "not found") "missing manifest error mentions not found"
    Remove-Item $exitFile -ErrorAction SilentlyContinue
    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 5: Single worker with branch — dry-run ───────────────────────────

    Write-Host "test: single worker with branch — dry-run"
    $singleManifest = @{
        markerVersion = 1
        capturedAt    = "2026-05-11T14:00:00Z"
        workers       = @(
            @{
                conflictGroup = "solo-group"
                issue         = 700
                branch        = "claude/issue-700-solo"
            }
        )
    } | ConvertTo-Json -Depth 4
    $singlePath = Write-Fixture "single-worker.json" $singleManifest

    $raw5 = Invoke-Sampler $singlePath -DryRun -JsonMode
    $report5 = $raw5 | ConvertFrom-Json

    Assert ($report5.workerCount -eq 1) "single worker reports 1 worker"
    Assert ($report5.workers[0].conflictGroup -eq "solo-group") "single worker conflictGroup correct"
    Assert ($report5.workers[0].branch -eq "claude/issue-700-solo") "single worker branch correct"
    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 6: JSON report structure (non-dry-run) ───────────────────────────

    Write-Host "test: JSON report structure — full sample"
    $raw6 = Invoke-Sampler $samplePath -JsonMode
    $report6 = $raw6 | ConvertFrom-Json

    Assert ($report6.schemaVersion -eq 1) "report schemaVersion is 1"
    Assert ($null -ne $report6.capturedAt) "report has capturedAt"
    Assert ($report6.manifestVersion -eq 1) "report manifestVersion is 1"
    Assert ($null -ne $report6.manifestCapturedAt) "report has manifestCapturedAt"
    Assert ($report6.workerCount -eq 3) "report workerCount is 3"
    Assert ($report6.samples.Count -eq 3) "report has 3 samples"

    $s0 = $report6.samples[0]
    Assert ($s0.conflictGroup -eq "worker-metrics-tests") "sample 0 conflictGroup matches"
    Assert ($s0.issue -eq 604) "sample 0 issue is 604"
    Assert ($s0.branch -eq "claude/issue-604-worker-metrics-tests") "sample 0 branch matches"
    Assert ($s0.processFound -eq $false) "sample 0 processFound is false (no real process)"
    Assert ($null -ne $s0.sampledAt) "sample 0 has sampledAt"

    # Worker with null branch should get a note
    $s2 = $report6.samples[2]
    Assert ($s2.conflictGroup -eq "no-branch-group") "sample 2 conflictGroup matches"
    Assert ($null -eq $s2.branch) "sample 2 branch is null"
    Assert ($s2.processFound -eq $false) "sample 2 processFound is false"
    Assert ($s2.note -match "No branch") "sample 2 note mentions no branch"

    # Workers with real branches get a "no process matched" note
    Assert ($s0.note -match "No process matched") "sample 0 note mentions no process matched"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 7: Mixed — one worker with branch, one without ───────────────────

    Write-Host "test: mixed workers — with and without branch"
    $mixedManifest = @{
        markerVersion = 1
        capturedAt    = "2026-05-11T15:00:00Z"
        workers       = @(
            @{
                conflictGroup = "has-branch"
                issue         = 800
                branch        = "claude/issue-800-branch"
            },
            @{
                conflictGroup = "no-branch"
                issue         = 801
                branch        = $null
            }
        )
    } | ConvertTo-Json -Depth 4
    $mixedPath = Write-Fixture "mixed-workers.json" $mixedManifest

    $raw7 = Invoke-Sampler $mixedPath -JsonMode
    $report7 = $raw7 | ConvertFrom-Json

    Assert ($report7.samples.Count -eq 2) "mixed report has 2 samples"
    $ms0 = $report7.samples[0]
    $ms1 = $report7.samples[1]
    Assert ($ms0.note -match "No process matched") "branch worker has no-process note"
    Assert ($ms1.note -match "No branch") "no-branch worker has no-branch note"
    Assert ($ms0.processFound -eq $false) "branch worker processFound is false"
    Assert ($ms1.processFound -eq $false) "no-branch worker processFound is false"
    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

} finally {
    Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Results ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host ("=" * 50)
Write-Host "Results: $passed passed, $failed failed"

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Failures:" -ForegroundColor Red
    foreach ($f in $failures) {
        Write-Host "  - $f"
    }
    exit 1
} else {
    Write-Host "All tests passed." -ForegroundColor Green
    exit 0
}
