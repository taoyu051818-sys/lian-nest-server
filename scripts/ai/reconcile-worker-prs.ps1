#Requires -Version 7.0
<#
.SYNOPSIS
    Maps running issues to open PRs and suggests state label corrections.

.DESCRIPTION
    Scans agent-labeled issues and their linked PRs to produce a concrete
    set of label correction suggestions. This is the final control-loop
    layer that lets Codex exit routine orchestration by identifying
    mismatches between issue labels and PR readiness.

    Reconciliation rules:
    - running-pr-ready         agent:running with CLEAN open PR -> agent:done
    - running-pr-draft         agent:running with draft PR -> keep agent:running
    - running-pr-conflicts     agent:running with merge conflicts -> agent:blocked
    - running-pr-checks-fail   agent:running with failing checks -> agent:blocked
    - done-without-pr          agent:done but no PR exists -> agent:running
    - queued-with-open-pr      agent:queued but PR exists -> agent:done
    - blocked-with-ready-pr    agent:blocked but PR is CLEAN -> agent:running
    - stale-pr                 PR open >StaleDays with no recent push -> warn

    Dry-run by default. -Apply prints suggested gh label commands.
    Never auto-mutates labels.

.PARAMETER Repo
    GitHub repository in OWNER/NAME format. Falls back to GH_REPO env var.

.PARAMETER IssueNumbers
    Limit scan to specific issue numbers.

.PARAMETER FixturePath
    Load issues from a JSON fixture file (offline mode).

.PARAMETER FixtureDir
    Validate all fixtures in a directory (CI regression).

.PARAMETER StaleDays
    Days before a PR is considered stale (default: 7).

.PARAMETER Apply
    Print suggested gh issue edit commands. No auto-mutation.

.PARAMETER DryRun
    Explicitly confirm dry-run mode. Conflicts with -Apply.

.PARAMETER Json
    Output reconciliation report as JSON.

.PARAMETER SelfTest
    Run focused self-test and exit.

.PARAMETER Help
    Show usage and reconciliation rule reference.

.EXAMPLE
    ./scripts/ai/reconcile-worker-prs.ps1 -Repo "owner/name"
    ./scripts/ai/reconcile-worker-prs.ps1 -Repo "owner/name" -IssueNumbers 610,611
    ./scripts/ai/reconcile-worker-prs.ps1 -FixturePath ./snapshot.json
    ./scripts/ai/reconcile-worker-prs.ps1 -FixtureDir ./fixtures/
    ./scripts/ai/reconcile-worker-prs.ps1 -Repo "owner/name" -Apply
    ./scripts/ai/reconcile-worker-prs.ps1 -SelfTest
#>

[CmdletBinding(DefaultParameterSetName = 'Live')]
param(
    [Parameter(Mandatory = $false, ParameterSetName = 'Live')]
    [string]$Repo = $env:GH_REPO,

    [Parameter(Mandatory = $false, ParameterSetName = 'Live')]
    [int[]]$IssueNumbers,

    [Parameter(Mandatory = $true, ParameterSetName = 'Fixture')]
    [string]$FixturePath,

    [Parameter(Mandatory = $true, ParameterSetName = 'FixtureDir')]
    [string]$FixtureDir,

    [Parameter(Mandatory = $true, ParameterSetName = 'SelfTest')]
    [switch]$SelfTest,

    [Parameter(Mandatory = $false)]
    [int]$StaleDays = 7,

    [Parameter(Mandatory = $false)]
    [switch]$Apply,

    [Parameter(Mandatory = $false)]
    [switch]$DryRun,

    [Parameter(Mandatory = $false)]
    [switch]$Json,

    [Parameter(Mandatory = $false)]
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

if ($Help) {
    @"

RECONCILE WORKER PRs — Final control-loop for label/PR reconciliation

USAGE
    ./scripts/ai/reconcile-worker-prs.ps1 -Repo "owner/name" [options]
    ./scripts/ai/reconcile-worker-prs.ps1 -FixturePath ./snapshot.json
    ./scripts/ai/reconcile-worker-prs.ps1 -SelfTest

OPTIONS
    -Repo <string>          GitHub owner/repo (or set GH_REPO env var)
    -IssueNumbers <int[]>   Limit scan to specific issue numbers
    -FixturePath <string>   Load from a single JSON fixture (offline)
    -FixtureDir <string>    Validate all fixtures in a directory (CI)
    -StaleDays <int>        Days before a PR is considered stale (default: 7)
    -Apply                  Print suggested gh label commands (no auto-mutation)
    -DryRun                 Explicit dry-run confirmation; conflicts with -Apply
    -Json                   Output report as JSON
    -SelfTest               Run focused self-test and exit
    -Help                   Show this help message

RECONCILIATION RULES
    running-pr-ready          agent:running + CLEAN open PR -> agent:done
    running-pr-draft          agent:running + draft PR -> keep running
    running-pr-conflicts      agent:running + merge conflicts -> agent:blocked
    running-pr-checks-fail    agent:running + failing checks -> agent:blocked
    done-without-pr           agent:done + no PR -> agent:running
    queued-with-open-pr       agent:queued + open PR -> agent:done
    blocked-with-ready-pr     agent:blocked + CLEAN PR -> agent:running
    stale-pr                  PR open >StaleDays with no recent push

DRY-RUN CONTRACT
    This script never calls gh issue edit or gh label.
    -Apply only prints suggested commands for manual review.

"@ | Write-Output
    exit 0
}

# ---------------------------------------------------------------------------
# Mutual exclusion
# ---------------------------------------------------------------------------

if ($DryRun -and $Apply) {
    Write-Error "-DryRun and -Apply cannot be used together."
    exit 1
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

$AGENT_LABELS = @("agent:queued", "agent:running", "agent:blocked", "agent:done")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Get-AgentLabel {
    param($Issue)
    foreach ($label in $AGENT_LABELS) {
        $lname = if ($label -is [string]) { $label } else { $label.name }
        # Check both formats: string array or object array
        foreach ($lbl in $Issue.labels) {
            $ln = if ($lbl -is [string]) { $lbl } else { $lbl.name }
            if ($ln -eq $label) { return $label }
        }
    }
    return $null
}

function Get-LinkedPRs {
    param([string]$RepoName, [int]$IssueNum, $FixturePRs)
    if ($FixturePRs) { return @($FixturePRs) }
    if (-not $RepoName) { return @() }
    $json = gh pr list --repo $RepoName --state all --json number,title,state,labels,mergedAt,closedAt,isDraft,headRefName,statusCheckRollup,updatedAt --limit 50 2>&1
    $allPRs = $json | ConvertFrom-Json
    $linked = @()
    foreach ($pr in $allPRs) {
        # Match by issue reference in title or linked via branch name convention
        if ($pr.title -match "#$IssueNum" -or $pr.headRefName -match "issue-?$IssueNum") {
            $linked += $pr
        }
    }
    return $linked
}

function Get-SafeProp {
    param($Obj, [string]$Name, $Default = $null)
    if ($Obj.PSObject.Properties[$Name]) { return $Obj.$Name }
    return $Default
}

function Test-PRIsClean {
    param($PR)
    $state = Get-SafeProp $PR "state" "UNKNOWN"
    if ($state -ne "OPEN") { return $false }
    if ((Get-SafeProp $PR "isDraft" $false)) { return $false }
    $mergeable = Get-SafeProp $PR "mergeable" "MERGEABLE"
    if ($mergeable -and $mergeable -ne "MERGEABLE") { return $false }
    $checks = Get-SafeProp $PR "statusCheckRollup" @()
    if ($checks) {
        foreach ($check in $checks) {
            if ($check.state -in @("FAILURE", "CANCELLED", "TIMED_OUT")) {
                return $false
            }
        }
    }
    return $true
}

function Get-PRIssues {
    param($PR)
    $issues = @()
    $state = Get-SafeProp $PR "state" "UNKNOWN"
    if ($state -ne "OPEN") { return $issues }
    if ((Get-SafeProp $PR "isDraft" $false)) { $issues += "draft" }
    $mergeable = Get-SafeProp $PR "mergeable" "MERGEABLE"
    if ($mergeable -and $mergeable -ne "MERGEABLE") {
        $issues += "conflicts"
    }
    $checks = Get-SafeProp $PR "statusCheckRollup" @()
    if ($checks) {
        foreach ($check in $checks) {
            if ($check.state -in @("FAILURE", "CANCELLED", "TIMED_OUT")) {
                $issues += "check-failing"
                break
            }
        }
    }
    return $issues
}

function Get-IssuesFromFixture {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        Write-Error "Fixture file not found: $Path"
        exit 1
    }
    $data = Get-Content $Path -Raw | ConvertFrom-Json
    if ($data.issues) { return @($data.issues) }
    return @($data)
}

function Get-IssuesFromGitHub {
    param([string]$RepoName, [int[]]$Numbers)
    if ($Numbers -and $Numbers.Count -gt 0) {
        $issues = @()
        foreach ($num in $Numbers) {
            $json = gh issue view $num --repo $RepoName --json number,title,state,labels,createdAt,updatedAt 2>&1
            $issues += ($json | ConvertFrom-Json)
        }
        return $issues
    }
    $json = gh issue list --repo $RepoName --label "agent:running,agent:done,agent:blocked,agent:queued" --json number,title,state,labels,createdAt,updatedAt --limit 100 2>&1
    return ($json | ConvertFrom-Json)
}

# ---------------------------------------------------------------------------
# Reconciliation rules
# ---------------------------------------------------------------------------

function Invoke-Reconciliation {
    param($Issues, [string]$RepoName, [int]$StaleThresholdDays)

    $corrections = @()
    $now = Get-Date

    foreach ($issue in $Issues) {
        $num = $issue.number
        $title = if ($issue.title) { $issue.title } else { "(untitled)" }
        $agentLabel = Get-AgentLabel -Issue $issue

        # Fetch linked PRs
        $linkedPRs = @()
        if ($issue.linkedPRs) {
            $linkedPRs = @($issue.linkedPRs)
        } elseif ($RepoName) {
            $linkedPRs = @(Get-LinkedPRs -RepoName $RepoName -IssueNum $num -FixturePRs $null)
        }

        $openPRs = @($linkedPRs | Where-Object {
            $s = if ($_.PSObject.Properties['state']) { $_.state } else { $null }
            $s -eq "OPEN"
        })
        $mergedPRs = @($linkedPRs | Where-Object {
            $m = if ($_.PSObject.Properties['mergedAt']) { $_.mergedAt } else { $null }
            $m
        })

        # Rule: running-pr-ready — agent:running with CLEAN open PR
        if ($agentLabel -eq "agent:running") {
            foreach ($pr in $openPRs) {
                if (Test-PRIsClean -PR $pr) {
                    $corrections += [PSCustomObject]@{
                        Issue    = $num
                        Title    = $title
                        Rule     = "running-pr-ready"
                        Current  = "agent:running"
                        Suggest  = "agent:done"
                        Detail   = "PR #$($pr.number) is CLEAN and ready for review"
                        Severity = "action"
                        PR       = $pr.number
                    }
                }
            }
        }

        # Rule: running-pr-draft — agent:running with draft PR (informational)
        if ($agentLabel -eq "agent:running") {
            $drafts = @($openPRs | Where-Object { $_.isDraft })
            if ($drafts.Count -gt 0) {
                $corrections += [PSCustomObject]@{
                    Issue    = $num
                    Title    = $title
                    Rule     = "running-pr-draft"
                    Current  = "agent:running"
                    Suggest  = "agent:running"
                    Detail   = "PR #$($drafts[0].number) is draft — worker still active"
                    Severity = "info"
                    PR       = $drafts[0].number
                }
            }
        }

        # Rule: running-pr-conflicts — agent:running with merge conflicts
        if ($agentLabel -eq "agent:running") {
            foreach ($pr in $openPRs) {
                $prIssues = Get-PRIssues -PR $pr
                if ($prIssues -contains "conflicts") {
                    $corrections += [PSCustomObject]@{
                        Issue    = $num
                        Title    = $title
                        Rule     = "running-pr-conflicts"
                        Current  = "agent:running"
                        Suggest  = "agent:blocked"
                        Detail   = "PR #$($pr.number) has merge conflicts"
                        Severity = "action"
                        PR       = $pr.number
                    }
                }
            }
        }

        # Rule: running-pr-checks-fail — agent:running with failing checks
        if ($agentLabel -eq "agent:running") {
            foreach ($pr in $openPRs) {
                $prIssues = Get-PRIssues -PR $pr
                if ($prIssues -contains "check-failing") {
                    $corrections += [PSCustomObject]@{
                        Issue    = $num
                        Title    = $title
                        Rule     = "running-pr-checks-fail"
                        Current  = "agent:running"
                        Suggest  = "agent:blocked"
                        Detail   = "PR #$($pr.number) has failing status checks"
                        Severity = "action"
                        PR       = $pr.number
                    }
                }
            }
        }

        # Rule: done-without-pr — agent:done but no PR exists
        if ($agentLabel -eq "agent:done" -and $openPRs.Count -eq 0 -and $mergedPRs.Count -eq 0) {
            $corrections += [PSCustomObject]@{
                Issue    = $num
                Title    = $title
                Rule     = "done-without-pr"
                Current  = "agent:done"
                Suggest  = "agent:running"
                Detail   = "No open or merged PR found — work may need to resume"
                Severity = "action"
                PR       = $null
            }
        }

        # Rule: queued-with-open-pr — agent:queued but PR exists
        if ($agentLabel -eq "agent:queued" -and $openPRs.Count -gt 0) {
            $corrections += [PSCustomObject]@{
                Issue    = $num
                Title    = $title
                Rule     = "queued-with-open-pr"
                Current  = "agent:queued"
                Suggest  = "agent:done"
                Detail   = "PR #$($openPRs[0].number) already open"
                Severity = "action"
                PR       = $openPRs[0].number
            }
        }

        # Rule: blocked-with-ready-pr — agent:blocked but PR is CLEAN
        if ($agentLabel -eq "agent:blocked") {
            foreach ($pr in $openPRs) {
                if (Test-PRIsClean -PR $pr) {
                    $corrections += [PSCustomObject]@{
                        Issue    = $num
                        Title    = $title
                        Rule     = "blocked-with-ready-pr"
                        Current  = "agent:blocked"
                        Suggest  = "agent:done"
                        Detail   = "PR #$($pr.number) is CLEAN — blocker may be resolved"
                        Severity = "action"
                        PR       = $pr.number
                    }
                }
            }
        }

        # Rule: stale-pr — PR open for >StaleDays with no recent push
        foreach ($pr in $openPRs) {
            $prUpdatedRaw = Get-SafeProp $pr "updatedAt" $null
            $prUpdated = if ($prUpdatedRaw) { [DateTime]::Parse($prUpdatedRaw) } else { $now }
            $daysSinceUpdate = ($now - $prUpdated).TotalDays
            if ($daysSinceUpdate -gt $StaleThresholdDays) {
                $corrections += [PSCustomObject]@{
                    Issue    = $num
                    Title    = $title
                    Rule     = "stale-pr"
                    Current  = $agentLabel
                    Suggest  = "review or close PR"
                    Detail   = "PR #$($pr.number) open for $([int]$daysSinceUpdate) days without activity"
                    Severity = "warning"
                    PR       = $pr.number
                }
            }
        }
    }

    return $corrections
}

# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------

function Write-ReconciliationReport {
    param($Corrections)

    if ($Corrections.Count -eq 0) {
        Write-Output "No label corrections needed. All issues and PRs are consistent."
        return
    }

    Write-Output "=== WORKER PR RECONCILIATION REPORT ==="
    Write-Output ""
    Write-Output "Found $($Corrections.Count) correction(s):"
    Write-Output ""

    $grouped = $Corrections | Group-Object Severity
    foreach ($group in $grouped) {
        $icon = switch ($group.Name) {
            "action"  { ">>" }
            "warning" { "! " }
            "info"    { "i " }
            default   { "  " }
        }
        foreach ($c in $group.Group) {
            Write-Output "  [$icon] #$($c.Issue) $($c.Title)"
            Write-Output "       Rule:     $($c.Rule)"
            Write-Output "       Current:  $($c.Current)"
            Write-Output "       Suggest:  $($c.Suggest)"
            Write-Output "       Detail:   $($c.Detail)"
            if ($c.PR) { Write-Output "       PR:       #$($c.PR)" }
            Write-Output ""
        }
    }

    Write-Output "=== END RECONCILIATION REPORT ==="
}

function Build-JsonReport {
    param($Corrections, [string]$RepoName, [string]$Mode)

    $output = [ordered]@{
        reconcilerVersion = 1
        capturedAt        = ([DateTime]::UtcNow).ToString("o")
        repo              = $RepoName
        mode              = $Mode
        totalCorrections  = $Corrections.Count
        corrections       = @($Corrections | ForEach-Object {
            [ordered]@{
                issue    = $_.Issue
                title    = $_.Title
                rule     = $_.Rule
                current  = $_.Current
                suggest  = $_.Suggest
                detail   = $_.Detail
                severity = $_.Severity
                pr       = $_.PR
            }
        })
    }
    return ($output | ConvertTo-Json -Depth 8)
}

function Build-MarkdownReport {
    param($Corrections)

    $lines = @()
    $lines += "<!-- ai-reconcile-worker-prs:begin -->"
    $lines += ""
    $lines += "### Worker PR Reconciliation Report"
    $lines += ""
    $lines += "**Corrections:** $($Corrections.Count)"
    $lines += ""

    if ($Corrections.Count -gt 0) {
        $lines += "| Issue | Rule | Current | Suggested | Detail |"
        $lines += "|-------|------|---------|-----------|--------|"
        foreach ($c in $Corrections) {
            $prRef = if ($c.PR) { " PR #$($c.PR)" } else { "" }
            $lines += "| #$($c.Issue) | $($c.Rule) | $($c.Current) | $($c.Suggest) | $($c.Detail)$prRef |"
        }
        $lines += ""
    } else {
        $lines += "No corrections needed."
        $lines += ""
    }

    $lines += "<!-- ai-reconcile-worker-prs:end -->"
    return $lines -join "`n"
}

# ---------------------------------------------------------------------------
# Fixture validation
# ---------------------------------------------------------------------------

function Invoke-FixtureValidation {
    param([string]$Dir, [int]$StaleThresholdDays)

    if (-not (Test-Path $Dir)) {
        Write-Error "Fixture directory not found: $Dir"
        return 1
    }

    $files = Get-ChildItem -Path $Dir -Filter "*.json" -File | Sort-Object Name
    if ($files.Count -eq 0) {
        Write-Error "No fixture JSON files found in: $Dir"
        return 1
    }

    $totalPass = 0
    $totalFail = 0
    $results = @()

    foreach ($file in $files) {
        $data = Get-Content $file.FullName -Raw | ConvertFrom-Json
        $issues = $data.issues
        $expectedRules = $data.expectedRules
        $expectedCount = $data.expectedCount

        if (-not $issues) {
            Write-Warning "Skipping $($file.Name): no 'issues' field"
            continue
        }

        $corrections = @(Invoke-Reconciliation -Issues $issues -RepoName "" -StaleThresholdDays $StaleThresholdDays)
        $actualRules = @($corrections | ForEach-Object { $_.Rule })
        $actualCount = $corrections.Count

        $pass = $true
        $reasons = @()

        if ($null -ne $expectedCount -and $actualCount -ne $expectedCount) {
            $pass = $false
            $reasons += "expected $expectedCount corrections, got $actualCount"
        }

        if ($expectedRules) {
            foreach ($rule in $expectedRules) {
                if ($actualRules -notcontains $rule) {
                    $pass = $false
                    $reasons += "missing expected rule: $rule"
                }
            }
        }

        $status = if ($pass) { "PASS" } else { "FAIL" }
        if ($pass) { $totalPass++ } else { $totalFail++ }

        $results += [PSCustomObject]@{
            File   = $file.Name
            Status = $status
            Corrections = $actualCount
            Rules  = ($actualRules -join ", ")
            Reason = ($reasons -join "; ")
        }
    }

    Write-Host "=== FIXTURE VALIDATION ==="
    Write-Host ""
    Write-Host "  Files:   $($files.Count)"
    Write-Host "  Passed:  $totalPass"
    Write-Host "  Failed:  $totalFail"
    Write-Host ""

    foreach ($r in $results) {
        $icon = if ($r.Status -eq "PASS") { "OK" } else { "!!" }
        Write-Host "  [$icon] $($r.File) -- $($r.Status) ($($r.Corrections) corrections)"
        if ($r.Rules) { Write-Host "       Rules: $($r.Rules)" }
        if ($r.Reason) { Write-Host "       Reason: $($r.Reason)" }
        Write-Host ""
    }

    Write-Host "=== END FIXTURE VALIDATION ==="

    if ($totalFail -gt 0) { return 1 }
    return 0
}

# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

function Invoke-SelfTest {
    Write-Host ""
    Write-Host "=== RECONCILE WORKER PRs SELF-TEST ==="
    Write-Host ""

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "reconcile-worker-prs-$(Get-Date -Format 'yyyyMMddHHmmss')"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    $script:selfTestPassed = 0
    $script:selfTestFailed = 0

    # Inline test helper to avoid scope issues with nested functions
    $invokeTest = {
        param([string]$Name, [scriptblock]$Assertion)
        try {
            & $Assertion
            $script:selfTestPassed++
            Write-Host "  [OK] $Name"
        } catch {
            $script:selfTestFailed++
            Write-Host "  [!!] $Name -- $($_.Exception.Message)"
        }
    }

    # Fixture 1: running-pr-ready
    @"
{
  "description": "agent:running with CLEAN PR should suggest agent:done",
  "expectedRules": ["running-pr-ready"],
  "expectedCount": 1,
  "issues": [
    {
      "number": 601,
      "title": "Add worker reconciliation",
      "state": "OPEN",
      "labels": [{"name": "agent:running"}],
      "updatedAt": "2026-05-11T10:00:00Z",
      "linkedPRs": [
        {
          "number": 650,
          "title": "feat: worker reconciliation #601",
          "state": "OPEN",
          "isDraft": false,
          "mergeable": "MERGEABLE",
          "statusCheckRollup": [],
          "updatedAt": "2026-05-11T09:00:00Z"
        }
      ]
    }
  ]
}
"@ | Set-Content (Join-Path $tempDir "01-running-pr-ready.json") -Encoding UTF8

    # Fixture 2: running-pr-draft
    @"
{
  "description": "agent:running with draft PR should keep agent:running",
  "expectedRules": ["running-pr-draft"],
  "expectedCount": 1,
  "issues": [
    {
      "number": 602,
      "title": "WIP feature",
      "state": "OPEN",
      "labels": [{"name": "agent:running"}],
      "updatedAt": "2026-05-11T10:00:00Z",
      "linkedPRs": [
        {
          "number": 651,
          "title": "feat: WIP #602",
          "state": "OPEN",
          "isDraft": true,
          "mergeable": "MERGEABLE",
          "statusCheckRollup": [],
          "updatedAt": "2026-05-11T09:00:00Z"
        }
      ]
    }
  ]
}
"@ | Set-Content (Join-Path $tempDir "02-running-pr-draft.json") -Encoding UTF8

    # Fixture 3: done-without-pr
    @"
{
  "description": "agent:done with no PR should suggest agent:running",
  "expectedRules": ["done-without-pr"],
  "expectedCount": 1,
  "issues": [
    {
      "number": 603,
      "title": "Orphaned done issue",
      "state": "OPEN",
      "labels": [{"name": "agent:done"}],
      "updatedAt": "2026-05-10T12:00:00Z",
      "linkedPRs": []
    }
  ]
}
"@ | Set-Content (Join-Path $tempDir "03-done-without-pr.json") -Encoding UTF8

    # Fixture 4: queued-with-open-pr
    @"
{
  "description": "agent:queued with open PR should suggest agent:done",
  "expectedRules": ["queued-with-open-pr"],
  "expectedCount": 1,
  "issues": [
    {
      "number": 604,
      "title": "Mis-labeled queued issue",
      "state": "OPEN",
      "labels": [{"name": "agent:queued"}],
      "updatedAt": "2026-05-11T10:00:00Z",
      "linkedPRs": [
        {
          "number": 652,
          "title": "feat: already done #604",
          "state": "OPEN",
          "isDraft": false,
          "mergeable": "MERGEABLE",
          "statusCheckRollup": [],
          "updatedAt": "2026-05-11T09:00:00Z"
        }
      ]
    }
  ]
}
"@ | Set-Content (Join-Path $tempDir "04-queued-with-open-pr.json") -Encoding UTF8

    # Fixture 5: clean — no corrections needed
    @"
{
  "description": "Clean state — running with draft, no corrections needed",
  "expectedRules": ["running-pr-draft"],
  "expectedCount": 1,
  "issues": [
    {
      "number": 605,
      "title": "Healthy running issue",
      "state": "OPEN",
      "labels": [{"name": "agent:running"}],
      "updatedAt": "2026-05-11T10:00:00Z",
      "linkedPRs": [
        {
          "number": 653,
          "title": "feat: in progress #605",
          "state": "OPEN",
          "isDraft": true,
          "mergeable": "MERGEABLE",
          "statusCheckRollup": [],
          "updatedAt": "2026-05-11T09:00:00Z"
        }
      ]
    }
  ]
}
"@ | Set-Content (Join-Path $tempDir "05-clean-running-draft.json") -Encoding UTF8

    # Fixture 6: running-pr-checks-fail
    @"
{
  "description": "agent:running with failing checks should suggest agent:blocked",
  "expectedRules": ["running-pr-checks-fail"],
  "expectedCount": 1,
  "issues": [
    {
      "number": 606,
      "title": "Failing CI issue",
      "state": "OPEN",
      "labels": [{"name": "agent:running"}],
      "updatedAt": "2026-05-11T10:00:00Z",
      "linkedPRs": [
        {
          "number": 654,
          "title": "fix: ci failure #606",
          "state": "OPEN",
          "isDraft": false,
          "mergeable": "MERGEABLE",
          "statusCheckRollup": [{"state": "FAILURE", "name": "build"}],
          "updatedAt": "2026-05-11T09:00:00Z"
        }
      ]
    }
  ]
}
"@ | Set-Content (Join-Path $tempDir "06-running-pr-checks-fail.json") -Encoding UTF8

    # Run fixture validation
    Write-Host "--- Fixture Validation ---"
    $exitCode = Invoke-FixtureValidation -Dir $tempDir -StaleThresholdDays 7

    # Inline assertions
    Write-Host ""
    Write-Host "--- Inline Assertions ---"

    & $invokeTest "running-pr-ready detects CLEAN PR" {
        $data = Get-Content (Join-Path $tempDir "01-running-pr-ready.json") -Raw | ConvertFrom-Json
        $corrections = @(Invoke-Reconciliation -Issues $data.issues -RepoName "" -StaleThresholdDays 7)
        $ready = $corrections | Where-Object { $_.Rule -eq "running-pr-ready" }
        if (-not $ready) { throw "running-pr-ready not detected" }
        if ($ready.Suggest -ne "agent:done") { throw "Expected agent:done suggestion" }
    }

    & $invokeTest "done-without-pr detects missing PR" {
        $data = Get-Content (Join-Path $tempDir "03-done-without-pr.json") -Raw | ConvertFrom-Json
        $corrections = @(Invoke-Reconciliation -Issues $data.issues -RepoName "" -StaleThresholdDays 7)
        $dwp = $corrections | Where-Object { $_.Rule -eq "done-without-pr" }
        if (-not $dwp) { throw "done-without-pr not detected" }
        if ($dwp.Suggest -ne "agent:running") { throw "Expected agent:running suggestion" }
    }

    & $invokeTest "markdown report contains markers" {
        $corrections = @([PSCustomObject]@{
            Issue = 999; Title = "Test"; Rule = "test-rule"
            Current = "agent:running"; Suggest = "agent:done"
            Detail = "test"; Severity = "action"; PR = 100
        })
        $md = Build-MarkdownReport -Corrections $corrections
        if ($md -notmatch "<!-- ai-reconcile-worker-prs:begin -->") { throw "Missing begin marker" }
        if ($md -notmatch "<!-- ai-reconcile-worker-prs:end -->") { throw "Missing end marker" }
    }

    & $invokeTest "JSON report has correct structure" {
        $corrections = @()
        $jsonStr = Build-JsonReport -Corrections $corrections -RepoName "test/repo" -Mode "dry-run"
        $parsed = $jsonStr | ConvertFrom-Json
        if ($parsed.reconcilerVersion -ne 1) { throw "Missing reconcilerVersion" }
        if ($parsed.mode -ne "dry-run") { throw "Incorrect mode" }
    }

    # Cleanup
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host ""
    Write-Host "=== SELF-TEST SUMMARY ==="
    Write-Host "  Passed: $($script:selfTestPassed)"
    Write-Host "  Failed: $($script:selfTestFailed)"
    Write-Host "=== END SELF-TEST ==="
    Write-Host ""

    if ($script:selfTestFailed -gt 0 -or $exitCode -ne 0) {
        exit 1
    }
    exit 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# Self-test mode
if ($SelfTest) {
    Invoke-SelfTest
    exit 0
}

# Fixture directory validation mode
if ($FixtureDir) {
    $exitCode = Invoke-FixtureValidation -Dir $FixtureDir -StaleThresholdDays $StaleDays
    exit $exitCode
}

# Validate inputs
if (-not $FixturePath -and -not $Repo) {
    Write-Error "One of -Repo or -FixturePath is required. Use -Help for usage."
    exit 1
}

$modeLabel = if ($Apply) { "apply" } else { "dry-run" }

Write-Output "Worker PR Reconciler ($modeLabel by default)"
Write-Output "============================================="
Write-Output ""

# Load issues
$issues = $null
if ($FixturePath) {
    Write-Output "Loading from fixture: $FixturePath"
    $issues = @(Get-IssuesFromFixture -Path $FixturePath)
} else {
    Write-Output "Querying GitHub: $Repo"
    $issues = @(Get-IssuesFromGitHub -RepoName $Repo -Numbers $IssueNumbers)
}

if (-not $issues -or $issues.Count -eq 0) {
    Write-Output "No issues found to reconcile."
    if ($Json) {
        Build-JsonReport -Corrections @() -RepoName $Repo -Mode $modeLabel
    }
    exit 0
}

Write-Output "Evaluating $($issues.Count) issue(s)..."
Write-Output ""

# Run reconciliation
$corrections = @(Invoke-Reconciliation -Issues $issues -RepoName $Repo -StaleThresholdDays $StaleDays)

# Output report
if ($Json) {
    Build-JsonReport -Corrections $corrections -RepoName $Repo -Mode $modeLabel
} else {
    Write-ReconciliationReport -Corrections $corrections
}

# Markdown report (for posting as comment)
$mdReport = Build-MarkdownReport -Corrections $corrections

# Apply mode — print suggested commands
if ($Apply) {
    Write-Output ""
    Write-Output "=== APPLY MODE (suggestions only, no auto-mutation) ==="
    Write-Output ""
    if ($corrections.Count -eq 0) {
        Write-Output "Nothing to suggest."
    } else {
        $actionCorrections = @($corrections | Where-Object { $_.Severity -eq "action" })
        foreach ($c in $actionCorrections) {
            $removeLabel = $c.Current
            $addLabel = $c.Suggest
            if ($addLabel -ne "agent:running" -and $addLabel -ne "agent:done" -and $addLabel -ne "agent:blocked" -and $addLabel -ne "agent:queued") {
                Write-Output "  # $($c.Rule): $($c.Detail)"
                Write-Output "  # Manual review required"
            } else {
                Write-Output "  gh issue edit $($c.Issue) --repo $Repo --add-label '$addLabel' --remove-label '$removeLabel'"
                Write-Output "  # $($c.Rule): $($c.Detail)"
            }
        }
    }
    Write-Output ""
    Write-Output "Commands printed for manual review. No labels were changed."
}

# Summary
$actionCount = @($corrections | Where-Object { $_.Severity -eq "action" }).Count
$warnCount = @($corrections | Where-Object { $_.Severity -eq "warning" }).Count
$infoCount = @($corrections | Where-Object { $_.Severity -eq "info" }).Count

Write-Output ""
Write-Output "Summary: $actionCount action(s), $warnCount warning(s), $infoCount info"

# Always exit 0 — corrections are informational
exit 0
