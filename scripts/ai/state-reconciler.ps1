<#
.SYNOPSIS
    Detects state drift between issues, PRs, and worker labels without mutating by default.
.DESCRIPTION
    Reads issue/PR state from `gh` JSON or fixture files and detects obvious drift:
    - Running issue with no open PR
    - Done label on issue with no merged/closing PR
    - Merged PR with still-open issue
    - Stale running issue (no activity within threshold)
    Dry-run by default; pass -Apply to suggest label transitions (still no auto-mutation).
    Evidence precedence: worker evidence > PR state > issue labels.
.EXAMPLE
    ./scripts/ai/state-reconciler.ps1 -Repo "o/r"
    ./scripts/ai/state-reconciler.ps1 -Repo "o/r" -IssueNumbers 113,114
    ./scripts/ai/state-reconciler.ps1 -FixturePath ./state-snapshot.json
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Repo = $env:GH_REPO,

    [Parameter(Mandatory = $false)]
    [int[]]$IssueNumbers,

    [Parameter(Mandatory = $false)]
    [string]$FixturePath,

    [Parameter(Mandatory = $false)]
    [int]$StaleHours = 72,

    [Parameter(Mandatory = $false)]
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

$AGENT_LABELS = @("agent:queued", "agent:running", "agent:blocked", "agent:done")
$DRIFT_MARKER_BEGIN = "<!-- ai-state-reconciler:report:begin -->"
$DRIFT_MARKER_END   = "<!-- ai-state-reconciler:report:end -->"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Get-IssuesFromFixture {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        Write-Error "Fixture file not found: $Path"
        exit 1
    }
    $data = Get-Content $Path -Raw | ConvertFrom-Json
    return $data
}

function Get-IssuesFromGitHub {
    param([string]$RepoName, [int[]]$Numbers)
    $issues = @()
    if ($Numbers -and $Numbers.Count -gt 0) {
        foreach ($num in $Numbers) {
            $json = gh issue view $num --repo $RepoName --json number,title,state,labels,createdAt,updatedAt 2>&1
            $issues += ($json | ConvertFrom-Json)
        }
    } else {
        $json = gh issue list --repo $RepoName --label "agent:running,agent:done,agent:blocked,agent:queued" --json number,title,state,labels,createdAt,updatedAt --limit 100 2>&1
        $issues = ($json | ConvertFrom-Json)
    }
    return $issues
}

function Get-PullsForIssue {
    param([string]$RepoName, [int]$IssueNum)
    $json = gh pr list --repo $RepoName --state all --json number,title,state,labels,mergedAt,closedAt,body --limit 50 2>&1
    $allPRs = $json | ConvertFrom-Json
    $linked = @()
    foreach ($pr in $allPRs) {
        if ($pr.body -match "#$IssueNum" -or $pr.title -match "#$IssueNum") {
            $linked += $pr
        }
    }
    return $linked
}

function Test-HasLabel {
    param($Issue, [string]$LabelName)
    foreach ($label in $Issue.labels) {
        $lname = if ($label -is [string]) { $label } else { $label.name }
        if ($lname -eq $LabelName) { return $true }
    }
    return $false
}

function Get-AgentLabel {
    param($Issue)
    foreach ($label in $AGENT_LABELS) {
        if (Test-HasLabel -Issue $Issue -LabelName $label) { return $label }
    }
    return $null
}

# ---------------------------------------------------------------------------
# Drift detection rules
# ---------------------------------------------------------------------------

function Find-StateDrift {
    param($Issues, [string]$RepoName, [int]$StaleThresholdHours)

    $drifts = @()
    $now = Get-Date

    foreach ($issue in $Issues) {
        $num = $issue.number
        $title = $issue.title
        $agentLabel = Get-AgentLabel -Issue $issue
        $issueState = if ($issue.state) { $issue.state } else { "OPEN" }
        $updatedAt = if ($issue.updatedAt) { [DateTime]::Parse($issue.updatedAt) } else { $now }

        # Fetch linked PRs (skip in fixture mode if PRs embedded)
        $linkedPRs = @()
        if (-not $FixturePath -and $RepoName) {
            $linkedPRs = Get-PullsForIssue -RepoName $RepoName -IssueNum $num
        } elseif ($issue.linkedPRs) {
            $linkedPRs = $issue.linkedPRs
        }

        $openPRs   = @($linkedPRs | Where-Object { $_.state -eq "OPEN" })
        $mergedPRs = @($linkedPRs | Where-Object { $_.mergedAt })

        # Rule 1: agent:running but no open PR and not stale
        if ($agentLabel -eq "agent:running" -and $openPRs.Count -eq 0) {
            $hoursSinceUpdate = ($now - $updatedAt).TotalHours
            if ($hoursSinceUpdate -gt $StaleThresholdHours) {
                $drifts += [PSCustomObject]@{
                    Issue     = $num
                    Title     = $title
                    Rule      = "stale-running"
                    Detail    = "agent:running for $([int]$hoursSinceUpdate)h with no open PR"
                    Suggest   = "agent:running -> agent:blocked (or close if abandoned)"
                    Severity  = "warning"
                }
            }
        }

        # Rule 2: agent:done but no merged PR and issue still open
        if ($agentLabel -eq "agent:done" -and $mergedPRs.Count -eq 0 -and $issueState -eq "OPEN") {
            $drifts += [PSCustomObject]@{
                Issue     = $num
                Title     = $title
                Rule      = "done-without-merge"
                Detail    = "agent:done label but no merged PR found"
                Suggest   = "agent:done -> agent:running (re-open work) or close issue"
                Severity  = "error"
            }
        }

        # Rule 3: Merged PR but issue still open
        if ($mergedPRs.Count -gt 0 -and $issueState -eq "OPEN") {
            $drifts += [PSCustomObject]@{
                Issue     = $num
                Title     = $title
                Rule      = "merged-pr-open-issue"
                Detail    = "PR #$($mergedPRs[0].number) merged but issue still open"
                Suggest   = "Close issue (or add closing keyword to PR body)"
                Severity  = "error"
            }
        }

        # Rule 4: agent:queued for too long
        if ($agentLabel -eq "agent:queued") {
            $hoursSinceUpdate = ($now - $updatedAt).TotalHours
            if ($hoursSinceUpdate -gt $StaleThresholdHours) {
                $drifts += [PSCustomObject]@{
                    Issue     = $num
                    Title     = $title
                    Rule      = "stale-queued"
                    Detail    = "agent:queued for $([int]$hoursSinceUpdate)h without pickup"
                    Suggest   = "Re-triage or remove from queue"
                    Severity  = "info"
                }
            }
        }

        # Rule 5: agent:blocked with open PR (blocker may be resolved)
        if ($agentLabel -eq "agent:blocked" -and $openPRs.Count -gt 0) {
            $drifts += [PSCustomObject]@{
                Issue     = $num
                Title     = $title
                Rule      = "blocked-with-open-pr"
                Detail    = "agent:blocked but PR #$($openPRs[0].number) is open"
                Suggest   = "agent:blocked -> agent:running (resume) or agent:done (if PR ready)"
                Severity  = "info"
            }
        }
    }

    return $drifts
}

# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------

function Write-DriftReport {
    param($Drifts)

    if ($Drifts.Count -eq 0) {
        Write-Output "No state drift detected."
        return
    }

    Write-Output "=== STATE DRIFT REPORT ==="
    Write-Output ""
    Write-Output "Found $($Drifts.Count) drift item(s):"
    Write-Output ""

    $grouped = $Drifts | Group-Object Severity
    foreach ($group in $grouped) {
        $icon = switch ($group.Name) {
            "error"   { "!!" }
            "warning" { "! " }
            "info"    { "i " }
            default   { "  " }
        }
        foreach ($d in $group.Group) {
            Write-Output "  [$icon] #$($d.Issue) $($d.Title)"
            Write-Output "       Rule:    $($d.Rule)"
            Write-Output "       Detail:  $($d.Detail)"
            Write-Output "       Suggest: $($d.Suggest)"
            Write-Output ""
        }
    }

    Write-Output "=== END DRIFT REPORT ==="
}

function Build-MarkdownReport {
    param($Drifts)

    $lines = @()
    $lines += $DRIFT_MARKER_BEGIN
    $lines += ""
    $lines += "### State Reconciler Report"
    $lines += ""
    $lines += "**Drift items:** $($Drifts.Count)"
    $lines += ""

    if ($Drifts.Count -gt 0) {
        $lines += "| # | Issue | Rule | Severity | Suggestion |"
        $lines += "|---|-------|------|----------|------------|"
        foreach ($d in $Drifts) {
            $lines += "| $($d.Issue) | $($d.Title) | $($d.Rule) | $($d.Severity) | $($d.Suggest) |"
        }
        $lines += ""
    } else {
        $lines += "No drift detected."
        $lines += ""
    }

    $lines += $DRIFT_MARKER_END
    return $lines -join "`n"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# Validate inputs
if (-not $FixturePath -and -not $Repo) {
    Write-Error "Either -Repo or -FixturePath is required."
    exit 1
}

Write-Output "State Reconciler (dry-run by default)"
Write-Output "======================================"
Write-Output ""

# Load issues
$issues = $null
if ($FixturePath) {
    Write-Output "Loading from fixture: $FixturePath"
    $issues = Get-IssuesFromFixture -Path $FixturePath
} else {
    Write-Output "Querying GitHub: $Repo"
    $issues = Get-IssuesFromGitHub -RepoName $Repo -Numbers $IssueNumbers
}

if (-not $issues -or $issues.Count -eq 0) {
    Write-Output "No issues found to reconcile."
    exit 0
}

Write-Output "Evaluating $($issues.Count) issue(s)..."
Write-Output ""

# Detect drift
$drifts = Find-StateDrift -Issues $issues -RepoName $Repo -StaleThresholdHours $StaleHours

# Output report
Write-DriftReport -Drifts $drifts

# Markdown report (for posting as comment)
$mdReport = Build-MarkdownReport -Drifts $drifts

if ($Apply) {
    Write-Output ""
    Write-Output "=== APPLY MODE (suggestions only, no auto-mutation) ==="
    Write-Output ""
    if ($drifts.Count -eq 0) {
        Write-Output "Nothing to suggest."
    } else {
        foreach ($d in $drifts) {
            Write-Output "  gh issue edit $($d.Issue) --repo $Repo --add-label '...' --remove-label '...'"
            Write-Output "  # Suggested: $($d.Suggest)"
        }
    }
    Write-Output ""
    Write-Output "Commands printed for manual review. No labels were changed."
}

# Always exit 0 -- drift is informational, not a failure
exit 0
