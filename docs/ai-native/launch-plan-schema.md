# Launch Plan Schema

Defines the compiled launch plan that the batch scheduler produces before
dispatching workers. The plan captures which tasks were selected, which were
rejected, what locks are held, and the main health snapshot at decision time.

> **Closes:** [#364](https://github.com/taoyu051818-sys/lian-nest-server/issues/364)

---

## Overview

When the batch scheduler evaluates a task batch, it runs the launch gate
(check-launch-gate.ps1) and produces a **launch plan** — a structured record
of the scheduling decisions. This schema formalizes that output so downstream
consumers (dry-run display, audit logs, orchestrator state) can parse it
reliably.

```
task.json → batch-launch.ps1 → launch gate → launch plan → dispatch / block
```

## Schema Location

`schemas/launch-plan.schema.json` — JSON Schema draft-07.

---

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `planVersion` | integer (const 1) | yes | Schema version. |
| `capturedAt` | date-time string | yes | When the plan was compiled. |
| `mainHealth` | MainHealthSnapshot | yes | Main branch health at decision time. |
| `selectedTasks` | PlannedTask[] | yes | Tasks cleared for dispatch. |
| `rejectedTasks` | RejectedTask[] | yes | Tasks blocked by the gate. |
| `locksAcquired` | LockEntry[] | yes | Shared locks held by selected tasks. |
| `budgetReservations` | BudgetSummary | yes | Aggregate budget for the batch. |
| `allAllowed` | boolean | yes | True when no tasks were rejected. |

---

## MainHealthSnapshot

Captures the main branch health state at the time the plan was compiled.

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `state` | enum | yes | `green`, `yellow`, `red`, or `black`. |
| `capturedAt` | date-time string | yes | When health was last evaluated. |
| `checks` | string[] | no | Health checks that ran. |
| `failedChecks` | string[] | no | Subset of checks that failed. |
| `reason` | string or null | no | Human-readable explanation. |

Health states follow [main-health-policy.md](main-health-policy.md):

- **green** — All checks pass. All worker types may launch.
- **yellow** — Non-critical failure. Limited worker types may launch.
- **red** — Critical failure. Only recovery workers may launch.
- **black** — Manual intervention required. Nothing launches.

---

## PlannedTask (selected)

A task that passed the launch gate and is cleared for dispatch.

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `targetIssue` | integer | yes | GitHub issue number. |
| `targetPR` | integer or null | no | Existing PR number, if any. |
| `conflictGroup` | string | yes | Parallelism control group. |
| `risk` | enum | yes | `low`, `medium`, or `high`. |
| `taskType` | enum | yes | `execution`, `research`, or `review`. |
| `workerType` | enum | yes | Classified type for permission lookup. |
| `sharedLocks` | string[] | no | Locks claimed by this task. |
| `allowedFiles` | string[] | no | File globs the worker may edit. |
| `decision` | Decision | yes | Why this task was allowed. |

---

## RejectedTask

A task blocked by the launch gate.

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `targetIssue` | integer | yes | GitHub issue number. |
| `targetPR` | integer or null | no | Existing PR number, if any. |
| `conflictGroup` | string | yes | Parallelism control group. |
| `risk` | enum | yes | `low`, `medium`, or `high`. |
| `taskType` | enum | yes | `execution`, `research`, or `review`. |
| `workerType` | enum | yes | Classified type. |
| `sharedLocks` | string[] | no | Locks this task attempted to claim. |
| `decision` | Decision | yes | Why this task was blocked. |

---

## Decision

Scheduler reasoning for a single task.

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `allowed` | boolean | yes | Whether the task may launch. |
| `reason` | string or null | yes | Human-readable explanation. |
| `rule` | enum or null | no | Machine-readable rule identifier. |

### Decision Rules

| Rule | Meaning |
|------|---------|
| `health-state-blocked` | Worker type not permitted in current main health state. |
| `conflict-group-duplicate` | Two tasks share the same non-doc conflict group in one batch. |
| `shared-lock-overlap` | Two tasks claim the same shared lock. |
| `running-worker-conflict` | Task conflicts with an already-active worker. |
| `null` | No specific rule triggered (generic rejection or allowed task). |

---

## LockEntry

A shared lock acquired by a selected task.

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `lockName` | string | yes | Lock identifier (e.g. `app-module`). |
| `holderIssue` | integer | yes | Issue number of the holding task. |
| `conflictGroup` | string or null | no | Conflict group of the holder. |

Locks prevent concurrent edits to shared files. See
[parallel-work-policy.md](parallel-work-policy.md) for the full specification.

---

## BudgetSummary

Aggregate budget reservations for the batch.

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `totalMaxFiles` | integer | yes | Sum of maxFiles across selected tasks. |
| `totalMaxLinesChanged` | integer | yes | Sum of maxLinesChanged across selected tasks. |
| `taskCount` | integer | yes | Number of selected tasks. |
| `softTimeMinutesMax` | integer or null | no | Max softTimeMinutes across tasks. |
| `hardTimeMinutesMax` | integer or null | no | Max hardTimeMinutes across tasks. |

---

## Example

```json
{
  "planVersion": 1,
  "capturedAt": "2026-05-11T12:30:00.000Z",
  "mainHealth": {
    "state": "green",
    "capturedAt": "2026-05-11T12:29:00.000Z",
    "checks": ["tsc", "build", "prisma"],
    "failedChecks": [],
    "reason": null
  },
  "selectedTasks": [
    {
      "targetIssue": 364,
      "targetPR": null,
      "conflictGroup": "schema-launch-plan",
      "risk": "low",
      "taskType": "execution",
      "workerType": "docs",
      "sharedLocks": [],
      "allowedFiles": [
        "schemas/launch-plan.schema.json",
        "docs/ai-native/launch-plan-schema.md"
      ],
      "decision": {
        "allowed": true,
        "reason": null,
        "rule": null
      }
    }
  ],
  "rejectedTasks": [
    {
      "targetIssue": 365,
      "targetPR": null,
      "conflictGroup": "runtime-feature-feed",
      "risk": "medium",
      "taskType": "execution",
      "workerType": "runtime-feature",
      "sharedLocks": [],
      "decision": {
        "allowed": false,
        "reason": "Worker type 'runtime-feature' is not permitted when main is yellow.",
        "rule": "health-state-blocked"
      }
    }
  ],
  "locksAcquired": [],
  "budgetReservations": {
    "totalMaxFiles": 6,
    "totalMaxLinesChanged": 500,
    "taskCount": 1,
    "softTimeMinutesMax": 45,
    "hardTimeMinutesMax": 90
  },
  "allAllowed": false
}
```

---

## Relationship to Other Schemas

| Schema | Purpose |
|--------|---------|
| `scripts/ai/task.schema.json` | Input task contract — defines what a worker must do. |
| `schemas/launch-plan.schema.json` | Output plan — records what the scheduler decided. |
| `.github/ai-state/main-health.json` | Health marker — consumed by the launch plan as `mainHealth`. |

The launch plan is a **read-only output** of the scheduler. It does not replace
the task contract; it wraps task metadata with scheduling decisions.

---

## References

- [launch-gate.md](launch-gate.md) — Pre-launch validation logic.
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema.
- [parallel-work-policy.md](parallel-work-policy.md) — Conflict groups and shared locks.
- [orchestration.md](orchestration.md) — Full orchestration flow.
