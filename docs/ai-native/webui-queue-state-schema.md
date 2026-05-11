# WebUI Queue State JSON Schema

Formal JSON Schema for the WebUI-visible queue state projection, capturing
the lifecycle of each worker queue entry from dispatch to completion.

> **Schema file:** [`schemas/webui-queue-state.schema.json`](../../schemas/webui-queue-state.schema.json)
> **Closes:** [#557](https://github.com/taoyu051818-sys/lian-nest-server/issues/557)

---

## Overview

The WebUI queue state is a projection that summarizes every tracked task
in the orchestration queue. It is consumed by the WebUI dashboard to show
real-time queue health and individual task progress.

| Aspect | Value |
|--------|-------|
| Schema version | `schemaVersion: 1` |
| JSON Schema draft | `draft-07` |
| Writer | State reconciler / batch launcher |

---

## Queue States

Each entry progresses through a linear lifecycle:

| State | Meaning | Typical next state |
|-------|---------|-------------------|
| `queued` | Waiting for dispatch. Task contract exists but no worker assigned. | `launching` |
| `launching` | Launcher is preparing the worker (spawning worktree, installing deps). | `running` |
| `running` | Worker is executing the task. | `pr-created`, `blocked` |
| `pr-created` | PR opened; awaiting review and merge. | `done` |
| `blocked` | Waiting on a dependency or external action (e.g. upstream merge). | `running`, `queued` |
| `done` | Terminal: merged, closed, or abandoned. | — |

```
queued → launching → running → pr-created → done
                       ↓ ↑         ↓
                    blocked    (direct done)
```

---

## Fields

### Top-Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `integer` (const `1`) | Yes | Schema version. Increment on shape change. |
| `capturedAt` | `string` (ISO-8601) | Yes | When this projection was last written. |
| `entries` | `QueueEntry[]` | Yes | Queue entries in any state. Empty array when nothing is tracked. |
| `summary` | `Summary` | No | Aggregate counts by state. Convenience for WebUI dashboards. |

### QueueEntry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `issueNumber` | `integer` >= 1 | Yes | GitHub issue number for this entry. |
| `state` | `string` enum | Yes | Current lifecycle state. See [Queue States](#queue-states). |
| `updatedAt` | `string` (ISO-8601) | Yes | Timestamp of the last state transition. |
| `conflictGroup` | `string` | No | Conflict group from the task contract. |
| `branch` | `string` | No | Git branch or worktree the worker is on. |
| `prNumber` | `integer` or `null` | No | PR number, if a PR has been opened. |
| `blockedBy` | `integer[]` | No | Issue/PR numbers blocking progress. Relevant when state is `blocked`. |
| `actorRole` | `string` | No | Worker role from the task contract. |
| `pmPhase` | `string` | No | Wave/phase identifier for UI grouping. |
| `reason` | `string` | No | Human-readable explanation of the current state. |

### Summary

All fields are non-negative integers, required when `summary` is present:

| Field | Description |
|-------|-------------|
| `queued` | Count of entries in `queued` state. |
| `launching` | Count of entries in `launching` state. |
| `running` | Count of entries in `running` state. |
| `prCreated` | Count of entries in `pr-created` state. |
| `blocked` | Count of entries in `blocked` state. |
| `done` | Count of entries in `done` state. |

---

## Examples

### Active Queue with Mixed States

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T15:00:00Z",
  "entries": [
    {
      "issueNumber": 557,
      "state": "running",
      "updatedAt": "2026-05-11T14:45:00Z",
      "conflictGroup": "webui-queue-schema",
      "branch": "claude/wave15-20260511-134040-issue-557-webui-queue-state-schema",
      "prNumber": null,
      "actorRole": "ai-native-control-plane-worker",
      "pmPhase": "self-cycle-wave15-maintain-30-concurrency"
    },
    {
      "issueNumber": 540,
      "state": "pr-created",
      "updatedAt": "2026-05-11T14:30:00Z",
      "conflictGroup": "auth-core",
      "branch": "claude/wave15-20260511-120000-issue-540-auth",
      "prNumber": 545,
      "actorRole": "backend-runtime-worker",
      "pmPhase": "self-cycle-wave15-maintain-30-concurrency"
    },
    {
      "issueNumber": 550,
      "state": "blocked",
      "updatedAt": "2026-05-11T14:20:00Z",
      "conflictGroup": "docs-worker",
      "blockedBy": [540],
      "reason": "Waiting for #540 to merge before editing shared docs",
      "actorRole": "docs-worker",
      "pmPhase": "self-cycle-wave15-maintain-30-concurrency"
    }
  ],
  "summary": {
    "queued": 2,
    "launching": 0,
    "running": 8,
    "prCreated": 5,
    "blocked": 1,
    "done": 14
  }
}
```

### Empty Queue

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "entries": []
}
```

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **WebUI dashboard** | All | Render queue overview, per-task detail, and summary stats. |
| **Launch gate** | `entries[].state`, `entries[].conflictGroup` | Cross-reference with active workers for conflict detection. |
| **Orchestrator** | `entries[].state`, `entries[].blockedBy` | Drive scheduling decisions and dependency resolution. |
| **Monitoring** | `capturedAt`, `summary` | Detect stale projections and track throughput. |

---

## Design Decisions

- **Projection, not log.** Each write replaces the previous state. No append-only history.
- **`pr-created` separate from `done`.** The WebUI needs to show PRs awaiting review as distinct from completed work.
- **`blocked` is explicit.** Rather than inferring blockage from `blockedBy`, the `state` field makes it visible to the UI without join logic.
- **Summary is optional.** Consumers can derive counts from `entries`, but the pre-computed summary avoids client-side aggregation for dashboards.
- **No secrets.** Entries contain only public identifiers (issue numbers, PR numbers, branch names, role names).

---

## References

- [Active Workers State](active-workers-state.md) — Running worker projection used by the launch gate.
- [Worker Telemetry Schema](worker-telemetry-schema.md) — Post-completion cost and outcome telemetry.
- [Task Schema v2](task-schema-v2.md) — Task contract schema referenced by queue entries.
- [State Reconciler](state-reconciler.md) — Drift detection and reconciliation loop.
- [Launch Gate](launch-gate.md) — Worker dispatch gating logic.
