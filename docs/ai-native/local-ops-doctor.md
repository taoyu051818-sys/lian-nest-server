# Local Ops Doctor

Diagnostics and cleanup tools for local AI-native development.

## Worktree Janitor

The worktree janitor scans `.claude/worktrees/` and classifies every managed
worktree so you can reclaim disk space and reduce orchestration drift.

### Classification

| Status   | Meaning | Safe to remove? |
|----------|---------|-----------------|
| merged   | Branch is fully merged into main | Yes — use `-RemoveMerged` |
| dirty    | Has uncommitted (staged or unstaged) changes | No — commit or stash first |
| stale    | Unmerged but no commits in 14+ days | No — review manually |
| active   | Unmerged with recent commits | No — work in progress |

### Usage

```powershell
# Dry-run report (default — no changes)
./scripts/ai/worktree-janitor.ps1

# Remove only merged worktrees (safe, explicit)
./scripts/ai/worktree-janitor.ps1 -RemoveMerged

# Custom stale threshold (days)
./scripts/ai/worktree-janitor.ps1 -StaleDays 7
```

### Manual cleanup steps

When the janitor reports dirty or stale worktrees:

1. **Dirty worktrees** — Enter the worktree, commit or stash changes:
   ```powershell
   cd <worktree-path>
   git status          # see what's dirty
   git stash           # stash if needed
   ```

2. **Stale worktrees** — Review whether the branch is still needed:
   ```powershell
   git -C <worktree-path> log --oneline main..HEAD   # unmerged commits
   ```
   If the work is abandoned:
   ```powershell
   git worktree remove <worktree-path>
   git branch -D <branch-name>
   ```

3. **Orphaned branches** — If a worktree was deleted but the branch remains:
   ```powershell
   git branch -d <branch-name>    # merged
   git branch -D <branch-name>    # unmerged
   ```

### Exit codes

| Code | Meaning |
|------|---------|
| 0    | All worktrees are clean or merged |
| 1    | Stale or dirty worktrees need attention |
| 2    | Script error (could not list worktrees) |

### Integration

Run the janitor before launching new workers to ensure a clean state:

```powershell
./scripts/ai/worktree-janitor.ps1
./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/batch-wave-N.json
```
