#Requires -Version 7.0

[CmdletBinding()]
param(
    [switch]$Json,

    [ValidateRange(1, 50)]
    [int]$TopProcessCount = 10,

    [string]$WorkingDirectory = (Get-Location).Path,

    [string]$StateFile = "./.github/ai-state/local-resource.json",

    [string]$PolicyFile = "./.github/ai-policy/local-resource-policy.json",

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step { param([string]$Msg) if (-not $Json) { Write-Host "[step] $Msg" -ForegroundColor Cyan } }
function Write-Ok   { param([string]$Msg) if (-not $Json) { Write-Host "[ok]   $Msg" -ForegroundColor Green } }
function Write-Warn { param([string]$Msg) if (-not $Json) { Write-Host "[warn] $Msg" -ForegroundColor Yellow } }

function Get-Prop {
    param($Obj, [string]$Name, $Default = $null)
    if ($null -eq $Obj) { return $Default }
    if ($Obj.PSObject.Properties.Name -contains $Name) { return $Obj.$Name }
    return $Default
}

function Get-SafeDivide {
    param([double]$Numerator, [double]$Denominator)
    if ($Denominator -eq 0) { return 0 }
    return [math]::Round($Numerator / $Denominator, 4)
}

function Get-PolicyThreshold {
    param(
        $Policy,
        [string]$SectionName,
        [string]$ThresholdName,
        [double]$DefaultValue
    )

    $section = Get-Prop $Policy $SectionName
    $thresholds = Get-Prop $section "thresholds"
    $threshold = Get-Prop $thresholds $ThresholdName
    $value = Get-Prop $threshold "value"
    if ($null -eq $value) { return $DefaultValue }
    return [double]$value
}

function Get-PolicyTtlSeconds {
    param($Policy)

    foreach ($path in @(
        @("snapshot", "ttlSeconds"),
        @("global", "ttlSeconds"),
        @("metadata", "ttlSeconds"),
        @("enforcement", "ttlSeconds")
    )) {
        $node = $Policy
        foreach ($segment in $path) {
            $node = Get-Prop $node $segment
            if ($null -eq $node) { break }
        }
        if ($null -ne $node) {
            return [int]$node
        }
    }

    return 300
}

function Get-PressureBand {
    param(
        [string]$MetricName,
        $PressureClassification,
        [double]$Value,
        [double]$WarnThreshold,
        [double]$BlockThreshold
    )

    $metricPolicy = Get-Prop $PressureClassification $MetricName
    if ($metricPolicy) {
        $red = Get-Prop $metricPolicy "red"
        $yellow = Get-Prop $metricPolicy "yellow"
        $redMin = Get-Prop $red "min"
        $yellowMin = Get-Prop $yellow "min"

        if ($null -ne $redMin -and $Value -ge [double]$redMin) { return "critical" }
        if ($null -ne $yellowMin -and $Value -ge [double]$yellowMin) { return "constrained" }
        return "healthy"
    }

    if ($Value -ge $BlockThreshold) { return "critical" }
    if ($Value -ge $WarnThreshold) { return "constrained" }
    return "healthy"
}

function Get-GlobalResourceState {
    param([string[]]$States)

    $usableStates = @($States | Where-Object { $_ -in @("healthy", "constrained", "critical") })
    if ($usableStates.Count -eq 0) { return "unknown" }
    if ($usableStates -contains "critical") { return "critical" }
    if ($usableStates -contains "constrained") { return "constrained" }
    return "healthy"
}

$defaultPolicy = [ordered]@{
    ttlSeconds           = 300
    cpuWarn              = 75
    cpuBlock             = 90
    memoryWarn           = 80
    memoryBlock          = 92
    diskWarn             = 85
    diskBlock            = 95
    processWarn          = 25
    processBlock         = 30
    processMarker        = "claude-worker"
    pressureClassification = $null
}

$policyConfig = [ordered]@{
    ttlSeconds             = $defaultPolicy.ttlSeconds
    cpuWarn                = $defaultPolicy.cpuWarn
    cpuBlock               = $defaultPolicy.cpuBlock
    memoryWarn             = $defaultPolicy.memoryWarn
    memoryBlock            = $defaultPolicy.memoryBlock
    diskWarn               = $defaultPolicy.diskWarn
    diskBlock              = $defaultPolicy.diskBlock
    processWarn            = $defaultPolicy.processWarn
    processBlock           = $defaultPolicy.processBlock
    processMarker          = $defaultPolicy.processMarker
    pressureClassification = $defaultPolicy.pressureClassification
}
$fallbackNotes = @()

if (Test-Path $PolicyFile) {
    try {
        $policyRaw = Get-Content -Path $PolicyFile -Raw -Encoding UTF8
        $policy = $policyRaw | ConvertFrom-Json
        $policyConfig.ttlSeconds = Get-PolicyTtlSeconds -Policy $policy
        $policyConfig.cpuWarn = Get-PolicyThreshold -Policy $policy -SectionName "cpu" -ThresholdName "launchWarn" -DefaultValue $policyConfig.cpuWarn
        $policyConfig.cpuBlock = Get-PolicyThreshold -Policy $policy -SectionName "cpu" -ThresholdName "launchBlock" -DefaultValue $policyConfig.cpuBlock
        $policyConfig.memoryWarn = Get-PolicyThreshold -Policy $policy -SectionName "memory" -ThresholdName "launchWarn" -DefaultValue $policyConfig.memoryWarn
        $policyConfig.memoryBlock = Get-PolicyThreshold -Policy $policy -SectionName "memory" -ThresholdName "launchBlock" -DefaultValue $policyConfig.memoryBlock
        $policyConfig.diskWarn = Get-PolicyThreshold -Policy $policy -SectionName "disk" -ThresholdName "launchWarn" -DefaultValue $policyConfig.diskWarn
        $policyConfig.diskBlock = Get-PolicyThreshold -Policy $policy -SectionName "disk" -ThresholdName "launchBlock" -DefaultValue $policyConfig.diskBlock
        $policyConfig.processWarn = Get-PolicyThreshold -Policy $policy -SectionName "processCount" -ThresholdName "launchWarn" -DefaultValue $policyConfig.processWarn
        $policyConfig.processBlock = Get-PolicyThreshold -Policy $policy -SectionName "processCount" -ThresholdName "launchBlock" -DefaultValue $policyConfig.processBlock
        $policyConfig.pressureClassification = Get-Prop $policy "pressureClassification"

        $processCount = Get-Prop $policy "processCount"
        $countingMethod = Get-Prop $processCount "countingMethod"
        $processMarker = Get-Prop $countingMethod "marker"
        if ($processMarker) {
            $policyConfig.processMarker = [string]$processMarker
        }
    } catch {
        $fallbackNotes += "Policy parse failed; built-in thresholds used."
        Write-Warn "Could not parse policy file. Using built-in thresholds."
    }
}

if ($DryRun) {
    $dryRunReport = [ordered]@{
        mode             = "dry-run"
        stateFile        = $StateFile
        policyFile       = $PolicyFile
        workingDirectory = "[sanitized-volume-only]"
        topProcessCount  = $TopProcessCount
        ttlSeconds       = $policyConfig.ttlSeconds
        writesStateFile  = $true
        notes            = "Writes sanitized local resource state when DryRun is not set."
    }

    if ($Json) {
        $dryRunReport | ConvertTo-Json -Depth 4
    } else {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  Local Resource Sampler - Dry Run" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "State file:       $StateFile"
        Write-Host "Policy file:      $PolicyFile"
        Write-Host "TTL seconds:      $($policyConfig.ttlSeconds)"
        Write-Host "Writes snapshot:  yes"
        Write-Host ""
        Write-Ok "Dry run complete. No metrics sampled."
    }

    exit 0
}

$cpuReport = [ordered]@{
    cores       = [Environment]::ProcessorCount
    usagePercent = $null
    loadAverage = [ordered]@{
        oneMin      = $null
        fiveMin     = $null
        fifteenMin  = $null
    }
}

$memoryReport = [ordered]@{
    totalGB       = $null
    usedGB        = $null
    availableGB   = $null
    usagePercent  = $null
}

$diskReport = [ordered]@{
    totalGB       = $null
    usedGB        = $null
    availableGB   = $null
    usagePercent  = $null
    mountPoint    = $null
}

$processReport = [ordered]@{
    runningCount    = $null
    maxAllowed      = [int]$policyConfig.processBlock
    headroomPercent = $null
}

Write-Step "Sampling CPU"
try {
    $cpuUsage = $null

    if (Get-Command Get-Counter -ErrorAction SilentlyContinue) {
        try {
            $cpuCounter = Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction Stop
            if ($cpuCounter.CounterSamples.Count -gt 0) {
                $cpuUsage = [double]$cpuCounter.CounterSamples[0].CookedValue
            }
        } catch {
            $fallbackNotes += "CPU sampled from Win32_Processor because performance counters were unavailable."
        }
    } else {
        $fallbackNotes += "CPU sampled from Win32_Processor because Get-Counter was unavailable."
    }

    if ($null -eq $cpuUsage) {
        $cpuAverage = Get-CimInstance Win32_Processor -ErrorAction Stop |
            Measure-Object -Property LoadPercentage -Average
        if ($cpuAverage.Count -gt 0 -and $null -ne $cpuAverage.Average) {
            $cpuUsage = [double]$cpuAverage.Average
        }
    }

    if ($null -ne $cpuUsage) {
        $cpuReport.usagePercent = [math]::Round([Math]::Max(0, [Math]::Min($cpuUsage, 100)), 2)
    }
} catch {
    $fallbackNotes += "CPU metric unavailable."
    Write-Warn "CPU metric unavailable."
}

Write-Step "Sampling memory"
try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $totalBytes = [long]$os.TotalVisibleMemorySize * 1024
    $freeBytes = [long]$os.FreePhysicalMemory * 1024
    $usedBytes = $totalBytes - $freeBytes

    $memoryReport.totalGB = [math]::Round($totalBytes / 1GB, 2)
    $memoryReport.availableGB = [math]::Round($freeBytes / 1GB, 2)
    $memoryReport.usedGB = [math]::Round($usedBytes / 1GB, 2)
    $memoryReport.usagePercent = [math]::Round((Get-SafeDivide -Numerator $usedBytes -Denominator $totalBytes) * 100, 2)
} catch {
    $fallbackNotes += "Memory metric unavailable."
    Write-Warn "Memory metric unavailable."
}

Write-Step "Sampling disk"
try {
    $resolvedPath = (Resolve-Path -Path $WorkingDirectory -ErrorAction Stop).Path
    $root = [System.IO.Path]::GetPathRoot($resolvedPath)
    if (-not $root) {
        throw "Unable to resolve volume root."
    }

    $driveName = $root.Substring(0, 1)
    $driveInfo = Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue

    if ($driveInfo -and $null -ne $driveInfo.Used -and $null -ne $driveInfo.Free) {
        $totalBytes = [long]$driveInfo.Used + [long]$driveInfo.Free
        $usedBytes = [long]$driveInfo.Used
        $freeBytes = [long]$driveInfo.Free
        $diskReport.mountPoint = $root
    } else {
        $deviceId = "$($driveName):"
        $logicalDisk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$deviceId'" -ErrorAction Stop |
            Select-Object -First 1
        if (-not $logicalDisk) {
            throw "Unable to resolve logical disk for $deviceId."
        }

        $totalBytes = [long]$logicalDisk.Size
        $freeBytes = [long]$logicalDisk.FreeSpace
        $usedBytes = $totalBytes - $freeBytes
        $diskReport.mountPoint = $deviceId + "\"
        $fallbackNotes += "Disk sampled from Win32_LogicalDisk because PSDrive usage was unavailable."
    }

    $diskReport.totalGB = [math]::Round($totalBytes / 1GB, 2)
    $diskReport.usedGB = [math]::Round($usedBytes / 1GB, 2)
    $diskReport.availableGB = [math]::Round($freeBytes / 1GB, 2)
    $diskReport.usagePercent = [math]::Round((Get-SafeDivide -Numerator $usedBytes -Denominator $totalBytes) * 100, 2)
} catch {
    $fallbackNotes += "Disk metric unavailable."
    Write-Warn "Disk metric unavailable."
}

Write-Step "Sampling process capacity"
try {
    $workerCount = $null
    $markerRegex = [regex]::Escape($policyConfig.processMarker)

    try {
        $workerCount = @(
            Get-CimInstance Win32_Process -ErrorAction Stop |
                Where-Object {
                    $commandLine = Get-Prop $_ "CommandLine" ""
                    $name = Get-Prop $_ "Name" ""
                    (($commandLine -is [string]) -and $commandLine -match $markerRegex) -or
                    (($name -is [string]) -and $name -match $markerRegex)
                }
        ).Count
    } catch {
        $fallbackNotes += "Process count sampled from process names only because Win32_Process command lines were unavailable."
        $workerCount = @(
            Get-Process -ErrorAction Stop |
                Where-Object {
                    $_.ProcessName -match $markerRegex
                }
        ).Count
    }

    $processReport.runningCount = [int]$workerCount
    if ($processReport.maxAllowed -gt 0) {
        $remaining = [Math]::Max($processReport.maxAllowed - $processReport.runningCount, 0)
        $processReport.headroomPercent = [math]::Round((Get-SafeDivide -Numerator $remaining -Denominator $processReport.maxAllowed) * 100, 2)
    }
} catch {
    $fallbackNotes += "Process metric unavailable."
    Write-Warn "Process metric unavailable."
}

$metricStates = @()
$coreMetricCount = 0
if ($null -ne $cpuReport.usagePercent) {
    $metricStates += Get-PressureBand -MetricName "cpu" -PressureClassification $policyConfig.pressureClassification -Value $cpuReport.usagePercent -WarnThreshold $policyConfig.cpuWarn -BlockThreshold $policyConfig.cpuBlock
    $coreMetricCount++
}
if ($null -ne $memoryReport.usagePercent) {
    $metricStates += Get-PressureBand -MetricName "memory" -PressureClassification $policyConfig.pressureClassification -Value $memoryReport.usagePercent -WarnThreshold $policyConfig.memoryWarn -BlockThreshold $policyConfig.memoryBlock
    $coreMetricCount++
}
if ($null -ne $diskReport.usagePercent) {
    $metricStates += Get-PressureBand -MetricName "disk" -PressureClassification $policyConfig.pressureClassification -Value $diskReport.usagePercent -WarnThreshold $policyConfig.diskWarn -BlockThreshold $policyConfig.diskBlock
    $coreMetricCount++
}
if ($null -ne $processReport.runningCount) {
    if ($processReport.runningCount -ge $processReport.maxAllowed) {
        $metricStates += "critical"
    } elseif ($processReport.runningCount -ge $policyConfig.processWarn) {
        $metricStates += "constrained"
    } else {
        $metricStates += "healthy"
    }
}
$globalState = if ($coreMetricCount -gt 0) {
    Get-GlobalResourceState -States $metricStates
} else {
    "unknown"
}
$capturedAt = [DateTime]::UtcNow.ToString("o")

$notes = @(
    "This file is a sanitized state projection. It never contains API keys, tokens, hostnames, usernames, personally identifying paths, or raw system command output."
)
if ($fallbackNotes.Count -gt 0) {
    $notes += ("Fallbacks used: " + (($fallbackNotes | Select-Object -Unique) -join " "))
}

$state = [ordered]@{
    stateVersion = 1
    cpu = $cpuReport
    memory = $memoryReport
    disk = $diskReport
    process = $processReport
    global = [ordered]@{
        resourceState = $globalState
        lastUpdatedBy = "sample-local-resource"
        capturedAt = $capturedAt
        ttlSeconds = [int]$policyConfig.ttlSeconds
    }
    notes = ($notes -join " ")
}

$stateDir = Split-Path -Path $StateFile -Parent
if ($stateDir -and -not (Test-Path $stateDir)) {
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
}

$jsonContent = $state | ConvertTo-Json -Depth 8
Set-Content -Path $StateFile -Value $jsonContent -Encoding UTF8

if ($Json) {
    $jsonContent
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Local Resource Sampler" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Captured at:    $capturedAt"
    Write-Host "Resource state: $globalState"
    Write-Host "State file:     $StateFile"
    Write-Host ""
    Write-Host "CPU usage:      $(if ($null -ne $cpuReport.usagePercent) { "$($cpuReport.usagePercent)%" } else { "(unavailable)" })"
    Write-Host "Memory usage:   $(if ($null -ne $memoryReport.usagePercent) { "$($memoryReport.usagePercent)%" } else { "(unavailable)" })"
    Write-Host "Disk usage:     $(if ($null -ne $diskReport.usagePercent) { "$($diskReport.usagePercent)%" } else { "(unavailable)" })"
    Write-Host "Worker count:   $(if ($null -ne $processReport.runningCount) { "$($processReport.runningCount)/$($processReport.maxAllowed)" } else { "(unavailable)" })"
    if ($fallbackNotes.Count -gt 0) {
        Write-Host ""
        Write-Warn ("Fallbacks: " + (($fallbackNotes | Select-Object -Unique) -join " "))
    }
    Write-Host ""
    Write-Ok "Sanitized local resource state updated."
}

exit 0