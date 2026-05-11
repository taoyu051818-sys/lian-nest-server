# WebUI Planning Console View

Adds a Planning Console tab to the provider pool WebUI that renders
gaps, proposed issues, compiled task readiness, and batch preview state.

> **Closes:** [#690](https://github.com/taoyu051818-sys/lian-nest-server/issues/690)

---

## Overview

The Planning Console is a **view-only** tab in the WebUI dashboard. It
consumes planning data from `.github/ai-state/planning-console.json` and
renders four sections:

1. **Meta Signals** — Trust, failure, friction, risk, cost, and top pain
2. **Gap Ledger** — Recent gap events with severity and type
3. **Proposed Batch** — Task candidates with readiness status
4. **Batch Preview** — Selected/rejected tasks, locks, budget, and health

No mutation actions are available in this tab. All data is read-only.

```
┌─────────────────────────────────────────────────────────────┐
│  [Dashboard]  [Operation Console]  [Planning Console]       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  MODE: VIEW ONLY  No mutation actions                       │
│                                                             │
│  Meta Signals                                               │
│  ┌──────┐ ┌────────┐ ┌────────┐ ┌──────┐ ┌──────┐ ┌──────┐│
│  │Trust │ │Failure │ │Friction│ │Risk  │ │Cost  │ │Pain  ││
│  │ 55   │ │ 45     │ │ 30     │ │ 20   │ │ 12m  │ │none  ││
│  │ ████ │ │        │ │        │ │      │ │      │ │      ││
│  └──────┘ └────────┘ └────────┘ └──────┘ └──────┘ └──────┘│
│                                                             │
│  Gap Ledger                                                 │
│  ┌──────┬──────────┬────────┬───────────────┬───────┬─────┐│
│  │Time  │Type      │Severity│Description    │Issue  │Branch│
│  ├──────┼──────────┼────────┼───────────────┼───────┼─────┤│
│  │...   │worker-   │HIGH    │Worker exited  │#398   │cla..││
│  │      │failed    │        │code 1         │       │     ││
│  └──────┴──────────┴────────┴───────────────┴───────┴─────┘│
│                                                             │
│  Proposed Batch                                             │
│  ┌───────┬──────┬──────┬──────┬──────────┬──────┬─────┬───┐│
│  │Issue  │Title │Type  │Risk  │Conflict  │Role  │Ready│Note│
│  ├───────┼──────┼──────┼──────┼──────────┼──────┼─────┼───┤│
│  │#400   │...   │exec  │LOW   │auth-core │dev.. │READY│...││
│  └───────┴──────┴──────┴──────┴──────────┴──────┴─────┴───┘│
│                                                             │
│  Batch Preview                                              │
│  Main Health: GREEN   Budget: 1 task, 6 files, 500 lines   │
│  Selected Tasks: ...    Rejected Tasks: ...                 │
│  ✓ All tasks cleared for dispatch                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Source

The Planning Console reads from a single JSON file:

```
.github/ai-state/planning-console.json
```

This file is produced by the planning loop scripts and contains:

```json
{
  "capturedAt": "2026-05-12T00:30:00.000Z",
  "metaSignals": {
    "snapshotVersion": 1,
    "calculatedAt": "2026-05-12T00:30:00.000Z",
    "signals": {
      "failureScore": 45,
      "frictionScore": 30,
      "riskScore": 20,
      "cost": 12,
      "trust": 55,
      "topPain": "runtime compile"
    }
  },
  "gaps": [
    {
      "entryVersion": 1,
      "recordedAt": "2026-05-11T12:00:00Z",
      "gapType": "worker-failed",
      "severity": "high",
      "description": "Worker exited code 1, no PR produced",
      "issue": 398,
      "branch": "claude/wave11-..."
    }
  ],
  "proposedBatch": {
    "candidates": [
      {
        "issueNumber": 400,
        "title": "Add auth middleware",
        "taskType": "execution",
        "risk": "low",
        "conflictGroup": "auth-core",
        "actorRole": "devops-engineer",
        "readiness": "ready",
        "readinessNote": "Slice is CONTRACTED"
      }
    ],
    "conflictWarnings": []
  },
  "launchPlan": {
    "planVersion": 1,
    "capturedAt": "2026-05-12T00:30:00.000Z",
    "mainHealth": {
      "state": "green",
      "capturedAt": "2026-05-12T00:29:00.000Z",
      "reason": null
    },
    "selectedTasks": [...],
    "rejectedTasks": [...],
    "locksAcquired": [...],
    "budgetReservations": {
      "taskCount": 1,
      "totalMaxFiles": 6,
      "totalMaxLinesChanged": 500,
      "softTimeMinutesMax": 45,
      "hardTimeMinutesMax": 90
    },
    "allAllowed": true
  }
}
```

---

## Sections

### Meta Signals

Displays the six meta signals from the signal calculator:

| Signal | Color Coding | Description |
|--------|-------------|-------------|
| Trust | green >= 70, yellow >= 40, red < 40 | Inverse of failure+friction |
| Failure | neutral | Aggregated failure severity |
| Friction | neutral | Stale worker friction |
| Risk | neutral | Unresolved high-risk slices |
| Cost | neutral | Worker-minutes consumed |
| Top Pain | neutral | Category with highest failures |

Trust includes a progress bar for visual weight.

### Gap Ledger

Tabular view of recent gap events from `gap-ledger.ndjson`:

| Column | Description |
|--------|-------------|
| Time | When the gap was recorded |
| Type | Gap type (worker-failed, launch-blocked, etc.) |
| Severity | low / medium / high / critical |
| Description | Human-readable explanation |
| Issue | Related GitHub issue |
| Branch | Related branch or worktree |

Severity badges use the standard color coding:
- **low** — green
- **medium** — yellow
- **high / critical** — red

### Proposed Batch

Shows task candidates from the planning loop with readiness status:

| Column | Description |
|--------|-------------|
| Issue | GitHub issue number |
| Title | Issue title |
| Type | execution / research / review |
| Risk | low / medium / high |
| Conflict Group | Parallelism control group |
| Role | Worker role assignment |
| Readiness | ready / blocked / done |
| Note | Readiness explanation |

Conflict warnings are displayed as yellow banners above the table.

### Batch Preview

Shows the compiled launch plan:

- **Main Health** — Current health state (green/yellow/red/black)
- **Budget** — Task count, max files, max lines, time limits
- **Selected Tasks** — Tasks cleared for dispatch
- **Rejected Tasks** — Tasks blocked by the gate with rule and reason
- **Acquired Locks** — Shared locks held by selected tasks
- **All-Allowed Indicator** — Green if all cleared, yellow if blocked

---

## Safety

- **View-only**: No action buttons, no mutation capabilities
- **No secrets**: Only structural metadata is displayed
- **Graceful degradation**: Missing planning data shows "No planning data available"
- **Optional data source**: Console loads even if planning file doesn't exist

---

## Integration

The Planning Console tab is the third tab in the WebUI:

1. **Dashboard** — Provider, worker, queue, and pressure state
2. **Operation Console** — Preview/execute actions with audit log
3. **Planning Console** — Planning loop visibility (this view)

Tab switching is client-side with no additional data fetching. All
planning data is fetched alongside the dashboard data on each refresh
cycle (30-second polling).

---

## Non-Goals

- No mutation actions (view-only)
- No real-time WebSocket updates (polling-based)
- No server-side endpoint changes (reads static JSON)
- No credential or secret display

---

## References

- [Planning Loop](planning-loop.md) — Dry-run planner
- [Gap Ledger](gap-ledger.md) — Gap event schema
- [Meta Signals](meta-signals.md) — Signal calculator
- [Launch Plan Schema](launch-plan-schema.md) — Batch preview schema
- [Issue-to-Task Compiler](issue-to-task-compiler.md) — Task compilation
- [Provider Pool WebUI Operation Console](provider-pool-webui-operation-console.md) — Sibling tab
