# Worktree Janitor — Launch Lock Awareness

Teaches the worktree janitor (`scripts/ai/worktree-janitor.ps1`) to read the
launch locks state projection before suggesting cleanup of active task
worktrees.

> **Closes:** [#407](https://github.com/taoyu051818-sys/lian-nest-server/issues/407)

---

## Problem

The worktree janitor classifies worktrees as merged, dirty, stale, or active.
Before this change, it had no awareness of the launch locks projection, so it
could suggest removing a worktree whose branch holds an active lock —
potentially disrupting an in-flight worker.

## Solution

The janitor now reads `.github/ai-state/launch-locks.json` (configurable via
`-LaunchLocksPath`) and classifies worktrees with active (non-expired) locks
as **locked**.

### New classification: locked

A worktree is classified as `locked` when:

1. Its branch name matches a lock entry's `ownerTask.branch`, AND
2. The lock's `expiresAt` is in the future (lock is not expired).

Locked worktrees:

- Are **never removed** by `-RemoveMerged` (they don't appear in the merged
  set).
- Are shown in magenta in the report with lock metadata (issue number,
  conflict group).
- Are listed separately in the dry-run report under "Locked worktrees".

### Expired locks

A lock whose `expiresAt` is in the past is considered expired. Expired locks
do **not** protect a worktree — the normal classification rules apply (merged,
dirty, stale, active).

---

## New Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-LaunchLocksPath` | `.github/ai-state/launch-locks.json` | Path to the launch locks state file. |
| `-Help` | `$false` | Display help and exit. |

---

## Classification Priority

The updated priority order:

```
locked > merged > merged+dirty > dirty > stale > active
```

A branch with an active lock is always classified as `locked`, even if it is
merged or dirty. This ensures the janitor never suggests cleanup of a worktree
that an active worker depends on.

---

## Report Output

### Console report

```
========================================
  Worktree Janitor Report
========================================

  MERGED  claude/issue-100-fix-typo  last=2026-05-10 14:00
  LOCKED  claude/issue-258-auth-core  last=2026-05-11 10:30 [lock: issue#258 group=auth-core]
  ACTIVE  claude/issue-300-feature  last=2026-05-11 11:00

Summary: 1 merged, 0 merged+dirty, 1 locked, 0 dirty, 0 stale, 1 active
```

### Dry-run report

```
DRY RUN — no changes made.

  Actions if -RemoveMerged:
    Would remove 1 merged worktree(s):
      - claude/issue-100-fix-typo (...)
    Command: ./scripts/ai/worktree-janitor.ps1 -RemoveMerged

  Locked worktrees (1 found) — protected by launch locks:
    - claude/issue-258-auth-core [issue#258 group=auth-core] (...)
    Policy: NEVER auto-removed while lock is active.
```

---

## Integration

```
.github/ai-state/launch-locks.json
        │
        ▼
worktree-janitor.ps1 -LaunchLocksPath <path>
        │
        ├── read launch locks
        ├── classify worktrees (locked-aware)
        ├── print report
        └── remove merged (locked worktrees skipped)
```

The janitor reads the locks file once at startup. If the file is missing or
unparseable, lock awareness is disabled and the script falls back to the
original classification behavior.

---

## Design Decisions

- **Read-only.** The janitor never modifies the launch locks file. It only
  consumes it.
- **Expired locks ignored.** Only non-expired locks protect worktrees. This
  prevents abandoned locks from permanently shielding stale worktrees.
- **Graceful degradation.** If the locks file is missing or corrupt, the
  script continues with a warning — lock awareness is additive, not required.
- **No auto-cleanup of stale locks.** The janitor does not remove or flag
  stale locks. That responsibility belongs to the state reconciler.

---

## References

- [Launch Locks State](launch-locks-state.md) — Schema and lifecycle for the
  launch locks projection.
- [Launch Policy](launch-policy.md) — Conflict groups and shared lock
  definitions.
- [State Reconciler](state-reconciler.md) — Drift detection including stale
  locks.
- [#407](https://github.com/taoyu051818-sys/lian-nest-server/issues/407) —
  This feature.
