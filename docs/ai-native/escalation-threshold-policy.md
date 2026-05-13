# Failure Escalation Threshold Policy

Defines graduated escalation thresholds for self-cycle task failures. When a
task fails repeatedly, the system escalates through progressively more
restrictive actions rather than retrying the same approach indefinitely.

> **Closes:** [#1413](https://github.com/taoyu051818-sys/lian-nest-server/issues/1413)
>
> **Source:** Symphony agent escalation model
> (Performer->Conductor->Score->Composer). Adapted for LIAN self-cycle
> where the escalation chain is: retry -> rescope -> reduce-autonomy -> halt.

---

## Problem

The current self-cycle runner treats every failure the same: defer the task,
log it, and wait for human intervention. There is no mechanism to:

1. Track how many times a specific task has failed.
2. Escalate behavior after repeated failures.
3. Automatically reduce autonomy or halt when a task is stuck.

This means a task that fails 5 times with the same error gets the same
treatment as a task that fails once. Wasted cycles accumulate.

---

## Escalation Levels

| Level | Threshold | Action | Reversible |
|-------|-----------|--------|:----------:|
| **L0: Retry** | 1 failure | Log, defer, allow relaunch unchanged | Yes |
| **L1: Rescope** | 2 failures | Relaunch with reduced scope (narrower `allowedFiles`) | Yes |
| **L2: Reduce Autonomy** | 3 failures | Downgrade worker type, add human review gate | Yes |
| **L3: Halt** | 5 failures | Stop task, create escalation issue for human | No |

### Level Details

#### L0: Retry (1 failure)

Standard behavior. The task is deferred and may be relaunched in the next
wave without modification. The failure is recorded in the escalation tracker.

**What changes:** Nothing. This is the current behavior.

#### L1: Rescope (2 failures)

The same task has failed twice. The system relaunches with a narrower scope
to reduce the blast radius and increase the chance of success.

**Automatic actions:**
- Narrow `allowedFiles` to the most specific subset from previous failures.
- If the failure classifier identified a specific error class, add that
  area to `forbiddenFiles` to avoid repeating the same approach.
- Log the rescope decision with before/after `allowedFiles` diff.

**Example:** A task with `allowedFiles: ["src/**", "docs/**"]` that fails
twice on `src/modules/auth/` gets rescoped to
`allowedFiles: ["docs/**"]` with `forbiddenFiles: ["src/modules/auth/**"]`.

#### L2: Reduce Autonomy (3 failures)

Three consecutive failures indicate the task may be harder than the worker
can handle autonomously. The system downgrades the worker's autonomy.

**Automatic actions:**
- Set `humanRequired: true` in the task contract.
- Downgrade `risk` to `high` (forces human review gate).
- Add `escalation: reduced-autonomy` label to the issue.
- The launch gate will require explicit human approval before dispatch.

#### L3: Halt (5 failures)

Five consecutive failures means the task is stuck. Continuing to retry wastes
cycles and may mask other problems.

**Automatic actions:**
- Mark the task as `escalation: halted` in the issue.
- Create a new escalation issue with full failure history.
- Remove the task from the active queue.
- Notify the human operator via issue comment.

---

## Tracking

Failure counts are tracked per issue number in a state file:

```
.github/ai-state/escalation-tracker.json
```

### Schema

```json
{
  "version": 1,
  "entries": {
    "1413": {
      "issueNumber": 1413,
      "failureCount": 2,
      "currentLevel": "L1",
      "lastFailureAt": "2026-05-13T10:00:00Z",
      "lastErrorClass": "PROVIDER_UNAVAILABLE",
      "history": [
        {
          "failureAt": "2026-05-13T09:00:00Z",
          "errorClass": "PROVIDER_UNAVAILABLE",
          "workerType": "execution",
          "step": "batch-launch"
        },
        {
          "failureAt": "2026-05-13T10:00:00Z",
          "errorClass": "PROVIDER_UNAVAILABLE",
          "workerType": "execution",
          "step": "batch-launch"
        }
      ]
    }
  }
}
```

### Reset Conditions

The failure count resets to 0 when:
- The task succeeds (PR merges successfully).
- The human operator explicitly resets via `--reset <issue-number>`.
- The task is rescoped (L1 action) — count resets after rescope to give
  the narrower scope a fresh chance.

---

## Integration Points

### classify-self-cycle-failure.js

The existing failure classifier produces the `errorClass` that feeds into
the escalation tracker. After classification, the tracker increments the
count and determines the escalation level.

### run-self-cycle.ps1

The self-cycle runner consults the escalation tracker before dispatching
a task. At each level:

| Runner Step | Escalation Check |
|-------------|-----------------|
| Step 3 (Launch Gate) | If L2+, require human confirmation even in `-Execute` mode |
| Step 4 (Batch Launch) | If L3, skip the task and log escalation |
| Step 5 (Summary) | Include escalation status in cycle report |

### check-launch-gate.ps1

The launch gate reads escalation level and applies additional constraints:

| Level | Gate Behavior |
|-------|--------------|
| L0 | Normal gate checks |
| L1 | Normal gate checks (rescope already applied) |
| L2 | Force `humanRequired: true`, downgrade worker permissions |
| L3 | Block with `escalation-halted` reason |

### Issue Labels

| Level | Labels Added |
|-------|-------------|
| L0 | (none) |
| L1 | `escalation:rescoped` |
| L2 | `escalation:reduced-autonomy` |
| L3 | `escalation:halted` |

---

## Operator Controls

### Manual Reset

```bash
node scripts/ai/track-failure-escalation.js --reset 1413
```

Resets failure count to 0 and removes escalation labels.

### View Status

```bash
node scripts/ai/track-failure-escalation.js --status 1413
```

Shows current escalation level, failure count, and history.

### Force Level

```bash
node scripts/ai/track-failure-escalation.js --set-level L0 --issue 1413
```

Override the escalation level (e.g., to clear a halt after human review).

---

## Failure Count Window

Failure counts use a **rolling 24-hour window**. Failures older than 24
hours are pruned from the count. This prevents old failures from
triggering escalation on tasks that were paused and resumed later.

```
Failure at T=0h   -> count = 1 (L0)
Failure at T=1h   -> count = 2 (L1)
Failure at T=25h  -> count = 1 (L0, first failure pruned)
```

---

## Relationship to Existing Policies

| Policy | Interaction |
|--------|-------------|
| [Failure Taxonomy Policy](failure-taxonomy-policy.md) | Error classes from the taxonomy feed escalation decisions |
| [Main Health Policy](main-health-policy.md) | Health state overrides escalation (red always blocks) |
| [Parallel Recovery Policy](parallel-recovery-policy.md) | Escalated tasks may trigger recovery workers |
| [Launch Gate](launch-gate.md) | Gate enforces escalation-level constraints |
| [Worker Task Contract](worker-task-contract.md) | Escalation adds fields to the task contract |
| [Human Gate](human-intake-human-gate.md) | L2+ always requires human gate |

---

## Anti-Patterns

1. **Infinite retry without escalation.** Every task must have a ceiling.
   The default ceiling is 5 failures in 24 hours.

2. **Immediate halt on first failure.** Transient failures (provider
   outage, disk pressure) are expected. L0 handles these.

3. **Rescope that removes all scope.** If rescope would leave
   `allowedFiles` empty, skip to L2 instead.

4. **Escalation without history.** Every escalation decision must record
   the failure history so humans can diagnose.

---

## Current State

This is the **investigation and policy definition** (issue #1413).

### Defined

- [x] Four escalation levels (L0-L3)
- [x] Threshold values (1, 2, 3, 5 failures)
- [x] Rolling 24-hour failure window
- [x] State file schema
- [x] Integration points with existing scripts
- [x] Operator controls (reset, status, force-level)
- [x] Reset conditions
- [x] Label conventions

### Future Slices

- [ ] `track-failure-escalation.js` script implementation
- [ ] Integration with `run-self-cycle.ps1` runner
- [ ] Integration with `check-launch-gate.ps1` gate
- [ ] Escalation issue auto-creation at L3
- [ ] WebUI escalation status panel

---

## References

- [Failure Taxonomy](failure-taxonomy.md) — Health gate failure categories
- [Failure Taxonomy Policy](failure-taxonomy-policy.md) — Extended classification for self-healing
- [Self-Cycle Runner](self-cycle-runner.md) — Loop orchestrator
- [Loop Model](loop-model.md) — Self-cycle phases
- [Main Health Policy](main-health-policy.md) — Health states and worker permissions
- [Parallel Recovery Policy](parallel-recovery-policy.md) — Recovery task decomposition
- [Launch Gate](launch-gate.md) — Pre-dispatch validation
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
