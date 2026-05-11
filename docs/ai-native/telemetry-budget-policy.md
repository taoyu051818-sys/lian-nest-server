# Telemetry Budget Policy

Defines wall-clock limits, token budgets, estimated cost fields, confidence/source rules, timeout handling, and cost-overrun escalation for AI worker telemetry.

> **Machine-readable policy:** [telemetry-budget-policy.json](../../.github/ai-policy/telemetry-budget-policy.json)

---

## Purpose

AI workers consume tokens, wall-clock time, and compute budget. Without a governance policy, workers can silently overrun budgets, produce unpredictable costs, or hang indefinitely. This policy defines:

1. Soft and hard wall-clock limits per task type
2. Token budget fields for estimation and tracking
3. Estimated cost fields with pricing reference
4. Confidence levels and source hierarchy for telemetry data
5. Timeout handling with graduated responses
6. Cost-overrun escalation with warning, critical, and hard-stop thresholds

---

## Wall-Clock Limits

Every worker task has two time boundaries:

| Boundary | Meaning | Enforcement |
|----------|---------|-------------|
| `softLimitMinutes` | Target completion time | Worker self-reports progress. Informational only. |
| `hardLimitMinutes` | Absolute cutoff | Worker MUST publish partial progress before this boundary. |

### Defaults by Task Type

| Task Type | Soft Limit | Hard Limit |
|-----------|------------|------------|
| `docs` | 15 min | 30 min |
| `execution` | 45 min | 90 min |
| `review` | 20 min | 40 min |
| Default (unspecified) | 30 min | 60 min |

### Extensions

If a worker is making progress at the hard limit, an extension of up to `extensionMinutes` (default 15, max 30) may be granted. After the extension expires, the worker MUST force-publish whatever is available.

---

## Token Budget Fields

Token budgets are tracked via four fields:

| Field | Type | When Set | Description |
|-------|------|----------|-------------|
| `estimatedInputTokens` | integer | Launch time | Estimated input tokens for the session |
| `estimatedOutputTokens` | integer | Launch time | Estimated output tokens for the session |
| `actualInputTokens` | integer | After completion | Actual input tokens consumed |
| `actualOutputTokens` | integer | After completion | Actual output tokens consumed |

### Default Token Budgets by Task Type

| Task Type | Max Input Tokens | Max Output Tokens |
|-----------|------------------|-------------------|
| `docs` | 200,000 | 50,000 |
| `execution` | 500,000 | 150,000 |
| `review` | 300,000 | 80,000 |

---

## Estimated Cost Fields

Cost is derived from token counts and model pricing.

| Field | Type | Description |
|-------|------|-------------|
| `estimatedCostUsd` | number | Pre-launch cost estimate |
| `actualCostUsd` | number | Post-completion actual cost |
| `costSource` | enum | How the cost was derived: `api-header`, `manual-estimate`, `token-calculation` |

### Pricing Reference

Used for token-to-cost calculation when API headers are not available:

| Direction | Rate (USD per 1M tokens) |
|-----------|--------------------------|
| Input | $3.00 |
| Output | $15.00 |

> Update this reference when Anthropic changes pricing. Last updated: 2026-05-11.

---

## Confidence and Source Rules

Telemetry data comes from multiple sources with varying reliability.

### Confidence Levels

| Level | Min Signals | Meaning |
|-------|-------------|---------|
| `high` | 3+ | Multiple telemetry signals agree. High trust. |
| `medium` | 2 | Two signals agree. Acceptable for reporting. |
| `low` | 1 | Single signal only. Requires manual verification. |

### Source Hierarchy

When sources disagree, higher-precedence sources win:

| Precedence | Source | Description |
|------------|--------|-------------|
| 1 | `api-response-header` | Token/cost data from Anthropic API response headers. Most authoritative. |
| 2 | `heartbeat-snapshot` | Wall-clock and state data from the heartbeat monitor. |
| 3 | `worker-self-report` | Token/cost estimates from the worker's own telemetry output. |
| 4 | `launcher-estimate` | Pre-launch estimates based on task complexity. Least authoritative. |

---

## Timeout Handling

Timeout responses are graduated based on which limit is breached.

| Event | Action | Description |
|-------|--------|-------------|
| Soft limit reached | `warn` | Worker logs a warning and self-reports progress. No forced action. |
| Hard limit reached | `publish-partial` | Worker commits partial progress and opens a PR or comments a blocker. |
| Extension expired | `force-publish` | Worker MUST publish whatever is available. No further extensions. |

### Stale Detection

Mirrors the heartbeat monitor thresholds from [worker-heartbeat.md](worker-heartbeat.md):

| Threshold | Default | Transition |
|-----------|---------|------------|
| `noOutputThresholdMs` | 60,000 ms (1 min) | `running` → `running:no-output` |
| `staleThresholdMs` | 300,000 ms (5 min) | `running:no-output` → `stale` |

---

## Cost-Overrun Escalation

When a worker's actual cost approaches or exceeds its budget, graduated escalation actions apply.

### Thresholds

| Threshold | Default | Meaning |
|-----------|---------|---------|
| `warningAtPercent` | 80% | Emit warning. Worker continues. |
| `criticalAtPercent` | 100% | Emit critical alert. Worker may be paused. |
| `hardStopAtPercent` | 150% | Force-stop worker. Publish partial progress. |

### Escalation Actions

| Threshold | Action | Description |
|-----------|--------|-------------|
| Warning | `log-warning` | Log a structured warning. Worker continues. |
| Critical | `notify-orchestrator` | Notify orchestrator. Worker may be paused or have budget increased. |
| Hard stop | `force-publish-and-stop` | Worker publishes partial progress and terminates. |

### Override Policy

Human operators may override cost limits per-task via the task JSON `budgets` field:

- `maxCostUsd` — explicit cost cap for the task
- `costOverrideReason` — documented reason for the override

---

## Telemetry Snapshot Integration

The heartbeat monitor snapshot (`monitor-state.json`) is extended with budget telemetry fields:

| Field | Type | Description |
|-------|------|-------------|
| `tokenBudgetUsedPercent` | number | Percentage of token budget consumed |
| `costEstimateUsd` | number | Running cost estimate based on actual tokens |
| `wallClockUsedPercent` | number | Percentage of hard wall-clock limit consumed |
| `budgetConfidence` | enum | Confidence level: `high`, `medium`, `low` |

These fields are additive — existing snapshot fields are unchanged.

---

## Relationship to Existing Policies

| Policy | Relationship |
|--------|-------------|
| [Worker Task Contract](worker-task-contract.md) | Token/cost fields extend the `budgets` section of the task JSON |
| [Worker Heartbeat](worker-heartbeat.md) | Telemetry snapshot fields are additive to heartbeat snapshots |
| [Worker Acceptance Checklist](worker-acceptance-checklist.md) | Budget compliance checks extend the pre-flight checklist |
| [Failure Taxonomy](failure-taxonomy.md) | Cost overruns may generate new failure categories |
| [Orchestration](orchestration.md) | Launcher reads token/cost estimates at dispatch time |

---

## Enforcement

This policy is **advisory for current workers**. Workers SHOULD report telemetry fields and respect budgets. Enforcement (hard stops, forced publishing) is implemented by the orchestrator and heartbeat monitor, not by workers themselves.

Future work:
- [ ] Wire token/cost fields into task schema (`scripts/ai/task.schema.json`)
- [ ] Add budget telemetry to heartbeat snapshot schema (`scripts/ai/monitor-state.schema.json`)
- [ ] Implement cost-overrun detection in the orchestrator
- [ ] Add budget compliance to the worker acceptance checklist
