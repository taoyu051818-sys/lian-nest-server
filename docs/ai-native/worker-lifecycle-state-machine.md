# Worker Lifecycle State Machine

Explicit state machine transitions for the worker lifecycle in the active-workers projection. Prevents status inconsistency by making transitions auditable and rejecting invalid state changes.

## Problem

The worker status field in `active-workers.json` was a free-form enum — any status could be set to any other status without validation. This caused occasional stale status bugs where workers ended up in inconsistent states (e.g., `completed` without going through `running`, or `failed` workers that could be incorrectly moved back to `running`).

## Solution

Define all valid transitions explicitly as a DAG. Any status change not in the transition table is rejected. This is inspired by LangGraph's DAG-based state machine model for agent workflows.

## State Diagram

```
                    ┌──────────┐
                    │ planned  │
                    └────┬─────┘
                         │ launch
                         v
                    ┌──────────┐
         ┌─────────│ running  │─────────┐
         │         └────┬─────┘         │
         │              │               │
    no output       exit code 0     exit code != 0
    > 5 min              │           or error
         │               v               │
         │         ┌──────────┐          │
         └────────>│completed │          v
                   └──────────┘    ┌──────────┐
                                   │  failed  │
                                   └──────────┘

         ┌──────────┐         ┌──────────┐
         │  stale   │         │ blocked  │
         └────┬─────┘         └────┬─────┘
              │                    │
    resumed / blocker        blocker resolved
    identified               or abandoned
              │                    │
              v                    v
         ┌──────────┐         ┌──────────┐
         │ running  │         │ running  │
         └──────────┘         │ or failed│
                              └──────────┘

         ┌──────────┐
         │needs-human│
         └────┬─────┘
              │
    human resolved
    or abandoned
              │
              v
         ┌──────────┐
         │ running  │
         │ or failed│
         └──────────┘
```

## States

| State | Terminal | Description |
|-------|----------|-------------|
| `planned` | No | Worker is scheduled but not yet started. |
| `running` | No | Worker process is active and producing output. |
| `completed` | Yes | Worker finished successfully (exit code 0). |
| `failed` | Yes | Worker exited with non-zero code or encountered an unrecoverable error. |
| `stale` | No | Worker process is alive but has produced no output beyond the stale threshold. Informational — no kill. |
| `blocked` | No | Worker cannot proceed due to an external dependency or decision. |
| `needs-human` | No | Worker requires human intervention to continue. |

## Valid Transitions

| From | To | Trigger | Reason Required |
|------|----|---------|-----------------|
| `planned` | `running` | Worker process launched by batch-launcher. | No |
| `running` | `completed` | Worker process exited with code 0. | No |
| `running` | `failed` | Worker process exited with non-zero code or hit unrecoverable error. | Yes |
| `running` | `stale` | No output detected beyond stale threshold (default 5 min). | No |
| `running` | `blocked` | External dependency or decision prevents progress. | Yes |
| `running` | `needs-human` | Worker requires human intervention to continue. | Yes |
| `stale` | `running` | Worker resumed producing output. | No |
| `stale` | `failed` | Worker process died or was terminated while stale. | Yes |
| `stale` | `blocked` | Stale worker identified as blocked on external dependency. | Yes |
| `blocked` | `running` | Blocker resolved, worker can resume. | No |
| `blocked` | `failed` | Blocker cannot be resolved, worker abandoned. | Yes |
| `needs-human` | `running` | Human resolved the issue, worker can resume. | No |
| `needs-human` | `failed` | Human decided to abandon the worker. | Yes |

## Invalid Transitions (examples)

These transitions are **rejected** by the validator:

| From | To | Why Invalid |
|------|----|-------------|
| `completed` | `running` | Terminal state — no outgoing transitions. |
| `failed` | `running` | Terminal state — no outgoing transitions. |
| `completed` | `failed` | Terminal-to-terminal — not allowed. |
| `planned` | `completed` | Must go through `running` first. |
| `planned` | `failed` | Must go through `running` first. |
| `blocked` | `completed` | Must go through `running` first. |

## Invariants

1. **Terminal states have no outgoing transitions.** Once a worker reaches `completed` or `failed`, it cannot change state.
2. **Every non-terminal state has at least one outgoing transition.** Workers cannot get stuck in a dead-end non-terminal state.
3. **`running` is the only gateway to terminal states.** Workers must be `running` before they can `complete` or `fail`.
4. **Reason is required for failure-related transitions.** Transitions to `failed`, `blocked`, and `needs-human` from `running` require a human-readable reason for audit.

## Usage

### Validate a Transition

```bash
node scripts/ai/validate-worker-transition.js --from running --to completed --stdout
```

### Validate with Reason

```bash
node scripts/ai/validate-worker-transition.js --from running --to failed --reason "exit code 1" --stdout
```

### List All Valid Transitions

```bash
node scripts/ai/validate-worker-transition.js --list-transitions
```

### Run Tests

```bash
node scripts/ai/validate-worker-transition.test.js
```

## Integration Points

### batch-launch.ps1

Sets `status = "planned"` on dry-run manifests, `status = "running"` on execute. These are valid transitions (`planned -> running`).

### wait-parallel-workers.ps1

Sets `completed`/`failed` based on exit code, `stale` when process exceeds stale threshold. All are valid transitions from `running`.

### state-reconciler.ps1

Detects drift between issue labels and worker projection. Can suggest label transitions but does not directly mutate worker status.

### control-workers.ps1

Manages worker processes via PID. Does not change worker status — that responsibility belongs to the wait/batch scripts.

## Files

| File | Purpose |
|------|---------|
| `schemas/worker-lifecycle-state-machine.schema.json` | JSON Schema defining the state machine structure. |
| `scripts/ai/worker-lifecycle-state-machine.json` | State machine data with states and valid transitions. |
| `scripts/ai/validate-worker-transition.js` | CLI validator for transition requests. |
| `scripts/ai/validate-worker-transition.test.js` | Self-tests for the validator. |
| `docs/ai-native/worker-lifecycle-state-machine.md` | This document. |
