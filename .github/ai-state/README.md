# AI State Markers

Machine-readable state files consumed by AI automation (scheduler, launch gate, merge scripts).

## Directory Layout

```
.github/ai-state/
  launch-locks.json  # Currently held launch locks projection
  main-health.json   # Current main branch health state
  README.md          # This file
```

## main-health.json

Written by `scripts/ai/write-main-health-state.ps1` after a post-merge health gate run.

### Schema

```jsonc
{
  "markerVersion": 1,
  "state": "green | yellow | red | black",
  "commitSha": "abc1234...",
  "capturedAt": "2026-05-11T12:00:00Z",
  "checks": ["tsc", "build", "prisma"],
  "failedChecks": [],
  "allowedWorkerClasses": ["all"],
  "reason": "optional human-readable note"
}
```

### States

| State | Meaning | Allowed Worker Classes |
|-------|---------|----------------------|
| `green` | All health checks passed. Main is safe for automated work. | `all` |
| `yellow` | Non-critical failure (e.g. Prisma drift). Fix-only workers may proceed. | `fix-only`, `docs` |
| `red` | Critical failure. Main is blocked for all automated work. | *(none)* |
| `black` | Unrecoverable state. Manual intervention required. | *(none)* |

### Allowed Worker Classes

Worker classes control which automation may target main when health is degraded:

- `all` - Any worker class may proceed.
- `fix-only` - Workers whose task is to fix the failing check.
- `docs` - Documentation-only workers (no runtime impact).
- *(empty)* - No automated work permitted.

### Usage

```powershell
# Preview what would be written (dry-run)
./scripts/ai/write-main-health-state.ps1 -State green -DryRun

# Record green state after successful health gate
./scripts/ai/write-main-health-state.ps1 -State green -Checks "tsc,build,prisma"

# Record yellow state with restricted workers
./scripts/ai/write-main-health-state.ps1 -State yellow `
  -Checks "tsc,build,prisma" -FailedChecks "prisma" `
  -Reason "Prisma schema drift detected"
```

### Downstream Consumers

- **Scheduler/launch gate**: Reads `state` and `allowedWorkerClasses` before dispatching new workers.
- **Self-cycle runner**: Reads the marker at Step 2 to gate the cycle. A `red` or `black` state, or a missing marker, stops the cycle.
- **Merge scripts**: Checks `state` is not `red`/`black` before merging.
- **Monitoring**: Reads `capturedAt` to detect stale markers.

## launch-locks.json

Projection of currently held launch locks. Read by the batch launcher before
dispatching workers to detect conflicts with in-flight tasks.

### Schema

```jsonc
{
  "markerVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "locks": [
    {
      "conflictGroup": "auth-core",
      "writeSet": ["src/auth/auth.service.ts"],
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

### Lock Entry Fields

| Field | Type | Description |
|-------|------|-------------|
| `conflictGroup` | `string` | Conflict group this lock protects. |
| `writeSet` | `string[]` | File paths the worker intends to edit. |
| `sharedLocks` | `string[]` | Shared resource locks claimed (e.g. `app-module`). |
| `ownerTask.issue` | `number` | GitHub issue number. |
| `ownerTask.branch` | `string` | Git worktree branch name. |
| `ownerTask.workerClass` | `string` | Worker classification. |
| `acquiredAt` | `string` | ISO 8601 lock acquisition time. |
| `expiresAt` | `string` | ISO 8601 lock expiry time. |

### Downstream Consumers

- **Batch launcher**: Reads before dispatch to detect conflict group and shared lock overlaps.
- **Launch gate**: Reads to enforce running-worker conflict rules.
- **State reconciler**: Reads to detect stale locks.

See [launch-locks-state.md](../../docs/ai-native/launch-locks-state.md) for the
full specification including stale lock detection and lifecycle.

## Write Workflow

The marker is produced by `write-main-health-state.ps1` after a health gate run:

```
post-merge-health-gate.js --quick
        |
        v
write-main-health-state.ps1 -State <state> -Checks "..."
        |
        v
.github/ai-state/main-health.json
```

The self-cycle runner reads this file at Step 2. See
[main-health-policy.md](../../docs/ai-native/main-health-policy.md) for the
full state detection and recording workflow.

## Design Decisions

- Marker is a single JSON file, not a log. Each write replaces the previous marker.
- No secrets or tokens are stored in marker files.
- `markerVersion` enables schema evolution without breaking consumers.
- `DryRun` is a switch parameter; omitting it writes the file.
- The self-cycle runner and launch gate consume the marker; CI workflow integration is future work.
