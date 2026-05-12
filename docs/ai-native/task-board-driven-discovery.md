# Task-Board Driven Discovery

Gap discovery layer built on top of `project-task-board.js`. Analyzes the task board projection to identify lanes that need issue production attention.

## Problem

The self-cycle orchestrator could request 30 worker slots but only find 5 executable issues. Without lane-aware gap detection, issue production is blind to the actual queue state — it overproduces in some areas and underproduces in others.

## Solution

`discoverGaps()` reads a task-board projection and emits structured signals for three gap types:

| Signal Type | Trigger | Production Action |
|-------------|---------|-------------------|
| `blocked-lane` | Task in `blocked` state | Produce unblocker or follow-up issue |
| `empty-ready` | Ready lane count below threshold | Produce new executable issues |
| `stale-running` | Running task with stale or missing heartbeat | Produce health-check or kill-switch issue |

## API

```js
const { buildProjection, discoverGaps } = require('./scripts/ai/project-task-board');

const projection = buildProjection(issues, openPRs, activeWorkers, launchLocks);
const gaps = discoverGaps(projection, options);
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `readyThreshold` | 3 | Minimum ready tasks before `empty-ready` fires |
| `staleHeartbeatMs` | 600000 (10 min) | Heartbeat age threshold for `stale-running` |
| `now` | `Date.now()` | Override current time (for testing) |

### Output Schema

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "summary": {
    "totalTasks": 8,
    "laneCounts": { "blocked": 2, "ready": 1, "running": 3, "done": 2 },
    "blockedCount": 2,
    "readyCount": 1,
    "runningCount": 3,
    "staleRunningCount": 1,
    "emptyReady": true
  },
  "signals": [
    { "type": "blocked-lane", "issue": 10, "reason": "waiting on #258", "conflictGroup": "auth" },
    { "type": "empty-ready", "readyCount": 1, "threshold": 3, "deficit": 2 },
    { "type": "stale-running", "issue": 20, "conflictGroup": "schema", "reason": "heartbeat-stale", "ageMinutes": 14 }
  ]
}
```

## Usage in Issue Production

The discovery output feeds into `propose-self-cycle-issues.js` and the planning console. Each signal type maps to a different issue template:

1. **blocked-lane** signals produce issues with `allowedFiles` scoped to the blocker's conflict group, and a body referencing the blocking issue.
2. **empty-ready** signals produce batch issue proposals with broad scope to fill the executable queue.
3. **stale-running** signals produce health-check or escalation issues targeting the stale worker's conflict group.

## Testing

```bash
# Run self-test (built-in assertions)
node scripts/ai/project-task-board.js --self-test

# Run full test suite
node scripts/ai/project-task-board.test.js
```
