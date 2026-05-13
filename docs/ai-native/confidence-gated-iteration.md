# Confidence-Gated Iteration

Investigates the confidence-interval-escalation pattern from the Enhanced
Recursive Engineer research and evaluates its applicability to the LIAN
self-cycle loop.

> **Closes:** [#1436](https://github.com/taoyu051818-sys/lian-nest-server/issues/1436)
>
> **Source:** `external-agent-research/Symphony/.roo/rules-enhanced-recursive-engineer/02-rules.md`
> (source reliability: high, captured 2026-05-13)

---

## External Pattern Summary

The Enhanced Recursive Engineer uses a **Confidence Interval** to gate
iteration. The core rules:

1. **Track confidence per attempt.** Each iteration produces a confidence
   score reflecting how likely the current approach is to succeed.
2. **Escalate on consecutive failure.** If 2 consecutive attempts fail,
   switch strategy (different tool, different decomposition, different
   reasoning method).
3. **Confidence-gated delivery.** Solution delivery is gated on confidence
   level:
   - **High confidence** (>80%) — deliver directly.
   - **Moderate confidence** (60-80%) — deliver with validation steps.
   - **Controlled uncertainty** (40-60%) — deliver with rollback plan and
     explicit human review.
   - **Below 40%** — do not deliver; switch reasoning method entirely.
4. **Prevent infinite retry loops.** Forced strategy changes after N
   consecutive failures prevent wasted cycles.

---

## Current LIAN State Analysis

### What Exists

| Mechanism | Where | Tracks Confidence? | Gates Iteration? |
|-----------|-------|:------------------:|:----------------:|
| Health gate classification | `classify-health-failure.js` | Yes (pattern match count → high/medium/low) | No — classifies after failure, does not gate retries |
| Self-cycle failure classifier | `classify-self-cycle-failure.js` | Yes (same pattern) | No — classifies, does not gate |
| Failure taxonomy severity | `failure-taxonomy-policy.md` | No | Partially — red blocks, yellow limits |
| Risk signals | `risk-signal-schema.md` | No | Yes — critical blocks affected areas |
| Exploration budget | `exploration-budget-policy.md` | No | Yes — graduated response to budget % |
| Bounded experiment lifecycle | `bounded-experiment-policy.md` | No | Partially — evaluate phase decides success/continue/rollback |
| Health state escalation | `main-health-policy.md` | No | Yes — green/yellow/red/black gates workers |
| Worker telemetry | `worker-telemetry-schema.md` | Captures outcome | No — records, does not gate |

### What Is Missing

1. **Per-action-type confidence tracking.** The system classifies failures
   but does not accumulate a rolling confidence score per action type
   (e.g., "docs tasks have 90% success rate, schema tasks have 40%").

2. **Consecutive failure counting.** There is no mechanism to detect "this
   task type has failed 3 times in a row" and force a strategy change.

3. **Confidence-gated delivery.** Workers deliver output regardless of
   confidence. There is no intermediate gate that says "confidence is low,
   add extra validation or switch approach before opening a PR."

4. **Strategy escalation protocol.** When a worker fails, the recovery
   path is always the same: classify failure → create follow-up issue →
   recovery worker fixes. There is no "switch to a different decomposition"
   or "try a different tool/approach" step.

5. **Iteration budget per task.** The exploration budget limits research
   activities, but committed tasks have no retry budget. A task can fail
   and be retried indefinitely through the recovery pipeline.

---

## Gap Analysis

### Gap 1: No Rolling Confidence Per Action Type

**Current:** Each failure is classified independently. There is no
aggregation of success/failure rates per action type over time.

**External pattern:** Confidence is tracked as a running score that
decreases on failure and increases on success.

**Impact:** The system cannot make statements like "docs tasks succeed
85% of the time but schema tasks only 30%" — which would inform batch
planning and risk assessment.

**Integration point:** Worker telemetry (`worker-telemetry-schema.md`)
already captures `gateOutcome.passed` per task. Aggregating this by
`taskType` or `actorRole` over a rolling window would produce per-action
confidence scores.

### Gap 2: No Consecutive Failure Detection

**Current:** The health gate escalates from green to yellow to red based
on health state, not on per-task failure streaks. A single red failure
blocks everything; there is no intermediate "2 failures on this task type,
try differently" signal.

**External pattern:** 2 consecutive failures → escalate strategy.
5 consecutive failures → pause for human.

**Impact:** Workers can retry the same approach through the recovery
pipeline without detecting that the approach itself is flawed.

**Integration point:** The gap ledger (`gap-ledger.ndjson`) records
failure events. Counting consecutive failures per conflict group or task
type from the gap ledger would provide this signal.

### Gap 3: No Confidence Gate on Delivery

**Current:** Workers open PRs after running validation commands. The PR
review gate is human-owned. There is no automated intermediate gate that
says "confidence is too low for autonomous delivery, add human review."

**External pattern:** Delivery is gated on confidence level. Low
confidence → add validation, rollback plan, or human review.

**Impact:** A worker with a shaky approach still opens a PR and waits for
human review, consuming review bandwidth. An automated confidence check
could force the worker to add extra validation evidence or explicitly flag
uncertainty.

**Integration point:** The bounded experiment policy's evaluate phase
(`bounded-experiment-policy.md`) could incorporate a confidence gate.
Worker telemetry confidence could trigger "add validation evidence" or
"request human review" before PR submission.

### Gap 4: No Strategy Escalation Protocol

**Current:** Recovery is always "classify → follow-up issue → recovery
worker." There is no mechanism to try a different approach (different
decomposition, different file boundary, different validation commands).

**External pattern:** Strategy escalation — switch tool, switch
decomposition, switch reasoning method.

**Impact:** Recovery workers inherit the same task contract as the failed
worker. If the task contract itself is the problem (wrong scope, wrong
boundary), the recovery worker will fail the same way.

**Integration point:** The issue-to-task compiler
(`issue-to-task-compiler.md`) could incorporate failure history. If a task
has failed N times, the compiler could suggest expanding `allowedFiles`,
adding more `validationCommands`, or splitting the task.

### Gap 5: No Iteration Budget Per Task

**Current:** Tasks have time budgets (`budgets.maxMinutes`) but no retry
budget. A task can fail → recover → fail → recover indefinitely.

**External pattern:** Hard iteration limit with forced strategy change.

**Impact:** Infinite retry loops are possible through the recovery
pipeline. Each retry consumes provider capacity, tokens, and human review
time.

**Integration point:** The task contract (`worker-task-contract.md`) could
add a `maxRetries` field. The self-cycle runner could track retry count
per issue and stop dispatching after the limit.

---

## Recommended Implementation

### Phase 1: Confidence Score Aggregation (Low Risk)

Add a confidence score calculator that aggregates worker telemetry by
action type over a rolling window.

**New script:** `scripts/ai/calculate-action-confidence.js`

**Input:** Worker telemetry records from `.github/ai-state/` or the fact
event ledger.

**Output:** Per-action-type confidence score:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-13T00:00:00.000Z",
  "windowDays": 7,
  "actionConfidence": [
    {
      "actionType": "docs",
      "totalAttempts": 12,
      "successes": 11,
      "failures": 1,
      "confidence": 0.92,
      "confidenceLevel": "high",
      "consecutiveFailures": 0
    },
    {
      "actionType": "schema",
      "totalAttempts": 5,
      "successes": 2,
      "failures": 3,
      "confidence": 0.40,
      "confidenceLevel": "controlled-uncertainty",
      "consecutiveFailures": 2
    }
  ],
  "overallConfidence": 0.76,
  "overallConfidenceLevel": "moderate"
}
```

**Confidence levels (aligned with external pattern):**

| Level | Range | Behavior |
|-------|-------|----------|
| high | > 0.80 | Auto-launch eligible |
| moderate | 0.60–0.80 | Launch with extra validation |
| controlled-uncertainty | 0.40–0.60 | Launch with rollback plan + human review flag |
| blocked | < 0.40 | Do not auto-launch; require human decision |

**New doc:** `docs/ai-native/action-confidence-schema.md`

### Phase 2: Consecutive Failure Detection (Low Risk)

Extend the gap ledger or create a lightweight counter that tracks
consecutive failures per conflict group.

**Integration:** The self-cycle runner's Step 1 (state reconciler) could
check consecutive failure counts. At threshold:

- 2 consecutive failures on same conflict group → flag in batch plan
- 3 consecutive failures → block auto-launch, require human review
- 5 consecutive failures → pause conflict group, escalate to human

**New fields in task contract:**

```json
{
  "retryBudget": {
    "maxRetries": 3,
    "currentRetry": 1,
    "escalationThreshold": 2
  }
}
```

### Phase 3: Confidence-Gated Delivery (Medium Risk)

Before a worker opens a PR, check the action confidence score for the
task type. Apply gates:

| Confidence | Worker Behavior |
|------------|-----------------|
| high | Open PR normally |
| moderate | Add extra validation commands, attach validation evidence |
| controlled-uncertainty | Add rollback plan to PR body, label `needs-human-review` |
| blocked | Do not open PR; comment on issue with blocker reason |

**Integration:** This would be a pre-PR gate in `batch-launch.ps1` or
the worker's post-validation step.

### Phase 4: Strategy Escalation Protocol (Higher Risk)

When consecutive failure threshold is hit, modify the task contract for
the recovery worker:

1. **Expand file boundary** — add adjacent files that might be relevant.
2. **Add validation commands** — more thorough checking.
3. **Split task** — decompose into smaller bounded experiments.
4. **Switch approach** — change `taskType` from `execution` to `research`
   to investigate why the approach fails.

This phase has higher risk because it modifies the task contract
automatically. It should be gated on human approval initially.

---

## Relationship to Existing Policies

| Policy | Confidence-Gated Iteration Adds |
|--------|-------------------------------|
| [Failure Taxonomy](failure-taxonomy.md) | Aggregated confidence scores per category |
| [Exploration Budget](exploration-budget-policy.md) | Parallel concept: exploration has budget limits, committed tasks get confidence limits |
| [Bounded Experiment](bounded-experiment-policy.md) | Confidence gate in the evaluate phase |
| [Worker Telemetry](worker-telemetry-schema.md) | Source data for confidence aggregation |
| [Risk Signals](risk-signal-schema.md) | Low action confidence is an internal risk signal |
| [Main Health Policy](main-health-policy.md) | Confidence could influence health state transitions |
| [Loop Model](loop-model.md) | Confidence tracking adds a feedback loop to the cycle |

---

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|------------|
| Phase 1: Aggregation | Low — read-only calculation | No system behavior change; advisory output only |
| Phase 2: Failure counting | Low — extends existing reconciler | Thresholds are advisory; human can override |
| Phase 3: Delivery gating | Medium — changes worker behavior | Gated on confidence accuracy; false positives block valid work |
| Phase 4: Strategy escalation | Higher — modifies task contracts | Human approval required; starts as advisory |

---

## Non-Goals

- No changes to runtime backend code (`src/**`).
- No changes to Prisma schema.
- No changes to `package.json` or `package-lock.json`.
- No autonomous strategy changes without human approval (Phase 4).

---

## References

- [Self-Cycle Runner](self-cycle-runner.md) — Current loop orchestrator
- [Loop Model](loop-model.md) — Automated loop phases
- [Failure Taxonomy](failure-taxonomy.md) — Health gate failure categories
- [Failure Taxonomy Policy](failure-taxonomy-policy.md) — Extended failure classification
- [Worker Telemetry Schema](worker-telemetry-schema.md) — Cost and outcome records
- [Bounded Experiment Policy](bounded-experiment-policy.md) — Experiment lifecycle
- [Exploration Budget Policy](exploration-budget-policy.md) — Resource limits for exploration
- [Risk Signal Schema](risk-signal-schema.md) — External risk signals
- [Self-Healing](self-healing.md) — Automated recovery pipeline
- [Classify Self-Cycle Failure](../../scripts/ai/classify-self-cycle-failure.js) — Failure classifier script
