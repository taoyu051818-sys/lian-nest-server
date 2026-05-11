# Provider Pool WebUI — Worker Dashboard View

Extends the WebUI client to render active workers, queue depth, provider
assignment, and resource pressure from the sanitized WebUI state projection.

> **Closes:** [#606](https://github.com/taoyu051818-sys/lian-nest-server/issues/606)

---

## Overview

The worker dashboard view adds three new sections below the existing provider
grid:

1. **Resource Pressure** — overall utilization gauge with level indicator
2. **Queue** — pending task breakdown by block reason, with optional entry table
3. **Workers** — active worker assignments showing issue, branch, provider, and
   elapsed time

All data comes from the read-only WebUI state projection at
`.github/ai-state/provider-pool-webui.json`. The dashboard gracefully degrades
when the projection is unavailable — provider pool rendering continues normally.

---

## Data Sources

| Source | URL | Required |
|--------|-----|----------|
| Provider pool state | `.github/ai-state/provider-pool.json` | Yes |
| Provider pool policy | `.github/ai-policy/provider-pool-policy.json` | Yes |
| WebUI state projection | `.github/ai-state/provider-pool-webui.json` | No |

The WebUI state projection is optional. When absent, only the provider grid and
pool overview render. See
[provider-pool-webui-state-contract.md](provider-pool-webui-state-contract.md)
for the projection schema.

---

## Sections

### Resource Pressure

Renders from `webuiState.pressure`:

| Field | Display |
|-------|---------|
| `level` | Badge: normal (green), elevated (yellow), critical (red) |
| `utilizationPct` | Percentage bar with color-coded fill |
| `nearestCooldownExpiry` | Timestamp or "none" |

### Queue

Renders from `webuiState.queue` (aggregate counts) and optionally
`webuiState.queueEntries` (per-entry table):

| Aggregate Field | Label |
|-----------------|-------|
| `pendingTasks` | Pending |
| `blockedByExhaustion` | Blocked (Exhaustion) |
| `blockedByConflict` | Blocked (Conflict) |
| `blockedByCapacity` | Blocked (Capacity) |

When `queueEntries` is present, a detail table shows per-issue state, conflict
group, role, reason, and last update time.

### Workers

Renders from `webuiState.workers` (preferred) or falls back to
`webuiState.assignments`:

**Primary (workers[]):** issue, branch, conflict group, provider, status, elapsed

**Fallback (assignments[]):** task id, provider, task type, role, assigned time

Worker status colors: running (green), cooling-down (yellow), draining (red).

---

## CSS Classes

The worker view renderers use these CSS classes that should be defined in the
dashboard stylesheet:

| Class | Purpose |
|-------|---------|
| `.pressure-section` | Container for resource pressure section |
| `.queue-section` | Container for queue section |
| `.workers-section` | Container for workers section |
| `.queue-table` | Queue entry detail table |
| `.workers-table` | Worker assignment table |
| `.worker-status` | Worker status badge |
| `.queue-state` | Queue entry state badge |
| `.bar-track` | Utilization bar track (existing) |
| `.bar-fill` | Utilization bar fill (existing) |
| `.bar-fill--green` | Low utilization fill (existing) |
| `.bar-fill--yellow` | Medium utilization fill (existing) |
| `.bar-fill--red` | High utilization fill (existing) |
| `.status-available` | Green status indicator (existing) |
| `.status-exhausted` | Yellow status indicator (existing) |
| `.status-disabled` | Red status indicator (existing) |

---

## Architecture

```
.github/ai-state/provider-pool-webui.json
              │
              ▼
        app.js refresh()
              │
              ├── fetchJSON(WEBUI_STATE_URL)  ← optional, graceful fallback
              │
              ├── renderPressureSection()     ← pressure.level, utilizationPct
              ├── renderQueueSection()        ← queue counts + entries table
              └── renderWorkersSection()      ← workers[] or assignments[]
```

The renderers are stateless functions that return DOM elements. They share the
`el()` helper, `metricCard()`, `formatTimestamp()`, and status class mappers
with the existing provider renderers.

---

## Dry-Run Boundary

This change is strictly read-only:

- No state files are written
- No provider configuration is modified
- No secrets are loaded or displayed
- The WebUI state URL is fetched with `cache: 'no-store'` and no credentials

---

## References

- [Provider Pool WebUI State Contract](provider-pool-webui-state-contract.md)
- [WebUI Queue State Schema](webui-queue-state-schema.md)
- [Provider Assignment State Schema](provider-assignment-state-schema.md)
- [Local Resource Health Schema](local-resource-health-schema.md)
- [Provider Pool README](../../tools/provider-pool-webui/README.md)
