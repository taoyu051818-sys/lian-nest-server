# Worker Resource Pressure UI Contract

Defines the UI rendering contract for worker resource pressure indicators:
pressure level badges, utilization bars, per-resource health gauges, and
degradation state transitions consumed by the Provider Pool WebUI.

> **Closes:** [#817](https://github.com/taoyu051818-sys/lian-nest-server/issues/817)

---

## Overview

The WebUI renders resource pressure at two layers:

1. **Provider-level pressure** -- concurrency utilization across all providers
   (the `pressure` section of the dashboard state).
2. **Machine-level health** -- CPU, memory, disk, process, and concurrency
   metrics for the local host (the `LocalResourceHealth` schema).

Both layers drive visual degradation: badges, bar fills, gauge indicators,
and pulse animations that escalate from green to yellow to red.

---

## Data Sources

| Source | Path / Endpoint | Provides |
|--------|-----------------|----------|
| Dashboard state | `.github/ai-state/provider-pool-webui.json` | `pressure.level`, `pressure.utilizationPct`, `pressure.nearestCooldownExpiry` |
| Resource health | `LocalResourceHealth` snapshot | Per-resource `status`, `usagePercent` |
| Workers API | `GET /api/resources` | `utilization.percentage`, `utilization.level` |
| Launch gate | `launch-gate --json` report | `resourceGlobalState`, `resourceChecks` |

---

## Pressure Level Enum (Provider-Level)

The `pressure.level` field uses a three-tier enum:

| Level | Condition | Badge Color | CSS Class |
|-------|-----------|-------------|-----------|
| `normal` | `utilizationPct < 60` and no exhausted providers | Green | `pressure-gauge__indicator--normal` |
| `elevated` | `utilizationPct >= 60` or any provider exhausted | Yellow | `pressure-gauge__indicator--elevated` |
| `critical` | `utilizationPct >= 90` or all providers exhausted/disabled | Red | `pressure-gauge__indicator--critical` |

The `utilizationPct` is derived as:
`totalActiveWorkers / globalMaxWorkers * 100`.

---

## Resource Status Enum (Machine-Level)

Each resource dimension (CPU, memory, disk, processes, concurrency) uses
`ResourceStatus`:

| Status | Meaning | Badge Color |
|--------|---------|-------------|
| `ok` | Within normal bounds | Green |
| `degraded` | Elevated, approaching limits | Yellow |
| `critical` | At or above hard limit | Red |

The `overall` status is the worst of all individual statuses:
`critical` > `degraded` > `ok`.

---

## Per-Resource Thresholds

### Health Schema Thresholds (LocalResourceHealth)

| Resource | ok | degraded | critical |
|----------|-----|----------|----------|
| CPU | < 80% | 80-95% | >= 95% |
| Memory | < 85% | 85-95% | >= 95% |
| Disk | < 90% | 90-97% | >= 97% |
| Processes | < 300 | 300-500 | >= 500 |
| Concurrency | < 80% max | 80-100% max | >= max |

### Launch Gate Thresholds (local-resource-policy.json)

| Resource | Healthy | Warn | Block |
|----------|---------|------|-------|
| CPU | 50% | 75% | 90% |
| Memory | 60% | 80% | 92% |
| Disk | 70% | 85% | 95% |
| Process count | 15 | 25 | 30 |

### Pressure Sampler Zones (pre-launch)

| Resource | Green | Yellow | Red |
|----------|-------|--------|-----|
| CPU | <= 50% | 51-80% | > 80% |
| Memory | <= 70% | 71-85% | > 85% |
| Disk | <= 75% | 76-90% | > 90% |

Worst-case derivation: if ANY resource is red, overall is red; if ANY is
yellow, overall is yellow; otherwise green.

---

## UI Rendering Contract

### Pressure Section

Rendered when `webuiState.pressure` exists. Fields:

| Field | UI Element | Behavior |
|-------|------------|----------|
| `level` | Color-coded badge | `normal` = green, `elevated` = yellow (pulse 2s), `critical` = red (pulse 1s) |
| `utilizationPct` | Percentage bar | Fill color: green < 60%, yellow 60-89%, red >= 90% |
| `nearestCooldownExpiry` | Timestamp text | Shows ISO-8601 time or "none" when `null` |

### Worker Status Badges

| Status | Badge Class | Color |
|--------|-------------|-------|
| `running` | `badge-running` | Green |
| `cooling-down` | `badge-cooling-down` | Yellow |
| `draining` | `badge-draining` | Blue |

### Queue Depth Breakdown

The `queue` section renders four counters:

| Field | Description |
|-------|-------------|
| `pendingTasks` | Total tasks waiting |
| `blockedByExhaustion` | All providers exhausted |
| `blockedByConflict` | Conflict group overlap |
| `blockedByCapacity` | Global max workers reached |

---

## CSS Classes Reference

### Pressure Gauge

| Class | Visual | Animation |
|-------|--------|-----------|
| `.pressure-gauge` | Flex container | -- |
| `.pressure-gauge__indicator--normal` | Green dot with glow | Static |
| `.pressure-gauge__indicator--elevated` | Yellow dot | `pulse-elevated` (2s) |
| `.pressure-gauge__indicator--critical` | Red dot | `pulse-critical` (1s) |

### Bar Fills

| Class | Color |
|-------|-------|
| `.pressure-bar__fill--normal` | Green |
| `.pressure-bar__fill--elevated` | Yellow |
| `.pressure-bar__fill--critical` | Red |
| `.resource-bar__fill--normal` | Green |
| `.resource-bar__fill--elevated` | Yellow |
| `.resource-bar__fill--critical` | Red |
| `.bar-fill--green` | Green |
| `.bar-fill--yellow` | Yellow |
| `.bar-fill--red` | Red |

---

## Per-Worker Alerts

The `WorkerResource` schema supports per-worker alerts with:

| Field | Values |
|-------|--------|
| `metric` | `rss`, `heap`, `cpu`, `fileDescriptors`, `uptime` |
| `severity` | `warning`, `critical` |

Alerts include `currentValue`, `thresholdValue`, and a human-readable
`message`. The WebUI renders `warning` as yellow and `critical` as red.

---

## Launch Gate Resource State

The launch gate reports a global resource state used to block or allow
worker dispatch:

| State | Meaning | Gate Action |
|-------|---------|-------------|
| `healthy` | All resources within bounds | Allow |
| `constrained` | Some resources elevated | Allow with warning |
| `critical` | One or more resources at limit | Block |
| `unknown` | Unable to sample | Block |

The gate report includes per-resource checks:
```json
{
  "cpu": { "usagePercent": 45.2, "level": "healthy", "warn": 75, "block": 90 },
  "memory": { "usagePercent": 62.1, "level": "healthy", "warn": 80, "block": 92 },
  "disk": { "usagePercent": 55.0, "level": "healthy", "warn": 85, "block": 95 },
  "processCount": { "runningCount": 8, "level": "healthy", "warn": 25, "block": 30 }
}
```

---

## Degradation Escalation Flow

```
normal ──────► elevated ──────► critical
  │                │                 │
  │ (util < 60%)   │ (util >= 60%)   │ (util >= 90%)
  │                │                 │
  ▼                ▼                 ▼
 Green badge     Yellow badge      Red badge
 Static dot      Slow pulse (2s)   Fast pulse (1s)
 Green bar fill  Yellow bar fill   Red bar fill
```

Recovery: when utilization drops below the threshold and no providers are
exhausted, the level de-escalates. The UI updates on the next poll cycle.

---

## Secret Boundary

This contract **never** exposes:

| Artifact | Status |
|----------|--------|
| API keys, tokens, credentials | Never present |
| Local secret source paths | Never present |
| Raw API responses | Never present |
| `.claude/settings.json` contents | Never present |

Provider identifiers are logical only -- they do not reveal the underlying
secret or its storage location.

---

## References

- [Provider Pool WebUI State Contract](provider-pool-webui-state-contract.md) -- full dashboard state model
- [Local Resource Health Schema](local-resource-health-schema.md) -- machine-level health schema
- [Local Resource Pressure Policy](local-resource-pressure-policy.md) -- green/yellow/red zone definitions
- [Launch Gate Resource Policy](launch-gate-resource-policy.md) -- launch gate thresholds
- [Provider Pool WebUI Style Guide](provider-pool-webui-style-guide.md) -- CSS conventions
- [Worker Resource Schema](worker-resource-schema.md) -- per-worker resource snapshot
- [Active Worker Resource Sampler](active-worker-resource-sampler.md) -- sampling implementation
