# Worker Lifecycle State Machine

Explicit, auditable state machine for worker lifecycle transitions.
Inspired by LangGraph's DAG model to eliminate status inconsistency bugs.

## Problem

The worker lifecycle uses a free-form `status` field in `active-workers.json`.
Without explicit transition rules, scripts can set any status at any time,
leading to:
- Stale `running` workers that should be `stale` or `failed`
- `completed` workers that were never actually verified
- `blocked` workers that silently become `running` without unblock evidence
- No audit trail of who changed what and why

## State Machine

```
                         +---------+
                         | planned |
                         +---------+
                          /   |   \
                         /    |    \
                        v     v     v
                  +-------+  |  +--------+
                  |blocked|  |  | failed |  (terminal)
                  +-------+  |  +--------+
                     ^       v
                     |  +---------+       +-----------+
                     +--| running |------>| completed | (terminal)
                        +---------+       +-----------+
                         ^  |   ^
                         |  |   |
                         |  v   |
                     +--------+ |
                     | stale  +-+
                     +--------+
                         ^
                         |
                     +-----------+
                     |needs-human|
                     +-----------+
```

### States

| State | Meaning | Terminal |
|-------|---------|----------|
| `planned` | Worker is queued but not yet started | No |
| `running` | Worker process is actively executing | No |
| `stale` | Worker process alive but no output for >5 min | No |
| `blocked` | Worker cannot proceed due to unresolved dependency | No |
| `needs-human` | Worker requires human intervention to continue | No |
| `completed` | Worker exited with code 0, result verified | **Yes** |
| `failed` | Worker exited non-zero or was terminated | **Yes** |

### Terminal States

`completed` and `failed` are terminal states. Once a worker reaches either
state, no further transitions are allowed. This prevents resurrection of
finished workers.

## Valid Transitions

| # | From | To | Trigger | Guard | Actor |
|---|------|----|---------|-------|-------|
| 1 | `planned` | `running` | Worker process starts | PID assigned, process spawned | batch-launcher |
| 2 | `planned` | `blocked` | Dependency not satisfied | blockedBy unresolved | launch-gate |
| 3 | `planned` | `failed` | Pre-launch validation fails | Launch gate check fails | launch-gate |
| 4 | `running` | `completed` | Process exits code 0 | Exit code 0, result file written | wait-parallel-workers |
| 5 | `running` | `failed` | Process exits non-zero | Exit code non-zero | wait-parallel-workers |
| 6 | `running` | `stale` | Heartbeat timeout | No output >5 min, process alive | heartbeat-monitor |
| 7 | `running` | `blocked` | Worker reports blocker | Blocker comment on issue | worker |
| 8 | `running` | `needs-human` | Worker needs intervention | Signal in output/result | worker |
| 9 | `stale` | `running` | Worker resumes output | New stdout/stderr detected | heartbeat-monitor |
| 10 | `stale` | `failed` | Stale process exits/terminated | Process exit or manual stop | recovery-worker |
| 11 | `stale` | `completed` | Stale process exits code 0 | Exit code 0 | wait-parallel-workers |
| 12 | `blocked` | `running` | Blocker resolved | blockedBy resolved | state-reconciler |
| 13 | `blocked` | `failed` | Blocked too long | Duration exceeds threshold | recovery-worker |
| 14 | `needs-human` | `running` | Human resolves and resumes | Human intervention complete | human |
| 15 | `needs-human` | `failed` | Human decides to fail | Human marks failed | human |

## Invalid Transitions

Any transition not listed above is invalid. Common invalid transitions:

| From | To | Why Invalid |
|------|----|-------------|
| `completed` | *(any)* | Terminal state |
| `failed` | *(any)* | Terminal state |
| `blocked` | `stale` | Stale is heartbeat-specific |
| `stale` | `blocked` | Use `stale` → `failed` → re-queue |
| `needs-human` | `stale` | No heartbeat in needs-human state |
| `planned` | `completed` | Must pass through `running` |
| `planned` | `stale` | Cannot be stale before running |

## Audit Requirements

Transitions with `auditRequired: true` must be logged. The audit record
includes:

- `timestamp`: ISO-8601 when the transition occurred
- `from`: Source state
- `to`: Target state
- `actor`: Who or what performed the transition
- `trigger`: What event caused it
- `guard`: What precondition was verified
- `issueNumber`: Linked GitHub issue
- `evidence`: Proof the guard was satisfied (exit code, heartbeat, comment URL)

## Integration Points

### batch-launch.ps1

Sets `planned` → `running` when spawning a worker. Must record PID and
`startedAt` timestamp.

### wait-parallel-workers.ps1

Detects process exit and transitions `running` → `completed` or `running` →
`failed` based on exit code.

### heartbeat-monitor (wait-claude-batch.ps1)

Transitions `running` → `stale` when no output exceeds threshold. Transitions
`stale` → `running` when output resumes.

### state-reconciler.ps1

Detects drift between actual state and expected state. Can transition
`blocked` → `running` when blockers are resolved.

### dispatch-recovery-worker.js

Detects stale workers and proposes `stale` → `failed` transitions for
recovery.

## Validation

The `validate-worker-transition.js` script checks whether a proposed
transition is valid:

```bash
node scripts/ai/validate-worker-transition.js --from running --to completed
# Exit 0: valid transition

node scripts/ai/validate-worker-transition.js --from completed --to running
# Exit 1: invalid transition (terminal state)
```

## Schema

The transition table is defined in:
- `schemas/worker-lifecycle-transitions.schema.json` — Schema definition
- `schemas/worker-lifecycle-transitions.json` — Transition table instance

## See Also

- [Active Workers State](active-workers-state.md) — Projection that stores current status
- [Worker Heartbeat](worker-heartbeat.md) — Heartbeat state machine for liveness
- [State Reconciler](state-reconciler.md) — Drift detection
- [Issue Lifecycle](issue-lifecycle.md) — Issue-level state machine
- [Recovery Worker](../../scripts/ai/dispatch-recovery-worker.js) — Stale worker detection
