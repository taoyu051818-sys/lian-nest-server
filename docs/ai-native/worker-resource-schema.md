# Worker Resource Schema

Defines per-worker system resource snapshots capturing CPU, memory, and process telemetry for monitoring worker health and detecting resource exhaustion.

**Schema location:** `schemas/worker-resource.schema.json`

## Purpose

The existing control plane tracks:

| Layer | Captures | Schema |
|-------|----------|--------|
| Task contract | What the worker was asked to do | `task.schema.json` |
| Heartbeat | Whether the process is alive | `monitor-state.schema.json` |
| Telemetry | How much LLM cost and what it produced | `worker-telemetry.schema.json` |
| **Resource** | **System-level CPU, memory, and process state** | **`worker-resource.schema.json`** |

Resource snapshots bridge the gap between **process liveness** (heartbeat) and **system health** (CPU/memory). A worker can be "alive" per the heartbeat but consuming excessive memory or CPU, starving other workers on the same host.

## Snapshot Shape

A resource snapshot has these top-level groups:

```
schemaVersion        -- pinned to 1
taskId               -- correlates to heartbeat
capturedAt           -- ISO-8601 timestamp
issueNumber          -- GitHub reference (optional)
process              -- PID, state, uptime, thread count
cpu                  -- usage percent, system/user time
memory               -- RSS, heap, system totals
limits               -- configured thresholds (optional)
alerts               -- triggered threshold breaches (optional)
```

## Field Details

### Identity Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `1` (const) | yes | Schema version. Consumers reject other values. |
| `taskId` | string | yes | Matches the heartbeat `taskId`. |
| `capturedAt` | date-time | yes | When this snapshot was captured. |
| `issueNumber` | integer or null | no | GitHub issue targeted by the task. |

### Process

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `process.pid` | integer >= 1 | yes | OS process ID of the worker. |
| `process.ppid` | integer or null | no | Parent process ID. |
| `process.state` | enum | yes | `running`, `sleeping`, `stopped`, `zombie`, `unknown`. |
| `process.uptimeMs` | integer or null | no | Milliseconds since process start. |
| `process.threadCount` | integer or null | no | Thread or handle count. |
| `process.fileDescriptorCount` | integer or null | no | Open file descriptors (Unix) or handles (Windows). |

### CPU

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cpu.usagePercent` | number 0-100 | yes | Current CPU usage percentage. May exceed 100 on multi-core. |
| `cpu.systemTimeMs` | integer or null | no | Cumulative kernel CPU time in ms. |
| `cpu.userTimeMs` | integer or null | no | Cumulative user-space CPU time in ms. |
| `cpu.coresUsed` | number or null | no | Effective cores utilized (`usagePercent / 100`). |

### Memory

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `memory.rssBytes` | integer >= 0 | yes | Resident Set Size — total physical memory in bytes. |
| `memory.heapUsedBytes` | integer or null | no | V8 heap actively used (Node.js only). |
| `memory.heapTotalBytes` | integer or null | no | V8 heap committed (Node.js only). |
| `memory.externalBytes` | integer or null | no | C++ objects bound to JS. |
| `memory.arrayBufferBytes` | integer or null | no | ArrayBuffer/SharedArrayBuffer memory. |
| `memory.systemTotalBytes` | integer or null | no | Total host physical memory. |
| `memory.systemFreeBytes` | integer or null | no | Free host physical memory. |

### Limits (optional)

Configured resource thresholds for alerting. Null when no limits are set.

| Field | Type | Description |
|-------|------|-------------|
| `limits.maxRssBytes` | integer or null | RSS threshold for flagging. |
| `limits.maxHeapBytes` | integer or null | Heap threshold for flagging. |
| `limits.maxCpuPercent` | number or null | CPU threshold for alerting. |
| `limits.maxFileDescriptors` | integer or null | File descriptor threshold. |

### Alerts (optional)

Array of triggered threshold breaches. Null when no alerts are active.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `alerts[].metric` | enum | yes | `rss`, `heap`, `cpu`, `fileDescriptors`, `uptime`. |
| `alerts[].severity` | enum | yes | `warning` (approaching) or `critical` (exceeded). |
| `alerts[].currentValue` | number or null | no | Current metric value. |
| `alerts[].thresholdValue` | number or null | no | Threshold that was breached. |
| `alerts[].message` | string | yes | Human-readable alert description. |

## Example Snapshot

```json
{
  "schemaVersion": 1,
  "taskId": "wave14-issue-524-worker-001",
  "capturedAt": "2026-05-11T14:30:00Z",
  "issueNumber": 524,
  "process": {
    "pid": 12345,
    "ppid": 12300,
    "state": "running",
    "uptimeMs": 185000,
    "threadCount": 12,
    "fileDescriptorCount": 48
  },
  "cpu": {
    "usagePercent": 12.5,
    "systemTimeMs": 2200,
    "userTimeMs": 18500,
    "coresUsed": 0.125
  },
  "memory": {
    "rssBytes": 268435456,
    "heapUsedBytes": 134217728,
    "heapTotalBytes": 201326592,
    "externalBytes": 8388608,
    "arrayBufferBytes": 1048576,
    "systemTotalBytes": 17179869184,
    "systemFreeBytes": 8589934592
  },
  "limits": {
    "maxRssBytes": 1073741824,
    "maxHeapBytes": 536870912,
    "maxCpuPercent": 80,
    "maxFileDescriptors": 256
  },
  "alerts": null
}
```

### Example With Alerts

```json
{
  "schemaVersion": 1,
  "taskId": "wave14-issue-365-worker-002",
  "capturedAt": "2026-05-11T15:10:00Z",
  "issueNumber": 365,
  "process": {
    "pid": 23456,
    "ppid": 23400,
    "state": "running",
    "uptimeMs": 3600000,
    "threadCount": 24,
    "fileDescriptorCount": 210
  },
  "cpu": {
    "usagePercent": 85.2,
    "systemTimeMs": 45000,
    "userTimeMs": 310000,
    "coresUsed": 0.852
  },
  "memory": {
    "rssBytes": 966367641,
    "heapUsedBytes": 483183820,
    "heapTotalBytes": 536870912,
    "externalBytes": 16777216,
    "arrayBufferBytes": 2097152,
    "systemTotalBytes": 17179869184,
    "systemFreeBytes": 4294967296
  },
  "limits": {
    "maxRssBytes": 1073741824,
    "maxHeapBytes": 536870912,
    "maxCpuPercent": 80,
    "maxFileDescriptors": 256
  },
  "alerts": [
    {
      "metric": "cpu",
      "severity": "warning",
      "currentValue": 85.2,
      "thresholdValue": 80,
      "message": "CPU usage (85.2%) exceeds warning threshold (80%)"
    },
    {
      "metric": "fileDescriptors",
      "severity": "warning",
      "currentValue": 210,
      "thresholdValue": 256,
      "message": "Open file descriptors (210) approaching limit (256)"
    }
  ]
}
```

## Derived Metrics

Resource snapshots enable these derived calculations:

| Metric | Formula | Purpose |
|--------|---------|---------|
| **Memory utilization** | `rssBytes / limits.maxRssBytes` | How close to RSS limit |
| **Heap utilization** | `heapUsedBytes / heapTotalBytes` | V8 heap fragmentation |
| **System memory pressure** | `1 - (systemFreeBytes / systemTotalBytes)` | Host-level memory stress |
| **CPU time ratio** | `systemTimeMs / userTimeMs` | Kernel vs user time balance |
| **Effective core usage** | `usagePercent / 100` | Parallelism level |
| **File descriptor pressure** | `fileDescriptorCount / limits.maxFileDescriptors` | Handle leak detection |

## Relationship to Other Schemas

```
task.schema.json             -- defines the plan (budgets, roles, commands)
monitor-state.schema.json    -- captures runtime liveness (state, elapsed, silence)
worker-telemetry.schema.json -- captures cost and outcome (tokens, cost, files, gates)
worker-resource.schema.json  -- captures system resources (CPU, memory, process)
```

The resource snapshot complements the heartbeat (which only tracks liveness) and telemetry (which only tracks LLM cost). Together, the three schemas give a complete picture of worker health:

| Concern | Schema | Cadence |
|---------|--------|---------|
| Is it alive? | `monitor-state.schema.json` | Every 15s |
| What did it cost? | `worker-telemetry.schema.json` | On completion |
| Is it healthy? | `worker-resource.schema.json` | Periodic (configurable) |

## Integration Points

### Heartbeat Monitor

The heartbeat monitor (`wait-claude-batch.ps1`) could emit resource snapshots alongside its existing liveness snapshots. The resource snapshot adds CPU/memory data that the heartbeat does not capture.

### Launch Gate

The launch gate can use resource snapshots to detect host-level resource pressure before dispatching new workers. If existing workers are consuming excessive memory or CPU, the gate may delay new launches.

### Telemetry Calculator

The telemetry calculator (`calculate-worker-telemetry.js`) can incorporate peak resource usage from resource snapshots into the telemetry record for cost/performance correlation.

## Security

Resource snapshots contain **no secrets**. All fields are system metrics — PIDs, byte counts, percentages. No API keys, tokens, file paths, env vars, or command output are included.
