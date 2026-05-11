# Local Resource Health Schema

Formal JSON Schema for local machine resource health state, consumed by the
launch gate and WebUI to gate worker dispatch and display system status.

> **Schema file:** [`schemas/local-resource-health.schema.json`](../../schemas/local-resource-health.schema.json)
> **Closes:** [#559](https://github.com/taoyu051818-sys/lian-nest-server/issues/559)

---

## Overview

The local resource health snapshot captures CPU, memory, disk, process count,
and worker concurrency metrics for a single machine. It is the canonical
source of truth for whether a local environment has sufficient resources to
accept new worker tasks.

| Aspect | Value |
|--------|-------|
| Schema version | `schemaVersion: 1` |
| JSON Schema draft | `draft-07` |
| Writer | Provider pool guard / local ops doctor |
| Consumers | Launch gate, WebUI |

---

## Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | `integer` (const `1`) | Schema version. Increment when the shape changes. |
| `hostname` | `string` | Machine hostname this snapshot was captured on. |
| `capturedAt` | `string` (ISO-8601) | Timestamp when this resource health snapshot was captured. |
| `overall` | `ResourceStatus` | Aggregated health status. Derived from the worst individual resource status. |
| `cpu` | `CpuHealth` | CPU utilization metrics. |
| `memory` | `MemoryHealth` | Memory utilization metrics. |
| `disk` | `DiskHealth` | Disk utilization metrics for the primary working volume. |
| `processes` | `ProcessHealth` | Process count metrics. |
| `concurrency` | `ConcurrencyHealth` | Worker concurrency metrics for the launch gate. |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `warnings` | `string[]` | Human-readable warning messages for degraded or critical resources. |

---

## Resource Status

Each resource dimension uses the `ResourceStatus` enum:

| Status | Meaning |
|--------|---------|
| `ok` | Healthy. Resource usage is within normal bounds. |
| `degraded` | Elevated but functional. Approaching limits. |
| `critical` | At or above hard limit. New work should not be accepted. |

The `overall` status is derived from the worst individual resource status:
`critical` > `degraded` > `ok`.

---

## Resource Definitions

### CpuHealth

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `ResourceStatus` | yes | CPU health status. |
| `usagePercent` | `number` (0-100) | yes | Current CPU usage percentage. |
| `cores` | `integer` (>=1) | yes | Number of logical CPU cores. |
| `loadAverage1m` | `number \| null` | no | 1-minute load average (platform-dependent). |

**Thresholds:** `ok` < 80%, `degraded` 80-95%, `critical` >= 95%.

### MemoryHealth

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `ResourceStatus` | yes | Memory health status. |
| `usagePercent` | `number` (0-100) | yes | Current memory usage percentage. |
| `totalBytes` | `integer` | yes | Total physical memory in bytes. |
| `availableBytes` | `integer` | yes | Available memory in bytes. |

**Thresholds:** `ok` < 85%, `degraded` 85-95%, `critical` >= 95%.

### DiskHealth

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `ResourceStatus` | yes | Disk health status. |
| `usagePercent` | `number` (0-100) | yes | Current disk usage percentage. |
| `totalBytes` | `integer` | yes | Total disk capacity in bytes. |
| `availableBytes` | `integer` | yes | Available disk space in bytes. |
| `path` | `string` | yes | Filesystem path this measurement applies to. |

**Thresholds:** `ok` < 90%, `degraded` 90-97%, `critical` >= 97%.

### ProcessHealth

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `ResourceStatus` | yes | Process count health status. |
| `total` | `integer` | yes | Total number of running processes. |
| `nodeProcessCount` | `integer` | yes | Number of Node.js processes. |

**Thresholds:** `ok` < 300 total, `degraded` 300-500, `critical` >= 500.

### ConcurrencyHealth

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `ResourceStatus` | yes | Concurrency health status. |
| `activeWorkers` | `integer` | yes | Currently active worker tasks. |
| `maxWorkers` | `integer` (>=1) | yes | Maximum allowed concurrent workers. |
| `queuedTasks` | `integer \| null` | no | Tasks waiting in the dispatch queue. |

**Thresholds:** `ok` when `activeWorkers < maxWorkers * 0.8`, `degraded` when
`activeWorkers < maxWorkers`, `critical` when `activeWorkers >= maxWorkers`.

---

## Example: Healthy State

```json
{
  "schemaVersion": 1,
  "hostname": "dev-machine-01",
  "capturedAt": "2026-05-11T12:00:00Z",
  "overall": "ok",
  "cpu": {
    "status": "ok",
    "usagePercent": 42.5,
    "cores": 8,
    "loadAverage1m": 2.1
  },
  "memory": {
    "status": "ok",
    "usagePercent": 61.3,
    "totalBytes": 17179869184,
    "availableBytes": 6647328768
  },
  "disk": {
    "status": "ok",
    "usagePercent": 55.0,
    "totalBytes": 512000000000,
    "availableBytes": 230400000000,
    "path": "/"
  },
  "processes": {
    "status": "ok",
    "total": 185,
    "nodeProcessCount": 4
  },
  "concurrency": {
    "status": "ok",
    "activeWorkers": 12,
    "maxWorkers": 30,
    "queuedTasks": 0
  }
}
```

## Example: Degraded State with Warnings

```json
{
  "schemaVersion": 1,
  "hostname": "dev-machine-02",
  "capturedAt": "2026-05-11T12:05:00Z",
  "overall": "degraded",
  "cpu": {
    "status": "degraded",
    "usagePercent": 88.2,
    "cores": 4,
    "loadAverage1m": 3.8
  },
  "memory": {
    "status": "ok",
    "usagePercent": 72.0,
    "totalBytes": 8589934592,
    "availableBytes": 2405181685
  },
  "disk": {
    "status": "degraded",
    "usagePercent": 93.1,
    "totalBytes": 256000000000,
    "availableBytes": 17664000000,
    "path": "C:\\"
  },
  "processes": {
    "status": "ok",
    "total": 210,
    "nodeProcessCount": 6
  },
  "concurrency": {
    "status": "degraded",
    "activeWorkers": 26,
    "maxWorkers": 30,
    "queuedTasks": 3
  },
  "warnings": [
    "CPU usage at 88.2% — approaching limit",
    "Disk usage at 93.1% — consider cleanup",
    "Worker concurrency at 26/30 — near capacity"
  ]
}
```

## Example: Critical State

```json
{
  "schemaVersion": 1,
  "hostname": "dev-machine-02",
  "capturedAt": "2026-05-11T12:10:00Z",
  "overall": "critical",
  "cpu": {
    "status": "critical",
    "usagePercent": 97.1,
    "cores": 4,
    "loadAverage1m": 5.2
  },
  "memory": {
    "status": "critical",
    "usagePercent": 96.8,
    "totalBytes": 8589934592,
    "availableBytes": 274877906
  },
  "disk": {
    "status": "ok",
    "usagePercent": 70.0,
    "totalBytes": 256000000000,
    "availableBytes": 76800000000,
    "path": "C:\\"
  },
  "processes": {
    "status": "critical",
    "total": 520,
    "nodeProcessCount": 18
  },
  "concurrency": {
    "status": "critical",
    "activeWorkers": 30,
    "maxWorkers": 30,
    "queuedTasks": 12
  },
  "warnings": [
    "CPU usage at 97.1% — critical",
    "Memory usage at 96.8% — critical, risk of OOM",
    "Process count at 520 — critical",
    "Worker concurrency at 30/30 — at capacity, 12 tasks queued"
  ]
}
```

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **Launch gate** | `overall`, `concurrency` | Block worker dispatch when `critical`. Throttle when `degraded`. |
| **WebUI** | All fields | Display real-time system health dashboard. |
| **Provider pool guard** | `concurrency` | Determine if a new worker can be launched. |
| **Local ops doctor** | All fields | Diagnose local environment issues. |

---

## Thresholds Summary

| Resource | ok | degraded | critical |
|----------|-----|----------|----------|
| CPU | < 80% | 80-95% | >= 95% |
| Memory | < 85% | 85-95% | >= 95% |
| Disk | < 90% | 90-97% | >= 97% |
| Processes | < 300 | 300-500 | >= 500 |
| Concurrency | < 80% max | 80-100% max | >= max |

These thresholds are informational guidance for implementers. The JSON Schema
validates structure and types but does not enforce threshold logic — that
belongs in the writer and consumer code.

---

## References

- [provider-pool-guard.md](provider-pool-guard.md) — Provider pool guard that consumes concurrency metrics.
- [provider-pool.md](provider-pool.md) — Provider pool management.
- [launch-gate.md](launch-gate.md) — Launch gate that blocks dispatch on critical resource state.
- [local-ops-doctor.md](local-ops-doctor.md) — Local ops diagnostics.
- [health-state-schema.md](health-state-schema.md) — Main branch health state schema (separate concern).
