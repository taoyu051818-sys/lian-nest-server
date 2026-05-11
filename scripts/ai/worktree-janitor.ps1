#Requires -Version 7.0
<#
.SYNOPSIS
    Dry-run janitor for stale Claude worktrees.

.DESCRIPTION
    Scans all git worktrees (excluding the main worktree) and classifies each as:
      - merged   — branch is fully merged into main; safe to remove
      - dirty    — has uncommitted changes; do NOT remove
      - stale    — unmerged but no commits in the last 14 days
      - active   — unmerged with recent commits

    Default mode is dry-run: prints a classification report with no side effects.

    Use -RemoveMerged to actually remove worktrees whose branches are fully
    merged into main. This is the ONLY removal path and never touches dirty
    or stale worktrees.

.PARAMETER WorktreeRoot
    Optional filter — only scan worktrees under this directory path.
    When empty (default), all non-main worktrees are scanned.

.PARAMETER StaleDays
    Number of days without a commit before a worktree is classified as stale.
    Defaults to 14.

.PARAMETER RemoveMerged
    Remove worktrees whose branches are fully merged into main. Without this
    switch the script is always dry-run.

.EXAMPLE
    # Dry-run report
    ./scripts/ai/worktree-janitor.ps1

.EXAMPLE
    # Remove merged worktrees only
    ./scripts/ai/worktree-janitor.ps1 -RemoveMerged

.EXAMPLE
    # Custom stale threshold
    ./scripts/ai/worktree-janitor.ps1 -StaleDays 7
#>

[CmdletBinding()]
param(
    [string]$WorktreeRoot = "",
    [int]$StaleDays = 14,
    [switch]$RemoveMerged
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($msg) { Write-Host "[step] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[ok]   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[warn] $msg" -ForegroundColor Yellow }
function Write-Info($msg) { Write-Host "[info] $msg" -ForegroundColor Gray }

# ── Discover worktrees via porcelain format ──────────────────────────────────

Write-Step "Scanning git worktrees"

$porcelain = git worktree list --porcelain 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[fail] Could not list worktrees" -ForegroundColor Red
    exit 2
}

# Parse porcelain output into worktree records
$worktrees = @()
$entry = @{}

foreach ($line in $porcelain) {
    if ($line -eq "") {
        # Blank line separates entries
        if ($entry.ContainsKey("path")) {
            $worktrees += [PSCustomObject]$entry
        }
        $entry = @{}
        continue
    }

    if ($line -match "^worktree (.+)$") {
        $entry["path"] = $Matches[1]
    } elseif ($line -match "^HEAD (.+)$") {
        $entry["head"] = $Matches[1]
    } elseif ($line -match "^branch (.+)$") {
        $entry["branch"] = $Matches[1]
    }
}

# Flush last entry
if ($entry.ContainsKey("path")) {
    $worktrees += [PSCustomObject]$entry
}

if ($worktrees.Count -eq 0) {
    Write-Ok "No worktrees found."
    exit 0
}

Write-Info "Found $($worktrees.Count) worktree(s)"

# ── Resolve main HEAD for merge comparison ───────────────────────────────────

$mainHead = (git rev-parse main 2>$null).Trim()
if (-not $mainHead) {
    Write-Host "[fail] Could not resolve main HEAD" -ForegroundColor Red
    exit 2
}

# ── Classify each worktree ───────────────────────────────────────────────────

$results = @()
$now = Get-Date

# Resolve repo root to identify the main worktree
$repoRoot = (git rev-parse --show-toplevel 2>$null).Trim() -replace "\\", "/"

foreach ($wt in $worktrees) {
    $path = $wt.path
    $branch = $wt.branch

    # Skip worktrees without a branch (bare repos, detached HEAD)
    if (-not $branch) { continue }

    # Skip the main worktree itself
    $normPath = $path -replace "\\", "/"
    if ($normPath -eq $repoRoot) { continue }

    # If a specific root is given, skip worktrees outside it
    if ($WorktreeRoot -ne "") {
        $normRoot = ($WorktreeRoot -replace "\\", "/").TrimEnd("/")
        if (-not $normPath.StartsWith($normRoot + "/") -and $normPath -ne $normRoot) {
            continue
        }
    }

    # Check for uncommitted changes
    $dirtyStatus = git -C $path status --porcelain 2>$null
    $isDirty = ($null -ne $dirtyStatus) -and ($dirtyStatus.Trim().Length -gt 0)

    # Check if branch is merged into main
    $branchRef = $branch -replace "^refs/heads/", ""
    $mergeBase = git merge-base $branchRef main 2>$null
    $isMerged = ($mergeBase.Trim() -eq $mainHead)

    # Get last commit date for staleness check
    $lastCommitDate = $null
    $lastCommitUnix = git -C $path log -1 --format="%ct" 2>$null
    if ($lastCommitUnix) {
        $epoch = [DateTimeOffset]::FromUnixTimeSeconds([long]$lastCommitUnix.Trim())
        $lastCommitDate = $epoch.LocalDateTime
    }

    # Classify
    $status = "active"
    if ($isMerged) {
        $status = "merged"
    } elseif ($isDirty) {
        $status = "dirty"
    } elseif ($lastCommitDate) {
        $daysSince = ($now - $lastCommitDate).Days
        if ($daysSince -ge $StaleDays) {
            $status = "stale"
        }
    }

    $results += [ordered]@{
        path          = $path
        branch        = $branchRef
        status        = $status
        isDirty       = $isDirty
        isMerged      = $isMerged
        lastCommit    = if ($lastCommitDate) { $lastCommitDate.ToString("yyyy-MM-dd HH:mm") } else { "unknown" }
        staleDays     = if ($lastCommitDate) { ($now - $lastCommitDate).Days } else { $null }
    }
}

# ── Print report ─────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Worktree Janitor Report" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$merged  = @($results | Where-Object { $_.status -eq "merged" })
$dirty   = @($results | Where-Object { $_.status -eq "dirty" })
$stale   = @($results | Where-Object { $_.status -eq "stale" })
$active  = @($results | Where-Object { $_.status -eq "active" })

$colorMap = @{
    "merged" = "DarkGray"
    "dirty"  = "Yellow"
    "stale"  = "Red"
    "active" = "Green"
}

foreach ($r in $results) {
    $tag = $r.status.ToUpper().PadRight(7)
    $color = $colorMap[$r.status]
    $extra = ""
    if ($r.isDirty -and $r.status -ne "merged") { $extra += " [dirty]" }
    if ($r.staleDays -ne $null -and $r.status -eq "stale") { $extra += " [$($r.staleDays)d]" }

    Write-Host "  $tag " -ForegroundColor $color -NoNewline
    Write-Host "$($r.branch)  last=$($r.lastCommit)$extra" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Summary: $($merged.Count) merged, $($dirty.Count) dirty, $($stale.Count) stale, $($active.Count) active" -ForegroundColor White
Write-Host ""

# ── Remove merged (only with explicit flag) ──────────────────────────────────

if ($RemoveMerged) {
    if ($merged.Count -eq 0) {
        Write-Ok "No merged worktrees to remove."
    } else {
        Write-Step "Removing $($merged.Count) merged worktree(s)"
        foreach ($r in $merged) {
            Write-Info "  Removing: $($r.path) (branch: $($r.branch))"
            git worktree remove $r.path 2>&1
            if ($LASTEXITCODE -eq 0) {
                git branch -d $r.branch 2>&1 | Out-Null
                Write-Ok "  Removed $($r.branch)"
            } else {
                Write-Warn "  Failed to remove $($r.path)"
            }
        }
    }
} else {
    Write-Host "DRY RUN — no changes made." -ForegroundColor Yellow
    if ($merged.Count -gt 0) {
        Write-Host "  To remove merged worktrees:" -ForegroundColor Yellow
        Write-Host "    ./scripts/ai/worktree-janitor.ps1 -RemoveMerged" -ForegroundColor Yellow
    }
    Write-Host ""
}

# ── Exit code ────────────────────────────────────────────────────────────────

# Exit 1 if there are stale or dirty worktrees needing attention
if ($stale.Count -gt 0 -or $dirty.Count -gt 0) {
    exit 1
}
exit 0
