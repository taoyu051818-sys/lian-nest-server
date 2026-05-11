# Launch Gate Policy Checker

Pre-launch validation that blocks workers from dispatching when main branch
health or batch metadata would cause failures. Integrated into
`batch-launch.ps1` — runs automatically before every worker dispatch.

> **Closes:** [#133](https://github.com/taoyu051818-sys/lian-nest-server/issues/133)
> **Closes:** [#145](https://github.com/taoyu051818-sys/lian-nest-server/issues/145)

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
5. **Running-worker conflict** — tasks whose `conflictGroup` matches an active
   worker's group are blocked (when a running tasks manifest is provided).

The checker produces a structured report and exits with code 0 (all clear) or
1 (at least one task blocked or conflict detected).

### Input formats

The task file may contain either:

- **A single task object** — a bare JSON object `{ ... }`.
- **A task array** — a JSON array `[{ ... }, { ... }]`.

Both forms are normalized internally. All optional fields (`reason`,
`conflictGroup`, `sharedLocks`, `risk`, `targetIssue`, `taskType`,
`mainHealthPolicy`, `allowedFiles`) are accessed with strict-mode-safe
property resolution, so missing fields default gracefully instead of
throwing.

### Pure JSON output

When `-Json` is passed, the script emits **only** the JSON report to stdout.
All diagnostic and progress messages (`[step]`, `[warn]`, etc.) are
suppressed. Fatal errors are written to stderr so that downstream consumers
can parse stdout without filtering.

---

## Usage

```powershell
# Basic: check a batch against current main health
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json

# Override health state (offline / CI testing)
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json -MainState red

# Check against running workers manifest
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json -RunningTasksFile ./active-workers.json

# JSON output for downstream consumers
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json -Json
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `TaskFile` | Yes | — | Path to task JSON (single object or array). |
| `HealthFile` | No | `./.github/ai-state/main-health.json` | Path to main health marker. |
| `MainState` | No | — | Override health state. Ignored when `HealthFile` exists. |
| `RunningTasksFile` | No | — | Path to running workers manifest JSON. When provided, tasks whose `conflictGroup` matches an active worker are blocked. |
| `Json` | No | `$false` | Output report as JSON instead of console text. When set, all diagnostic messages are suppressed on stdout (errors go to stderr). |

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

### Running-worker conflict

When a `-RunningTasksFile` manifest is provided, the checker blocks any task
whose `conflictGroup` matches an already-active worker group. This prevents the
self-cycle from scheduling work that collides with in-flight tasks.

The running tasks file format is a JSON array of objects:

```json
[
  { "conflictGroup": "auth-core", "issue": 258, "branch": "claude/wave6-..." },
  { "conflictGroup": "posts", "issue": 260, "branch": "claude/wave6-..." }
]
```

Only the `conflictGroup` field is required; `issue` and `branch` are optional
metadata included in the report for traceability. When the file is omitted,
running-worker detection is skipped entirely — the guard remains non-destructive
and does not require live GitHub state.

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
      "allowed": true,
      "reason": null
    }
  ],
  "duplicateConflictGroups": [],
  "sharedLockConflicts": [],
  "runningWorkerConflicts": [],
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

The launch gate is wired into `batch-launch.ps1` and runs automatically
before every worker dispatch:

```
batch-launch.ps1 -TaskFile <file> [-Execute]
       │
       ▼
 check-launch-gate.ps1  ◄── runs automatically
       │
  pass │   fail → execute mode refuses, dry-run warns
       ▼
 git worktree → run-claude-print.ps1 → worker
```

### How it works

1. `batch-launch.ps1` loads and validates the task JSON.
2. It invokes `check-launch-gate.ps1 -TaskFile <file> -Json` and captures
   the structured report.
3. **Dry-run mode**: the gate decision is displayed for review. Blocked
   tasks show a warning but do not prevent the dry-run summary from
   printing.
4. **Execute mode**: if the gate reports `allAllowed: false`, the launcher
   exits with an error before creating the worktree.

### Overriding the health file path

Pass `-MainHealthStatePath` to `batch-launch.ps1` to point at a custom
health marker location. If the file does not exist, the gate defaults to
green (same as `check-launch-gate.ps1` behavior).

---

## References

- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
- [parallel-work-policy.md](parallel-work-policy.md) — Conflict groups and parallelism rules.
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema.
- [write-main-health-state.ps1](../scripts/ai/write-main-health-state.ps1) — Health marker writer.
- [batch-launch.ps1](../scripts/ai/batch-launch.ps1) — Worker batch launcher.
