# External Intake Result Writer

Contract for writing accepted and rejected external-intake experiment
results back to the fact event ledger, opportunity signal state, and
knowledge ledger.

> **Closes:** [#980](https://github.com/taoyu051818-sys/lian-nest-server/issues/980)
>
> **Cross-references:**
> [external-intake-executable-loop.md](external-intake-executable-loop.md)
> for the intake loop stages,
> [opportunity-signal-schema.md](opportunity-signal-schema.md) for
> signal fields and lifecycle,
> [fact-event-ledger.md](fact-event-ledger.md) for the event ledger
> contract,
> [knowledge-update-writer.md](knowledge-update-writer.md) for the
> knowledge NDJSON writer.

---

## Overview

When an external-intake experiment reaches a terminal state (accepted or
rejected), the result writer records the outcome across three ledgers:

1. **Fact event ledger** — appends an `experiment.result` event capturing
   the outcome and metadata.
2. **Opportunity signal state** — updates the signal file status to
   `accepted`, `scheduled`, or `rejected`.
3. **Knowledge ledger** — (on acceptance) records what was learned for
   downstream planning context.

The writer is a contract, not a single script. Multiple scripts
(`write-fact-event.js`, signal file updaters, `write-knowledge-update.ps1`)
coordinate to produce the full result. This document defines the
coordination rules.

---

## Result Types

| Result | Signal Status Transition | Fact Event Type | Knowledge Entry |
|--------|-------------------------|-----------------|-----------------|
| **Accepted** | `validated` → `accepted` | `experiment.accepted` | Yes |
| **Promoted** | `accepted` → `scheduled` | `experiment.scheduled` | Yes (with task ID) |
| **Rejected** | `validated` → `rejected` (or `accepted` → `rejected`) | `experiment.rejected` | No |

---

## Accepted Result Flow

When an experiment passes its acceptance gate, the writer performs these
steps in order:

### 1. Update Signal Status

The opportunity signal file is updated in place:

```jsonc
// .github/ai-state/opportunity-signals/opp-<uuid>.json
{
  "status": "accepted",
  "updatedAt": "2026-05-12T14:00:00Z"
}
```

### 2. Emit Fact Event

Appends to `.github/ai-state/fact-events.ndjson`:

```jsonc
{
  "eventVersion": 1,
  "eventType": "experiment.accepted",
  "subject": "opp-a1b2c3d4",
  "facts": {
    "signalId": "opp-a1b2c3d4",
    "hypothesis": "The N+1 query causes P95 latency spike",
    "experimentType": "code-change",
    "scope": "GET /api/users only",
    "acceptedBy": "architect",
    "sourceReliability": "high"
  },
  "capturedAt": "2026-05-12T14:00:00Z",
  "actor": "intake-result-writer"
}
```

### 3. Record Knowledge Entry

Appends to `.github/ai-state/knowledge-updates.ndjson`:

```jsonc
{
  "schemaVersion": 1,
  "category": "architecture",
  "summary": "Accepted experiment: N+1 query fix for /api/users latency",
  "capturedAt": "2026-05-12T14:00:00Z",
  "commitSha": "HEAD",
  "issueNumber": 0,
  "prNumber": 0,
  "tags": ["experiment", "accepted", "performance"],
  "details": "Signal opp-a1b2c3d4 accepted. Scope: GET /api/users. Success criteria: P95 < 200ms."
}
```

---

## Promoted Result Flow

When a planning loop promotes an accepted signal to a scheduled task:

### 1. Update Signal Status

```jsonc
// .github/ai-state/opportunity-signals/opp-<uuid>.json
{
  "status": "scheduled",
  "promotedTaskId": "task-xyz789",
  "updatedAt": "2026-05-12T15:00:00Z"
}
```

### 2. Emit Fact Event

```jsonc
{
  "eventVersion": 1,
  "eventType": "experiment.scheduled",
  "subject": "opp-a1b2c3d4",
  "facts": {
    "signalId": "opp-a1b2c3d4",
    "taskId": "task-xyz789",
    "experimentType": "code-change",
    "scope": "GET /api/users only"
  },
  "capturedAt": "2026-05-12T15:00:00Z",
  "actor": "intake-result-writer"
}
```

### 3. Record Knowledge Entry

```jsonc
{
  "schemaVersion": 1,
  "category": "architecture",
  "summary": "Scheduled experiment task-xyz789 from signal opp-a1b2c3d4",
  "capturedAt": "2026-05-12T15:00:00Z",
  "commitSha": "HEAD",
  "issueNumber": 0,
  "prNumber": 0,
  "tags": ["experiment", "scheduled", "performance"],
  "details": "Promoted opp-a1b2c3d4 to task-xyz789. Scope: GET /api/users. Allowed files determined by task contract."
}
```

---

## Rejected Result Flow

When an experiment fails its acceptance gate or is manually rejected:

### 1. Update Signal Status

```jsonc
// .github/ai-state/opportunity-signals/opp-<uuid>.json
{
  "status": "rejected",
  "rejectionReason": "Success criteria not measurable with existing telemetry",
  "updatedAt": "2026-05-12T14:30:00Z"
}
```

### 2. Emit Fact Event

```jsonc
{
  "eventVersion": 1,
  "eventType": "experiment.rejected",
  "subject": "opp-a1b2c3d4",
  "facts": {
    "signalId": "opp-a1b2c3d4",
    "hypothesis": "The N+1 query causes P95 latency spike",
    "rejectionReason": "Success criteria not measurable with existing telemetry",
    "rejectedBy": "architect",
    "sourceReliability": "high"
  },
  "capturedAt": "2026-05-12T14:30:00Z",
  "actor": "intake-result-writer"
}
```

No knowledge entry is written for rejected experiments. The fact event
provides the audit trail.

---

## Event Type Summary

| Event Type | When | Key `facts` Fields |
|------------|------|---------------------|
| `experiment.accepted` | Acceptance gate passes | `signalId`, `hypothesis`, `experimentType`, `scope`, `acceptedBy` |
| `experiment.scheduled` | Planning loop promotes to task | `signalId`, `taskId`, `experimentType`, `scope` |
| `experiment.rejected` | Gate fails or manual rejection | `signalId`, `hypothesis`, `rejectionReason`, `rejectedBy` |

---

## Integration Diagram

```
Opportunity Signal (validated)
        │
        ▼
  Acceptance Gate
        │
   ┌────┴────┐
   │         │
   ▼         ▼
accepted    rejected
   │         │
   │         ├─► update signal → status: "rejected"
   │         ├─► write-fact-event.js → experiment.rejected
   │         └─► (done)
   │
   ├─► update signal → status: "accepted"
   ├─► write-fact-event.js → experiment.accepted
   ├─► write-knowledge-update.ps1 → category: "architecture"
   │
   ▼
Planning Loop
   │
   ▼
scheduled
   │
   ├─► update signal → status: "scheduled", promotedTaskId set
   ├─► write-fact-event.js → experiment.scheduled
   ├─► write-knowledge-update.ps1 → category: "architecture"
   │
   ▼
Worker dispatched (task contract governs execution)
```

---

## Ordering and Atomicity

Steps within a single result type execute in the order listed above.
If any step fails:

| Failure Point | Behavior |
|---------------|----------|
| Signal file update fails | Abort; no fact event or knowledge entry written |
| Fact event write fails | Abort; signal already updated — retry fact event |
| Knowledge write fails | Log warning; signal and fact event are already committed |

Signal status is the source of truth. Fact events and knowledge entries
are derived artifacts. A missing fact event or knowledge entry does not
invalidate the signal status.

---

## Sanitization

All string values in fact events and knowledge entries pass through the
standard sanitization pipeline before writing:

- Token patterns (`ghp_*`, `Bearer *`, base64 blobs) → `[redacted]`
- Injection markers (`SYSTEM:`, `<system>`) → stripped
- Individual field values truncated to 500 characters

See [fact-event-schema.md](fact-event-schema.md) for the full
sanitization rules.

---

## Safe Skeleton Behavior

If an opportunity signal file is missing or unreadable when the result
writer attempts to update it:

| Condition | Behavior |
|-----------|----------|
| Signal file absent | Emit `experiment.orphaned` fact event; skip knowledge entry |
| Signal file unreadable (corrupt JSON) | Emit `experiment.write-error` fact event; skip remaining steps |
| Signal already in terminal state (`scheduled` or `rejected`) | Emit `experiment.duplicate-result` fact event; no state change |

---

## Downstream Consumers

| Consumer | Reads From | Usage |
|----------|-----------|-------|
| Context bundle generator | `fact-events.ndjson` | Includes recent experiment results in worker context |
| Planning loop | Signal files + fact events | Determines which signals are eligible for scheduling |
| Meta signals calculator | `fact-events.ndjson` | Aggregates acceptance/rejection rates |
| Orchestrator | Signal files | Surfaces accepted experiments before dispatching workers |
| Audit | `fact-events.ndjson` | Full trail of experiment outcomes |

---

## Design Decisions

- **Contract, not monolith.** The result writer coordinates existing
  scripts (`write-fact-event.js`, `write-knowledge-update.ps1`) rather
  than introducing a new script. Each ledger has its own writer; this
  document defines the orchestration.
- **Signal file is source of truth.** Fact events and knowledge entries
  are derived. Consumers should treat signal status as authoritative.
- **No knowledge entry for rejections.** Rejected experiments produce a
  fact event for audit but do not pollute the knowledge ledger with
  negative results that have no downstream planning value.
- **Ordering matters.** Signal update before fact event ensures that a
  crash between steps leaves the system in a recoverable state (signal
  updated, missing fact event can be backfilled from signal state).
- **Idempotent re-entry.** If a result is written twice (e.g., retry
  after partial failure), the duplicate-result detection prevents
  state corruption.

---

## References

- [External Intake Executable Loop](external-intake-executable-loop.md) — Intake loop stages and scripts
- [Opportunity Signal Schema](opportunity-signal-schema.md) — Signal fields and lifecycle
- [Fact Event Ledger](fact-event-ledger.md) — Append-only event log contract
- [Fact Event Schema](fact-event-schema.md) — Event field definitions
- [Knowledge Update Writer](knowledge-update-writer.md) — Post-merge knowledge capture
- [Gap Ledger](gap-ledger.md) — Gap event recording
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Idea promotion criteria
- [Meta Signals](meta-signals.md) — Aggregate signal calculator
- [Planning Loop](planning-loop.md) — Batch planning with signal integration
