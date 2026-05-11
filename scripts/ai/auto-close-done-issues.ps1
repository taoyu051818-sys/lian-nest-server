#Requires -Version 7.0
<#
.SYNOPSIS
    Dry-run helper for closing issues whose linked PRs have been merged.

.DESCRIPTION
    Scans issues labeled agent:done and checks whether a linked PR has been
    merged into main. When evidence is sufficient (merged PR + healthy main),
    the script proposes closing the issue and removing the agent:done label.

    Default mode is dry-run: prints a classification report with no side
    effects. Pass -Execute to perform the close + label removal.

    Safety policy:
      - Dry-run is the default. -Execute is required for mutation.
      - Issues are only closed when a merged PR is confirmed via GitHub API.
      - Optionally verifies main health state before closing.
      - Never closes issues without a merged PR link.
      - Reports a closing comment on each issue for audit trail.

.PARAMETER Repo
    GitHub owner/repo. Defaults to GH_REPO env var.

.PARAMETER IssueNumbers
    Optional — limit scan to specific issue numbers.

.PARAMETER HealthStatePath
    Path to main-health.json. When provided and state is not "green",
    the script skips closing with a warning. Defaults to
    .github/ai-state/main-health.json (only checked if the file exists).

.PARAMETER SkipHealthCheck
    Skip the main health gate check. Use when main health is unknown
    or the caller has already verified health independently.

.PARAMETER DryRun
    Explicit dry-run mode. Prints the classification report and shows
    what actions would be taken without making any changes. This is the
    default behavior; use this flag to be explicit about intent.

.PARAMETER Execute
    Close issues and remove agent:done labels. Conflicts with -DryRun.

.PARAMETER Json
    Output structured JSON instead of human-readable text.

.PARAMETER Help
    Display this help message and exit.

.EXAMPLE
    # Dry-run report (default — no changes)
    ./scripts/ai/auto-close-done-issues.ps1 -Repo "owner/name"

.EXAMPLE
    # Explicit dry-run
    ./scripts/ai/auto-close-done-issues.ps1 -Repo "owner/name" -DryRun

.EXAMPLE
    # Close eligible issues (mutating)
    ./scripts/ai/auto-close-done-issues.ps1 -Repo "owner/name" -Execute

.EXAMPLE
    # Scan specific issues
    ./scripts/ai/auto-close-done-issues.ps1 -Repo "owner/name" -IssueNumbers 113,114

.EXAMPLE
    # Skip health gate check
    ./scripts/ai/auto-close-done-issues.ps1 -Repo "owner/name" -Execute -SkipHealthCheck

.EXAMPLE
    # JSON output for CI consumption
    ./scripts/ai/auto-close-done-issues.ps1 -Repo "owner/name" -Json

.EXAMPLE
    # Display help
    ./scripts/ai/auto-close-done-issues.ps1 -Help
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Repo = $env:GH_REPO,

    [Parameter(Mandatory = $false)]
    [int[]]$IssueNumbers,

    [Parameter(Mandatory = $false)]
    [string]$HealthStatePath = ".github/ai-state/main-health.json",

    [Parameter(Mandatory = $false)]
    [switch]$SkipHealthCheck,

    [Parameter(Mandatory = $false)]
    [switch]$DryRun,

    [Parameter(Mandatory = $false)]
    [switch]$Execute,

    [Parameter(Mandatory = $false)]
    [switch]$Json,

    [Parameter(Mandatory = $false)]
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Help ─────────────────────────────────────────────────────────────────────

if ($Help) {
    @"

AUTO-CLOSE DONE ISSUES — Dry-run helper for closing merged issues

USAGE
    ./scripts/ai/auto-close-done-issues.ps1 -Repo "owner/name" [options]

OPTIONS
    -Repo <string>              GitHub owner/repo (or set GH_REPO)
    -IssueNumbers <int[]>       Limit scan to specific issue numbers
    -HealthStatePath <string>   Path to main-health.json (default: .github/ai-state/main-health.json)
    -SkipHealthCheck            Skip main health gate verification
    -DryRun                     Explicit dry-run (default behavior)
    -Execute                    Close eligible issues (mutating)
    -Json                       Output structured JSON
    -Help                       Show this help message

DRY-RUN CONTRACT
    This script defaults to dry-run. No issues are closed or labels
    removed without the -Execute flag. In dry-run mode the script
    reports what would happen and exits 0.

EVIDENCE REQUIREMENTS
    An issue is eligible for closing when ALL of the following are true:
      1. Issue has the agent:done label
      2. A linked PR (title or body references the issue number) is merged
      3. Main health is green (unless -SkipHealthCheck is set)

"@ | Write-Output
    exit 0
}

# ── Mutual exclusion ────────────────────────────────────────────────────────

if ($DryRun -and $Execute) {
    Write-Error "-DryRun and -Execute cannot be used together. -DryRun enforces no mutation."
    exit 1
}

# ── Validation ───────────────────────────────────────────────────────────────

if (-not $Repo) {
    Write-Error "Repo is required. Pass -Repo OWNER/NAME or set GH_REPO env var."
    exit 1
}

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($msg) { Write-Host "[step] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[ok]   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[warn] $msg" -ForegroundColor Yellow }
function Write-Info($msg) { Write-Host "[info] $msg" -ForegroundColor Gray }

# ── Main health gate ─────────────────────────────────────────────────────────

$mainHealthState = "unknown"
$mainHealthOk = $true

if (-not $SkipHealthCheck) {
    if (Test-Path $HealthStatePath) {
        try {
            $healthRaw = Get-Content -Path $HealthStatePath -Raw -Encoding UTF8
            $healthJson = $healthRaw | ConvertFrom-Json
            $mainHealthState = if ($healthJson.state) { $healthJson.state } else { "unknown" }

            if ($mainHealthState -ne "green") {
                $mainHealthOk = $false
                Write-Warn "Main health is '$mainHealthState' (not green). Issues will be flagged but not closed."
            } else {
                Write-Info "Main health: green"
            }
        } catch {
            Write-Warn "Could not parse $HealthStatePath — skipping health check: $_"
            $mainHealthState = "parse-error"
        }
    } else {
        Write-Info "No main health file at $HealthStatePath — skipping health check"
        $mainHealthState = "missing"
    }
} else {
    Write-Info "Health check skipped (-SkipHealthCheck)"
    $mainHealthState = "skipped"
}

# ── Load issues with agent:done ──────────────────────────────────────────────

Write-Step "Loading agent:done issues from $Repo"

$issues = @()
if ($IssueNumbers -and $IssueNumbers.Count -gt 0) {
    foreach ($num in $IssueNumbers) {
        try {
            $issue = gh issue view $num --repo $Repo --json number,title,state,labels,body,createdAt,updatedAt 2>$null | ConvertFrom-Json
        } catch {
            Write-Warn "  Could not fetch issue #${num}: $_"
            continue
        }
        # Filter: must have agent:done label
        $hasDone = $false
        foreach ($label in $issue.labels) {
            $lname = if ($label -is [string]) { $label } else { $label.name }
            if ($lname -eq "agent:done") { $hasDone = $true; break }
        }
        if ($hasDone) {
            $issues += $issue
        } else {
            Write-Info "  #$num — no agent:done label, skipping"
        }
    }
} else {
    try {
        $raw = gh issue list --repo $Repo --label "agent:done" --json number,title,state,labels,body,createdAt,updatedAt --limit 100 2>$null
        if ($raw -and $raw.Trim() -ne "[]") {
            $issues = @($raw | ConvertFrom-Json)
        }
    } catch {
        Write-Warn "Could not fetch issues: $_"
    }
}

if ($issues.Count -eq 0) {
    Write-Ok "No agent:done issues found."
    if ($Json) {
        @{ issues = @(); mainHealth = $mainHealthState; dryRun = (-not $Execute) } | ConvertTo-Json -Depth 5
    }
    exit 0
}

Write-Info "Found $($issues.Count) agent:done issue(s)"

# ── Fetch all PRs once (batch query) ────────────────────────────────────────

Write-Step "Fetching merged PRs from $Repo"

$allPRs = @()
try {
    $prRaw = gh pr list --repo $Repo --state merged --json number,title,state,body,mergedAt --limit 200 2>$null
    if ($prRaw -and $prRaw.Trim() -ne "[]") {
        $allPRs = @($prRaw | ConvertFrom-Json)
    }
} catch {
    Write-Warn "Could not fetch merged PRs: $_"
}

Write-Info "Found $($allPRs.Count) merged PR(s)"

# ── Evaluate each issue ─────────────────────────────────────────────────────

$results = @()

foreach ($issue in $issues) {
    $num = $issue.number
    $title = $issue.title
    $issueState = if ($issue.state) { $issue.state } else { "OPEN" }

    # Skip already-closed issues
    if ($issueState -eq "CLOSED") {
        $results += [ordered]@{
            issue    = $num
            title    = $title
            status   = "already-closed"
            detail   = "Issue is already closed"
            mergedPR = $null
            action   = "none"
        }
        continue
    }

    # Find linked merged PR (title or body references #num)
    $linkedPR = $null
    foreach ($pr in $allPRs) {
        if ($pr.body -match "#$num" -or $pr.title -match "#$num") {
            $linkedPR = $pr
            break
        }
    }

    if (-not $linkedPR) {
        $results += [ordered]@{
            issue    = $num
            title    = $title
            status   = "no-merged-pr"
            detail   = "No merged PR found referencing #$num"
            mergedPR = $null
            action   = "skip"
        }
        continue
    }

    # Health gate
    if (-not $mainHealthOk) {
        $results += [ordered]@{
            issue    = $num
            title    = $title
            status   = "health-gate-blocked"
            detail   = "Main health is '$mainHealthState'; will not close"
            mergedPR = $linkedPR.number
            action   = "skip"
        }
        continue
    }

    # Eligible for closing
    $results += [ordered]@{
        issue    = $num
        title    = $title
        status   = "eligible"
        detail   = "PR #$($linkedPR.number) merged; issue ready to close"
        mergedPR = $linkedPR.number
        action   = if ($Execute) { "closed" } else { "would-close" }
    }
}

# ── Report ───────────────────────────────────────────────────────────────────

$eligible = @($results | Where-Object { $_.status -eq "eligible" })
$noPr     = @($results | Where-Object { $_.status -eq "no-merged-pr" })
$blocked  = @($results | Where-Object { $_.status -eq "health-gate-blocked" })
$closed   = @($results | Where-Object { $_.status -eq "already-closed" })

if ($Json) {
    $output = [ordered]@{
        mainHealth  = $mainHealthState
        dryRun      = (-not $Execute)
        totalIssues = $issues.Count
        eligible    = $eligible.Count
        noPr        = $noPr.Count
        blocked     = $blocked.Count
        alreadyClosed = $closed.Count
        results     = $results
    }
    $output | ConvertTo-Json -Depth 10
    exit 0
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Auto-Close Done Issues Report" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Main health: $mainHealthState" -ForegroundColor White
Write-Host ""

foreach ($r in $results) {
    $tag = switch ($r.status) {
        "eligible"            { "CLOSE " }
        "no-merged-pr"        { "SKIP  " }
        "health-gate-blocked" { "BLOCK " }
        "already-closed"      { "DONE  " }
        default               { "????  " }
    }
    $color = switch ($r.status) {
        "eligible"            { "Green" }
        "no-merged-pr"        { "Yellow" }
        "health-gate-blocked" { "Red" }
        "already-closed"      { "DarkGray" }
        default               { "White" }
    }
    $prInfo = if ($r.mergedPR) { " PR#$($r.mergedPR)" } else { "" }
    Write-Host "  $tag" -ForegroundColor $color -NoNewline
    Write-Host " #$($r.issue) $($r.title)$prInfo" -ForegroundColor Gray
}

Write-Host ""
$summaryParts = @(
    "$($eligible.Count) eligible",
    "$($noPr.Count) no merged PR",
    "$($blocked.Count) health-blocked",
    "$($closed.Count) already closed"
)
Write-Host "Summary: $($summaryParts -join ', ')" -ForegroundColor White
Write-Host ""

# ── Execute or dry-run ──────────────────────────────────────────────────────

if ($Execute) {
    if ($eligible.Count -eq 0) {
        Write-Ok "No issues to close."
        exit 0
    }

    Write-Step "Closing $($eligible.Count) issue(s)"

    $AGENT_LABELS = @("agent:queued", "agent:running", "agent:blocked", "agent:done")
    $closedCount = 0
    $failedCount = 0

    foreach ($r in $eligible) {
        $num = $r.issue
        Write-Info "  Closing #$num (PR #$($r.mergedPR))"

        # Post closing comment for audit trail
        $closeComment = "<!-- ai-auto-close:begin -->`n"
        $closeComment += "Auto-closed: linked PR #$($r.mergedPR) has been merged into main.`n"
        $closeComment += "Main health at close: $mainHealthState`n"
        $closeComment += "<!-- ai-auto-close:end -->"

        try {
            gh api "repos/$Repo/issues/$num/comments" -X POST -f body="$closeComment" 2>&1 | Out-Null
            Write-Verbose "  Posted closing comment on #$num"
        } catch {
            Write-Warn "  Failed to post comment on #${num}: $_"
        }

        # Remove all agent:* labels
        foreach ($label in $AGENT_LABELS) {
            try {
                gh api "repos/$Repo/issues/$num/labels/$label" -X DELETE 2>&1 | Out-Null
                Write-Verbose "  Removed label '$label' from #$num"
            } catch {
                Write-Verbose "  Label '$label' was not present on #$num"
            }
        }

        # Close the issue
        try {
            gh issue close $num --repo $Repo 2>&1 | Out-Null
            Write-Ok "  Closed #$num"
            $closedCount++
        } catch {
            Write-Warn "  Failed to close #${num}: $_"
            $failedCount++
        }
    }

    Write-Host ""
    Write-Host "Closed: $closedCount, Failed: $failedCount" -ForegroundColor White
    if ($failedCount -gt 0) { exit 1 }
    exit 0
} else {
    Write-Host "DRY RUN — no changes made." -ForegroundColor Yellow

    if ($eligible.Count -gt 0) {
        Write-Host ""
        Write-Host "  Actions if -Execute:" -ForegroundColor Yellow
        foreach ($r in $eligible) {
            Write-Host "    Would close #$($r.issue) (PR #$($r.mergedPR))" -ForegroundColor Gray
        }
        Write-Host ""
        Write-Host "    Command: ./scripts/ai/auto-close-done-issues.ps1 -Repo $Repo -Execute" -ForegroundColor Yellow
    }

    Write-Host ""

    # Exit 1 if there are eligible issues (actionable items need attention)
    if ($eligible.Count -gt 0) { exit 1 }
    exit 0
}
