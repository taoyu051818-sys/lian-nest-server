# Provider Pool WebUI State Contract

Defines the machine-readable state model exposed to the WebUI for provider pool
status, worker assignments, resource pressure, and queue depth.

> **Closes:** [#553](https://github.com/taoyu051818-sys/lian-nest-server/issues/553)

---

## Overview

The WebUI consumes a single JSON projection that aggregates provider pool
health, active worker assignments, resource pressure indicators, and pending
queue depth. This document defines the contract so that the backend state
reconciler and the frontend renderer agree on field names, types, and
semantics.

The contract is **read-only from the WebUI perspective** — the state
reconciler writes the projection; the WebUI renders it.

---

## Projection Path

```
.github/ai-state/provider-pool-webui.json
```

Written by the state reconciler. Read by the WebUI polling loop or SSE
endpoint.

---

## Schema

```jsonc
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "providers": [
    {
      "id": "provider-default",
      "label": "Primary Claude credential",
      "status": "available",
      "currentConcurrency": 2,
      "maxConcurrency": 5,
      "cooldownExpiresAt": null,
      "lastFailureClass": null
    }
  ],
  "global": {
    "totalActiveWorkers": 4,
    "globalMaxWorkers": 30,
    "availableProviders": 2,
    "exhaustedProviders": 0,
    "disabledProviders": 0
  },
  "workers": [
    {
      "issue": 443,
      "branch": "claude/wave15-20260511-134040-issue-443",
      "conflictGroup": "messages",
      "providerId": "provider-default",
      "startedAt": "2026-05-11T11:45:00Z",
      "status": "running"
    }
  ],
  "queue": {
    "pendingTasks": 3,
    "blockedByExhaustion": 0,
    "blockedByConflict": 2,
    "blockedByCapacity": 1
  },
  "pressure": {
    "level": "normal",
    "utilizationPct": 13.3,
    "nearestCooldownExpiry": null
  }
}
```

---

## Field Reference

### Root

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `1` | Yes | Contract version. Enables forward-compatible evolution. |
| `capturedAt` | ISO-8601 | Yes | When the projection was last written. |
| `providers` | array | Yes | Per-provider status entries. |
| `global` | object | Yes | Aggregate pool metrics. |
| `workers` | array | Yes | Active worker assignments. Empty when idle. |
| `queue` | object | Yes | Pending dispatch queue depth. |
| `pressure` | object | Yes | Resource pressure indicators. |

### providers[]

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Provider identifier. Matches policy file. |
| `label` | string | Yes | Human-readable name for WebUI display. |
| `status` | enum | Yes | One of: `available`, `exhausted`, `disabled`. |
| `currentConcurrency` | int | Yes | Workers currently assigned to this provider. |
| `maxConcurrency` | int | Yes | Max workers this provider can serve. |
| `cooldownExpiresAt` | ISO-8601 \| null | Yes | When cooldown ends. `null` when not cooling down. |
| `lastFailureClass` | enum \| null | Yes | One of: `exhaustion`, `auth`, `runtime`, `null`. |

### global

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `totalActiveWorkers` | int | Yes | Sum of workers across all providers. |
| `globalMaxWorkers` | int | Yes | System-wide concurrency ceiling. |
| `availableProviders` | int | Yes | Count of providers with `available` status. |
| `exhaustedProviders` | int | Yes | Count of providers with `exhausted` status. |
| `disabledProviders` | int | Yes | Count of providers with `disabled` status. |

### workers[]

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `issue` | int | Yes | GitHub issue number. |
| `branch` | string | Yes | Git branch or worktree name. |
| `conflictGroup` | string | Yes | Conflict group identifier. |
| `providerId` | string | Yes | Assigned provider id. |
| `startedAt` | ISO-8601 | Yes | When the worker was dispatched. |
| `status` | enum | Yes | One of: `running`, `cooling-down`, `draining`. |

### queue

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pendingTasks` | int | Yes | Total tasks waiting to be dispatched. |
| `blockedByExhaustion` | int | Yes | Tasks blocked because all providers exhausted. |
| `blockedByConflict` | int | Yes | Tasks blocked by active-worker conflict group overlap. |
| `blockedByCapacity` | int | Yes | Tasks blocked because global max workers reached. |

### pressure

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `level` | enum | Yes | One of: `normal`, `elevated`, `critical`. |
| `utilizationPct` | float | Yes | `totalActiveWorkers / globalMaxWorkers * 100`. |
| `nearestCooldownExpiry` | ISO-8601 \| null | Yes | Earliest upcoming cooldown end. `null` when none. |

---

## Pressure Levels

| Level | Condition | WebUI Indicator |
|-------|-----------|-----------------|
| `normal` | `utilizationPct < 60` and no exhausted providers | Green |
| `elevated` | `utilizationPct >= 60` or any provider exhausted | Yellow |
| `critical` | `utilizationPct >= 90` or all providers exhausted/disabled | Red |

---

## Worker Status Transitions

```
dispatched
    │
    ▼
 running ──────────► draining
    │                    │
    │ (exhaustion hit)   │ (task complete)
    ▼                    ▼
cooling-down          removed
    │
    │ (cooldown expires)
    ▼
 running (recovered)
```

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

## Downstream Consumers

| Consumer | Usage |
|----------|-------|
| **WebUI dashboard** | Renders provider status grid, worker list, queue depth, pressure gauge. |
| **State reconciler** | Writes the projection on every dispatch/completion/cooldown event. |
| **Monitoring** | Reads `capturedAt` for staleness detection. |
| **Launch gate** | Reads `queue.blockedByExhaustion` to log why batches were delayed. |

---

## Seed State

The initial file before any workers are dispatched:

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

## Design Decisions

- **Single projection file.** The WebUI reads one file instead of combining
  provider state, active workers, and queue depth from separate sources.
- **Derived fields.** `pressure.level` and `pressure.utilizationPct` are
  pre-computed by the reconciler so the WebUI does not need business logic.
- **Queue breakdown.** Blocked reasons are split by cause so the WebUI can
  show actionable diagnostics (not just "pending: 3").
- **Schema versioning.** `schemaVersion` enables forward-compatible additions
  without breaking existing WebUI clients.
- **No secrets.** Only logical provider ids are exposed. Secret resolution
  happens in the worker process, never in the projection.

---

## References

- [Provider Pool](provider-pool.md) — full architecture and planning
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch validation
- [Active Workers State](active-workers-state.md) — running worker projection
- [Worker Telemetry Schema](worker-telemetry-schema.md) — per-task telemetry
- [Health State Schema](health-state-schema.md) — system health projection
