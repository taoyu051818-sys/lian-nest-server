# Control-Plane Dashboard State: Action Readiness

**Schema version:** 2
**Emitter:** `scripts/ai/emit-control-plane-dashboard-state.js`

## Overview

The dashboard state snapshot (v2) extends the v1 projection with two new top-level sections:

- `actionReadiness` — which orchestration actions are available and why any are blocked
- `auditSummary` — aggregate queue activity and blocked-reason inventory

These sections let the WebUI control console show operators what they can do right now and what's preventing progress, without requiring a separate API call.

## Action Readiness

### Shape

```json
{
  "actionReadiness": {
    "actions": [
      { "id": "launch-worker", "ready": true, "blockedReasons": [] },
      { "id": "merge-pr", "ready": false, "blockedReasons": ["health state is red"] },
      { "id": "retry-failed", "ready": true, "blockedReasons": [] },
      { "id": "drain-queue", "ready": false, "blockedReasons": ["queue is empty"] }
    ],
    "readyCount": 2,
    "totalActions": 4,
    "allReady": false
  }
}
```

### Action IDs

| ID | Description | Blocked when |
|---|---|---|
| `launch-worker` | Dispatch a new Codex worker | Health is not green, no available providers, or trust below `minTrustToLaunch` |
| `merge-pr` | Merge a ready PR | Health is not green or risk score > 80 |
| `retry-failed` | Retry a failed/blocked queue entry | Health is not green or no failed/blocked entries in queue |
| `drain-queue` | Process all queued entries | Health is not green, queue is empty, or no available providers |

### Blocked Reasons

Each action carries a `blockedReasons` string array. When `ready` is `true`, the array is empty. When blocked, it lists one or more human-readable reasons. The WebUI can display these directly or use them for conditional styling.

Common blocked reasons:
- `"health state unknown"` — main health data is missing or not loaded
- `"health state is red"` — main health gate has failed critical checks
- `"no available providers"` — all providers are exhausted, disabled, or at capacity
- `"trust N below minimum M"` — worker trust score is below the scheduling threshold
- `"risk score N exceeds threshold 80"` — meta-signals indicate high failure/risk
- `"queue is empty"` — nothing to process
- `"no failed or blocked entries"` — retry has nothing to act on

## Audit Summary

### Shape

```json
{
  "auditSummary": {
    "totalEntries": 5,
    "byState": {
      "queued": 1,
      "launching": 0,
      "running": 2,
      "prCreated": 0,
      "blocked": 1,
      "done": 1
    },
    "lastActivityAt": "2026-05-11T12:34:56.000Z",
    "blockedReasons": ["provider unavailable"]
  }
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `totalEntries` | number | Total queue entries |
| `byState` | object | Count of entries in each lifecycle state |
| `lastActivityAt` | string\|null | ISO-8601 timestamp of the most recently updated entry |
| `blockedReasons` | string[] | Deduplicated list of blocked reasons from queue entries |

## Readiness Logic

The readiness computation aggregates signals from multiple state projections:

1. **Health** (`main-health.json`): Red health blocks all actions. Yellow is treated as operational.
2. **Provider capacity** (`provider-pool.json`): `availableProviders === 0` blocks launch and drain.
3. **Worker trust** (`worker-trust.json`): When `minTrustToLaunch` is set and meta-signals trust is below it, launch is blocked.
4. **Risk score** (`meta-signals.json`): Risk > 80 blocks merge to prevent merging during instability.
5. **Queue state** (`queue-state.json`): Empty queue blocks drain; no failed/blocked entries blocks retry.

When a state file is missing, the corresponding signals default to a conservative "not ready" posture.

## Schema Migration

v1 -> v2:
- Added `actionReadiness` (object with `actions`, `readyCount`, `totalActions`, `allReady`)
- Added `auditSummary` (object with `totalEntries`, `byState`, `lastActivityAt`, `blockedReasons`)
- Schema version bumped from 1 to 2

Consumers should handle both v1 (no actionReadiness/auditSummary) and v2 snapshots gracefully.
