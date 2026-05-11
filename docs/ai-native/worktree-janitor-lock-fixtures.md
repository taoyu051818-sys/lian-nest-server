# Worktree Janitor — Lock Fixture Coverage

Fixture-based tests validating the worktree janitor's launch-lock awareness
logic without modifying `worktree-janitor.ps1`.

> **Closes:** [#458](https://github.com/taoyu051818-sys/lian-nest-server/issues/458)

---

## Overview

The test script (`scripts/ai/worktree-janitor.launch-locks.test.ps1`) creates
temporary git repos with real worktrees and exercises the janitor against
fixture lock files covering the full classification matrix.

Run:

```powershell
pwsh ./scripts/ai/worktree-janitor.launch-locks.test.ps1
```

---

## Fixture Files

Location: `scripts/ai/__fixtures__/launch-locks/`

| Fixture | Description |
|---------|-------------|
| `valid-active.json` | Single non-expired lock protecting branch `claude/issue-400-control-fixtures`. |
| `mixed-active-expired.json` | Two locks — one active (issue 400), one expired (issue 401). Validates that only non-expired locks protect worktrees. |
| `empty-locks.json` | Empty locks array. Validates that no worktree is classified as locked. |

---

## Test Scenarios

### 1. Valid active lock

- Fixture: `valid-active.json`
- Expectation: Matching worktree is classified `LOCKED`; report shows lock
  metadata (issue number, conflict group).

### 2. Mixed active + expired

- Fixture: `mixed-active-expired.json`
- Expectation: Active lock protects its worktree (`LOCKED`); expired lock does
  not (worktree classified `ACTIVE`). Summary shows 1 active lock.

### 3. Empty locks

- Fixture: `empty-locks.json`
- Expectation: No worktree classified as `LOCKED`; all worktrees show as
  `ACTIVE`.

### 4. Missing locks file

- Fixture: path to nonexistent file
- Expectation: Script warns "lock awareness disabled" and falls back to
  normal classification. No `LOCKED` status in output.

### 5. Corrupt locks file

- Fixture: invalid JSON content
- Expectation: Script warns "Could not parse" and "lock awareness disabled".
  No `LOCKED` status in output.

---

## Fixture Schema

Each fixture follows the launch locks projection schema defined in
[launch-locks-state.md](launch-locks-state.md):

```jsonc
{
  "markerVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "locks": [
    {
      "conflictGroup": "control-worktree-fixtures",
      "writeSet": ["scripts/ai/worktree-janitor.launch-locks.test.ps1"],
      "sharedLocks": [],
      "ownerTask": {
        "issue": 400,
        "branch": "claude/issue-400-control-fixtures",
        "workerClass": "ai-native-tooling-worker"
      },
      "acquiredAt": "2026-05-11T12:00:00Z",
      "expiresAt": "2099-12-31T23:59:59Z"
    }
  ]
}
```

Key fields for lock classification:

- `ownerTask.branch` — matched against worktree branch names
- `expiresAt` — compared to current time; expired locks are ignored

---

## Design Decisions

- **Self-contained.** Each test run creates its own temp git repo with
  worktrees. No dependency on the real repo's worktree state.
- **No script modification.** Tests invoke `worktree-janitor.ps1` as-is via
  the `-LaunchLocksPath` parameter to inject fixture data.
- **Cleanup guaranteed.** All temp worktrees, branches, and directories are
  removed in a `finally` block, even on test failure.
- **Fixture validation.** Before integration tests run, each fixture file is
  validated against the expected schema (version, field types, date validity).

---

## References

- [Worktree Janitor Launch Locks](worktree-janitor-launch-locks.md) — Feature
  design doc for lock awareness in the janitor.
- [Launch Locks State](launch-locks-state.md) — Schema and lifecycle for the
  launch locks projection.
- [Local Ops Doctor](local-ops-doctor.md) — Worktree janitor usage and
  classification categories.
