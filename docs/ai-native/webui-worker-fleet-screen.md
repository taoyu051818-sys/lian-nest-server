# WebUI Worker Fleet Monitoring Screen

Defines the live worker fleet monitoring tab for the provider pool
WebUI. Surfaces worker phase, current task, PR status, resource usage,
stale/timeout indicators, and stop controls.

> **Closes:** [#1119](https://github.com/taoyu051818-sys/lian-nest-server/issues/1119)

---

## Overview

The Worker Fleet screen is a **live monitoring** tab in the WebUI
dashboard. It renders real-time state for all active workers derived
from provider pool state, worker telemetry, and heartbeat data.

Operators use this screen to:

- See which workers are running, what they are working on, and how
  long they have been active
- Spot stale or timed-out workers before they waste resources
- Stop individual workers or groups via the standard preview-first,
  confirmation-gated lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│  [Dashboard]  [Operation Console]  [Planning]  [Fleet]      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Fleet Summary                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Active   │ │ Stale    │ │ Timed Out│ │ Total    │      │
│  │ 5        │ │ 1        │ │ 0        │ │ 6        │      │
│  │ ████░    │ │ █░░░░    │ │          │ │ █████░   │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
│  Worker Table                                               │
│  ┌───────┬──────┬───────┬─────┬──────┬───────┬──────┬────┐│
│  │Worker │Phase │Task   │ PR  │CPU%  │Mem MB │Uptime│Stop││
│  ├───────┼──────┼───────┼─────┼──────┼───────┼──────┼────┤│
│  │prov-1 │RUN   │#400   │#405 │ 42   │ 312   │ 8m   │ ■  ││
│  │slot-0 │      │auth.. │open │      │       │      │    ││
│  ├───────┼──────┼───────┼─────┼──────┼───────┼──────┼────┤│
│  │prov-1 │RUN   │#401   │ —   │ 38   │ 287   │ 5m   │ ■  ││
│  │slot-1 │      │queue..│     │      │       │      │    ││
│  ├───────┼──────┼───────┼─────┼──────┼───────┼──────┼────┤│
│  │prov-2 │STALE │#398   │#402 │  0   │ 104   │ 47m  │ ■  ││
│  │slot-0 │ ⚠   │worker.│open │      │       │      │    ││
│  └───────┴──────┴───────┴─────┴──────┴───────┴──────┴────┘│
│                                                             │
│  [Stop Selected]  [Stop All Stale]  [Refresh]               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Sources

The Fleet screen reads from multiple state files:

| Source | Path | Fields Used |
|--------|------|-------------|
| Provider pool state | `.github/ai-state/provider-pool.json` | Worker IDs, provider assignments, concurrency |
| Worker telemetry | `worker-telemetry.ndjson` | Task ID, issue/PR numbers, timing, token usage, cost |
| Monitor state | `monitor-state.schema.json` records | Heartbeat state, elapsed time, silence duration |
| Control-plane state | `.github/ai-state/control-plane-dashboard-state.json` | Health, action readiness |

---

## Sections

### Fleet Summary

Four stat cards showing aggregate fleet health:

| Card | Source | Alert Threshold |
|------|--------|-----------------|
| Active | Workers with status `running` and heartbeat within 5 min | — |
| Stale | Workers with no heartbeat for > 10 min | Yellow at > 0 |
| Timed Out | Workers exceeding their `hardTimeMinutes` budget | Red at > 0 |
| Total | Sum of all tracked workers | — |

### Worker Table

Each row represents one active or recently-active worker:

| Column | Type | Description |
|--------|------|-------------|
| Worker ID | string | `{providerId}-slot-{index}` pattern |
| Phase | enum | `STARTING`, `RUNNING`, `STALE`, `TIMED_OUT`, `DRAINING` |
| Task | string | Issue number and truncated title |
| PR | string | PR number and status (`open`, `merged`, `none`) |
| CPU % | number | Process CPU utilization (from metrics sample) |
| Memory MB | number | Process RSS in megabytes |
| Uptime | duration | Wall-clock time since worker start |
| Stop | button | Stop control (triggers preview-first flow) |

#### Phase Values

| Phase | Meaning | Visual |
|-------|---------|--------|
| `STARTING` | Worker launched, not yet producing output | Blue badge |
| `RUNNING` | Actively working, heartbeat current | Green badge |
| `STALE` | No heartbeat for > 10 min | Yellow badge, pulsing |
| `TIMED_OUT` | Exceeded hard time budget | Red badge |
| `DRAINING` | Stop requested, finishing current step | Gray badge |

#### Stale Detection

A worker is considered **stale** when:

```
(current_time - last_heartbeat_at) > STALE_THRESHOLD_MINUTES
```

Default threshold: **10 minutes**. Configurable per the monitor-state
schema's silence tracking.

#### Timeout Detection

A worker is considered **timed out** when:

```
elapsed_ms > (hard_time_minutes * 60000)
```

The `hardTimeMinutes` value comes from the task contract via telemetry.

### Action Buttons

| Button | Risk | Confirmation | Description |
|--------|------|--------------|-------------|
| Stop Selected | High | Type `STOP` + reason | Stop checked workers (explicit targeting) |
| Stop All Stale | High | Type `STOP-STALE` + reason | Stop all workers in STALE phase |
| Refresh | Low | None | Re-read state files and re-render |

All stop actions follow the standard lifecycle:

1. **Preview** — shows which workers would be stopped, current state
2. **Confirm** — typed phrase + reason required
3. **Execute** — calls `worker.control` action module with explicit IDs
4. **Audit** — entry written to audit log

---

## Worker ID Format

Worker IDs follow the pattern defined in the worker-control action
module:

```
{providerId}-slot-{index}
```

Examples: `provider-default-slot-0`, `provider-backup-slot-2`

These IDs are derived from provider pool state and are stable for the
lifetime of a worker assignment.

---

## Resource Metrics

CPU and memory metrics come from the `ops:webui:worker-metrics` npm
script, which samples running worker processes. The Fleet screen polls
this data alongside the standard 30-second dashboard refresh cycle.

| Metric | Source | Unit |
|--------|--------|------|
| CPU % | Process CPU sample | Percentage (0-100) |
| Memory MB | Process RSS | Megabytes |

When metrics are unavailable (process exited, sample failed), the
columns show `—` with no error state.

---

## Safety

- **Preview-first**: All stop actions dry-run before mutation
- **Explicit targeting**: Stop requires specific worker IDs; no
  wildcard operations (`["*"]` is rejected)
- **Reason required**: Stop actions require a human-readable reason
- **Sanitized output**: All displayed data passes through
  `sanitizeObject`; no secrets visible
- **Localhost-only**: Screen is only accessible on `127.0.0.1`
- **Audit trail**: Every stop action writes an audit entry

---

## Integration

The Fleet screen is the fourth tab in the WebUI:

1. **Dashboard** — Provider, worker, queue, and pressure state
2. **Operation Console** — Preview/execute actions with audit log
3. **Planning Console** — Planning loop visibility
4. **Worker Fleet** — Live worker monitoring (this view)

Tab switching is client-side. Fleet data is fetched alongside dashboard
data on each refresh cycle (30-second polling).

---

## API Surface

The Fleet screen consumes existing endpoints:

| Endpoint | Usage |
|----------|-------|
| `GET /api/state` | Provider pool state with worker counts |
| `POST /api/actions/preview` | Dry-run stop actions |
| `POST /api/actions/execute` | Execute stop actions |
| `GET /api/audit` | Verify stop actions were logged |

No new API endpoints are required. The screen composes existing data
sources client-side.

---

## Non-Goals

- No real-time WebSocket push (polling-based at 30s interval)
- No server-side endpoint changes (reads existing state files)
- No credential or secret display
- No bulk worker launch (that remains in Operation Console)
- No resource metrics persistence (display-only, no history)

---

## Cross-References

- [Worker Control Action](webui-action-worker-control.md) — stop/list
  action module contract
- [Operation Console](provider-pool-webui-operation-console.md) —
  sibling tab for action execution
- [Planning Console View](webui-planning-console-view.md) — sibling
  tab for planning visibility
- [WebUI Control Map](webui-control-map.md) — action-to-endpoint
  mapping
- [Worker Telemetry Schema](worker-telemetry-schema.md) — telemetry
  record fields
- [Provider Pool WebUI](../../tools/provider-pool-webui/README.md) —
  server architecture and npm scripts
