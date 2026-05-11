# Local Resource State Projection

Sanitized projection of local machine resource capacity for CPU, memory, disk,
and process slots. Consumed by the launch gate and orchestrator to determine
whether the local machine can safely host additional AI workers.

> **State file:** `.github/ai-state/local-resource.json`
> **Closes:** [#522](https://github.com/taoyu051818-sys/lian-nest-server/issues/522)

---

## Overview

The local resource state is a single JSON snapshot that records the current
capacity headroom of the host machine. It is the canonical source of truth for
whether the orchestrator should dispatch additional workers or throttle the
batch.

| Aspect | Value |
|--------|-------|
| Schema version | `stateVersion: 1` |
| Writer | `scripts/ai/update-local-resource-state.ps1` (planned) |
| Path | `.github/ai-state/local-resource.json` |
| Update cadence | On-launch and periodic (TTL-based refresh) |

---

## Fields

### Top-Level

| Field | Type | Description |
|-------|------|-------------|
| `stateVersion` | `integer` (const `1`) | Schema version. Increment when the shape changes. |
| `description` | `string` | Human-readable summary of file purpose. |
| `cpu` | `object` | CPU capacity metrics. |
| `memory` | `object` | Memory capacity metrics. |
| `disk` | `object` | Disk capacity metrics. |
| `process` | `object` | Process slot capacity metrics. |
| `global` | `object` | Aggregate resource state and metadata. |
| `notes` | `string` | Security and provenance note. |

### cpu

| Field | Type | Description |
|-------|------|-------------|
| `cores` | `integer \| null` | Number of logical CPU cores. |
| `usagePercent` | `number \| null` | Current CPU utilization (0–100). |
| `loadAverage.oneMin` | `number \| null` | 1-minute load average. |
| `loadAverage.fiveMin` | `number \| null` | 5-minute load average. |
| `loadAverage.fifteenMin` | `number \| null` | 15-minute load average. |

### memory

| Field | Type | Description |
|-------|------|-------------|
| `totalGB` | `number \| null` | Total installed memory in GB. |
| `usedGB` | `number \| null` | Currently used memory in GB. |
| `availableGB` | `number \| null` | Available memory in GB. |
| `usagePercent` | `number \| null` | Memory utilization (0–100). |

### disk

| Field | Type | Description |
|-------|------|-------------|
| `totalGB` | `number \| null` | Total disk capacity in GB. |
| `usedGB` | `number \| null` | Currently used disk space in GB. |
| `availableGB` | `number \| null` | Available disk space in GB. |
| `usagePercent` | `number \| null` | Disk utilization (0–100). |
| `mountPoint` | `string \| null` | Primary monitored mount point (e.g. `C:\`). |

### process

| Field | Type | Description |
|-------|------|-------------|
| `runningCount` | `integer \| null` | Number of running processes. |
| `maxAllowed` | `integer \| null` | Configured maximum allowed process count. |
| `headroomPercent` | `number \| null` | Percentage of process slots still available (0–100). |

### global

| Field | Type | Description |
|-------|------|-------------|
| `resourceState` | `string` enum | Aggregate state: `healthy`, `constrained`, `critical`, or `unknown`. |
| `lastUpdatedBy` | `string` | Identifier of the script or action that last wrote this file. |
| `capturedAt` | `string` (ISO-8601) | Timestamp when this snapshot was captured. |
| `ttlSeconds` | `integer` | Time-to-live in seconds. Consumers should treat snapshots older than this as stale. |

---

## Resource States

The `global.resourceState` field summarizes whether the machine has capacity for
additional workers:

| State | Meaning | Launch Gate Action |
|-------|---------|-------------------|
| `healthy` | All resources have sufficient headroom. | Allow worker dispatch. |
| `constrained` | One or more resources are above warning thresholds. | Throttle or reduce batch size. |
| `critical` | One or more resources are above hard thresholds. | Block new worker dispatch. |
| `unknown` | No data available or snapshot is stale. | Block until fresh data is available. |

### Threshold Guidance

These thresholds are advisory; the launch gate policy may override them:

| Resource | Warning Threshold | Critical Threshold |
|----------|------------------:|-------------------:|
| CPU usage | > 70% | > 90% |
| Memory usage | > 75% | > 90% |
| Disk usage | > 80% | > 95% |
| Process headroom | < 30% | < 10% |

---

## Security Model

### What Is Never Committed

| Artifact | Status |
|----------|--------|
| API keys, tokens, credentials | Never committed |
| Hostnames or machine names | Never committed |
| Usernames or home directory paths | Never committed |
| Raw system command output | Never committed |
| Process lists with identifiable names | Never committed |

### What IS Safe to Commit

| Artifact | Location |
|----------|----------|
| Resource capacity numbers (percentages, GB values) | `.github/ai-state/local-resource.json` |
| Aggregate state enum | `.github/ai-state/local-resource.json` |

---

## Seed State

The initial seed file contains `null` values for all resource metrics and
`resourceState: "unknown"`. This establishes the schema shape so that
consumers can validate against it before the writer script populates real data.

```json
{
  "stateVersion": 1,
  "cpu": { "cores": null, "usagePercent": null },
  "memory": { "totalGB": null, "usagePercent": null },
  "disk": { "totalGB": null, "usagePercent": null },
  "process": { "runningCount": null, "maxAllowed": null },
  "global": {
    "resourceState": "unknown",
    "lastUpdatedBy": "initial-seed",
    "capturedAt": "2026-05-11T00:00:00Z",
    "ttlSeconds": 300
  }
}
```

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **Launch gate** | `global.resourceState`, `cpu`, `memory`, `disk` | Block/throttle worker dispatch based on capacity. |
| **Orchestrator** | `global.resourceState` | Decide batch size for the current wave. |
| **State reconciler** | `global.capturedAt`, `global.ttlSeconds` | Detect stale snapshots and trigger refresh. |
| **Provider pool guard** | `process.headroomPercent` | Ensure process slots are available before launch. |

---

## Planned Writer Script

**Path:** `scripts/ai/update-local-resource-state.ps1` (future slice)

Responsibilities:
- Read current CPU, memory, disk, and process metrics from the local machine.
- Sanitize all values (strip hostnames, paths, identifiable data).
- Determine `resourceState` based on threshold guidance.
- Write the snapshot to `.github/ai-state/local-resource.json`.
- Respect TTL: skip write if last capture was within `ttlSeconds`.

---

## References

- [provider-pool.md](provider-pool.md) — API provider pool capacity management
- [provider-pool-guard.md](provider-pool-guard.md) — Provider pool guard for launch readiness
- [launch-gate.md](launch-gate.md) — Pre-launch health and conflict validation
- [worker-heartbeat.md](worker-heartbeat.md) — Process-level monitoring
- [parallel-work-policy.md](parallel-work-policy.md) — Conflict group and concurrency rules
