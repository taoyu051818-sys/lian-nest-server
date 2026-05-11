<#
.SYNOPSIS
    Writes a main branch health state marker to .github/ai-state/main-health.json.

.DESCRIPTION
    Records the result of a post-merge health gate run as a structured JSON marker
    file. Downstream consumers (scheduler, launch gate, merge scripts) read this
    file to decide whether main is safe for further automated work.

    States:
        green  - All health checks passed.
        yellow - Non-critical checks failed; worker classes may be restricted.
        red    - Critical health gate failure; main is blocked.
        black  - Unrecoverable state; manual intervention required.

    This script does NOT:
    - Run the health gate itself (call post-merge-health-gate.js separately).
    - Modify any runtime source files.
    - Wire into CI (future work).

.PARAMETER State
    Health state to record. One of: green, yellow, red, black.

.PARAMETER CommitSha
    Git SHA of the commit being recorded. Defaults to HEAD.

.PARAMETER OutputPath
    Path for the JSON marker file. Defaults to ./.github/ai-state/main-health.json

.PARAMETER Checks
    Comma-separated list of check names that were evaluated (e.g. "tsc,build,prisma").

.PARAMETER FailedChecks
    Comma-separated list of check names that failed.

.PARAMETER AllowedWorkerClasses
    Comma-separated worker classes allowed to proceed in this state.
    Defaults vary by state:
        green  - all
        yellow - fix-only,docs
        red    - (none)
        black  - (none)

.PARAMETER Reason
    Optional human-readable reason for the state transition.

.PARAMETER DryRun
    Preview the JSON that would be written without modifying any files.

.EXAMPLE
    # Preview a green state marker
    ./scripts/ai/write-main-health-state.ps1 -State green -DryRun

.EXAMPLE
    # Record a yellow state with restricted worker classes
    ./scripts/ai/write-main-health-state.ps1 -State yellow -Checks "tsc,build,prisma" -FailedChecks "prisma" -Reason "Prisma schema drift detected"

.EXAMPLE
    # Record green state for a specific commit
    ./scripts/ai/write-main-health-state.ps1 -State green -CommitSha "abc1234" -Checks "tsc,build,prisma,test"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("green", "yellow", "red", "black")]
    [string]$State,

    [string]$CommitSha = "",

    [string]$OutputPath = "./.github/ai-state/main-health.json",

    [string]$Checks = "",

    [string]$FailedChecks = "",

    [string]$AllowedWorkerClasses = "",

    [string]$Reason = "",

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step { param([string]$Msg) Write-Host "[step] $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[ok]   $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[warn] $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "[fail] $Msg" -ForegroundColor Red }

# ---------------------------------------------------------------------------
# Resolve commit SHA
# ---------------------------------------------------------------------------

if ($CommitSha -eq "") {
    $CommitSha = (git rev-parse HEAD 2>$null).Trim()
    if (-not $CommitSha) {
        Write-Fail "Could not resolve HEAD. Pass -CommitSha explicitly."
        exit 1
    }
}

# ---------------------------------------------------------------------------
# Default allowedWorkerClasses by state
# ---------------------------------------------------------------------------

if ($AllowedWorkerClasses -eq "") {
    $AllowedWorkerClasses = switch ($State) {
        "green"  { "all" }
        "yellow" { "fix-only,docs" }
        "red"    { "" }
        "black"  { "" }
    }
}

$classesArray = @()
if ($AllowedWorkerClasses -ne "") {
    $classesArray = $AllowedWorkerClasses -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
}

# ---------------------------------------------------------------------------
# Parse check lists
# ---------------------------------------------------------------------------

$checksArray = @()
if ($Checks -ne "") {
    $checksArray = $Checks -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
}

$failedArray = @()
if ($FailedChecks -ne "") {
    $failedArray = $FailedChecks -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
}

# ---------------------------------------------------------------------------
# Build marker object
# ---------------------------------------------------------------------------

$now = [DateTime]::UtcNow

$marker = [ordered]@{
    markerVersion        = 1
    state                = $State
    commitSha            = $CommitSha
    capturedAt           = $now.ToString("o")
    checks               = $checksArray
    failedChecks         = $failedArray
    allowedWorkerClasses = $classesArray
}

if ($Reason -ne "") {
    $marker["reason"] = $Reason
}

$json = $marker | ConvertTo-Json -Depth 4

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

Write-Step "Main health state marker"
Write-Host ""
Write-Host $json
Write-Host ""

if ($DryRun) {
    Write-Warn "Dry-run mode. No files were written."
    Write-Host "Would write to: $OutputPath"
    exit 0
}

# ---------------------------------------------------------------------------
# Write marker file
# ---------------------------------------------------------------------------

$dir = Split-Path -Parent $OutputPath
if ($dir -and -not (Test-Path $dir)) {
    Write-Step "Creating directory: $dir"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

Set-Content -Path $OutputPath -Value $json -Encoding UTF8
Write-Ok "Health state marker written to: $OutputPath"
Write-Host "  state=$State commit=$($CommitSha.Substring(0, [Math]::Min(8, $CommitSha.Length))) checks=$($checksArray.Count) failed=$($failedArray.Count) workerClasses=[$AllowedWorkerClasses]"
