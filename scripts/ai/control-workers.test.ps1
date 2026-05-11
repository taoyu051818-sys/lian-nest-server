#Requires -Version 7.0
<#
.SYNOPSIS
    Fixture-based tests for control-workers.ps1.

.DESCRIPTION
    Validates list/preview/stop modes, PID allowlist enforcement, reason
    requirement, broad-kill refusal, and audit trail generation using
    inline fixtures and the control-workers wrapper script.

    Tests do NOT terminate real processes. All stop-mode tests use
    synthetic manifest entries with PIDs that do not correspond to
    real running processes.

.EXAMPLE
    pwsh ./scripts/ai/control-workers.test.ps1
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
$controlScript = (Resolve-Path (Join-Path $scriptDir "control-workers.ps1")).Path

Write-Host "control-workers.ps1 fixture tests" -ForegroundColor Cyan
Write-Host ""

# ── Temp dir for fixtures ─────────────────────────────────────────────────

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "control-workers-test-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

try {

    function Write-Fixture($Name, $Content) {
        $p = Join-Path $tmpDir $Name
        $Content | Set-Content $p -Encoding UTF8
        return $p
    }

    function Invoke-Control {
        param(
            [string]$ManifestPath,
            [string]$ModeArg = "List",
            [int[]]$PidArgs,
            [string]$ReasonArg,
            [switch]$JsonMode,
            [switch]$ForceArg,
            [string]$AuditPath
        )
        $outFile = [System.IO.Path]::GetTempFileName()
        try {
            $cmd = "& `"$controlScript`" -Mode $ModeArg -ManifestFile `"$ManifestPath`""
            if ($PidArgs -and $PidArgs.Count -gt 0) {
                $cmd += " -Pids $($PidArgs -join ',')"
            }
            if ($ReasonArg) {
                $cmd += " -Reason `"$ReasonArg`""
            }
            if ($JsonMode) { $cmd += " -Json" }
            if ($ForceArg) { $cmd += " -Force" }
            if ($AuditPath) {
                $cmd += " -AuditFile `"$AuditPath`""
            }
            pwsh -NoProfile -Command "$cmd *> `"$outFile`""
            $text = Get-Content $outFile -Raw -Encoding UTF8
            if ($null -eq $text) { $text = "" }
            return $text
        } finally {
            Remove-Item $outFile -ErrorAction SilentlyContinue
        }
    }

    function Invoke-Control-ExitCode {
        param(
            [string]$ManifestPath,
            [string]$ModeArg = "List",
            [int[]]$PidArgs,
            [string]$ReasonArg,
            [switch]$ForceArg,
            [string]$AuditPath
        )
        $outFile = [System.IO.Path]::GetTempFileName()
        try {
            $cmd = "& `"$controlScript`" -Mode $ModeArg -ManifestFile `"$ManifestPath`""
            if ($PidArgs -and $PidArgs.Count -gt 0) {
                $cmd += " -Pids $($PidArgs -join ',')"
            }
            if ($ReasonArg) {
                $cmd += " -Reason `"$ReasonArg`""
            }
            if ($ForceArg) { $cmd += " -Force" }
            if ($AuditPath) {
                $cmd += " -AuditFile `"$AuditPath`""
            }
            pwsh -NoProfile -Command "$cmd *> `"$outFile`""
            return $LASTEXITCODE
        } finally {
            Remove-Item $outFile -ErrorAction SilentlyContinue
        }
    }

    # ── Fixtures ──────────────────────────────────────────────────────────────

    # Manifest with workers that have pid fields (for preview/stop matching)
    $pidWorkersManifest = @{
        markerVersion = 1
        capturedAt    = "2026-05-11T12:00:00Z"
        workers       = @(
            @{
                conflictGroup = "group-alpha"
                issue         = 101
                branch        = "claude/issue-101-alpha"
                pid           = 11111
            },
            @{
                conflictGroup = "group-beta"
                issue         = 102
                branch        = "claude/issue-102-beta"
                pid           = 22222
            },
            @{
                conflictGroup = "group-gamma"
                issue         = 103
                branch        = $null
            }
        )
    } | ConvertTo-Json -Depth 4
    $pidPath = Write-Fixture "pid-workers.json" $pidWorkersManifest

    # Manifest without pid fields (list-only)
    $basicManifest = @{
        markerVersion = 1
        capturedAt    = "2026-05-11T12:00:00Z"
        workers       = @(
            @{
                conflictGroup = "group-alpha"
                issue         = 101
                branch        = "claude/issue-101-alpha"
            },
            @{
                conflictGroup = "group-beta"
                issue         = 102
                branch        = "claude/issue-102-beta"
            },
            @{
                conflictGroup = "group-gamma"
                issue         = 103
                branch        = $null
            }
        )
    } | ConvertTo-Json -Depth 4
    $basicPath = Write-Fixture "basic-workers.json" $basicManifest

    $emptyManifest = @{
        markerVersion = 1
        capturedAt    = "2026-05-11T12:00:00Z"
        workers       = @()
    } | ConvertTo-Json -Depth 4
    $emptyPath = Write-Fixture "empty-workers.json" $emptyManifest

    $singleWorkerManifest = @{
        markerVersion = 1
        capturedAt    = "2026-05-11T14:00:00Z"
        workers       = @(
            @{
                conflictGroup = "solo-group"
                issue         = 200
                branch        = "claude/issue-200-solo"
            }
        )
    } | ConvertTo-Json -Depth 4
    $singlePath = Write-Fixture "single-worker.json" $singleWorkerManifest

    # ── Test 1: List mode (default) — JSON output ────────────────────────────

    Write-Host "test: list mode JSON — three workers"
    $raw1 = Invoke-Control -ManifestPath $basicPath -JsonMode
    $report1 = $raw1 | ConvertFrom-Json

    Assert ($report1.mode -eq "list") "list mode field is correct"
    Assert ($report1.schemaVersion -eq 1) "list schemaVersion is 1"
    Assert ($report1.workerCount -eq 3) "list reports 3 workers"
    Assert ($report1.workers.Count -eq 3) "list workers array has 3 entries"
    Assert ($null -ne $report1.capturedAt) "list has capturedAt"

    $w0 = $report1.workers[0]
    Assert ($w0.conflictGroup -eq "group-alpha") "worker 0 conflictGroup matches"
    Assert ($w0.issue -eq 101) "worker 0 issue matches"
    Assert ($w0.branch -eq "claude/issue-101-alpha") "worker 0 branch matches"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 2: List mode — console output ───────────────────────────────────

    Write-Host "test: list mode console — three workers"
    $raw2 = Invoke-Control -ManifestPath $basicPath
    $out2 = Strip-Ansi $raw2

    Assert ($out2.Contains("Worker Control")) "console list shows header"
    Assert ($out2.Contains("group-alpha")) "console list shows first group"
    Assert ($out2.Contains("group-beta")) "console list shows second group"
    Assert ($out2.Contains("List complete")) "console list shows completion"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 3: List mode — empty manifest ───────────────────────────────────

    Write-Host "test: list mode JSON — empty workers"
    $raw3 = Invoke-Control -ManifestPath $emptyPath -JsonMode
    $report3 = $raw3 | ConvertFrom-Json

    Assert ($report3.workerCount -eq 0) "empty manifest reports 0 workers"
    Assert ($report3.workers.Count -eq 0) "empty manifest workers array is empty"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 4: Preview mode requires Pids ────────────────────────────────────

    Write-Host "test: preview mode requires Pids"
    $exit4 = Invoke-Control-ExitCode -ManifestPath $basicPath -ModeArg "Preview"
    Assert ($exit4 -ne 0) "preview without Pids exits non-zero"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 5: Preview mode — no matching PIDs ──────────────────────────────

    Write-Host "test: preview mode — no matching PIDs (not in manifest)"
    $raw5 = Invoke-Control -ManifestPath $pidPath -ModeArg "Preview" -PidArgs @(99999) -JsonMode
    $report5 = $raw5 | ConvertFrom-Json

    Assert ($report5.mode -eq "preview") "preview mode field is correct"
    Assert ($report5.matchedCount -eq 0) "preview reports 0 matched PIDs"
    Assert ($report5.actions.Count -eq 0) "preview has no actions"
    Assert ($report5.notInManifest.Count -eq 1) "preview reports 1 not-in-manifest"
    Assert ($report5.note -match "no processes") "preview note mentions no processes"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 6: Preview mode — matching PID from manifest ────────────────────

    Write-Host "test: preview mode — matching PID from manifest"
    $raw6 = Invoke-Control -ManifestPath $pidPath -ModeArg "Preview" -PidArgs @(11111) -JsonMode
    $report6 = $raw6 | ConvertFrom-Json

    Assert ($report6.mode -eq "preview") "preview mode with match is correct"
    Assert ($report6.matchedCount -eq 1) "preview reports 1 matched PID"
    Assert ($report6.actions.Count -eq 1) "preview has 1 action"
    Assert ($report6.actions[0].pid -eq 11111) "preview action PID matches"
    Assert ($report6.actions[0].conflictGroup -eq "group-alpha") "preview action group matches"
    Assert ($report6.actions[0].issue -eq 101) "preview action issue matches"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 7: Preview mode — console output ────────────────────────────────

    Write-Host "test: preview mode console — no matching PIDs"
    $raw7 = Invoke-Control -ManifestPath $pidPath -ModeArg "Preview" -PidArgs @(99999)
    $out7 = Strip-Ansi $raw7

    Assert ($out7.Contains("Preview Mode")) "console preview shows header"
    Assert ($out7.Contains("DRY RUN")) "console preview shows dry run"
    Assert ($out7.Contains("99999")) "console preview shows requested PID"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 8: Preview mode — mixed match and no-match ──────────────────────

    Write-Host "test: preview mode — mixed match and no-match"
    $raw8 = Invoke-Control -ManifestPath $pidPath -ModeArg "Preview" -PidArgs @(11111,99999) -JsonMode
    $report8 = $raw8 | ConvertFrom-Json

    Assert ($report8.matchedCount -eq 1) "mixed preview reports 1 matched"
    Assert ($report8.notInManifest.Count -eq 1) "mixed preview reports 1 not-in-manifest"
    Assert ($report8.actions[0].pid -eq 11111) "mixed preview matched PID is correct"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 9: Stop mode requires Pids ──────────────────────────────────────

    Write-Host "test: stop mode requires Pids"
    $exit9 = Invoke-Control-ExitCode -ManifestPath $basicPath -ModeArg "Stop" -ReasonArg "test"
    Assert ($exit9 -ne 0) "stop without Pids exits non-zero"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 10: Stop mode requires Reason ───────────────────────────────────

    Write-Host "test: stop mode requires Reason"
    $exit10 = Invoke-Control-ExitCode -ManifestPath $basicPath -ModeArg "Stop" -PidArgs @(1234)
    Assert ($exit10 -ne 0) "stop without Reason exits non-zero"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 11: Stop mode — no matching PIDs (safe no-op) ───────────────────

    Write-Host "test: stop mode — no matching PIDs"
    $auditPath11 = Join-Path $tmpDir "audit-11.jsonl"
    $raw11 = Invoke-Control -ManifestPath $pidPath -ModeArg "Stop" -PidArgs @(99999) -ReasonArg "test cleanup" -ForceArg -AuditPath $auditPath11
    $out11 = Strip-Ansi $raw11

    Assert ($out11.Contains("No matching PIDs")) "stop no-match shows warning"
    Assert (-not (Test-Path $auditPath11)) "stop no-match does not create audit file"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 12: Invalid PID (negative) ──────────────────────────────────────

    Write-Host "test: invalid PID (negative) is rejected"
    $exit12 = Invoke-Control-ExitCode -ManifestPath $basicPath -ModeArg "Preview" -PidArgs @(-1)
    Assert ($exit12 -ne 0) "negative PID exits non-zero"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 13: Invalid PID (zero) ──────────────────────────────────────────

    Write-Host "test: invalid PID (zero) is rejected"
    $exit13 = Invoke-Control-ExitCode -ManifestPath $basicPath -ModeArg "Preview" -PidArgs @(0)
    Assert ($exit13 -ne 0) "zero PID exits non-zero"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 14: Missing manifest file ───────────────────────────────────────

    Write-Host "test: missing manifest file — non-zero exit"
    $missingPath = Join-Path $tmpDir "nonexistent.json"
    $exit14 = Invoke-Control-ExitCode -ManifestPath $missingPath -ModeArg "List"
    Assert ($exit14 -ne 0) "missing manifest exits non-zero (got $exit14)"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 15: List mode default (no -Mode) ────────────────────────────────

    Write-Host "test: default mode is List"
    $raw15 = Invoke-Control -ManifestPath $singlePath -JsonMode
    $report15 = $raw15 | ConvertFrom-Json

    Assert ($report15.mode -eq "list") "default mode is list"
    Assert ($report15.workerCount -eq 1) "single worker reports 1"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 16: Preview JSON structure ──────────────────────────────────────

    Write-Host "test: preview JSON structure"
    $raw16 = Invoke-Control -ManifestPath $pidPath -ModeArg "Preview" -PidArgs @(99997) -JsonMode
    $report16 = $raw16 | ConvertFrom-Json

    Assert ($report16.mode -eq "preview") "preview mode is correct"
    Assert ($report16.schemaVersion -eq 1) "preview schemaVersion is 1"
    Assert ($null -ne $report16.capturedAt) "preview has capturedAt"
    Assert ($null -ne $report16.manifestVersion) "preview has manifestVersion"
    Assert ($report16.requestedPids.Count -eq 1) "preview shows requested PIDs"
    Assert ($report16.requestedPids[0] -eq 99997) "preview requested PID value matches"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 17: Preview console shows "not in manifest" warning ─────────────

    Write-Host "test: preview console — not-in-manifest warning"
    $raw17 = Invoke-Control -ManifestPath $pidPath -ModeArg "Preview" -PidArgs @(99997)
    $out17 = Strip-Ansi $raw17

    Assert ($out17.Contains("not found in manifest")) "preview warns about not-in-manifest PIDs"
    Assert ($out17.Contains("99997")) "preview shows the unmatched PID"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 18: Worker with null branch ─────────────────────────────────────

    Write-Host "test: list mode — worker with null branch"
    $raw18 = Invoke-Control -ManifestPath $basicPath -JsonMode
    $report18 = $raw18 | ConvertFrom-Json

    $w2 = $report18.workers[2]
    Assert ($w2.conflictGroup -eq "group-gamma") "null-branch worker conflictGroup matches"
    Assert ($w2.note -match "No branch") "null-branch worker has no-branch note"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 19: Help flag ───────────────────────────────────────────────────

    Write-Host "test: help flag"
    $outFile19 = [System.IO.Path]::GetTempFileName()
    try {
        $cmd = "& `"$controlScript`" -Help *> `"$outFile19`""
        pwsh -NoProfile -Command "$cmd"
        $raw19 = Get-Content $outFile19 -Raw -Encoding UTF8
        $out19 = Strip-Ansi $raw19

        Assert ($out19.Contains("WORKER CONTROL")) "help shows title"
        Assert ($out19.Contains("-Mode")) "help shows Mode parameter"
        Assert ($out19.Contains("-Pids")) "help shows Pids parameter"
        Assert ($out19.Contains("-Reason")) "help shows Reason parameter"
        Assert ($out19.Contains("SAFETY POLICY")) "help shows safety policy"
    } finally {
        Remove-Item $outFile19 -ErrorAction SilentlyContinue
    }

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 20: Preview console shows "would stop" for matching PIDs ────────

    Write-Host "test: preview console — matching PID shows action"
    $raw20 = Invoke-Control -ManifestPath $pidPath -ModeArg "Preview" -PidArgs @(22222)
    $out20 = Strip-Ansi $raw20

    Assert ($out20.Contains("Would stop")) "preview shows would stop"
    Assert ($out20.Contains("22222")) "preview shows the matched PID"
    Assert ($out20.Contains("group-beta")) "preview shows the conflict group"
    Assert ($out20.Contains("#102")) "preview shows the issue number"

    Write-Host "  PASS" -ForegroundColor Green
    Write-Host ""

    # ── Test 21: Stop mode with Force — non-existent PID from manifest ───────

    Write-Host "test: stop mode — PID in manifest but not running (Force)"
    $auditPath21 = Join-Path $tmpDir "audit-21.jsonl"
    # PID 11111 is in the manifest but not a real process
    $raw21 = Invoke-Control -ManifestPath $pidPath -ModeArg "Stop" -PidArgs @(11111) -ReasonArg "stale cleanup" -ForceArg -AuditPath $auditPath21
    $out21 = Strip-Ansi $raw21

    Assert ($out21.Contains("Stopped PID 11111") -or $out21.Contains("PID 11111 not found")) "stop handles PID correctly"

    # Check audit trail was written
    if (Test-Path $auditPath21) {
        $auditContent = Get-Content $auditPath21 -Raw -Encoding UTF8
        Assert ($auditContent.Contains('"pid":11111')) "audit trail contains PID"
        Assert ($auditContent.Contains('"reason":"stale cleanup"')) "audit trail contains reason"
        Assert ($auditContent.Contains('"action":"stop"')) "audit trail contains action"
    } else {
        Assert ($false) "audit trail file should exist"
    }

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
