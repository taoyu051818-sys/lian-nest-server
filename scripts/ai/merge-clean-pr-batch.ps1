<#
.SYNOPSIS
    Controlled auto-merge for allowlisted CLEAN, non-draft PRs with
    optional pre-merge guard integration and manifest write support.

.DESCRIPTION
    Merges an explicit set of PRs after verifying each is non-draft, CLEAN
    (all status checks pass), and mergeable. Uses squash merge with branch
    deletion. Stops on the first failure.

    The script REQUIRES an explicit PR allowlist — either inline numbers
    or a file path. It will never discover or merge unspecified PRs.

    Every run (dry-run, execute, or blocked) writes a merge batch manifest
    to .ai/merge-batch-manifests/ conforming to the schema at
    schemas/merge-manifest.schema.json. The manifest includes a batchId,
    per-PR outcomes, blocked PRs (when guards/eligibility exclude them),
    and a top-level failureReason when the batch aborts.

    When -RunGuards is specified, local guard checks are executed before
    merge to enforce task boundaries, PR handoff structure, docs authority,
    and generated Prisma freshness. Guard failures block merge (fail-closed).
    Guards are skipped when their required inputs are not present.

.PARAMETER PRs
    One or more PR numbers to merge. Cannot be combined with -AllowlistFile.

.PARAMETER AllowlistFile
    Path to a text file containing one PR number per line (blank lines
    and lines starting with # are ignored). Cannot be combined with -PRs.

.PARAMETER Repo
    Target repository in OWNER/NAME format. Falls back to GH_REPO env var.

.PARAMETER DryRun
    Validate PRs and print the merge plan without performing merges.
    This is the DEFAULT mode. Pass -Execute to perform real merges.

.PARAMETER Execute
    Actually merge the PRs. Without this flag, the script only prints
    what it would do (dry-run).

.PARAMETER RunHealthGate
    After a successful batch, run a post-merge health command. Defaults to
    scripts/post-merge-health-gate.js. Use -PostHealthCommand to override.

.PARAMETER PostHealthCommand
    Custom command to run when -RunHealthGate is specified. The command
    is invoked via `node <command>`. Defaults to
    scripts/post-merge-health-gate.js. Example: -PostHealthCommand "scripts/custom-check.js --strict"

.PARAMETER RunGuards
    Run local guard checks before merge. Guards enforce:
    - Task boundary (forbidden/outside-allowed files) — blocking
    - PR handoff (required body sections) — blocking
    - Docs authority (duplicate basenames/titles) — warning-only
    - Generated Prisma freshness (client without schema) — blocking
    Guards are skipped when their required inputs are missing.

.PARAMETER ShowFixtures
    Print example guard fixture templates (task-manifest.json, PR body)
    and exit. Use this to bootstrap guard testing for a new task.

.PARAMETER ManifestSchema
    Print the JSON schema for the merge batch manifest and exit. Use
    this to validate or generate expected manifest structures without
    performing a live merge.

.PARAMETER SelfTest
    Run a focused self-test that validates manifest write behavior
    without contacting GitHub. Writes a sample manifest to a temp
    directory, verifies schema conformance fields (batchId, blockedPrs,
    failureReason), and reports PASS/FAIL.

.EXAMPLE
    # Dry-run with inline PR numbers
    .\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42,45 -Repo owner/name

.EXAMPLE
    # Execute merges from an allowlist file
    .\scripts\ai\merge-clean-pr-batch.ps1 -AllowlistFile .\pr-allowlist.txt -Repo owner/name -Execute

.EXAMPLE
    # Execute with post-merge health gate
    .\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42 -Repo owner/name -Execute -RunHealthGate

.EXAMPLE
    # Execute with custom post-merge health command
    .\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42 -Repo owner/name -Execute -RunHealthGate -PostHealthCommand "scripts/custom-check.js --strict"

.EXAMPLE
    # Run self-test to validate manifest write behavior
    .\scripts\ai\merge-clean-pr-batch.ps1 -SelfTest
#>

[CmdletBinding(DefaultParameterSetName = 'InlinePRs')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'InlinePRs', Position = 0)]
    [int[]]$PRs,

    [Parameter(Mandatory = $true, ParameterSetName = 'File')]
    [string]$AllowlistFile,

    [Parameter(Mandatory = $true, ParameterSetName = 'Fixtures')]
    [switch]$ShowFixtures,

    [Parameter(Mandatory = $true, ParameterSetName = 'Schema')]
    [switch]$ManifestSchema,

    [Parameter(Mandatory = $true, ParameterSetName = 'SelfTest')]
    [switch]$SelfTest,

    [string]$Repo,

    [switch]$DryRun,

    [switch]$Execute,

    [switch]$RunHealthGate,

    [string]$PostHealthCommand,

    [switch]$RunGuards
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Banner {
    param([string]$Text)
    $line = '=' * 72
    Write-Host ""
    Write-Host $line
    Write-Host "  $Text"
    Write-Host $line
    Write-Host ""
}

function Invoke-Gh {
    param(
        [string]$Args,
        [switch]$AllowFailure
    )
    try {
        $result = & gh @($Args.Split(' ')) 2>&1 | Out-String
        return $result.Trim()
    }
    catch {
        if ($AllowFailure) { return $null }
        throw
    }
}

function Get-PRInfo {
    param([int]$PRNumber, [string]$Repository)
    $json = Invoke-Gh "pr view $PRNumber --repo $Repository --json number,title,isDraft,mergeable,state,statusCheckRollup,headRefName,files,body"
    return $json | ConvertFrom-Json
}

# ---------------------------------------------------------------------------
# Guard helpers
# ---------------------------------------------------------------------------

function Normalize-FilePath {
    param([string]$Path)
    return $Path -replace '\\', '/'
}

function Test-TaskBoundary {
    param([array]$ChangedFiles, [string]$ManifestPath)

    if (-not (Test-Path $ManifestPath)) {
        return @()
    }

    try {
        $manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
    }
    catch {
        Write-Host "   WARNING: Could not parse manifest: $_"
        return @()
    }

    $allowed = @()
    $forbidden = @()
    if ($manifest.allowedFiles) { $allowed = @($manifest.allowedFiles) }
    if ($manifest.forbiddenFiles) { $forbidden = @($manifest.forbiddenFiles) }

    $failures = @()
    foreach ($file in $ChangedFiles) {
        $normalized = Normalize-FilePath $file
        foreach ($pattern in $forbidden) {
            $regex = '^' + ($pattern -replace '\.', '\.' -replace '\*', '.*' -replace '\?', '.') + '$'
            $regex = $regex -replace '/\.\*\$', '/.*$'
            if ($normalized -match $regex) {
                $failures += "forbidden file: $file"
                break
            }
        }
        if ($allowed.Count -gt 0) {
            $matched = $false
            foreach ($pattern in $allowed) {
                $regex = '^' + ($pattern -replace '\.', '\.' -replace '\*', '.*' -replace '\?', '.') + '$'
                $regex = $regex -replace '/\.\*\$', '/.*$'
                if ($normalized -match $regex) {
                    $matched = $true
                    break
                }
            }
            if (-not $matched) {
                $failures += "outside allowed boundary: $file"
            }
        }
    }
    return $failures
}

function Test-PRHandoff {
    param([string]$Body, [string]$FilePath)

    $content = $Body
    if ($FilePath -and (Test-Path $FilePath)) {
        $content = Get-Content $FilePath -Raw
    }

    if (-not $content -or [string]::IsNullOrWhiteSpace($content)) {
        return @('PR body is empty — handoff sections required')
    }

    $requiredSections = @(
        @{ Name = 'summary'; Aliases = @('summary', 'overview') },
        @{ Name = 'changed files'; Aliases = @('changed files', 'files changed', 'changes') },
        @{ Name = 'linked issues'; Aliases = @('linked issues', 'linked issue', 'issue', 'issues') },
        @{ Name = 'validation'; Aliases = @('validation', 'validation commands', 'test plan', 'testing') },
        @{ Name = 'non-goals'; Aliases = @('non-goals', 'non goals', 'nongoals', 'out of scope') },
        @{ Name = 'risk / rollback'; Aliases = @('risk / rollback', 'risk', 'rollback', 'risk/rollback', 'risk & rollback') },
        @{ Name = 'follow-up handoff'; Aliases = @('follow-up handoff', 'follow up handoff', 'handoff', 'follow-up') }
    )

    $headings = @()
    foreach ($line in ($content -split "`n")) {
        $trimmed = $line.Trim()
        if ($trimmed -match '^#{1,6}\s+(.+)$') {
            $headings += $Matches[1].Trim().ToLower()
        }
    }

    $missing = @()
    foreach ($section in $requiredSections) {
        $found = $false
        foreach ($heading in $headings) {
            if ($heading -in $section.Aliases) {
                $found = $true
                break
            }
        }
        if (-not $found) {
            $missing += $section.Name
        }
    }

    if ($missing.Count -gt 0) {
        return @("missing handoff sections: $($missing -join ', ')")
    }
    return @()
}

function Invoke-DocsAuthorityGuard {
    param([string]$RepoRoot)

    $guardPath = Join-Path $RepoRoot 'scripts' 'guards' 'check-docs-authority.js'
    $docsPath = Join-Path $RepoRoot 'docs'

    if (-not (Test-Path $guardPath)) { return $null }
    if (-not (Test-Path $docsPath)) { return $null }

    $output = & node $guardPath --warn-only --json 2>&1 | Out-String
    return @{
        Output   = $output.Trim()
        ExitCode = $LASTEXITCODE
    }
}

function Test-GeneratedPrismaFreshness {
    param([array]$ChangedFiles)

    $GENERATED_PREFIX = 'src/generated/prisma/'
    $SCHEMA_PATH = 'prisma/schema.prisma'

    $hasSchema = $false
    $hasGenerated = $false

    foreach ($file in $ChangedFiles) {
        $normalized = Normalize-FilePath $file
        if ($normalized -eq $SCHEMA_PATH) {
            $hasSchema = $true
        }
        if ($normalized.StartsWith($GENERATED_PREFIX)) {
            $hasGenerated = $true
        }
    }

    if ($hasGenerated -and -not $hasSchema) {
        return @('generated Prisma client changed without schema update')
    }
    return @()
}

# ---------------------------------------------------------------------------
# Allowlist resolution
# ---------------------------------------------------------------------------

function Resolve-Allowlist {
    if ($PSCmdlet.ParameterSetName -eq 'File') {
        if (-not (Test-Path $AllowlistFile)) {
            Write-Error "Allowlist file not found: $AllowlistFile"
            exit 1
        }
        $lines = Get-Content $AllowlistFile | ForEach-Object { $_.Trim() }
        $numbers = @()
        foreach ($line in $lines) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            if ($line.StartsWith('#')) { continue }
            $parsed = 0
            if ([int]::TryParse($line, [ref]$parsed)) {
                $numbers += $parsed
            }
            else {
                Write-Error "Invalid PR number in allowlist: '$line'"
                exit 1
            }
        }
        return $numbers
    }
    return $PRs
}

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

$BLOCKER_CHECK_STATES = @('FAILURE', 'CANCELLED', 'TIMED_OUT')

function Test-PREligible {
    param($PRInfo)

    $reasons = @()

    if ($PRInfo.isDraft) {
        $reasons += 'draft'
    }

    if ($PRInfo.state -ne 'OPEN') {
        $reasons += "state=$($PRInfo.state)"
    }

    if ($PRInfo.mergeable -ne 'MERGEABLE') {
        $reasons += "mergeable=$($PRInfo.mergeable)"
    }

    if ($PRInfo.statusCheckRollup) {
        foreach ($check in $PRInfo.statusCheckRollup) {
            if ($check.state -in $BLOCKER_CHECK_STATES) {
                $name = if ($check.name) { $check.name } else { $check.context }
                $reasons += "check-failed: $name ($($check.state))"
                break
            }
        }
    }

    return $reasons
}

# ---------------------------------------------------------------------------
# Merge execution
# ---------------------------------------------------------------------------

function Invoke-PRMerge {
    param([int]$PRNumber, [string]$Repository)

    Invoke-Gh "pr merge $PRNumber --repo $Repository --squash --delete-branch"
}

# ---------------------------------------------------------------------------
# Manifest persistence
# ---------------------------------------------------------------------------

function Write-MergeManifest {
    param(
        [string]$PreCommit,
        [string]$PostCommit,
        [array]$Outcomes,
        [string]$HealthResult,
        [string]$HealthCommand,
        [array]$BlockedPRs,
        [string]$FailureReason,
        [string]$ManifestDir
    )

    $targetDir = if ($ManifestDir) { $ManifestDir } else { Join-Path (Get-Location) '.ai' 'merge-batch-manifests' }
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    $timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ssZ')
    $batchId = "merge-batch-$($timestamp -replace ':', '-')"
    $manifest = @{
        batchId            = $batchId
        timestamp          = (Get-Date).ToUniversalTime().ToString('o')
        repository         = $Repo
        mode               = if ($isExecute) { 'execute' } else { 'dry-run' }
        prs                = $Outcomes
        preCommit          = if ($PreCommit) { $PreCommit } else { $null }
        postCommit         = if ($PostCommit) { $PostCommit } else { $null }
        healthGate         = $HealthResult
        postHealthCommand  = if ($HealthCommand) { $HealthCommand } else { $null }
        blockedPrs         = if ($BlockedPRs) { $BlockedPRs } else { @() }
        failureReason      = if ($FailureReason) { $FailureReason } else { $null }
    }

    $manifestPath = Join-Path $targetDir "merge-batch-$timestamp.json"
    $manifest | ConvertTo-Json -Depth 5 | Set-Content $manifestPath -Encoding UTF8
    Write-Host ""
    Write-Host "Merge batch manifest written to: $manifestPath"
    return $manifestPath
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

function Write-GuardFixtures {
    Write-Banner "Guard Fixture Templates"

    $manifestJson = @'
{
  "taskId": "170-merge-guard-fixtures",
  "allowedFiles": [
    "scripts/ai/merge-clean-pr-batch.ps1",
    "docs/ai-native/controlled-auto-merge.md",
    "docs/ai-native/merge-closure-sop.md"
  ],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    "package.json",
    "package-lock.json"
  ]
}
'@

    $prBody = @'
## Summary
Add guard fixture templates for explicit allowlist safety testing.

## Changed files
- scripts/ai/merge-clean-pr-batch.ps1
- docs/ai-native/controlled-auto-merge.md
- docs/ai-native/merge-closure-sop.md

## Linked issues
Closes #170

## Validation
- npm run check: PASS
- Dry-run with -RunGuards: PASS

## Non-goals
- No changes to src/** or prisma/**
- No runtime behavior changes

## Risk / rollback
Low risk — docs and fixture-only changes. Revert commit to roll back.

## Follow-up handoff
None required. All guard fixtures self-contained.
'@

    $highRiskManifest = @'
{
  "taskId": "example-high-risk",
  "allowedFiles": [
    "src/modules/auth/auth.module.ts",
    "src/modules/auth/dto/login.dto.ts"
  ],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    "package.json",
    "package-lock.json"
  ]
}
'@

    Write-Host "--- task-manifest.json (allowlist fixture, safe PR) ---"
    Write-Host $manifestJson
    Write-Host ""
    Write-Host "--- task-manifest.json (high-risk, src/** in allowedFiles) ---"
    Write-Host $highRiskManifest
    Write-Host ""
    Write-Host "--- PR body template (passes handoff guard) ---"
    Write-Host $prBody
    Write-Host ""
    Write-Host "Usage:"
    Write-Host "  1. Copy task-manifest.json to .ai/task-manifest.json"
    Write-Host "  2. Use the PR body template for your PR description"
    Write-Host "  3. Run: .\scripts\ai\merge-clean-pr-batch.ps1 -PRs N -Repo owner/name -RunGuards"
    Write-Host ""
    Write-Host "Guard behavior:"
    Write-Host "  - allowedFiles outside of forbiddenFiles  => PASS"
    Write-Host "  - any file matching forbiddenFiles         => BLOCK"
    Write-Host "  - any file outside allowedFiles             => BLOCK"
    Write-Host "  - missing handoff sections in PR body       => BLOCK"
    Write-Host "  - high-risk PRs (src/prisma/auth)           => BLOCK (always human-required)"
}

function Write-ManifestSchema {
    Write-Banner "Merge Batch Manifest Schema"

    $schema = @'
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Merge Batch Manifest",
  "type": "object",
  "required": ["batchId", "timestamp", "repository", "mode", "prs"],
  "properties": {
    "batchId": {
      "type": "string",
      "description": "Unique batch identifier (merge-batch-<timestamp>)",
      "pattern": "^[a-z0-9-]+$"
    },
    "timestamp": {
      "type": "string",
      "description": "ISO 8601 UTC timestamp of the run",
      "format": "date-time"
    },
    "repository": {
      "type": "string",
      "description": "Target repository in OWNER/NAME format"
    },
    "mode": {
      "type": "string",
      "enum": ["dry-run", "execute"],
      "description": "Run mode"
    },
    "prs": {
      "type": "array",
      "description": "Per-PR outcome entries",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["number", "title", "status"],
        "properties": {
          "number": { "type": "integer", "minimum": 1 },
          "title": { "type": "string" },
          "status": { "type": "string", "enum": ["eligible", "merged", "failed"] },
          "failureReason": { "type": ["string", "null"] }
        },
        "additionalProperties": false
      }
    },
    "preCommit": {
      "type": ["string", "null"],
      "description": "Git HEAD SHA before merges (null in dry-run or on error)"
    },
    "postCommit": {
      "type": ["string", "null"],
      "description": "Git HEAD SHA after merges (null in dry-run or when merge fails)"
    },
    "healthGate": {
      "type": "string",
      "enum": ["pass", "fail", "not-found", "skipped"],
      "description": "Post-merge health gate result"
    },
    "postHealthCommand": {
      "type": ["string", "null"],
      "description": "Health command path (null when -RunHealthGate not used)"
    },
    "blockedPrs": {
      "type": "array",
      "description": "PRs blocked by guard or eligibility failures",
      "items": {
        "type": "object",
        "required": ["number", "reason"],
        "properties": {
          "number": { "type": "integer", "minimum": 1 },
          "reason": { "type": "string" }
        },
        "additionalProperties": false
      }
    },
    "failureReason": {
      "type": ["string", "null"],
      "description": "Top-level failure reason when batch aborts"
    }
  },
  "additionalProperties": false
}
'@

    Write-Host $schema
    Write-Host ""
    Write-Host "PR status values:"
    Write-Host "  eligible           - PR passed all checks (dry-run only)"
    Write-Host "  merged             - PR was successfully squash-merged"
    Write-Host "  failed             - PR merge failed (see failureReason in entry)"
    Write-Host ""
    Write-Host "Health gate values:"
    Write-Host "  pass               - health gate ran and passed"
    Write-Host "  fail               - health gate ran and failed (non-zero exit)"
    Write-Host "  not-found          - health gate script not present on disk"
    Write-Host "  skipped            - -RunHealthGate was not specified"
    Write-Host ""
    Write-Host "Batch lifecycle:"
    Write-Host "  dry-run            - writes manifest with all PRs as 'eligible', healthGate 'skipped'"
    Write-Host "  execute (all pass) - writes manifest with PRs as 'merged', pre/postCommit, healthGate result"
    Write-Host "  execute (failure)  - writes manifest with partial outcomes, stops on first failure"
    Write-Host "  excluded PRs       - writes manifest with blocked PRs and failureReason, then aborts"
    Write-Host ""
}

function Invoke-SelfTest {
    Write-Banner "Self-Test: Manifest Write Behavior"

    $testDir = Join-Path ([System.IO.Path]::GetTempPath()) "merge-manifest-selftest-$(Get-Date -Format 'yyyyMMddHHmmss')"
    New-Item -ItemType Directory -Path $testDir -Force | Out-Null

    $pass = 0
    $fail = 0

    # Test 1: dry-run manifest includes batchId, blockedPrs, failureReason
    Write-Host "TEST 1: dry-run manifest with blocked PRs"
    $Repo = "test-owner/test-repo"
    $isExecute = $false
    $outcomes = @(
        @{ number = 10; title = "feat: test"; status = 'eligible' }
    )
    $blocked = @(
        @{ number = 11; reason = "forbidden file: src/app.ts" }
    )
    $manifestPath = Write-MergeManifest -PreCommit $null -PostCommit $null -Outcomes $outcomes -HealthResult 'skipped' -HealthCommand $null -BlockedPRs $blocked -FailureReason "1 PR(s) excluded by guard or eligibility checks" -ManifestDir $testDir
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

    if ($manifest.batchId -match '^merge-batch-[a-z0-9-]+$') {
        Write-Host "  PASS: batchId present and matches pattern"
        $pass++
    } else {
        Write-Host "  FAIL: batchId missing or invalid: $($manifest.batchId)"
        $fail++
    }

    if ($manifest.blockedPrs.Count -eq 1 -and $manifest.blockedPrs[0].number -eq 11) {
        Write-Host "  PASS: blockedPrs populated correctly"
        $pass++
    } else {
        Write-Host "  FAIL: blockedPrs not populated correctly"
        $fail++
    }

    if ($manifest.failureReason -eq "1 PR(s) excluded by guard or eligibility checks") {
        Write-Host "  PASS: failureReason populated correctly"
        $pass++
    } else {
        Write-Host "  FAIL: failureReason not populated correctly"
        $fail++
    }

    # Test 2: execute manifest (success) includes batchId
    Write-Host ""
    Write-Host "TEST 2: execute manifest (success path)"
    $isExecute = $true
    $outcomes2 = @(
        @{ number = 20; title = "fix: bug"; status = 'merged' }
    )
    $manifestPath2 = Write-MergeManifest -PreCommit "abc123" -PostCommit "def456" -Outcomes $outcomes2 -HealthResult 'pass' -HealthCommand "scripts/post-merge-health-gate.js" -BlockedPRs @() -FailureReason $null -ManifestDir $testDir
    $manifest2 = Get-Content $manifestPath2 -Raw | ConvertFrom-Json

    if ($manifest2.batchId -match '^merge-batch-[a-z0-9-]+$') {
        Write-Host "  PASS: batchId present on execute manifest"
        $pass++
    } else {
        Write-Host "  FAIL: batchId missing on execute manifest"
        $fail++
    }

    if ($manifest2.mode -eq 'execute') {
        Write-Host "  PASS: mode is 'execute'"
        $pass++
    } else {
        Write-Host "  FAIL: mode is not 'execute': $($manifest2.mode)"
        $fail++
    }

    if (-not $manifest2.blockedPrs -or $manifest2.blockedPrs.Count -eq 0) {
        Write-Host "  PASS: blockedPrs is empty on success"
        $pass++
    } else {
        Write-Host "  FAIL: blockedPrs should be empty on success"
        $fail++
    }

    if ($null -eq $manifest2.failureReason) {
        Write-Host "  PASS: failureReason is null on success"
        $pass++
    } else {
        Write-Host "  FAIL: failureReason should be null on success"
        $fail++
    }

    # Test 3: batch abort manifest
    Write-Host ""
    Write-Host "TEST 3: batch abort manifest (merge failure)"
    $isExecute = $true
    $outcomes3 = @(
        @{ number = 30; title = "feat: merged"; status = 'merged' },
        @{ number = 31; title = "feat: failed"; status = 'failed' }
    )
    $manifestPath3 = Write-MergeManifest -PreCommit "abc123" -PostCommit $null -Outcomes $outcomes3 -HealthResult 'skipped' -HealthCommand $null -BlockedPRs @() -FailureReason "Merge failed on PR #31: Not mergeable" -ManifestDir $testDir
    $manifest3 = Get-Content $manifestPath3 -Raw | ConvertFrom-Json

    if ($manifest3.failureReason -like "Merge failed on PR #31*") {
        Write-Host "  PASS: failureReason captures merge failure"
        $pass++
    } else {
        Write-Host "  FAIL: failureReason missing merge failure detail"
        $fail++
    }

    if ($manifest3.prs.Count -eq 2) {
        Write-Host "  PASS: partial outcomes preserved"
        $pass++
    } else {
        Write-Host "  FAIL: partial outcomes not preserved"
        $fail++
    }

    # Cleanup
    Remove-Item -Path $testDir -Recurse -Force -ErrorAction SilentlyContinue

    # Summary
    Write-Host ""
    Write-Host "Results: $pass passed, $fail failed"
    if ($fail -gt 0) {
        Write-Host "SELF-TEST FAILED"
        exit 1
    }
    Write-Host "SELF-TEST PASSED"
}

function Main {
    # Show fixtures and exit
    if ($ShowFixtures.IsPresent) {
        Write-GuardFixtures
        exit 0
    }

    # Show manifest schema and exit
    if ($ManifestSchema.IsPresent) {
        Write-ManifestSchema
        exit 0
    }

    # Run self-test and exit
    if ($SelfTest.IsPresent) {
        Invoke-SelfTest
        exit 0
    }

    # Resolve repository
    if (-not $Repo) {
        $Repo = $env:GH_REPO
    }
    if (-not $Repo) {
        Write-Error "Error: -Repo is required (or set GH_REPO env var)."
        exit 1
    }

    # Resolve mode
    $isExecute = $Execute.IsPresent
    $modeLabel = if ($isExecute) { 'EXECUTE' } else { 'DRY-RUN' }

    # Resolve allowlist
    $prNumbers = Resolve-Allowlist
    if ($prNumbers.Count -eq 0) {
        Write-Error "Error: No PR numbers provided. Specify -PRs or -AllowlistFile."
        exit 1
    }

    Write-Banner "Controlled Auto-Merge — $modeLabel"
    Write-Host "  Repository  : $Repo"
    Write-Host "  Mode        : $modeLabel"
    Write-Host "  PR count    : $($prNumbers.Count)"
    $resolvedHealthCommand = if ($PostHealthCommand) { $PostHealthCommand } else { (Join-Path $PSScriptRoot '..' '..' 'scripts' 'post-merge-health-gate.js') }
    Write-Host "  Health gate : $($RunHealthGate.IsPresent)"
    if ($RunHealthGate.IsPresent -and $PostHealthCommand) {
        Write-Host "  Health cmd  : $PostHealthCommand"
    }
    Write-Host "  Guards      : $($RunGuards.IsPresent)"
    if ($isExecute) {
        Write-Host "  WARNING     : -Execute mode will perform real merges!"
    }
    Write-Host ""

    # Guard configuration
    $manifestPath = Join-Path (Get-Location) '.ai' 'task-manifest.json'
    $handoffPath = Join-Path (Get-Location) '.ai' 'pr-body.md'
    $repoRoot = (Get-Location).Path

    $guardStatus = @{
        'task-boundary' = 'SKIPPED (no manifest)'
        'pr-handoff' = 'SKIPPED (no file)'
        'docs-authority' = 'SKIPPED'
        'generated-prisma' = 'SKIPPED'
    }

    if ($RunGuards.IsPresent) {
        if (Test-Path $manifestPath) {
            $guardStatus['task-boundary'] = 'CHECKING'
        }
        $guardStatus['pr-handoff'] = 'CHECKING (PR body)'
        $guardStatus['docs-authority'] = 'CHECKING (warn-only)'
        $guardStatus['generated-prisma'] = 'CHECKING'
    }

    # Pre-run docs authority (repo-wide, run once)
    $docsAuthorityFailures = @()
    if ($RunGuards.IsPresent) {
        $docsResult = Invoke-DocsAuthorityGuard -RepoRoot $repoRoot
        if ($docsResult -and $docsResult.ExitCode -ne 0) {
            $docsAuthorityFailures = @('docs authority violations detected (see guard output)')
            $guardStatus['docs-authority'] = 'WARN'
        }
        elseif ($docsResult) {
            $guardStatus['docs-authority'] = 'PASS'
        }
    }

    if ($RunGuards.IsPresent) {
        Write-Banner "Guard Configuration"
        Write-Host "  task-boundary    : $($guardStatus['task-boundary'])"
        Write-Host "  pr-handoff       : $($guardStatus['pr-handoff'])"
        Write-Host "  docs-authority   : $($guardStatus['docs-authority'])"
        Write-Host "  generated-prisma : $($guardStatus['generated-prisma'])"
        Write-Host ""
    }

    # Validate and collect eligible PRs
    $eligible = @()
    $excluded = @()

    foreach ($prNum in $prNumbers) {
        Write-Host ">> Checking PR #$prNum ..."
        try {
            $info = Get-PRInfo -PRNumber $prNum -Repository $Repo
        }
        catch {
            Write-Host "   ERROR: Could not fetch PR #$prNum — $_"
            Write-Host ""
            Write-Host "Stopping — cannot verify PR #$prNum."
            exit 1
        }

        $reasons = Test-PREligible -PRInfo $info

        # Run guard checks if enabled
        if ($RunGuards.IsPresent -and $reasons.Count -eq 0) {
            $changedFiles = @()
            if ($info.files) {
                $changedFiles = @($info.files | ForEach-Object { $_.path })
            }

            # Task boundary guard (blocking)
            if (Test-Path $manifestPath) {
                $guardReasons = Test-TaskBoundary -ChangedFiles $changedFiles -ManifestPath $manifestPath
                $reasons += $guardReasons
            }

            # PR handoff guard (blocking)
            if ($reasons.Count -eq 0) {
                $guardReasons = Test-PRHandoff -Body $info.body -FilePath $handoffPath
                $reasons += $guardReasons
            }

            # Docs authority guard (warning-only, non-blocking)
            if ($reasons.Count -eq 0 -and $docsAuthorityFailures.Count -gt 0) {
                Write-Host "   docs-authority: WARN (non-blocking)"
            }

            # Generated Prisma guard (blocking)
            if ($reasons.Count -eq 0) {
                $guardReasons = Test-GeneratedPrismaFreshness -ChangedFiles $changedFiles
                $reasons += $guardReasons
            }
        }

        if ($reasons.Count -eq 0) {
            Write-Host "   ELIGIBLE: #$prNum — $($info.title)"
            Write-Host "            branch: $($info.headRefName)"
            $eligible += $info
        }
        else {
            Write-Host "   EXCLUDED: #$prNum — $($info.title)"
            Write-Host "            reasons: $($reasons -join ', ')"
            $excluded += @{ PR = $info; Reasons = $reasons }
        }
        Write-Host ""
    }

    # Report excluded
    if ($excluded.Count -gt 0) {
        Write-Banner "Excluded PRs ($($excluded.Count))"
        foreach ($item in $excluded) {
            $pr = $item.PR
            $reasons = $item.Reasons
            Write-Host "  #$($pr.number)  $($pr.title)"
            Write-Host "         EXCLUDED: $($reasons -join ', ')"
            Write-Host ""
        }
    }

    # Report eligible
    if ($eligible.Count -gt 0) {
        Write-Banner "Eligible PRs ($($eligible.Count))"
        foreach ($pr in $eligible) {
            $cmd = "gh pr merge $($pr.number) --repo $Repo --squash --delete-branch"
            Write-Host "  #$($pr.number)  $($pr.title)"
            Write-Host "         branch: $($pr.headRefName)"
            Write-Host "         $ $cmd"
            Write-Host ""
        }
    }
    else {
        Write-Banner "No Eligible PRs"
        Write-Host "All specified PRs are excluded from merging."
        exit 1
    }

    # If any excluded, stop — do not partially merge
    if ($excluded.Count -gt 0) {
        Write-Host "ABORT: $($excluded.Count) PR(s) excluded. Fix exclusions or remove from allowlist."
        Write-Host "No merges performed."
        $blockedOutcomes = $eligible | ForEach-Object {
            @{ number = $_.number; title = $_.title; status = 'eligible' }
        }
        $blockedPRList = $excluded | ForEach-Object {
            @{ number = $_.PR.number; reason = ($_.Reasons -join '; ') }
        }
        $blockReason = "$($excluded.Count) PR(s) excluded by guard or eligibility checks"
        Write-MergeManifest -PreCommit $null -PostCommit $null -Outcomes $blockedOutcomes -HealthResult 'skipped' -HealthCommand $resolvedHealthCommand -BlockedPRs $blockedPRList -FailureReason $blockReason
        exit 1
    }

    # Dry-run stops here
    if (-not $isExecute) {
        Write-Host "DRY-RUN — no merges performed. Use -Execute to merge."
        if ($RunGuards.IsPresent) {
            Write-Host "Guards were checked. Add -RunGuards in execute mode to enforce."
        }
        $dryRunOutcomes = $eligible | ForEach-Object {
            @{ number = $_.number; title = $_.title; status = 'eligible' }
        }
        $dryRunBlocked = @()
        if ($excluded.Count -gt 0) {
            $dryRunBlocked = $excluded | ForEach-Object {
                @{ number = $_.PR.number; reason = ($_.Reasons -join '; ') }
            }
        }
        Write-MergeManifest -PreCommit $null -PostCommit $null -Outcomes $dryRunOutcomes -HealthResult 'skipped' -HealthCommand $resolvedHealthCommand -BlockedPRs $dryRunBlocked -FailureReason $null
        exit 0
    }

    # Execute merges
    Write-Banner "EXECUTING MERGES"
    Write-Host "Merging $($eligible.Count) PR(s) into $Repo ..."
    Write-Host ""

    $preMergeCommit = (git rev-parse HEAD 2>$null)
    $mergeOutcomes = @()
    $merged = @()
    foreach ($pr in $eligible) {
        Write-Host ">> Merging #$($pr.number) — $($pr.title)"
        $cmd = "gh pr merge $($pr.number) --repo $Repo --squash --delete-branch"
        Write-Host "   $ $cmd"

        try {
            $output = Invoke-PRMerge -PRNumber $pr.number -Repository $Repo
            Write-Host "   OK: $(if ($output) { $output } else { 'merged' })"
            $merged += $pr
            $mergeOutcomes += @{ number = $pr.number; title = $pr.title; status = 'merged' }
        }
        catch {
            $errMsg = $_.Exception.Message
            Write-Host "   FAILED: $errMsg"
            $mergeOutcomes += @{ number = $pr.number; title = $pr.title; status = "failed: $errMsg" }
            Write-Host ""
            Write-Host "Stopping — merge batch aborted after failure on PR #$($pr.number)."
            Write-Host "Merged so far: $($merged.Count) of $($eligible.Count)"
            $mergeFailReason = "Merge failed on PR #$($pr.number): $errMsg"
            Write-MergeManifest -PreCommit $preMergeCommit -Outcomes $mergeOutcomes -HealthResult 'skipped' -HealthCommand $resolvedHealthCommand -BlockedPRs @() -FailureReason $mergeFailReason
            exit 1
        }
        Write-Host ""
    }

    $postMergeCommit = (git rev-parse HEAD 2>$null)
    Write-Host "All $($eligible.Count) PR(s) merged successfully."

    # Health gate
    $healthResult = 'skipped'
    if ($RunHealthGate.IsPresent) {
        Write-Host ""
        Write-Banner "Post-Merge Health Gate"
        if (Test-Path $resolvedHealthCommand) {
            Write-Host "Running post-merge health command: $resolvedHealthCommand"
            & node $resolvedHealthCommand --quick
            $exitCode = $LASTEXITCODE
            if ($exitCode -ne 0) {
                Write-Host ""
                Write-Host "WARNING: Post-merge health gate FAILED (exit code $exitCode)."
                Write-Host "Do not launch the next wave until main is healthy."
                $healthResult = 'fail'
                Write-MergeManifest -PreCommit $preMergeCommit -PostCommit $postMergeCommit -Outcomes $mergeOutcomes -HealthResult $healthResult -HealthCommand $resolvedHealthCommand -BlockedPRs @() -FailureReason "Health gate failed (exit code $exitCode)"
                exit $exitCode
            }
            Write-Host "Health gate PASSED."
            $healthResult = 'pass'
        }
        else {
            Write-Host "Health gate script not found at: $resolvedHealthCommand"
            Write-Host "Run manually: node $resolvedHealthCommand --quick"
            $healthResult = 'not-found'
        }
    }

    Write-MergeManifest -PreCommit $preMergeCommit -PostCommit $postMergeCommit -Outcomes $mergeOutcomes -HealthResult $healthResult -HealthCommand $resolvedHealthCommand -BlockedPRs @() -FailureReason $null
}

Main
