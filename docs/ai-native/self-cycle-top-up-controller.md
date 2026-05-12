# Self-Cycle Top-Up Controller

Keeps ready issue count near target concurrency by selecting additional
low-risk tasks when active workers drop below target. Reads active-worker
count, task-board ready queue, provider pool capacity, risk signals, launch
locks, and main health state to produce a bounded dispatch plan.

> **Closes:** [#1326](https://github.com/taoyu051818-sys/lian-nest-server/issues/1326)

---

## Problem

The self-cycle could request 30 workers but only had 5 executable issues.
Without a top-up controller, the system has no mechanism to detect when
active workers fall below target and automatically select replacement tasks
from the ready queue. This leads to under-utilization of provider capacity
and requires manual intervention to maintain throughput.

## Goals

- Read active-worker count and compare to target concurrency (default 30).
- Compute the deficit between target and active workers.
- Select eligible tasks from the task-board ready queue, respecting conflict
  groups, launch locks, risk constraints, and provider capacity.
- Deduplicate by conflict group to avoid dispatching conflicting tasks in
  the same batch.
- Apply batch size limits (normal: 10, reduced: 5 under pressure).
- Emit a dispatch recommendation: `immediate`, `next-tick`, or `hold`.
- Keep the script read-only on system state — no workers launched, no issues
  modified.

## Non-Goals

- No changes to runtime backend code (`src/**`).
- No changes to Prisma schema.
- No changes to `package.json` or `package-lock.json`.
- No worker launching, PR creation, or issue mutation.
- No mutation of `.github/ai-state/` files (plan-only output).

---

## Algorithm

### 1. Signal Extraction

The controller reads signals from six state files:

| Signal | State file | Extraction |
|--------|-----------|------------|
| Active workers | `active-workers.json` | Count of workers with status `running` or `planned` |
| Ready tasks | `task-board.json` | Count of tasks with state `ready` |
| Provider capacity | `provider-pool.json` | Sum of `maxConcurrency - currentConcurrency` for available providers |
| Held locks | `launch-locks.json` | Count of locks with status `held` |
| Health gate | `main-health.json` | `green`/`yellow` = ok, `red`/`black` = blocked |
| Risk level | `risk-signals.json` | `high`/`critical` = blocked, `medium` = reduced, `low` = normal |

### 2. Deficit Computation

```text
deficit = max(0, targetConcurrency - activeWorkerCount)
```

### 3. Blocker Detection

Dispatch is blocked when any of:

- Health gate is `red` or `black`
- Risk signals contain `high` or `critical` severity
- Provider capacity is 0

### 4. Batch Size Limits

| Condition | Max batch size |
|-----------|----------------|
| Normal | 10 |
| Provider capacity < 5 | 5 |
| Held locks > 15 | 5 |
| Risk level = medium | 5 |

### 5. Task Selection

Eligible tasks must satisfy all of:

- State is `ready` or `todo`
- No linked PR
- `conflictGroup` not in active worker groups
- `conflictGroup` not in held lock groups
- Risk is not `high`

Tasks are deduplicated by `conflictGroup` (first task per group wins), then
truncated to `min(deficit, batchSize)`.

### 6. Dispatch Recommendation

| Condition | Recommendation |
|-----------|----------------|
| Any blocker present | `hold` |
| deficit = 0 | `hold` |
| activeWorkerCount < 25 | `immediate` |
| activeWorkerCount >= 25 | `next-tick` |

---

## Input Fixture Format

```json
{
  "activeWorkers": {
    "workers": [
      { "status": "running", "conflictGroup": "auth", "issueNumber": 5 }
    ]
  },
  "taskBoard": {
    "tasks": [
      { "issue": 10, "state": "ready", "conflictGroup": "docs", "risk": "low" },
      { "issue": 11, "state": "ready", "conflictGroup": "test", "risk": "low" }
    ]
  },
  "providerPool": {
    "providers": [
      { "status": "available", "currentConcurrency": 2, "maxConcurrency": 30 }
    ]
  },
  "riskSignals": {
    "signals": []
  },
  "launchLocks": {
    "locks": []
  },
  "mainHealth": {
    "status": "green"
  }
}
```

All keys are optional; missing state is treated conservatively.

## Output Schema

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-13T00:00:00.000Z",
  "targetConcurrency": 30,
  "activeWorkerCount": 2,
  "readyCount": 5,
  "deficit": 28,
  "providerCapacity": 28,
  "heldLocks": 0,
  "healthOk": true,
  "riskLevel": "low",
  "batchSize": 10,
  "blockers": [],
  "eligibleTaskCount": 3,
  "selectedTaskCount": 3,
  "selectedTasks": [
    { "issueNumber": 10, "conflictGroup": "docs", "risk": "low", "state": "ready" },
    { "issueNumber": 11, "conflictGroup": "test", "risk": "low", "state": "ready" }
  ],
  "recommendation": "immediate",
  "summary": {
    "targetConcurrency": 30,
    "activeWorkerCount": 2,
    "deficit": 28,
    "blocked": false,
    "recommendation": "immediate",
    "selectedTaskCount": 3
  }
}
```

---

## Usage

```bash
# Show help
node scripts/ai/top-up-self-cycle-queue.js --help

# Read from live state files, write to default output
node scripts/ai/top-up-self-cycle-queue.js

# Read from live state files, print to stdout
node scripts/ai/top-up-self-cycle-queue.js --stdout

# Read from fixture file
node scripts/ai/top-up-self-cycle-queue.js --fixture fixture.json --stdout

# Custom target concurrency
node scripts/ai/top-up-self-cycle-queue.js --target 20 --stdout

# Custom output path
node scripts/ai/top-up-self-cycle-queue.js --out custom/path.json

# Run built-in self-tests
node scripts/ai/top-up-self-cycle-queue.js --self-test
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Plan produced |
| 2 | Invalid arguments or missing inputs |

---

## Integration Points

- **Sustained 30-worker policy** (`sustained-30-worker-policy.md`): The top-up
  controller enforces the dispatch decision table from this policy.
- **Concurrency backfill planner** (`plan-concurrency-backfill.js`): The top-up
  controller handles the "when to dispatch" question; the backfill planner
  handles the "how many waves and which tasks per wave" question.
- **Task board projection** (`project-task-board.js`): Provides the ready/task
  state that the top-up controller reads.
- **Launch gate** (`check-launch-gate.ps1`): The top-up controller respects
  the same health gate and conflict group constraints.
- **Self-cycle execute plan** (`generate-self-cycle-execute-plan.js`): The
  top-up controller is an action within the self-cycle execute plan.
- **Reduce gaps to issues** (`reduce-gaps-to-issues.js`): When the top-up
  controller detects a deficit but has no eligible tasks, the gap reducer
  can produce new issue candidates.

---

## Testing

```bash
# Run focused tests
node scripts/ai/top-up-self-cycle-queue.test.js
```

Tests cover:
- Active worker counting (null, empty, mixed statuses)
- Ready task counting (null, empty, mixed states)
- Provider capacity extraction (null, empty, available, exhausted, at-capacity)
- Held lock counting (null, empty, mixed statuses)
- Conflict group extraction — active (null, running/planned vs completed)
- Conflict group extraction — locked (null, held vs released)
- Health gate checking (null, green, yellow, red, black)
- Risk level extraction (null, empty, low, medium, high, critical)
- Eligible task selection (null board, state filtering, linked PRs, conflict filtering, lock filtering, high-risk exclusion, defaults)
- Conflict group deduplication (empty, duplicates, no duplicates)
- Full plan integration (normal, health-blocked, risk-blocked, provider-exhausted, at-capacity, conflict filtering, next-tick, locked groups, null inputs, plan shape)
- CLI: help, validation errors, stdout output, fixture input, self-test flag
