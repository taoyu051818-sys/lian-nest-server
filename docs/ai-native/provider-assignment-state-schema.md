# Provider Assignment State Schema

Formal JSON Schema for provider assignment state — maps active workers to
provider slots and records quota state for scheduling decisions.

> **Schema file:** [`schemas/provider-assignment-state.schema.json`](../../schemas/provider-assignment-state.schema.json)
> **Closes:** [#556](https://github.com/taoyu051818-sys/lian-nest-server/issues/556)

---

## Overview

The provider assignment state captures which workers are assigned to which
API providers at a given point in time. It is the scheduling companion to the
provider pool state (`provider-pool.json`): while the pool state tracks
provider availability and cooldowns, the assignment state tracks the active
worker-to-provider bindings.

| Aspect | Value |
|--------|-------|
| Schema version | `schemaVersion: 1` |
| JSON Schema draft | `draft-07` |
| Writer | Launcher (after worker dispatch) |
| Path | `.github/ai-state/provider-assignment-state.json` (planned) |

---

## Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | `integer` (const `1`) | Schema version. Increment when the shape changes. |
| `capturedAt` | `string` (ISO-8601) | Timestamp when this assignment snapshot was captured. |
| `assignments` | `Assignment[]` | Active worker-to-provider assignments. |
| `providers` | `ProviderState[]` | Per-provider state including capacity and quota. |
| `global` | `GlobalSummary` | Aggregate assignment and capacity summary. |

---

## Definitions

### Assignment

A single worker-to-provider binding. Each entry represents one running worker
assigned to a provider slot.

| Field | Type | Required | Description |
|-------|------|:---:|-------------|
| `taskId` | `string` | Yes | Unique worker task identifier, matching heartbeat taskId. |
| `providerId` | `string` | Yes | Provider the worker is assigned to. |
| `assignedAt` | `string` (ISO-8601) | Yes | When the worker was assigned. |
| `issueNumber` | `integer \| null` | No | GitHub issue number this task targets. |
| `prNumber` | `integer \| null` | No | GitHub pull request number produced by this task. |
| `taskType` | `string` enum | No | Task type: `execution`, `research`, or `review`. |
| `actorRole` | `string` | No | Worker role from the task contract rolePacket. |

### ProviderState

Per-provider capacity and quota status. Each entry corresponds to a provider
defined in `provider-pool-policy.json`.

| Field | Type | Required | Description |
|-------|------|:---:|-------------|
| `providerId` | `string` | Yes | Provider identifier. |
| `status` | `string` enum | Yes | `available`, `exhausted`, or `disabled`. |
| `assignedWorkerCount` | `integer` | Yes | Workers currently assigned to this provider. |
| `maxConcurrency` | `integer` | Yes | Maximum concurrent workers allowed. |
| `quotaState` | `string` enum | No | `healthy`, `approaching_limit`, `exhausted`, or `unknown`. |
| `lastQuotaCheckAt` | `string \| null` | No | Last quota check timestamp. |
| `cooldownExpiresAt` | `string \| null` | No | When the exhaustion cooldown expires. Null if not in cooldown. |
| `consecutiveFailures` | `integer` | No | Consecutive failures. Resets on successful assignment. |

#### Provider Statuses

| Status | Meaning | Auto-Recovery |
|--------|---------|:---:|
| `available` | Has capacity, no cooldown | — |
| `exhausted` | Quota or rate limit hit; cooling down | Yes, after cooldown |
| `disabled` | Auth failure or manual disable | No |

#### Quota States

| State | Meaning |
|-------|---------|
| `healthy` | Well within provider limits. |
| `approaching_limit` | Near capacity — scheduler should prefer other providers. |
| `exhausted` | Quota hit — no new assignments until cooldown expires. |
| `unknown` | No quota signal available. |

### GlobalSummary

Aggregate counts across all providers for quick scheduling decisions.

| Field | Type | Required | Description |
|-------|------|:---:|-------------|
| `totalActiveAssignments` | `integer` | Yes | Active worker assignments across all providers. |
| `totalAvailableSlots` | `integer` | Yes | Remaining capacity on available providers. |
| `totalMaxConcurrency` | `integer` | Yes | Global max workers from policy. |
| `availableProviders` | `integer` | No | Count of providers with status=available. |
| `exhaustedProviders` | `integer` | No | Count of providers with status=exhausted. |
| `disabledProviders` | `integer` | No | Count of providers with status=disabled. |

---

## Example: Single Provider, No Active Workers

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "assignments": [],
  "providers": [
    {
      "providerId": "provider-default",
      "status": "available",
      "assignedWorkerCount": 0,
      "maxConcurrency": 1,
      "quotaState": "healthy",
      "lastQuotaCheckAt": "2026-05-11T12:00:00Z",
      "cooldownExpiresAt": null,
      "consecutiveFailures": 0
    }
  ],
  "global": {
    "totalActiveAssignments": 0,
    "totalAvailableSlots": 1,
    "totalMaxConcurrency": 3,
    "availableProviders": 1,
    "exhaustedProviders": 0,
    "disabledProviders": 0
  }
}
```

## Example: Multiple Providers, Mixed State

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T14:30:00Z",
  "assignments": [
    {
      "taskId": "task-abc123",
      "providerId": "provider-default",
      "assignedAt": "2026-05-11T14:00:00Z",
      "issueNumber": 556,
      "prNumber": null,
      "taskType": "execution",
      "actorRole": "ai-native-control-plane-worker"
    },
    {
      "taskId": "task-def456",
      "providerId": "provider-secondary",
      "assignedAt": "2026-05-11T14:15:00Z",
      "issueNumber": 400,
      "prNumber": 444,
      "taskType": "execution",
      "actorRole": "ai-native-control-plane-worker"
    }
  ],
  "providers": [
    {
      "providerId": "provider-default",
      "status": "available",
      "assignedWorkerCount": 1,
      "maxConcurrency": 1,
      "quotaState": "approaching_limit",
      "lastQuotaCheckAt": "2026-05-11T14:25:00Z",
      "cooldownExpiresAt": null,
      "consecutiveFailures": 0
    },
    {
      "providerId": "provider-secondary",
      "status": "available",
      "assignedWorkerCount": 1,
      "maxConcurrency": 2,
      "quotaState": "healthy",
      "lastQuotaCheckAt": "2026-05-11T14:25:00Z",
      "cooldownExpiresAt": null,
      "consecutiveFailures": 0
    }
  ],
  "global": {
    "totalActiveAssignments": 2,
    "totalAvailableSlots": 1,
    "totalMaxConcurrency": 3,
    "availableProviders": 2,
    "exhaustedProviders": 0,
    "disabledProviders": 0
  }
}
```

## Example: Provider Exhausted

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T15:00:00Z",
  "assignments": [],
  "providers": [
    {
      "providerId": "provider-default",
      "status": "exhausted",
      "assignedWorkerCount": 0,
      "maxConcurrency": 1,
      "quotaState": "exhausted",
      "lastQuotaCheckAt": "2026-05-11T14:45:00Z",
      "cooldownExpiresAt": "2026-05-11T15:15:00Z",
      "consecutiveFailures": 1
    }
  ],
  "global": {
    "totalActiveAssignments": 0,
    "totalAvailableSlots": 0,
    "totalMaxConcurrency": 3,
    "availableProviders": 0,
    "exhaustedProviders": 1,
    "disabledProviders": 0
  }
}
```

---

## Relationship to Other Schemas

| Schema | Relationship |
|--------|-------------|
| `provider-pool-policy.json` | Provides provider definitions, concurrency limits, and selection strategy. Assignment state references provider ids from the policy. |
| `provider-pool.json` | Provides provider availability and cooldown state. Assignment state adds the worker-to-provider binding layer on top. |
| `worker-telemetry.schema.json` | Workers record which provider they used. Assignment state is the pre-execution view; telemetry is the post-execution view. |
| `health-state.schema.json` | Health state determines which worker classes may launch. Assignment state determines which provider they land on. |

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **Launch gate** | `global.totalAvailableSlots`, `providers[].status` | Block dispatch when no capacity remains. |
| **Scheduler** | `providers[].quotaState`, `providers[].assignedWorkerCount` | Pick the least-loaded healthy provider. |
| **Monitoring** | `assignments[]`, `global` | Track active worker distribution and utilization. |
| **State reconciler** | `assignments[]` | Detect stale assignments (workers that stopped but were not unassigned). |

---

## Validation Rules

| Rule | Enforcement |
|------|-------------|
| `schemaVersion` must be `1` | JSON Schema const |
| `assignments[].providerId` must match a `providers[].providerId` | Writer-side cross-validation |
| `providers[].assignedWorkerCount` must equal the count of `assignments` referencing that provider | Writer-side consistency |
| `global.totalActiveAssignments` must equal `assignments.length` | Writer-side consistency |
| `global.totalAvailableSlots` must equal sum of (`maxConcurrency - assignedWorkerCount`) for available providers | Writer-side consistency |

The JSON Schema enforces structural correctness (types, enums, patterns) but
does not encode cross-field consistency rules. Those are enforced by the writer.

---

## Security

This schema contains no secrets. Provider ids are identifiers only — they do
not include API keys, tokens, or credentials. Worker task ids are opaque
strings. See [provider-pool.md](provider-pool.md) for the full security model.

---

## References

- [Provider Pool](provider-pool.md) — full architecture and planning doc
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch validation
- [Worker Telemetry Schema](worker-telemetry-schema.md) — post-execution telemetry
- [Health State Schema](health-state-schema.md) — main branch health projection
- [Launch Gate](launch-gate.md) — pre-launch health and conflict validation
