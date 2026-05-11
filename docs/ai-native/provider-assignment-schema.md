# Provider Assignment Schema

Defines the record emitted when a provider is assigned to a worker task,
capturing the selection metadata, concurrency snapshot, and outcome.

> **Closes:** [#525](https://github.com/taoyu051818-sys/lian-nest-server/issues/525)

---

## Schema Location

`schemas/provider-assignment.schema.json`

---

## Purpose

The provider pool manages multiple API credentials for quota-aware concurrency.
When the launcher assigns a provider to a worker, an assignment record captures:

| Layer | Captures | Schema |
|-------|----------|--------|
| Provider pool policy | Allowed providers, limits, rules | `provider-pool-policy.json` |
| Provider pool state | Current availability, cooldowns | `provider-pool.json` |
| **Provider assignment** | **Which provider was picked, when, and why** | **`provider-assignment.schema.json`** |
| Worker telemetry | Cost, tokens, file changes | `worker-telemetry.schema.json` |

The assignment record bridges the gap between **pool state** (which providers
exist and their capacity) and **telemetry** (what the worker actually consumed).
It enables post-hoc analysis of provider selection quality and exhaustion patterns.

---

## Record Shape

A provider assignment record has these top-level groups:

```
schemaVersion         -- pinned to 1
assignmentId          -- unique assignment identifier
taskId                -- correlates to heartbeat and telemetry
providerId            -- the selected provider
assignedAt            -- ISO-8601 timestamp
releasedAt            -- when the assignment ended (nullable)
issueNumber / prNumber -- GitHub references
taskType / actorRole / pmPhase -- task identity
selectionStrategy     -- algorithm used (least-loaded, etc.)
providerStatus        -- concurrency snapshot at assignment time
globalConcurrency     -- global pool snapshot at assignment time
assignmentMethod      -- how provider id was communicated
envVarName            -- env var used (nullable)
outcome               -- post-execution result (nullable)
notes                 -- free-text annotation (no secrets)
```

---

## Field Details

### Identity Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `1` (const) | yes | Schema version. Consumers reject other values. |
| `assignmentId` | string | yes | Unique id, e.g. `assign-wave14-issue-525-001`. |
| `taskId` | string | yes | Matches the heartbeat and telemetry `taskId`. |
| `providerId` | string | yes | Provider identifier from the pool policy. |
| `assignedAt` | date-time | yes | When the provider was assigned. |
| `releasedAt` | date-time or null | no | When the assignment ended. Null if still active. |

### Task Identity

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `issueNumber` | integer or null | no | GitHub issue targeted by the task. |
| `prNumber` | integer or null | no | GitHub PR produced by the task. |
| `taskType` | enum or null | no | `execution`, `research`, or `review`. |
| `actorRole` | string or null | no | Worker role from the task contract. |
| `pmPhase` | string or null | no | Wave/phase identifier for aggregation. |

### Selection

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `selectionStrategy` | enum | yes | `least-loaded`, `round-robin`, `manual`, or `failover`. |

Matches `concurrency.providerSelectionStrategy` from the provider pool policy.

### Provider Status Snapshot

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `providerStatus.status` | enum | yes | Provider status: `available`, `exhausted`, `disabled`. |
| `providerStatus.currentConcurrency` | integer >= 0 | yes | Active workers on this provider at assignment time. |
| `providerStatus.maxConcurrency` | integer >= 1 | yes | Provider concurrency cap from policy. |
| `providerStatus.consecutiveFailures` | integer or null | no | Failure streak at assignment time. |

### Global Concurrency Snapshot

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `globalConcurrency.totalActiveWorkers` | integer >= 0 | yes | Total workers across all providers. |
| `globalConcurrency.globalMaxWorkers` | integer >= 1 | yes | Global cap from policy. |
| `globalConcurrency.availableProviders` | integer or null | no | Providers with remaining capacity. |

### Assignment Method

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `assignmentMethod` | enum | yes | `env-var`, `config-inject`, or `manual`. |
| `envVarName` | string or null | no | Environment variable name, e.g. `LIAN_PROVIDER_ID`. |

### Outcome (nullable)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `outcome.status` | enum | yes | `completed`, `failed`, `exhausted`, or `cancelled`. |
| `outcome.failureClass` | enum or null | no | `exhaustion`, `auth`, `runtime`, or null. |
| `outcome.httpStatus` | integer or null | no | HTTP status from provider API (100-599). |
| `outcome.detail` | string or null | no | Human-readable detail. Must not contain secrets. |

### Notes

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `notes` | string or null | no | Free-text annotation. Must not contain secrets. |

---

## Example: Successful Assignment

```json
{
  "schemaVersion": 1,
  "assignmentId": "assign-wave14-issue-525-001",
  "taskId": "wave14-issue-525-worker-001",
  "providerId": "provider-default",
  "assignedAt": "2026-05-11T13:32:00Z",
  "releasedAt": "2026-05-11T14:15:00Z",
  "issueNumber": 525,
  "prNumber": 530,
  "taskType": "execution",
  "actorRole": "ai-native-tooling-worker",
  "pmPhase": "self-cycle-wave14-concurrency-topup",
  "selectionStrategy": "least-loaded",
  "providerStatus": {
    "status": "available",
    "currentConcurrency": 0,
    "maxConcurrency": 1,
    "consecutiveFailures": 0
  },
  "globalConcurrency": {
    "totalActiveWorkers": 12,
    "globalMaxWorkers": 30,
    "availableProviders": 1
  },
  "assignmentMethod": "env-var",
  "envVarName": "LIAN_PROVIDER_ID",
  "outcome": {
    "status": "completed",
    "failureClass": null,
    "httpStatus": null,
    "detail": null
  },
  "notes": null
}
```

---

## Example: Exhaustion Failover

```json
{
  "schemaVersion": 1,
  "assignmentId": "assign-wave14-issue-440-002",
  "taskId": "wave14-issue-440-worker-002",
  "providerId": "provider-default",
  "assignedAt": "2026-05-11T15:00:00Z",
  "releasedAt": "2026-05-11T15:03:00Z",
  "issueNumber": 440,
  "prNumber": null,
  "taskType": "execution",
  "actorRole": "runtime-feature-worker",
  "pmPhase": "self-cycle-wave14-concurrency-topup",
  "selectionStrategy": "least-loaded",
  "providerStatus": {
    "status": "available",
    "currentConcurrency": 2,
    "maxConcurrency": 3,
    "consecutiveFailures": 0
  },
  "globalConcurrency": {
    "totalActiveWorkers": 28,
    "globalMaxWorkers": 30,
    "availableProviders": 1
  },
  "assignmentMethod": "env-var",
  "envVarName": "LIAN_PROVIDER_ID",
  "outcome": {
    "status": "exhausted",
    "failureClass": "exhaustion",
    "httpStatus": 429,
    "detail": "Provider returned 429 after 3 API calls."
  },
  "notes": "Failover to secondary provider not available — only one provider configured."
}
```

---

## Example: Active Assignment (no outcome yet)

```json
{
  "schemaVersion": 1,
  "assignmentId": "assign-wave14-issue-526-001",
  "taskId": "wave14-issue-526-worker-001",
  "providerId": "provider-default",
  "assignedAt": "2026-05-11T16:00:00Z",
  "releasedAt": null,
  "issueNumber": 526,
  "prNumber": null,
  "taskType": "execution",
  "actorRole": "docs-worker",
  "pmPhase": "self-cycle-wave14-concurrency-topup",
  "selectionStrategy": "least-loaded",
  "providerStatus": {
    "status": "available",
    "currentConcurrency": 1,
    "maxConcurrency": 1,
    "consecutiveFailures": 0
  },
  "globalConcurrency": {
    "totalActiveWorkers": 15,
    "globalMaxWorkers": 30,
    "availableProviders": 1
  },
  "assignmentMethod": "env-var",
  "envVarName": "LIAN_PROVIDER_ID",
  "outcome": null,
  "notes": null
}
```

---

## Integration

### Provider Pool Policy

The `selectionStrategy` and `assignmentMethod` values correspond to fields in
[provider-pool-policy.json](../.github/ai-policy/provider-pool-policy.json):
- `selectionStrategy` maps to `concurrency.providerSelectionStrategy`
- `assignmentMethod` maps to `workerIntegration.providerAssignment.method`

### Provider Pool State

The `providerStatus` and `globalConcurrency` snapshots capture a point-in-time
view from [provider-pool.json](../.github/ai-state/provider-pool.json). Consumers
can compare the snapshot against historical state to evaluate selection quality.

### Worker Telemetry

The `taskId` field links to the [worker telemetry](worker-telemetry-schema.md)
record. Joining on `taskId` enables analysis of whether provider selection
correlated with task cost, duration, or failure.

### Provider Pool Guard

The [provider pool guard](provider-pool-guard.md) validates policy and state
consistency. Assignment records add a third dimension: did the guard's readiness
check align with actual provider behavior?

---

## Aggregation

Assignment records can be aggregated by:

- **Provider:** Group by `providerId` to see per-provider utilization and failure rates.
- **Wave/phase:** Group by `pmPhase` to see per-wave provider load distribution.
- **Outcome:** Group by `outcome.status` to track exhaustion frequency.
- **Selection strategy:** Compare `selectionStrategy` variants for effectiveness.

Suggested derived metrics:

- **Exhaustion rate:** `outcome.status === 'exhausted'` ratio per provider
- **Concurrency utilization:** `providerStatus.currentConcurrency / providerStatus.maxConcurrency`
- **Failover frequency:** count of `selectionStrategy === 'failover'`
- **Assignment duration:** `releasedAt - assignedAt` per task type

---

## Security Model

Provider assignment records contain **no secrets**. The schema explicitly excludes:

| Artifact | Status |
|----------|--------|
| API keys, tokens, credentials | Never included |
| Secret source paths | Not recorded (only method enum) |
| Raw provider responses | Not included |
| Provider account identifiers | Not included |

The `notes` and `outcome.detail` fields are free-text but must not contain
secrets. Consumers should sanitize before publishing.

---

## Validation

The schema uses JSON Schema draft-07. Validate assignment records against it:

```bash
# Using ajv-cli (if installed)
npx ajv validate -s schemas/provider-assignment.schema.json -d <assignment-file>.json

# Using any draft-07 compatible validator
```

---

## See Also

- [Provider Pool](provider-pool.md) — Full architecture and planning doc
- [Provider Pool Guard](provider-pool-guard.md) — Pre-launch provider validation
- [Worker Telemetry Schema](worker-telemetry-schema.md) — Post-execution cost and outcome
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Failure Taxonomy](failure-taxonomy.md) — Failure classification categories
- [#525](https://github.com/taoyu051818-sys/lian-nest-server/issues/525) — This feature
