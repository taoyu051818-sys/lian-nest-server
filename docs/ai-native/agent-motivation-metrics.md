# Agent Motivation Metrics

Maps human organizational pressures to their agent-native equivalents.
Each pressure that motivates human teams has a measurable counterpart in the
self-cycle loop — surfaced through meta-signals, health gates, and telemetry.

> **Closes:** [#910](https://github.com/taoyu051818-sys/lian-nest-server/issues/910)

---

## Pressure-to-Metric Mapping

| Human Pressure | Agent Equivalent | Source | Range | Consumed By |
|----------------|------------------|--------|-------|-------------|
| **Deadline / schedule pressure** | `wallTime.utilizationPercent` | Worker monitoring metrics | 0–100% | Scheduler, health gate |
| **Quality failures** | `failureScore` | Meta-signals | 0–100 | Planning loop, batch launcher |
| **Process friction** | `frictionScore` | Meta-signals | 0–100 | Planning loop, scheduler |
| **Budget / cost pressure** | `cost` | Meta-signals + telemetry | 0+ worker-minutes | Planning loop, provider pool |
| **Team trust / confidence** | `trust` | Meta-signals | 0–100 | Planning loop, wave sizing |
| **Technical / scope risk** | `riskScore` | Meta-signals | 0–100 | Launch gate, batch launcher |
| **Exploration budget** | `exploreBudget` | Task contract budgets | bounded integers | Worker self-limiting |
| **Organizational constitution** | Constitution sections | Seed constitution + guard | pass/fail | Boundary guard, launch gate |

---

## Metric Details

### Deadline Pressure → Wall Time Utilization

Human teams feel deadline pressure as sprint end dates approach. The agent
equivalent is `wallTime.utilizationPercent` — the ratio of elapsed time to the
hard limit in the task contract.

```
utilizationPercent = elapsedMs / (hardLimitMinutes * 60000) * 100
```

- **Low (< 50%):** Worker has ample time. No pressure signal.
- **Medium (50–80%):** Worker should prioritize core deliverables over polish.
- **High (> 80%):** Scheduler avoids dispatching new work to this worker.
  Health gate may flag if the worker has not yet opened a PR.

Source: [Worker Monitoring Metrics](worker-monitoring-metrics.md) § Wall Time.

---

### Quality Failures → Failure Score

Human teams track bug counts and incident severity. The agent equivalent is
`failureScore` — a weighted sum of red-state health gate failures.

| Category | Weight |
|----------|--------|
| `dependency/generate` | 30 |
| `runtime compile` | 25 |
| `unknown` | 20 |
| `boundary guard` | 15 |
| `docs guard` | 10 |

- **0:** No failures. Full pipeline throughput.
- **1–30:** Minor issues. Docs or boundary guards tripped. Pipeline continues
  with constrained worker types.
- **31–70:** Significant failures. Recovery workers triggered automatically.
- **71–100:** Critical. Pipeline halts, human intervention required.

Source: [Meta Signals](meta-signals.md) § Failure Category Weights.

---

### Process Friction → Friction Score

Human teams experience friction from slow approvals, blocked dependencies, and
stalled reviews. The agent equivalent is `frictionScore` — accumulated penalty
points from stale workers and no-output episodes.

| Event | Points |
|-------|--------|
| Worker state `stale` | +30 |
| Worker state `running:no-output` | +10 |
| `noOutputMs > 300000` | +20 |
| `noOutputMs > 60000` | +5 |

Capped at 100. High friction signals that the loop is spending time waiting,
not producing. The planning loop responds by reducing batch sizes and
increasing stale-detection sensitivity.

Source: [Meta Signals](meta-signals.md) § Heartbeat Log.

---

### Budget Pressure → Cost

Human teams track burn rate against allocated budget. The agent equivalent is
`cost` — total elapsed worker-minutes in the current batch window, plus
per-worker telemetry cost estimates.

Cost feeds two decisions:

1. **Wave sizing:** High cost relative to remaining budget shrinks the next
   batch.
2. **Provider selection:** The provider pool guard may shift to cheaper models
   when cost exceeds the soft threshold.

Cost is expressed in worker-minutes (raw) and optionally in USD cents
(estimated via telemetry `estimatedCostCents`).

Source: [Meta Signals](meta-signals.md) § Scoring Formulas,
[Worker Telemetry Schema](worker-telemetry-schema.md).

---

### Team Trust → Trust Score

Human teams build or lose trust based on delivery reliability. The agent
equivalent is `trust` — a derived signal that combines failure and friction
into a single confidence number.

```
trust = clamp(100 - (failureScore * 0.6 + frictionScore * 0.4), 0, 100)
```

- **80–100:** High trust. Full batch sizes, aggressive scheduling.
- **50–79:** Moderate trust. Smaller batches, tighter budgets.
- **0–49:** Low trust. Pipeline enters conservative mode — only fix-only and
  docs workers, no new feature dispatch.

Trust is the primary input to the planning loop's wave-sizing heuristic.

Source: [Meta Signals](meta-signals.md) § Scoring Formulas.

---

### Technical Risk → Risk Score

Human teams track risk through design reviews, security assessments, and
scope uncertainty. The agent equivalent is `riskScore` — the sum of severity
points from unresolved high-risk slices.

| Severity | Points |
|----------|--------|
| `high` / `Red` | 20 |
| `medium` / `Yellow` | 10 |

Capped at 100. The launch gate reads `riskScore` before dispatching workers.
When risk exceeds the threshold, the gate blocks runtime workers and permits
only fix-only and docs types.

Source: [Meta Signals](meta-signals.md) § Health Log,
[Launch Gate](launch-gate.md).

---

### Exploration Budget → Task Contract Budgets

Human teams allocate time for R&D, spikes, and proof-of-concepts. The agent
equivalent is the set of bounded integers in the task contract:

| Budget Field | Controls |
|--------------|----------|
| `maxFiles` | How many files the worker may change |
| `maxLinesChanged` | Total lines added + removed |
| `softLimitMinutes` | Time before the worker should wrap up |
| `hardLimitMinutes` | Time before the worker is killed |

These budgets are the agent's exploration boundary. A worker that stays within
budget is exploring the solution space safely. A worker that hits limits is
either scope-creeping or facing unexpected complexity — both signals that
feed back into friction and failure scores.

Workers do **not** self-extend budgets. Budget changes require a new task
contract issued by the orchestrator.

Source: [Worker Task Contract](worker-task-contract.md),
[Worker Monitoring Metrics](worker-monitoring-metrics.md) § Budget State.

---

### Organizational Constitution → Seed Constitution

Human teams operate under organizational policies, coding standards, and
compliance rules. The agent equivalent is the **seed constitution** — a
machine-enforced document that defines hard boundaries the agent must not cross.

The constitution has five required sections:

1. **High-Risk Human-Required Boundaries** — decisions that require human
   approval.
2. **Explicit Merge Allowlists** — what the agent may merge autonomously.
3. **Main-Red Launch Stop** — halting rules when main is unhealthy.
4. **Legacy Backend Read-Only Policy** — boundaries on legacy code access.
5. **No Worker Scope Expansion** — preventing scope creep beyond the task
   contract.

The constitution guard validates that the constitution is structurally intact.
The boundary guard enforces its rules on worker diffs. Violations surface as
`boundary guard` failures in the failure score.

Source: [Constitution Guard](constitution-guard.md),
[Seed Constitution](seed-constitution.md).

---

## Data Flow

```
Worker process
    │
    ├──► heartbeat ──► frictionScore ──┐
    │                                  │
    ├──► health gate ──► failureScore ─┼──► trust ──► planning loop
    │                                  │              (wave sizing)
    ├──► telemetry ──► cost ───────────┘
    │
    ├──► monitoring ──► wallTime.utilizationPercent ──► scheduler
    │
    └──► task contract ──► exploreBudget ──► worker self-limiting

Seed constitution ──► boundary guard ──► failureScore (boundary guard category)
```

---

## Relationship to Existing Systems

| System | Feeds | Receives |
|--------|-------|----------|
| [Meta Signals](meta-signals.md) | failure, friction, cost, trust, risk | Health logs, heartbeat logs |
| [Worker Monitoring Metrics](worker-monitoring-metrics.md) | wallTime, cpu, memory, budget | Worker process sampling |
| [Constitution Guard](constitution-guard.md) | Constitution integrity | Seed constitution files |
| [Launch Gate](launch-gate.md) | Pre-dispatch validation | riskScore, health state |
| [Planning Loop](planning-loop.md) | Wave sizing, prioritization | All meta-signals |
| [Worker Telemetry Schema](worker-telemetry-schema.md) | Post-hoc cost, outcome | Worker completion |

---

## Design Decisions

- **Derived, not collected.** Most motivation metrics are derived from
  existing telemetry — they do not require new instrumentation.
- **Single trust signal.** Trust is a weighted composite, not a separate
  collection. This avoids double-counting failures and friction.
- **Budgets are hard limits.** Unlike human exploration budgets (which can
  be negotiated), agent budgets are enforced by the task contract. Workers
  cannot extend their own scope.
- **Constitution is machine-enforced.** Unlike human policies (which rely on
  code review), the agent constitution is validated by guards that fail the
  build on violation.
- **No secrets.** None of these metrics contain tokens, API keys, or
  credentials.

---

## See Also

- [Meta Signals](meta-signals.md) — Deterministic signal calculator
- [Worker Monitoring Metrics](worker-monitoring-metrics.md) — Live runtime
  state for dashboards
- [Constitution Guard](constitution-guard.md) — Pre-flight constitution
  validation
- [Launch Gate](launch-gate.md) — Pre-dispatch validation
- [Planning Loop](planning-loop.md) — Wave sizing and prioritization
- [Worker Task Contract](worker-task-contract.md) — Budget definitions
- [Failure Taxonomy](failure-taxonomy.md) — Failure classification
  categories
