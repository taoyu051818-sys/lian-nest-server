# WebUI Planning Console State JSON Schema

Formal JSON Schema for the WebUI Planning Console state projection, aggregating
gap ledger entries, plan proposals, batch plans, meta signals, and main health
into a single read-model for the planning console.

> **Schema file:** [`schemas/webui-planning-console-state.schema.json`](../../schemas/webui-planning-console-state.schema.json)
> **Closes:** [#688](https://github.com/taoyu051818-sys/lian-nest-server/issues/688)

---

## Overview

The planning console state is a projection that consolidates five concerns
into one JSON file: open gaps, plan proposals, the latest batch plan, meta
signals, and main branch health. It is consumed by the WebUI planning console
to render a unified planning and operations view in a single polling cycle.

The contract is **read-only from the WebUI perspective** — the state
reconciler writes the projection; the WebUI renders it.

| Aspect | Value |
|--------|-------|
| Schema version | `schemaVersion: 1` |
| JSON Schema draft | `draft-07` |
| Writer | State reconciler / planning loop |
| Projection path | `.github/ai-state/webui-planning-console.json` |

---

## Gap Entry Types

Each gap entry records a discrete planning obstacle:

| Gap Type | Severity | Meaning |
|----------|----------|---------|
| `worker-failed` | high | A worker exited with a non-zero code. |
| `worker-stale` | high | A worker has not reported progress beyond the stale threshold. |
| `health-gate-fail` | critical | Main branch health gate failed. |
| `launch-blocked` | medium | A task was blocked by the launch gate. |
| `plan-drift` | low | The batch plan no longer matches current issue state. |
| `stale-row` | low | A migration matrix row is stalled between statuses. |

---

## Proposal Readiness States

Each proposal carries a readiness indicator derived from migration matrix
slice status:

| Readiness | Slice Statuses | Meaning |
|-----------|---------------|---------|
| `ready` | `CONTRACTED`, `IMPLEMENTED`, `PARITY_TESTED` | Task can be dispatched. |
| `blocked` | `NOT_STARTED` | Dependency not yet met. |
| `done` | `LEGACY_DISABLED` | Slice complete; excluded from batches. |

When no slice reference is detected, readiness defaults to `ready`.

---

## Fields

### Top-Level

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `schemaVersion` | `integer` (const `1`) | yes | Schema version. Increment on shape change. |
| `capturedAt` | `string` (ISO-8601) | yes | When this projection was last written. |
| `gaps` | `GapEntry[]` | yes | Active gap entries. Empty when no gaps are open. |
| `proposals` | `ProposalEntry[]` | yes | Plan proposals from the planning loop. Empty when no candidates. |
| `batchPlan` | `BatchPlanSnapshot` | yes | Snapshot of the latest compiled launch plan. |
| `metaSignals` | `MetaSignalsSnapshot` | yes | Snapshot of meta signals for risk-aware prioritization. |
| `mainHealth` | `MainHealthSnapshot` | yes | Current main branch health state. |
| `summary` | `ConsoleSummary` | yes | Aggregate counts for the dashboard. |

### GapEntry

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `gapType` | `string` enum | yes | Category of gap event. |
| `severity` | `string` enum | yes | `low`, `medium`, `high`, or `critical`. |
| `description` | `string` | yes | Human-readable description. |
| `recordedAt` | `string` (ISO-8601) | yes | When the gap was recorded. |
| `issue` | `integer` or `null` | no | Related GitHub issue number. |
| `pr` | `integer` or `null` | no | Related GitHub PR number. |
| `conflictGroup` | `string` or `null` | no | Associated conflict group. |

### ProposalEntry

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `issueNumber` | `integer` >= 1 | yes | GitHub issue number. |
| `title` | `string` | yes | Issue title for WebUI display. |
| `taskType` | `string` enum | yes | `execution`, `research`, or `review`. |
| `risk` | `string` enum | yes | `low`, `medium`, or `high`. |
| `conflictGroup` | `string` | yes | Conflict group for parallelism control. |
| `actorRole` | `string` | yes | Worker role assignment. |
| `readiness` | `string` enum | yes | `ready`, `blocked`, or `done`. |
| `readinessNote` | `string` or `null` | no | Explanation of readiness state. |
| `allowedFiles` | `string[]` | no | File globs the worker may edit. |
| `forbiddenFiles` | `string[]` | no | File globs the worker must not edit. |
| `validationCommands` | `string[]` | no | Commands to run before PR. |
| `sliceRef` | `string` or `null` | no | Migration matrix slice identifier. |
| `sliceStatus` | `string` enum or `null` | no | Current slice status. |

### BatchPlanSnapshot

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `planVersion` | `integer` | yes | Version of the launch plan schema. |
| `capturedAt` | `string` (ISO-8601) | yes | When the launch plan was compiled. |
| `selectedCount` | `integer` >= 0 | yes | Tasks selected for dispatch. |
| `rejectedCount` | `integer` >= 0 | yes | Tasks rejected by the launch gate. |
| `allAllowed` | `boolean` | yes | True if no tasks were rejected. |
| `mainHealthState` | `string` enum or `null` | no | Health state at plan compilation time. |
| `selectedIssues` | `integer[]` | no | Issue numbers of selected tasks. |
| `rejectedIssues` | `integer[]` | no | Issue numbers of rejected tasks. |
| `locksHeld` | `string[]` | no | Shared lock names acquired. |

### MetaSignalsSnapshot

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `failureScore` | `integer` 0-100 | yes | Aggregated failure severity. |
| `frictionScore` | `integer` 0-100 | yes | Friction from stale workers. |
| `riskScore` | `integer` 0-100 | yes | Unresolved high-risk slices. |
| `trust` | `integer` 0-100 | yes | Inverse of failure+friction (100 = full trust). |
| `topPain` | `string` | yes | Category with highest failure count. |
| `cost` | `number` >= 0 | no | Elapsed worker-minutes. |

### MainHealthSnapshot

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `state` | `string` enum | yes | `green`, `yellow`, `red`, or `black`. |
| `capturedAt` | `string` (ISO-8601) | yes | When health was last evaluated. |
| `checks` | `string[]` | no | Health checks that ran. |
| `failedChecks` | `string[]` | no | Subset of checks that failed. |
| `allowedWorkerClasses` | `string[]` | no | Worker classes permitted in this state. |
| `reason` | `string` or `null` | no | Human-readable explanation. |

### ConsoleSummary

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `totalGaps` | `integer` >= 0 | yes | Total active gap entries. |
| `criticalGaps` | `integer` >= 0 | yes | Gaps with severity critical or high. |
| `readyProposals` | `integer` >= 0 | yes | Proposals with readiness=ready. |
| `blockedProposals` | `integer` >= 0 | yes | Proposals with readiness=blocked. |
| `selectedTasks` | `integer` >= 0 | yes | Tasks selected in latest batch plan. |
| `rejectedTasks` | `integer` >= 0 | yes | Tasks rejected in latest batch plan. |
| `healthState` | `string` enum or `null` | yes | Current main health for quick reference. |
| `trust` | `integer` 0-100 | yes | Current trust score. |

---

## Examples

### Active Planning Console

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-12T00:30:00Z",
  "gaps": [
    {
      "gapType": "stale-row",
      "severity": "low",
      "description": "Route parity row stalled: auth/login has status IMPLEMENTED for 21 days with no test_status change.",
      "recordedAt": "2026-05-11T18:00:00Z",
      "issue": 680,
      "pr": null,
      "conflictGroup": "auth-core"
    }
  ],
  "proposals": [
    {
      "issueNumber": 688,
      "title": "Add Planning Console state schema",
      "taskType": "execution",
      "risk": "low",
      "conflictGroup": "planning-console-schema",
      "actorRole": "webui-planning-console-worker",
      "readiness": "ready",
      "readinessNote": null,
      "allowedFiles": [
        "schemas/webui-planning-console-state.schema.json",
        "docs/ai-native/webui-planning-console-state-schema.md"
      ],
      "forbiddenFiles": [
        "src/**",
        "prisma/**"
      ],
      "validationCommands": [
        "npm run check",
        "npm run build"
      ],
      "sliceRef": null,
      "sliceStatus": null
    }
  ],
  "batchPlan": {
    "planVersion": 1,
    "capturedAt": "2026-05-12T00:25:00Z",
    "selectedCount": 5,
    "rejectedCount": 1,
    "allAllowed": false,
    "mainHealthState": "green",
    "selectedIssues": [688, 685, 682, 680, 679],
    "rejectedIssues": [690],
    "locksHeld": ["planning-console-schema", "auth-core"]
  },
  "metaSignals": {
    "failureScore": 12,
    "frictionScore": 8,
    "riskScore": 20,
    "trust": 82,
    "topPain": "runtime compile",
    "cost": 45.3
  },
  "mainHealth": {
    "state": "green",
    "capturedAt": "2026-05-12T00:20:00Z",
    "checks": ["tsc", "build", "prisma", "test:boundary"],
    "failedChecks": [],
    "allowedWorkerClasses": ["all"],
    "reason": null
  },
  "summary": {
    "totalGaps": 1,
    "criticalGaps": 0,
    "readyProposals": 1,
    "blockedProposals": 0,
    "selectedTasks": 5,
    "rejectedTasks": 1,
    "healthState": "green",
    "trust": 82
  }
}
```

### Empty Planning Console

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-12T00:00:00Z",
  "gaps": [],
  "proposals": [],
  "batchPlan": {
    "planVersion": 1,
    "capturedAt": "2026-05-12T00:00:00Z",
    "selectedCount": 0,
    "rejectedCount": 0,
    "allAllowed": true,
    "mainHealthState": "green",
    "selectedIssues": [],
    "rejectedIssues": [],
    "locksHeld": []
  },
  "metaSignals": {
    "failureScore": 0,
    "frictionScore": 0,
    "riskScore": 0,
    "trust": 100,
    "topPain": "none"
  },
  "mainHealth": {
    "state": "green",
    "capturedAt": "2026-05-12T00:00:00Z",
    "checks": ["tsc", "build"],
    "failedChecks": [],
    "allowedWorkerClasses": ["all"],
    "reason": null
  },
  "summary": {
    "totalGaps": 0,
    "criticalGaps": 0,
    "readyProposals": 0,
    "blockedProposals": 0,
    "selectedTasks": 0,
    "rejectedTasks": 0,
    "healthState": "green",
    "trust": 100
  }
}
```

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **WebUI Planning Console** | All | Render the unified planning and operations view. |
| **Operator dashboard** | `summary`, `gaps` | Quick health check and gap triage. |
| **Launch gate** | `proposals[].conflictGroup`, `mainHealth.state` | Cross-reference with active workers for conflict detection. |
| **Batch launcher** | `proposals` (readiness=ready), `batchPlan` | Drive dispatch decisions. |
| **Monitoring** | `capturedAt`, `summary.trust`, `summary.criticalGaps` | Detect stale projections and trust degradation. |

---

## Design Decisions

- **Projection, not log.** Each write replaces the previous state. No append-only history.
- **Gaps are inline, not referenced.** Gap entries are copied from the gap ledger into the projection so the WebUI can render them without a second file read.
- **Proposals mirror planning loop output.** The `ProposalEntry` shape aligns with the planning loop's candidate fields so the reconciler can map directly.
- **Batch plan is a snapshot, not a reference.** Key counts and issue numbers are inlined to avoid the WebUI needing to resolve a separate launch plan file.
- **Summary is always required.** The WebUI dashboard renders from `summary` first; deeper fields are loaded on demand.
- **No secrets.** The projection contains only public identifiers (issue numbers, PR numbers, role names, conflict groups).

---

## Relationship to Other Schemas

| Schema | Purpose |
|--------|---------|
| `schemas/gap-ledger.schema.json` | Source of gap entries (NDJSON log). |
| `schemas/launch-plan.schema.json` | Source of batch plan data. |
| `schemas/meta-signals.schema.json` | Source of risk/trust signals. |
| `schemas/health-state.schema.json` | Source of main branch health. |
| `schemas/webui-queue-state.schema.json` | Sibling projection for the queue dashboard. |

The planning console state is a **composite read-model** that aggregates data
from multiple upstream schemas into a single WebUI-consumable projection.

---

## References

- [Planning Loop](planning-loop.md) — Dry-run planner that produces proposals.
- [Gap Ledger](gap-ledger.md) — Gap event log consumed by this projection.
- [Launch Plan Schema](launch-plan-schema.md) — Batch plan schema.
- [Meta Signals Schema](meta-signals-schema.md) — Risk and trust signals.
- [Health State Schema](health-state-schema.md) — Main branch health.
- [WebUI Queue State Schema](webui-queue-state-schema.md) — Sibling queue projection.
