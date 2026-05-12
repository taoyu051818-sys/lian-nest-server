#Requires -Version 7.0
<#
.SYNOPSIS
    Connects macro/control-plane gap detection to issue seeding and
    AutopilotPlan dry-run planning.

.DESCRIPTION
    Orchestrates three existing components in a safe sequence:

        1. propose-self-cycle-issues.js (--stdout)  — detect gaps, build proposal JSON
        2. write-planned-issues.ps1                  — preview or create only
                                                        policy-allowed (ready) issues
        3. run-self-cycle.ps1 -AutopilotPlan          — non-stop dry-run planning,
                                                        stops before any launch

    DRY-RUN BY DEFAULT. The script never launches workers, never merges PRs,
    never closes issues, and never touches src/**, prisma/**, package.json,
    package-lock.json or the seed constitution. The launch gate is never
    weakened — if it blocks, this script summarises why and exits cleanly.

    Pass -ExecuteIssueSeeding to actually create the policy-allowed issues
    on GitHub (no worker execution still). Worker dispatch is always
    Autopilot-plan only.

.PARAMETER Repo
    GitHub repository in OWNER/NAME format. Defaults to GH_REPO env var.

.PARAMETER IssueLabel
    Label applied to seeded issues and used by AutopilotPlan to discover
    work. Defaults to "agent:codex-action-needed".

.PARAMETER MaxTasks
    Cap forwarded to both propose-self-cycle-issues.js (--max) and
    run-self-cycle.ps1 (-MaxTasks). Default: 10.

.PARAMETER ExecuteIssueSeeding
    Create policy-allowed (ready) issues on GitHub via write-planned-issues
    -Execute. Without this flag the script only previews what would be
    created. Worker execution is NEVER enabled by this flag.

.PARAMETER StateDir
    Directory containing the ai-state files used as input/audit. Defaults
    to ./.github/ai-state.

.PARAMETER PreviewFile
    Path used to save the proposal JSON preview before piping into
    write-planned-issues. Default: <StateDir>/proposed-issues.preview.json

.PARAMETER Help
    Show usage and exit.

.EXAMPLE
    # Default preview — no issues created, no workers launched
    ./scripts/ai/seed-and-plan-self-cycle.ps1 -Repo owner/name

.EXAMPLE
    # Create policy-allowed issues, then run AutopilotPlan (still no workers)
    ./scripts/ai/seed-and-plan-self-cycle.ps1 -Repo owner/name -ExecuteIssueSeeding

.EXAMPLE
    # Show help
    ./scripts/ai/seed-and-plan-self-cycle.ps1 -Help
#>

[CmdletBinding()]
param(
    [string]$Repo = $env:GH_REPO,

    [string]$IssueLabel = "agent:codex-action-needed",

    [ValidateRange(1, 100)]
    [int]$MaxTasks = 10,

    [switch]$ExecuteIssueSeeding,

    [string]$StateDir = "./.github/ai-state",

    [string]$PreviewFile,

    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Help ─────────────────────────────────────────────────────────────────────

if ($Help) {
    @"

seed-and-plan-self-cycle.ps1 — Safe seed-and-plan orchestrator

USAGE
    ./scripts/ai/seed-and-plan-self-cycle.ps1 [options]

OPTIONS
    -Repo <owner/name>      GitHub repo (or GH_REPO env var).
    -IssueLabel <label>     Label for seeded issues / autopilot discovery.
                            Default: agent:codex-action-needed
    -MaxTasks <n>           Cap for both proposal (--max) and AutopilotPlan
                            (-MaxTasks). Default: 10
    -ExecuteIssueSeeding    Create policy-allowed issues on GitHub.
                            Workers are NEVER launched.
    -StateDir <path>        ai-state directory. Default: .github/ai-state
    -PreviewFile <path>     Path for proposal JSON preview.
                            Default: <StateDir>/proposed-issues.preview.json
    -Help                   Show this help.

SAFETY CONTRACT
    - Dry-run by default — no GitHub mutations.
    - Workers are NEVER launched (AutopilotPlan only).
    - PRs are NEVER merged. Issues are NEVER closed.
    - High-risk proposals are blocked by the upstream policy gate.
    - Allowed file scopes are enforced by propose-self-cycle-issues.js.
    - The launch gate is never weakened — blockers are summarised, not bypassed.
    - Every run appends an audit event to
      <StateDir>/issue-seeding-events.ndjson.

EXIT CODES
    0   Preview / plan completed (with or without issues seeded).
    2   Invalid arguments or upstream tool failure.

"@ | Write-Host
    exit 0
}

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step { param([string]$Msg) Write-Host "[seed-plan] $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[    ok  ]  $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[  warn  ]  $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "[  fail  ]  $Msg" -ForegroundColor Red }
function Write-Gate { param([string]$Msg) Write-Host "[  gate  ]  $Msg" -ForegroundColor Magenta }

function Write-Audit {
    param(
        [string]$StateDirPath,
        [hashtable]$Event
    )
    try {
        if (-not (Test-Path $StateDirPath)) {
            New-Item -ItemType Directory -Path $StateDirPath -Force | Out-Null
        }
        $auditFile = Join-Path $StateDirPath "issue-seeding-events.ndjson"
        $entry = [ordered]@{
            schemaVersion = 1
            eventId       = [guid]::NewGuid().ToString()
            recordedAt    = ([DateTime]::UtcNow).ToString("o")
            source        = "seed-and-plan-self-cycle"
        }
        foreach ($k in $Event.Keys) { $entry[$k] = $Event[$k] }
        $line = ($entry | ConvertTo-Json -Compress -Depth 8)
        Add-Content -Path $auditFile -Value $line -Encoding UTF8
    } catch {
        Write-Warn "Audit write failed: $_"
    }
}

# ── Validate inputs ──────────────────────────────────────────────────────────

$scriptDir = $PSScriptRoot
$proposeScript = Join-Path $scriptDir "propose-self-cycle-issues.js"
$writeScript   = Join-Path $scriptDir "write-planned-issues.ps1"
$runCycle      = Join-Path $scriptDir "run-self-cycle.ps1"

foreach ($req in @($proposeScript, $writeScript, $runCycle)) {
    if (-not (Test-Path $req)) {
        Write-Fail "Required script missing: $req"
        exit 2
    }
}

if (-not $Repo) {
    Write-Fail "Repo is required. Pass -Repo OWNER/NAME or set GH_REPO."
    exit 2
}

if (-not $PreviewFile) {
    $PreviewFile = Join-Path $StateDir "proposed-issues.preview.json"
}

$modeLabel = if ($ExecuteIssueSeeding) { "SEED+PLAN" } else { "PREVIEW+PLAN" }
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Seed-and-Plan Self-Cycle [$modeLabel]" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Repo:        $Repo" -ForegroundColor White
Write-Host "  Label:       $IssueLabel" -ForegroundColor White
Write-Host "  MaxTasks:    $MaxTasks" -ForegroundColor White
Write-Host "  StateDir:    $StateDir" -ForegroundColor White
Write-Host "  PreviewFile: $PreviewFile" -ForegroundColor White
Write-Host "  Workers:     NEVER launched (AutopilotPlan only)" -ForegroundColor Yellow
Write-Host ""

Write-Audit -StateDirPath $StateDir -Event @{
    action               = "run-start"
    mode                 = $modeLabel.ToLowerInvariant()
    repo                 = $Repo
    label                = $IssueLabel
    maxTasks             = $MaxTasks
    executeIssueSeeding  = [bool]$ExecuteIssueSeeding
}

# ── STEP 1: propose ──────────────────────────────────────────────────────────

Write-Step "Step 1: propose-self-cycle-issues --stdout --max $MaxTasks"

$proposalJsonText = $null
try {
    $proposalArgs = @(
        $proposeScript,
        "--stdout",
        "--max", "$MaxTasks",
        "--state-dir", $StateDir,
        "--repo", $Repo
    )
    $proposalJsonText = & node @proposalArgs 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "propose-self-cycle-issues.js exited with code $LASTEXITCODE"
        Write-Host $proposalJsonText
        Write-Audit -StateDirPath $StateDir -Event @{
            action = "propose-failed"
            reason = "exit code $LASTEXITCODE"
        }
        exit 2
    }
} catch {
    Write-Fail "propose-self-cycle-issues.js failed: $_"
    Write-Audit -StateDirPath $StateDir -Event @{
        action = "propose-failed"
        reason = "$_"
    }
    exit 2
}

# Parse and save preview
$proposal = $null
try {
    $proposal = $proposalJsonText | ConvertFrom-Json
} catch {
    Write-Fail "Could not parse proposal JSON: $_"
    exit 2
}

# Normalise candidates so they survive StrictMode property access in
# write-planned-issues.ps1. propose-self-cycle-issues.js does not emit
# planner-only fields like sliceRef/sliceStatus/compositeScore; injecting
# explicit nulls keeps the two schemas compatible without touching either
# upstream script.
if ($proposal.candidates) {
    foreach ($cand in $proposal.candidates) {
        foreach ($plannerField in @('sliceRef', 'sliceStatus', 'compositeScore')) {
            if (-not $cand.PSObject.Properties[$plannerField]) {
                $cand | Add-Member -NotePropertyName $plannerField -NotePropertyValue $null -Force
            }
        }
    }
}

$previewDir = Split-Path -Parent $PreviewFile
if ($previewDir -and -not (Test-Path $previewDir)) {
    New-Item -ItemType Directory -Path $previewDir -Force | Out-Null
}
# Re-serialise the normalised proposal so the file on disk matches what
# write-planned-issues will read.
($proposal | ConvertTo-Json -Depth 12) | Set-Content -Path $PreviewFile -Encoding UTF8
Write-Ok "Proposal saved to $PreviewFile"

# Summarise
$totalCapped  = if ($proposal.PSObject.Properties['totalCapped']) { [int]$proposal.totalCapped } else { 0 }
$totalSkipped = if ($proposal.PSObject.Properties['totalSkipped']) { [int]$proposal.totalSkipped } else { 0 }
$candidates   = if ($proposal.candidates) { @($proposal.candidates) } else { @() }

$readyList   = @($candidates | Where-Object { $_.readiness -eq "ready" })
$blockedList = @($candidates | Where-Object { $_.readiness -ne "ready" })

Write-Host ""
Write-Host "  Proposal summary:" -ForegroundColor White
Write-Host "    candidates:           $totalCapped" -ForegroundColor White
Write-Host "    ready (policy ok):    $($readyList.Count)" -ForegroundColor Green
Write-Host "    blocked / human-req:  $($blockedList.Count)" -ForegroundColor Yellow
Write-Host "    duplicates skipped:   $totalSkipped" -ForegroundColor DarkGray
Write-Host ""

if ($candidates.Count -eq 0) {
    Write-Warn "No candidates proposed. Nothing to seed."
}

foreach ($c in $candidates) {
    $tag = if ($c.readiness -eq "ready") { "READY  " } else { "BLOCKED" }
    $color = if ($c.readiness -eq "ready") { "Green" } else { "Yellow" }
    Write-Host "    [$tag] [$($c.risk)] $($c.conflictGroup) — $($c.title)" -ForegroundColor $color
}
Write-Host ""

Write-Audit -StateDirPath $StateDir -Event @{
    action          = "propose-complete"
    totalCapped     = $totalCapped
    totalSkipped    = $totalSkipped
    readyCount      = $readyList.Count
    blockedCount    = $blockedList.Count
    previewFile     = $PreviewFile
}

# ── STEP 2: write-planned-issues (preview or execute) ─────────────────────────

Write-Step "Step 2: write-planned-issues (preview, then optional execute)"

# Always do a dry-run preview first so the operator sees the assembled bodies.
try {
    & pwsh -NoProfile -File $writeScript -PlanFile $PreviewFile -Label $IssueLabel -MaxIssues $MaxTasks 2>&1 | Write-Host
    $previewExit = $LASTEXITCODE
} catch {
    Write-Fail "write-planned-issues preview failed: $_"
    exit 2
}

if ($previewExit -ne 0) {
    Write-Warn "write-planned-issues preview returned exit code $previewExit"
}

$seeded = @()
$seedFailed = @()

if ($ExecuteIssueSeeding) {
    if ($readyList.Count -eq 0) {
        Write-Warn "No ready candidates. Skipping issue creation."
        Write-Audit -StateDirPath $StateDir -Event @{
            action = "seed-skipped"
            reason = "no ready candidates"
        }
    } else {
        Write-Step "Creating $($readyList.Count) policy-allowed issue(s) on $Repo"

        try {
            $execOutput = & pwsh -NoProfile -File $writeScript `
                -PlanFile $PreviewFile `
                -Label $IssueLabel `
                -Repo $Repo `
                -MaxIssues $MaxTasks `
                -Execute 2>&1
            $execExit = $LASTEXITCODE
            $execText = ($execOutput | Out-String)
            Write-Host $execText
        } catch {
            Write-Fail "write-planned-issues -Execute failed: $_"
            Write-Audit -StateDirPath $StateDir -Event @{
                action = "seed-failed"
                reason = "$_"
            }
            exit 2
        }

        if ($execExit -ne 0) {
            Write-Warn "write-planned-issues -Execute exit code $execExit"
        }

        # Extract created issue URLs (gh issue create prints URLs to stdout).
        $urlMatches = [regex]::Matches($execText, 'https?://[^\s]*/issues?/\d+')
        foreach ($m in $urlMatches) { $seeded += $m.Value }

        Write-Audit -StateDirPath $StateDir -Event @{
            action      = "seed-complete"
            createdUrls = $seeded
            exitCode    = $execExit
        }

        Write-Ok "Seeded $($seeded.Count) issue(s)"
    }
} else {
    Write-Warn "ExecuteIssueSeeding not set — no GitHub issues were created."
    Write-Audit -StateDirPath $StateDir -Event @{
        action = "seed-preview-only"
        wouldSeed = $readyList.Count
    }
}

# Audit blocked candidates so the operator has a paper trail of what was held back.
foreach ($b in $blockedList) {
    Write-Audit -StateDirPath $StateDir -Event @{
        action        = "seed-held-back"
        title         = "$($b.title)"
        conflictGroup = "$($b.conflictGroup)"
        risk          = "$($b.risk)"
        readiness     = "$($b.readiness)"
        reason        = "$($b.readinessNote)"
    }
}

# ── STEP 3: AutopilotPlan (never launches workers) ────────────────────────────

Write-Step "Step 3: run-self-cycle.ps1 -AutopilotPlan -IssueLabel $IssueLabel -Repo $Repo -MaxTasks $MaxTasks"
Write-Gate "Workers will NOT be launched. Stopping after AutopilotPlan."

$planOutput  = ""
$planExit    = 0
$launchBlock = $null

try {
    $planOutput = & pwsh -NoProfile -File $runCycle `
        -AutopilotPlan `
        -IssueLabel $IssueLabel `
        -Repo $Repo `
        -MaxTasks $MaxTasks 2>&1 | Out-String
    $planExit = $LASTEXITCODE
} catch {
    Write-Fail "run-self-cycle.ps1 invocation failed: $_"
    Write-Audit -StateDirPath $StateDir -Event @{
        action = "autopilot-failed"
        reason = "$_"
    }
    exit 2
}

Write-Host $planOutput

# Detect launch-gate block (heuristic — works for current run-self-cycle output).
if ($planOutput -match '(?im)^\s*\[gate\]\s+(.*BLOCK.*|.*launch.*block.*)$') {
    $launchBlock = $Matches[1].Trim()
} elseif ($planOutput -match '(?im)launch[- ]?gate.*(?:block|fail|deny|refus)') {
    $launchBlock = ($Matches[0]).Trim()
} elseif ($planOutput -match '(?im)HUMAN DECISION REQUIRED[\s\S]{0,400}') {
    $launchBlock = "HUMAN DECISION REQUIRED reported by run-self-cycle"
}

Write-Audit -StateDirPath $StateDir -Event @{
    action      = "autopilot-complete"
    exitCode    = $planExit
    launchBlock = if ($launchBlock) { $launchBlock } else { $null }
}

# ── Final summary ─────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Seed-and-Plan Summary" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Mode:                $modeLabel" -ForegroundColor White
Write-Host "  Candidates:          $totalCapped (ready=$($readyList.Count), blocked=$($blockedList.Count))" -ForegroundColor White
Write-Host "  Issues seeded:       $($seeded.Count)" -ForegroundColor $(if ($seeded.Count -gt 0) { "Green" } else { "DarkGray" })
Write-Host "  AutopilotPlan exit:  $planExit" -ForegroundColor White
if ($launchBlock) {
    Write-Host "  Launch gate:         BLOCKED — $launchBlock" -ForegroundColor Magenta
} else {
    Write-Host "  Launch gate:         (no explicit block detected)" -ForegroundColor DarkGray
}
Write-Host "  Workers launched:    NO (by design)" -ForegroundColor Green
Write-Host "  Audit:               $StateDir/issue-seeding-events.ndjson" -ForegroundColor White
Write-Host ""

if ($seeded.Count -gt 0) {
    Write-Host "  Seeded issues:" -ForegroundColor Green
    foreach ($u in $seeded) { Write-Host "    $u" -ForegroundColor DarkGray }
    Write-Host ""
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

exit 0
