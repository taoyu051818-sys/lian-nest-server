# Launch Locks State

Machine-readable projection of currently held launch locks, consumed by the
batch launcher and scheduler to prevent concurrent workers from editing
overlapping resources.

> **Closes:** [#368](https://github.com/taoyu051818-sys/lian-nest-server/issues/368)

---

## Overview

The launch locks state file (`.github/ai-state/launch-locks.json`) records
which conflict groups, write sets, and shared locks are currently held by
active workers. The launcher reads this file before dispatching new workers
to detect conflicts with in-flight tasks.

This projection is **not** a log — each write replaces the previous state.
Stale entries are cleaned up on every write cycle.

---

## File Location

```
.github/ai-state/launch-locks.json
```

---

## Schema

```jsonc
{
  "markerVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "locks": [
    {
      "conflictGroup": "auth-core",
      "writeSet": ["src/auth/auth.service.ts", "src/auth/auth.module.ts"],
      "sharedLocks": ["app-module"],
      "ownerTask": {
        "issue": 258,
        "branch": "claude/wave6-20260510-091500-issue-258",
        "workerClass": "runtime-feature"
      },
      "acquiredAt": "2026-05-11T10:30:00Z",
      "expiresAt": "2026-05-11T11:30:00Z"
    }
  ]
}
```

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `markerVersion` | `number` | Schema version. Current: `1`. |
| `capturedAt` | `string` (ISO 8601) | When this projection was last written. |
| `locks` | `array` | Currently held locks. Empty array `[]` when no workers are active. |

### Lock Entry Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `conflictGroup` | `string` | Yes | The conflict group this lock protects. Maps to the task's `conflictGroup` field. |
| `writeSet` | `string[]` | Yes | File paths or glob patterns the worker intends to edit. Populated from the task's `allowedFiles`. |
| `sharedLocks` | `string[]` | No | Shared resource locks claimed (e.g. `app-module`, `prisma-schema`). Omitted or empty when none are claimed. |
| `ownerTask` | `object` | Yes | Identifies the task holding this lock. |
| `ownerTask.issue` | `number` | Yes | GitHub issue number. |
| `ownerTask.branch` | `string` | Yes | Git worktree branch name. |
| `ownerTask.workerClass` | `string` | Yes | Worker classification (e.g. `runtime-feature`, `docs`, `foundation-fix`). |
| `acquiredAt` | `string` (ISO 8601) | Yes | When the lock was acquired (worker dispatch time). |
| `expiresAt` | `string` (ISO 8601) | Yes | When the lock expires if not released. Based on the task's `hardTimeMinutes` budget. |

---

## Stale Lock Detection

A lock is considered **stale** when:

1. `expiresAt` is in the past, AND
2. No heartbeat or activity update has refreshed the lock.

### Stale Lock Handling

When the launcher reads the projection and finds stale entries:

1. **Log a warning** — the stale lock is reported in the launch gate output.
2. **Block new tasks** — tasks in the same conflict group are blocked until
   the stale lock is explicitly cleared or refreshed.
3. **Do not auto-remove** — stale locks require manual intervention or
   reconciler cleanup to prevent double-dispatch.

The state reconciler (`scripts/ai/state-reconciler.ps1`) may flag stale locks
as drift when the owning issue has transitioned to `agent:done` or the branch
has been merged.

---

## Lifecycle

```
Worker dispatch          Worker completes / expires
     |                          |
     v                          v
 Acquire lock ──► In-flight ──► Release lock
     |                          |
     +-- refresh on heartbeat --+
```

### Acquire

The launcher writes a new lock entry when dispatching a worker. The entry
includes the conflict group, write set, shared locks, and expiry derived from
the task's `hardTimeMinutes` budget.

### Refresh

Active workers may refresh their lock expiry via heartbeat updates. This
extends the `expiresAt` deadline without changing the lock's conflict group
or write set.

### Release

When a worker completes (PR merged, issue closed, or worker reports done),
the launcher removes the lock entry from the projection. If the worker
exits without explicit release, the lock expires naturally.

---

## Conflict Detection Rules

The launcher checks the projection against pending tasks using these rules:

| Check | Condition | Result |
|-------|-----------|--------|
| Conflict group overlap | Pending task's `conflictGroup` matches a held lock | BLOCK |
| Shared lock overlap | Pending task's `sharedLocks` intersects a held lock's `sharedLocks` | BLOCK |
| Write set overlap | Pending task's `allowedFiles` intersects a held lock's `writeSet` | WARN (soft check) |

The conflict group and shared lock checks are **hard blocks** — the launcher
refuses to dispatch. The write set overlap is a **soft warning** — it surfaces
potential issues but does not prevent dispatch when conflict groups differ.

---

## Integration

The launch locks projection fits into the existing orchestration flow:

```
batch-launch.ps1
       │
       ├── read main-health.json     (health gate)
       ├── read launch-locks.json    (conflict gate) ◄── this file
       ├── check-launch-gate.ps1     (combined validation)
       │
       ├── acquire lock              (write projection)
       ├── dispatch worker
       │
       └── release lock              (write projection)
```

### Consumers

| Consumer | Usage |
|----------|-------|
| `batch-launch.ps1` | Reads before dispatch, writes on acquire/release |
| `check-launch-gate.ps1` | Reads to detect running-worker conflicts |
| `state-reconciler.ps1` | Reads to detect stale locks and drift |
| Monitoring | Reads `capturedAt` to detect stale projections |

---

## Design Decisions

- **Projection, not log.** Each write replaces the full state. No append-only history.
- **No secrets.** Lock entries contain only scheduling metadata — no tokens, credentials, or PII.
- **Expiry is mandatory.** Every lock has an `expiresAt` derived from task budgets. This prevents abandoned workers from holding locks indefinitely.
- **Manual stale cleanup.** Stale locks are never auto-removed. This prevents double-dispatch when a worker is slow but still active.
- **markerVersion for evolution.** Schema changes increment the version, allowing consumers to detect incompatible projections.

---

## References

- [Launch Gate](launch-gate.md) — Pre-launch validation that consumes this projection
- [Parallel Work Policy](parallel-work-policy.md) — Conflict group and shared lock definitions
- [State Reconciler](state-reconciler.md) — Drift detection including stale locks
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema with `conflictGroup` and `sharedLocks`
- [#368](https://github.com/taoyu051818-sys/lian-nest-server/issues/368) — This feature
