# Launch Locks JSON Schema

JSON Schema for the launch locks state projection (`.github/ai-state/launch-locks.json`).
Defines the machine-readable contract for lock entries acquired by active workers.

> **Closes:** [#463](https://github.com/taoyu051818-sys/lian-nest-server/issues/463)

---

## Schema Location

`schemas/launch-locks.schema.json`

---

## Top-Level Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `markerVersion` | Yes | `1` (const) | Schema version. |
| `capturedAt` | Yes | date-time | ISO-8601 timestamp when this projection was last written. |
| `locks` | Yes | array | Currently held locks. Empty array `[]` when no workers are active. |

---

## Lock Entry Fields

Each item in `locks[]` has these fields:

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `conflictGroup` | Yes | string | The conflict group this lock protects. Maps to the task's `conflictGroup`. |
| `writeSet` | Yes | string[] | File paths or glob patterns the worker intends to edit. From `allowedFiles`. |
| `sharedLocks` | No | string[] | Shared resource locks claimed (e.g. `app-module`, `prisma-schema`). |
| `ownerTask` | Yes | object | Identifies the task holding this lock. |
| `acquiredAt` | Yes | date-time | When the lock was acquired (worker dispatch time). |
| `expiresAt` | Yes | date-time | When the lock expires if not released. From `hardTimeMinutes` budget. |

---

## Owner Task Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `issue` | Yes | integer (min 1) | GitHub issue number. |
| `branch` | Yes | string | Git worktree branch name. |
| `workerClass` | Yes | string | Worker classification (e.g. `runtime-feature`, `docs`, `foundation-fix`). |

---

## Validation Rules

- `markerVersion` must be exactly `1`.
- `locks` is always present, even when empty.
- `lockEntry.conflictGroup`, `lockEntry.writeSet`, `lockEntry.ownerTask`, `lockEntry.acquiredAt`, and `lockEntry.expiresAt` are required.
- `lockEntry.ownerTask.issue`, `lockEntry.ownerTask.branch`, and `lockEntry.ownerTask.workerClass` are required.
- All string fields require `minLength: 1` where applicable.
- No additional properties are allowed on any object.

---

## Example: Empty State

```json
{
  "markerVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "locks": []
}
```

---

## Example: Single Lock

```json
{
  "markerVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "locks": [
    {
      "conflictGroup": "auth-core",
      "writeSet": [
        "src/auth/auth.service.ts",
        "src/auth/auth.module.ts"
      ],
      "sharedLocks": ["app-module"],
      "ownerTask": {
        "issue": 258,
        "branch": "claude/wave6-20260510-091500-issue-258",
        "workerClass": "runtime-feature"
      },
      "acquiredAt": "2026-05-11T10:30:00Z",
      "expiresAt": "2026-05-11T11:30:00Z"
    }
  ]
}
```

---

## Example: Multiple Locks

```json
{
  "markerVersion": 1,
  "capturedAt": "2026-05-11T14:00:00Z",
  "locks": [
    {
      "conflictGroup": "auth-core",
      "writeSet": ["src/auth/auth.service.ts"],
      "sharedLocks": [],
      "ownerTask": {
        "issue": 258,
        "branch": "claude/wave6-20260510-091500-issue-258",
        "workerClass": "runtime-feature"
      },
      "acquiredAt": "2026-05-11T13:00:00Z",
      "expiresAt": "2026-05-11T14:30:00Z"
    },
    {
      "conflictGroup": "ai-native-docs",
      "writeSet": ["docs/ai-native/launch-locks-schema.md"],
      "sharedLocks": ["docs-index"],
      "ownerTask": {
        "issue": 463,
        "branch": "claude/wave13-20260511-131640-issue-463",
        "workerClass": "docs"
      },
      "acquiredAt": "2026-05-11T13:16:40Z",
      "expiresAt": "2026-05-11T14:16:40Z"
    }
  ]
}
```

---

## Conflict Detection

The launcher uses lock entries to prevent concurrent edit conflicts:

| Check | Condition | Result |
|-------|-----------|--------|
| Conflict group overlap | Pending task's `conflictGroup` matches a held lock | BLOCK |
| Shared lock overlap | Pending task's `sharedLocks` intersects a held lock's `sharedLocks` | BLOCK |
| Write set overlap | Pending task's `allowedFiles` intersects a held lock's `writeSet` | WARN (soft check) |

---

## Downstream Consumers

| Consumer | Usage |
|----------|-------|
| `batch-launch.ps1` | Reads before dispatch, writes on acquire/release |
| `check-launch-gate.ps1` | Reads to detect running-worker conflicts |
| `state-reconciler.ps1` | Reads to detect stale locks and drift |
| `worktree-janitor.ps1` | Reads to classify worktrees as locked |

---

## Validation

The schema uses JSON Schema draft-07. Validate launch-locks files against it:

```bash
# Using ajv-cli (if installed)
npx ajv validate -s schemas/launch-locks.schema.json -d .github/ai-state/launch-locks.json

# Using any draft-07 compatible validator
```

---

## See Also

- [Launch Locks State](launch-locks-state.md) — Full spec including lifecycle, stale detection, and design decisions
- [Launch Gate](launch-gate.md) — Pre-launch validation that consumes this projection
- [Parallel Work Policy](parallel-work-policy.md) — Conflict group and shared lock definitions
- [AI-State Files Guard](ai-state-files-guard.md) — Guard that validates this file
- [Schema Files Guard](schema-files-guard.md) — Guard that validates schema files
- [#463](https://github.com/taoyu051818-sys/lian-nest-server/issues/463) — This feature
