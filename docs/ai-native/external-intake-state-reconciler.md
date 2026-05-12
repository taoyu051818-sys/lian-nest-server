# External Intake State Reconciler

Defines drift detection across the external intake surface: stale
external facts, unresolved opportunity signals, open risk signals,
and unaccounted experiment results. The reconciler compares expected
state from the intake loop against observed state in the control plane
and emits gap events when drift is detected.

> **Closes:** [#981](https://github.com/taoyu051818-sys/lian-nest-server/issues/981)
>
> **Cross-references:**
> [external-intake-executable-loop.md](external-intake-executable-loop.md)
> for the intake loop stages,
> [external-facts-schema.md](external-facts-schema.md) for external
> fact entry fields,
> [opportunity-signal-schema.md](opportunity-signal-schema.md) for
> opportunity signal fields,
> [risk-signal-schema.md](risk-signal-schema.md) for risk signal
> fields,
> [bounded-experiment-policy.md](bounded-experiment-policy.md) for
> experiment lifecycle.

---

## Purpose

The intake loop produces state across four surfaces — external facts,
opportunity signals, risk signals, and experiment artifacts. Over time
each surface can drift: facts expire, signals stall, risks remain open
past their mitigation window, and experiments complete without a
recorded outcome. The reconciler detects these conditions and records
them as gap events so the planning loop can act.

The reconciler is **observational**. It reads state files and emits gap
events. It never modifies signals, promotes evidence, or triggers
actions directly.

---

## Drift Surfaces

The reconciler checks four independent surfaces on every run.

### 1. Stale External Facts

External facts in `.github/ai-state/external-facts.ndjson` may carry an
`expiresAt` timestamp. A fact whose `expiresAt` has passed is stale.

| Condition | Detection | Gap Event |
|-----------|-----------|-----------|
| `expiresAt` set and in the past | `expiresAt < now` | `fact.stale` |
| Duplicate `factType` + `subject` with no superseding entry | Latest entry older than 72h | `fact.unrefreshed` |
| `factType` references a resolved issue/PR | Related issue closed, fact still open | `fact.orphaned` |

**Safe default:** If `external-facts.ndjson` is missing or empty,
no stale-fact events are emitted. Absence is not drift.

### 2. Stalled Opportunity Signals

Opportunity signals in
`.github/ai-state/opportunity-signals/opp-*.json` follow the lifecycle
`draft` → `validated` → `accepted` → `scheduled` (or `rejected`). A
signal that stays in an intermediate state too long is stalled.

| Condition | Detection | Gap Event |
|-----------|-----------|-----------|
| `draft` for >7 days | `createdAt + 7d < now` | `opportunity.stalled` |
| `validated` for >14 days | `updatedAt + 14d < now` | `opportunity.stalled` |
| `accepted` for >7 days without `promotedTaskId` | `updatedAt + 7d < now` | `opportunity.stalled` |
| `scheduled` but `promotedTaskId` references a closed/missing task | Task not in active task ledger | `opportunity.orphaned` |

**Safe default:** If the `opportunity-signals/` directory is empty,
no stall events are emitted.

### 3. Unresolved Risk Signals

Risk signals in `.github/ai-state/risk-signals.json` carry a `status`
field. Signals in `open` or `acknowledged` status that exceed age
thresholds are flagged.

| Condition | Detection | Gap Event |
|-----------|-----------|-----------|
| `critical` severity, `open` for >48h | `detectedAt + 48h < now` | `risk.unresolved` |
| `high` severity, `open` for >7 days | `detectedAt + 7d < now` | `risk.unresolved` |
| `medium` severity, `acknowledged` for >30 days | `detectedAt + 30d < now` | `risk.unresolved` |
| `status: "mitigated"` but no follow-up fact event confirming mitigation | No matching `evidence.intake` with `factType: "risk.mitigated"` | `risk.unverified` |

**Safe default:** If `risk-signals.json` is missing, no risk drift
events are emitted.

### 4. Experiment Result Accounting

Bounded experiments promoted from opportunity signals produce expected
outcomes defined in `experiment.successCriteria`. The reconciler
checks whether experiment results have been recorded.

| Condition | Detection | Gap Event |
|-----------|-----------|-----------|
| `promotedTaskId` set, task is closed, no result fact event | No `evidence.intake` with `factType: "experiment.result"` referencing the signal ID | `experiment.unrecorded` |
| `experiment.duration` elapsed since promotion, no result | `promotedAt + duration < now` | `experiment.overdue` |
| Experiment result recorded but success criteria not evaluated | Result lacks `criteriaMet` field | `experiment.unevaluated` |

**Safe default:** If no signals have `promotedTaskId`, no experiment
drift events are emitted.

---

## Gap Event Schema

Each drift detection emits a gap event to
`.github/ai-state/gap-ledger.ndjson`.

```jsonc
{
  "eventVersion": 1,
  "eventType": "drift.external-fact",
  "subject": "fact:dep:breaking-change",
  "details": {
    "driftType": "fact.stale",
    "sourceFile": "external-facts.ndjson",
    "expected": "fact refreshed or expired",
    "observed": "expiresAt passed 72h ago, no superseding entry",
    "severity": "medium"
  },
  "detectedAt": "2026-05-12T12:00:00Z",
  "actor": "state-reconciler"
}
```

### Drift Event Types

| `eventType` | `driftType` Values | Source Surface |
|-------------|-------------------|----------------|
| `drift.external-fact` | `fact.stale`, `fact.unrefreshed`, `fact.orphaned` | external-facts.ndjson |
| `drift.opportunity` | `opportunity.stalled`, `opportunity.orphaned` | opportunity-signals/ |
| `drift.risk` | `risk.unresolved`, `risk.unverified` | risk-signals.json |
| `drift.experiment` | `experiment.unrecorded`, `experiment.overdue`, `experiment.unevaluated` | opportunity-signals/ (promoted) |

### Severity Assignment

| Drift Type | Default Severity |
|------------|-----------------|
| `fact.stale` | low |
| `fact.unrefreshed` | low |
| `fact.orphaned` | medium |
| `opportunity.stalled` | medium |
| `opportunity.orphaned` | high |
| `risk.unresolved` (critical) | high |
| `risk.unresolved` (high) | medium |
| `risk.unresolved` (medium) | low |
| `risk.unverified` | medium |
| `experiment.unrecorded` | medium |
| `experiment.overdue` | medium |
| `experiment.unevaluated` | low |

---

## Reconciliation Run

### Inputs

| Input | Source |
|-------|--------|
| External facts | `.github/ai-state/external-facts.ndjson` |
| Opportunity signals | `.github/ai-state/opportunity-signals/opp-*.json` |
| Risk signals | `.github/ai-state/risk-signals.json` |
| Active task ledger | `.github/ai-state/task-ledger.ndjson` |
| Fact event ledger | `.github/ai-state/fact-events.ndjson` |

### Process

```
┌──────────────────────────────────────────────────────────────┐
│                  state reconciliation run                      │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  ┌───────┐│
│  │  1. Scan     │─▶│  2. Compare  │─▶│ 3. Detect │─▶│4. Emit││
│  │  (read all   │  │  (expected   │  │  (diff =  │  │(gap   ││
│  │   surfaces)  │  │   vs actual) │  │   drift)  │  │ event)││
│  └──────────────┘  └──────────────┘  └───────────┘  └───────┘│
└──────────────────────────────────────────────────────────────┘
```

1. **Scan** — Read all four surfaces. If a file is missing, treat
   that surface as empty (no drift).
2. **Compare** — For each entry, check the conditions in the drift
   tables above.
3. **Detect** — Entries that match a drift condition produce a drift
   record.
4. **Emit** — Each drift record is written as a gap event to
   `gap-ledger.ndjson`.

### Deduplication

The reconciler must not emit duplicate gap events for the same drift
condition on the same subject within a 24-hour window. Before emitting,
scan the last 24h of `gap-ledger.ndjson` for a matching `driftType` +
`subject` pair. If found, skip.

### Script Invocation (Future)

```bash
node scripts/ai/reconcile-intake-state.js --live --dry-run
node scripts/ai/reconcile-intake-state.js --live
```

| Flag | Behavior |
|------|----------|
| `--dry-run` | Detect drift but do not write gap events |
| `--live` | Write gap events to `gap-ledger.ndjson` |
| `--surface <name>` | Reconcile only one surface: `facts`, `opportunities`, `risks`, `experiments` |

---

## Integration with Planning Loop

The reconciler feeds the planning loop through gap events:

| Gap Event | Planning Action |
|-----------|----------------|
| `fact.stale` | Refresh intake for the expired subject |
| `opportunity.stalled` | Re-evaluate or reject the stalled signal |
| `opportunity.orphaned` | Clean up or re-promote the signal |
| `risk.unresolved` (critical/high) | Boost priority of related tasks |
| `risk.unverified` | Schedule verification task |
| `experiment.unrecorded` | Nudge worker to record outcome |
| `experiment.overdue` | Escalate to orchestrator |

The planning loop consumes these via the standard gap-ledger scanning
in `suggest-next-tasks-from-meta-signals.js`.

---

## Safe Skeleton Behavior

When a reconciler input is missing or empty:

| Input | Safe Default |
|-------|-------------|
| `external-facts.ndjson` | No fact drift events |
| `opportunity-signals/` | No opportunity drift events |
| `risk-signals.json` | No risk drift events |
| `task-ledger.ndjson` | Experiment checks skipped |
| `fact-events.ndjson` | Result checks skipped |

The reconciler never assumes absence means drift. An empty surface is
a clean surface.

---

## Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Input file malformed JSON | Parse error on read | Log warning, skip that surface, continue others |
| Gap event write fails | Script exits non-zero | Retry once; if persistent, log to stderr |
| Clock skew between surfaces | Timestamp comparison unreliable | Use reconciler's local clock as authority |
| Stale reconciler output (>24h) | `detectedAt` on gap events | Flag reconciler itself as stale via `gap.reconciler.stale` event |

---

## Key Files

| Path | Role |
|------|------|
| `.github/ai-state/external-facts.ndjson` | External fact entries (scan target) |
| `.github/ai-state/opportunity-signals/opp-*.json` | Opportunity signal files (scan target) |
| `.github/ai-state/risk-signals.json` | Risk signal snapshot (scan target) |
| `.github/ai-state/task-ledger.ndjson` | Task lifecycle (cross-reference) |
| `.github/ai-state/fact-events.ndjson` | Fact event ledger (cross-reference) |
| `.github/ai-state/gap-ledger.ndjson` | Gap events (output) |

---

## References

- [External Intake Executable Loop](external-intake-executable-loop.md) — Intake loop stages
- [External Facts Schema](external-facts-schema.md) — External fact entry fields
- [Opportunity Signal Schema](opportunity-signal-schema.md) — Opportunity signal fields
- [Risk Signal Schema](risk-signal-schema.md) — Risk signal fields
- [Bounded Experiment Policy](bounded-experiment-policy.md) — Experiment lifecycle
- [External Reality Intake](external-reality-intake.md) — Intake boundary contract
- [Gap Ledger](gap-ledger.md) — Gap event recording
- [Meta Signals](meta-signals.md) — Aggregate signal calculator
- [Fact Event Ledger](fact-event-ledger.md) — Append-only event log
