#Requires -Version 7.0
<#
.SYNOPSIS
    Fixture tests for plan-next-batch.ps1 meta-signals ranking logic.

.DESCRIPTION
    Validates composite score calculation, pain-keyword demotion, and
    backward-compatibility defaults without calling the GitHub API.

    Exit 0 on all-pass, exit 1 on any failure.

.EXAMPLE
    pwsh ./scripts/ai/plan-next-batch.meta-signals.test.ps1
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

# ── Replicate planner ranking functions ──────────────────────────────────

function Get-CompositeScore {
    param([string]$Risk, [int]$Trust)
    $riskRank = switch ($Risk) { "low" { 0 } "medium" { 1 } "high" { 2 } }
    $trustPenalty = [math]::Round((100 - $Trust) / 50, 2)
    return [math]::Round($riskRank + $trustPenalty, 2)
}

function Test-PainMatch {
    param([string]$ConflictGroup, [string]$Title, [string[]]$PainKeywords)
    $text = "$ConflictGroup $Title".ToLower()
    foreach ($kw in $PainKeywords) {
        if ($text.Contains($kw.ToLower())) { return $true }
    }
    return $false
}

# ── Fixture definitions ─────────────────────────────────────────────────

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Meta-Signals Fixture Tests" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── Fixture 1: Full trust, no pain ──────────────────────────────────────

Write-Host "── Fixture 1: Full trust (100), no pain ──" -ForegroundColor Yellow

$f1 = [ordered]@{
    snapshotVersion = 1
    signals = [ordered]@{
        failureScore = 0
        frictionScore = 0
        riskScore = 0
        cost = 0
        trust = 100
        topPain = "none"
    }
}

Assert-Equal "low-risk score" (Get-CompositeScore "low" $f1.signals.trust) 0
Assert-Equal "medium-risk score" (Get-CompositeScore "medium" $f1.signals.trust) 1
Assert-Equal "high-risk score" (Get-CompositeScore "high" $f1.signals.trust) 2

Write-Host ""

# ── Fixture 2: Zero trust ───────────────────────────────────────────────

Write-Host "── Fixture 2: Zero trust (0), no pain ──" -ForegroundColor Yellow

$f2 = [ordered]@{
    snapshotVersion = 1
    signals = [ordered]@{
        failureScore = 100
        frictionScore = 100
        riskScore = 50
        cost = 200
        trust = 0
        topPain = "none"
    }
}

Assert-Equal "low-risk + zero trust" (Get-CompositeScore "low" $f2.signals.trust) 2
Assert-Equal "medium-risk + zero trust" (Get-CompositeScore "medium" $f2.signals.trust) 3
Assert-Equal "high-risk + zero trust" (Get-CompositeScore "high" $f2.signals.trust) 4

Write-Host ""

# ── Fixture 3: Mid trust with pain ──────────────────────────────────────

Write-Host "── Fixture 3: Mid trust (55), topPain: 'runtime compile' ──" -ForegroundColor Yellow

$f3 = [ordered]@{
    snapshotVersion = 1
    signals = [ordered]@{
        failureScore = 45
        frictionScore = 30
        riskScore = 20
        cost = 12
        trust = 55
        topPain = "runtime compile"
    }
}

$trust55 = $f3.signals.trust
Assert-Equal "low-risk + mid trust" (Get-CompositeScore "low" $trust55) 0.9
Assert-Equal "medium-risk + mid trust" (Get-CompositeScore "medium" $trust55) 1.9
Assert-Equal "high-risk + mid trust" (Get-CompositeScore "high" $trust55) 2.9

$painKw3 = @($f3.signals.topPain -split '[\s/]+') | Where-Object { $_.Length -gt 0 }
Assert-Equal "pain keyword count" $painKw3.Count 2
Assert-Equal "pain keyword 1" $painKw3[0] "runtime"
Assert-Equal "pain keyword 2" $painKw3[1] "compile"
Assert-True "runtime conflict matches pain" (Test-PainMatch "runtime-compile" "Fix runtime guard" $painKw3)
Assert-True "compile in title matches pain" (Test-PainMatch "tool-planner" "Fix compile error" $painKw3)
Assert-True "no match for unrelated task" (-not (Test-PainMatch "auth-slice" "Add JWT validation" $painKw3))

Write-Host ""

# ── Fixture 4: Slash-separated pain ─────────────────────────────────────

Write-Host "── Fixture 4: Slash-separated pain keywords ──" -ForegroundColor Yellow

$f4Pain = "dependency/generate"
$painKw4 = @($f4Pain -split '[\s/]+') | Where-Object { $_.Length -gt 0 }
Assert-Equal "slash keyword count" $painKw4.Count 2
Assert-Equal "slash kw 1" $painKw4[0] "dependency"
Assert-Equal "slash kw 2" $painKw4[1] "generate"
Assert-True "dependency conflict matches" (Test-PainMatch "dependency-guard" "Fix guard" $painKw4)
Assert-True "generate in title matches" (Test-PainMatch "codegen" "Regenerate types" $painKw4)

Write-Host ""

# ── Fixture 5: Missing / unparseable signals (backward compat) ──────────

Write-Host "── Fixture 5: Missing signals (backward compat defaults) ──" -ForegroundColor Yellow

$nullSignals = $null
$trustDefault = if ($nullSignals -and $nullSignals.signals) { [int]$nullSignals.signals.trust } else { 100 }
$painDefault = if ($nullSignals -and $nullSignals.signals) { $nullSignals.signals.topPain } else { "none" }

Assert-Equal "default trust" $trustDefault 100
Assert-Equal "default topPain" $painDefault "none"
Assert-Equal "default low-risk composite" (Get-CompositeScore "low" $trustDefault) 0
Assert-Equal "default medium-risk composite" (Get-CompositeScore "medium" $trustDefault) 1
Assert-Equal "default high-risk composite" (Get-CompositeScore "high" $trustDefault) 2

$nullPainKw = @()
Assert-True "no pain demotion when null" (-not (Test-PainMatch "runtime-compile" "Fix compile" $nullPainKw))

Write-Host ""

# ── Fixture 6: Fixture file round-trip ──────────────────────────────────

Write-Host "── Fixture 6: Fixture file write/read round-trip ──" -ForegroundColor Yellow

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "planner-meta-test-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

$fixturePath = Join-Path $tmpDir "meta-signals.json"
$f3 | ConvertTo-Json -Depth 5 | Set-Content -Path $fixturePath -Encoding UTF8

$loaded = Get-Content $fixturePath -Raw | ConvertFrom-Json
Assert-Equal "round-trip trust" $loaded.signals.trust 55
Assert-Equal "round-trip topPain" $loaded.signals.topPain "runtime compile"
Assert-Equal "round-trip failureScore" $loaded.signals.failureScore 45

Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""

# ── Fixture 7: Sort stability — same composite, different issue numbers ──

Write-Host "── Fixture 7: Sort stability (tiebreaker by issue number) ──" -ForegroundColor Yellow

$candidates = @(
    @{ issueNumber = 400; readiness = "ready"; compositeScore = 1.9; conflictGroup = "auth"; title = "Task A" }
    @{ issueNumber = 200; readiness = "ready"; compositeScore = 1.9; conflictGroup = "auth"; title = "Task B" }
    @{ issueNumber = 300; readiness = "ready"; compositeScore = 1.9; conflictGroup = "auth"; title = "Task C" }
)

$sorted = @($candidates | Sort-Object -Property @{ Expression = { $_.compositeScore } }, @{ Expression = { $_.issueNumber } })
Assert-Equal "first by issue number" $sorted[0].issueNumber 200
Assert-Equal "second by issue number" $sorted[1].issueNumber 300
Assert-Equal "third by issue number" $sorted[2].issueNumber 400

Write-Host ""

# ── Fixture 8: Ready-before-blocked ordering ────────────────────────────

Write-Host "── Fixture 8: Ready-before-blocked ordering ──" -ForegroundColor Yellow

$mixed = @(
    @{ issueNumber = 100; readiness = "blocked"; compositeScore = 0 }
    @{ issueNumber = 101; readiness = "ready"; compositeScore = 2 }
    @{ issueNumber = 102; readiness = "ready"; compositeScore = 0 }
)

$sortedMixed = @($mixed | Sort-Object -Property @{
    Expression = { if ($_.readiness -eq "ready") { 0 } else { 1 } }
}, @{
    Expression = { $_.compositeScore }
})

Assert-Equal "ready comes first" $sortedMixed[0].readiness "ready"
Assert-Equal "blocked comes last" $sortedMixed[2].readiness "blocked"

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
