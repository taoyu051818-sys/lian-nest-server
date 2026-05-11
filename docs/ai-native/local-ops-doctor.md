# Local Ops Doctor

Diagnostics and cleanup tools for local AI-native development.

## Worktree Janitor

The worktree janitor scans `.claude/worktrees/` and classifies every managed
worktree so you can reclaim disk space and reduce orchestration drift.

### Classification

| Status        | Meaning | Safe to remove? |
|---------------|---------|-----------------|
| merged        | Branch is fully merged into main; worktree is clean | Yes — use `-RemoveMerged` |
| merged+dirty  | Branch is merged but has uncommitted changes | No — recover changes first, or use `-RemoveMerged -Force` |
| dirty         | Has uncommitted (staged or unstaged) changes; branch is NOT merged | No — commit or stash first |
| stale         | Unmerged but no commits in 14+ days | No — review manually |
| active        | Unmerged with recent commits | No — work in progress |

**Classification priority:** merged > merged+dirty > dirty > stale > active

A worktree whose branch is merged into main is always classified as `merged`
(or `merged+dirty` if it has uncommitted changes), regardless of how old its
last commit is. The `dirty` status only applies to unmerged branches — this
avoids misclassifying an old-but-merged worktree as both stale and dirty.

### Safety policy

The janitor follows a strict safety model:

| Category      | Auto-removed? | Why |
|---------------|---------------|-----|
| merged        | Yes (with `-RemoveMerged`) | Branch is fully merged; safe to clean up |
| merged+dirty  | Only with `-Force` | Uncommitted changes would be lost |
| dirty         | **Never** | Uncommitted work on an unmerged branch |
| stale         | **Never** | Requires human review before removal |
| active        | **Never** | Work in progress |

**Key guarantees:**
- Default mode is always dry-run — no worktree is ever deleted without an explicit `-RemoveMerged` flag.
- Dirty and stale worktrees are reported but never touched by automated cleanup.
- The `-DryRun` flag explicitly requests dry-run mode; if combined with `-RemoveMerged`, dry-run takes precedence.

### Dry-run behavior

Running the script without `-RemoveMerged` (or with `-DryRun`) produces a report showing:
- Classification of every worktree
- What `-RemoveMerged` *would* do (which worktrees would be removed vs skipped)
- Policy hints for dirty and stale worktrees with recommended actions

This makes it safe to run in CI or as a pre-launch check without side effects.

### Usage

```powershell
# Dry-run report (default — no changes)
./scripts/ai/worktree-janitor.ps1

# Explicit dry-run (same as default, intent is clear)
./scripts/ai/worktree-janitor.ps1 -DryRun

# Remove only merged worktrees (safe, explicit)
./scripts/ai/worktree-janitor.ps1 -RemoveMerged

# Remove merged worktrees including those with uncommitted changes
./scripts/ai/worktree-janitor.ps1 -RemoveMerged -Force

# Custom stale threshold (days)
./scripts/ai/worktree-janitor.ps1 -StaleDays 7
```

### Manual cleanup steps

When the janitor reports dirty, merged+dirty, or stale worktrees:

1. **Merged+dirty worktrees** — The branch is merged, but the worktree has
   uncommitted changes. Recover or discard changes before removing:
   ```powershell
   cd <worktree-path>
   git status                    # see what's dirty
   git diff                      # inspect uncommitted changes
   git stash                     # stash to keep changes
   # OR: git checkout -- .       # discard all changes (destructive)
   ```
   After recovering changes, the janitor will classify it as `merged` and
   `-RemoveMerged` will handle it. Or use `-RemoveMerged -Force` to skip
   recovery.

2. **Dirty worktrees** (unmerged) — Enter the worktree, commit or stash changes:
   ```powershell
   cd <worktree-path>
   git status          # see what's dirty
   git stash           # stash if needed
   ```

3. **Stale worktrees** — Review whether the branch is still needed:
   ```powershell
   git -C <worktree-path> log --oneline main..HEAD   # unmerged commits
   ```
   If the work is abandoned:
   ```powershell
   git worktree remove <worktree-path>
   git branch -D <branch-name>
   ```

4. **Orphaned branches** — If a worktree was deleted but the branch remains:
   ```powershell
   git branch -d <branch-name>    # merged
   git branch -D <branch-name>    # unmerged
   ```

### Exit codes

| Code | Meaning |
|------|---------|
| 0    | All worktrees are clean or merged (no action needed) |
| 1    | Stale, dirty, or merged+dirty worktrees need attention |
| 2    | Script error (could not list worktrees) |

Exit code 1 does **not** mean the janitor failed — it means human review is needed for
dirty or stale worktrees. This is by design: the janitor refuses to auto-remove
non-merged worktrees.

### Integration

Run the janitor before launching new workers to ensure a clean state:

```powershell
./scripts/ai/worktree-janitor.ps1
./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/batch-wave-N.json
```
