# Active Workers JSON Schema

Formal JSON Schema for `.github/ai-state/active-workers.json`, the active
workers projection consumed by the launch gate, state reconciler, batch
launcher, and monitoring.

> **Schema file:** [`schemas/active-workers.schema.json`](../../schemas/active-workers.schema.json)
> **Closes:** [#462](https://github.com/taoyu051818-sys/lian-nest-server/issues/462)

---

## Overview

The active workers projection is a single JSON file that records which AI
workers are currently in-flight. It is the canonical source of truth for
conflict-group-based scheduling: the launch gate reads this file to block
tasks that would overlap with active work.

| Aspect | Value |
|--------|-------|
| Schema version | `markerVersion: 1` |
| JSON Schema draft | `draft-07` |
| Writer | State reconciler or batch launcher |
| Path | `.github/ai-state/active-workers.json` |

---

## Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `markerVersion` | `integer` (const `1`) | Schema version. Increment when the shape changes. |
| `capturedAt` | `string` (ISO-8601) | Timestamp when this projection was last written. |
| `workers` | `ActiveWorker[]` | Active worker entries. Empty array when no workers are running. |

---

## ActiveWorker Definition

Each entry in the `workers` array describes a single active worker.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `conflictGroup` | `string` (min 1 char) | Conflict group identifier. Matches `conflictGroup` in task JSON. Used by the launch gate to detect scheduling conflicts. |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `issue` | `integer or null` (min 1) | GitHub issue number the worker is assigned to. |
| `branch` | `string or null` (min 1 char) | Git branch or worktree the worker is operating on. |

---

## Validation Rules

The JSON Schema enforces these constraints:

| Rule | Enforcement |
|------|-------------|
| Root must be an object with `markerVersion`, `capturedAt`, `workers` | Schema `required` |
| `markerVersion` must be exactly `1` | Schema `const` |
| `capturedAt` must be ISO-8601 date-time | Schema `format` |
| `workers` must be an array | Schema `type` |
| Each worker must have `conflictGroup` (non-empty string) | Definition `required` + `minLength` |
| No additional properties at root or worker level | Schema `additionalProperties: false` |

---

## Examples

### Empty Projection (no active workers)

```json
{
  "markerVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "workers": []
}
```

### Single Active Worker

```json
{
  "markerVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "workers": [
    {
      "conflictGroup": "auth-core",
      "issue": 258,
      "branch": "claude/wave6-20260510-090000-issue-258-auth-slice1"
    }
  ]
}
```

### Multiple Active Workers

```json
{
  "markerVersion": 1,
  "capturedAt": "2026-05-11T14:30:00Z",
  "workers": [
    {
      "conflictGroup": "auth-core",
      "issue": 258,
      "branch": "claude/wave6-20260510-090000-issue-258-auth-slice1"
    },
    {
      "conflictGroup": "messages",
      "issue": 310,
      "branch": "claude/wave8-20260511-090000-issue-310-messages"
    },
    {
      "conflictGroup": "schema-active-workers",
      "issue": 462,
      "branch": null
    }
  ]
}
```

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **Launch gate** (`check-launch-gate.ps1`) | `workers[].conflictGroup` | Block tasks whose conflict group matches an active worker. |
| **State reconciler** | `workers`, `capturedAt` | Detect stale workers and projection drift. |
| **Batch launcher** (`batch-launch.ps1`) | Full file | Pass to launch gate before dispatching each batch. |
| **Monitoring** | `capturedAt` | Detect stale projections (no write in > N minutes). |

---

## Schema Versioning

The `markerVersion` field enables forward-compatible evolution:

- **Current version:** `1`
- **Consumers must reject** records with an unrecognized `markerVersion`.
- **New optional fields** may be added without incrementing the version.
- **Removing or renaming fields** or changing required fields requires a version bump.

---

## Validation

The schema uses JSON Schema draft-07. Validate active-workers files against it:

```bash
# Using ajv-cli (if installed)
npx ajv validate -s schemas/active-workers.schema.json -d .github/ai-state/active-workers.json

# Using any draft-07 compatible validator
```

---

## See Also

- [Active Workers State](active-workers-state.md) — Projection semantics and design decisions
- [State Reconciler: Active Workers](state-reconciler-active-workers.md) — Projection drift detection
- [Launch Gate](launch-gate.md) — Running-worker conflict detection
- [Schema Files Guard](schema-files-guard.md) — Schema validation guard
- [#462](https://github.com/taoyu051818-sys/lian-nest-server/issues/462) — This feature
