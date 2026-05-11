<#
.SYNOPSIS
    Samples active worker metrics (pid, cpu, memory, age, status) and projects
    them into ai-state for WebUI dashboard and scheduling decisions.

.DESCRIPTION
    Reads the active-workers state projection and, for each worker entry,
    attempts to locate the corresponding OS process and sample its resource
    footprint. Classifies each worker's status as running, stale, or unknown
    based on process liveness and age thresholds.

    Output is a timestamped JSON report suitable for ingestion by the WebUI
    dashboard, the orchestrator, or a monitoring loop.

    Defaults to dry-run mode — pass -Execute to actually sample processes.

.PARAMETER ManifestFile
    Path to the active-workers state projection JSON. Defaults to
    ./.github/ai-state/active-workers.json

.PARAMETER OutFile
    Path to write the metrics projection JSON. Defaults to
    ./.github/ai-state/worker-metrics.json

.PARAMETER Json
    Output the report as JSON (default when piped). Otherwise prints a
    human-readable console table.

.PARAMETER DryRun
    Print the manifest that would be loaded and exit without sampling.
    This is the default behavior.

.PARAMETER Execute
    Actually sample processes and write the metrics file. Overrides the
    default dry-run behavior.

.PARAMETER StaleMinutes
    Minutes of zero CPU before a worker is classified as stale. Default: 30.

.EXAMPLE
    # Dry-run (default): show what would be sampled
    ./scripts/ai/sample-worker-metrics.ps1

.EXAMPLE
    # Actually sample and write metrics
    ./scripts/ai/sample-worker-metrics.ps1 -Execute

.EXAMPLE
    # JSON output for telemetry ingestion
    ./scripts/ai/sample-worker-metrics.ps1 -Execute -Json

.EXAMPLE
    # Custom stale threshold
    ./scripts/ai/sample-worker-metrics.ps1 -Execute -StaleMinutes 60

.EXAMPLE
    # Help
    ./scripts/ai/sample-worker-metrics.ps1 -Help
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [string]$ManifestFile = "./.github/ai-state/active-workers.json",

    [string]$OutFile = "./.github/ai-state/worker-metrics.json",

    [switch]$Json,

    [switch]$DryRun,

    [switch]$Execute,

    [ValidateRange(1, 1440)]
    [int]$StaleMinutes = 30,

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

function Get-WorkerStatus {
    param(
        [bool]$ProcessFound,
        [double]$CpuSeconds,
        [double]$AgeSeconds,
        [int]$StaleThresholdSeconds
    )

    if (-not $ProcessFound) { return "unknown" }
    if ($CpuSeconds -eq 0 -and $AgeSeconds -gt $StaleThresholdSeconds) { return "stale" }
    return "running"
}

# ---------------------------------------------------------------------------
# Dry-run vs Execute
# ---------------------------------------------------------------------------

$isDryRun = -not $Execute

if ($isDryRun -and -not $Json) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Worker Metrics Sampler — Dry Run" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Mode:             DRY-RUN (default). Pass -Execute to sample."
    Write-Host "Manifest:         $ManifestFile"
    Write-Host "Output:           $OutFile"
    Write-Host "Stale threshold:  $StaleMinutes minutes"
    Write-Host ""
    Write-Ok "Dry run complete. No processes sampled, no files written."
    exit 0
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
# Sample metrics per worker
# ---------------------------------------------------------------------------

$now = [DateTime]::UtcNow
$staleThresholdSeconds = $StaleMinutes * 60
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
        ageSeconds    = $null
        status        = "unknown"
        note          = $null
    }

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

                # Calculate age from process start time
                try {
                    $startTime = $matched.StartTime
                    $age = ($now - $startTime.ToUniversalTime()).TotalSeconds
                    $sample["ageSeconds"] = [math]::Round($age, 0)
                } catch {
                    $sample["ageSeconds"] = $null
                }

                # Classify status
                $cpuVal = if ($null -ne $sample["cpuSeconds"]) { $sample["cpuSeconds"] } else { 0 }
                $ageVal = if ($null -ne $sample["ageSeconds"]) { $sample["ageSeconds"] } else { 0 }
                $sample["status"] = Get-WorkerStatus `
                    -ProcessFound $true `
                    -CpuSeconds $cpuVal `
                    -AgeSeconds $ageVal `
                    -StaleThresholdSeconds $staleThresholdSeconds
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
    schemaVersion    = 1
    capturedAt       = $now.ToString("o")
    manifestVersion  = $manifestVersion
    manifestCapturedAt = $capturedAt
    staleMinutes     = $StaleMinutes
    workerCount      = $samples.Count
    runningCount     = @($samples | Where-Object { $_.status -eq "running" }).Count
    staleCount       = @($samples | Where-Object { $_.status -eq "stale" }).Count
    unknownCount     = @($samples | Where-Object { $_.status -eq "unknown" }).Count
    samples          = $samples
}

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

if ($Json) {
    $report | ConvertTo-Json -Depth 6
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Worker Metrics Sampler" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Manifest version: $manifestVersion"
    Write-Host "Workers sampled:  $($samples.Count)"
    Write-Host "Running:          $($report.runningCount)  Stale: $($report.staleCount)  Unknown: $($report.unknownCount)"
    Write-Host "Sampled at:       $($now.ToString("o"))"
    Write-Host ""

    if ($samples.Count -eq 0) {
        Write-Host "  (no active workers)" -ForegroundColor Gray
    } else {
        # Table header
        Write-Host ("  {0,-20} {1,-8} {2,-8} {3,-8} {4,-10} {5,-10} {6,-10} {7}" -f `
            "conflictGroup", "issue", "pid", "status", "cpu(s)", "mem(MB)", "age(min)", "threads")
        Write-Host ("  {0,-20} {1,-8} {2,-8} {3,-8} {4,-10} {5,-10} {6,-10} {7}" -f `
            "--------------------", "--------", "--------", "--------", "----------", "----------", "----------", "-------")

        foreach ($s in $samples) {
            $pidStr = if ($s.pid) { $s.pid.ToString() } else { "-" }
            $cpuStr = if ($null -ne $s.cpuSeconds) { $s.cpuSeconds.ToString() } else { "-" }
            $memStr = if ($null -ne $s.workingSetMB) { $s.workingSetMB.ToString() } else { "-" }
            $ageStr = if ($null -ne $s.ageSeconds) { [math]::Round($s.ageSeconds / 60, 1).ToString() } else { "-" }
            $tStr = if ($null -ne $s.threadCount) { $s.threadCount.ToString() } else { "-" }
            $issStr = if ($s.issue) { "#$($s.issue)" } else { "-" }
            $statusStr = $s.status

            $statusColor = switch ($statusStr) {
                "running" { "Green" }
                "stale"   { "Yellow" }
                default   { "Gray" }
            }

            Write-Host ("  {0,-20} {1,-8} {2,-8} " -f $s.conflictGroup, $issStr, $pidStr) -NoNewline
            Write-Host ("{0,-8} " -f $statusStr) -ForegroundColor $statusColor -NoNewline
            Write-Host ("{0,-10} {1,-10} {2,-10} {3}" -f $cpuStr, $memStr, $ageStr, $tStr)

            if ($s.note) {
                Write-Host "    $($s.note)" -ForegroundColor Yellow
            }
        }
    }

    Write-Host ""
    Write-Ok "Metrics sample complete."
}

# ---------------------------------------------------------------------------
# Write output file (only in execute mode)
# ---------------------------------------------------------------------------

if ($Execute) {
    $outDir = Split-Path -Parent $OutFile
    if ($outDir -and -not (Test-Path $outDir)) {
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    }
    $report | ConvertTo-Json -Depth 6 | Set-Content -Path $OutFile -Encoding UTF8
    Write-Ok "Metrics written to $OutFile"
}

exit 0
