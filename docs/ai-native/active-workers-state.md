# Active Workers State Projection

Machine-readable snapshot of currently running AI workers.
Consumed by the launch gate to prevent scheduling conflicts with in-flight work.

## Overview

`.github/ai-state/active-workers.json` is the canonical projection of active
workers. The launch gate reads this file via `-RunningTasksFile` to detect
conflict group overlaps before dispatching new workers.

The file is a **projection**, not a log. Each write replaces the previous
state. When no workers are active, `workers` is an empty array.

## Schema

```jsonc
{
  "markerVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "workers": [
    {
      "conflictGroup": "auth-core",
      "issue": 258,
      "branch": "claude/wave6-20260510-090000-issue-258-auth-slice1"
    }
  ]
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `markerVersion` | `1` | Yes | Schema version. Enables forward-compatible evolution. |
| `capturedAt` | ISO-8601 | Yes | When the projection was last written. |
| `workers` | array | Yes | Active worker entries. Empty array when no workers are running. |
| `workers[].conflictGroup` | string | Yes | Conflict group identifier. Matches `conflictGroup` in task JSON. |
| `workers[].issue` | int | No | GitHub issue number the worker is assigned to. |
| `workers[].branch` | string | No | Git branch or worktree the worker is operating on. |

## Seed State

The initial file ships as an empty projection:

```json
{
  "markerVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "workers": []
}
```

This allows the launch gate to read the file immediately without requiring
a running reconciler or launcher to produce the first write.

## Downstream Consumers

| Consumer | How It Uses This File |
|----------|-----------------------|
| **Launch gate** (`check-launch-gate.ps1`) | Reads via `-RunningTasksFile` to block tasks whose `conflictGroup` matches an active worker. |
| **State reconciler** | Compares projection against issue labels and PR state to detect stale workers. |
| **Batch launcher** (`batch-launch.ps1`) | Passes the file to the launch gate before dispatching each batch. |
| **Monitoring** | Reads `capturedAt` to detect stale projections (no write in > N minutes). |

## Reconciler Ownership

The active workers projection is maintained by the reconciliation loop:

1. **Write source**: The state reconciler or batch launcher writes the
   projection after each dispatch or completion event.
2. **Update cadence**: The file is rewritten on every state change (worker
   launch, worker completion, worker failure).
3. **Staleness detection**: If `capturedAt` is older than the configured
   stale threshold, the projection may be out of date and should be
   refreshed by the orchestrator.

## Integration with Launch Gate

```
batch-launch.ps1
       │
       ▼
check-launch-gate.ps1 -RunningTasksFile .github/ai-state/active-workers.json
       │
       ├── conflict group match? → BLOCK task
       └── no match → ALLOW task
```

The launch gate compares each task's `conflictGroup` against the workers
array. A match means the task would edit overlapping files with an active
worker and is blocked.

## Design Decisions

- **Projection, not log.** Each write replaces the previous state. No append-only history.
- **No secrets.** Worker entries contain only conflict group, issue number, and branch name.
- **Schema versioning.** `markerVersion` enables forward-compatible changes without breaking consumers.
- **Empty array is valid.** The file always exists; an empty `workers` array means no active workers.
- **Compatible with existing launch gate format.** The `workers` array matches the format already documented in [launch-gate.md](launch-gate.md#running-worker-conflict).

## See Also

- [Launch Gate](launch-gate.md) — Running-worker conflict detection
- [State Reconciler](state-reconciler.md) — Drift detection and reconciliation
- [Worker Heartbeat](worker-heartbeat.md) — Worker liveness signals
- [Parallel Work Policy](parallel-work-policy.md) — Conflict group definitions
