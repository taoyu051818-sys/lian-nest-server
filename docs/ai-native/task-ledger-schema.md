# Task Ledger JSON Schema

Append-only NDJSON ledger for recording task lifecycle events and produced/consumed facts.

> **Schema file:** [`schemas/task-ledger.schema.json`](../../schemas/task-ledger.schema.json)
> **Closes:** [#466](https://github.com/taoyu051818-sys/lian-nest-server/issues/466)

---

## Overview

The task ledger is a machine-readable append-only log at `.github/ai-state/task-ledger.ndjson`. Each line is a single JSON object representing a task lifecycle event — a launch, progress checkpoint, completion, failure, validation outcome, gate decision, or fact production/consumption.

Unlike projection files (which are idempotent snapshots), the ledger is **append-only**. Each new event is a new line; previous entries are never modified or removed. This makes it safe for concurrent writers and trivial to audit.

| Aspect | Value |
|--------|-------|
| Schema version | `schemaVersion: 1` |
| JSON Schema draft | `draft-07` |
| File | `.github/ai-state/task-ledger.ndjson` |
| Format | NDJSON (one JSON object per line) |

---

## Event Types

| Event Type | Description | Typical Severity |
|------------|-------------|:----------------:|
| `task.launch` | Worker task started. | info |
| `task.complete` | Worker task finished successfully. | info |
| `task.fail` | Worker task failed (non-zero exit, error). | error |
| `task.timeout` | Worker task exceeded hard time limit. | error |
| `task.progress` | Progress checkpoint during execution. | info |
| `fact.produced` | Task produced a fact for downstream consumption. | info |
| `fact.consumed` | Task consumed a fact produced by a prior task. | info |
| `validation.pass` | Validation command succeeded (exit code 0). | info |
| `validation.fail` | Validation command failed (non-zero exit). | warning |
| `gate.pass` | Gate check passed. | info |
| `gate.block` | Gate check blocked the task. | error |

---

## Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | `1` (const) | Schema version. Consumers must reject records with a different version. |
| `taskId` | string | Unique identifier for the worker task, matching the heartbeat `taskId` and `worker-telemetry.schema.json` `taskId`. |
| `eventType` | enum | Dot-namespaced event type (see table above). |
| `recordedAt` | date-time | ISO-8601 timestamp when this event was recorded. |

### Identity Fields

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `issueNumber` | integer or null | no | GitHub issue number this task targets. |
| `prNumber` | integer or null | no | GitHub PR number produced by this task. |
| `branch` | string or null | no | Git branch or worktree name. |
| `taskType` | enum or null | no | `execution`, `research`, or `review`. From the task contract. |
| `actorRole` | string or null | no | Worker role from the task contract `rolePacket`. |
| `pmPhase` | string or null | no | Wave or phase identifier for aggregation. |

### Event Detail Fields

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `severity` | enum or null | no | `info`, `warning`, `error`, or `critical`. |
| `description` | string or null | no | Human-readable description of the event. |
| `meta` | object or null | no | Arbitrary key-value metadata. Must not contain secrets or raw logs. |

---

## Facts Object

The `facts` field tracks the fact-to-task protocol — which facts were produced and consumed by this event.

```json
{
  "facts": {
    "produced": [
      {
        "factId": "fact:prisma-schema:User",
        "description": "User model added to Prisma schema",
        "confidence": "definite"
      }
    ],
    "consumed": [
      {
        "factId": "fact:prisma-schema:BaseModels",
        "source": "issue #400"
      }
    ]
  }
}
```

### Produced Facts

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `factId` | string | yes | Unique identifier (e.g. `fact:prisma-schema:User`). |
| `description` | string | yes | Human-readable description of what the fact asserts. |
| `confidence` | enum | no | `definite`, `likely`, or `conditional`. |

### Consumed Facts

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `factId` | string | yes | Unique identifier for the consumed fact. |
| `source` | string or null | no | Where the fact was originally produced. |

The `factId` format and `confidence` levels align with the task-v2 schema's `producesFacts` and `dependsOnFacts` fields. See [task-schema-v2.md](task-schema-v2.md).

---

## Validation Object

The `validation` field records validation command outcomes for `validation.pass` and `validation.fail` events.

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `command` | string or null | no | The validation command executed. |
| `exitCode` | integer or null | no | Process exit code. 0 = pass, non-zero = fail. |
| `durationMs` | integer or null | no | Wall-clock duration in milliseconds. |

---

## Gate Object

The `gate` field records gate check outcomes for `gate.pass` and `gate.block` events.

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `gateType` | enum | yes | `launch`, `pr-review`, `merge`, or `post-merge-health`. |
| `decision` | enum | yes | `pass`, `block`, `warn`, or `override`. |
| `markerId` | string | yes | Machine-readable idempotency marker (e.g. `issue-88-launch`). |

The `gateType`, `decision`, and `markerId` fields align with the gate-result schema. See [gate-result-schema.md](gate-result-schema.md).

---

## Examples

### Task Launch

```json
{
  "schemaVersion": 1,
  "taskId": "wave13-issue-466-worker-001",
  "eventType": "task.launch",
  "recordedAt": "2026-05-11T13:16:40Z",
  "issueNumber": 466,
  "prNumber": null,
  "branch": "claude/wave13-20260511-131640-issue-466-add-task-ledger-json-schema-and-docs",
  "taskType": "execution",
  "actorRole": "ai-native-tooling-worker",
  "pmPhase": "self-cycle-wave13-40-worker-pressure",
  "severity": "info",
  "description": "Worker launched for issue #466",
  "facts": null,
  "validation": null,
  "gate": null,
  "meta": null
}
```

### Fact Produced

```json
{
  "schemaVersion": 1,
  "taskId": "wave13-issue-466-worker-001",
  "eventType": "fact.produced",
  "recordedAt": "2026-05-11T13:25:00Z",
  "issueNumber": 466,
  "prNumber": null,
  "taskType": "execution",
  "severity": "info",
  "description": "Task ledger schema and docs created",
  "facts": {
    "produced": [
      {
        "factId": "fact:schema:task-ledger",
        "description": "JSON schema for task-ledger.ndjson entries exists at schemas/task-ledger.schema.json",
        "confidence": "definite"
      },
      {
        "factId": "fact:docs:task-ledger-schema",
        "description": "Schema documentation exists at docs/ai-native/task-ledger-schema.md",
        "confidence": "definite"
      }
    ],
    "consumed": []
  },
  "validation": null,
  "gate": null,
  "meta": null
}
```

### Validation Pass

```json
{
  "schemaVersion": 1,
  "taskId": "wave13-issue-466-worker-001",
  "eventType": "validation.pass",
  "recordedAt": "2026-05-11T13:30:00Z",
  "issueNumber": 466,
  "taskType": "execution",
  "severity": "info",
  "description": "npm run check passed",
  "facts": null,
  "validation": {
    "command": "npm run check",
    "exitCode": 0,
    "durationMs": 12000
  },
  "gate": null,
  "meta": null
}
```

### Task Complete

```json
{
  "schemaVersion": 1,
  "taskId": "wave13-issue-466-worker-001",
  "eventType": "task.complete",
  "recordedAt": "2026-05-11T13:35:00Z",
  "issueNumber": 466,
  "prNumber": 470,
  "branch": "claude/wave13-20260511-131640-issue-466-add-task-ledger-json-schema-and-docs",
  "taskType": "execution",
  "actorRole": "ai-native-tooling-worker",
  "pmPhase": "self-cycle-wave13-40-worker-pressure",
  "severity": "info",
  "description": "Task completed successfully, PR opened",
  "facts": {
    "produced": [
      {
        "factId": "fact:schema:task-ledger",
        "description": "JSON schema for task-ledger.ndjson entries exists",
        "confidence": "definite"
      }
    ],
    "consumed": []
  },
  "validation": null,
  "gate": {
    "gateType": "pr-review",
    "decision": "pass",
    "markerId": "pr-470-review"
  },
  "meta": null
}
```

---

## Relationship to Other Schemas

```
task-v2.schema.json              -- defines the task contract (budgets, roles, facts)
worker-telemetry.schema.json     -- captures cost and outcome (tokens, cost, files, gates)
task-ledger.schema.json          -- captures lifecycle events and fact flow (this schema)
```

The task ledger records **events over time** for a task. Worker telemetry captures a **point-in-time summary** after completion. Both reference the task contract via `taskId` but serve different read patterns:

| Concern | Schema |
|---------|--------|
| What the worker was asked to do | `task-v2.schema.json` |
| How much it cost and what it produced | `worker-telemetry.schema.json` |
| What happened and when, including fact flow | `task-ledger.schema.json` |

---

## Downstream Consumers

| Consumer | Events Read | Purpose |
|----------|------------|---------|
| **Meta-signals calculator** | `task.fail`, `validation.fail`, `gate.block` | Compute failure and friction scores. |
| **State reconciler** | All events | Cross-reference ledger with current worker/PR state to detect drift. |
| **Fact resolver** | `fact.produced`, `fact.consumed` | Validate fact dependency chain integrity. |
| **Operator dashboards** | All events | Visualize task lifecycle and identify bottlenecks. |
| **Audit log** | All events | Append-only record for compliance and debugging. |

---

## Usage

### Reading the ledger

```bash
# Count events
wc -l .github/ai-state/task-ledger.ndjson

# Filter by event type
grep '"eventType":"task.fail"' .github/ai-state/task-ledger.ndjson

# Filter by task ID
grep '"taskId":"wave13-issue-466-worker-001"' .github/ai-state/task-ledger.ndjson

# Parse with Node.js
node -e "require('fs').readFileSync('.github/ai-state/task-ledger.ndjson','utf8').split('\n').filter(Boolean).map(JSON.parse)"
```

### Validation

```bash
# Using ajv-cli (if installed)
npx ajv validate -s schemas/task-ledger.schema.json -d <entry-file>.json

# Using any draft-07 compatible validator
```

---

## Sanitization

All string fields are sanitized before writing:

- Base64-like strings (40+ chars) → `[redacted-token]`
- `ghp_*` GitHub tokens → `[redacted-gh-token]`
- `Bearer *` headers → `Bearer [redacted]`
- `password=`, `secret=`, `token=` values → `[redacted]`
- String values truncated to 500 characters

The `meta` object must not contain secrets, tokens, raw worker logs, or `llm_io_logs` content.

---

## Design Decisions

- **Append-only, not snapshot.** Projections (`worker-trust.json`, `provider-pool.json`) are idempotent snapshots. The ledger is a growing log. Each serves a different read pattern.
- **NDJSON over JSON array.** NDJSON is streamable, appendable, and doesn't require parsing the entire file to read the latest entry.
- **Fact tracking built-in.** The `facts` field aligns with the task-v2 schema's `producesFacts`/`dependsOnFacts` protocol, enabling dependency chain validation without coupling to the task contract.
- **No secrets.** All fields are sanitized before write. The schema never stores raw tokens, credentials, or log content.
- **`schemaVersion` enables schema evolution.** Consumers should check `schemaVersion` and handle unknown versions gracefully.
- **Event type enum is closed.** Adding new event types requires a schema version bump. This prevents consumer drift from unbounded event types.

---

## References

- [task-v2.schema.json](../../schemas/task-v2.schema.json) — Task contract schema with `producesFacts`/`dependsOnFacts`
- [worker-telemetry.schema.json](../../schemas/worker-telemetry.schema.json) — Telemetry record schema
- [gate-result.schema.json](../../schemas/gate-result.schema.json) — Gate result schema
- [fact-event-ledger.md](fact-event-ledger.md) — Fact event ledger (control-plane facts)
- [gap-ledger.md](gap-ledger.md) — Gap ledger (planning loop deviations)
- [task-schema-v2.md](task-schema-v2.md) — Task contract v2 documentation
- [gate-result-schema.md](gate-result-schema.md) — Gate result schema documentation
