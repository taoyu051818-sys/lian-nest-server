# Token/Time/Cost Fact Layer

Defines how token counts, wall-clock time, and cost enter the fact layer
as first-class telemetry facts — distinguishing actual from estimated
semantics and specifying Command Steward usage.

> **Closes:** [#1176](https://github.com/taoyu051818-sys/lian-nest-server/issues/1176)
>
> **See also:**
> [worker-telemetry-schema.md](worker-telemetry-schema.md) for the
> telemetry record shape,
> [telemetry-budget-policy.md](telemetry-budget-policy.md) for budget
> limits and escalation,
> [command-steward-brief-contract.md](command-steward-brief-contract.md)
> for brief field definitions,
> [fact-event-ledger.md](fact-event-ledger.md) for the append-only
> event log.

---

## Purpose

Token counts, wall-clock time, and cost estimates are observable facts
about worker resource consumption. They flow into the fact layer through
two channels:

1. **Worker telemetry records** — per-task cost accounting written after
   task completion or at checkpoint intervals.
2. **Fact event ledger entries** — discrete events (e.g.,
   `worker.token-budget-warning`) appended to
   `.github/ai-state/fact-events.ndjson`.

This document defines:

- The distinction between **actual** and **estimated** facts
- Source hierarchy and confidence semantics
- How the Command Steward reads and presents these facts
- The invariant that estimates must never be treated as billing facts

---

## Actual vs Estimated

Every token, time, and cost value in the fact layer carries a source
classification that determines its trust level.

### Token Facts

| Field | Kind | Source | Confidence | When Set |
|-------|------|--------|------------|----------|
| `tokenUsage.inputTokens` | **actual** | `api_response` | `high` | After API returns usage headers |
| `tokenUsage.outputTokens` | **actual** | `api_response` | `high` | After API returns usage headers |
| `tokenUsage.inputTokens` | **actual** (parsed) | `log_parse` | `medium` | Parsed from worker output logs |
| `tokenUsage.outputTokens` | **actual** (parsed) | `log_parse` | `medium` | Parsed from worker output logs |
| `tokenUsage.inputTokens` | **estimated** | `estimate` | `low` | Heuristic before or without API data |
| `tokenUsage.outputTokens` | **estimated** | `estimate` | `low` | Heuristic before or without API data |

### Time Facts

| Field | Kind | Source | Description |
|-------|------|--------|-------------|
| `timing.elapsedMs` | **actual** | heartbeat snapshot | Wall-clock elapsed from task start to capture |
| `timing.softTimeMinutes` | **budget** | task contract | Target completion time — not a measurement |
| `timing.hardTimeMinutes` | **budget** | task contract | Absolute cutoff — not a measurement |

Wall-clock time is always **actual** when measured. Soft and hard limits
are budget declarations, not observations.

### Cost Facts

| Field | Kind | Source | Description |
|-------|------|--------|-------------|
| `estimatedCost.amountCents` | **estimate** | derived from tokens | Monetary estimate computed from token counts and pricing reference |
| `estimatedCost.pricingBasis` | **metadata** | — | `api_list`, `estimated`, or `unknown` — describes how cost was derived |

Cost is **never an actual billing fact** in the current system. It is
always a derived estimate from token counts and a pricing reference.
The `pricingBasis` field makes this explicit.

---

## Source Hierarchy

When multiple sources provide the same field, higher-precedence sources
win:

| Precedence | Source | Reliability |
|------------|--------|-------------|
| 1 | `api-response-header` | Anthropic API response headers — most authoritative |
| 2 | `heartbeat-snapshot` | Wall-clock and state from heartbeat monitor |
| 3 | `worker-self-report` | Token/cost estimates from worker telemetry output |
| 4 | `launcher-estimate` | Pre-launch estimates based on task complexity — least authoritative |

The worker telemetry calculator applies this hierarchy when merging
inputs from multiple sources. See
[worker-telemetry-calculator.md](worker-telemetry-calculator.md).

---

## Confidence Levels

| Level | Min Signals | Meaning | Trust for Billing |
|-------|-------------|---------|-------------------|
| `high` | 3+ | Multiple telemetry signals agree | Authoritative |
| `medium` | 2 | Two signals agree | Acceptable for reporting |
| `low` | 1 | Single signal only | **Must not** be used for billing |

A `low` confidence value means the data is heuristic. It is useful for
planning and budgeting but MUST NOT be treated as a billing fact.

---

## Invariant: Estimates Are Not Billing Facts

**Rule:** A cost or token value with `confidence: "low"` or
`pricingBasis: "unknown"` or `pricingBasis: "estimated"` MUST NOT be
treated as an actual billing fact.

This invariant holds because:

1. Estimates are derived from heuristics (message count, message length,
   default pricing) and may diverge from actual API charges.
2. Actual billing data comes only from API response headers
   (`source: "api_response"`, `confidence: "high"`).
3. The system has no invoice integration — all cost figures are
   projections, not receipts.

Consumers that need billing-grade data MUST check `source` and
`confidence` before using a value. The telemetry schema enforces this
pairing at the field level.

---

## Fact Event Entries

Token and cost events enter the append-only fact event ledger when
budget thresholds are crossed:

| Event Type | Trigger | Facts |
|------------|---------|-------|
| `worker.token-budget-warning` | Token budget > 80% consumed | `inputTokens`, `outputTokens`, `budgetPercent` |
| `worker.token-budget-critical` | Token budget > 100% consumed | `inputTokens`, `outputTokens`, `budgetPercent` |
| `worker.cost-budget-warning` | Cost estimate > 80% of cap | `amountCents`, `budgetPercent` |
| `worker.cost-budget-critical` | Cost estimate > 100% of cap | `amountCents`, `budgetPercent` |
| `worker.hard-time-limit` | Hard wall-clock limit reached | `elapsedMs`, `hardLimitMinutes` |

These events are facts — they record that a threshold was crossed at a
specific time. The underlying token/cost values within the event are
still subject to source/confidence classification.

---

## Command Steward Usage

The Command Steward Agent reads token, time, and cost facts for its
daily brief and status brief surfaces.

### Daily Brief Fields

The Command Steward includes these token/time/cost fields in its daily
brief when available:

| Brief Field | Fact Source | Source Type | Notes |
|-------------|-------------|-------------|-------|
| Total tokens (wave) | Aggregate of `tokenUsage` from telemetry records | Computed | Sum across active wave tasks |
| Total cost estimate (wave) | Aggregate of `estimatedCost` from telemetry records | Computed | Sum with `pricingBasis` noted |
| Budget utilization | `tokenBudgetUsedPercent` from heartbeat snapshots | Runtime | Percentage of allocated budget consumed |
| Wall-clock utilization | `wallClockUsedPercent` from heartbeat snapshots | Runtime | Percentage of hard limit consumed |

### Status Brief (WebUI)

The WebUI Command Steward console displays:

| Panel | Fact Source | Display |
|-------|-------------|---------|
| Resource pressure | Provider load + worker count + budget utilization | `normal`, `elevated`, `critical` |
| Trust score | `actionReadiness` from `/api/state` | Number 0–100 |
| Active workers | `.claude/worktrees/` scan | Count with per-worker status |

### Missing-Field Fallback

When token/time/cost facts are absent:

| Missing Source | Fallback | Escalation |
|----------------|----------|------------|
| Telemetry records | Report `unknown` | No telemetry data available for wave |
| Heartbeat snapshots | Report `unknown` | Worker heartbeat data unavailable |
| Budget utilization | Treat as 0% | Conservative default; do not assume budget consumed |

The brief **never invents** token or cost values to fill a gap. Unknown
is reported as unknown.

---

## Relationship to Existing Schemas

```
task.schema.json              — defines budgets (token limits, time limits, cost caps)
monitor-state.schema.json     — captures runtime liveness + budget utilization %
worker-telemetry.schema.json  — captures actual/estimated token, time, cost after completion
fact-event.schema.json        — records threshold-crossing events
```

### Data Flow

```
Launcher estimates (pre-launch)
    │
    ▼
Task contract (budgets set)
    │
    ▼
Worker runs (heartbeat tracks elapsed, budget %)
    │
    ▼
Worker completes (telemetry record written)
    │
    ├──► Fact event ledger (threshold events)
    │
    ├──► Command Steward brief (aggregated reads)
    │
    └──► State reconciler (drift detection)
```

Pre-launch estimates flow from the launcher into the task contract.
During execution, the heartbeat monitor tracks actual wall-clock time
and budget utilization. After completion, the telemetry calculator
merges all sources into a single record with source/confidence
metadata. The Command Steward reads these records for its brief.

---

## Validation

| Check | Command | Expected |
|-------|---------|----------|
| Docs consistency | `npm run check` | Exit 0 |

---

## Cross-References

- [Worker Telemetry Schema](worker-telemetry-schema.md) — Full record shape with token, time, cost fields
- [Worker Telemetry Calculator](worker-telemetry-calculator.md) — Source merging and confidence assignment
- [Telemetry Budget Policy](telemetry-budget-policy.md) — Budget limits, escalation, and pricing reference
- [Exploration Budget Policy](exploration-budget-policy.md) — Token/cost ceilings for exploration activities
- [Fact Event Ledger](fact-event-ledger.md) — Append-only event log
- [Fact Event Schema](fact-event-schema.md) — Event JSON schema
- [Command Steward Agent](command-steward-agent.md) — Agent definition and brief workflow
- [Command Steward Brief Contract](command-steward-brief-contract.md) — Brief field definitions
- [Worker Heartbeat](worker-heartbeat.md) — Runtime liveness and budget tracking
- [#1176](https://github.com/taoyu051818-sys/lian-nest-server/issues/1176) — This feature
