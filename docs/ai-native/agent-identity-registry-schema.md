# Agent Identity Registry Schema

Defines the JSON schema for the agent identity registry projection at `.github/ai-state/agent-identity-registry.json`.

**Schema location:** `schemas/agent-identity-registry.schema.json`
**Closes:** [#1293](https://github.com/taoyu051818-sys/lian-nest-server/issues/1293)

---

## Purpose

The agent identity registry assigns stable identity and accountability metadata to every AI worker so that budget, spending, contribution, and trust can be attributed reliably across sessions. Before this registry, workers had no persistent identity beyond their task JSON — the next self-cycle layer needs agent identity before it can attribute outcomes.

| Layer | Reads | Purpose |
|-------|-------|---------|
| **Orchestrator / launcher** | `agents.*.workerClass`, `agents.*.permissions` | Validate dispatch eligibility and file boundaries |
| **State reconciler** | `agents.*.trustScore`, `agents.*.accountability` | Update trust scores and failure counts after task completion |
| **Launch gate** | `agents.*.status`, `agents.*.trustScore.current` | Block suspended or low-trust agents |
| **Heartbeat monitor** | `agents.*.status`, `agents.*.accountability.lastTaskAt` | Detect stale or hung agents |
| **Command Steward** | Full file | Surface agent status and accountability in the daily brief |

---

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `markerVersion` | `1` (const) | yes | Schema version. Consumers reject other values. |
| `capturedAt` | date-time | yes | ISO-8601 timestamp when this projection was captured or last updated. |
| `agents` | object | yes | Registered agent entries. Each key is an `agentId`. |

---

## Agent Entry

Each entry in `agents` has these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string (kebab-case) | yes | Stable agent identifier. Must be unique within the registry. |
| `workerClass` | enum | yes | Worker class this agent belongs to. Determines file boundaries. |
| `owner` | string | yes | Human or team responsible for this agent. Used for escalation routing. |
| `permissions` | object | yes | File and concurrency permissions derived from worker class. |
| `trustScore` | object | yes | Current and baseline trust scores. |
| `registeredAt` | date-time | yes | When this agent was first registered. |
| `status` | enum | yes | Current status: `active`, `idle`, `suspended`, `retired`. |
| `accountability` | object | no | Task completion/failure counters and last failure reason. |
| `note` | string or null | no | Human-readable note about this agent. |

### Agent ID Convention

Agent IDs follow kebab-case naming:

```
<type>-<worker-class>[-<sequence>]
```

| Segment | Rule | Example |
|---------|------|---------|
| Type | `worker` or `agent` | `worker`, `agent` |
| Worker class | Matches `workerClass` enum | `runtime-feature`, `telemetry-governance` |
| Sequence (optional) | Numeric or short identifier | `001`, `primary` |

Examples: `worker-runtime-feature-001`, `agent-telemetry-governance`, `worker-docs-primary`

### Worker Class

Matches the worker classes defined in [worker-permissions.md](worker-permissions.md) with one addition:

| Class | Layer | Default Trust | Description |
|-------|-------|:-------------:|-------------|
| `docs` | contract-planning | 0.9 | Documentation workers |
| `tests` | feature-repository | 0.7 | Test-only workers |
| `tooling` | health-diagnostic | 0.8 | Script and CI workers |
| `runtime-feature` | feature-repository | 0.5 | Feature implementation workers |
| `runtime-foundation` | runtime-foundation | 0.8 | Foundation fix workers |
| `prisma` | runtime-foundation | 0.6 | Database migration workers |
| `review` | review-audit | 0.85 | Review and audit workers |
| `merge` | merge-release | 0.6 | Merge queue workers |
| `state-reconciler` | control-plane | 0.9 | State management workers |
| `provider-pool` | control-plane | 0.85 | Provider configuration workers |
| `meta-loop` | control-plane | 0.7 | Orchestration workers |
| `telemetry-governance` | control-plane | 0.9 | Telemetry and governance workers |

### Permissions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `allowedFileGlobs` | string[] | yes | File glob patterns this agent may modify. Derived from worker class boundary. |
| `maxConcurrentTasks` | integer [1, 10] | yes | Maximum concurrent tasks. |
| `canSelfApprove` | boolean | yes | Always `false`. Enforced by seed constitution. |

### Trust Score

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `current` | number [0.0, 1.0] | yes | Current trust score. Updated by state reconciler after each task. |
| `defaultBaseline` | number [0.0, 1.0] | yes | Baseline from `worker-trust.json`. Used to reset after long idle. |
| `lastUpdated` | date-time or null | no | When trust was last updated. |

### Accountability

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `totalTasksCompleted` | integer >= 0 | no | Total successful tasks. |
| `totalTasksFailed` | integer >= 0 | no | Total failed tasks. |
| `lastTaskAt` | date-time or null | no | Timestamp of last completed or failed task. |
| `lastFailureReason` | string or null | no | Reason for most recent failure. |
| `consecutiveFailures` | integer >= 0 | no | Consecutive failures. Reset to 0 on success. Used for auto-suspend. |

### Status

| Status | Meaning | Transitions |
|--------|---------|-------------|
| `active` | Currently dispatched on a task | -> `idle`, `suspended` |
| `idle` | Available for dispatch | -> `active`, `suspended`, `retired` |
| `suspended` | Blocked by policy, trust, or failures | -> `idle`, `retired` |
| `retired` | Permanently decommissioned | Terminal state |

---

## Examples

### Minimal Registry

```json
{
  "markerVersion": 1,
  "capturedAt": "2026-05-12T12:00:00Z",
  "agents": {
    "worker-runtime-feature-001": {
      "agentId": "worker-runtime-feature-001",
      "workerClass": "runtime-feature",
      "owner": "taoyu",
      "permissions": {
        "allowedFileGlobs": ["src/**", "test/**"],
        "maxConcurrentTasks": 1,
        "canSelfApprove": false
      },
      "trustScore": {
        "current": 0.5,
        "defaultBaseline": 0.5,
        "lastUpdated": null
      },
      "registeredAt": "2026-05-12T12:00:00Z",
      "status": "idle"
    }
  }
}
```

### Full Registry with Accountability

```json
{
  "markerVersion": 1,
  "capturedAt": "2026-05-12T14:30:00Z",
  "agents": {
    "worker-runtime-feature-001": {
      "agentId": "worker-runtime-feature-001",
      "workerClass": "runtime-feature",
      "owner": "taoyu",
      "permissions": {
        "allowedFileGlobs": ["src/**", "test/**"],
        "maxConcurrentTasks": 1,
        "canSelfApprove": false
      },
      "trustScore": {
        "current": 0.65,
        "defaultBaseline": 0.5,
        "lastUpdated": "2026-05-12T14:00:00Z"
      },
      "registeredAt": "2026-05-10T09:00:00Z",
      "status": "active",
      "accountability": {
        "totalTasksCompleted": 12,
        "totalTasksFailed": 2,
        "lastTaskAt": "2026-05-12T13:45:00Z",
        "lastFailureReason": null,
        "consecutiveFailures": 0
      }
    },
    "agent-telemetry-governance": {
      "agentId": "agent-telemetry-governance",
      "workerClass": "telemetry-governance",
      "owner": "taoyu",
      "permissions": {
        "allowedFileGlobs": ["schemas/**", "docs/ai-native/**", "scripts/ai/**"],
        "maxConcurrentTasks": 2,
        "canSelfApprove": false
      },
      "trustScore": {
        "current": 0.9,
        "defaultBaseline": 0.9,
        "lastUpdated": "2026-05-12T12:00:00Z"
      },
      "registeredAt": "2026-05-11T08:00:00Z",
      "status": "idle",
      "accountability": {
        "totalTasksCompleted": 5,
        "totalTasksFailed": 0,
        "lastTaskAt": "2026-05-12T11:30:00Z",
        "lastFailureReason": null,
        "consecutiveFailures": 0
      },
      "note": "Primary governance worker for control-plane artifacts."
    },
    "worker-docs-primary": {
      "agentId": "worker-docs-primary",
      "workerClass": "docs",
      "owner": "taoyu",
      "permissions": {
        "allowedFileGlobs": ["docs/**", "ops/**", "README.md"],
        "maxConcurrentTasks": 3,
        "canSelfApprove": false
      },
      "trustScore": {
        "current": 0.9,
        "defaultBaseline": 0.9,
        "lastUpdated": "2026-05-11T10:00:00Z"
      },
      "registeredAt": "2026-05-10T09:00:00Z",
      "status": "suspended",
      "accountability": {
        "totalTasksCompleted": 8,
        "totalTasksFailed": 3,
        "lastTaskAt": "2026-05-12T10:00:00Z",
        "lastFailureReason": "Exceeded softTimeMinutes without opening PR",
        "consecutiveFailures": 3
      },
      "note": "Suspended due to 3 consecutive failures. Requires trust review."
    }
  }
}
```

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **Launch gate** | `agents.*.status`, `agents.*.trustScore.current` | Block suspended or low-trust agents before dispatch. |
| **State reconciler** | `agents.*.trustScore`, `agents.*.accountability` | Update trust and failure counts after each task. |
| **Orchestrator** | `agents.*.workerClass`, `agents.*.permissions` | Validate file boundaries and concurrency limits. |
| **Heartbeat monitor** | `agents.*.status`, `agents.*.accountability.lastTaskAt` | Detect stale agents. |
| **Command Steward** | Full file | Surface agent status and accountability in daily brief. |
| **Batch launcher** | `agents.*.status`, `agents.*.permissions` | Pre-filter eligible agents before dispatch. |

---

## Schema Versioning

- **Current version:** `1`
- **Consumers must reject** records with an unrecognized `markerVersion`.
- **New optional fields** may be added without incrementing the version.
- **Removing or renaming fields** or changing required fields requires a version bump.

---

## Validation

The schema uses JSON Schema draft-07. Validate agent-identity-registry files against it:

```bash
# Using ajv-cli (if installed)
npx ajv validate -s schemas/agent-identity-registry.schema.json -d .github/ai-state/agent-identity-registry.json

# Using any draft-07 compatible validator
```

---

## Design Decisions

- **Projection seed, not runtime state.** This file sets agent identity and defaults. The orchestrator computes actual trust scores at dispatch time using live inputs from `worker-trust.json`.
- **No secrets or tokens.** The file contains only identity metadata, permissions, and accountability counters.
- **`markerVersion` enables schema evolution.** Consumers check the version before parsing.
- **Agent IDs are stable across sessions.** Unlike task-bound worker references, agent IDs persist so accountability data accumulates.
- **`canSelfApprove` is always false.** Enforced by the seed constitution. The field exists for schema completeness and future governance changes.
- **Accountability is optional.** New agents start without accountability data. The state reconciler populates it after the first task.

---

## Relationship to Existing Policies

| Policy | Interaction |
|--------|------------|
| [Worker Trust](worker-trust-schema.md) | `defaultBaseline` is sourced from `worker-trust.json` per worker class |
| [Worker Permissions](worker-permissions.md) | `allowedFileGlobs` is derived from the worker class file boundary |
| [Active Workers](active-workers-schema.md) | Active workers reference agent IDs for accountability attribution |
| [Worker Behavior Policy](worker-behavior-policy.md) | Accountability counters track behavior policy violations |
| [Seed Constitution](seed-constitution.md) | `canSelfApprove: false` is a constitutional invariant |

---

## References

- [Worker Trust Schema](worker-trust-schema.md) — Trust score semantics and scheduling
- [Worker Permissions](worker-permissions.md) — File boundary per worker class
- [Active Workers Schema](active-workers-schema.md) — In-flight worker tracking
- [Worker Behavior Policy](worker-behavior-policy.md) — Behavioral principles and enforcement
- [Roles](roles.md) — Role definitions and authority
- [Control Skill Registry](control-skill-registry.md) — Skill identity and governance patterns
- [#1293](https://github.com/taoyu051818-sys/lian-nest-server/issues/1293) — This feature
