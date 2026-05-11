# Worker Assignment Ledger Schema

Append-only NDJSON ledger recording worker assignment lifecycle events. Links each task to a provider, concurrency slot, and status for capacity tracking and audit.

**Schema location:** `schemas/worker-assignment-ledger.schema.json`

## Purpose

The control plane tracks worker state at multiple layers:

| Layer | Captures | Schema |
|-------|----------|--------|
| Active workers projection | Currently running workers (snapshot) | `active-workers-state.md` |
| Heartbeat | Worker liveness signals | `worker-heartbeat.md` |
| Telemetry | Cost, tokens, quality signals | `worker-telemetry.schema.json` |
| **Assignment ledger** | **Task-provider-slot binding and lifecycle** | **`worker-assignment-ledger.schema.json`** |

The assignment ledger fills the gap between the active workers projection (a point-in-time snapshot) and telemetry (post-completion accounting). It provides an append-only history of **when** a slot was claimed, **which provider** claimed it, and **how** the assignment resolved.

## Entry Shape

Each NDJSON line has these top-level fields:

```
schemaVersion   -- pinned to 1
entryId         -- unique entry identifier
recordedAt      -- ISO-8601 timestamp
taskId          -- matches heartbeat taskId
issueNumber     -- GitHub issue targeted
prNumber        -- PR produced (nullable)
providerId      -- provider that executed the task
slotId          -- concurrency slot claimed
status          -- lifecycle state
conflictGroup   -- parallelism group (nullable)
actorRole       -- worker role (nullable)
pmPhase         -- wave/phase identifier (nullable)
reason          -- human-readable transition reason (nullable)
meta            -- arbitrary metadata (nullable)
```

## Field Reference

### Identity

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `schemaVersion` | `1` (const) | yes | Schema version. Consumers reject other values. |
| `entryId` | string | yes | Unique identifier for this ledger entry (UUID or monotonic). |
| `recordedAt` | date-time | yes | When this entry was recorded. |

### Task Binding

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `taskId` | string | yes | Worker task identifier, matching heartbeat `taskId`. |
| `issueNumber` | integer >= 1 | yes | GitHub issue number this assignment targets. |
| `prNumber` | integer or null | no | GitHub PR produced by this assignment. |

### Provider and Slot

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `providerId` | string | yes | Provider executing the task (e.g. `claude-opus-4-7`, `codex-mini`). |
| `slotId` | string | yes | Concurrency slot identifier. Each slot = one unit of live worker capacity. |

### Lifecycle

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `status` | enum | yes | Lifecycle state (see below). |
| `reason` | string or null | no | Human-readable reason for the status transition. |

### Context

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `conflictGroup` | string or null | no | Logical conflict group for parallelism control. |
| `actorRole` | string or null | no | Worker role from the task contract `rolePacket`. |
| `pmPhase` | string or null | no | Wave/phase identifier for aggregation. |
| `meta` | object or null | no | Arbitrary key-value metadata. Must not contain secrets. |

## Lifecycle Status

The `status` field follows a deterministic state machine:

```
assigned → started → completed
                   → failed
                   → released
```

| Status | Meaning | Typical Transition |
|--------|---------|-------------------|
| `assigned` | Slot reserved for a task. Capacity is consumed. | First entry when a worker is dispatched. |
| `started` | Worker has begun execution (first heartbeat or tool call). | Follows `assigned` once the worker process is alive. |
| `completed` | Worker finished successfully and produced a PR. | Terminal state. |
| `failed` | Worker exited with error or timed out. | Terminal state. |
| `released` | Slot freed after a terminal state. Capacity returned. | Follows `completed` or `failed` once cleanup is done. |

Every task should produce at least two entries: `assigned` and one terminal (`completed` or `failed`). The `released` entry is written by the reconciler or launcher after cleanup.

## Example Entries

### Assignment

```json
{
  "schemaVersion": 1,
  "entryId": "assign-20260511-001",
  "recordedAt": "2026-05-11T14:00:00Z",
  "taskId": "wave14-issue-526-worker-001",
  "issueNumber": 526,
  "prNumber": null,
  "providerId": "claude-opus-4-7",
  "slotId": "slot-07",
  "status": "assigned",
  "conflictGroup": "schema-worker-assignment-ledger",
  "actorRole": "ai-native-tooling-worker",
  "pmPhase": "self-cycle-wave14-concurrency-topup",
  "reason": null,
  "meta": null
}
```

### Started

```json
{
  "schemaVersion": 1,
  "entryId": "start-20260511-001",
  "recordedAt": "2026-05-11T14:00:45Z",
  "taskId": "wave14-issue-526-worker-001",
  "issueNumber": 526,
  "prNumber": null,
  "providerId": "claude-opus-4-7",
  "slotId": "slot-07",
  "status": "started",
  "conflictGroup": "schema-worker-assignment-ledger",
  "actorRole": "ai-native-tooling-worker",
  "pmPhase": "self-cycle-wave14-concurrency-topup",
  "reason": null,
  "meta": null
}
```

### Completed

```json
{
  "schemaVersion": 1,
  "entryId": "complete-20260511-001",
  "recordedAt": "2026-05-11T14:35:00Z",
  "taskId": "wave14-issue-526-worker-001",
  "issueNumber": 526,
  "prNumber": 530,
  "providerId": "claude-opus-4-7",
  "slotId": "slot-07",
  "status": "completed",
  "conflictGroup": "schema-worker-assignment-ledger",
  "actorRole": "ai-native-tooling-worker",
  "pmPhase": "self-cycle-wave14-concurrency-topup",
  "reason": null,
  "meta": null
}
```

### Released

```json
{
  "schemaVersion": 1,
  "entryId": "release-20260511-001",
  "recordedAt": "2026-05-11T14:35:15Z",
  "taskId": "wave14-issue-526-worker-001",
  "issueNumber": 526,
  "prNumber": 530,
  "providerId": "claude-opus-4-7",
  "slotId": "slot-07",
  "status": "released",
  "conflictGroup": "schema-worker-assignment-ledger",
  "actorRole": "ai-native-tooling-worker",
  "pmPhase": "self-cycle-wave14-concurrency-topup",
  "reason": "slot freed after merge",
  "meta": null
}
```

## Capacity Tracking

Each `assigned` entry consumes one unit of concurrency. Each `released` entry returns it. Current live concurrency is:

```
count(status=assigned) + count(status=started) + count(status=completed or failed but not released)
```

Downstream tools can query the ledger to compute:

- **Live concurrency:** Number of non-released assignments.
- **Per-provider load:** Group by `providerId` to see provider utilization.
- **Per-slot churn:** Group by `slotId` to detect slot hotspots.
- **Conflict group saturation:** Group by `conflictGroup` to see parallelism pressure.

## Downstream Consumers

| Consumer | How It Uses This Ledger |
|----------|------------------------|
| **State reconciler** | Detects orphaned assignments (assigned but no heartbeat). |
| **Launch gate** | Reads live concurrency to enforce capacity limits. |
| **Provider pool guard** | Tracks per-provider slot usage for quota-aware dispatch. |
| **Meta-signals calculator** | Aggregates failure rate and slot churn for health scoring. |
| **Operator dashboards** | NDJSON format is trivially parseable for ad-hoc queries. |

## Design Decisions

- **Append-only.** Each status transition is a new line. Previous entries are never modified. Safe for concurrent writers and trivial to audit.
- **NDJSON over JSON array.** Streamable, appendable, doesn't require parsing the entire file to read the latest entry. Consistent with gap-ledger and fact-event-ledger.
- **Slot semantics.** The `slotId` is an opaque string. The ledger does not define slot numbering — that is the provider pool guard's responsibility. The ledger only records which slot was claimed.
- **No secrets.** Entries contain only structural metadata. `meta` must not contain tokens, credentials, or log content.
- **Schema versioning.** `schemaVersion` enables forward-compatible evolution without breaking consumers.
- **Nullable context fields.** `conflictGroup`, `actorRole`, `pmPhase` are nullable to support minimal entries (e.g. cleanup releases) without requiring full task context.

## See Also

- [Active Workers State](active-workers-state.md) — Point-in-time snapshot of running workers
- [Worker Telemetry Schema](worker-telemetry-schema.md) — Post-completion cost and quality accounting
- [Gap Ledger](gap-ledger.md) — Append-only gap event log
- [Fact Event Ledger](fact-event-ledger.md) — Append-only control-plane fact log
- [Provider Pool](provider-pool.md) — Provider and slot management
- [Provider Pool Guard](provider-pool-guard.md) — Quota-aware launch readiness
- [Worker Heartbeat](worker-heartbeat.md) — Worker liveness signals
