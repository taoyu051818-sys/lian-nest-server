#Requires -Version 7.0
<#
.SYNOPSIS
    Local provider key router — selects a provider alias from pool state
    without reading or printing raw API keys.

.DESCRIPTION
    Reads provider pool policy, state, and optional secret-ref files to pick
    the best available provider for the next worker dispatch. Uses a
    least-loaded selection strategy across providers that are (a) available,
    (b) under their concurrency cap, and (c) have a resolvable local secret
    source.

    NEVER reads, prints, stores, or commits actual API keys, tokens, or
    credentials. This script only resolves source *existence* — e.g. it
    checks whether an environment variable is *set*, not its value.

    DRY-RUN BY DEFAULT. In dry-run mode the script prints the selection
    decision and exit code without modifying any state file. Pass -Commit
    to bump concurrency in the state file after a successful selection.

.PARAMETER PolicyPath
    Path to the provider pool policy JSON. Defaults to
    .github/ai-policy/provider-pool-policy.json

.PARAMETER StatePath
    Path to the provider pool state JSON. Defaults to
    .github/ai-state/provider-pool.json

.PARAMETER SecretRefPath
    Optional path to a JSON array of ProviderSecretRef objects. When
    provided, the router validates that each candidate provider has a
    resolvable local secret source before selecting it.

.PARAMETER Json
    Emit machine-readable JSON to stdout instead of human-readable text.

.PARAMETER Commit
    Actually bump the selected provider's currentConcurrency in the state
    file. Without this flag the script operates in dry-run mode (default).

.EXAMPLE
    # Dry-run: show which provider would be selected
    ./scripts/ai/provider-key-router.ps1

.EXAMPLE
    # Dry-run with JSON output
    ./scripts/ai/provider-key-router.ps1 -Json

.EXAMPLE
    # Commit mode: bump concurrency in state file
    ./scripts/ai/provider-key-router.ps1 -Commit

.EXAMPLE
    # Custom policy and state paths
    ./scripts/ai/provider-key-router.ps1 -PolicyPath ./my-policy.json -StatePath ./my-state.json
#>

[CmdletBinding()]
param(
    [string]$PolicyPath  = ".github/ai-policy/provider-pool-policy.json",
    [string]$StatePath   = ".github/ai-state/provider-pool.json",
    [string]$SecretRefPath = "",
    [switch]$Json,
    [switch]$Commit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($msg) { if (-not $Json) { Write-Host ">> $msg" -ForegroundColor Cyan } }
function Write-Ok($msg)   { if (-not $Json) { Write-Host "   OK: $msg" -ForegroundColor Green } }
function Write-Warn($msg) { if (-not $Json) { Write-Host "   WARN: $msg" -ForegroundColor Yellow } }
function Write-Fail($msg) { if (-not $Json) { Write-Host "   FAIL: $msg" -ForegroundColor Red } }

function Exit-WithResult {
    param(
        [string]$Status,
        [string]$ProviderId = $null,
        [string]$Reason     = "",
        [int]$ExitCode      = 0
    )

    if ($Json) {
        $result = [ordered]@{
            tool       = "provider-key-router"
            status     = $Status
            providerId = $ProviderId
            reason     = $Reason
            dryRun     = (-not $Commit)
            timestamp  = ([DateTime]::UtcNow).ToString("o")
        }
        $result | ConvertTo-Json -Depth 5 | Write-Output
    } else {
        switch ($Status) {
            "selected"   { Write-Ok "Selected provider: $ProviderId" }
            "no-provider" { Write-Fail "No provider available: $Reason" }
            "error"      { Write-Fail "Error: $Reason" }
        }
        if (-not $Commit) {
            Write-Host "   (dry-run — no state changes)" -ForegroundColor DarkGray
        }
    }

    exit $ExitCode
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

# ── Load secret refs (optional) ─────────────────────────────────────────────

$secretRefs = $null

if ($SecretRefPath -and (Test-Path $SecretRefPath)) {
    Write-Step "Loading secret refs: $SecretRefPath"
    try {
        $refsRaw = Get-Content $SecretRefPath -Raw -Encoding UTF8
        $secretRefs = $refsRaw | ConvertFrom-Json
        Write-Ok "Secret refs loaded: $($secretRefs.Count) ref(s)"
    } catch {
        Write-Warn "Could not parse secret refs — proceeding without ref validation"
    }
}

# ── Secret source probe (existence only, never reads values) ────────────────

function Test-SecretSourceAvailable {
    param(
        [string]$SourceType,
        [string]$SourceKey
    )

    switch ($SourceType) {
        "env-var" {
            # Check existence only — never read the value
            return [bool]([Environment]::GetEnvironmentVariable($SourceKey))
        }
        "credential-manager" {
            # Check if a credential manager entry exists (Windows)
            try {
                $out = & cmdkey /list:$SourceKey 2>&1
                return ($LASTEXITCODE -eq 0 -and $out -notmatch "not found")
            } catch {
                return $false
            }
        }
        "claude-settings" {
            # Check if the settings file exists (we do NOT read its contents)
            $settingsPath = Join-Path $env:USERPROFILE ".claude/settings.json"
            return (Test-Path $settingsPath)
        }
        default {
            return $false
        }
    }
}

# ── Build candidate list ────────────────────────────────────────────────────

Write-Step "Building candidate list"

# Strategy: read from policy (defines allowed providers and limits)
# then cross-reference with state (current load and status)
$selectionStrategy = "least-loaded"
if ($policy.concurrency -and $policy.concurrency.providerSelectionStrategy) {
    $selectionStrategy = $policy.concurrency.providerSelectionStrategy
}

$candidates = @()

foreach ($policyEntry in $policy.providers) {
    $providerId = $policyEntry.id

    # Find matching state entry
    $stateEntry = $state.providers | Where-Object { $_.id -eq $providerId } | Select-Object -First 1
    if (-not $stateEntry) {
        Write-Warn "  $providerId — in policy but not in state, skipping"
        continue
    }

    # Check status
    if ($stateEntry.status -ne "available") {
        Write-Warn "  $providerId — status=$($stateEntry.status), skipping"
        continue
    }

    # Check concurrency cap
    $isAtCapacity = ($stateEntry.currentConcurrency -ge $stateEntry.maxConcurrency)
    if ($isAtCapacity) {
        Write-Warn "  $providerId — at capacity ($($stateEntry.currentConcurrency)/$($stateEntry.maxConcurrency)), skipping"
        continue
    }

    # Check secret source availability (when refs are provided)
    $secretAvailable = $true
    $resolvedSourceType = $null
    $resolvedSourceKey  = $null

    if ($secretRefs) {
        $ref = $secretRefs | Where-Object { $_.providerId -eq $providerId -and $_.isActive -ne $false } | Select-Object -First 1
        if ($ref) {
            $resolvedSourceType = $ref.sourceType
            $resolvedSourceKey  = $ref.sourceKey
            $secretAvailable = Test-SecretSourceAvailable -SourceType $ref.sourceType -SourceKey $ref.sourceKey
            if (-not $secretAvailable) {
                Write-Warn "  $providerId — secret source not available ($($ref.sourceType): $($ref.sourceKey)), skipping"
                continue
            }
        } else {
            Write-Warn "  $providerId — no active secret ref found, skipping"
            continue
        }
    } elseif ($policyEntry.PSObject.Properties.Name -contains "secretSource" -and $policyEntry.secretSource) {
        # Fall back to policy secretSource field if no ref file
        $parts = $policyEntry.secretSource -split ":", 2
        if ($parts.Count -eq 2) {
            $resolvedSourceType = $parts[0]
            $resolvedSourceKey  = $parts[1]
            $secretAvailable = Test-SecretSourceAvailable -SourceType $resolvedSourceType -SourceKey $resolvedSourceKey
            if (-not $secretAvailable) {
                Write-Warn "  $providerId — secret source not available ($($policyEntry.secretSource)), skipping"
                continue
            }
        }
    } elseif ($policyEntry.source) {
        # Map policy source field to a source type for probing
        $policySource = $policyEntry.source
        switch ($policySource) {
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
                $resolvedSourceKey  = "lian-$providerId"
            }
            default {
                # Unknown source type — assume available (fail-open for unknown)
                $resolvedSourceType = $policySource
                $resolvedSourceKey  = ""
            }
        }
        if ($resolvedSourceType -and $resolvedSourceKey) {
            $secretAvailable = Test-SecretSourceAvailable -SourceType $resolvedSourceType -SourceKey $resolvedSourceKey
            if (-not $secretAvailable) {
                Write-Warn "  $providerId — secret source not available ($policySource), skipping"
                continue
            }
        }
    }

    $candidates += [ordered]@{
        providerId         = $providerId
        currentConcurrency = $stateEntry.currentConcurrency
        maxConcurrency     = $stateEntry.maxConcurrency
        headroom           = ($stateEntry.maxConcurrency - $stateEntry.currentConcurrency)
        secretSourceType   = $resolvedSourceType
        secretSourceKey    = $resolvedSourceKey
    }
}

Write-Step "$($candidates.Count) candidate(s) passed filters"

if ($candidates.Count -eq 0) {
    Exit-WithResult -Status "no-provider" `
                    -Reason "No available provider with capacity and resolvable secret source" `
                    -ExitCode 1
}

# ── Select provider ──────────────────────────────────────────────────────────

Write-Step "Selecting provider (strategy: $selectionStrategy)"

$selected = $null

switch ($selectionStrategy) {
    "least-loaded" {
        # Pick the provider with the most headroom (maxConcurrency - currentConcurrency)
        $selected = $candidates | Sort-Object -Property headroom -Descending | Select-Object -First 1
    }
    "round-robin" {
        # Simple round-robin: pick the first available candidate
        # (state updater would rotate the order across runs)
        $selected = $candidates | Select-Object -First 1
    }
    default {
        # Fallback to least-loaded
        $selected = $candidates | Sort-Object -Property headroom -Descending | Select-Object -First 1
    }
}

if (-not $selected) {
    Exit-WithResult -Status "no-provider" -Reason "Selection strategy returned no candidate" -ExitCode 1
}

Write-Ok "Selected: $($selected.providerId) (load: $($selected.currentConcurrency)/$($selected.maxConcurrency))"

# ── Commit: bump concurrency in state file ───────────────────────────────────

if ($Commit) {
    Write-Step "Committing concurrency bump for $($selected.providerId)"

    foreach ($p in $state.providers) {
        if ($p.id -eq $selected.providerId) {
            $p.currentConcurrency = $p.currentConcurrency + 1
            Write-Ok "Bumped $($p.id) concurrency to $($p.currentConcurrency)"
            break
        }
    }

    try {
        $state | ConvertTo-Json -Depth 10 | Set-Content $StatePath -Encoding UTF8
        Write-Ok "State file updated: $StatePath"
    } catch {
        Exit-WithResult -Status "error" -Reason "Failed to write state file: $_" -ExitCode 2
    }
}

# ── Output ───────────────────────────────────────────────────────────────────

Exit-WithResult -Status "selected" -ProviderId $selected.providerId -ExitCode 0
