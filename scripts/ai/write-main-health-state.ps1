<#
.SYNOPSIS
    Writes a main branch health state marker to .github/ai-state/main-health.json.

.DESCRIPTION
    Records the result of a post-merge health gate run as a structured JSON marker
    file. Downstream consumers (scheduler, launch gate, merge scripts) read this
    file to decide whether main is safe for further automated work.

    The emitted marker is validated against schemas/health-state.schema.json
    before writing. Use -DryRun to preview or -ValidateOnly to check without
    emitting.

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

.PARAMETER ValidateOnly
    Validate the constructed marker against the health-state schema without
    writing. Exits 0 on success, 1 on validation failure.

.EXAMPLE
    # Preview a green state marker
    ./scripts/ai/write-main-health-state.ps1 -State green -DryRun

.EXAMPLE
    # Record a yellow state with restricted worker classes
    ./scripts/ai/write-main-health-state.ps1 -State yellow -Checks "tsc,build,prisma" -FailedChecks "prisma" -Reason "Prisma schema drift detected"

.EXAMPLE
    # Record green state for a specific commit
    ./scripts/ai/write-main-health-state.ps1 -State green -CommitSha "abc1234" -Checks "tsc,build,prisma,test"

.EXAMPLE
    # Validate a state without writing or printing
    ./scripts/ai/write-main-health-state.ps1 -State red -Checks "tsc" -FailedChecks "tsc" -ValidateOnly
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

    [switch]$DryRun,

    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Assert-ValidSha {
    param([string]$Sha)
    if ($Sha -notmatch '^[0-9a-fA-F]{7,40}$') {
        Write-Fail "CommitSha must be 7-40 hex characters. Got: '$Sha'"
        exit 1
    }
}

function Assert-CheckConsistency {
    param([string[]]$AllChecks, [string[]]$Failed)
    foreach ($fc in $Failed) {
        if ($AllChecks -notcontains $fc) {
            Write-Fail "FailedChecks entry '$fc' is not in Checks list [$($AllChecks -join ', ')]. Every failed check must appear in Checks."
            exit 1
        }
    }
}

function Write-Step { param([string]$Msg) Write-Host "[step] $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[ok]   $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[warn] $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "[fail] $Msg" -ForegroundColor Red }

# ---------------------------------------------------------------------------
# Schema constants (mirrors schemas/health-state.schema.json)
# ---------------------------------------------------------------------------

$script:SchemaValidWorkerClasses     = @("all", "fix-only", "docs")
$script:SchemaValidBlockedClasses    = @("runtime-feature", "foundation-fix", "docs", "health-repair", "test-only", "research", "refactor")
$script:SchemaValidStates            = @("green", "yellow", "red", "black")
$script:SchemaFailureCategories      = @("runtime compile", "dependency/generate", "database foundation", "conflict refresh", "boundary guard", "docs guard", "test env", "unknown")
$script:SchemaConfidenceLevels       = @("high", "medium", "low", "none")
$script:SchemaPath                   = "schemas/health-state.schema.json"

function Test-MarkerAgainstSchema {
    <#
    .SYNOPSIS
        Validates a marker hashtable against the health-state schema constraints.
        Returns an array of error strings. Empty array = valid.
    #>
    param([hashtable]$Marker)

    $violations = @()

    # markerVersion
    if ($Marker.markerVersion -ne 1) {
        $violations += "markerVersion must be 1, got: $($Marker.markerVersion)"
    }

    # state
    if ($Marker.state -notin $script:SchemaValidStates) {
        $violations += "state must be one of [$($script:SchemaValidStates -join ', ')], got: '$($Marker.state)'"
    }

    # commitSha pattern
    if ($Marker.commitSha -notmatch '^[0-9a-fA-F]{7,40}$') {
        $violations += "commitSha must be 7-40 hex characters, got: '$($Marker.commitSha)'"
    }

    # capturedAt must be non-empty string
    if ([string]::IsNullOrEmpty($Marker.capturedAt)) {
        $violations += "capturedAt must be a non-empty ISO-8601 string"
    }

    # checks must be array of non-empty strings
    if ($Marker.checks -isnot [array]) {
        $violations += "checks must be an array"
    } else {
        foreach ($c in $Marker.checks) {
            if ([string]::IsNullOrEmpty($c)) {
                $violations += "checks entries must be non-empty strings"
                break
            }
        }
    }

    # failedChecks must be array of non-empty strings
    if ($Marker.failedChecks -isnot [array]) {
        $violations += "failedChecks must be an array"
    } else {
        foreach ($fc in $Marker.failedChecks) {
            if ([string]::IsNullOrEmpty($fc)) {
                $violations += "failedChecks entries must be non-empty strings"
                break
            }
        }
    }

    # allowedWorkerClasses must be array of valid enum values
    if ($Marker.allowedWorkerClasses -isnot [array]) {
        $violations += "allowedWorkerClasses must be an array"
    } else {
        foreach ($wc in $Marker.allowedWorkerClasses) {
            if ($wc -notin $script:SchemaValidWorkerClasses) {
                $violations += "allowedWorkerClasses entry '$wc' is not a valid worker class. Valid: [$($script:SchemaValidWorkerClasses -join ', ')]"
            }
        }
    }

    # reason (optional) must be non-empty string if present
    if ($Marker.Contains("reason") -and [string]::IsNullOrEmpty($Marker.reason)) {
        $violations += "reason, if present, must be a non-empty string"
    }

    return $violations
}

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
    $classesArray = @($AllowedWorkerClasses -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
}

# ---------------------------------------------------------------------------
# Parse check lists
# ---------------------------------------------------------------------------

$checksArray = @()
if ($Checks -ne "") {
    $checksArray = @($Checks -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
}

$failedArray = @()
if ($FailedChecks -ne "") {
    $failedArray = @($FailedChecks -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
}

# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------

Assert-ValidSha -Sha $CommitSha

if ($failedArray.Count -gt 0 -and $checksArray.Count -eq 0) {
    Write-Fail "FailedChecks provided but Checks is empty. Specify -Checks when using -FailedChecks."
    exit 1
}

if ($failedArray.Count -gt 0 -and $checksArray.Count -gt 0) {
    Assert-CheckConsistency -AllChecks $checksArray -Failed $failedArray
}

# Validate allowedWorkerClasses against schema enum
foreach ($wc in $classesArray) {
    if ($wc -notin $script:SchemaValidWorkerClasses) {
        Write-Fail "AllowedWorkerClasses entry '$wc' is not a valid worker class. Valid: [$($script:SchemaValidWorkerClasses -join ', ')]"
        exit 1
    }
}

# Warn if state is green but failedChecks are present (likely caller error)
if ($State -eq "green" -and $failedArray.Count -gt 0) {
    Write-Warn "State is 'green' but FailedChecks is non-empty. Verify this is intentional."
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
# Schema validation
# ---------------------------------------------------------------------------

Write-Step "Validating marker against health-state schema"
$schemaErrors = @(Test-MarkerAgainstSchema -Marker $marker)
if ($schemaErrors.Count -gt 0) {
    Write-Fail "Marker failed schema validation ($($schemaErrors.Count) error(s)):"
    foreach ($e in $schemaErrors) {
        Write-Fail "  - $e"
    }
    exit 1
}
Write-Ok "Marker passes schema validation"

if ($ValidateOnly) {
    Write-Ok "Validate-only mode. Marker is schema-compliant."
    exit 0
}

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
