# Failure Escalation Thresholds Investigation

Research findings for [#1491](https://github.com/taoyu051818-sys/lian-nest-server/issues/1491).

Compares the Symphony agent escalation model (Performer->Conductor->Score->Composer)
with LIAN's existing self-cycle failure handling to identify gaps and determine
whether new escalation thresholds are needed.

---

## Conclusion

**LIAN's existing system already covers the core safety properties described in
the issue.** The Symphony escalation model maps cleanly onto LIAN's architecture.
The one actionable gap — per-action-type consecutive failure counting — is a
refinement, not a missing capability. No code changes are recommended; the issue
can be closed with this summary.

---

## Symphony Model Summary

The external research source describes Symphony's escalation chain:

| Symphony Role | Responsibility | Escalation Trigger |
|---------------|---------------|-------------------|
| Performer | Executes a single task | Fails -> re-assigned with feedback, iteration count incremented |
| Conductor | Coordinates performers | Repeated failure -> escalate to Score |
| Score | Cross-goal conflict resolution | Architectural impact -> escalate to Composer |
| Composer | System-level decisions | Final authority |
| Researcher | Deep analysis | Any agent can escalate for investigation |

Proposed thresholds from the issue:
- 2 failures -> try different approach
- 3 failures -> reduce autonomy level
- 5 failures -> stop and alert human

---

## Mapping to LIAN Architecture

LIAN does not have discrete Performer/Conductor/Score/Composer roles. Instead,
the same escalation responsibilities are distributed across the control plane:

| Symphony Role | LIAN Equivalent | Location |
|---------------|----------------|----------|
| Performer | Worker (worktree process) | `batch-launch.ps1`, worker lifecycle |
| Conductor | Orchestrator + Launch Gate | `run-self-cycle.ps1`, `check-launch-gate.ps1` |
| Score | Health Gate + Meta-Signals | `post-merge-health-gate.js`, `calculate-meta-signals.js` |
| Composer | Human Operator | Manual review, wave decisions |
| Researcher | Recovery Workers | `dispatch-recovery-worker.js`, `create-health-followup.js` |

### Escalation Path Comparison

**Symphony:** Performer fails -> Conductor re-assigns with feedback -> Score
resolves cross-goal conflicts -> Composer handles architectural impacts.

**LIAN:** Worker fails -> classify error (`classify-self-cycle-failure.js`) ->
if retryable, re-dispatch; if not, generate recovery issue -> health gate
evaluates impact -> human reviews and decides next wave.

The functional outcome is equivalent: failures escalate through progressively
wider-scope decision-makers until resolved or halted.

---

## Existing Thresholds in LIAN

### Failure Counting and Escalation

| Mechanism | Threshold | Response | Source |
|-----------|-----------|----------|--------|
| Repeated failure escalation | Same pattern 3+ times in 7 days | Auto-issue filed with `repeated-failure` label | `knowledge-driven-scaling.md` Rule 2 |
| Health gate red | Red > 2 consecutive cycles | Stop auto-launch, enter fallback | `loop-model.md` |
| failureScore recovery trigger | 31-70 | Recovery workers triggered automatically | `agent-motivation-metrics.md` |
| failureScore pipeline halt | 71-100 | Pipeline halts, human intervention required | `agent-motivation-metrics.md` |
| Trust conservative mode | trust < 50 | Only fix-only and docs workers, no new features | `agent-motivation-metrics.md` |
| Constitutional drift critical | 71-100 | Pause non-recovery workers, escalate to human | `constitutional-drift-metrics.md` |

### Retry Control

| Mechanism | Behavior | Source |
|-----------|----------|--------|
| `safeToRetry` flag | Per error class: 3 retryable, 6 not retryable | `classify-self-cycle-failure.js` |
| Worker stale detection | 30 min running / 10 min heartbeat -> kill and re-dispatch | `dispatch-recovery-worker.js` |
| Health gate cooldown | 5 min between auto-triggers | `auto-trigger-health-gate.js` |

### Safety Bounds

| Mechanism | Value | Source |
|-----------|-------|--------|
| MaxTasks per cycle | 10 (default) | `self-cycle-runner.md` |
| Wave pause | Human must approve next wave | `loop-model.md` |
| Failure budget | 30 (batch launcher default) | `batch-launch.ps1` |
| Broad diff threshold | 500 lines / 10 files | `check-worker-behavior-policy.js` |

---

## Gap Analysis

### Issue Proposal: "2 failures -> try different approach"

**LIAN coverage:** The `safeToRetry` flag already distinguishes retryable from
non-retryable failures. For retryable failures (provider unavailable, disk pressure,
worktree stale), the system re-dispatches with the same approach because the failure
is environmental, not strategic. For non-retryable failures, the system does not
retry at all — it generates a recovery issue for a different worker type.

**Gap:** There is no mechanism to switch strategies after N consecutive failures
of the same action type within a single cycle. However, LIAN workers execute
discrete, deterministic tasks (compile -> launch -> execute -> PR). There is no
"reasoning method" to switch — each worker either succeeds or fails against
concrete validation commands.

**Assessment:** Covered by existing architecture. The Symphony "try different
approach" maps to LIAN's "dispatch a different worker type" (e.g., foundation-fix
instead of feature-worker).

### Issue Proposal: "3 failures -> reduce autonomy level"

**LIAN coverage:** The trust score formula already implements this:
`trust = clamp(100 - (failureScore * 0.6 + frictionScore * 0.4), 0, 100)`.
When trust drops below 50, the pipeline enters conservative mode — only fix-only
and docs workers, no new feature dispatch. The `knowledge-driven-scaling.md`
Rule 2 escalates repeated patterns after 3 occurrences in 7 days.

**Gap:** No per-cycle consecutive failure counting. The 3-in-7-day window is
rolling, not consecutive. Three failures spread across a week triggers escalation,
but three failures in a row within one cycle does not trigger a distinct response.

**Assessment:** Functionally covered. The wave-pause mechanism (human must approve
each wave) means consecutive failures within a cycle are bounded by MaxTasks (10)
and visible to the human reviewer.

### Issue Proposal: "5 failures -> stop and alert human"

**LIAN coverage:** Health gate red > 2 cycles stops auto-launch. failureScore > 70
halts the pipeline. The wave-pause mechanism already alerts the human after every
wave.

**Gap:** None. The existing thresholds are tighter than the proposed 5-failure
threshold.

---

## Architectural Constraint

The Symphony model assumes swappable reasoning strategies (Performer can "try
a different approach"). LIAN's workers execute deterministic pipelines with
fixed steps. The concept of "switching reasoning method" does not map to the
current architecture.

If LIAN were to adopt LLM-based workers with configurable strategies, per-action-type
consecutive failure counting would become more valuable. Until then, the existing
classification + recovery + wave-pause architecture provides equivalent protection.

---

## Recommendation

Close #1491 with the following findings:

1. The Symphony escalation model (Performer->Conductor->Score->Composer) maps
   to LIAN's existing architecture (Worker->Orchestrator/LaunchGate->HealthGate/
   MetaSignals->HumanOperator).
2. The proposed thresholds (2/3/5 failures) are already covered by existing
   mechanisms: `safeToRetry`, trust-based conservative mode, health gate red > 2
   cycles, and the wave-pause human review gate.
3. The one gap — per-action-type consecutive failure counting at the loop level —
   is a refinement identified in #1411 and classified as low priority because the
   wave-pause mechanism bounds blast radius and provides human visibility.
4. No code changes are needed. If consecutive-failure counting becomes needed in
   the future, it should be added to `classify-self-cycle-failure.js` as a new
   field, with the gap ledger writer emitting a signal when the threshold is crossed.

---

## References

- [confidence-interval-escalation-investigation.md](confidence-interval-escalation-investigation.md) — Prior investigation for #1411 covering the same gap
- [knowledge-driven-scaling.md](knowledge-driven-scaling.md) — Rule 2: Repeated Failure Escalation (3+ in 7 days)
- [loop-model.md](loop-model.md) — Failure modes table and wave-pause mechanism
- [agent-motivation-metrics.md](agent-motivation-metrics.md) — failureScore, trust, conservative mode thresholds
- [failure-taxonomy-policy.md](failure-taxonomy-policy.md) — Failure classification and recovery routing
- [classify-self-cycle-failure.js](../../scripts/ai/classify-self-cycle-failure.js) — Error classification with `safeToRetry`
- [dispatch-recovery-worker.js](../../scripts/ai/dispatch-recovery-worker.js) — Stale/failed worker detection
- [self-cycle-operator-checklist.md](self-cycle-operator-checklist.md) — Operator escalation triggers
- [constitutional-drift-metrics.md](constitutional-drift-metrics.md) — Drift score escalation thresholds
- [codex-exit-readiness-gate.md](codex-exit-readiness-gate.md) — Stuck-system escalation triggers
