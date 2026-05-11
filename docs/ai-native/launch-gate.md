# Launch Gate Policy Checker

Pre-launch validation that blocks workers from dispatching when main branch
health or batch metadata would cause failures. Runs as a dry-run gate before
`batch-launch.ps1`.

> **Closes:** [#133](https://github.com/taoyu051818-sys/lian-nest-server/issues/133)

---

## Overview

The launch gate checker reads a task JSON file and validates every task against:

1. **Main health state** — the `green / yellow / red / black` marker written by
   [write-main-health-state.ps1](../scripts/ai/write-main-health-state.ps1).
2. **Worker type policy** — the matrix defined in
   [main-health-policy.md](main-health-policy.md).
3. **Conflict group uniqueness** — no two tasks in the same batch may share a
   `conflictGroup`.
4. **Shared lock overlap** — tasks declaring the same `sharedLocks` entry are
   flagged as conflicting (when the field is present).

The checker produces a structured report and exits with code 0 (all clear) or
1 (at least one task blocked or conflict detected).

---

## Usage

```powershell
# Basic: check a batch against current main health
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json

# Override health state (offline / CI testing)
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json -MainState red

# JSON output for downstream consumers
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json -Json
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `TaskFile` | Yes | — | Path to task JSON (single object or array). |
| `HealthFile` | No | `./.github/ai-state/main-health.json` | Path to main health marker. |
| `MainState` | No | — | Override health state. Ignored when `HealthFile` exists. |
| `Json` | No | `$false` | Output report as JSON instead of console text. |

---

## Worker Type Classification

Each task is classified into a worker type. The checker uses this priority:

1. **Explicit `mainHealthPolicy` field** (backend tasks):
   - `"gate-all"` → classified as a runtime/feature worker
   - `"gate-docs-only"` → classified as a docs worker
   - `"gate-none"` → classified as a research worker

2. **Heuristic** (when `mainHealthPolicy` is absent):
   - `taskType: "research"` → `research`
   - `allowedFiles` exclusively under `docs/` → `docs`
   - `allowedFiles` exclusively under `scripts/` (no `src/`) → `health-repair`
   - `allowedFiles` includes `src/` with `risk: "high"` → `foundation-fix`
   - `allowedFiles` includes `src/` otherwise → `runtime-feature`
   - Fallback → `health-repair`

---

## Launch Permission Matrix

Matches [main-health-policy.md](main-health-policy.md).

| Worker Type | Green | Yellow | Red | Black |
|-------------|:-----:|:------:|:---:|:-----:|
| Runtime feature | Yes | No | No | No |
| Foundation fix | Yes | Yes | Yes | No |
| Docs | Yes | Yes | No | No |
| Health / CI repair | Yes | Yes | Yes | No |
| Test-only | Yes | Yes | No | No |
| Research | Yes | Yes | Yes | No |

**Key rules enforced:**

- Main **red** blocks runtime workers. Foundation fix and health-repair workers
  remain allowed to recover the broken state.
- Main **yellow** blocks runtime, test-only, and refactor workers. Docs and
  repair workers continue.
- Main **black** blocks everything — requires manual intervention.
- Docs tasks are explicitly allowed in yellow because they cannot worsen a
  build failure.

---

## Conflict Detection

### Duplicate conflictGroup

Tasks in the same batch must not share a `conflictGroup`. This prevents the
orchestrator from accidentally launching two workers that would edit overlapping
files concurrently. See [parallel-work-policy.md](parallel-work-policy.md).

### SharedLocks overlap

Tasks may declare a `sharedLocks` array (optional field). If two tasks in the
same batch claim the same lock, the checker flags a conflict. This extends the
conflict group model to finer-grained resource locks.

---

## Report Format

### Console output

```
========================================
  Launch Gate Report
========================================

Main state: green
Tasks evaluated: 3

  issue #68  [ALLOW]  type=foundation-fix  group=runtime-foundation  risk=high
  issue #70  [ALLOW]  type=docs  group=ai-native-docs  risk=low
  issue #73  [BLOCK]  type=runtime-feature  group=feature-feed  risk=medium
    reason: Worker type 'runtime-feature' is not permitted when main is red.

Gate CHECK FAILED — one or more tasks blocked or conflicts detected.
```

### JSON output (`-Json`)

```json
{
  "reportVersion": 1,
  "capturedAt": "2026-05-11T12:00:00.000Z",
  "mainState": "green",
  "taskCount": 3,
  "tasks": [
    {
      "targetIssue": 68,
      "conflictGroup": "runtime-foundation",
      "risk": "high",
      "workerType": "foundation-fix",
      "mainState": "green",
      "allowed": true
    }
  ],
  "duplicateConflictGroups": [],
  "sharedLockConflicts": [],
  "allAllowed": true
}
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tasks cleared for launch. |
| 1 | At least one task blocked or conflict detected. |
| 2 | Bad arguments or unreadable task file. |

---

## Integration

The launch gate sits between the orchestrator's planning phase and
`batch-launch.ps1`:

```
Orchestrator (plan tasks)
       │
       ▼
 check-launch-gate.ps1  ◄── this script
       │
  pass │   fail → defer blocked tasks, resolve conflicts
       ▼
 batch-launch.ps1 -Execute
       │
       ▼
 run-claude-print.ps1 → worker
```

The checker is intentionally **not wired** into `batch-launch.ps1` yet.
The orchestrator calls it manually or via a future integration step.

---

## References

- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
- [parallel-work-policy.md](parallel-work-policy.md) — Conflict groups and parallelism rules.
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema.
- [write-main-health-state.ps1](../scripts/ai/write-main-health-state.ps1) — Health marker writer.
- [batch-launch.ps1](../scripts/ai/batch-launch.ps1) — Worker batch launcher.
