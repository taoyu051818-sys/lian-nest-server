# Provider WebUI Dashboard State JSON Schema

Formal JSON Schema for the combined WebUI dashboard state projection, aggregating
provider pool status, active worker assignments, queue depth, and resource
pressure into a single read-model for the local dashboard.

> **Schema file:** [`schemas/provider-webui-dashboard-state.schema.json`](../../schemas/provider-webui-dashboard-state.schema.json)
> **Closes:** [#608](https://github.com/taoyu051818-sys/lian-nest-server/issues/608)

---

## Overview

The provider WebUI dashboard state is a projection that consolidates four
concerns into one JSON file: provider health, active workers, pending queue,
and resource pressure. It is consumed by the WebUI dashboard to render the
provider pool overview in a single polling cycle.

The contract is **read-only from the WebUI perspective** — the state
reconciler writes the projection; the WebUI renders it.

| Aspect | Value |
|--------|-------|
| Schema version | `schemaVersion: 1` |
| JSON Schema draft | `draft-07` |
| Writer | State reconciler |
| Projection path | `.github/ai-state/provider-webui-dashboard.json` |

---

## Provider Status Values

Each provider carries a `status` field that drives the dashboard indicator:

| Status | Meaning | Dashboard Indicator |
|--------|---------|---------------------|
| `available` | Has capacity to accept new workers. | Green |
| `exhausted` | Quota or rate limit hit. In cooldown. | Yellow |
| `disabled` | Auth failure or manually disabled. | Red |

---

## Worker Status Values

| Status | Meaning | Typical next state |
|--------|---------|---------------------|
| `running` | Actively executing the task. | `draining` |
| `cooling-down` | Provider exhausted mid-task; waiting for cooldown. | `running` |
| `draining` | Task complete; tearing down worktree. | removed |

```
dispatched
    |
    v
 running ──────────> draining
    |                    |
    | (exhaustion hit)   | (task complete)
    v                    v
cooling-down          removed
    |
    | (cooldown expires)
    v
 running (recovered)
```

---

## Pressure Levels

| Level | Condition | Dashboard Indicator |
|-------|-----------|---------------------|
| `normal` | `utilizationPct < 60` and no exhausted providers | Green |
| `elevated` | `utilizationPct >= 60` or any provider exhausted | Yellow |
| `critical` | `utilizationPct >= 90` or all providers exhausted/disabled | Red |

---

## Fields

### Top-Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `integer` (const `1`) | Yes | Schema version. Increment on shape change. |
| `capturedAt` | `string` (ISO-8601) | Yes | When this projection was last written. |
| `providers` | `ProviderStatus[]` | Yes | Per-provider status entries. Empty when no providers registered. |
| `global` | `GlobalMetrics` | Yes | Aggregate pool metrics. |
| `workers` | `WorkerAssignment[]` | Yes | Active worker assignments. Empty when idle. |
| `queue` | `QueueDepth` | Yes | Pending dispatch queue depth. |
| `pressure` | `PressureIndicators` | Yes | Resource pressure indicators for the dashboard gauge. |

### ProviderStatus

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Provider identifier. Logical id only — never exposes the underlying secret. |
| `label` | `string` | Yes | Human-readable name for WebUI display. |
| `status` | `string` enum | Yes | One of: `available`, `exhausted`, `disabled`. |
| `currentConcurrency` | `integer` >= 0 | Yes | Workers currently assigned to this provider. |
| `maxConcurrency` | `integer` >= 0 | Yes | Max workers this provider can serve. |
| `cooldownExpiresAt` | `string` (ISO-8601) or `null` | Yes | When cooldown ends. Null when not cooling down. |
| `lastFailureClass` | `string` enum or `null` | Yes | One of: `exhaustion`, `auth`, `runtime`, `null`. |

### GlobalMetrics

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `totalActiveWorkers` | `integer` >= 0 | Yes | Sum of workers across all providers. |
| `globalMaxWorkers` | `integer` >= 0 | Yes | System-wide concurrency ceiling. |
| `availableProviders` | `integer` >= 0 | Yes | Count of providers with `available` status. |
| `exhaustedProviders` | `integer` >= 0 | Yes | Count of providers with `exhausted` status. |
| `disabledProviders` | `integer` >= 0 | Yes | Count of providers with `disabled` status. |

### WorkerAssignment

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `issue` | `integer` >= 1 | Yes | GitHub issue number this worker is processing. |
| `branch` | `string` | Yes | Git branch or worktree the worker is on. |
| `conflictGroup` | `string` | Yes | Conflict group identifier from the task contract. |
| `providerId` | `string` | Yes | Assigned provider id. |
| `startedAt` | `string` (ISO-8601) | Yes | When the worker was dispatched. |
| `status` | `string` enum | Yes | One of: `running`, `cooling-down`, `draining`. |

### QueueDepth

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pendingTasks` | `integer` >= 0 | Yes | Total tasks waiting to be dispatched. |
| `blockedByExhaustion` | `integer` >= 0 | Yes | Tasks blocked because all providers are exhausted. |
| `blockedByConflict` | `integer` >= 0 | Yes | Tasks blocked by active-worker conflict group overlap. |
| `blockedByCapacity` | `integer` >= 0 | Yes | Tasks blocked because global max workers reached. |

### PressureIndicators

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `level` | `string` enum | Yes | One of: `normal`, `elevated`, `critical`. |
| `utilizationPct` | `number` (0–100) | Yes | `totalActiveWorkers / globalMaxWorkers * 100`. |
| `nearestCooldownExpiry` | `string` (ISO-8601) or `null` | Yes | Earliest upcoming cooldown end. Null when none. |

---

## Examples

### Active Dashboard with Mixed Provider States

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T15:00:00Z",
  "providers": [
    {
      "id": "provider-default",
      "label": "Primary Claude credential",
      "status": "available",
      "currentConcurrency": 2,
      "maxConcurrency": 5,
      "cooldownExpiresAt": null,
      "lastFailureClass": null
    },
    {
      "id": "provider-secondary",
      "label": "Backup Claude credential",
      "status": "exhausted",
      "currentConcurrency": 0,
      "maxConcurrency": 3,
      "cooldownExpiresAt": "2026-05-11T15:10:00Z",
      "lastFailureClass": "exhaustion"
    }
  ],
  "global": {
    "totalActiveWorkers": 4,
    "globalMaxWorkers": 30,
    "availableProviders": 1,
    "exhaustedProviders": 1,
    "disabledProviders": 0
  },
  "workers": [
    {
      "issue": 608,
      "branch": "claude/wave16-20260511-142540-issue-608-webui-state-schema",
      "conflictGroup": "webui-dashboard-state-schema",
      "providerId": "provider-default",
      "startedAt": "2026-05-11T14:25:00Z",
      "status": "running"
    },
    {
      "issue": 582,
      "branch": "claude/wave16-20260511-120000-issue-582-provider-assignment",
      "conflictGroup": "provider-assignment",
      "providerId": "provider-default",
      "startedAt": "2026-05-11T12:00:00Z",
      "status": "draining"
    }
  ],
  "queue": {
    "pendingTasks": 3,
    "blockedByExhaustion": 1,
    "blockedByConflict": 1,
    "blockedByCapacity": 1
  },
  "pressure": {
    "level": "elevated",
    "utilizationPct": 13.3,
    "nearestCooldownExpiry": "2026-05-11T15:10:00Z"
  }
}
```

### Seed State (No Workers)

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "providers": [],
  "global": {
    "totalActiveWorkers": 0,
    "globalMaxWorkers": 30,
    "availableProviders": 0,
    "exhaustedProviders": 0,
    "disabledProviders": 0
  },
  "workers": [],
  "queue": {
    "pendingTasks": 0,
    "blockedByExhaustion": 0,
    "blockedByConflict": 0,
    "blockedByCapacity": 0
  },
  "pressure": {
    "level": "normal",
    "utilizationPct": 0,
    "nearestCooldownExpiry": null
  }
}
```

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **WebUI dashboard** | All | Render provider grid, worker list, queue depth, pressure gauge. |
| **State reconciler** | (writer) | Writes the projection on every dispatch/completion/cooldown event. |
| **Launch gate** | `queue.blockedByExhaustion`, `providers[].status` | Gate dispatch decisions on provider availability. |
| **Monitoring** | `capturedAt`, `pressure.level` | Staleness detection and alerting. |

---

## Design Decisions

- **Single projection file.** The WebUI reads one file instead of combining provider state, active workers, and queue depth from separate sources.
- **Derived fields.** `pressure.level` and `pressure.utilizationPct` are pre-computed by the reconciler so the WebUI does not need business logic.
- **Queue breakdown.** Blocked reasons are split by cause so the WebUI can show actionable diagnostics (not just "pending: 3").
- **Schema versioning.** `schemaVersion` enables forward-compatible additions without breaking existing WebUI clients.
- **No secrets.** Only logical provider ids are exposed. Secret resolution happens in the worker process, never in the projection.
- **Projection, not log.** Each write replaces the previous state. No append-only history.

---

## Secret Boundary

This projection **never** contains:

| Artifact | Status |
|----------|--------|
| API keys, tokens, credentials | Never present |
| Local secret source paths | Never present |
| Raw API responses | Never present |
| `.claude/settings.json` contents | Never present |

The `providerId` field is a logical identifier only — it does not reveal the
underlying secret or its storage location.

---

## References

- [Provider Pool WebUI State Contract](provider-pool-webui-state-contract.md) — The informal contract this schema formalizes.
- [Provider Assignment State Schema](provider-assignment-state-schema.md) — Internal assignment state used by the launcher.
- [WebUI Queue State Schema](webui-queue-state-schema.md) — Queue lifecycle projection.
- [Health State Schema](health-state-schema.md) — System health projection.
- [Provider Pool Architecture](provider-pool-webui-architecture.md) — Full WebUI architecture.
