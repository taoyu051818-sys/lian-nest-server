#Requires -Version 7.0
<#
.SYNOPSIS
    Fixture tests for plan-next-batch create-issues dry-run mode.

.DESCRIPTION
    Validates gap-to-issue proposal mapping, dry-run default enforcement,
    CONTROL APPENDIX body generation, deduplication against existing issues,
    priority ordering, and backward-compatibility defaults — all without
    calling the GitHub API.

    Exit 0 on all-pass, exit 1 on any failure.

.EXAMPLE
    pwsh ./scripts/ai/plan-next-batch.create-issues.test.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$passCount = 0
$failCount = 0
$errors = @()

function Assert-Equal {
    param([string]$Name, $Actual, $Expected)
    if ($Actual -eq $Expected) {
        $script:passCount++
        Write-Host "  PASS  $Name" -ForegroundColor Green
    } else {
        $script:failCount++
        $msg = "  FAIL  $Name — expected '$Expected', got '$Actual'"
        Write-Host $msg -ForegroundColor Red
        $script:errors += $msg
    }
}

function Assert-True {
    param([string]$Name, [bool]$Condition)
    if ($Condition) {
        $script:passCount++
        Write-Host "  PASS  $Name" -ForegroundColor Green
    } else {
        $script:failCount++
        $msg = "  FAIL  $Name"
        Write-Host $msg -ForegroundColor Red
        $script:errors += $msg
    }
}

function Assert-Contains {
    param([string]$Name, [string]$Haystack, [string]$Needle)
    Assert-True $Name ($Haystack -like "*$Needle*")
}

# ── Replicate create-issues proposal functions ──────────────────────────

function New-IssueProposal {
    <#
    .SYNOPSIS
        Builds a proposed issue from a gap/fact entry. Dry-run only — never
        calls gh issue create.
    #>
    param(
        [hashtable]$Gap,
        [hashtable[]]$ExistingIssues = @()
    )

    # Dedup: skip if an existing issue already covers this gap
    $gapKey = $Gap.key
    foreach ($existing in $ExistingIssues) {
        if ($existing.gapKey -eq $gapKey) {
            return $null
        }
    }

    $priority = if ($Gap.ContainsKey('priority') -and $Gap.priority) { $Gap.priority } else { "medium" }
    $priorityRank = switch ($priority) {
        "critical" { 0 }
        "high"     { 1 }
        "medium"   { 2 }
        "low"      { 3 }
        default    { 2 }
    }

    $risk = if ($Gap.ContainsKey('risk') -and $Gap.risk) { $Gap.risk } else { "medium" }
    $conflictGroup = if ($Gap.ContainsKey('conflictGroup') -and $Gap.conflictGroup) { $Gap.conflictGroup } else { "gap-fill" }
    $allowedFiles = @(
        if ($Gap.ContainsKey('allowedFiles') -and $Gap.allowedFiles) { $Gap.allowedFiles } else { "docs/**" }
    )
    $sliceRef = if ($Gap.ContainsKey('sliceRef') -and $Gap.sliceRef) { $Gap.sliceRef } else { $null }

    $title = $Gap.title
    $goal = if ($Gap.ContainsKey('goal') -and $Gap.goal) { $Gap.goal } else { "Address gap: $title" }
    $scope = if ($Gap.ContainsKey('scope') -and $Gap.scope) { $Gap.scope } else { "Auto-generated from gap analysis." }

    # Build CONTROL APPENDIX body
    $body = "## Goal`n$goal`n`n"
    $body += "## Scope`n$scope`n`n"
    $body += "## CONTROL APPENDIX`n"
    $body += "Task type: execution`n"
    $body += "Risk: $risk`n"
    $body += "Conflict group: $conflictGroup`n"
    $body += "Allowed files:`n"
    foreach ($f in $allowedFiles) { $body += "- $f`n" }
    $body += "Validation commands:`n- npm run check`n- npm run build`n"
    if ($sliceRef) { $body += "Slice: $sliceRef`n" }
    $body += "Mode: dry-run`n"

    return [ordered]@{
        title          = $title
        body           = $body
        priority       = $priority
        priorityRank   = $priorityRank
        risk           = $risk
        conflictGroup  = $conflictGroup
        allowedFiles   = @($allowedFiles)
        gapKey         = $gapKey
        sliceRef       = $sliceRef
        dryRun         = $true
    }
}

function Get-CreateIssuesMode {
    <#
    .SYNOPSIS
        Determines the operational mode. Defaults to dry-run unless explicitly
        overridden with -Write.
    #>
    param([switch]$Write)

    if ($Write) {
        return "write"
    }
    return "dry-run"
}

# ── Fixture definitions ─────────────────────────────────────────────────

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Create-Issues Dry-Run Fixture Tests" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── Fixture 1: Basic gap-to-issue mapping ───────────────────────────────

Write-Host "── Fixture 1: Basic gap-to-issue proposal ──" -ForegroundColor Yellow

$gap1 = @{
    key           = "missing-parity-test-auth"
    title         = "Add parity test for auth slice A3"
    goal          = "Ensure auth slice A3 has parity coverage"
    scope         = "test/parity/auth/"
    priority      = "high"
    risk          = "medium"
    conflictGroup = "auth-slice"
    allowedFiles  = @("test/parity/auth/**")
    sliceRef      = "A3"
}

$proposal1 = New-IssueProposal -Gap $gap1
Assert-True "proposal is not null" ($null -ne $proposal1)
Assert-Equal "title" $proposal1.title "Add parity test for auth slice A3"
Assert-Equal "priority" $proposal1.priority "high"
Assert-Equal "priorityRank" $proposal1.priorityRank 1
Assert-Equal "risk" $proposal1.risk "medium"
Assert-Equal "conflictGroup" $proposal1.conflictGroup "auth-slice"
Assert-Equal "gapKey" $proposal1.gapKey "missing-parity-test-auth"
Assert-Equal "sliceRef" $proposal1.sliceRef "A3"
Assert-True "dryRun is true" $proposal1.dryRun
Assert-Contains "body has goal" $proposal1.body "Ensure auth slice A3 has parity coverage"
Assert-Contains "body has CONTROL APPENDIX" $proposal1.body "## CONTROL APPENDIX"
Assert-Contains "body has dry-run mode" $proposal1.body "Mode: dry-run"

Write-Host ""

# ── Fixture 2: Dry-run default enforcement ──────────────────────────────

Write-Host "── Fixture 2: Dry-run is default mode ──" -ForegroundColor Yellow

$modeDefault = Get-CreateIssuesMode
$modeExplicitWrite = Get-CreateIssuesMode -Write

Assert-Equal "default mode is dry-run" $modeDefault "dry-run"
Assert-Equal "explicit write mode" $modeExplicitWrite "write"

# Verify every proposal defaults to dryRun=true
Assert-True "proposal defaults to dryRun" $proposal1.dryRun

# Verify a minimal gap also gets dry-run
$gapMinimal = @{ key = "minimal"; title = "Minimal gap" }
$proposalMinimal = New-IssueProposal -Gap $gapMinimal
Assert-True "minimal proposal dryRun" $proposalMinimal.dryRun
Assert-Contains "minimal body has dry-run" $proposalMinimal.body "Mode: dry-run"

Write-Host ""

# ── Fixture 3: Deduplication against existing issues ────────────────────

Write-Host "── Fixture 3: Deduplication ──" -ForegroundColor Yellow

$existingIssues = @(
    @{ gapKey = "missing-parity-test-auth"; number = 500 }
    @{ gapKey = "stale-row-runtime"; number = 501 }
)

# This gap matches an existing issue — should be deduplicated
$proposalDup = New-IssueProposal -Gap $gap1 -ExistingIssues $existingIssues
Assert-True "duplicate is null" ($null -eq $proposalDup)

# This gap is new — should produce a proposal
$gapNew = @{
    key   = "missing-parity-test-cache"
    title = "Add parity test for cache slice B2"
}
$proposalNew = New-IssueProposal -Gap $gapNew -ExistingIssues $existingIssues
Assert-True "new gap produces proposal" ($null -ne $proposalNew)
Assert-Equal "new gap key" $proposalNew.gapKey "missing-parity-test-cache"

Write-Host ""

# ── Fixture 4: Priority ordering ────────────────────────────────────────

Write-Host "── Fixture 4: Priority rank ordering ──" -ForegroundColor Yellow

$gapCrit = @{ key = "crit"; title = "Critical gap"; priority = "critical" }
$gapHigh = @{ key = "high"; title = "High gap"; priority = "high" }
$gapMed  = @{ key = "med"; title = "Medium gap"; priority = "medium" }
$gapLow  = @{ key = "low"; title = "Low gap"; priority = "low" }
$gapDef  = @{ key = "def"; title = "Default gap" }

$pCrit = New-IssueProposal -Gap $gapCrit
$pHigh = New-IssueProposal -Gap $gapHigh
$pMed  = New-IssueProposal -Gap $gapMed
$pLow  = New-IssueProposal -Gap $gapLow
$pDef  = New-IssueProposal -Gap $gapDef

Assert-Equal "critical rank" $pCrit.priorityRank 0
Assert-Equal "high rank" $pHigh.priorityRank 1
Assert-Equal "medium rank" $pMed.priorityRank 2
Assert-Equal "low rank" $pLow.priorityRank 3
Assert-Equal "default rank" $pDef.priorityRank 2

$allProposals = @($pCrit, $pHigh, $pMed, $pLow, $pDef)
$sorted = @($allProposals | Sort-Object -Property @{ Expression = { $_.priorityRank } })

Assert-Equal "sorted first is critical" $sorted[0].priority "critical"
Assert-Equal "sorted second is high" $sorted[1].priority "high"
Assert-Equal "sorted last is low" $sorted[4].priority "low"

Write-Host ""

# ── Fixture 5: Default field population ─────────────────────────────────

Write-Host "── Fixture 5: Defaults for minimal gaps ──" -ForegroundColor Yellow

$gapBare = @{ key = "bare-gap"; title = "Bare gap entry" }
$pBare = New-IssueProposal -Gap $gapBare

Assert-Equal "default priority" $pBare.priority "medium"
Assert-Equal "default risk" $pBare.risk "medium"
Assert-Equal "default conflictGroup" $pBare.conflictGroup "gap-fill"
Assert-Equal "default allowedFiles count" $pBare.allowedFiles.Count 1
Assert-Equal "default allowedFiles[0]" $pBare.allowedFiles[0] "docs/**"
Assert-True "no sliceRef" ($null -eq $pBare.sliceRef)
Assert-Contains "body has default goal" $pBare.body "Address gap: Bare gap entry"
Assert-Contains "body has npm run check" $pBare.body "npm run check"
Assert-Contains "body has npm run build" $pBare.body "npm run build"

Write-Host ""

# ── Fixture 6: CONTROL APPENDIX body structure ──────────────────────────

Write-Host "── Fixture 6: CONTROL APPENDIX body structure ──" -ForegroundColor Yellow

$gapFull = @{
    key           = "full-gap"
    title         = "Full config gap"
    goal          = "Fix the thing"
    scope         = "src/modules/thing/**"
    priority      = "low"
    risk          = "high"
    conflictGroup = "thing-module"
    allowedFiles  = @("src/modules/thing/**", "test/parity/thing/**")
    sliceRef      = "C1"
}
$pFull = New-IssueProposal -Gap $gapFull

Assert-Contains "has Goal header" $pFull.body "## Goal"
Assert-Contains "has goal text" $pFull.body "Fix the thing"
Assert-Contains "has Scope header" $pFull.body "## Scope"
Assert-Contains "has scope text" $pFull.body "src/modules/thing/**"
Assert-Contains "has Task type" $pFull.body "Task type: execution"
Assert-Contains "has Risk" $pFull.body "Risk: high"
Assert-Contains "has Conflict group" $pFull.body "Conflict group: thing-module"
Assert-Contains "has Allowed files" $pFull.body "Allowed files:"
Assert-Contains "has first file" $pFull.body "- src/modules/thing/**"
Assert-Contains "has second file" $pFull.body "- test/parity/thing/**"
Assert-Contains "has Slice" $pFull.body "Slice: C1"
Assert-Contains "has Mode" $pFull.body "Mode: dry-run"

Write-Host ""

# ── Fixture 7: No sliceRef in body when absent ──────────────────────────

Write-Host "── Fixture 7: Slice line omitted when no sliceRef ──" -ForegroundColor Yellow

$gapNoSlice = @{ key = "no-slice"; title = "No slice gap" }
$pNoSlice = New-IssueProposal -Gap $gapNoSlice

Assert-True "no Slice in body" (-not ($pNoSlice.body -like "*Slice:*"))
Assert-True "sliceRef is null" ($null -eq $pNoSlice.sliceRef)

Write-Host ""

# ── Fixture 8: Fixture file round-trip ──────────────────────────────────

Write-Host "── Fixture 8: Proposal file round-trip ──" -ForegroundColor Yellow

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "create-issues-test-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

$proposalPath = Join-Path $tmpDir "proposed-issues.json"
$proposals = @(
    (New-IssueProposal -Gap @{ key = "g1"; title = "Gap 1"; priority = "high" })
    (New-IssueProposal -Gap @{ key = "g2"; title = "Gap 2"; priority = "low" })
)
$proposals | ConvertTo-Json -Depth 5 | Set-Content -Path $proposalPath -Encoding UTF8

$loaded = Get-Content $proposalPath -Raw | ConvertFrom-Json
Assert-Equal "round-trip count" $loaded.Count 2
Assert-Equal "round-trip first title" $loaded[0].title "Gap 1"
Assert-Equal "round-trip first priority" $loaded[0].priority "high"
Assert-Equal "round-trip second title" $loaded[1].title "Gap 2"
Assert-True "round-trip dryRun[0]" $loaded[0].dryRun
Assert-True "round-trip dryRun[1]" $loaded[1].dryRun

Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""

# ── Fixture 9: Multiple gaps with mixed dedup ───────────────────────────

Write-Host "── Fixture 9: Mixed dedup across multiple gaps ──" -ForegroundColor Yellow

$gaps = @(
    @{ key = "dup-a"; title = "Duplicate A" }
    @{ key = "new-a"; title = "New A" }
    @{ key = "dup-b"; title = "Duplicate B" }
    @{ key = "new-b"; title = "New B" }
)

$existing = @(
    @{ gapKey = "dup-a"; number = 600 }
    @{ gapKey = "dup-b"; number = 601 }
)

$results = @()
foreach ($g in $gaps) {
    $p = New-IssueProposal -Gap $g -ExistingIssues $existing
    if ($null -ne $p) { $results += $p }
}

Assert-Equal "non-deduped count" $results.Count 2
Assert-Equal "first non-deduped" $results[0].title "New A"
Assert-Equal "second non-deduped" $results[1].title "New B"

Write-Host ""

# ── Summary ─────────────────────────────────────────────────────────────

Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
$total = $passCount + $failCount
Write-Host "  Results: $passCount/$total passed" -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Red" })
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

if ($failCount -gt 0) {
    Write-Host "Failures:" -ForegroundColor Red
    foreach ($e in $errors) { Write-Host $e -ForegroundColor Red }
    exit 1
}

exit 0
