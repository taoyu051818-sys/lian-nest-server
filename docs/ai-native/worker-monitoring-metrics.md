# Worker Monitoring Metrics

Defines the metrics contract for live worker monitoring exposed to the WebUI dashboard and control-plane telemetry. Each metric row represents a single active or recently completed worker process.

> **Closes:** [#551](https://github.com/taoyu051818-sys/lian-nest-server/issues/551)

---

## Purpose

The control plane already tracks:

| Layer | Captures | Source |
|-------|----------|--------|
| Task contract | What the worker was asked to do | `worker-task-contract.md` |
| Heartbeat | Whether the process is alive | `worker-heartbeat.md` |
| Telemetry | Cost and outcome after completion | `worker-telemetry-schema.md` |
| **Monitoring metrics** | **Live runtime state for dashboards** | **this document** |

Monitoring metrics fill the gap between **heartbeat liveness** (alive/dead) and **post-hoc telemetry** (cost after the fact). They provide a real-time, machine-readable view of every active worker for the WebUI, orchestrator, and control-plane aggregation.

---

## Metric Row Shape

Each worker produces a metric row with these field groups:

```
pid                 -- OS process ID
taskId              -- correlates to heartbeat and telemetry
phase               -- current execution phase
status              -- lifecycle state
issue / pr          -- GitHub references
provider            -- assigned LLM provider and model
wallTime            -- elapsed and budgeted time
cpu / memory        -- OS-level resource usage
budget              -- token and cost budget state
```

---

## Field Reference

### Identity

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pid` | integer | yes | OS process ID of the worker. |
| `taskId` | string | yes | Matches heartbeat `taskId` and telemetry `taskId`. |
| `issue` | integer or null | no | GitHub issue number the worker targets. |
| `pr` | integer or null | no | GitHub PR number produced by the worker. |
| `actorRole` | string | no | Worker role from the task contract `rolePacket`. |

### Phase and Status

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phase` | string | yes | Current execution phase. See [Phase Values](#phase-values). |
| `status` | enum | yes | Lifecycle state. See [Status Values](#status-values). |

#### Phase Values

Phases describe what the worker is currently doing. Values are lowercase, hyphen-separated strings.

| Phase | Meaning |
|-------|---------|
| `initializing` | Worker process started, loading context. |
| `reading-context` | Reading repo state, issue body, CLAUDE.md. |
| `planning` | Analyzing the task and forming a plan. |
| `implementing` | Writing code, editing files. |
| `validating` | Running validation commands (`npm run check`, `npm run build`, etc.). |
| `committing` | Staging and committing changes. |
| `publishing` | Pushing branch, opening or updating PR. |
| `wrapping-up` | Final cleanup, writing summary. |
| `idle` | Worker is alive but not actively processing (e.g., waiting on rate limit). |

Custom phases are allowed. Consumers should handle unknown phase strings gracefully.

#### Status Values

| Status | Meaning | Heartbeat State |
|--------|---------|-----------------|
| `running` | Worker is actively processing. | `running` |
| `silent` | Worker is alive but producing no output. | `running:no-output` |
| `stale` | Worker has been silent beyond the stale threshold. | `stale` |
| `done` | Worker exited successfully (exit code 0). | `done` |
| `failed` | Worker exited with a non-zero code. | `failed` |

### Provider Assignment

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider.name` | string | yes | Provider identifier (e.g. `anthropic`, `openai`). |
| `provider.model` | string | yes | Model identifier (e.g. `claude-opus-4-7`, `claude-sonnet-4-6`). |
| `provider.region` | string or null | no | Deployment region if known. |

### Wall Time

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wallTime.elapsedMs` | integer >= 0 | yes | Milliseconds since worker launch. |
| `wallTime.softLimitMinutes` | integer or null | no | Budgeted soft time limit from task contract. |
| `wallTime.hardLimitMinutes` | integer or null | no | Budgeted hard time limit from task contract. |
| `wallTime.utilizationPercent` | number or null | no | `elapsedMs / (hardLimitMinutes * 60000) * 100`. Null if no hard limit. |

### CPU and Memory

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cpu.percent` | number >= 0 | no | Process CPU usage percentage (0-100 per core). |
| `cpu.sampledAt` | ISO-8601 | no | When the CPU sample was taken. |
| `memory.rssMb` | integer >= 0 | no | Resident set size in megabytes. |
| `memory.heapUsedMb` | integer >= 0 | no | Node.js heap used in megabytes (if applicable). |
| `memory.sampledAt` | ISO-8601 | no | When the memory sample was taken. |

CPU and memory fields are best-effort. They may be absent when the monitoring layer cannot access OS-level process stats (e.g., cross-container monitoring).

### Budget State

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `budget.maxFiles` | integer or null | no | Budgeted max changed files from task contract. |
| `budget.filesChanged` | integer >= 0 | no | Files changed so far. |
| `budget.maxLinesChanged` | integer or null | no | Budgeted max lines changed from task contract. |
| `budget.linesChanged` | integer >= 0 | no | Lines added + removed so far. |
| `budget.estimatedCostCents` | integer >= 0 | no | Running cost estimate in USD cents. |
| `budget.costConfidence` | enum | no | Confidence of cost estimate: `high`, `medium`, `low`. |

---

## Example Metric Row

```json
{
  "pid": 48210,
  "taskId": "wave15-issue-551-worker-001",
  "issue": 551,
  "pr": null,
  "actorRole": "ai-native-control-plane-worker",
  "phase": "implementing",
  "status": "running",
  "provider": {
    "name": "anthropic",
    "model": "claude-opus-4-7",
    "region": null
  },
  "wallTime": {
    "elapsedMs": 312000,
    "softLimitMinutes": 45,
    "hardLimitMinutes": 90,
    "utilizationPercent": 5.78
  },
  "cpu": {
    "percent": 12.4,
    "sampledAt": "2026-05-11T14:05:12Z"
  },
  "memory": {
    "rssMb": 284,
    "heapUsedMb": 142,
    "sampledAt": "2026-05-11T14:05:12Z"
  },
  "budget": {
    "maxFiles": 3,
    "filesChanged": 0,
    "maxLinesChanged": 450,
    "linesChanged": 0,
    "estimatedCostCents": 8,
    "costConfidence": "low"
  }
}
```

---

## Relationship to Other Schemas

```
task.schema.json                 -- defines the plan (budgets, roles, commands)
monitor-state.schema.json        -- captures heartbeat liveness (state, elapsed, silence)
worker-telemetry.schema.json     -- captures post-hoc cost and outcome
worker-monitoring-metrics        -- captures live runtime state for dashboards
```

The monitoring metrics row references task contract values (budgets, provider) for utilization comparison but does not duplicate the full contract. Consumers join on `taskId` to correlate metrics with the originating task, heartbeat, and telemetry record.

### Data Flow

```
Worker process
    │
    ├──► heartbeat monitor ──► monitor-state.json (liveness)
    │
    ├──► metrics collector ──► monitoring metrics row (live state)
    │
    └──► telemetry calculator ──► worker-telemetry.json (outcome)
```

The metrics collector samples the worker process at a configurable interval (default: 30s) and produces a metric row. The WebUI dashboard consumes metric rows for live display. The control-plane aggregator consumes metric rows for fleet-level summaries.

---

## Aggregation

Metric rows can be aggregated for fleet-level monitoring:

| Aggregation | Group By | Derived Metric |
|-------------|----------|----------------|
| Active worker count | (none) | Count of rows where `status` is `running`, `silent`, or `stale`. |
| Phase distribution | `phase` | Percentage of workers in each phase. |
| Provider utilization | `provider.model` | Count of workers per model. |
| Budget pressure | `budget.costConfidence` | Workers with `low` confidence cost estimates. |
| Stale workers | `status` | Workers in `stale` status, grouped by `actorRole`. |
| Time overrun risk | `wallTime.utilizationPercent` | Workers above 80% utilization. |

---

## Design Decisions

- **Best-effort resource stats.** CPU and memory fields are optional. Not all monitoring environments can access OS-level process info. Consumers must handle their absence.
- **Phase is free-form.** Workers may report custom phases beyond the documented values. Dashboards should display unknown phases as-is rather than dropping them.
- **Status maps to heartbeat.** The `status` enum is intentionally aligned with heartbeat states to simplify correlation. Consumers can join on `taskId` + `status` to verify consistency.
- **No secrets.** Metric rows never contain tokens, API keys, env vars, file paths, or command output.
- **Snapshot model.** Each metric row is a point-in-time snapshot. Historical rows are not retained by default; the WebUI shows the latest row per `taskId`.

---

## See Also

- [Worker Heartbeat](worker-heartbeat.md) -- Liveness monitoring and state machine
- [Worker Telemetry Schema](worker-telemetry-schema.md) -- Post-hoc cost and outcome tracking
- [Telemetry Budget Policy](telemetry-budget-policy.md) -- Budget limits and cost-overrun escalation
- [Active Workers State](active-workers-state.md) -- Conflict-group projection for launch gate
- [Worker Task Contract](worker-task-contract.md) -- Task definition and budget fields
