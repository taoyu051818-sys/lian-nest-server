#Requires -Version 7.0
<#
.SYNOPSIS
    Tests for idempotent worktree setup in batch-launch.ps1.

.DESCRIPTION
    Validates that Ensure-Worktree handles:
    1. Fresh creation (no existing branch or worktree)
    2. Reuse of existing worktree with matching branch
    3. Recovery when branch exists but worktree was deleted
    4. Branch mismatch detection and recreation
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:passed = 0
$script:failed = 0

function Assert {
    param([bool]$Condition, [string]$Name)
    if ($Condition) {
        $script:passed++
        Write-Host "  PASS  $Name" -ForegroundColor Green
    } else {
        $script:failed++
        Write-Host "  FAIL  $Name" -ForegroundColor Red
    }
}

function New-TestRepo {
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) "worktree-idempotency-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Push-Location $dir
    git init -b main 2>&1 | Out-Null
    git config user.email "test@test.com" 2>&1 | Out-Null
    git config user.name "Test" 2>&1 | Out-Null
    # Need an initial commit on main for worktree base
    Set-Content -Path "init.txt" -Value "init"
    git add init.txt 2>&1 | Out-Null
    git commit -m "init" 2>&1 | Out-Null
    Pop-Location
    return $dir
}

function Cleanup-TestRepo([string]$Dir) {
    # Remove all worktrees first
    $list = git -C $Dir worktree list --porcelain 2>$null
    $entries = @()
    $current = @{}
    foreach ($line in @($list)) {
        if ($line -eq "") {
            if ($current.ContainsKey("path")) { $entries += $current }
            $current = @{}
            continue
        }
        if ($line -match "^worktree (.+)$") { $current["path"] = $Matches[1] }
    }
    if ($current.ContainsKey("path")) { $entries += $current }

    $normDir = ($Dir -replace "\\", "/").TrimEnd("/")
    foreach ($e in $entries) {
        $normPath = ($e["path"] -replace "\\", "/").TrimEnd("/")
        if ($normPath -ne $normDir) {
            git -C $Dir worktree remove $e["path"] --force 2>$null | Out-Null
        }
    }
    Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "batch-launch Ensure-Worktree idempotency tests" -ForegroundColor Cyan

# Source the function from batch-launch.ps1
# We extract just the Ensure-Worktree function by reading the file
$batchLaunchPath = Join-Path $PSScriptRoot "batch-launch.ps1"
$batchLines = Get-Content $batchLaunchPath -Encoding UTF8

# Extract the Ensure-Worktree function block using line numbers
$startLine = -1
$endLine = -1
for ($i = 0; $i -lt $batchLines.Count; $i++) {
    if ($batchLines[$i] -match '^\s*function\s+Ensure-Worktree\s*\{') { $startLine = $i }
    if ($startLine -ge 0 -and $i -gt $startLine -and $batchLines[$i] -match '^\s*function\s+\w') {
        $endLine = $i
        break
    }
}
if ($startLine -lt 0 -or $endLine -lt 0) {
    Write-Host "  FAIL  Could not extract Ensure-Worktree function from batch-launch.ps1 (start=$startLine, end=$endLine)" -ForegroundColor Red
    exit 1
}
$funcBlock = ($batchLines[$startLine..($endLine - 1)]) -join "`n"

# Stub the helper functions that Ensure-Worktree calls
function Write-Step($msg) { }
function Write-Ok($msg) { }
function Write-Warn($msg) { }
function Write-Fail($msg) { throw "Write-Fail: $msg" }

# Invoke the function definition
Invoke-Expression $funcBlock

# ── Test 1: Fresh creation ──────────────────────────────────────────────────

$repo1 = New-TestRepo
try {
    Push-Location $repo1
    Ensure-Worktree -BranchName "test/fresh-branch" -WorktreeDir (Join-Path $repo1 ".claude/worktrees/test-fresh")
    $wtPath = Join-Path $repo1 ".claude/worktrees/test-fresh"
    Assert (Test-Path $wtPath) "fresh: worktree directory exists"
    $branchList = git branch --list "test/fresh-branch" 2>$null
    Assert ($branchList -match "test/fresh-branch") "fresh: branch was created"
    Pop-Location
} catch {
    Write-Host "  FAIL  fresh creation: $_" -ForegroundColor Red
    $script:failed++
    Pop-Location
}

# ── Test 2: Reuse existing worktree ─────────────────────────────────────────

$repo2 = New-TestRepo
try {
    Push-Location $repo2
    $wtDir = Join-Path $repo2 ".claude/worktrees/test-reuse"
    # Create worktree first time
    Ensure-Worktree -BranchName "test/reuse-branch" -WorktreeDir $wtDir
    # Create a file to verify it persists
    Set-Content -Path (Join-Path $wtDir "marker.txt") -Value "original"
    # Call again — should reuse
    Ensure-Worktree -BranchName "test/reuse-branch" -WorktreeDir $wtDir
    Assert (Test-Path (Join-Path $wtDir "marker.txt")) "reuse: marker file preserved"
    $markerContent = Get-Content (Join-Path $wtDir "marker.txt") -Raw
    Assert ($markerContent.Trim() -eq "original") "reuse: marker content unchanged"
    Pop-Location
} catch {
    Write-Host "  FAIL  reuse: $_" -ForegroundColor Red
    $script:failed++
    Pop-Location
}

# ── Test 3: Recovery when branch exists but worktree was deleted ─────────────

$repo3 = New-TestRepo
try {
    Push-Location $repo3
    $wtDir = Join-Path $repo3 ".claude/worktrees/test-recover"
    # Create worktree first time
    Ensure-Worktree -BranchName "test/recover-branch" -WorktreeDir $wtDir
    # Simulate stale state: remove worktree directory but keep branch
    Remove-Item $wtDir -Recurse -Force
    git worktree prune 2>$null
    # Branch still exists
    $branchExists = git branch --list "test/recover-branch"
    Assert ($branchExists -match "test/recover-branch") "recover: branch still exists after worktree removal"
    # Call Ensure-Worktree — should recover
    Ensure-Worktree -BranchName "test/recover-branch" -WorktreeDir $wtDir
    Assert (Test-Path $wtDir) "recover: worktree directory recreated"
    Pop-Location
} catch {
    Write-Host "  FAIL  recovery: $_" -ForegroundColor Red
    $script:failed++
    Pop-Location
}

# ── Test 4: Branch mismatch detection ───────────────────────────────────────

$repo4 = New-TestRepo
try {
    Push-Location $repo4
    $wtDir = Join-Path $repo4 ".claude/worktrees/test-mismatch"
    # Create a worktree with one branch
    git worktree add -b "test/old-branch" $wtDir main 2>&1 | Out-Null
    # Call with different branch name — should recreate
    Ensure-Worktree -BranchName "test/new-branch" -WorktreeDir $wtDir
    # Verify the new branch is active
    $head = git -C $wtDir rev-parse --abbrev-ref HEAD 2>$null
    Assert ($head.Trim() -eq "test/new-branch") "mismatch: worktree switched to new branch"
    Pop-Location
} catch {
    Write-Host "  FAIL  mismatch: $_" -ForegroundColor Red
    $script:failed++
    Pop-Location
}

# ── Summary ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Ensure-Worktree tests: $script:passed passed, $script:failed failed" -ForegroundColor $(if ($script:failed -gt 0) { "Red" } else { "Green" })
if ($script:failed -gt 0) { exit 1 }
exit 0
