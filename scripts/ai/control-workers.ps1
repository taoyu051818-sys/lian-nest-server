<#
.SYNOPSIS
    Preview-first worker control wrapper with explicit PID allowlist.

.DESCRIPTION
    Provides safe worker lifecycle control for the WebUI control console.
    Supports three modes:

      LIST (default)   — Read-only: shows active workers from the manifest.
      PREVIEW          — Dry-run: shows which PIDs would be stopped and why.
      STOP             — Mutating: terminates allowlisted PIDs with audit trail.

    Safety policy:
      - Default mode is LIST (read-only).
      - STOP requires -Pids (explicit allowlist) AND -Reason.
      - Refuses broad kill: empty or wildcard PID lists are rejected.
      - Only PIDs present in the allowlist AND found in the manifest are stopped.
      - All stop actions are logged to an audit trail file.
      - Preview mode always available to review before executing.

.PARAMETER Mode
    Operation mode: List (default), Preview, or Stop.
    List is read-only. Preview shows what Stop would do. Stop executes.

.PARAMETER ManifestFile
    Path to the active-workers state projection JSON. Defaults to
    ./.github/ai-state/active-workers.json

.PARAMETER Pids
    Explicit list of PIDs to stop. Required for Preview and Stop modes.
    Only PIDs in this list that also appear in the manifest are acted on.

.PARAMETER Reason
    Human-readable reason for the stop action. Required for Stop mode.
    Logged to the audit trail and included in console output.

.PARAMETER AuditFile
    Path to the audit log file. Defaults to
    ./.github/ai-state/worker-control-audit.jsonl

.PARAMETER Force
    Skip the confirmation prompt in Stop mode. Use with caution.

.PARAMETER Json
    Output structured JSON instead of human-readable text.

.PARAMETER Help
    Display this help message and exit.

.EXAMPLE
    # List active workers (default, read-only)
    ./scripts/ai/control-workers.ps1

.EXAMPLE
    # List with JSON output
    ./scripts/ai/control-workers.ps1 -Json

.EXAMPLE
    # Preview what stopping specific PIDs would do
    ./scripts/ai/control-workers.ps1 -Mode Preview -Pids 1234,5678

.EXAMPLE
    # Stop specific PIDs with reason (mutating)
    ./scripts/ai/control-workers.ps1 -Mode Stop -Pids 1234,5678 -Reason "Stale worker cleanup"

.EXAMPLE
    # Stop with forced skip of confirmation
    ./scripts/ai/control-workers.ps1 -Mode Stop -Pids 1234 -Reason "Manual override" -Force

.EXAMPLE
    # Display help
    ./scripts/ai/control-workers.ps1 -Help
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [ValidateSet("List", "Preview", "Stop")]
    [string]$Mode = "List",

    [string]$ManifestFile = "./.github/ai-state/active-workers.json",

    [int[]]$Pids,

    [string]$Reason,

    [string]$AuditFile = "./.github/ai-state/worker-control-audit.jsonl",

    [switch]$Force,

    [switch]$Json,

    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

if ($Help) {
    @"

WORKER CONTROL — Preview-first wrapper with explicit PID allowlist

USAGE
    ./scripts/ai/control-workers.ps1 [options]

MODES
    List (default)     Read-only: shows active workers from manifest
    Preview            Dry-run: shows which PIDs would be stopped
    Stop               Mutating: terminates allowlisted PIDs with audit

OPTIONS
    -Mode <string>          Operation mode: List, Preview, Stop (default: List)
    -ManifestFile <string>  Path to active-workers.json (default: .github/ai-state/active-workers.json)
    -Pids <int[]>           Explicit PID allowlist (required for Preview and Stop)
    -Reason <string>        Reason for stop action (required for Stop)
    -AuditFile <string>     Path to audit log (default: .github/ai-state/worker-control-audit.jsonl)
    -Force                  Skip confirmation prompt in Stop mode
    -Json                   Output structured JSON
    -Help                   Show this help message

SAFETY POLICY
    - Default mode is List (read-only, no side effects).
    - Stop requires explicit -Pids AND -Reason.
    - Broad kill (empty Pids or wildcard) is refused.
    - Only PIDs in the allowlist that match manifest entries are acted on.
    - All stop actions are logged to audit trail with timestamp and reason.
    - Use Preview mode to review before executing Stop.

"@ | Write-Output
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
# Validation
# ---------------------------------------------------------------------------

# Preview and Stop require Pids
if ($Mode -in @("Preview", "Stop")) {
    if (-not $Pids -or $Pids.Count -eq 0) {
        Write-Fail "Mode '$Mode' requires -Pids. Provide an explicit PID allowlist."
        exit 1
    }
}

# Stop requires Reason
if ($Mode -eq "Stop") {
    if (-not $Reason -or $Reason.Trim().Length -eq 0) {
        Write-Fail "Mode 'Stop' requires -Reason. Provide a human-readable justification."
        exit 1
    }
}

# Refuse broad kill patterns
if ($Pids) {
    $invalidPids = @($Pids | Where-Object { $_ -le 0 })
    if ($invalidPids.Count -gt 0) {
        Write-Fail "Invalid PID(s) detected: $($invalidPids -join ', '). PIDs must be positive integers."
        exit 1
    }
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

$now = [DateTime]::UtcNow

# ---------------------------------------------------------------------------
# Mode: List — read-only, no process scanning
# ---------------------------------------------------------------------------

if ($Mode -eq "List") {
    $listWorkers = @()
    foreach ($w in $workers) {
        $conflictGroup = Get-Prop $w "conflictGroup" "unknown"
        $issue = Get-Prop $w "issue" $null
        $branch = Get-Prop $w "branch" ""

        $listWorkers += [ordered]@{
            conflictGroup = $conflictGroup
            issue         = $issue
            branch        = $branch
            note          = if (-not $branch -or $branch -eq "") { "No branch name in worker entry." } else { $null }
        }
    }

    if ($Json) {
        $output = [ordered]@{
            mode            = "list"
            schemaVersion   = 1
            capturedAt      = $now.ToString("o")
            manifestVersion = $manifestVersion
            workerCount     = $listWorkers.Count
            workers         = $listWorkers
        }
        $output | ConvertTo-Json -Depth 6
    } else {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  Worker Control — List Mode" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Manifest version: $manifestVersion"
        Write-Host "Workers found:    $($listWorkers.Count)"
        Write-Host "Captured at:      $capturedAt"
        Write-Host ""

        if ($listWorkers.Count -eq 0) {
            Write-Host "  (no active workers)" -ForegroundColor Gray
        } else {
            Write-Host ("  {0,-20} {1,-8} {2}" -f `
                "conflictGroup", "issue", "branch")
            Write-Host ("  {0,-20} {1,-8} {2}" -f `
                "--------------------", "--------", "----")

            foreach ($w in $listWorkers) {
                $issStr = if ($w.issue) { "#$($w.issue)" } else { "-" }
                Write-Host ("  {0,-20} {1,-8} {2}" -f $w.conflictGroup, $issStr, $w.branch)

                if ($w.note) {
                    Write-Host "    $($w.note)" -ForegroundColor Yellow
                }
            }
        }

        Write-Host ""
        Write-Ok "List complete. Use -Mode Preview to review stop targets."
    }

    exit 0
}

# ---------------------------------------------------------------------------
# Mode: Preview / Stop — resolve allowlist against manifest
# ---------------------------------------------------------------------------

# Build manifest PID lookup from worker entries that have known PIDs.
# In a real deployment the manifest would include pid fields from the
# worker-metrics sampler. For safety, we only match PIDs that the
# operator explicitly passes via -Pids.

# Match allowlisted PIDs against manifest workers by pid field
$manifestPidMap = @{}
foreach ($w in $workers) {
    $wPid = Get-Prop $w "pid" $null
    if ($wPid) {
        $manifestPidMap[[int]$wPid] = $w
    }
}

# Build action plan: only PIDs in the allowlist that also appear in manifest
$matchedPids = @()
$notInManifestPids = @()

foreach ($targetPid in $Pids) {
    if ($manifestPidMap.ContainsKey($targetPid)) {
        $matchedPids += $targetPid
    } else {
        $notInManifestPids += $targetPid
    }
}

$actions = @()
foreach ($targetPid in $matchedPids) {
    $w = $manifestPidMap[$targetPid]
    $actions += [ordered]@{
        pid           = $targetPid
        conflictGroup = Get-Prop $w "conflictGroup" "unknown"
        issue         = Get-Prop $w "issue" $null
        branch        = Get-Prop $w "branch" ""
        action        = "stop"
    }
}

# ---------------------------------------------------------------------------
# Preview output
# ---------------------------------------------------------------------------

if ($Mode -eq "Preview") {
    if ($Json) {
        $output = [ordered]@{
            mode            = "preview"
            schemaVersion   = 1
            capturedAt      = $now.ToString("o")
            manifestVersion = $manifestVersion
            requestedPids   = $Pids
            matchedCount    = $matchedPids.Count
            notInManifest   = $notInManifestPids
            actions         = $actions
            note            = "Preview only. No processes were terminated."
        }
        $output | ConvertTo-Json -Depth 6
    } else {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "  Worker Control — Preview Mode" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Requested PIDs:       $($Pids -join ', ')"
        Write-Host "Matched (in manifest): $($matchedPids.Count)"
        Write-Host "Not in manifest:      $($notInManifestPids.Count)"
        Write-Host ""

        if ($actions.Count -eq 0) {
            Write-Host "  (no matching PIDs to stop)" -ForegroundColor Gray
        } else {
            Write-Host "  Would stop:" -ForegroundColor Yellow
            Write-Host ""
            Write-Host ("  {0,-8} {1,-20} {2,-8} {3}" -f "pid", "conflictGroup", "issue", "branch")
            Write-Host ("  {0,-8} {1,-20} {2,-8} {3}" -f "--------", "--------------------", "--------", "----")

            foreach ($a in $actions) {
                $issStr = if ($a.issue) { "#$($a.issue)" } else { "-" }
                Write-Host ("  {0,-8} {1,-20} {2,-8} {3}" -f $a.pid, $a.conflictGroup, $issStr, $a.branch)
            }
        }

        if ($notInManifestPids.Count -gt 0) {
            Write-Host ""
            Write-Warn "PIDs not found in manifest (will be skipped): $($notInManifestPids -join ', ')"
        }

        Write-Host ""
        Write-Host "DRY RUN — no processes terminated." -ForegroundColor Yellow

        if ($actions.Count -gt 0) {
            Write-Host ""
            Write-Host "  To execute:" -ForegroundColor Yellow
            Write-Host "    ./scripts/ai/control-workers.ps1 -Mode Stop -Pids $($Pids -join ',') -Reason `"your reason`"" -ForegroundColor Yellow
        }

        Write-Host ""
    }

    exit 0
}

# ---------------------------------------------------------------------------
# Mode: Stop — Confirmation and execution
# ---------------------------------------------------------------------------

if ($actions.Count -eq 0) {
    Write-Warn "No matching PIDs to stop. All requested PIDs are either not in the manifest or already terminated."
    exit 0
}

# Confirmation prompt (unless -Force)
if (-not $Force) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  Worker Control — Stop Mode" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "About to stop $($actions.Count) worker process(es):" -ForegroundColor Yellow
    Write-Host ""

    foreach ($a in $actions) {
        $issStr = if ($a.issue) { "#$($a.issue)" } else { "?" }
        Write-Host "  PID $($a.pid) — $($a.conflictGroup) (issue $issStr)" -ForegroundColor Gray
    }

    Write-Host ""
    Write-Host "Reason: $Reason" -ForegroundColor White
    Write-Host ""

    $confirm = Read-Host "Type 'yes' to confirm stop"
    if ($confirm -ne "yes") {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
}

# Execute stop
Write-Step "Stopping $($actions.Count) worker(s)"

$stopped = 0
$failed = 0
$auditEntries = @()

foreach ($a in $actions) {
    $targetPid = $a.pid
    $conflictGroup = $a.conflictGroup
    $issue = $a.issue

    try {
        $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $targetPid -Force -ErrorAction Stop
            Write-Ok "  Stopped PID $targetPid ($conflictGroup)"
            $stopped++

            $auditEntries += [ordered]@{
                timestamp     = $now.ToString("o")
                action        = "stop"
                pid           = $targetPid
                conflictGroup = $conflictGroup
                issue         = $issue
                branch        = $a.branch
                reason        = $Reason
                result        = "success"
            }
        } else {
            Write-Warn "  PID $targetPid not found (already terminated?)"
            $auditEntries += [ordered]@{
                timestamp     = $now.ToString("o")
                action        = "stop"
                pid           = $targetPid
                conflictGroup = $conflictGroup
                issue         = $issue
                branch        = $a.branch
                reason        = $Reason
                result        = "not-found"
            }
        }
    } catch {
        Write-Fail "  Failed to stop PID ${targetPid}: $($_.Exception.Message)"
        $failed++

        $auditEntries += [ordered]@{
            timestamp     = $now.ToString("o")
            action        = "stop"
            pid           = $targetPid
            conflictGroup = $conflictGroup
            issue         = $issue
            branch        = $a.branch
            reason        = $Reason
            result        = "failed"
            error         = $($_.Exception.Message)
        }
    }
}

# ---------------------------------------------------------------------------
# Audit trail
# ---------------------------------------------------------------------------

$auditDir = Split-Path -Parent $AuditFile
if ($auditDir -and -not (Test-Path $auditDir)) {
    New-Item -ItemType Directory -Path $auditDir -Force | Out-Null
}

foreach ($entry in $auditEntries) {
    $entry | ConvertTo-Json -Depth 6 -Compress | Add-Content -Path $AuditFile -Encoding UTF8
}

Write-Ok "Audit log written to $AuditFile ($($auditEntries.Count) entries)"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

if ($Json) {
    $output = [ordered]@{
        mode            = "stop"
        schemaVersion   = 1
        executedAt      = $now.ToString("o")
        reason          = $Reason
        requestedPids   = $Pids
        matchedCount    = $matchedPids.Count
        stoppedCount    = $stopped
        failedCount     = $failed
        notInManifest   = $notInManifestPids
        auditFile       = $AuditFile
    }
    $output | ConvertTo-Json -Depth 6
} else {
    Write-Host ""
    Write-Host "Stop summary: $stopped stopped, $failed failed" -ForegroundColor White
    Write-Host "Reason: $Reason" -ForegroundColor Gray
    Write-Host ""
}

if ($failed -gt 0) { exit 1 }
exit 0
