<#
.SYNOPSIS
    Updates a single provider's state in the provider-pool.json ai-state file.

.DESCRIPTION
    Mutates provider-pool.json to transition a provider alias between
    available/exhausted/disabled states, adjust concurrency counters,
    and manage cooldown/failure tracking.  Downstream consumers (launch
    gate, reconciler, scheduler) read this file to make scheduling
    decisions.

    Operations:
        SetStatus              - Transition provider to a new status.
                                 When status=exhausted, sets cooldown and
                                 increments consecutiveFailures and
                                 totalQuotaEvents.
                                 When status=available, clears cooldown
                                 and resets consecutiveFailures.
                                 When status=disabled, clears cooldown.
        IncrementConcurrency   - Increment currentConcurrency by 1.
        DecrementConcurrency   - Decrement currentConcurrency by 1 (min 0).
        ResetFailures          - Reset consecutiveFailures to 0.

    Dry-run by default.  Pass -DryRun to explicitly confirm preview mode.
    Pass -Apply to write the updated state back to disk.

    The emitted state is validated against schemas/provider-pool.schema.json
    before writing.  Use -ValidateOnly to check without emitting.

.PARAMETER StateFile
    Path to the provider-pool.json file.
    Defaults to ./.github/ai-state/provider-pool.json

.PARAMETER ProviderId
    Provider identifier to update.  Must match an id in the file.

.PARAMETER Operation
    Operation to perform: SetStatus, IncrementConcurrency,
    DecrementConcurrency, ResetFailures.

.PARAMETER Status
    New status when Operation=SetStatus.  One of: available, exhausted,
    disabled.

.PARAMETER CooldownSeconds
    Cooldown duration in seconds when setting status=exhausted.
    Defaults to 300 (5 minutes).

.PARAMETER Reason
    Optional human-readable reason for the update.

.PARAMETER Apply
    Write the updated state back to disk.  Without this flag, the script
    runs in dry-run mode and only previews the change.

.PARAMETER DryRun
    Explicitly confirm dry-run mode.  Conflicts with -Apply.

.PARAMETER ValidateOnly
    Validate the resulting state against the schema without writing.
    Exits 0 on success, 1 on validation failure.

.EXAMPLE
    # Preview marking a provider as exhausted
    ./scripts/ai/update-provider-pool-state.ps1 -ProviderId "provider-a" -Operation SetStatus -Status exhausted

.EXAMPLE
    # Apply the exhaustion with a 10-minute cooldown
    ./scripts/ai/update-provider-pool-state.ps1 -ProviderId "provider-a" -Operation SetStatus -Status exhausted -CooldownSeconds 600 -Apply

.EXAMPLE
    # Increment concurrency (e.g. worker assigned)
    ./scripts/ai/update-provider-pool-state.ps1 -ProviderId "provider-a" -Operation IncrementConcurrency -Apply

.EXAMPLE
    # Reset failure counters
    ./scripts/ai/update-provider-pool-state.ps1 -ProviderId "provider-a" -Operation ResetFailures -Apply
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$StateFile = "./.github/ai-state/provider-pool.json",

    [Parameter(Mandatory = $true)]
    [string]$ProviderId,

    [Parameter(Mandatory = $true)]
    [ValidateSet("SetStatus", "IncrementConcurrency", "DecrementConcurrency", "ResetFailures")]
    [string]$Operation,

    [Parameter(Mandatory = $false)]
    [ValidateSet("available", "exhausted", "disabled")]
    [string]$Status,

    [Parameter(Mandatory = $false)]
    [int]$CooldownSeconds = 300,

    [Parameter(Mandatory = $false)]
    [string]$Reason = "",

    [Parameter(Mandatory = $false)]
    [switch]$Apply,

    [Parameter(Mandatory = $false)]
    [switch]$DryRun,

    [Parameter(Mandatory = $false)]
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Mutual exclusion
# ---------------------------------------------------------------------------

if ($DryRun -and $Apply) {
    Write-Error "-DryRun and -Apply cannot be used together."
    exit 1
}

# Default to dry-run unless -Apply is passed
$isDryRun = -not $Apply

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step { param([string]$Msg) Write-Host "[step] $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[ok]   $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[warn] $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "[fail] $Msg" -ForegroundColor Red }

function Get-Prop {
    param($Obj, [string]$Name)
    if ($null -eq $Obj) { return $null }
    if ($Obj.PSObject.Properties[$Name]) { return $Obj.PSObject.Properties[$Name].Value }
    return $null
}

function Build-GlobalSummary {
    param([array]$Providers)

    $totalActive = 0
    $availCount = 0
    $exhaustCount = 0
    $disabledCount = 0

    foreach ($p in $Providers) {
        $totalActive += $p.currentConcurrency
        switch ($p.status) {
            "available" { $availCount++ }
            "exhausted" { $exhaustCount++ }
            "disabled"  { $disabledCount++ }
        }
    }

    return @{
        totalActiveWorkers  = $totalActive
        globalMaxWorkers    = 0   # preserved from existing global if present
        availableProviders  = $availCount
        exhaustedProviders  = $exhaustCount
        disabledProviders   = $disabledCount
        lastUpdatedBy       = "update-provider-pool-state.ps1"
        capturedAt          = ([DateTime]::UtcNow.ToString("o"))
    }
}

# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------

$script:ValidStatuses = @("available", "exhausted", "disabled")

function Test-StateAgainstSchema {
    param($State)

    $violations = @()

    # stateVersion
    if ($State.stateVersion -ne 1) {
        $violations += "stateVersion must be 1, got: $($State.stateVersion)"
    }

    # providers must be array
    if ($State.providers -isnot [array]) {
        $violations += "providers must be an array"
    } else {
        foreach ($p in $State.providers) {
            if ([string]::IsNullOrEmpty($p.id)) {
                $violations += "provider entry missing 'id'"
            }
            if ($p.status -notin $script:ValidStatuses) {
                $violations += "provider '$($p.id)' status must be one of [$($script:ValidStatuses -join ', ')], got: '$($p.status)'"
            }
            if ($p.currentConcurrency -lt 0) {
                $violations += "provider '$($p.id)' currentConcurrency must be >= 0"
            }
            if ($p.maxConcurrency -lt 0) {
                $violations += "provider '$($p.id)' maxConcurrency must be >= 0"
            }
        }
    }

    # global must be present
    if ($null -eq $State.global) {
        $violations += "global summary is required"
    } else {
        $g = $State.global
        if ($g.totalActiveWorkers -lt 0) { $violations += "global.totalActiveWorkers must be >= 0" }
        if ($g.globalMaxWorkers -lt 0) { $violations += "global.globalMaxWorkers must be >= 0" }
        if ($g.availableProviders -lt 0) { $violations += "global.availableProviders must be >= 0" }
        if ($g.exhaustedProviders -lt 0) { $violations += "global.exhaustedProviders must be >= 0" }
        if ($g.disabledProviders -lt 0) { $violations += "global.disabledProviders must be >= 0" }
    }

    return $violations
}

# ---------------------------------------------------------------------------
# Load existing state or create minimal
# ---------------------------------------------------------------------------

$state = $null
$stateExists = Test-Path $StateFile

if ($stateExists) {
    Write-Step "Loading provider pool state from: $StateFile"
    $raw = Get-Content $StateFile -Raw -Encoding UTF8
    try {
        $state = $raw | ConvertFrom-Json
    } catch {
        Write-Fail "Failed to parse provider pool JSON: $($_.Exception.Message)"
        exit 1
    }
} else {
    Write-Warn "State file not found: $StateFile -- creating minimal state"
    $state = @{
        stateVersion = 1
        providers    = @()
        global       = @{
            totalActiveWorkers  = 0
            globalMaxWorkers    = 0
            availableProviders  = 0
            exhaustedProviders  = 0
            disabledProviders   = 0
            lastUpdatedBy       = "update-provider-pool-state.ps1"
            capturedAt          = ([DateTime]::UtcNow.ToString("o"))
        }
    }
}

# ---------------------------------------------------------------------------
# Find target provider
# ---------------------------------------------------------------------------

$providerList = @()
$providersRaw = Get-Prop $state "providers"
if ($null -ne $providersRaw) {
    $providerList = @($providersRaw)
}

$targetIndex = -1
for ($i = 0; $i -lt $providerList.Count; $i++) {
    if ($providerList[$i].id -eq $ProviderId) {
        $targetIndex = $i
        break
    }
}

if ($targetIndex -lt 0) {
    Write-Fail "Provider '$ProviderId' not found in state file. Existing providers: $(@($providerList | ForEach-Object { $_.id }) -join ', ')"
    exit 1
}

$target = $providerList[$targetIndex]
$prevStatus = $target.status

# ---------------------------------------------------------------------------
# Validate operation preconditions
# ---------------------------------------------------------------------------

if ($Operation -eq "SetStatus" -and [string]::IsNullOrEmpty($Status)) {
    Write-Fail "-Status is required when -Operation is SetStatus"
    exit 1
}

if ($Operation -eq "IncrementConcurrency" -and $target.currentConcurrency -ge $target.maxConcurrency) {
    Write-Warn "Provider '$ProviderId' is already at max concurrency ($($target.currentConcurrency)/$($target.maxConcurrency)). Incrementing anyway."
}

# ---------------------------------------------------------------------------
# Apply operation
# ---------------------------------------------------------------------------

$now = [DateTime]::UtcNow
$changeDetail = ""

switch ($Operation) {
    "SetStatus" {
        $target.status = $Status

        if ($Status -eq "exhausted") {
            $cooldownEnd = $now.AddSeconds($CooldownSeconds)
            $target.cooldownExpiresAt = $cooldownEnd.ToString("o")
            $target.lastFailureClass = "exhaustion"
            $target.consecutiveFailures = [int]$target.consecutiveFailures + 1
            $target.totalQuotaEvents = [int]$target.totalQuotaEvents + 1
            $changeDetail = "status: $prevStatus -> exhausted (cooldown ${CooldownSeconds}s, failures=$($target.consecutiveFailures))"
        }
        elseif ($Status -eq "available") {
            $target.cooldownExpiresAt = $null
            $target.consecutiveFailures = 0
            $changeDetail = "status: $prevStatus -> available (cooldown cleared, failures reset)"
        }
        elseif ($Status -eq "disabled") {
            $target.cooldownExpiresAt = $null
            $changeDetail = "status: $prevStatus -> disabled"
        }

        $target.lastHealthCheckAt = $now.ToString("o")
    }

    "IncrementConcurrency" {
        $target.currentConcurrency = [int]$target.currentConcurrency + 1
        $changeDetail = "concurrency: $([int]$target.currentConcurrency - 1) -> $($target.currentConcurrency)"
    }

    "DecrementConcurrency" {
        $newVal = [Math]::Max(0, [int]$target.currentConcurrency - 1)
        $target.currentConcurrency = $newVal
        $changeDetail = "concurrency: $([int]$target.currentConcurrency + 1) -> $($target.currentConcurrency)"
    }

    "ResetFailures" {
        $target.consecutiveFailures = 0
        $changeDetail = "consecutiveFailures reset to 0"
    }
}

# ---------------------------------------------------------------------------
# Recompute global summary
# ---------------------------------------------------------------------------

$newGlobal = Build-GlobalSummary -Providers $providerList

# Preserve globalMaxWorkers from existing global if present
$existingGlobal = Get-Prop $state "global"
if ($null -ne $existingGlobal) {
    $existingMax = Get-Prop $existingGlobal "globalMaxWorkers"
    if ($null -ne $existingMax -and $existingMax -gt 0) {
        $newGlobal.globalMaxWorkers = $existingMax
    }
}

$state.global = $newGlobal

# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------

Write-Step "Validating updated state against provider-pool schema"
$schemaErrors = @(Test-StateAgainstSchema -State $state)
if ($schemaErrors.Count -gt 0) {
    Write-Fail "Updated state failed schema validation ($($schemaErrors.Count) error(s)):"
    foreach ($e in $schemaErrors) {
        Write-Fail "  - $e"
    }
    exit 1
}
Write-Ok "Updated state passes schema validation"

if ($ValidateOnly) {
    Write-Ok "Validate-only mode. State is schema-compliant."
    exit 0
}

# ---------------------------------------------------------------------------
# Preview / output
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "=== PROVIDER POOL STATE UPDATE ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Provider:  $ProviderId"
Write-Host "  Operation: $Operation"
Write-Host "  Change:    $changeDetail"
if ($Reason) {
    Write-Host "  Reason:    $Reason"
}
Write-Host ""

$json = $state | ConvertTo-Json -Depth 10
Write-Host $json
Write-Host ""

# ---------------------------------------------------------------------------
# Summary line
# ---------------------------------------------------------------------------

$g = $state.global
Write-Host "  Summary: $($providerList.Count) provider(s) | available=$($g.availableProviders) exhausted=$($g.exhaustedProviders) disabled=$($g.disabledProviders) activeWorkers=$($g.totalActiveWorkers)"

# ---------------------------------------------------------------------------
# Write or dry-run
# ---------------------------------------------------------------------------

if ($isDryRun) {
    Write-Host ""
    Write-Warn "Dry-run mode. No files were written."
    Write-Host "Would write to: $StateFile"
    exit 0
}

# Write state file
$dir = Split-Path -Parent $StateFile
if ($dir -and -not (Test-Path $dir)) {
    Write-Step "Creating directory: $dir"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

Set-Content -Path $StateFile -Value $json -Encoding UTF8
Write-Ok "Provider pool state written to: $StateFile"
Write-Host "  provider=$ProviderId op=$Operation $changeDetail"
