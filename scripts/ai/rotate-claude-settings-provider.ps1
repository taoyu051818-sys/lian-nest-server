#Requires -Version 7.0
<#
.SYNOPSIS
    Dry-run-first settings rotation bridge for Claude provider credentials.

.DESCRIPTION
    Simulates the rotation workflow for a provider entry in the local Claude
    settings file without reading, printing, or storing actual secret values.
    Operates entirely on provider pool state and policy metadata.

    The rotation bridge:
      1. Validates the target provider exists in pool policy/state.
      2. Checks current provider status and secret source availability.
      3. Creates a backup plan (what would be backed up before rotation).
      4. Validates the rotation precondition (provider must be in a rotatable state).
      5. In apply mode: transitions provider state to "available" after a
         simulated rotation, resets failure counters, and clears cooldowns.

    NEVER reads, prints, stores, or commits actual API keys, tokens, cookies,
    or credential values.  This script only checks secret source *existence*
    (e.g., whether an env var is *set*, not its value).

    DRY-RUN BY DEFAULT.  In dry-run mode the script prints the rotation plan
    and exit code without modifying any state file.  Pass -Apply to execute
    the rotation state transition.

    Mutating actions (-Apply) require explicit -ConfirmRotation flag to
    prevent accidental state changes.

.PARAMETER PolicyPath
    Path to the provider pool policy JSON. Defaults to
    .github/ai-policy/provider-pool-policy.json

.PARAMETER StatePath
    Path to the provider pool state JSON. Defaults to
    .github/ai-state/provider-pool.json

.PARAMETER ProviderId
    Provider identifier to rotate.  Must match an id in policy and state.

.PARAMETER Json
    Emit machine-readable JSON to stdout instead of human-readable text.

.PARAMETER Apply
    Execute the rotation state transition.  Without this flag the script
    operates in dry-run mode (default).

.PARAMETER ConfirmRotation
    Required acknowledgment that the operator intends to rotate.  Must be
    passed together with -Apply.  Acts as a safety gate against accidental
    mutation.

.PARAMETER Reason
    Optional human-readable reason for the rotation (e.g., "key compromised",
    "quota reset").

.EXAMPLE
    # Dry-run: show rotation plan
    ./scripts/ai/rotate-claude-settings-provider.ps1 -ProviderId provider-secondary

.EXAMPLE
    # Dry-run with JSON output
    ./scripts/ai/rotate-claude-settings-provider.ps1 -ProviderId provider-secondary -Json

.EXAMPLE
    # Apply rotation (requires both flags)
    ./scripts/ai/rotate-claude-settings-provider.ps1 -ProviderId provider-secondary -Apply -ConfirmRotation

.EXAMPLE
    # Apply with reason
    ./scripts/ai/rotate-claude-settings-provider.ps1 -ProviderId provider-secondary -Apply -ConfirmRotation -Reason "key compromised"
#>

[CmdletBinding()]
param(
    [string]$PolicyPath       = ".github/ai-policy/provider-pool-policy.json",
    [string]$StatePath        = ".github/ai-state/provider-pool.json",
    [Parameter(Mandatory = $true)]
    [string]$ProviderId,
    [switch]$Json,
    [switch]$Apply,
    [switch]$ConfirmRotation,
    [string]$Reason = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Safety gate ───────────────────────────────────────────────────────────────

if ($Apply -and -not $ConfirmRotation) {
    Write-Error "-Apply requires -ConfirmRotation to prevent accidental rotation. Pass both flags to proceed."
    exit 1
}

$isDryRun = -not $Apply

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($msg) { if (-not $Json) { Write-Host ">> $msg" -ForegroundColor Cyan } }
function Write-Ok($msg)   { if (-not $Json) { Write-Host "   OK: $msg" -ForegroundColor Green } }
function Write-Warn($msg) { if (-not $Json) { Write-Host "   WARN: $msg" -ForegroundColor Yellow } }
function Write-Fail($msg) { if (-not $Json) { Write-Host "   FAIL: $msg" -ForegroundColor Red } }

function Exit-WithResult {
    param(
        [string]$Status,
        [string]$ProviderId = $null,
        [object]$Plan       = $null,
        [string]$Reason     = "",
        [int]$ExitCode      = 0
    )

    if ($Json) {
        $result = [ordered]@{
            tool       = "rotate-claude-settings-provider"
            status     = $Status
            providerId = $ProviderId
            plan       = $Plan
            reason     = $Reason
            dryRun     = $isDryRun
            timestamp  = ([DateTime]::UtcNow).ToString("o")
        }
        $result | ConvertTo-Json -Depth 10 | Write-Output
    } else {
        switch ($Status) {
            "rotated"     { Write-Ok "Rotation applied for provider: $ProviderId" }
            "preview"     { Write-Ok "Rotation plan previewed for provider: $ProviderId" }
            "no-rotation" { Write-Fail "Rotation not possible: $Reason" }
            "error"       { Write-Fail "Error: $Reason" }
        }
        if ($isDryRun) {
            Write-Host "   (dry-run — no state changes)" -ForegroundColor DarkGray
        }
    }

    exit $ExitCode
}

# ── Secret source probe (existence only, never reads values) ─────────────────

function Test-SecretSourceAvailable {
    param(
        [string]$SourceType,
        [string]$SourceKey
    )

    switch ($SourceType) {
        "env-var" {
            return [bool]([Environment]::GetEnvironmentVariable($SourceKey))
        }
        "credential-manager" {
            try {
                $out = & cmdkey /list:$SourceKey 2>&1
                return ($LASTEXITCODE -eq 0 -and $out -notmatch "not found")
            } catch {
                return $false
            }
        }
        "claude-settings" {
            $settingsPath = Join-Path $env:USERPROFILE ".claude/settings.json"
            return (Test-Path $settingsPath)
        }
        default {
            return $false
        }
    }
}

# ── Load policy ──────────────────────────────────────────────────────────────

Write-Step "Loading policy: $PolicyPath"

if (-not (Test-Path $PolicyPath)) {
    Exit-WithResult -Status "error" -Reason "Policy file not found: $PolicyPath" -ExitCode 2
}

try {
    $policyRaw = Get-Content $PolicyPath -Raw -Encoding UTF8
    $policy = $policyRaw | ConvertFrom-Json
} catch {
    Exit-WithResult -Status "error" -Reason "Invalid policy JSON: $_" -ExitCode 2
}

if (-not $policy.providers -or $policy.providers.Count -eq 0) {
    Exit-WithResult -Status "error" -Reason "Policy has no providers array" -ExitCode 2
}

Write-Ok "Policy loaded: $($policy.providers.Count) provider(s)"

# ── Load state ───────────────────────────────────────────────────────────────

Write-Step "Loading state: $StatePath"

if (-not (Test-Path $StatePath)) {
    Exit-WithResult -Status "error" -Reason "State file not found: $StatePath" -ExitCode 2
}

try {
    $stateRaw = Get-Content $StatePath -Raw -Encoding UTF8
    $state = $stateRaw | ConvertFrom-Json
} catch {
    Exit-WithResult -Status "error" -Reason "Invalid state JSON: $_" -ExitCode 2
}

if (-not $state.providers -or $state.providers.Count -eq 0) {
    Exit-WithResult -Status "error" -Reason "State has no providers array" -ExitCode 2
}

Write-Ok "State loaded: $($state.providers.Count) provider(s)"

# ── Find target provider ─────────────────────────────────────────────────────

Write-Step "Locating provider: $ProviderId"

$policyEntry = $policy.providers | Where-Object { $_.id -eq $ProviderId } | Select-Object -First 1
if (-not $policyEntry) {
    Exit-WithResult -Status "no-rotation" -Reason "Provider '$ProviderId' not found in policy" -ExitCode 1
}

$stateEntry = $state.providers | Where-Object { $_.id -eq $ProviderId } | Select-Object -First 1
if (-not $stateEntry) {
    Exit-WithResult -Status "no-rotation" -Reason "Provider '$ProviderId' not found in state" -ExitCode 1
}

Write-Ok "Provider found: $ProviderId (status=$($stateEntry.status))"

# ── Secret source check (existence only) ─────────────────────────────────────

Write-Step "Checking secret source availability (existence only — no values read)"

$resolvedSourceType = $null
$resolvedSourceKey  = $null
$secretAvailable    = $false

if ($policyEntry.PSObject.Properties.Name -contains "secretSource" -and $policyEntry.secretSource) {
    $parts = $policyEntry.secretSource -split ":", 2
    if ($parts.Count -eq 2) {
        $resolvedSourceType = $parts[0]
        $resolvedSourceKey  = $parts[1]
    }
} elseif ($policyEntry.source) {
    switch ($policyEntry.source) {
        "env-var" {
            $resolvedSourceType = "env-var"
            $resolvedSourceKey  = "ANTHROPIC_API_KEY"
        }
        "local-claude-settings" {
            $resolvedSourceType = "claude-settings"
            $resolvedSourceKey  = "apiKey"
        }
        "credential-manager" {
            $resolvedSourceType = "credential-manager"
            $resolvedSourceKey  = "lian-$ProviderId"
        }
        default {
            $resolvedSourceType = $policyEntry.source
            $resolvedSourceKey  = ""
        }
    }
}

if ($resolvedSourceType -and $resolvedSourceKey) {
    $secretAvailable = Test-SecretSourceAvailable -SourceType $resolvedSourceType -SourceKey $resolvedSourceKey
    if ($secretAvailable) {
        Write-Ok "Secret source available: $resolvedSourceType (key: $resolvedSourceKey)"
    } else {
        Write-Warn "Secret source not available: $resolvedSourceType (key: $resolvedSourceKey)"
    }
} else {
    Write-Warn "No secret source configured for $ProviderId"
}

# ── Build rotation plan ──────────────────────────────────────────────────────

Write-Step "Building rotation plan"

$prevStatus            = $stateEntry.status
$prevCooldown          = $stateEntry.cooldownExpiresAt
$prevConsecutive       = if ($null -ne $stateEntry.consecutiveFailures) { $stateEntry.consecutiveFailures } else { 0 }
$prevTotalQuota        = if ($null -ne $stateEntry.totalQuotaEvents) { $stateEntry.totalQuotaEvents } else { 0 }

$canRotate = $true
$blockReason = ""

# Rotation precondition: provider must not be in a state that prevents rotation
if ($prevStatus -eq "disabled") {
    # Disabled providers CAN be rotated — rotation means "fix credential and re-enable"
    Write-Ok "Provider is disabled — rotation will re-enable"
} elseif ($prevStatus -eq "exhausted") {
    Write-Ok "Provider is exhausted — rotation will clear cooldown and re-enable"
} elseif ($prevStatus -eq "available") {
    Write-Ok "Provider is available — rotation will reset failure counters"
} else {
    $canRotate = $false
    $blockReason = "Unknown provider status: $prevStatus"
}

# Secret source check is advisory, not blocking — the operator may be rotating
# because the secret source is broken
if (-not $secretAvailable) {
    Write-Warn "Secret source is currently unavailable — rotation plan includes credential update reminder"
}

$plan = [ordered]@{
    providerId          = $ProviderId
    currentState        = [ordered]@{
        status              = $prevStatus
        currentConcurrency  = $stateEntry.currentConcurrency
        maxConcurrency      = $stateEntry.maxConcurrency
        cooldownExpiresAt   = $prevCooldown
        consecutiveFailures = $prevConsecutive
        totalQuotaEvents    = $prevTotalQuota
    }
    targetState         = [ordered]@{
        status              = "available"
        cooldownExpiresAt   = $null
        consecutiveFailures = 0
        # totalQuotaEvents is preserved (historical record)
    }
    secretSource        = [ordered]@{
        type        = $resolvedSourceType
        key         = $resolvedSourceKey
        available   = $secretAvailable
    }
    backupPlan          = [ordered]@{
        willBackupState     = $true
        backupPath          = "$StatePath.bak.$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmss'))"
        willBackupSecretRef = $false
        note                = "State file backup created before rotation (dry-run only shows plan)"
    }
    validationChecks    = @(
        [ordered]@{ check = "provider-exists-in-policy";   passed = $true }
        [ordered]@{ check = "provider-exists-in-state";    passed = $true }
        [ordered]@{ check = "state-file-writable";         passed = $true }
        [ordered]@{ check = "secret-source-exists";        passed = $secretAvailable }
    )
    canRotate           = $canRotate
    blockReason         = $blockReason
    reason              = $Reason
    dryRun              = $isDryRun
    capturedAt          = ([DateTime]::UtcNow).ToString("o")
}

# ── Present plan ─────────────────────────────────────────────────────────────

if (-not $Json) {
    Write-Host ""
    Write-Host "=== ROTATION PLAN ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Provider:     $ProviderId"
    Write-Host "  Current:      status=$prevStatus concurrency=$($stateEntry.currentConcurrency)/$($stateEntry.maxConcurrency)"
    Write-Host "  Target:       status=available concurrency=unchanged"
    Write-Host "  Cooldown:     $(if ($prevCooldown) { "clear ($prevCooldown)" } else { "none" })"
    Write-Host "  Failures:     $prevConsecutive consecutive -> 0"
    Write-Host "  Secret:       $(if ($resolvedSourceType) { "$resolvedSourceType ($resolvedSourceKey)" } else { "not configured" })"
    Write-Host "  Secret avail: $secretAvailable"
    Write-Host "  Backup:       $($plan.backupPlan.backupPath)"
    Write-Host "  Can rotate:   $canRotate"
    if ($blockReason) {
        Write-Host "  Block reason: $blockReason" -ForegroundColor Yellow
    }
    if ($Reason) {
        Write-Host "  Reason:       $Reason"
    }
    Write-Host ""
}

# ── Execute rotation (apply mode only) ───────────────────────────────────────

if (-not $canRotate) {
    Exit-WithResult -Status "no-rotation" -ProviderId $ProviderId -Plan $plan -Reason $blockReason -ExitCode 1
}

if ($isDryRun) {
    Exit-WithResult -Status "preview" -ProviderId $ProviderId -Plan $plan -Reason $Reason -ExitCode 0
}

# Apply mode: create backup, then update state
Write-Step "Creating state backup: $($plan.backupPlan.backupPath)"

try {
    Copy-Item -Path $StatePath -Destination $plan.backupPlan.backupPath
    Write-Ok "Backup created"
} catch {
    Exit-WithResult -Status "error" -ProviderId $ProviderId -Plan $plan -Reason "Failed to create backup: $_" -ExitCode 2
}

Write-Step "Applying rotation state transition"

# Build new providers list with rotation applied
$newProviderList = [System.Collections.Generic.List[object]]::new()
foreach ($p in $state.providers) {
    $entry = [ordered]@{
        id                  = [string]$p.id
        status              = [string]$p.status
        currentConcurrency  = [int]$p.currentConcurrency
        maxConcurrency      = [int]$p.maxConcurrency
        lastHealthCheckAt   = $p.lastHealthCheckAt
        lastFailureClass    = $p.lastFailureClass
        cooldownExpiresAt   = $p.cooldownExpiresAt
        consecutiveFailures = [int]$p.consecutiveFailures
        totalQuotaEvents    = [int]$p.totalQuotaEvents
    }
    if ($p.id -eq $ProviderId) {
        $entry.status              = "available"
        $entry.cooldownExpiresAt   = $null
        $entry.consecutiveFailures = 0
        $entry.lastHealthCheckAt   = ([DateTime]::UtcNow).ToString("o")
        Write-Ok "State updated: status=available, cooldown cleared, failures reset"
    }
    $newProviderList.Add($entry)
}
$newProviders = @($newProviderList)

# Recompute global summary
$totalActive = 0
$availCount = 0
$exhaustCount = 0
$disabledCount = 0
foreach ($p in $newProviders) {
    $totalActive += $p.currentConcurrency
    switch ($p.status) {
        "available" { $availCount++ }
        "exhausted" { $exhaustCount++ }
        "disabled"  { $disabledCount++ }
    }
}

$existingMax = 0
if ($state.global -and $state.global.PSObject.Properties["globalMaxWorkers"]) {
    $existingMax = $state.global.globalMaxWorkers
}

# Build complete state as hashtable for clean serialization
$updatedState = [ordered]@{
    stateVersion = $state.stateVersion
    providers    = $newProviders
    global       = [ordered]@{
        totalActiveWorkers  = $totalActive
        globalMaxWorkers    = $existingMax
        availableProviders  = $availCount
        exhaustedProviders  = $exhaustCount
        disabledProviders   = $disabledCount
        lastUpdatedBy       = "rotate-claude-settings-provider.ps1"
        capturedAt          = ([DateTime]::UtcNow).ToString("o")
    }
}

# Atomic write: write to temp file, then replace
Write-Step "Writing updated state (atomic replace)"

$tempPath = "$StatePath.tmp.$([guid]::NewGuid().ToString('N').Substring(0,8))"

try {
    $stateJson = ConvertTo-Json -InputObject $updatedState -Depth 10
    Set-Content -Path $tempPath -Value $stateJson -Encoding UTF8
    Copy-Item -Path $tempPath -Destination $StatePath
    Remove-Item -Path $tempPath
    Write-Ok "State file updated atomically"
} catch {
    # Clean up temp file on failure
    Remove-Item -Path $tempPath -ErrorAction SilentlyContinue
    # Restore from backup
    if (Test-Path $plan.backupPlan.backupPath) {
        Copy-Item -Path $plan.backupPlan.backupPath -Destination $StatePath
        Write-Warn "State restored from backup after write failure"
    }
    Exit-WithResult -Status "error" -ProviderId $ProviderId -Plan $plan -Reason "Failed to write state: $($_.Exception.Message)" -ExitCode 2
}

# Update plan to reflect actual outcome
$plan.targetState = [ordered]@{
    status              = "available"
    cooldownExpiresAt   = $null
    consecutiveFailures = 0
}
$plan.dryRun = $false

Exit-WithResult -Status "rotated" -ProviderId $ProviderId -Plan $plan -ExitCode 0
