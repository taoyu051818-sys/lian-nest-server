# Workspace Persistence

## Problem

LIAN's `compile-and-launch` command in `agent-command-dispatcher.js` performs a "scorched earth" cleanup before every batch launch: it force-removes all `.claude/worktrees/claude/issue-*` worktrees and force-deletes all `claude/issue-*` branches. This defeats the idempotent reuse logic already present in `Ensure-Worktree` (batch-launch.ps1), which is designed to reuse existing worktrees when the branch matches.

When a worker fails and the issue is re-queued, the next `compile-and-launch` cycle destroys the previous worktree (including any partial commits or context), and `Ensure-Worktree` creates a fresh one from main. The worker starts from scratch instead of resuming from where the previous attempt left off.

## Symphony Reference

OpenAI's Symphony specification (SPEC.md) defines workspace persistence as a core orchestration property:

1. **Workspaces persist across runs for the same issue.** If a worker fails and the issue is retried, the existing workspace is reused, preserving previous work context.
2. **Successful runs do not delete workspaces.** The workspace remains available for inspection and serves as a checkpoint.
3. **Stale terminal workspaces are cleaned at startup.** When the orchestrator starts, it removes workspaces for issues that have reached a terminal state (closed, completed), preventing disk accumulation.

## Current LIAN Behavior

| Aspect | Symphony | LIAN (before fix) |
|--------|----------|-------------------|
| Worktree reuse on retry | Reuses existing workspace | `Ensure-Worktree` supports reuse, but `compile-and-launch` destroys all worktrees first |
| Successful run cleanup | Keeps workspace | `compile-and-launch` destroys everything |
| Startup cleanup | Cleans terminal workspaces | No automated startup cleanup; janitor is manual |
| Stale workspace policy | Clean at startup | Janitor reports but never auto-removes stale worktrees |

## Fix: Selective Cleanup in `compile-and-launch`

The fix reorders the `compile-and-launch` handler so that worktree cleanup happens **after** task compilation and is **selective** — only removing worktrees for issues that are NOT in the new task list.

### Before (scorched earth)

```
1. Reset worker state
2. Force-remove ALL issue worktrees     ← destroys reusable worktrees
3. Force-delete ALL issue branches
4. Compile tasks from open issues
5. Launch workers (Ensure-Worktree creates fresh)
```

### After (selective cleanup)

```
1. Reset worker state
2. Compile tasks from open issues       ← moved up
3. Selectively clean worktrees:         ← only non-queued issues
   - Worktrees for issues IN the task list → preserved for reuse
   - Worktrees for issues NOT in task list → safe to remove
4. Launch workers (Ensure-Worktree reuses preserved worktrees)
```

### Implementation

In `agent-command-dispatcher.js`, the `compile-and-launch` handler:

1. Moves the compile step before cleanup
2. Builds a set of issue numbers from compiled tasks
3. Only removes worktrees whose issue number is not in the compiled set
4. Same selective logic for branch cleanup

This means:
- **Retry scenario:** Issue 42 fails, gets re-labeled. Next cycle compiles issue 42 again. The worktree for issue 42 is preserved. `Ensure-Worktree` detects the matching branch and reuses it. Worker resumes with previous context.
- **Closed issue scenario:** Issue 37 is closed, no longer labeled. Next cycle does not compile issue 37. The worktree for issue 37 is cleaned up.

## Limitations

1. **No GitHub API check for closed issues.** The selective cleanup uses the compiled task list as a proxy for "open issues." If an issue is closed but still has the label, it will still be compiled and its worktree preserved. This is acceptable because the label-based compilation already handles this.
2. **No automated startup cleanup.** The worktree janitor remains a manual tool. A future enhancement could integrate janitor-like logic into the dispatcher startup, but that is out of scope for this change.
3. **Dirty worktrees from failed runs are preserved.** If a worker left uncommitted changes, the retry will see those changes. This is intentional — it preserves context — but workers should handle dirty state gracefully.

## Files Changed

| File | Change |
|------|--------|
| `scripts/ai/agent-command-dispatcher.js` | Selective worktree cleanup in `compile-and-launch` |
| `docs/ai-native/workspace-persistence.md` | This document |
| `docs/ai-native/orchestration.md` | Added workspace persistence section |
