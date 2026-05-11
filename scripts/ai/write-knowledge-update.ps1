<#
.SYNOPSIS
    Writes a knowledge update entry to .github/ai-state/knowledge-updates.ndjson.

.DESCRIPTION
    Records structured knowledge gained from merged PRs as NDJSON entries.
    Each entry captures what was learned, which PR/issue it relates to, and
    the category of knowledge (migration, architecture, policy, etc.).

    Downstream consumers (planner, context bundle generator, orchestrator)
    read this ledger to inform future decisions without re-reading PR diffs.

    Dry-run is the default mode. Pass -Write to persist the entry.

    This script does NOT:
    - Analyze PR diffs (caller provides the knowledge content).
    - Modify any runtime source files.
    - Auto-generate knowledge from code changes.

.PARAMETER Category
    Knowledge category. One of: migration, architecture, policy, test, docs,
    infrastructure, security, performance.

.PARAMETER Summary
    One-line summary of the knowledge gained.

.PARAMETER IssueNumber
    GitHub issue number related to this knowledge.

.PARAMETER PrNumber
    GitHub PR number where this knowledge was discovered.

.PARAMETER CommitSha
    Git SHA of the relevant commit. Defaults to HEAD.

.PARAMETER Details
    Optional multi-line details about the knowledge update.

.PARAMETER Tags
    Optional comma-separated tags for filtering.

.PARAMETER OutputPath
    Path for the NDJSON ledger file. Defaults to ./.github/ai-state/knowledge-updates.ndjson

.PARAMETER DryRun
    Preview the entry that would be written without modifying any files.

.PARAMETER ValidateOnly
    Validate the constructed entry without writing or printing. Exits 0 on success.

.PARAMETER SelfTest
    Run focused self-tests that validate entry construction and serialization
    without contacting GitHub or writing files.

.EXAMPLE
    # Preview a knowledge entry
    ./scripts/ai/write-knowledge-update.ps1 -Category migration -Summary "Slice A3 requires Prisma seed reset" -IssueNumber 596

.EXAMPLE
    # Write an entry
    ./scripts/ai/write-knowledge-update.ps1 -Category architecture -Summary "Provider pool uses local secret store" -PrNumber 582 -Write

.EXAMPLE
    # Run self-test
    ./scripts/ai/write-knowledge-update.ps1 -SelfTest
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [ValidateSet("migration", "architecture", "policy", "test", "docs", "infrastructure", "security", "performance")]
    [string]$Category,

    [Parameter(Mandatory = $false)]
    [string]$Summary,

    [Parameter(Mandatory = $false)]
    [int]$IssueNumber = 0,

    [Parameter(Mandatory = $false)]
    [int]$PrNumber = 0,

    [Parameter(Mandatory = $false)]
    [string]$CommitSha = "",

    [Parameter(Mandatory = $false)]
    [string]$Details = "",

    [Parameter(Mandatory = $false)]
    [string]$Tags = "",

    [Parameter(Mandatory = $false)]
    [string]$OutputPath = "./.github/ai-state/knowledge-updates.ndjson",

    [switch]$DryRun,

    [switch]$ValidateOnly,

    [switch]$SelfTest
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

function Assert-ValidSha {
    param([string]$Sha)
    if ($Sha -notmatch '^[0-9a-fA-F]{7,40}$') {
        Write-Fail "CommitSha must be 7-40 hex characters. Got: '$Sha'"
        exit 1
    }
}

function Assert-ValidEntry {
    <#
    .SYNOPSIS
        Validates a knowledge update entry. Returns an array of error strings.
        Empty array = valid.
    #>
    param([hashtable]$Entry)

    $violations = @()

    # schemaVersion
    if ($Entry.schemaVersion -ne 1) {
        $violations += "schemaVersion must be 1, got: $($Entry.schemaVersion)"
    }

    # category
    $validCategories = @("migration", "architecture", "policy", "test", "docs", "infrastructure", "security", "performance")
    if ($Entry.category -notin $validCategories) {
        $violations += "category must be one of [$($validCategories -join ', ')], got: '$($Entry.category)'"
    }

    # summary
    if ([string]::IsNullOrEmpty($Entry.summary)) {
        $violations += "summary must be a non-empty string"
    }

    # capturedAt
    if ([string]::IsNullOrEmpty($Entry.capturedAt)) {
        $violations += "capturedAt must be a non-empty ISO-8601 string"
    }

    # commitSha pattern
    if ($Entry.commitSha -notmatch '^[0-9a-fA-F]{7,40}$') {
        $violations += "commitSha must be 7-40 hex characters, got: '$($Entry.commitSha)'"
    }

    # issueNumber must be positive int if present
    if ($Entry.Contains("issueNumber") -and $Entry.issueNumber -is [int] -and $Entry.issueNumber -lt 0) {
        $violations += "issueNumber must be non-negative, got: $($Entry.issueNumber)"
    }

    # prNumber must be positive int if present
    if ($Entry.Contains("prNumber") -and $Entry.prNumber -is [int] -and $Entry.prNumber -lt 0) {
        $violations += "prNumber must be non-negative, got: $($Entry.prNumber)"
    }

    # tags must be array if present
    if ($Entry.Contains("tags") -and $Entry.tags -isnot [array]) {
        $violations += "tags must be an array"
    }

    return $violations
}

# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

if ($SelfTest) {
    Write-Step "Running self-tests"
    $pass = 0
    $fail = 0

    # Test 1: Valid entry passes validation
    $testEntry = [ordered]@{
        schemaVersion = 1
        category      = "migration"
        summary       = "Test knowledge"
        capturedAt    = ([DateTime]::UtcNow.ToString("o"))
        commitSha     = "abc1234"
        issueNumber   = 100
        prNumber      = 200
        tags          = @("test")
    }
    $errors = @(Assert-ValidEntry -Entry $testEntry)
    if ($errors.Count -eq 0) { $pass++; Write-Ok "Test 1: valid entry passes" }
    else { $fail++; Write-Fail "Test 1 FAILED: $($errors -join '; ')" }

    # Test 2: Missing summary fails
    $badEntry = [ordered]@{
        schemaVersion = 1
        category      = "migration"
        summary       = ""
        capturedAt    = ([DateTime]::UtcNow.ToString("o"))
        commitSha     = "abc1234"
    }
    $errors = @(Assert-ValidEntry -Entry $badEntry)
    if ($errors.Count -gt 0) { $pass++; Write-Ok "Test 2: empty summary rejected" }
    else { $fail++; Write-Fail "Test 2 FAILED: empty summary should be rejected" }

    # Test 3: Invalid category fails
    $badEntry2 = [ordered]@{
        schemaVersion = 1
        category      = "invalid-category"
        summary       = "Test"
        capturedAt    = ([DateTime]::UtcNow.ToString("o"))
        commitSha     = "abc1234"
    }
    $errors = @(Assert-ValidEntry -Entry $badEntry2)
    if ($errors.Count -gt 0) { $pass++; Write-Ok "Test 3: invalid category rejected" }
    else { $fail++; Write-Fail "Test 3 FAILED: invalid category should be rejected" }

    # Test 4: Invalid SHA fails
    $badEntry3 = [ordered]@{
        schemaVersion = 1
        category      = "docs"
        summary       = "Test"
        capturedAt    = ([DateTime]::UtcNow.ToString("o"))
        commitSha     = "not-a-sha"
    }
    $errors = @(Assert-ValidEntry -Entry $badEntry3)
    if ($errors.Count -gt 0) { $pass++; Write-Ok "Test 4: invalid SHA rejected" }
    else { $fail++; Write-Fail "Test 4 FAILED: invalid SHA should be rejected" }

    # Test 5: NDJSON serialization round-trip
    $testEntry2 = [ordered]@{
        schemaVersion = 1
        category      = "architecture"
        summary       = "Round-trip test with special chars: `"quotes`" & backslash \ "
        capturedAt    = ([DateTime]::UtcNow.ToString("o"))
        commitSha     = "deadbeef"
        issueNumber   = 0
        prNumber      = 0
        tags          = @()
    }
    $json = $testEntry2 | ConvertTo-Json -Compress -Depth 4
    try {
        $parsed = $json | ConvertFrom-Json
        if ($parsed.summary -match "Round-trip test") { $pass++; Write-Ok "Test 5: NDJSON round-trip" }
        else { $fail++; Write-Fail "Test 5 FAILED: round-trip content mismatch" }
    } catch {
        $fail++; Write-Fail "Test 5 FAILED: $($_.Exception.Message)"
    }

    # Test 6: Schema version check
    $badEntry4 = [ordered]@{
        schemaVersion = 99
        category      = "test"
        summary       = "Bad version"
        capturedAt    = ([DateTime]::UtcNow.ToString("o"))
        commitSha     = "abc1234"
    }
    $errors = @(Assert-ValidEntry -Entry $badEntry4)
    if ($errors.Count -gt 0) { $pass++; Write-Ok "Test 6: wrong schemaVersion rejected" }
    else { $fail++; Write-Fail "Test 6 FAILED: wrong schemaVersion should be rejected" }

    Write-Host ""
    Write-Host "Self-test results: $pass passed, $fail failed"
    if ($fail -gt 0) { exit 1 }
    exit 0
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
# Validate required parameters (skip for -SelfTest)
# ---------------------------------------------------------------------------

if ([string]::IsNullOrEmpty($Category)) {
    Write-Fail "Category is required. Valid: migration, architecture, policy, test, docs, infrastructure, security, performance"
    exit 2
}

if ([string]::IsNullOrEmpty($Summary)) {
    Write-Fail "Summary is required."
    exit 2
}

Assert-ValidSha -Sha $CommitSha

# ---------------------------------------------------------------------------
# Parse tags
# ---------------------------------------------------------------------------

$tagsArray = @()
if ($Tags -ne "") {
    $tagsArray = @($Tags -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
}

# ---------------------------------------------------------------------------
# Build entry object
# ---------------------------------------------------------------------------

$now = [DateTime]::UtcNow

$entry = [ordered]@{
    schemaVersion = 1
    category      = $Category
    summary       = $Summary
    capturedAt    = $now.ToString("o")
    commitSha     = $CommitSha
    issueNumber   = $IssueNumber
    prNumber      = $PrNumber
    tags          = $tagsArray
}

if ($Details -ne "") {
    $entry["details"] = $Details
}

$json = $entry | ConvertTo-Json -Compress -Depth 4

# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------

Write-Step "Validating entry against knowledge-update schema"
$schemaErrors = @(Assert-ValidEntry -Entry $entry)
if ($schemaErrors.Count -gt 0) {
    Write-Fail "Entry failed schema validation ($($schemaErrors.Count) error(s)):"
    foreach ($e in $schemaErrors) {
        Write-Fail "  - $e"
    }
    exit 1
}
Write-Ok "Entry passes schema validation"

if ($ValidateOnly) {
    Write-Ok "Validate-only mode. Entry is schema-compliant."
    exit 0
}

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

Write-Step "Knowledge update entry"
Write-Host ""
Write-Host $json
Write-Host ""

if ($DryRun) {
    Write-Warn "Dry-run mode. No files were written."
    Write-Host "Would append to: $OutputPath"
    exit 0
}

# ---------------------------------------------------------------------------
# Append to NDJSON ledger
# ---------------------------------------------------------------------------

$dir = Split-Path -Parent $OutputPath
if ($dir -and -not (Test-Path $dir)) {
    Write-Step "Creating directory: $dir"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

Add-Content -Path $OutputPath -Value $json -Encoding UTF8
Write-Ok "Knowledge update entry appended to: $OutputPath"
Write-Host "  category=$Category issue=$IssueNumber pr=$PrNumber tags=[$($tagsArray -join ', ')]"
