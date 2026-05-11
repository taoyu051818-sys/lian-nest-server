#Requires -Version 7.0
<#
.SYNOPSIS
    Fixture-based tests for worktree-janitor launch-lock awareness.

.DESCRIPTION
    Validates that worktree-janitor.ps1 correctly reads launch lock fixtures
    and classifies worktrees as "locked" when an active (non-expired) lock
    matches their branch. Also tests graceful degradation for missing or
    corrupt lock files.

    Uses temp git repos with real worktrees and fixture lock JSON files.

.EXAMPLE
    pwsh ./scripts/ai/worktree-janitor.launch-locks.test.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$passed = 0
$failed = 0
$failures = [System.Collections.Generic.List[string]]::new()

function Assert {
    param([bool]$Condition, [string]$Message)
    if ($Condition) {
        $script:passed++
    } else {
        $script:failed++
        $script:failures.Add($Message)
        Write-Host "  FAIL: $Message" -ForegroundColor Red
    }
}

# Run the janitor as a child pwsh process so ALL output streams (including
# Write-Host / Information stream) are captured via *>.
function Invoke-Janitor {
    param([string]$ScriptPath, [string]$LocksPath, [switch]$DryRun)

    $outFile = [System.IO.Path]::GetTempFileName()
    try {
        $cmd = "& `"$ScriptPath`" -LaunchLocksPath `"$LocksPath`""
        if ($DryRun) { $cmd += " -DryRun" }
        # *> redirects ALL streams (stdout, stderr, information/Write-Host) to file
        pwsh -NoProfile -Command "$cmd *> `"$outFile`""
        $text = Get-Content $outFile -Raw -Encoding UTF8
        if ($null -eq $text) { $text = "" }
        return $text
    } finally {
        Remove-Item $outFile -ErrorAction SilentlyContinue
    }
}

# Strip ANSI escape codes from captured output for reliable matching
function Strip-Ansi($Text) {
    return ($Text -replace '\x1b\[[0-9;]*m', '')
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "../..")).Path
$janitorScript = (Resolve-Path (Join-Path $scriptDir "worktree-janitor.ps1")).Path

Write-Host "worktree-janitor launch-lock fixture tests" -ForegroundColor Cyan
Write-Host ""

# ── Fixture path ──────────────────────────────────────────────────────────────

$fixturesDir = Join-Path $repoRoot "scripts/ai/__fixtures__/launch-locks"

# ── Schema validation for fixture files ───────────────────────────────────────

Write-Host "fixture schema validation"

# Valid fixture
$validPath = Join-Path $fixturesDir "valid-active.json"
$validJson = Get-Content $validPath -Raw | ConvertFrom-Json
Assert ($validJson.markerVersion -eq 1) "valid fixture has markerVersion=1"
Assert ($validJson.locks.Count -eq 1) "valid fixture has 1 lock entry"
$validLock = $validJson.locks[0]
Assert ($validLock.ownerTask.branch -eq "claude/issue-400-control-fixtures") "valid lock branch matches expected"
Assert ($validLock.conflictGroup -eq "control-worktree-fixtures") "valid lock conflictGroup matches"
Assert ($validLock.ownerTask.issue -eq 400) "valid lock issue number matches"
$expiresAt = [DateTime]::Parse($validLock.expiresAt)
Assert ($expiresAt -gt (Get-Date)) "valid lock expiresAt is in the future"

# Mixed fixture
$mixedPath = Join-Path $fixturesDir "mixed-active-expired.json"
$mixedJson = Get-Content $mixedPath -Raw | ConvertFrom-Json
Assert ($mixedJson.locks.Count -eq 2) "mixed fixture has 2 lock entries"
$lock0 = $mixedJson.locks[0]
$lock1 = $mixedJson.locks[1]
Assert ($lock0.ownerTask.issue -eq 400) "mixed fixture first lock is issue 400"
Assert ($lock1.ownerTask.issue -eq 401) "mixed fixture second lock is issue 401"
$expires0 = [DateTime]::Parse($lock0.expiresAt)
$expires1 = [DateTime]::Parse($lock1.expiresAt)
Assert ($expires0 -gt (Get-Date)) "mixed fixture issue-400 lock is active"
Assert ($expires1 -lt (Get-Date)) "mixed fixture issue-401 lock is expired"

# Empty fixture
$emptyPath = Join-Path $fixturesDir "empty-locks.json"
$emptyJson = Get-Content $emptyPath -Raw | ConvertFrom-Json
Assert ($emptyJson.locks.Count -eq 0) "empty fixture has no lock entries"

Write-Host ""

# ── Set up temp git repo with worktrees ──────────────────────────────────────

Write-Host "setting up temp git repo"

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "janitor-lock-test-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
$tmpRepo = Join-Path $tmpRoot "repo"
$tmpFixtures = Join-Path $tmpRoot "fixtures"
New-Item -ItemType Directory -Path $tmpFixtures -Force | Out-Null

$origDir = Get-Location

# Branch names used by test worktrees (must match fixture lock entries)
$branchA = "claude/issue-400-control-fixtures"
$branchB = "claude/issue-401-expired-fixtures"
$branchC = "claude/issue-402-unlocked"

try {
    # Create a repo with "main" as default branch
    New-Item -ItemType Directory -Path $tmpRepo -Force | Out-Null
    Set-Location $tmpRepo
    git init 2>&1 | Out-Null
    git branch -M main 2>&1 | Out-Null
    git config user.email "test@test.local"
    git config user.name "Test"

    # Step 1: Initial commit on main
    "seed" | Set-Content (Join-Path $tmpRepo "seed.txt")
    git add seed.txt 2>&1 | Out-Null
    git commit -m "init" 2>&1 | Out-Null

    # Step 2: Create worktree branches from main HEAD (commit A)
    $wtAPath = Join-Path $tmpRoot "wt-a"
    git worktree add $wtAPath -b $branchA 2>&1 | Out-Null
    git -C $wtAPath config user.email "test@test.local"
    git -C $wtAPath config user.name "Test"

    $wtBPath = Join-Path $tmpRoot "wt-b"
    git worktree add $wtBPath -b $branchB 2>&1 | Out-Null
    git -C $wtBPath config user.email "test@test.local"
    git -C $wtBPath config user.name "Test"

    $wtCPath = Join-Path $tmpRoot "wt-c"
    git worktree add $wtCPath -b $branchC 2>&1 | Out-Null
    git -C $wtCPath config user.email "test@test.local"
    git -C $wtCPath config user.name "Test"

    # Step 3: Commit on main AFTER creating worktree branches.
    # This makes main diverge, so the worktree branches are NOT merged.
    "diverge" | Set-Content (Join-Path $tmpRepo "diverge.txt")
    git add diverge.txt 2>&1 | Out-Null
    git commit -m "main diverges" 2>&1 | Out-Null

    $wtCount = (git worktree list 2>&1).Count
    Assert ($wtCount -ge 4) "temp repo has main + 3 worktrees (got $wtCount)"

    Write-Host ""

    # ── Helper to create fixture in temp dir ──────────────────────────────────

    function Write-Fixture($Name, $Content) {
        $p = Join-Path $tmpFixtures $Name
        $Content | Set-Content $p -Encoding UTF8
        return $p
    }

    # ── Test 1: Valid fixture with active lock ────────────────────────────────

    Write-Host "test: valid-active fixture — locked worktree protected"
    $json = Get-Content $validPath -Raw
    $f1 = Write-Fixture "valid-active.json" $json
    $raw1 = Invoke-Janitor $janitorScript $f1 -DryRun
    $out1 = Strip-Ansi $raw1

    Assert ($out1.Contains("LOCKED")) "report contains LOCKED"
    Assert ($out1.Contains("issue-400-control-fixtures")) "report mentions locked branch"
    Assert ($out1.Contains("issue#400")) "report shows lock issue number"
    Assert ($out1.Contains("control-worktree-fixtures")) "report shows lock conflict group"
    Assert ($out1.Contains("1 locked")) "summary contains 1 locked"
    Assert ($out1.Contains("Loaded 1 launch lock")) "loaded 1 lock"
    Assert ($out1.Contains("1 active")) "reports 1 active lock"
    Assert ($out1.Contains("DRY RUN")) "runs in dry-run mode"
    Write-Host "  PASS: locked worktree correctly protected by active lock" -ForegroundColor Green
    Write-Host ""

    # ── Test 2: Mixed active + expired fixture ────────────────────────────────

    Write-Host "test: mixed-active-expired fixture — only active lock protects"
    $json2 = Get-Content $mixedPath -Raw
    $f2 = Write-Fixture "mixed.json" $json2
    $raw2 = Invoke-Janitor $janitorScript $f2 -DryRun
    $out2 = Strip-Ansi $raw2

    Assert ($out2.Contains("LOCKED")) "report contains LOCKED for active lock"
    Assert ($out2.Contains("issue-400-control-fixtures")) "active lock branch is locked"
    Assert ($out2.Contains("Loaded 2 launch lock")) "loaded 2 locks"
    Assert ($out2.Contains("1 active")) "reports 1 active (1 expired)"
    # Expired lock branch should appear but NOT be classified as LOCKED
    Assert ($out2.Contains("issue-401-expired-fixtures")) "expired branch appears in report"
    Write-Host "  PASS: expired lock does not protect; active lock does" -ForegroundColor Green
    Write-Host ""

    # ── Test 3: Empty locks fixture ───────────────────────────────────────────

    Write-Host "test: empty-locks fixture — no locked worktrees"
    $json3 = Get-Content $emptyPath -Raw
    $f3 = Write-Fixture "empty.json" $json3
    $raw3 = Invoke-Janitor $janitorScript $f3 -DryRun
    $out3 = Strip-Ansi $raw3

    Assert (-not $out3.Contains("LOCKED")) "no LOCKED in report with empty locks"
    Assert ($out3.Contains("Loaded 0 launch lock")) "loaded 0 locks"
    Assert ($out3.Contains("ACTIVE")) "all worktrees classified as ACTIVE"
    Write-Host "  PASS: empty locks — no worktrees locked" -ForegroundColor Green
    Write-Host ""

    # ── Test 4: Missing locks file ────────────────────────────────────────────

    Write-Host "test: missing locks file — graceful degradation"
    $missingPath = Join-Path $tmpFixtures "nonexistent-locks.json"
    $raw4 = Invoke-Janitor $janitorScript $missingPath -DryRun
    $out4 = Strip-Ansi $raw4

    Assert ($out4.Contains("lock awareness disabled")) "warns about disabled lock awareness"
    Assert (-not $out4.Contains("LOCKED")) "no LOCKED status without locks file"
    Assert ($out4.Contains("ACTIVE")) "all worktrees classified as ACTIVE"
    Write-Host "  PASS: missing locks file — graceful degradation" -ForegroundColor Green
    Write-Host ""

    # ── Test 5: Corrupt locks file ────────────────────────────────────────────

    Write-Host "test: corrupt locks file — graceful degradation"
    $f5 = Write-Fixture "corrupt.json" "{not valid json !!!"
    $raw5 = Invoke-Janitor $janitorScript $f5 -DryRun
    $out5 = Strip-Ansi $raw5

    Assert ($out5.Contains("Could not parse")) "warns about unparseable file"
    Assert ($out5.Contains("lock awareness disabled")) "reports lock awareness disabled"
    Assert (-not $out5.Contains("LOCKED")) "no LOCKED status with corrupt file"
    Write-Host "  PASS: corrupt locks file — graceful degradation" -ForegroundColor Green
    Write-Host ""

} finally {
    # ── Cleanup ───────────────────────────────────────────────────────────────

    Set-Location $origDir

    # Remove worktrees first (must be done before deleting the repo)
    foreach ($wtPath in @($wtAPath, $wtBPath, $wtCPath)) {
        if ($wtPath -and (Test-Path $wtPath)) {
            git -C $tmpRepo worktree remove --force $wtPath 2>&1 | Out-Null
        }
    }
    # Remove test branches
    foreach ($branch in @($branchA, $branchB, $branchC)) {
        git -C $tmpRepo branch -D $branch 2>&1 | Out-Null
    }

    # Remove temp directory
    Remove-Item -Path $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Results ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host ("=" * 50)
Write-Host "Results: $passed passed, $failed failed"

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Failures:" -ForegroundColor Red
    foreach ($f in $failures) {
        Write-Host "  - $f"
    }
    exit 1
} else {
    Write-Host "All tests passed." -ForegroundColor Green
    exit 0
}
