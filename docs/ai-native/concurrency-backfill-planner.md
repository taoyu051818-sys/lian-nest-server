# Concurrency Backfill Planner

Plans enough independent tasks to reach target concurrency while respecting
provider slots, resource slots, conflict groups, locks, risk, review capacity,
and failure budget.

> **Closes:** [#1338](https://github.com/taoyu051818-sys/lian-nest-server/issues/1338)

---

## Problem

The self-cycle could request 30 workers but only had 5 executable issues.
Without a planner, the system either launches too few workers (wasting provider
capacity) or attempts to launch too many (hitting provider/resource limits and
conflict collisions). The concurrency backfill planner bridges this gap by
computing the effective parallelism and producing bounded wave plans.

## Goals

- Read current system facts (task board, provider pool, local resources,
  active workers, risk signals) and compute the effective parallelism.
- Produce wave plans where tasks sharing the same `conflictGroup` never run
  in the same wave.
- Force high-risk tasks into solo waves.
- Identify the limiting factor when effective parallelism is below requested.
- Keep the script read-only on system state — no workers launched, no issues
  modified.

## Non-Goals

- No changes to runtime backend code (`src/**`).
- No changes to Prisma schema.
- No changes to `package.json` or `package-lock.json`.
- No worker launching or PR creation.
- No mutation of `.github/ai-state/` files (plan-only output).

---

## Algorithm

### 1. Capacity Extraction

The planner reads capacity from four sources:

| Source | State file | Extraction |
|--------|-----------|------------|
| Provider slots | `provider-pool.json` | Count of `available` providers with `currentConcurrency < maxConcurrency` |
| Resource slots | `local-resource.json` | `process.maxAllowed` (defaults to 1 if missing) |
| Active workers | `active-workers.json` | Count of workers with status `running` or `planned` |
| Risk-safe slots | `risk-signals.json` | Full requested for low risk; half for medium; 1 for high/critical |

### 2. Effective Parallelism

```text
effectiveParallelism = min(
  requestedParallelism,
  providerSlots - activeWorkerCount,
  resourceSlots,
  conflictSafeSlots,
  riskSafeSlots,
  reviewCapacity,
  mergeCapacity,
  failureBudget
)
```

Missing or null state files are treated conservatively (1 slot). The planner
identifies which input is the binding constraint (the one whose value equals
the effective parallelism).

### 3. Task Filtering

The task board is filtered to executable tasks only:

- **Included:** `ready`, `todo`, `open`, `triage` states
- **Excluded:** `done`, `archived`, `running`, `blocked`, `discussion/open`
- **Excluded:** Tasks with a linked PR

### 4. Wave Planning

Tasks are organized into waves using greedy bin-packing:

1. **High-risk tasks** are separated into solo waves (one task per wave).
2. **Normal tasks** are packed greedily: for each wave, iterate remaining
   tasks and add a task if its `conflictGroup` is not already in the wave
   and the wave has not reached the parallelism cap.
3. Waves are produced until all tasks are placed.

Tasks sharing the same `conflictGroup` never appear in the same wave.

---

## Input Fixture Format

```json
{
  "taskBoard": {
    "tasks": [
      { "issue": 1, "state": "ready", "conflictGroup": "auth" },
      { "issue": 2, "state": "ready", "conflictGroup": "docs" }
    ]
  },
  "providerPool": {
    "providers": [
      { "id": "p1", "status": "available", "currentConcurrency": 0, "maxConcurrency": 30 }
    ]
  },
  "localResource": {
    "process": { "maxAllowed": 12 }
  },
  "activeWorkers": {
    "workers": [{ "status": "running", "issueNumber": 5 }]
  },
  "riskSignals": {
    "signals": [{ "severity": "low" }]
  }
}
```

All keys are optional; missing state is treated conservatively.

## Output Schema

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-13T00:00:00.000Z",
  "requestedParallelism": 30,
  "effectiveParallelism": 3,
  "limitingFactor": "failureBudget",
  "capacityInputs": {
    "requestedParallelism": 30,
    "providerSlots": 1,
    "resourceSlots": 12,
    "conflictSafeSlots": 4,
    "riskSafeSlots": 30,
    "reviewCapacity": 5,
    "mergeCapacity": 5,
    "failureBudget": 3
  },
  "executableTaskCount": 4,
  "activeWorkerCount": 1,
  "waves": [
    {
      "waveIndex": 0,
      "tasks": [
        { "issueNumber": 1, "conflictGroup": "auth", "risk": "low", "state": "ready" },
        { "issueNumber": 3, "conflictGroup": "docs", "risk": "low", "state": "ready" }
      ],
      "isSoloWave": false,
      "reason": null
    },
    {
      "waveIndex": 1,
      "tasks": [
        { "issueNumber": 2, "conflictGroup": "auth", "risk": "low", "state": "ready" }
      ],
      "isSoloWave": false,
      "reason": null
    }
  ],
  "summary": {
    "totalWaves": 2,
    "soloWaves": 0,
    "parallelWaves": 2,
    "totalPlannedTasks": 3,
    "effectiveParallelism": 3,
    "limitingFactor": "failureBudget"
  }
}
```

---

## Usage

```bash
# Show help
node scripts/ai/plan-concurrency-backfill.js --help

# Read from live state files, write to default output
node scripts/ai/plan-concurrency-backfill.js

# Read from live state files, print to stdout
node scripts/ai/plan-concurrency-backfill.js --stdout

# Read from fixture file
node scripts/ai/plan-concurrency-backfill.js --fixture fixture.json --stdout

# Custom requested parallelism
node scripts/ai/plan-concurrency-backfill.js --requested 10 --stdout

# Custom output path
node scripts/ai/plan-concurrency-backfill.js --out custom/path.json

# Run built-in self-tests
node scripts/ai/plan-concurrency-backfill.js --self-test
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Plan produced |
| 2 | Invalid arguments or missing inputs |

---

## Integration Points

- **Batch launcher** (`batch-launch.ps1`): Use the wave plan to determine
  how many workers to launch per wave and which tasks can run in parallel.
- **Conflict group allocator** (`allocate-conflict-groups.js`): The planner
  reads conflict groups assigned by the allocator from the task board.
- **Self-cycle execute plan** (`generate-self-cycle-execute-plan.js`): The
  backfill planner is an action within the self-cycle execute plan.
- **Launch gate** (`check-launch-gate.ps1`): The wave plan respects the same
  health gate and provider pool constraints.
- **Bounded parallel execution** (`bounded-parallel-worker-execution.md`):
  The effective parallelism formula matches the one documented there.

---

## Testing

```bash
# Run focused tests
node scripts/ai/plan-concurrency-backfill.test.js
```

Tests cover:
- Provider slot extraction (null, empty, available, exhausted, at-capacity)
- Resource slot extraction (null, missing, valid, zero, negative)
- Active worker counting (null, empty, mixed statuses)
- Risk-safe slot extraction (null, empty, low, medium, high, critical)
- Conflict-safe slot counting (empty, distinct groups, null groups)
- Task filtering (null board, exclude states, linked PRs, defaults)
- Wave planning (empty, non-conflicting, conflicting, high-risk solo, parallelism cap)
- Limiting factor identification
- Full integration plan (mixed inputs, null inputs, exhausted providers, high-risk)
- CLI: help, validation errors, stdout output, fixture input, self-test flag
