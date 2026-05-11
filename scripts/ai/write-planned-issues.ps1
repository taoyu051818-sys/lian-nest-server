#Requires -Version 7.0
<#
.SYNOPSIS
    Turns vetted planner output into GitHub issues. Dry-run by default.

.DESCRIPTION
    Reads the JSON plan produced by plan-next-batch.ps1 (via file or stdin)
    and creates GitHub issues for each ready candidate. Each issue follows
    the standard template (Goal, Scope, Acceptance, Constraints) with a
    CONTROL APPENDIX block so downstream workers can compile them into
    task JSON contracts.

    DRY-RUN is the default mode. Pass -Execute to create issues on GitHub.

.PARAMETER PlanFile
    Path to a plan JSON file produced by plan-next-batch.ps1 -Json.
    If omitted, reads from stdin.

.PARAMETER Execute
    Create issues on GitHub. Without this flag, the script prints what
    would be created without making any API calls.

.PARAMETER Label
    Label to apply to created issues. Defaults to "agent:codex-action-needed".

.PARAMETER Repo
    GitHub repository in OWNER/NAME format. Defaults to GH_REPO env var.

.PARAMETER MaxIssues
    Maximum number of issues to create from the plan. Defaults to 10.

.PARAMETER Help
    Show usage examples and exit.

.EXAMPLE
    # Dry-run from file
    ./scripts/ai/write-planned-issues.ps1 -PlanFile ./plan.json

.EXAMPLE
    # Dry-run from pipe
    ./scripts/ai/plan-next-batch.ps1 -Repo owner/name -Json | ./scripts/ai/write-planned-issues.ps1

.EXAMPLE
    # Execute: create issues on GitHub
    ./scripts/ai/write-planned-issues.ps1 -PlanFile ./plan.json -Execute -Repo owner/name

.EXAMPLE
    # Execute with custom label
    ./scripts/ai/write-planned-issues.ps1 -PlanFile ./plan.json -Execute -Label "wave:16" -Repo owner/name

.EXAMPLE
    # Show help
    ./scripts/ai/write-planned-issues.ps1 -Help
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$PlanFile,

    [switch]$Execute,

    [string]$Label = "agent:codex-action-needed",

    [string]$Repo = $env:GH_REPO,

    [int]$MaxIssues = 10,

    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Help ─────────────────────────────────────────────────────────────────────

if ($Help) {
    @"

write-planned-issues.ps1 — Planner issue writer helper

USAGE
    ./scripts/ai/write-planned-issues.ps1 [options]

OPTIONS
    -PlanFile <path>   Path to plan JSON from plan-next-batch.ps1 -Json.
                       If omitted, reads from stdin.
    -Execute           Create issues on GitHub (default: dry-run only).
    -Label <label>     Label to apply to created issues.
                       Default: agent:codex-action-needed
    -Repo <owner/name> GitHub repository (or set GH_REPO env var).
    -MaxIssues <n>     Max issues to create. Default: 10.
    -Help              Show this help message.

PIPELINE
    plan-next-batch.ps1 -Json  -->  write-planned-issues.ps1  -->  GitHub issues
         (propose)                  (this script -- create)        (with CONTROL APPENDIX)

DRY-RUN
    By default the script prints what would be created without making
    any GitHub API calls. Pass -Execute to create issues.

EXIT CODES
    0   Success (dry-run completed or issues created)
    1   Validation failure (bad plan JSON, missing fields)
    2   Invalid arguments

"@ | Write-Host
    exit 0
}

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   WARN: $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "   FAIL: $msg" -ForegroundColor Red; exit 1 }

# ── Validate inputs ─────────────────────────────────────────────────────────

if (-not $Execute -and -not $PlanFile) {
    # In dry-run mode, stdin is fine
}

if ($Execute -and -not $Repo) {
    Write-Fail "Repo is required when -Execute is passed. Set GH_REPO or pass -Repo OWNER/NAME."
}

# ── Load plan JSON ───────────────────────────────────────────────────────────

Write-Step "Loading plan input"

if ($PlanFile) {
    if (-not (Test-Path $PlanFile)) {
        Write-Fail "Plan file not found: $PlanFile"
    }
    try {
        $plan = Get-Content $PlanFile -Raw | ConvertFrom-Json
    } catch {
        Write-Fail "Invalid JSON in plan file: $_"
    }
    Write-Ok "Loaded from file: $PlanFile"
} else {
    Write-Step "Reading from stdin"
    try {
        $rawInput = [Console]::In.ReadToEnd()
        if ([string]::IsNullOrWhiteSpace($rawInput)) {
            Write-Fail "No input received on stdin. Provide -PlanFile or pipe JSON input."
        }
        $plan = $rawInput | ConvertFrom-Json
    } catch {
        Write-Fail "Invalid JSON from stdin: $_"
    }
    Write-Ok "Loaded from stdin"
}

# ── Validate plan structure ─────────────────────────────────────────────────

Write-Step "Validating plan structure"

$candidateList = @($plan.candidates)
if ($candidateList.Count -eq 0) {
    Write-Warn "Plan has 0 candidates. Nothing to write."
    exit 0
}

Write-Ok "Plan contains $($candidateList.Count) candidate(s)"

# ── Filter to ready candidates ──────────────────────────────────────────────

Write-Step "Filtering candidates"

$readyCandidates = @($candidateList | Where-Object { $_.readiness -eq "ready" })

if ($readyCandidates.Count -eq 0) {
    Write-Warn "No candidates with readiness=ready. Nothing to write."
    exit 0
}

# Apply max limit
$candidatesToWrite = @($readyCandidates | Select-Object -First $MaxIssues)

Write-Ok "$($readyCandidates.Count) ready candidate(s), writing up to $MaxIssues"

# ── Secret scan: reject plan content that contains secrets ───────────────────

$secretPatterns = @(
    'ghp_[a-zA-Z0-9]{36}',
    'gho_[a-zA-Z0-9]{36}',
    'github_pat_[a-zA-Z0-9_]{22,}',
    'glpat-[a-zA-Z0-9_-]{20,}',
    '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'AKIA[0-9A-Z]{16}',
    'xox[bpors]-[a-zA-Z0-9-]{10,}',
    'Bearer\s+[A-Za-z0-9._-]{20,}',
    'password\s*[:=]\s*\S+',
    'secret\s*[:=]\s*\S+',
    'token\s*[:=]\s*\S+'
)

function Test-SecretsInText {
    param([string]$Text, [string]$FieldName)
    foreach ($pattern in $secretPatterns) {
        if ($Text -match $pattern) {
            Write-Fail "Potential secret detected in $FieldName (pattern: $pattern). Redact and retry."
        }
    }
}

foreach ($c in $candidatesToWrite) {
    $title = if ($c.title) { $c.title } else { "" }
    Test-SecretsInText -Text $title -FieldName "candidate title"

    # Scan allowedFiles and forbiddenFiles arrays
    if ($c.allowedFiles) {
        foreach ($f in $c.allowedFiles) { Test-SecretsInText -Text $f -FieldName "allowedFiles" }
    }
    if ($c.forbiddenFiles) {
        foreach ($f in $c.forbiddenFiles) { Test-SecretsInText -Text $f -FieldName "forbiddenFiles" }
    }
}

Write-Ok "Secret scan passed"

# ── Build issue bodies ──────────────────────────────────────────────────────

Write-Step "Building issue bodies"

$issues = @()

foreach ($c in $candidatesToWrite) {
    $issueNum = $c.issueNumber
    $title = $c.title
    $taskType = if ($c.taskType) { $c.taskType } else { "execution" }
    $risk = if ($c.risk) { $c.risk } else { "medium" }
    $conflictGroup = if ($c.conflictGroup) { $c.conflictGroup } else { "ai-auto" }
    $actorRole = if ($c.actorRole) { $c.actorRole } else { "automation-cycle-worker" }
    $allowedFiles = @("docs/**")
    if ($c.allowedFiles) {
        $allowedFiles = @($c.allowedFiles | ForEach-Object { $_ })
    }
    $forbiddenFiles = @()
    if ($c.forbiddenFiles) {
        $forbiddenFiles = @($c.forbiddenFiles | ForEach-Object { $_ })
    }
    $validationCommands = @("npm run check")
    if ($c.validationCommands) {
        $validationCommands = @($c.validationCommands | ForEach-Object { $_ })
    }
    $sliceRef = $c.sliceRef
    $readinessNote = $c.readinessNote

    # Build issue body
    $bodyLines = @()
    $bodyLines += "## Goal"
    $bodyLines += ""
    $bodyLines += "$title"
    $bodyLines += ""

    # Scope section
    $bodyLines += "## Scope"
    $bodyLines += ""
    $bodyLines += "Task type: $taskType"
    if ($sliceRef) {
        $bodyLines += "Slice: $sliceRef"
    }
    if ($readinessNote) {
        $bodyLines += ""
        $bodyLines += "Readiness: $readinessNote"
    }
    $bodyLines += ""

    # Acceptance section
    $bodyLines += "## Acceptance"
    $bodyLines += ""
    foreach ($vc in $validationCommands) {
        $bodyLines += "- ``$vc`` passes"
    }
    $bodyLines += ""

    # Constraints section
    $bodyLines += "## Constraints"
    $bodyLines += ""
    $bodyLines += "- Stay within allowed files."
    $bodyLines += "- Do not edit forbidden files."
    $bodyLines += ""

    # CONTROL APPENDIX (machine-readable metadata for downstream compiler)
    $bodyLines += "---"
    $bodyLines += "CONTROL APPENDIX (launcher generated)"
    $bodyLines += "Task type: $taskType"
    $bodyLines += "Risk: $risk"
    $bodyLines += "Conflict group: $conflictGroup"
    $bodyLines += "Target issue: $issueNum"
    $bodyLines += "Target PR: "
    $bodyLines += "Issues: $issueNum"
    $bodyLines += "Expected PR: True"
    $bodyLines += "Allowed files:"
    foreach ($af in $allowedFiles) {
        $bodyLines += "- $af"
    }
    $bodyLines += "Forbidden files:"
    if ($forbiddenFiles.Count -gt 0) {
        foreach ($ff in $forbiddenFiles) {
            $bodyLines += "- $ff"
        }
    } else {
        $bodyLines += "- (none specified)"
    }
    $bodyLines += "Validation commands:"
    foreach ($vc in $validationCommands) {
        $bodyLines += "- $vc"
    }
    $bodyLines += "Use these boundaries as hard constraints. If the requested fix requires files outside allowedFiles, stop and explain the blocker instead of making an unbounded change."
    $bodyLines += "Do NOT output secrets, tokens, auth output, credentials, .env contents, local transcript contents, or llm_io_logs contents."
    $bodyLines += ""
    $bodyLines += "Role packet:"
    $bodyLines += "Actor role: $actorRole"

    # Optional: attention areas from planner
    if ($c.sliceStatus) {
        $bodyLines += "Slice status: $($c.sliceStatus)"
    }
    if ($c.compositeScore) {
        $bodyLines += "Composite score: $($c.compositeScore)"
    }

    $body = $bodyLines -join "`n"

    # Final secret scan on assembled body
    Test-SecretsInText -Text $body -FieldName "assembled issue body"

    $issues += @{
        issueNumber = $issueNum
        title       = $title
        body        = $body
        labels      = @($Label)
    }
}

Write-Ok "Built $($issues.Count) issue body/ies"

# ── Dry-run output ───────────────────────────────────────────────────────────

if (-not $Execute) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  DRY RUN — write-planned-issues" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Plan label:    $($plan.label)" -ForegroundColor White
    Write-Host "  Plan repo:     $($plan.repo)" -ForegroundColor White
    Write-Host "  Candidates:    $($candidatesToWrite.Count) ready of $($candidateList.Count) total" -ForegroundColor White
    Write-Host "  Target label:  $Label" -ForegroundColor White
    Write-Host ""

    foreach ($issue in $issues) {
        Write-Host "  --- Issue #$($issue.issueNumber) ---" -ForegroundColor Yellow
        Write-Host "  Title:  $($issue.title)" -ForegroundColor White
        Write-Host "  Labels: $($issue.labels -join ', ')" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host $issue.body
        Write-Host ""
    }

    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  DRY RUN — no issues created" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "To create issues:" -ForegroundColor Yellow
    Write-Host "  ./scripts/ai/write-planned-issues.ps1 -PlanFile <path> -Execute -Repo owner/name" -ForegroundColor Yellow
    Write-Host ""
    exit 0
}

# ── Execute: create issues on GitHub ─────────────────────────────────────────

Write-Step "Creating issues on GitHub (repo=$Repo, label=$Label)"

$created = @()
$failed = @()

foreach ($issue in $issues) {
    $num = $issue.issueNumber
    $t = $issue.title
    $b = $issue.body

    Write-Step "Creating issue: $t"

    try {
        # Create the issue
        $result = & gh issue create --repo $Repo --title $t --body $b --label $Label 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Failed to create issue '$t': $result"
            $failed += $num
            continue
        }

        # Extract issue number from URL (last path segment)
        $createdUrl = ($result | Out-String).Trim()
        $createdNum = if ($createdUrl -match '/(\d+)$') { $Matches[1] } else { "?" }

        Write-Ok "Created issue #$createdNum — $t"
        Write-Host "    $createdUrl" -ForegroundColor DarkGray
        $created += @{
            plannedIssue = $num
            createdIssue = $createdNum
            url          = $createdUrl
            title        = $t
        }
    } catch {
        Write-Warn "Exception creating issue '$t': $_"
        $failed += $num
    }
}

# ── Summary ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Created: $($created.Count)" -ForegroundColor Green
Write-Host "  Failed:  $($failed.Count)" -ForegroundColor $(if ($failed.Count -gt 0) { "Red" } else { "DarkGray" })
Write-Host ""

if ($created.Count -gt 0) {
    Write-Host "  Created issues:" -ForegroundColor White
    foreach ($c in $created) {
        Write-Host "    #$($c.plannedIssue) -> #$($c.createdIssue) $($c.title)" -ForegroundColor DarkGray
    }
    Write-Host ""
}

if ($failed.Count -gt 0) {
    Write-Host "  Failed planned issues: $($failed -join ', ')" -ForegroundColor Red
    Write-Host ""
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
exit 0
