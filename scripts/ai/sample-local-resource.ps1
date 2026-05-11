<#
.SYNOPSIS
    Non-destructive local resource sampler that reports CPU, memory, disk,
    and process state for orchestration health checks.

.DESCRIPTION
    Samples local machine resources and emits a structured report. This is a
    read-only diagnostic tool — it does not modify any files or state.

    Collected signals:
    - CPU: overall load and per-core usage
    - Memory: total, used, available, and pressure ratio
    - Disk: capacity, free space, and usage percentage for the working volume
    - Processes: top processes by CPU and memory (configurable count)

    Output can be plain text (default) or JSON for programmatic consumption.

.PARAMETER Json
    Output the report as a JSON object instead of formatted console text.

.PARAMETER TopProcessCount
    Number of top processes to include in the report. Defaults to 10.

.PARAMETER WorkingDirectory
    The directory whose volume is used for the disk check. Defaults to the
    current working directory.

.PARAMETER DryRun
    Print what the sampler would collect without gathering metrics, then exit.
    Useful for validating that the script loads correctly.

.EXAMPLE
    # Default text report
    ./scripts/ai/sample-local-resource.ps1

.EXAMPLE
    # JSON output for CI consumption
    ./scripts/ai/sample-local-resource.ps1 -Json

.EXAMPLE
    # Show top 20 processes
    ./scripts/ai/sample-local-resource.ps1 -TopProcessCount 20

.EXAMPLE
    # Dry-run: verify script loads without collecting data
    ./scripts/ai/sample-local-resource.ps1 -DryRun
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [switch]$Json,

    [ValidateRange(1, 50)]
    [int]$TopProcessCount = 10,

    [string]$WorkingDirectory = (Get-Location).Path,

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step { param([string]$Msg) if (-not $Json) { Write-Host "[step] $Msg" -ForegroundColor Cyan } }
function Write-Ok   { param([string]$Msg) if (-not $Json) { Write-Host "[ok]   $Msg" -ForegroundColor Green } }
function Write-Warn { param([string]$Msg) if (-not $Json) { Write-Host "[warn] $Msg" -ForegroundColor Yellow } }
function Get-SafeDivide {
    param([double]$Numerator, [double]$Denominator)
    if ($Denominator -eq 0) { return 0 }
    return [math]::Round($Numerator / $Denominator, 4)
}

# ---------------------------------------------------------------------------
# Dry-run mode
# ---------------------------------------------------------------------------

if ($DryRun) {
    $dryRunReport = [ordered]@{
        mode            = "dry-run"
        scriptPath      = $MyInvocation.MyCommand.Path
        topProcessCount = $TopProcessCount
        workingDirectory = $WorkingDirectory
        json            = $Json.IsPresent
        signals         = @("cpu", "memory", "disk", "processes")
        notes           = "Read-only sampler. No files are modified."
    }
    if ($Json) {
        $dryRunReport | ConvertTo-Json -Depth 4
    } else {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  Local Resource Sampler — Dry Run" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Script:           $($dryRunReport.scriptPath)"
        Write-Host "Working directory: $WorkingDirectory"
        Write-Host "Top processes:     $TopProcessCount"
        Write-Host "Output format:     $(if ($Json) { 'JSON' } else { 'text' })"
        Write-Host "Signals:           cpu, memory, disk, processes"
        Write-Host ""
        Write-Ok "Dry run complete. No data collected."
    }
    exit 0
}

# ---------------------------------------------------------------------------
# Sample CPU
# ---------------------------------------------------------------------------

Write-Step "Sampling CPU state"

$cpuReport = [ordered]@{
    logicalCores   = 0
    overallPercent = $null
}

try {
    $cpuReport.logicalCores = [Environment]::ProcessorCount

    # Use Get-Counter for instantaneous CPU load (Windows)
    $cpuCounter = (Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction SilentlyContinue)
    if ($cpuCounter -and $cpuCounter.CounterSamples.Count -gt 0) {
        $cpuReport.overallPercent = [math]::Round($cpuCounter.CounterSamples[0].CookedValue, 2)
    }
} catch {
    Write-Warn "Could not sample CPU: $_"
}

# ---------------------------------------------------------------------------
# Sample Memory
# ---------------------------------------------------------------------------

Write-Step "Sampling memory state"

$memoryReport = [ordered]@{
    totalGB     = $null
    usedGB      = $null
    availableGB = $null
    pressurePct = $null
}

try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $totalBytes = [long]$os.TotalVisibleMemorySize * 1024
    $freeBytes  = [long]$os.FreePhysicalMemory * 1024
    $usedBytes  = $totalBytes - $freeBytes

    $memoryReport.totalGB     = [math]::Round($totalBytes / 1GB, 2)
    $memoryReport.availableGB = [math]::Round($freeBytes / 1GB, 2)
    $memoryReport.usedGB      = [math]::Round($usedBytes / 1GB, 2)
    $memoryReport.pressurePct = [math]::Round((Get-SafeDivide $usedBytes $totalBytes) * 100, 2)
} catch {
    Write-Warn "Could not sample memory: $_"
}

# ---------------------------------------------------------------------------
# Sample Disk
# ---------------------------------------------------------------------------

Write-Step "Sampling disk state for volume of $WorkingDirectory"

$diskReport = [ordered]@{
    volume       = $null
    totalGB      = $null
    usedGB       = $null
    freeGB       = $null
    usedPct      = $null
}

try {
    # Resolve the volume root from the working directory
    $driveInfo = $null
    $path = (Resolve-Path $WorkingDirectory -ErrorAction Stop).Path

    # Walk up to find the root (e.g., C:\)
    $root = [System.IO.Path]::GetPathRoot($path)
    if ($root) {
        $driveInfo = Get-PSDrive -Name ($root.TrimEnd(':\')) -ErrorAction SilentlyContinue
    }

    if ($driveInfo) {
        $total = [long]$driveInfo.Used + [long]$driveInfo.Free
        $diskReport.volume  = $driveInfo.Name + ":"
        $diskReport.totalGB = [math]::Round($total / 1GB, 2)
        $diskReport.usedGB  = [math]::Round([long]$driveInfo.Used / 1GB, 2)
        $diskReport.freeGB  = [math]::Round([long]$driveInfo.Free / 1GB, 2)
        $diskReport.usedPct = [math]::Round((Get-SafeDivide ([long]$driveInfo.Used) $total) * 100, 2)
    } else {
        Write-Warn "Could not resolve drive for path: $path"
    }
} catch {
    Write-Warn "Could not sample disk: $_"
}

# ---------------------------------------------------------------------------
# Sample Top Processes
# ---------------------------------------------------------------------------

Write-Step "Sampling top $TopProcessCount processes"

$processReport = @()

try {
    $allProcs = Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CPU -gt 0 } |
        Sort-Object -Property CPU -Descending |
        Select-Object -First $TopProcessCount

    foreach ($p in $allProcs) {
        $processReport += [ordered]@{
            pid         = $p.Id
            name        = $p.ProcessName
            cpuSeconds  = [math]::Round([double]($p.CPU), 2)
            memMB       = [math]::Round([double]($p.WorkingSet64) / 1MB, 2)
        }
    }
} catch {
    Write-Warn "Could not sample processes: $_"
}

# ---------------------------------------------------------------------------
# Assemble report
# ---------------------------------------------------------------------------

$now = [DateTime]::UtcNow

$report = [ordered]@{
    schemaVersion = 1
    capturedAt    = $now.ToString("o")
    hostname      = $env:COMPUTERNAME
    cpu           = $cpuReport
    memory        = $memoryReport
    disk          = $diskReport
    topProcesses  = $processReport
}

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

if ($Json) {
    $report | ConvertTo-Json -Depth 6
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Local Resource Sampler" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Captured at: $($report.capturedAt)"
    Write-Host "Hostname:    $($report.hostname)"
    Write-Host ""

    # CPU
    Write-Host "CPU" -ForegroundColor Cyan
    Write-Host "  Logical cores:  $($cpuReport.logicalCores)"
    if ($null -ne $cpuReport.overallPercent) {
        $cpuColor = if ($cpuReport.overallPercent -gt 80) { "Red" } elseif ($cpuReport.overallPercent -gt 50) { "Yellow" } else { "Green" }
        Write-Host "  Overall load:   $($cpuReport.overallPercent)%" -ForegroundColor $cpuColor
    }
    Write-Host ""

    # Memory
    Write-Host "Memory" -ForegroundColor Cyan
    if ($null -ne $memoryReport.totalGB) {
        Write-Host "  Total:      $($memoryReport.totalGB) GB"
        Write-Host "  Used:       $($memoryReport.usedGB) GB"
        Write-Host "  Available:  $($memoryReport.availableGB) GB"
        $memColor = if ($memoryReport.pressurePct -gt 85) { "Red" } elseif ($memoryReport.pressurePct -gt 70) { "Yellow" } else { "Green" }
        Write-Host "  Pressure:   $($memoryReport.pressurePct)%" -ForegroundColor $memColor
    } else {
        Write-Host "  (unavailable)" -ForegroundColor Yellow
    }
    Write-Host ""

    # Disk
    Write-Host "Disk ($($diskReport.volume))" -ForegroundColor Cyan
    if ($null -ne $diskReport.totalGB) {
        Write-Host "  Total:  $($diskReport.totalGB) GB"
        Write-Host "  Used:   $($diskReport.usedGB) GB"
        Write-Host "  Free:   $($diskReport.freeGB) GB"
        $diskColor = if ($diskReport.usedPct -gt 90) { "Red" } elseif ($diskReport.usedPct -gt 75) { "Yellow" } else { "Green" }
        Write-Host "  Usage:  $($diskReport.usedPct)%" -ForegroundColor $diskColor
    } else {
        Write-Host "  (unavailable)" -ForegroundColor Yellow
    }
    Write-Host ""

    # Processes
    Write-Host "Top Processes (by CPU)" -ForegroundColor Cyan
    if ($processReport.Count -gt 0) {
        Write-Host ("  {0,-8} {1,-25} {2,12} {3,12}" -f "PID", "Name", "CPU(s)", "Mem(MB)")
        Write-Host ("  {0,-8} {1,-25} {2,12} {3,12}" -f "---", "----", "------", "-------")
        foreach ($pr in $processReport) {
            Write-Host ("  {0,-8} {1,-25} {2,12} {3,12}" -f $pr.pid, $pr.name, $pr.cpuSeconds, $pr.memMB)
        }
    } else {
        Write-Host "  (no processes with CPU time)" -ForegroundColor Yellow
    }
    Write-Host ""

    Write-Ok "Sampler complete."
}

exit 0
