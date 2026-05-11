<#
.SYNOPSIS
    Monitors a Claude Code batch worker and emits structured heartbeat snapshots.

.DESCRIPTION
    Tracks a child process by PID, classifies its state (running, running:no-output,
    stale, done, failed), and writes structured JSON snapshots to a local file.

    This script does NOT:
    - Dump raw logs or stdout/stderr content
    - Modify any runtime source files

    When -PublishOnComplete is set, it invokes publish-agent-result.ps1
    to post a sanitized, idempotent result comment on exit.

.PARAMETER ProcessId
    PID of the Claude Code batch worker process to monitor.

.PARAMETER SnapshotPath
    Path where JSON snapshots are written. Defaults to ./scripts/ai/monitor-state.json

.PARAMETER StaleThresholdMs
    Milliseconds of no output before state transitions to 'stale'. Default: 300000 (5 min).

.PARAMETER NoOutputThresholdMs
    Milliseconds of no output before state transitions to 'running:no-output'. Default: 60000 (1 min).

.PARAMETER PollIntervalMs
    Polling interval in milliseconds. Default: 15000 (15 sec).

.PARAMETER TaskId
    Optional task identifier. Defaults to the ProcessId string.

.PARAMETER IssueNumber
    Optional GitHub issue number for the snapshot.

.PARAMETER PublishOnComplete
    When set, invokes publish-agent-result.ps1 after the worker exits.
    Posts a sanitized summary comment with idempotent markers.
    Requires -Repo and either -IssueNumber or -PRNumber.

.PARAMETER Repo
    GitHub repository (OWNER/NAME) for publish-on-complete.
    Falls back to GH_REPO env var.

.PARAMETER PRNumber
    Optional pull request number for publish-on-complete targeting.

.PARAMETER PublishKind
    Result kind for the publisher. Default: "execution".

.EXAMPLE
    .\wait-claude-batch.ps1 -ProcessId 12345 -SnapshotPath ./monitor-state.json -IssueNumber 87

.EXAMPLE
    .\wait-claude-batch.ps1 -ProcessId 12345 -PublishOnComplete -Repo "owner/repo" -IssueNumber 87
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,

    [string]$SnapshotPath = "./scripts/ai/monitor-state.json",

    [int]$StaleThresholdMs = 300000,

    [int]$NoOutputThresholdMs = 60000,

    [int]$PollIntervalMs = 15000,

    [string]$TaskId = "",

    [int]$IssueNumber = 0,

    [switch]$PublishOnComplete,

    [string]$Repo = $env:GH_REPO,

    [int]$PRNumber = 0,

    [ValidateSet("execution", "review", "audit", "metrics")]
    [string]$PublishKind = "execution"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($TaskId -eq "") {
    $TaskId = $ProcessId.ToString()
}

$launchTime = [DateTime]::UtcNow
$lastOutputTime = [DateTime]::UtcNow

function Get-State {
    param(
        [bool]$IsRunning,
        [int]$ExitCode,
        [long]$NoOutputMs
    )

    if (-not $IsRunning) {
        if ($ExitCode -eq 0) {
            return "done"
        }
        return "failed"
    }

    if ($NoOutputMs -ge $StaleThresholdMs) {
        return "stale"
    }

    if ($NoOutputMs -ge $NoOutputThresholdMs) {
        return "running:no-output"
    }

    return "running"
}

function Build-Snapshot {
    param(
        [string]$State,
        [long]$ElapsedMs,
        [long]$NoOutputMs,
        [int]$ExitCode,
        [bool]$IsRunning
    )

    $now = [DateTime]::UtcNow

    $snapshot = [ordered]@{
        snapshotVersion = 1
        taskId          = $TaskId
        state           = $State
        elapsedMs       = $ElapsedMs
        lastOutputAt    = $lastOutputTime.ToString("o")
        capturedAt      = $now.ToString("o")
        exitCode        = if ($IsRunning) { $null } else { $ExitCode }
        noOutputMs      = $NoOutputMs
        issueNumber     = if ($IssueNumber -gt 0) { $IssueNumber } else { $null }
        prNumber        = $null
        label           = $null
    }

    return $snapshot
}

function Write-Snapshot {
    param($Snapshot)

    $json = $Snapshot | ConvertTo-Json -Depth 4
    $dir = Split-Path -Parent $SnapshotPath
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Set-Content -Path $SnapshotPath -Value $json -Encoding UTF8
}

function Publish-Result {
    param(
        [string]$FinalState,
        [int]$ExitCode,
        [long]$ElapsedMs
    )

    $publisherPath = Join-Path $PSScriptRoot "publish-agent-result.ps1"
    if (-not (Test-Path $publisherPath)) {
        Write-Warning "Publisher script not found at $publisherPath. Skipping publish."
        return
    }

    $resolvedRepo = $Repo
    if (-not $resolvedRepo) {
        Write-Warning "PublishOnComplete requires -Repo or GH_REPO env var. Skipping publish."
        return
    }

    if ($IssueNumber -le 0 -and $PRNumber -le 0) {
        Write-Warning "PublishOnComplete requires -IssueNumber or -PRNumber. Skipping publish."
        return
    }

    $elapsedSec = [math]::Round($ElapsedMs / 1000)
    $summary = if ($FinalState -eq "done") {
        "PASS (exit 0, ${elapsedSec}s)"
    } else {
        "FAIL (exit $ExitCode, ${elapsedSec}s)"
    }

    $markerTarget = if ($IssueNumber -gt 0) { $IssueNumber } else { $PRNumber }
    $markerPrefix = if ($IssueNumber -gt 0) { "issue" } else { "pr" }
    $markerId = "$markerPrefix-$markerTarget-monitor-$TaskId"

    $publisherArgs = @{
        Repo    = $resolvedRepo
        Kind    = $PublishKind
        Summary = $summary
        MarkerId = $markerId
    }

    if ($IssueNumber -gt 0) {
        $publisherArgs["TargetIssue"] = $IssueNumber
    } else {
        $publisherArgs["TargetPR"] = $PRNumber
    }

    Write-Host "Publishing result to $resolvedRepo (marker=$markerId)..."

    try {
        & $publisherPath @publisherArgs
        Write-Host "Publish completed."
    } catch {
        Write-Warning "Publish failed: $_"
    }
}

# Main monitoring loop
Write-Host "Monitoring PID $ProcessId (taskId=$TaskId)"
Write-Host "Snapshots: $SnapshotPath"
Write-Host "Thresholds: no-output=${NoOutputThresholdMs}ms, stale=${StaleThresholdMs}ms"
Write-Host "---"

while ($true) {
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    $isRunning = $null -ne $proc

    $now = [DateTime]::UtcNow
    $elapsedMs = [long]($now - $launchTime).TotalMilliseconds
    $noOutputMs = [long]($now - $lastOutputTime).TotalMilliseconds

    $exitCode = 0
    if (-not $isRunning) {
        try {
            $handle = [System.Diagnostics.Process]::GetProcessById($ProcessId)
            # Should not reach here if process is gone, but guard anyway
            $exitCode = $handle.ExitCode
        } catch {
            # Process is fully gone; try to read exit code from last known state
            $exitCode = -1
        }
    }

    $state = Get-State -IsRunning $isRunning -ExitCode $exitCode -NoOutputMs $noOutputMs

    $snapshot = Build-Snapshot -State $state -ElapsedMs $elapsedMs -NoOutputMs $noOutputMs -ExitCode $exitCode -IsRunning $isRunning
    Write-Snapshot -Snapshot $snapshot

    $label = switch ($state) {
        "running"          { "[running]" }
        "running:no-output" { "[running:no-output]" }
        "stale"            { "[STALE]" }
        "done"             { "[done]" }
        "failed"           { "[FAILED]" }
    }

    Write-Host "$([DateTime]::UtcNow.ToString('HH:mm:ss')) $label elapsed=$([math]::Round($elapsedMs/1000))s noOutput=$([math]::Round($noOutputMs/1000))s"

    if (-not $isRunning) {
        Write-Host "---"
        Write-Host "Worker exited with code $exitCode. Final state: $state"
        break
    }

    Start-Sleep -Milliseconds $PollIntervalMs
}

# ---------------------------------------------------------------------------
# Publish-on-complete (opt-in)
# ---------------------------------------------------------------------------

if ($PublishOnComplete) {
    Publish-Result -FinalState $state -ExitCode $exitCode -ElapsedMs $elapsedMs
}
