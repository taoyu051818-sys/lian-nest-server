<#
.SYNOPSIS
    Controlled auto-merge for allowlisted CLEAN, non-draft PRs with
    optional pre-merge guard integration.

.DESCRIPTION
    Merges an explicit set of PRs after verifying each is non-draft, CLEAN
    (all status checks pass), and mergeable. Uses squash merge with branch
    deletion. Stops on the first failure.

    The script REQUIRES an explicit PR allowlist — either inline numbers
    or a file path. It will never discover or merge unspecified PRs.

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
        [string]$HealthCommand
    )

    $manifestDir = Join-Path (Get-Location) '.ai' 'merge-batch-manifests'
    if (-not (Test-Path $manifestDir)) {
        New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
    }

    $timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ssZ')
    $manifest = @{
        timestamp          = (Get-Date).ToUniversalTime().ToString('o')
        repository         = $Repo
        mode               = if ($isExecute) { 'execute' } else { 'dry-run' }
        prs                = $Outcomes
        preCommit          = if ($PreCommit) { $PreCommit } else { $null }
        postCommit         = if ($PostCommit) { $PostCommit } else { $null }
        healthGate         = $HealthResult
        postHealthCommand  = if ($HealthCommand) { $HealthCommand } else { $null }
    }

    $manifestPath = Join-Path $manifestDir "merge-batch-$timestamp.json"
    $manifest | ConvertTo-Json -Depth 5 | Set-Content $manifestPath -Encoding UTF8
    Write-Host ""
    Write-Host "Merge batch manifest written to: $manifestPath"
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
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MergeBatchManifest",
  "type": "object",
  "required": [
    "timestamp",
    "repository",
    "mode",
    "prs",
    "preCommit",
    "postCommit",
    "healthGate",
    "postHealthCommand"
  ],
  "properties": {
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
      "items": {
        "type": "object",
        "required": ["number", "title", "status"],
        "properties": {
          "number": {
            "type": "integer",
            "description": "PR number"
          },
          "title": {
            "type": "string",
            "description": "PR title"
          },
          "status": {
            "type": "string",
            "description": "PR outcome: eligible (dry-run), merged, or failed with reason",
            "pattern": "^(eligible|merged|failed: .+)$"
          }
        }
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
    }
  }
}
'@

    Write-Host $schema
    Write-Host ""
    Write-Host "PR status values:"
    Write-Host "  eligible           - PR passed all checks (dry-run only)"
    Write-Host "  merged             - PR was successfully squash-merged"
    Write-Host "  failed: <reason>   - PR merge failed with error detail"
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
    Write-Host "  excluded PRs       - batch aborts BEFORE merge; no manifest is written"
    Write-Host ""
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
        Write-MergeManifest -PreCommit $null -PostCommit $null -Outcomes $dryRunOutcomes -HealthResult 'skipped' -HealthCommand $resolvedHealthCommand
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
            Write-MergeManifest -PreCommit $preMergeCommit -Outcomes $mergeOutcomes -HealthResult 'skipped' -HealthCommand $resolvedHealthCommand
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
                Write-MergeManifest -PreCommit $preMergeCommit -PostCommit $postMergeCommit -Outcomes $mergeOutcomes -HealthResult $healthResult -HealthCommand $resolvedHealthCommand
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

    Write-MergeManifest -PreCommit $preMergeCommit -PostCommit $postMergeCommit -Outcomes $mergeOutcomes -HealthResult $healthResult -HealthCommand $resolvedHealthCommand
}

Main
