#Requires -Version 7.0
<#
.SYNOPSIS
    Dry-run janitor for stale Claude worktrees.

.DESCRIPTION
    Scans all git worktrees (excluding the main worktree) and classifies each as:
      - merged        — branch is fully merged into main; safe to remove
      - merged+dirty  — branch is merged but has uncommitted changes; DO NOT
                        remove without recovering changes first
      - dirty         — has uncommitted changes; do NOT remove
      - stale         — unmerged but no commits in the last 14 days
      - active        — unmerged with recent commits

    Default mode is dry-run: prints a classification report with no side effects.
    The dry-run report shows what actions would be taken for each category,
    making it safe to run in CI or before launching new workers.

    Safety policy:
      - Only merged worktrees are ever removed (via -RemoveMerged).
      - Dirty and stale worktrees are NEVER removed automatically.
      - Merged+dirty worktrees require -Force to remove.
      - No worktree is deleted without an explicit removal flag.

.PARAMETER WorktreeRoot
    Optional filter — only scan worktrees under this directory path.
    When empty (default), all non-main worktrees are scanned.

.PARAMETER StaleDays
    Number of days without a commit before a worktree is classified as stale.
    Defaults to 14.

.PARAMETER RemoveMerged
    Remove worktrees whose branches are fully merged into main. Without this
    switch the script is always dry-run.

.PARAMETER DryRun
    Explicit dry-run mode. Prints the classification report and shows what
    actions would be taken without making any changes. This is the default
    behavior; use this flag to be explicit about intent.

.PARAMETER Force
    When used with -RemoveMerged, also removes merged+dirty worktrees.
    Without this switch, merged+dirty worktrees are skipped with a warning.

.EXAMPLE
    # Dry-run report (default — no changes)
    ./scripts/ai/worktree-janitor.ps1

.EXAMPLE
    # Explicit dry-run (same as default, but intent is clear)
    ./scripts/ai/worktree-janitor.ps1 -DryRun

.EXAMPLE
    # Remove merged worktrees only
    ./scripts/ai/worktree-janitor.ps1 -RemoveMerged

.EXAMPLE
    # Custom stale threshold
    ./scripts/ai/worktree-janitor.ps1 -StaleDays 7

.EXAMPLE
    # Remove merged worktrees, including those with uncommitted changes
    ./scripts/ai/worktree-janitor.ps1 -RemoveMerged -Force
#>

[CmdletBinding()]
param(
    [string]$WorktreeRoot = "",
    [int]$StaleDays = 14,
    [switch]$RemoveMerged,
    [switch]$DryRun,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# DryRun takes precedence over RemoveMerged for safety
if ($DryRun -and $RemoveMerged) {
    Write-Warn "-DryRun specified with -RemoveMerged; running in dry-run mode (no changes)."
    $RemoveMerged = $false
}

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
    # Priority: merged > merged+dirty > dirty > stale > active
    # A merged branch is always "merged" regardless of dirty state, but we
    # track merged+dirty as a distinct annotation so the report can warn.
    $status = "active"
    $mergedDirty = $false
    if ($isMerged) {
        $status = "merged"
        if ($isDirty) { $mergedDirty = $true }
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
        mergedDirty   = $mergedDirty
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

$merged       = @($results | Where-Object { $_.status -eq "merged" -and -not $_.mergedDirty })
$mergedDirty  = @($results | Where-Object { $_.status -eq "merged" -and $_.mergedDirty })
$dirty        = @($results | Where-Object { $_.status -eq "dirty" })
$stale        = @($results | Where-Object { $_.status -eq "stale" })
$active       = @($results | Where-Object { $_.status -eq "active" })

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
    if ($r.mergedDirty) { $extra += " [merged+dirty]" }
    elseif ($r.isDirty) { $extra += " [dirty]" }
    if ($r.staleDays -ne $null -and $r.status -eq "stale") { $extra += " [$($r.staleDays)d]" }

    Write-Host "  $tag " -ForegroundColor $color -NoNewline
    Write-Host "$($r.branch)  last=$($r.lastCommit)$extra" -ForegroundColor Gray
}

Write-Host ""
$mdCount = $mergedDirty.Count
$summaryParts = @(
    "$($merged.Count) merged",
    "$mdCount merged+dirty",
    "$($dirty.Count) dirty",
    "$($stale.Count) stale",
    "$($active.Count) active"
)
Write-Host "Summary: $($summaryParts -join ', ')" -ForegroundColor White
Write-Host ""

# ── Remove merged (only with explicit flag) ──────────────────────────────────

if ($RemoveMerged) {
    $totalMerged = $merged.Count + $mergedDirty.Count
    if ($totalMerged -eq 0) {
        Write-Ok "No merged worktrees to remove."
    } else {
        # Remove clean merged worktrees
        if ($merged.Count -gt 0) {
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

        # Handle merged+dirty worktrees
        if ($mergedDirty.Count -gt 0) {
            if ($Force) {
                Write-Step "Removing $($mergedDirty.Count) merged+dirty worktree(s) (forced)"
                foreach ($r in $mergedDirty) {
                    Write-Warn "  Removing dirty merged worktree: $($r.path)"
                    Write-Warn "    Uncommitted changes will be lost!"
                    git worktree remove --force $r.path 2>&1
                    if ($LASTEXITCODE -eq 0) {
                        git branch -d $r.branch 2>&1 | Out-Null
                        Write-Ok "  Removed $($r.branch)"
                    } else {
                        Write-Warn "  Failed to remove $($r.path)"
                    }
                }
            } else {
                Write-Warn "Skipping $($mergedDirty.Count) merged+dirty worktree(s) — uncommitted changes:"
                foreach ($r in $mergedDirty) {
                    Write-Warn "  $($r.path) (branch: $($r.branch))"
                }
                Write-Host "  Recover changes first, or use -Force to remove anyway." -ForegroundColor Yellow
            }
        }
    }
} else {
    Write-Host "DRY RUN — no changes made." -ForegroundColor Yellow
    Write-Host ""

    # Show what -RemoveMerged would do
    $totalMerged = $merged.Count + $mergedDirty.Count
    if ($totalMerged -gt 0) {
        Write-Host "  Actions if -RemoveMerged:" -ForegroundColor Yellow
        if ($merged.Count -gt 0) {
            Write-Host "    Would remove $($merged.Count) merged worktree(s):" -ForegroundColor Yellow
            foreach ($r in $merged) {
                Write-Host "      - $($r.branch) ($($r.path))" -ForegroundColor Gray
            }
        }
        if ($mergedDirty.Count -gt 0) {
            Write-Host "    Would skip $($mergedDirty.Count) merged+dirty worktree(s) (use -Force to include):" -ForegroundColor Yellow
            foreach ($r in $mergedDirty) {
                Write-Host "      - $($r.branch) ($($r.path))" -ForegroundColor Gray
            }
        }
        Write-Host "    Command: ./scripts/ai/worktree-janitor.ps1 -RemoveMerged" -ForegroundColor Yellow
        Write-Host ""
    }

    # Show policy for dirty worktrees (never auto-removed)
    if ($dirty.Count -gt 0) {
        Write-Host "  Dirty worktrees (unmerged, $($dirty.Count) found) — policy: NEVER auto-removed:" -ForegroundColor Yellow
        foreach ($r in $dirty) {
            Write-Host "    - $($r.branch) ($($r.path))" -ForegroundColor Gray
        }
        Write-Host "    Action: cd <path> && git stash  OR  commit changes first" -ForegroundColor Yellow
        Write-Host ""
    }

    # Show policy for stale worktrees (never auto-removed)
    if ($stale.Count -gt 0) {
        Write-Host "  Stale worktrees (>$StaleDays days, $($stale.Count) found) — policy: NEVER auto-removed:" -ForegroundColor Yellow
        foreach ($r in $stale) {
            $daysLabel = if ($r.staleDays -ne $null) { "$($r.staleDays)d" } else { "?" }
            Write-Host "    - $($r.branch) last=$($r.lastCommit) [$daysLabel] ($($r.path))" -ForegroundColor Gray
        }
        Write-Host "    Action: review manually, then git worktree remove <path> && git branch -D <branch>" -ForegroundColor Yellow
        Write-Host ""
    }
}

# ── Exit code ────────────────────────────────────────────────────────────────

# Exit 1 if there are stale, dirty, or merged+dirty worktrees needing attention
if ($stale.Count -gt 0 -or $dirty.Count -gt 0 -or $mergedDirty.Count -gt 0) {
    exit 1
}
exit 0
