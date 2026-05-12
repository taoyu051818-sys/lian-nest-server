#Requires -Version 7.0
<#
.SYNOPSIS
    Waits for bounded parallel workers and updates active-workers.json.

.DESCRIPTION
    Reads the active worker manifest produced by batch-launch.ps1, polls worker
    processes, consumes per-worker result JSON files, classifies failures, and
    writes a summary back to the manifest. Returns non-zero when any worker in
    the selected batch failed, became stale, or is still running in -Once mode.
#>

[CmdletBinding()]
param(
    [string]$WorkerManifestPath = ".github/ai-state/active-workers.json",
    [string]$BatchId = "",
    [int]$PollIntervalSeconds = 2,
    [int]$StaleMinutes = 120,
    [switch]$Once
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-IsoNow {
    return (Get-Date).ToUniversalTime().ToString("o")
}

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path $Path)) { return $null }
    return (Get-Content -Path $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Write-JsonFile($Value, [string]$Path) {
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $Value | ConvertTo-Json -Depth 12 | Set-Content -Path $Path -Encoding UTF8
}

function Get-Prop($Obj, [string]$Name, $Default = $null) {
    if ($null -eq $Obj) { return $Default }
    if ($Obj.PSObject.Properties.Name -contains $Name) {
        $value = $Obj.$Name
        if ($null -eq $value) { return $Default }
        return $value
    }
    return $Default
}

function Invoke-FailureClassifier($Worker) {
    $classifier = Join-Path $PSScriptRoot "classify-self-cycle-failure.js"
    if (-not (Test-Path $classifier)) { return $null }

    $failureFile = Get-Prop $Worker "stderrPath" $null
    if (-not $failureFile -or -not (Test-Path $failureFile)) {
        $failureFile = Get-Prop $Worker "logPath" $null
    }
    if (-not $failureFile -or -not (Test-Path $failureFile)) { return $null }

    try {
        $json = & node $classifier --step batch-launch --file $failureFile 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return ($json | Out-String | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Set-WorkerField($Worker, [string]$Name, $Value) {
    $Worker | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Update-Worker($Worker, [int]$StaleMinutes) {
    $status = [string](Get-Prop $Worker "status" "unknown")
    if ($status -in @("completed", "failed", "stale", "blocked", "needs-human")) {
        return $Worker
    }

    $resultPath = Get-Prop $Worker "resultPath" $null
    if ($resultPath -and (Test-Path $resultPath)) {
        try {
            $result = Read-JsonFile $resultPath
            $exitCode = Get-Prop $result "exitCode" $null
            Set-WorkerField $Worker "exitCode" $exitCode
            Set-WorkerField $Worker "endedAt" (Get-Prop $result "endedAt" (Get-IsoNow))
            if ($null -ne $exitCode -and [int]$exitCode -eq 0) {
                Set-WorkerField $Worker "status" "completed"
            } else {
                Set-WorkerField $Worker "status" "failed"
                $classification = Invoke-FailureClassifier $Worker
                if ($classification) {
                    Set-WorkerField $Worker "failureClass" $classification.errorClass
                    Set-WorkerField $Worker "failureSummary" $classification.humanSummary
                    Set-WorkerField $Worker "safeToRetry" $classification.safeToRetry
                }
            }
            return $Worker
        } catch {
            Set-WorkerField $Worker "status" "failed"
            Set-WorkerField $Worker "endedAt" (Get-IsoNow)
            Set-WorkerField $Worker "failureClass" "RESULT_PARSE_FAILED"
            Set-WorkerField $Worker "failureSummary" "Worker result JSON could not be parsed."
            return $Worker
        }
    }

    $workerPid = Get-Prop $Worker "pid" $null
    $startedAt = Get-Prop $Worker "startedAt" $null
    $ageMinutes = 0
    if ($startedAt) {
        try {
            $ageMinutes = ((Get-Date).ToUniversalTime() - ([datetime]$startedAt).ToUniversalTime()).TotalMinutes
        } catch {
            $ageMinutes = 0
        }
    }

    if ($workerPid) {
        $process = Get-Process -Id ([int]$workerPid) -ErrorAction SilentlyContinue
        if ($process) {
            if ($ageMinutes -ge $StaleMinutes) {
                Set-WorkerField $Worker "status" "stale"
                Set-WorkerField $Worker "endedAt" (Get-IsoNow)
                Set-WorkerField $Worker "failureClass" "STALE_RUNNING_PROCESS"
                Set-WorkerField $Worker "failureSummary" "Worker process is still alive but exceeded stale threshold."
            } else {
                Set-WorkerField $Worker "status" "running"
            }
            return $Worker
        }
    }

    if ($status -eq "planned") {
        return $Worker
    }

    Set-WorkerField $Worker "status" "failed"
    Set-WorkerField $Worker "endedAt" (Get-IsoNow)
    Set-WorkerField $Worker "failureClass" "RESULT_MISSING_AFTER_EXIT"
    Set-WorkerField $Worker "failureSummary" "Worker process has exited or is unavailable and no result JSON was written."
    return $Worker
}

function Build-Summary($Workers) {
    $summary = [ordered]@{
        completed = 0
        failed = 0
        stillRunning = 0
        stale = 0
        blocked = 0
        needsHuman = 0
    }
    foreach ($worker in $Workers) {
        switch ([string](Get-Prop $worker "status" "unknown")) {
            "completed" { $summary.completed++ }
            "failed" { $summary.failed++ }
            "running" { $summary.stillRunning++ }
            "stale" { $summary.stale++ }
            "blocked" { $summary.blocked++ }
            "needs-human" { $summary.needsHuman++ }
        }
    }
    return $summary
}

if (-not (Test-Path $WorkerManifestPath)) {
    Write-Host "FAIL: worker manifest not found: $WorkerManifestPath" -ForegroundColor Red
    exit 2
}

do {
    $manifest = Read-JsonFile $WorkerManifestPath
    if (-not $manifest) {
        Write-Host "FAIL: could not parse worker manifest: $WorkerManifestPath" -ForegroundColor Red
        exit 2
    }

    $workers = @($manifest.workers)
    if ($BatchId) {
        $workers = @($workers | Where-Object { (-not (Get-Prop $_ "batchId" $null)) -or (Get-Prop $_ "batchId" $null) -eq $BatchId -or (Get-Prop $manifest "batchId" "") -eq $BatchId })
    }

    for ($i = 0; $i -lt $workers.Count; $i++) {
        $workers[$i] = Update-Worker $workers[$i] $StaleMinutes
    }

    $allWorkers = @($manifest.workers)
    if ($BatchId -and (Get-Prop $manifest "batchId" "") -ne $BatchId) {
        for ($i = 0; $i -lt $allWorkers.Count; $i++) {
            $wid = Get-Prop $allWorkers[$i] "issueNumber" (Get-Prop $allWorkers[$i] "issue" $null)
            foreach ($updated in $workers) {
                $uid = Get-Prop $updated "issueNumber" (Get-Prop $updated "issue" $null)
                if ($uid -eq $wid) { $allWorkers[$i] = $updated }
            }
        }
        $manifest.workers = $allWorkers
    } else {
        $manifest.workers = $workers
    }

    $summary = Build-Summary @($workers)
    $manifest | Add-Member -NotePropertyName lastWaitSummary -NotePropertyValue $summary -Force
    $manifest | Add-Member -NotePropertyName lastWaitAt -NotePropertyValue (Get-IsoNow) -Force
    Write-JsonFile $manifest $WorkerManifestPath

    Write-Host "parallel worker summary: completed=$($summary.completed) failed=$($summary.failed) running=$($summary.stillRunning) stale=$($summary.stale) blocked=$($summary.blocked) needs-human=$($summary.needsHuman)"

    if ($summary.stillRunning -eq 0 -or $Once) {
        break
    }

    Start-Sleep -Seconds $PollIntervalSeconds
} while ($true)

if ($summary.failed -gt 0 -or $summary.stale -gt 0 -or $summary.blocked -gt 0 -or $summary.needsHuman -gt 0) {
    exit 1
}

if ($Once -and $summary.stillRunning -gt 0) {
    exit 1
}

exit 0
