# External Intake Experiment Rollback Policy

Defines rollback categories, trigger conditions, and evidence required when
an external-intake experiment fails or causes regressions. Complements the
bounded experiment policy with intake-specific rollback rules.

> **Closes:** [#987](https://github.com/taoyu051818-sys/lian-nest-server/issues/987)
>
> **Cross-references:**
> [bounded-experiment-policy.md](bounded-experiment-policy.md) for general
> experiment lifecycle and rollback methods,
> [external-intake-executable-loop.md](external-intake-executable-loop.md)
> for the intake loop stages,
> [failure-taxonomy-policy.md](failure-taxonomy-policy.md) for failure
> classification,
> [opportunity-signal-schema.md](opportunity-signal-schema.md) for
> opportunity signal fields.

---

## Purpose

External-intake experiments are bounded actions triggered by opportunity
signals, risk signals, or runtime signals ingested from outside sources.
These experiments carry additional risk because their evidence comes from
external systems that may be incomplete, stale, or adversarial.

This policy defines:

1. **Rollback categories** — when and how to revert an intake-triggered
   experiment.
2. **Evidence requirements** — what must be recorded before, during, and
   after rollback.
3. **Recovery routing** — how rollback outcomes feed back into the intake
   loop.

---

## Rollback Categories

Every intake experiment rollback falls into one of four categories. The
category determines the rollback method, required evidence, and recovery
path.

### Category 1: Validation Failure

The experiment's `validationCommands` exit non-zero after the worker
opens a PR. The change was never merged.

| Aspect | Detail |
|--------|--------|
| **Trigger** | One or more validation commands fail in the PR |
| **Rollback method** | Close PR without merge |
| **Required evidence** | Validation command output (stdout + exit code) |
| **Recovery routing** | Requeue opportunity signal with `status: "draft"` and failure reason attached |
| **Impact on source signal** | None — signal remains valid; experiment was flawed |

### Category 2: Post-Merge Regression

The experiment merged successfully but causes a measurable regression
detected by health gates, monitoring, or human observation.

| Aspect | Detail |
|--------|--------|
| **Trigger** | Health gate fails, meta-signal score degrades, or human flags regression |
| **Rollback method** | `git revert` of the merge commit |
| **Required evidence** | Health state before/after, meta-signal diff, regression description |
| **Recovery routing** | Signal transitions to `rejected` with regression evidence; new risk signal emitted if applicable |
| **Impact on source signal** | Source fact confidence downgraded; signal tagged `regression-detected` |

### Category 3: Evidence Invalidation

The external fact or signal that triggered the experiment is found to be
stale, incorrect, or fabricated after the experiment is scheduled or
executing.

| Aspect | Detail |
|--------|--------|
| **Trigger** | Source fact retracted, source URL returns 404, or cross-reference contradicts |
| **Rollback method** | If executing: abort worker, close PR. If merged: `git revert` |
| **Required evidence** | Original fact event ID, invalidation reason, retraction source |
| **Recovery routing** | Signal transitions to `rejected`; fact event marked `evidence.rejected` in ledger |
| **Impact on source signal** | Signal invalidated; source class reliability tier may be downgraded |

### Category 4: Scope Violation

The worker edited files outside the declared `allowedFiles` boundary
during an intake-triggered experiment.

| Aspect | Detail |
|--------|--------|
| **Trigger** | Diff includes files not in `allowedFiles`; boundary guard detects violation |
| **Rollback method** | If PR open: close without merge. If merged: `git revert` |
| **Required evidence** | List of out-of-bounds files, diff of violations |
| **Recovery routing** | Experiment re-scoped with corrected boundaries; worker heartbeat flagged |
| **Impact on source signal** | None — signal is valid; execution was flawed |

---

## Rollback Decision Matrix

| Signal Type | Category 1 | Category 2 | Category 3 | Category 4 |
|-------------|:----------:|:----------:|:----------:|:----------:|
| **Opportunity** | Requeue | Revert + reject | Revert + invalidate | Revert + re-scope |
| **Risk** | Requeue | Revert + escalate | Revert + invalidate | Revert + re-scope |
| **Runtime** | Requeue | Revert + red-state | Revert + invalidate | Revert + re-scope |

---

## Evidence Requirements

### Pre-Rollback Evidence (captured before revert)

| Evidence | Source | Required For |
|----------|--------|-------------|
| Health state snapshot | `.github/ai-state/main-health.json` | Category 2, 3 |
| Meta-signal scores | `.github/ai-state/meta-signals.json` | Category 2 |
| Fact event ID | `.github/ai-state/fact-events.ndjson` | Category 3 |
| Original signal JSON | `.github/ai-state/opportunity-signals/` or `risk-signals.json` | All categories |
| Validation output | PR body or worker log | Category 1 |
| Diff of violations | `git diff` output | Category 4 |

### Post-Rollback Evidence (captured after revert)

| Evidence | Source | Purpose |
|----------|--------|---------|
| Revert commit SHA | `git log` | Traceability |
| Health state after revert | `.github/ai-state/main-health.json` | Confirm recovery |
| Gap ledger entry | `.github/ai-state/gap-ledger.ndjson` | Record the failure |
| Updated signal status | Signal JSON `status` field | Reflect outcome |

### Evidence Recording

All rollback evidence MUST be recorded as fact events:

```bash
node scripts/ai/write-fact-event.js \
  --type evidence.rollback \
  --subject "opportunity signal opp-a1b2c3d4" \
  --actor "orchestrator" \
  --live \
  --facts '{"category":"post-merge-regression","revertSha":"abc123","healthBefore":"green","healthAfter":"red"}'
```

---

## Rollback Workflow

```
  ┌──────────────┐
  │  Trigger     │  (validation fail / regression / invalidation / scope violation)
  └──────┬───────┘
         │
         v
  ┌──────────────┐
  │  Classify    │  Assign rollback category (1–4)
  └──────┬───────┘
         │
         v
  ┌──────────────┐
  │  Capture     │  Record pre-rollback evidence
  │  evidence    │
  └──────┬───────┘
         │
         v
  ┌──────────────┐
  │  Execute     │  Close PR or `git revert`
  │  rollback    │
  └──────┬───────┘
         │
         v
  ┌──────────────┐
  │  Verify      │  Run health gate, confirm recovery
  └──────┬───────┘
         │
         v
  ┌──────────────┐
  │  Record      │  Write fact event, update signal, emit gap entry
  └──────────────┘
```

---

## Signal Status Transitions on Rollback

| Before Rollback | Rollback Category | After Rollback |
|-----------------|-------------------|----------------|
| `scheduled` | 1 (validation) | `draft` — requeued |
| `scheduled` | 2 (regression) | `rejected` |
| `scheduled` | 3 (invalidation) | `rejected` |
| `scheduled` | 4 (scope violation) | `validated` — re-scoped |
| `accepted` | Any | `draft` — requeued |
| `validated` | Any | `draft` — requeued |

---

## Automatic vs Manual Rollback

| Category | Automatic? | Condition |
|----------|:----------:|-----------|
| 1 — Validation failure | Yes | Worker closes PR on validation failure |
| 2 — Post-merge regression | No | Requires human or orchestrator confirmation |
| 3 — Evidence invalidation | Semi-auto | Auto-detect stale facts; human confirms invalidation |
| 4 — Scope violation | Yes | Boundary guard blocks merge |

Category 2 rollbacks require explicit confirmation because health
degradation may be coincidental. The orchestrator MUST capture health
state snapshots before and after to support the decision.

---

## Integration with Intake Loop

Rollback events feed back into the external intake loop:

| Loop Stage | Rollback Integration |
|------------|---------------------|
| **Capture** | Rollback evidence recorded as `evidence.rollback` fact events |
| **Classify** | Source class reliability tier may be downgraded after Category 3 |
| **Score** | Confidence scores adjusted based on rollback frequency |
| **Route** | Category 2 may emit new risk signals; Category 1 requeues opportunity signals |

### Source Class Downgrade Rules

When a source class triggers repeated Category 3 rollbacks:

| Rollback Count (30 days) | Action |
|--------------------------|--------|
| 1 | No change |
| 2 | Log warning; flag for review |
| 3+ | Downgrade reliability tier by one level |

---

## References

- [bounded-experiment-policy.md](bounded-experiment-policy.md) — General experiment lifecycle and rollback methods
- [external-intake-executable-loop.md](external-intake-executable-loop.md) — Intake loop stages
- [failure-taxonomy-policy.md](failure-taxonomy-policy.md) — Failure classification and recovery routing
- [opportunity-signal-schema.md](opportunity-signal-schema.md) — Opportunity signal fields
- [risk-signal-schema.md](risk-signal-schema.md) — Risk signal fields
- [fact-event-ledger.md](fact-event-ledger.md) — Append-only event log
- [gap-ledger.md](gap-ledger.md) — Gap event recording
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions
- [evidence-reliability-policy.md](evidence-reliability-policy.md) — Evidence reliability tiers
