<#
.SYNOPSIS
    Samples resource usage (CPU, memory, handles, threads) for each active
    worker process listed in the active-workers manifest.

.DESCRIPTION
    Reads the active-workers state projection and, for each worker entry,
    attempts to locate the corresponding OS process by branch name pattern
    and sample its resource footprint.

    This is a skeleton implementation. The process-matching heuristic is
    intentionally conservative — when a PID or process cannot be resolved,
    the report records null metrics so consumers can distinguish "no data"
    from "zero usage."

    Output is a timestamped JSON report suitable for ingestion by the
    telemetry calculator or a monitoring dashboard.

.PARAMETER ManifestFile
    Path to the active-workers state projection JSON. Defaults to
    ./.github/ai-state/active-workers.json

.PARAMETER Json
    Output the report as JSON (default when piped). Otherwise prints a
    human-readable console table.

.PARAMETER DryRun
    Print the manifest that would be loaded and exit without sampling.
    Useful for validating that the manifest resolves correctly.

.EXAMPLE
    # Sample all active workers and print a console table
    ./scripts/ai/sample-active-worker-resources.ps1

.EXAMPLE
    # JSON output for telemetry ingestion
    ./scripts/ai/sample-active-worker-resources.ps1 -Json

.EXAMPLE
    # Dry-run: show manifest without sampling
    ./scripts/ai/sample-active-worker-resources.ps1 -DryRun

.EXAMPLE
    # Help
    ./scripts/ai/sample-active-worker-resources.ps1 -Help
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [string]$ManifestFile = "./.github/ai-state/active-workers.json",

    [switch]$Json,

    [switch]$DryRun,

    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

if ($Help) {
    Get-Help $MyInvocation.MyCommand.Path -Full
    exit 0
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step { param([string]$Msg) if (-not $Json) { Write-Host "[step] $Msg" -ForegroundColor Cyan } }
function Write-Ok   { param([string]$Msg) if (-not $Json) { Write-Host "[ok]   $Msg" -ForegroundColor Green } }
function Write-Warn { param([string]$Msg) if (-not $Json) { Write-Host "[warn] $Msg" -ForegroundColor Yellow } }
function Write-Fail {
    param([string]$Msg)
    if ($Json) {
        [Console]::Error.WriteLine("[fail] $Msg")
    } else {
        Write-Host "[fail] $Msg" -ForegroundColor Red
    }
}

function Get-Prop {
    param($Obj, [string]$Name, $Default = $null)
    if ($Obj.PSObject.Properties.Name -contains $Name) { return $Obj.$Name }
    return $Default
}

# ---------------------------------------------------------------------------
# Load manifest
# ---------------------------------------------------------------------------

if (-not (Test-Path $ManifestFile)) {
    Write-Fail "Manifest file not found: $ManifestFile"
    exit 2
}

$raw = Get-Content -Path $ManifestFile -Raw -Encoding UTF8
$manifest = $raw | ConvertFrom-Json

$manifestVersion = Get-Prop $manifest "markerVersion"
$capturedAt = Get-Prop $manifest "capturedAt"
$workersRaw = Get-Prop $manifest "workers"
$workers = @()
if ($null -ne $workersRaw) {
    $workers = @($workersRaw)
}

Write-Step "Loaded manifest v$manifestVersion from $ManifestFile ($($workers.Count) worker(s))"

# ---------------------------------------------------------------------------
# Dry-run mode
# ---------------------------------------------------------------------------

if ($DryRun) {
    if ($Json) {
        [ordered]@{
            mode          = "dry-run"
            manifestFile  = $ManifestFile
            version       = $manifestVersion
            capturedAt    = $capturedAt
            workerCount   = $workers.Count
            workers       = $workers
        } | ConvertTo-Json -Depth 6
    } else {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  Active Worker Resource Sampler Dry Run" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Manifest:     $ManifestFile"
        Write-Host "Version:      $manifestVersion"
        Write-Host "Captured at:  $capturedAt"
        Write-Host "Workers:      $($workers.Count)"
        Write-Host ""
        if ($workers.Count -gt 0) {
            Write-Host "Worker entries:" -ForegroundColor Cyan
            foreach ($w in $workers) {
                $cg = Get-Prop $w "conflictGroup" "?"
                $iss = Get-Prop $w "issue" "?"
                $br = Get-Prop $w "branch" ""
                Write-Host "  group=$cg  issue=#$iss  branch=$br"
            }
        } else {
            Write-Host "  (no active workers)" -ForegroundColor Gray
        }
        Write-Host ""
        Write-Ok "Dry run complete. No processes sampled."
    }
    exit 0
}

# ---------------------------------------------------------------------------
# Sample resources per worker
# ---------------------------------------------------------------------------

$now = [DateTime]::UtcNow
$samples = @()

foreach ($w in $workers) {
    $conflictGroup = Get-Prop $w "conflictGroup" "unknown"
    $issue = Get-Prop $w "issue" $null
    $branch = Get-Prop $w "branch" ""

    $sample = [ordered]@{
        conflictGroup = $conflictGroup
        issue         = $issue
        branch        = $branch
        sampledAt     = $now.ToString("o")
        processFound  = $false
        pid           = $null
        cpuSeconds    = $null
        workingSetMB  = $null
        handleCount   = $null
        threadCount   = $null
        note          = $null
    }

    # Skeleton: attempt to match a process by branch name pattern.
    # In a full implementation this would resolve PID from a heartbeat
    # or lock file. For now we try a heuristic grep of running node/pwsh
    # processes whose command line contains the branch name.
    if ($branch -and $branch -ne "") {
        try {
            $matched = Get-Process -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.CommandLine -match [regex]::Escape($branch)
                } |
                Select-Object -First 1

            if ($matched) {
                $sample["processFound"] = $true
                $sample["pid"] = $matched.Id
                $sample["cpuSeconds"] = [math]::Round($matched.CPU, 2)
                $sample["workingSetMB"] = [math]::Round($matched.WorkingSet64 / 1MB, 1)
                $sample["handleCount"] = $matched.HandleCount
                $sample["threadCount"] = $matched.Threads.Count
            } else {
                $sample["note"] = "No process matched branch pattern '$branch'."
            }
        } catch {
            $sample["note"] = "Process lookup failed: $($_.Exception.Message)"
        }
    } else {
        $sample["note"] = "No branch name in worker entry; cannot resolve process."
    }

    $samples += $sample
}

# ---------------------------------------------------------------------------
# Build report
# ---------------------------------------------------------------------------

$report = [ordered]@{
    schemaVersion = 1
    capturedAt    = $now.ToString("o")
    manifestVersion = $manifestVersion
    manifestCapturedAt = $capturedAt
    workerCount   = $samples.Count
    samples       = $samples
}

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

if ($Json) {
    $report | ConvertTo-Json -Depth 6
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Active Worker Resource Sampler" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Manifest version: $manifestVersion"
    Write-Host "Workers sampled:  $($samples.Count)"
    Write-Host "Sampled at:       $($now.ToString("o"))"
    Write-Host ""

    if ($samples.Count -eq 0) {
        Write-Host "  (no active workers)" -ForegroundColor Gray
    } else {
        # Table header
        Write-Host ("  {0,-20} {1,-8} {2,-8} {3,-10} {4,-10} {5,-8} {6}" -f `
            "conflictGroup", "issue", "pid", "cpu(s)", "mem(MB)", "handles", "threads")
        Write-Host ("  {0,-20} {1,-8} {2,-8} {3,-10} {4,-10} {5,-8} {6}" -f `
            "--------------------", "--------", "--------", "----------", "----------", "--------", "-------")

        foreach ($s in $samples) {
            $pidStr = if ($s.pid) { $s.pid.ToString() } else { "-" }
            $cpuStr = if ($null -ne $s.cpuSeconds) { $s.cpuSeconds.ToString() } else { "-" }
            $memStr = if ($null -ne $s.workingSetMB) { $s.workingSetMB.ToString() } else { "-" }
            $hStr = if ($null -ne $s.handleCount) { $s.handleCount.ToString() } else { "-" }
            $tStr = if ($null -ne $s.threadCount) { $s.threadCount.ToString() } else { "-" }
            $issStr = if ($s.issue) { "#$($s.issue)" } else { "-" }

            Write-Host ("  {0,-20} {1,-8} {2,-8} {3,-10} {4,-10} {5,-8} {6}" -f `
                $s.conflictGroup, $issStr, $pidStr, $cpuStr, $memStr, $hStr, $tStr)

            if ($s.note) {
                Write-Host "    $($s.note)" -ForegroundColor Yellow
            }
        }
    }

    Write-Host ""
    Write-Ok "Sample complete."
}
