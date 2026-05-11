# Worker Telemetry Schema

Defines the telemetry record emitted after a worker task completes (or at checkpoint intervals), capturing cost, progress, and quality signals for accounting.

**Schema location:** `schemas/worker-telemetry.schema.json`

## Purpose

The existing control plane tracks:

| Layer | Captures | Schema |
|-------|----------|--------|
| Task contract | What the worker was asked to do | `task.schema.json` |
| Heartbeat | Whether the process is alive | `monitor-state.schema.json` |
| Acceptance | Whether it passed or failed | (checklist doc) |
| **Telemetry** | **How much it cost and what it produced** | **`worker-telemetry.schema.json`** |

Telemetry bridges the gap between **budgeted plans** (task contract) and **actual resource consumption** (LLM tokens, wall-clock time, file changes).

## Record Shape

A telemetry record has these top-level groups:

```
schemaVersion        -- pinned to 1
taskId               -- correlates to heartbeat
capturedAt           -- ISO-8601 timestamp
issueNumber / prNumber -- GitHub references
taskType / actorRole / pmPhase -- task identity
timing               -- elapsed time, progress milestones
tokenUsage           -- LLM token counts with source/confidence
estimatedCost        -- monetary estimate in cents
changedFiles         -- actual file footprint vs budgets
validationResults    -- command outcomes
qualitySignals       -- detected issues (optional)
gateOutcome          -- final pass/fail
```

## Field Details

### Identity Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `1` (const) | yes | Schema version. Consumers reject other values. |
| `taskId` | string | yes | Matches the heartbeat `taskId`. |
| `capturedAt` | date-time | yes | When this record was captured. |
| `issueNumber` | integer or null | no | GitHub issue targeted by the task. |
| `prNumber` | integer or null | no | GitHub PR produced by the task. |
| `taskType` | enum | no | `execution`, `research`, or `review`. |
| `actorRole` | string | no | Worker role from the task contract `rolePacket`. |
| `pmPhase` | string or null | no | Wave/phase identifier for aggregation. |

### Timing

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `timing.elapsedMs` | integer >= 0 | yes | Wall-clock time from task start to capture. |
| `timing.softTimeMinutes` | integer or null | no | Budgeted soft limit from task contract. |
| `timing.hardTimeMinutes` | integer or null | no | Budgeted hard limit from task contract. |
| `timing.progressMilestones[]` | array | no | Ordered checkpoints with `label`, `at` (date-time), and optional `detail`. |

Utilization ratio: `elapsedMs / (softTimeMinutes * 60000)`.

### Token Usage

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tokenUsage.inputTokens` | integer >= 0 | yes | Prompt tokens consumed. |
| `tokenUsage.outputTokens` | integer >= 0 | yes | Completion tokens consumed. |
| `tokenUsage.source` | enum | yes | How obtained: `api_response`, `log_parse`, `estimate`. |
| `tokenUsage.confidence` | enum | yes | Reliability: `high` (direct API), `medium` (parsed), `low` (estimated). |
| `tokenUsage.cachedInputTokens` | integer or null | no | Tokens served from prompt cache. |
| `tokenUsage.apiCalls` | integer or null | no | Number of LLM API calls. |

**Source/confidence pairing:**

| Source | Typical confidence | When |
|--------|-------------------|------|
| `api_response` | `high` | Provider returns usage in response |
| `log_parse` | `medium` | Parsed from worker output logs |
| `estimate` | `low` | Heuristic based on message count/length |

### Estimated Cost

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `estimatedCost.amountCents` | integer >= 0 | yes | Cost in USD cents. Zero = negligible or unknown. |
| `estimatedCost.currency` | `USD` (const) | yes | Always USD. |
| `estimatedCost.model` | string | yes | LLM model identifier for pricing. |
| `estimatedCost.pricingBasis` | enum or null | no | `api_list`, `estimated`, or `unknown`. |

### Changed Files

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `changedFiles.count` | integer >= 0 | yes | Files modified or created. |
| `changedFiles.maxBudget` | integer or null | no | Budgeted `maxFiles` from task contract. |
| `changedFiles.linesAdded` | integer >= 0 | yes | Total lines added. |
| `changedFiles.linesRemoved` | integer >= 0 | yes | Total lines removed. |
| `changedFiles.maxLinesBudget` | integer or null | no | Budgeted `maxLinesChanged` from task contract. |

Budget utilization: `count / maxBudget` and `(linesAdded + linesRemoved) / maxLinesBudget`.

### Validation Results

Array of objects, one per validation command from the task contract:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | yes | The command executed. |
| `exitCode` | integer >= 0 | yes | 0 = pass, non-zero = fail. |
| `durationMs` | integer or null | no | Command wall-clock duration. |

### Quality Signals (optional)

Array of detected quality issues, aligned with the [failure taxonomy](failure-taxonomy.md):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | enum | yes | `dependency_generate`, `runtime_compile`, `boundary_guard`, `docs_guard`, `unknown`. |
| `severity` | enum | yes | `red` (critical) or `yellow` (non-critical). |
| `confidence` | enum | yes | `high`, `medium`, or `low`. |
| `message` | string or null | no | Human-readable description. |

### Gate Outcome

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `gateOutcome.passed` | boolean | yes | Whether all gates passed. |
| `gateOutcome.reason` | string or null | no | Primary failure reason if not passed. |
| `gateOutcome.mainHealthPolicy` | enum or null | no | Policy applied: `gate-all`, `gate-docs-only`, `gate-none`. |
| `gateOutcome.generatedCodePolicy` | enum or null | no | Policy applied: `forbid`, `allow-with-regenerate-note`, `source-artifact`. |

## Example Record

```json
{
  "schemaVersion": 1,
  "taskId": "wave10-issue-365-worker-001",
  "capturedAt": "2026-05-11T14:30:00Z",
  "issueNumber": 365,
  "prNumber": 370,
  "taskType": "execution",
  "actorRole": "schema-contract-worker",
  "pmPhase": "self-cycle-wave10-fact-to-task-control-plane",
  "timing": {
    "elapsedMs": 185000,
    "softTimeMinutes": 45,
    "hardTimeMinutes": 90,
    "progressMilestones": [
      { "label": "schema_draft", "at": "2026-05-11T14:25:00Z" },
      { "label": "docs_written", "at": "2026-05-11T14:28:00Z" }
    ]
  },
  "tokenUsage": {
    "inputTokens": 42000,
    "outputTokens": 8500,
    "source": "api_response",
    "confidence": "high",
    "cachedInputTokens": 18000,
    "apiCalls": 3
  },
  "estimatedCost": {
    "amountCents": 28,
    "currency": "USD",
    "model": "claude-opus-4-7",
    "pricingBasis": "api_list"
  },
  "changedFiles": {
    "count": 2,
    "maxBudget": 6,
    "linesAdded": 220,
    "linesRemoved": 0,
    "maxLinesBudget": 500
  },
  "validationResults": [
    { "command": "npm run check", "exitCode": 0, "durationMs": 12000 },
    { "command": "npm run build", "exitCode": 0, "durationMs": 45000 }
  ],
  "qualitySignals": null,
  "gateOutcome": {
    "passed": true,
    "reason": null,
    "mainHealthPolicy": "gate-all",
    "generatedCodePolicy": "allow-with-regenerate-note"
  }
}
```

## Aggregation

Individual telemetry records can be aggregated by:

- **Wave/phase:** Group by `pmPhase` to see per-wave cost.
- **Role:** Group by `actorRole` to compare worker efficiency.
- **Risk profile:** Join with task contract `risk` and `complexityAssessment.level`.
- **Model:** Group by `estimatedCost.model` to track model-specific spend.

Suggested derived metrics:

- **Token utilization:** `outputTokens / inputTokens`
- **Time utilization:** `elapsedMs / (softTimeMinutes * 60000)`
- **File utilization:** `changedFiles.count / changedFiles.maxBudget`
- **Cost per issue:** `estimatedCost.amountCents` aggregated per `issueNumber`
- **Gate pass rate:** `gateOutcome.passed` ratio across a wave

## Relationship to Other Schemas

```
task.schema.json          -- defines the plan (budgets, roles, commands)
monitor-state.schema.json -- captures runtime liveness (state, elapsed, silence)
worker-telemetry.schema.json -- captures cost and outcome (tokens, cost, files, gates)
```

The telemetry record references task contract values (budgets, policies) for utilization comparison but does not duplicate the full contract. Consumers should join on `taskId` to correlate telemetry with the originating task.
