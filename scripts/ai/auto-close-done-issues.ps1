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
    [string]$FixturePath,

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
    -FixturePath <string>       Load from JSON fixture (offline, disables mutation)
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

if ($Execute -and $FixturePath) {
    Write-Error "-Execute cannot be used with -FixturePath (fixture mode is read-only)."
    exit 1
}

# ── Validation ───────────────────────────────────────────────────────────────

if (-not $FixturePath -and -not $Repo) {
    Write-Error "Repo is required. Pass -Repo OWNER/NAME or set GH_REPO env var (not needed with -FixturePath)."
    exit 1
}

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($msg) { if (-not $Json) { Write-Host "[step] $msg" -ForegroundColor Cyan } }
function Write-Ok($msg)   { if (-not $Json) { Write-Host "[ok]   $msg" -ForegroundColor Green } }
function Write-Warn($msg) { if (-not $Json) { Write-Host "[warn] $msg" -ForegroundColor Yellow } }
function Write-Info($msg) { if (-not $Json) { Write-Host "[info] $msg" -ForegroundColor Gray } }

# ── Refuse constants ─────────────────────────────────────────────────────────

$REFUSE_LABELS = @("human-required")
$REFUSE_TITLE_PATTERNS = @("umbrella")

function Test-IsRefused {
    param($Issue)
    $title = if ($Issue.title) { $Issue.title } else { "" }

    foreach ($pattern in $REFUSE_TITLE_PATTERNS) {
        if ($title -match $pattern) {
            return [PSCustomObject]@{
                Refused = $true
                Reason  = "Title matches refuse pattern: '$pattern'"
            }
        }
    }

    foreach ($label in $Issue.labels) {
        $lname = if ($label -is [string]) { $label } else { $label.name }
        foreach ($refuseLabel in $REFUSE_LABELS) {
            if ($lname -eq $refuseLabel) {
                return [PSCustomObject]@{
                    Refused = $true
                    Reason  = "Has refuse label: '$refuseLabel'"
                }
            }
        }
    }

    return [PSCustomObject]@{ Refused = $false; Reason = "" }
}

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

Write-Step "Loading agent:done issues"

$issues = @()
if ($FixturePath) {
    Write-Info "Loading from fixture: $FixturePath"
    if (-not (Test-Path $FixturePath)) {
        Write-Error "Fixture file not found: $FixturePath"
        exit 1
    }
    $fixtureData = Get-Content $FixturePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $issues = @($fixtureData.issues | Where-Object { $null -ne $_ })
} elseif ($IssueNumbers -and $IssueNumbers.Count -gt 0) {
    Write-Info "Querying GitHub: $Repo"
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
    Write-Info "Querying GitHub: $Repo"
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
        @{ issues = @(); refused = @(); mainHealth = $mainHealthState; dryRun = (-not $Execute) } | ConvertTo-Json -Depth 5
    }
    exit 0
}

Write-Info "Found $($issues.Count) agent:done issue(s)"

# ── Refuse check ─────────────────────────────────────────────────────────────

Write-Step "Checking issue safety policy"

$refused = @()
$allowed = @()

foreach ($issue in $issues) {
    $num = $issue.number
    $check = Test-IsRefused -Issue $issue
    if ($check.Refused) {
        $refused += [ordered]@{
            issue  = $num
            title  = $issue.title
            reason = $check.Reason
        }
        Write-Warn "  REFUSED #$num — $($check.Reason)"
    } else {
        $allowed += $issue
    }
}

if ($refused.Count -gt 0) {
    Write-Warn "$($refused.Count) issue(s) refused by safety policy."
}

$issues = $allowed

if ($issues.Count -eq 0) {
    Write-Ok "No allowed issues to process."
    if ($Json) {
        @{ issues = @(); refused = $refused; mainHealth = $mainHealthState; dryRun = (-not $Execute) } | ConvertTo-Json -Depth 5
    }
    exit 0
}

Write-Info "$($issues.Count) issue(s) allowed for processing"

# ── Fetch all PRs once (batch query) ────────────────────────────────────────

Write-Step "Fetching PRs"

$allPRs = @()
$openPRs = @()

if ($FixturePath) {
    Write-Info "Loading PRs from fixture"
    $allPRs = @($fixtureData.mergedPRs | Where-Object { $null -ne $_ })
    $openPRs = @($fixtureData.openPRs | Where-Object { $null -ne $_ })
} else {
    try {
        $prRaw = gh pr list --repo $Repo --state merged --json number,title,state,body,mergedAt --limit 200 2>$null
        if ($prRaw -and $prRaw.Trim() -ne "[]") {
            $allPRs = @($prRaw | ConvertFrom-Json)
        }
    } catch {
        Write-Warn "Could not fetch merged PRs: $_"
    }

    try {
        $openPrRaw = gh pr list --repo $Repo --state open --json number,title,state,body --limit 200 2>$null
        if ($openPrRaw -and $openPrRaw.Trim() -ne "[]") {
            $openPRs = @($openPrRaw | ConvertFrom-Json)
        }
    } catch {
        Write-Warn "Could not fetch open PRs: $_"
    }
}

Write-Info "Found $($allPRs.Count) merged PR(s), $($openPRs.Count) open PR(s)"

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

    # Check for open PR first — issue with open PR is not a close candidate
    $hasOpenPR = $false
    $openPRNum = $null
    foreach ($pr in $openPRs) {
        if ($pr.body -match "#$num" -or $pr.title -match "#$num") {
            $hasOpenPR = $true
            $openPRNum = $pr.number
            break
        }
    }

    if ($hasOpenPR) {
        $results += [ordered]@{
            issue    = $num
            title    = $title
            status   = "has-open-pr"
            detail   = "Issue has open PR #$openPRNum; not a close candidate"
            mergedPR = $null
            action   = "skip"
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
$hasOpenPr = @($results | Where-Object { $_.status -eq "has-open-pr" })

if ($Json) {
    $output = [ordered]@{
        mainHealth  = $mainHealthState
        dryRun      = (-not $Execute)
        totalIssues = $issues.Count + $refused.Count
        eligible    = $eligible.Count
        noPr        = $noPr.Count
        blocked     = $blocked.Count
        alreadyClosed = $closed.Count
        hasOpenPr   = $hasOpenPr.Count
        refused     = $refused.Count
        results     = $results
        refusedIssues = $refused
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
        "has-open-pr"         { "OPEN  " }
        default               { "????  " }
    }
    $color = switch ($r.status) {
        "eligible"            { "Green" }
        "no-merged-pr"        { "Yellow" }
        "health-gate-blocked" { "Red" }
        "already-closed"      { "DarkGray" }
        "has-open-pr"         { "Yellow" }
        default               { "White" }
    }
    $prInfo = if ($r.mergedPR) { " PR#$($r.mergedPR)" } else { "" }
    Write-Host "  $tag" -ForegroundColor $color -NoNewline
    Write-Host " #$($r.issue) $($r.title)$prInfo" -ForegroundColor Gray
}

if ($refused.Count -gt 0) {
    Write-Host ""
    Write-Host "  Refused: $($refused.Count)" -ForegroundColor Yellow
    foreach ($r in $refused) {
        Write-Host "    #$($r.issue) — $($r.reason)" -ForegroundColor Yellow
    }
}

Write-Host ""
$summaryParts = @(
    "$($eligible.Count) eligible",
    "$($noPr.Count) no merged PR",
    "$($blocked.Count) health-blocked",
    "$($closed.Count) already closed",
    "$($hasOpenPr.Count) has open PR",
    "$($refused.Count) refused"
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
