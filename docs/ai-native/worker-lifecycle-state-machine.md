# Worker Lifecycle State Machine

Explicit state machine transitions for the active-workers status field.
Inspired by LangGraph DAG-based state machines for auditable, deterministic
lifecycle management.

## Problem

The active-workers projection defines seven status values (`planned`,
`running`, `completed`, `failed`, `stale`, `blocked`, `needs-human`) but
has no defined transition table. Any script can set any status at any time.
The only guard is the JSON Schema `enum` constraint, which prevents invalid
values but does not enforce valid transitions. This leads to:

- Stale status values that no writer updates
- Inconsistent state when multiple scripts write the projection
- No audit trail for how a worker reached its current state

## State Machine

```
                    ┌───────────┐
                    │   null    │  (initial: status not set)
                    └─────┬─────┘
                          │
                ┌─────────┴─────────┐
                ▼                   ▼
          ┌──────────┐        ┌──────────┐
          │ planned  │        │ running  │
          └────┬─────┘        └────┬─────┘
               │                   │
               │    ┌──────────────┼──────────────┬──────────────┐
               │    │              │              │              │
               │    ▼              ▼              ▼              ▼
               │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐
               │ │completed │ │  failed  │ │  stale   │ │  blocked   │
               │ │(terminal)│ │(terminal)│ │(terminal)│ │(recoverable)│
               │ └──────────┘ └──────────┘ └──────────┘ └─────┬──────┘
               │                                               │
               │                   ┌───────────────────────────┤
               │                   ▼                           ▼
               │           ┌──────────────┐           ┌──────────────┐
               │           │needs-human   │           │   running    │
               │           │(recoverable) │           │  (resumed)   │
               │           └──────┬───────┘           └──────────────┘
               │                  │
               └──────────────────┘
                    (planned → failed if launch fails)
```

## State Definitions

| State | Classification | Description |
|-------|---------------|-------------|
| `null` | initial | Status not yet set. Worker entry exists but has not been launched. |
| `planned` | transient | Worker is scheduled but not yet launched (dry-run output). |
| `running` | active | Worker process is alive and executing. |
| `completed` | terminal | Worker finished successfully (exit code 0). |
| `failed` | terminal | Worker exited with error (non-zero exit code, parse failure, missing result). |
| `stale` | terminal | Worker process is alive but exceeded the stale time threshold. |
| `blocked` | recoverable | Worker is blocked from progressing but may resume. |
| `needs-human` | recoverable | Worker requires human intervention but may resume. |

## Transition Table

| From | To | Trigger | Source |
|------|----|---------|--------|
| `null` | `planned` | `launch` | batch-launch.ps1 dry-run |
| `null` | `running` | `execute` | batch-launch.ps1 execute |
| `planned` | `running` | `execute` | batch-launch.ps1 execute |
| `planned` | `failed` | `exit-failure` | wait-parallel-workers.ps1 (no process found) |
| `running` | `completed` | `exit-success` | wait-parallel-workers.ps1 (exit code 0) |
| `running` | `failed` | `exit-failure` | wait-parallel-workers.ps1 (non-zero exit, parse error) |
| `running` | `stale` | `stale-timeout` | wait-parallel-workers.ps1 (exceeded stale threshold) |
| `running` | `blocked` | `block` | state-reconciler.ps1 or orchestrator |
| `running` | `needs-human` | `human-flag` | orchestrator or WebUI |
| `blocked` | `running` | `relaunch` | human or reconciler unblock |
| `blocked` | `failed` | `exit-failure` | human or reconciler determine failure |
| `needs-human` | `running` | `manual-override` | human resolves issue |
| `needs-human` | `failed` | `exit-failure` | human determines failure |

## Invalid Transitions

These transitions are explicitly rejected:

- **Terminal → anything**: `completed`, `failed`, and `stale` are final states. Workers in these states cannot transition to any other status. A relaunch creates a new worker entry, not a status mutation.
- **Regressions**: `running` cannot return to `planned`. A worker that has been launched cannot be un-launched.
- **Self-transitions**: No state can transition to itself.
- **Cross-terminal jumps**: `blocked` and `needs-human` cannot jump directly to `completed` or `stale`. They must go through `running` first.

## Validator

`scripts/ai/validate-worker-transition.js` validates transitions against this
state machine. It is a deterministic, local-logic script with no network calls.

### Usage

```bash
# Validate a transition
node scripts/ai/validate-worker-transition.js --from running --to completed --stdout

# Validate with trigger for audit
node scripts/ai/validate-worker-transition.js --from running --to stale --trigger stale-timeout

# Run self-tests
node scripts/ai/validate-worker-transition.test.js
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Transition is valid |
| 1 | Transition is invalid |
| 2 | Invalid arguments |

### Integration

Scripts that update the active-workers status should validate the transition
before writing:

```javascript
const { validateTransition } = require('./validate-worker-transition.js');

const result = validateTransition(currentStatus, newStatus, trigger);
if (!result.valid) {
  console.error(`Invalid transition: ${result.reason}`);
  process.exit(1);
}
```

## Schema

The transition table is formalized in
`schemas/worker-lifecycle-transitions.schema.json`. This schema defines:

- All valid states and their classification (initial, transient, active, terminal, recoverable)
- The complete transition table with triggers
- The result shape for validation outcomes

## Design Decisions

### Why explicit transitions?

The previous free-form status updates had no guard rails. An explicit state
machine:

1. **Makes transitions auditable** — every status change has a defined trigger
2. **Prevents inconsistency** — invalid transitions are rejected at the boundary
3. **Enables safe reconciliation** — the state reconciler can validate its own
   remediation actions before applying them

### Why terminal states?

`completed`, `failed`, and `stale` are terminal because:

- A completed worker's work is done; re-opening it would create ambiguity
- A failed worker should be relaunched as a new entry, not mutated
- A stale worker is a signal for reconciliation, not for self-healing

This matches the behavior in `wait-parallel-workers.ps1` (line 77) which
skips workers in terminal states.

### Why recoverable states?

`blocked` and `needs-human` are recoverable because they represent temporary
conditions that may resolve. A blocked worker may become unblocked; a
needs-human worker may receive human guidance. Both can resume to `running`.

### Validator as boundary check

The validator is designed as a boundary check, not a middleware. Scripts call
it before writing status updates. This keeps the state machine definition
separate from the scripts that consume it, allowing the transition table to
evolve independently.

## Files

| File | Purpose |
|------|---------|
| `schemas/worker-lifecycle-transitions.schema.json` | JSON Schema for the transition table |
| `scripts/ai/validate-worker-transition.js` | Transition validator script |
| `scripts/ai/validate-worker-transition.test.js` | Self-tests for the validator |
| `docs/ai-native/worker-lifecycle-state-machine.md` | This document |

## See Also

- [Active Workers State](active-workers-state.md) — Projection semantics
- [Worker Heartbeat](worker-heartbeat.md) — Heartbeat state machine
- [State Reconciler](state-reconciler-active-workers.md) — Drift detection
- [Worker Assignment Ledger](worker-assignment-ledger-schema.md) — Assignment lifecycle
