#Requires -Version 7.0
<#
.SYNOPSIS
    Dry-run planner that proposes the next worker batch from open issues and
    migration matrices without launching workers.

.DESCRIPTION
    Scans open GitHub issues by label, parses their CONTROL APPENDIX metadata,
    reads the migration matrix to enrich candidates with dependency and status
    context, and outputs a proposed batch plan showing conflict groups, risk,
    and readiness for each candidate.

    This script NEVER launches workers. It is a read-only planning tool.

.PARAMETER IssueLabel
    GitHub issue label to discover open issues (e.g. "agent:codex-action-needed").

.PARAMETER Repo
    GitHub repository in OWNER/NAME format. Defaults to GH_REPO env var.

.PARAMETER MatrixPath
    Path to the migration matrix. Defaults to docs/migration/migration-matrix.md.

.PARAMETER MaxTasks
    Maximum number of tasks to include in the proposed batch. Defaults to 5.

.PARAMETER Json
    Output the plan as JSON instead of console text.

.EXAMPLE
    # Propose next batch from labeled issues
    ./scripts/ai/plan-next-batch.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name

.EXAMPLE
    # JSON output for CI consumption
    ./scripts/ai/plan-next-batch.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name -Json

.EXAMPLE
    # Limit to 3 tasks
    ./scripts/ai/plan-next-batch.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name -MaxTasks 3
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$IssueLabel,

    [string]$Repo = $env:GH_REPO,

    [string]$MatrixPath = "docs/migration/migration-matrix.md",

    [int]$MaxTasks = 5,

    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step { param([string]$Msg) if (-not $Json) { Write-Host "[plan] $Msg" -ForegroundColor Cyan } }
function Write-Ok   { param([string]$Msg) if (-not $Json) { Write-Host "[  ok] $Msg" -ForegroundColor Green } }
function Write-Warn { param([string]$Msg) if (-not $Json) { Write-Host "[warn] $Msg" -ForegroundColor Yellow } }
function Write-Fail {
    param([string]$Msg)
    if ($Json) { [Console]::Error.WriteLine("[fail] $Msg") }
    else { Write-Host "[fail] $Msg" -ForegroundColor Red }
    exit 1
}

# ---------------------------------------------------------------------------
# Validate inputs
# ---------------------------------------------------------------------------

if (-not $Repo) {
    Write-Fail "Repo is required. Pass -Repo OWNER/NAME or set GH_REPO env var."
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Plan Next Batch (dry-run)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# Step 1: Discover open issues
# ---------------------------------------------------------------------------

Write-Step "Discovering issues with label: $IssueLabel"

try {
    $issueJson = & gh issue list --repo $Repo --label $IssueLabel --state open --json number,title,body,labels --limit 50 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "gh issue list failed: $issueJson"
    }
    $issues = $issueJson | ConvertFrom-Json
} catch {
    Write-Fail "Issue discovery failed: $_"
}

if ($issues.Count -eq 0) {
    Write-Warn "No open issues found with label '$IssueLabel'."
    if ($Json) {
        @{ candidates = @(); totalOpen = 0; proposed = 0 } | ConvertTo-Json -Depth 6
    }
    exit 0
}

Write-Ok "Found $($issues.Count) open issue(s)"

# ---------------------------------------------------------------------------
# Step 2: Parse migration matrix for slice context
# ---------------------------------------------------------------------------

$sliceStatuses = @{}

if (Test-Path $MatrixPath) {
    Write-Step "Reading migration matrix: $MatrixPath"

    $inPhaseTable = $false
    foreach ($line in (Get-Content $MatrixPath)) {
        # Match phase table rows: | Order | Slice | ... | Status |
        if ($line -match "^\|\s*(\d+)\s*\|\s*([A-Z]\d+|PR\d+)\s*\|") {
            $sliceId = $Matches[2]
            # Extract status from the row (last meaningful column before trailing |)
            if ($line -match "`?(NOT_STARTED|CONTRACTED|IMPLEMENTED|PARITY_TESTED|LEGACY_DISABLED)`?") {
                $sliceStatuses[$sliceId] = $Matches[1]
            }
        }
    }

    Write-Ok "Parsed $($sliceStatuses.Count) slice status(es)"
} else {
    Write-Warn "Migration matrix not found at $MatrixPath — proceeding without slice context"
}

# ---------------------------------------------------------------------------
# Step 3: Extract CONTROL APPENDIX from each issue
# ---------------------------------------------------------------------------

Write-Step "Parsing issue metadata..."

$candidates = @()

foreach ($issueEntry in $issues) {
    $issueNum = $issueEntry.number
    $title = $issueEntry.title
    $body = $issueEntry.body

    # Defaults
    $taskType = "execution"
    $risk = "medium"
    $conflictGroup = "ai-auto"
    $allowedFiles = @()
    $forbiddenFiles = @()
    $validationCommands = @()
    $actorRole = "automation-cycle-worker"
    $sliceRef = $null

    if ($body) {
        # Extract allowed files
        $allowedMatch = [regex]::Match($body, '(?s)Allowed files:\s*\n((?:- .+\n?)+)')
        if ($allowedMatch.Success) {
            $allowedFiles = ($allowedMatch.Groups[1].Value -split "`n") |
                Where-Object { $_ -match '^- ' } |
                ForEach-Object { $_ -replace '^- ', '' } |
                Where-Object { $_ -ne '' }
        }

        # Extract forbidden files
        $forbiddenMatch = [regex]::Match($body, '(?s)Forbidden files:\s*\n((?:- .+\n?)+)')
        if ($forbiddenMatch.Success) {
            $forbiddenFiles = ($forbiddenMatch.Groups[1].Value -split "`n") |
                Where-Object { $_ -match '^- ' } |
                ForEach-Object { $_ -replace '^- ', '' } |
                Where-Object { $_ -ne '' }
        }

        # Extract validation commands
        $valMatch = [regex]::Match($body, '(?s)Validation commands:\s*\n((?:- .+\n?)+)')
        if ($valMatch.Success) {
            $validationCommands = ($valMatch.Groups[1].Value -split "`n") |
                Where-Object { $_ -match '^- ' } |
                ForEach-Object { $_ -replace '^- ', '' } |
                Where-Object { $_ -ne '' }
        }

        # Extract risk level
        $riskMatch = [regex]::Match($body, '(?im)^Risk:\s*(low|medium|high)')
        if ($riskMatch.Success) { $risk = $riskMatch.Groups[1].Value.ToLower() }

        # Extract conflict group
        $cgMatch = [regex]::Match($body, '(?im)^Conflict group:\s*(\S+)')
        if ($cgMatch.Success) { $conflictGroup = $cgMatch.Groups[1].Value }

        # Extract task type
        $ttMatch = [regex]::Match($body, '(?im)^Task type:\s*(execution|research|review)')
        if ($ttMatch.Success) { $taskType = $ttMatch.Groups[1].Value.ToLower() }

        # Extract actor role
        $roleMatch = [regex]::Match($body, '(?im)^Actor role:\s*(.+)')
        if ($roleMatch.Success) { $actorRole = $roleMatch.Groups[1].Value.Trim() }

        # Extract slice reference (e.g. "Slice: A3" or looks like A3 in title)
        $sliceMatch = [regex]::Match($body, '(?im)^Slice:\s*([A-Z]\d+|PR\d+)')
        if ($sliceMatch.Success) {
            $sliceRef = $sliceMatch.Groups[1].Value
        }
    }

    # Heuristic: detect slice from title if not in body
    if (-not $sliceRef) {
        $titleSliceMatch = [regex]::Match($title, '\b([A-Z]\d+|PR\d+)\b')
        if ($titleSliceMatch.Success) {
            $sliceRef = $titleSliceMatch.Groups[1].Value
        }
    }

    # Apply defaults
    if ($allowedFiles.Count -eq 0) { $allowedFiles = @("docs/**") }
    if ($validationCommands.Count -eq 0) { $validationCommands = @("npm run check") }

    # Resolve slice status
    $sliceStatus = $null
    if ($sliceRef -and $sliceStatuses.ContainsKey($sliceRef)) {
        $sliceStatus = $sliceStatuses[$sliceRef]
    }

    # Determine readiness based on slice status
    $readiness = "ready"
    $readinessNote = ""
    if ($sliceStatus) {
        switch ($sliceStatus) {
            "NOT_STARTED"   { $readiness = "blocked"; $readinessNote = "Slice $sliceRef is NOT_STARTED" }
            "CONTRACTED"    { $readiness = "ready"; $readinessNote = "Slice $sliceRef is CONTRACTED" }
            "IMPLEMENTED"   { $readiness = "ready"; $readinessNote = "Slice $sliceRef is IMPLEMENTED" }
            "PARITY_TESTED" { $readiness = "ready"; $readinessNote = "Slice $sliceRef is PARITY_TESTED" }
            "LEGACY_DISABLED" { $readiness = "done"; $readinessNote = "Slice $sliceRef is already LEGACY_DISABLED" }
        }
    }

    $candidate = [ordered]@{
        issueNumber     = $issueNum
        title           = $title
        taskType        = $taskType
        risk            = $risk
        conflictGroup   = $conflictGroup
        actorRole       = $actorRole
        allowedFiles    = @($allowedFiles)
        forbiddenFiles  = @($forbiddenFiles)
        validationCommands = @($validationCommands)
        sliceRef        = $sliceRef
        sliceStatus     = $sliceStatus
        readiness       = $readiness
        readinessNote   = $readinessNote
    }
    $candidates += $candidate
}

Write-Ok "Parsed $($candidates.Count) candidate(s)"

# ---------------------------------------------------------------------------
# Step 4: Filter and prioritize
# ---------------------------------------------------------------------------

Write-Step "Prioritizing candidates..."

# Filter out done candidates
$activeCandidates = @($candidates | Where-Object { $_.readiness -ne "done" })

# Sort: ready first, then blocked; within each group, lower risk first
$riskOrder = @{ "low" = 0; "medium" = 1; "high" = 2 }
$sorted = @($activeCandidates | Sort-Object -Property @{
    Expression = { if ($_.readiness -eq "ready") { 0 } else { 1 } }
}, @{
    Expression = { $riskOrder[$_.risk] }
}, @{
    Expression = { $_.issueNumber }
})

# Apply max tasks limit
$proposed = @($sorted | Select-Object -First $MaxTasks)

Write-Ok "Proposed $($proposed.Count) of $($sorted.Count) active candidate(s)"

# ---------------------------------------------------------------------------
# Step 5: Detect conflict group collisions
# ---------------------------------------------------------------------------

$conflictGroupCounts = @{}
foreach ($c in $proposed) {
    $g = $c.conflictGroup
    if ($conflictGroupCounts.ContainsKey($g)) {
        $conflictGroupCounts[$g]++
    } else {
        $conflictGroupCounts[$g] = 1
    }
}

$conflictWarnings = @()
foreach ($g in $conflictGroupCounts.Keys) {
    if ($conflictGroupCounts[$g] -gt 1) {
        $conflictWarnings += "Group '$g' has $($conflictGroupCounts[$g]) tasks — must run sequentially"
    }
}

# ---------------------------------------------------------------------------
# Step 6: Output
# ---------------------------------------------------------------------------

if ($Json) {
    $output = [ordered]@{
        planVersion      = 1
        capturedAt       = ([DateTime]::UtcNow).ToString("o")
        label            = $IssueLabel
        repo             = $Repo
        totalOpen        = $issues.Count
        totalActive      = $activeCandidates.Count
        proposed         = $proposed.Count
        candidates       = $proposed
        conflictWarnings = $conflictWarnings
        matrixPath       = $MatrixPath
        sliceStatuses    = $sliceStatuses
    }
    $output | ConvertTo-Json -Depth 10
    exit 0
}

# Console output
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Proposed Batch Plan" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "  Label:    $IssueLabel" -ForegroundColor White
Write-Host "  Repo:     $Repo" -ForegroundColor White
Write-Host "  Open:     $($issues.Count)" -ForegroundColor White
Write-Host "  Active:   $($activeCandidates.Count)" -ForegroundColor White
Write-Host "  Proposed: $($proposed.Count)" -ForegroundColor White
Write-Host ""

foreach ($c in $proposed) {
    $riskColor = switch ($c.risk) {
        "low"    { "Green" }
        "medium" { "Yellow" }
        "high"   { "Red" }
    }
    $readyColor = switch ($c.readiness) {
        "ready"   { "Green" }
        "blocked" { "Red" }
        "done"    { "DarkGray" }
    }

    Write-Host "  #$($c.issueNumber)" -NoNewline -ForegroundColor White
    Write-Host "  " -NoNewline
    Write-Host "[$($c.risk)]" -NoNewline -ForegroundColor $riskColor
    Write-Host "  " -NoNewline
    Write-Host "$($c.conflictGroup)" -NoNewline -ForegroundColor DarkCyan
    Write-Host "  " -NoNewline
    Write-Host "$($c.readiness)" -ForegroundColor $readyColor

    Write-Host "    $($c.title)" -ForegroundColor Gray
    Write-Host "    type=$($c.taskType)  role=$($c.actorRole)" -ForegroundColor DarkGray

    if ($c.sliceRef) {
        $sliceInfo = "$($c.sliceRef)"
        if ($c.sliceStatus) { $sliceInfo += " ($($c.sliceStatus))" }
        Write-Host "    slice: $sliceInfo" -ForegroundColor DarkGray
    }

    if ($c.readinessNote) {
        Write-Host "    note: $($c.readinessNote)" -ForegroundColor Yellow
    }

    Write-Host "    allowed: $($c.allowedFiles -join ', ')" -ForegroundColor DarkGray
    Write-Host ""
}

# Conflict warnings
if ($conflictWarnings.Count -gt 0) {
    Write-Host "  Conflict Warnings:" -ForegroundColor Yellow
    foreach ($w in $conflictWarnings) {
        Write-Host "    - $w" -ForegroundColor Yellow
    }
    Write-Host ""
}

# Summary
$blockedCount = @($proposed | Where-Object { $_.readiness -eq "blocked" }).Count
$readyCount = @($proposed | Where-Object { $_.readiness -eq "ready" }).Count

Write-Host "  Summary: $readyCount ready, $blockedCount blocked" -ForegroundColor White
Write-Host ""

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  DRY RUN — no workers launched" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

if ($readyCount -gt 0) {
    Write-Host "Next: Feed proposed tasks into the self-cycle runner:" -ForegroundColor Green
    Write-Host "  ./scripts/ai/run-self-cycle.ps1 -IssueLabel '$IssueLabel' -Repo $Repo" -ForegroundColor Green
} else {
    Write-Host "Next: No ready tasks. Resolve blockers or update slice statuses." -ForegroundColor Yellow
}

Write-Host ""
exit 0
