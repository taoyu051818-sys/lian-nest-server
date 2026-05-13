# Failure Escalation Thresholds

Investigates the gap between LIAN's current per-gate blocking model and a
chained escalation model where repeated failures trigger progressively
stronger responses.

> **Closes:** [#1438](https://github.com/taoyu051818-sys/lian-nest-server/issues/1438)
>
> **Status:** Research. No code changes proposed yet.
>
> **See also:** [loop-model.md](loop-model.md), [failure-taxonomy-policy.md](failure-taxonomy-policy.md),
> [self-healing.md](self-healing.md), [guarded-autopilot-execute-policy.md](guarded-autopilot-execute-policy.md)

---

## Problem Statement

LIAN's self-cycle runner blocks on individual gate failures but does not
track cumulative failure counts for a given task or failure class. If a
worker fails, the current behavior is:

- Health gate red -> block cycle, wait for human.
- Launch gate blocked -> defer task, wait for human.
- Worker exits non-zero -> log, defer task.

There is no mechanism that says "this task has failed 3 times, escalate
the response." The runner retries the same approach until a human
intervenes or the health gate turns red.

### Symphony Reference Pattern

The Symphony agent architecture defines a 4-tier escalation chain:

| Tier | Role | Trigger |
|------|------|---------|
| 1 | Performer | Executes the task |
| 2 | Conductor | Performer fails; reassigns with feedback |
| 3 | Score | Cross-goal conflict or repeated conductor failure |
| 4 | Composer | Architectural impact or systemic failure |

Key behaviors:
- On failure, tasks are reassigned with feedback and an incremented
  iteration count.
- Cross-goal conflicts escalate to Score.
- Architectural impacts escalate to Composer.
- Any agent can escalate to Researcher for deep analysis.

LIAN has no equivalent of the iteration count or escalation chain.

---

## Current Escalation-Related Components

### Failure Classifier (`classify-self-cycle-failure.js`)

Defines 9 error classes with `safeToRetry` flags. Three are retryable:

| Error Class | safeToRetry |
|-------------|-------------|
| `PROVIDER_UNAVAILABLE` | true |
| `DISK_PRESSURE` | true |
| `WORKTREE_STALE` | true |

The classifier produces a single classification per invocation. It does
not track how many times the same classification has occurred.

### Health Gate Loop Model (`loop-model.md`)

One escalation threshold exists:

> Health gate stays red >2 cycles -> stop auto-launch, enter fallback.

This is the only cumulative failure check in the system. It applies to
the health gate state, not to individual task failures.

### Recovery Worker Dispatch (`dispatch-recovery-worker.js`)

Detects stale workers (30-minute threshold) and proposes re-dispatch.
Does not track how many times a worker has been re-dispatched for the
same issue.

### Autonomy Handoff Events (`write-autonomy-handoff-fact.js`)

Records transitions between autonomy levels:
- `codex-to-self-cycle`
- `manual-to-autonomous`
- `autonomous-to-fallback`
- `health-gate-pass`
- `health-gate-block`

These events are logged but not counted or threshold-checked.

### Guarded Autopilot (`guarded-autopilot-execute-policy.md`)

On worker failure: "worktree preserved, no auto-retry." This is a
single-failure policy with no escalation path.

---

## Gap Analysis

| Capability | Symphony | LIAN Current |
|------------|----------|--------------|
| Failure counter per task | Yes (iteration count) | No |
| Escalation chain (tiered roles) | 4 tiers | Single gate (block/allow) |
| Different approach on retry | Yes (reassign with feedback) | No (same approach retried) |
| Autonomy reduction on repeated failure | Implicit (escalate to higher role) | No |
| Hard stop with human alert | Yes (Composer level) | Only on health-gate red >2 cycles |
| Cross-goal conflict escalation | Yes (to Score) | No |
| Deep analysis escalation | Yes (to Researcher) | No |

---

## Proposed Threshold Model

Three escalation tiers mapped to LIAN's existing concepts:

### Tier 1: Retry with Different Approach (2 failures)

**Trigger:** Same task (issue number + error class) fails 2 times.

**Action:**
- Log the escalation event as an autonomy handoff fact.
- Reduce `allowedFiles` scope for the next attempt (narrower
  surgical scope).
- Add the previous failure classification as context to the next
  worker's task contract (feedback injection).
- If the error class has `safeToRetry: false`, skip directly to
  Tier 2.

**Implementation touchpoints:**
- `classify-self-cycle-failure.js` -- add a counter lookup (reads
  from a state file keyed by issue# + error class).
- `compile-issue-to-task-json.ps1` -- accept a `--previous-failure`
  flag to inject feedback into the task contract.
- `write-autonomy-handoff-fact.js` -- emit a new handoff type:
  `retry-with-reduced-scope`.

### Tier 2: Reduce Autonomy Level (3 failures)

**Trigger:** Same task fails 3 times (after Tier 1 retry).

**Action:**
- Switch the task from guarded-execute to human-gated execution.
- Downgrade the worker risk classification from `low` to `medium`
  (requires human confirmation).
- Emit a `autonomous-to-fallback` handoff event for this specific
  task (not the whole cycle).
- Create a follow-up issue summarizing the 3 failures with their
  classifications.

**Implementation touchpoints:**
- `aggregate-self-cycle-candidates.js` -- check failure count
  before deciding guarded vs. human-gated.
- `create-health-followup.js` -- extend to emit task-level
  escalation issues (not just health-gate failures).
- `check-self-cycle-safety-gate.js` -- add an escalation-count
  gate that blocks guarded execute when count >= 3.

### Tier 3: Stop and Alert Human (5 failures)

**Trigger:** Same task fails 5 times (after Tier 2 reduction).

**Action:**
- Block the task permanently (remove from queue).
- Create a high-severity issue with full failure history
  (all 5 classifications, timestamps, worker outputs).
- Emit an `autonomous-to-fallback` handoff event for the
  entire cycle (not just the task).
- Require explicit `repo-owner` override to re-queue the task.

**Implementation touchpoints:**
- `run-self-cycle.ps1` -- add a per-task failure counter check
  before dispatch.
- `dispatch-recovery-worker.js` -- extend to detect tasks that
  have hit the hard-stop threshold.
- New state file: `.github/ai-state/escalation-counters.json`
  keyed by issue number.

---

## State File Design

```json
{
  "schemaVersion": 1,
  "counters": {
    "1438": {
      "totalFailures": 2,
      "byErrorClass": {
        "PROVIDER_UNAVAILABLE": 1,
        "WORKTREE_STALE": 1
      },
      "lastFailureAt": "2026-05-13T10:00:00Z",
      "currentTier": 1,
      "tierHistory": [
        { "tier": 1, "enteredAt": "2026-05-13T09:30:00Z", "trigger": "2nd failure" }
      ]
    }
  }
}
```

Keyed by issue number. Counts are per-issue, not per-error-class
(aggregate across classes). The `currentTier` drives the escalation
response; it only moves forward, never backward (monotonic).

---

## Recommended Thresholds

| Threshold | Value | Rationale |
|-----------|-------|-----------|
| Tier 1 trigger | 2 failures | One retry is reasonable; second failure signals the approach is wrong |
| Tier 2 trigger | 3 failures | After reduced scope still fails, human judgment needed |
| Tier 3 trigger | 5 failures | Pattern of persistent failure; task likely needs rescope or redesign |
| Counter reset | On successful PR merge | Task is done; counter resets for the issue |
| Counter TTL | 7 days | Stale counters from abandoned tasks should not affect future attempts |

These values are conservative. They can be tuned after observing
real failure patterns.

---

## Non-Goals

- This investigation does not propose autonomous retry logic. The
  runner still pauses at each gate; escalation thresholds change
  _what happens_ at the gate, not whether the gate is consulted.
- This does not modify the health gate's existing ">2 cycles red"
  threshold. That threshold operates at the cycle level; these
  thresholds operate at the task level.
- This does not introduce new roles (Conductor, Score, Composer).
  LIAN maps escalation tiers to existing concepts: reduced scope,
  human-gated execution, and hard stop.

---

## Implementation Order (if approved)

1. **State file and counter logic** -- `scripts/ai/` new script
   `track-escalation-counters.js` (read/write/count/reset).
2. **Tier 1 wiring** -- modify `classify-self-cycle-failure.js` to
   accept `--escalation-count` and emit tier recommendations.
3. **Tier 2 wiring** -- modify `aggregate-self-cycle-candidates.js`
   to check escalation tier before guarded-execute eligibility.
4. **Tier 3 wiring** -- modify `run-self-cycle.ps1` to block tasks
   at the hard-stop threshold.
5. **Documentation** -- update `loop-model.md` and
   `guarded-autopilot-execute-policy.md` to reference escalation
   thresholds.

---

## References

- [loop-model.md](loop-model.md) -- 6-phase loop and ">2 cycles red" threshold
- [failure-taxonomy-policy.md](failure-taxonomy-policy.md) -- 16 failure categories and recovery routing
- [self-healing.md](self-healing.md) -- health gate to recovery worker pipeline
- [guarded-autopilot-execute-policy.md](guarded-autopilot-execute-policy.md) -- "no auto-retry" on worker failure
- [command-steward-agent.md](command-steward-agent.md) -- escalation rules table
- [main-health-policy.md](main-health-policy.md) -- health states and worker permissions
- [classify-self-cycle-failure.js](../../scripts/ai/classify-self-cycle-failure.js) -- failure classifier with safeToRetry flags
- [dispatch-recovery-worker.js](../../scripts/ai/dispatch-recovery-worker.js) -- stale worker detection
- [write-autonomy-handoff-fact.js](../../scripts/ai/write-autonomy-handoff-fact.js) -- autonomy transition event log
