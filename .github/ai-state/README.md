# AI State Markers

Machine-readable state files consumed by AI automation (scheduler, launch gate, merge scripts).

## Directory Layout

```
.github/ai-state/
  launch-locks.json  # Currently held launch locks projection
  main-health.json   # Current main branch health state
  provider-pool.json # API provider pool availability state (no secrets)
  worker-trust.json  # Worker trust state projection seed
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

## provider-pool.json

Sanitized projection of API provider pool availability. Written by
`scripts/ai/update-provider-state.ps1` when quota events occur.

### Schema

```jsonc
{
  "stateVersion": 1,
  "providers": [
    {
      "id": "provider-default",
      "status": "available | exhausted | disabled",
      "currentConcurrency": 0,
      "maxConcurrency": 1,
      "lastHealthCheckAt": "ISO-8601 | null",
      "lastFailureClass": "exhaustion | auth | runtime | null",
      "cooldownExpiresAt": "ISO-8601 | null",
      "consecutiveFailures": 0,
      "totalQuotaEvents": 0
    }
  ],
  "global": {
    "totalActiveWorkers": 0,
    "globalMaxWorkers": 3,
    "availableProviders": 1,
    "exhaustedProviders": 0,
    "disabledProviders": 0,
    "lastUpdatedBy": "string",
    "capturedAt": "ISO-8601"
  }
}
```

### Provider Statuses

| Status | Meaning |
|--------|---------|
| `available` | Provider has capacity and no active cooldown. |
| `exhausted` | Quota or rate limit hit. Cooling down; will auto-recover after `cooldownExpiresAt`. |
| `disabled` | Auth failure or manual disable. Requires intervention; no auto-recovery. |

### Downstream Consumers

- **Launch gate**: Reads `providers[].status` and `global` to determine if workers can be dispatched.
- **Worker launcher**: Assigns a provider id to the worker via `LIAN_PROVIDER_ID` env var.
- **State reconciler**: Reads `lastFailureClass` to distinguish exhaustion from runtime failures.

### Design

- No secrets in this file — provider ids are opaque labels, not keys.
- `stateVersion` enables schema evolution.
- Each write replaces the entire file (idempotent snapshot, not append-only log).
- See [provider-pool.md](../../docs/ai-native/provider-pool.md) for the full architecture.

## Design Decisions

- Marker is a single JSON file, not a log. Each write replaces the previous marker.
- No secrets or tokens are stored in marker files.
- `markerVersion` enables schema evolution without breaking consumers.
- `DryRun` is a switch parameter; omitting it writes the file.
- The self-cycle runner and launch gate consume the marker; CI workflow integration is future work.

## worker-trust.json

Defines per-worker-class trust defaults and scheduling implications for the orchestrator. Read by the launcher before dispatching workers.

### Schema

```jsonc
{
  "markerVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "workerClasses": {
    "<class-name>": {
      "defaultTrustScore": 0.0-1.0,
      "allowedHealthStates": ["green", "yellow", "red", "black"],
      "riskTier": "low | medium | high",
      "layer": "contract-planning | runtime-foundation | health-diagnostic | feature-repository | review-audit | merge-release",
      "note": "Human-readable rationale"
    }
  },
  "trustScore": {
    "inputs": [
      {
        "name": "input-name",
        "type": "enum | float | integer",
        "weight": 0.0-1.0,
        "description": "What this input measures"
      }
    ],
    "formula": "weightedSum(inputs) clamped to [0.0, 1.0]"
  },
  "scheduling": {
    "minTrustToLaunch": 0.3,
    "highTrustThreshold": 0.7,
    "rules": [
      {
        "condition": "trustScore expression",
        "action": "block_launch | launch_with_monitoring | launch_standard",
        "description": "What happens"
      }
    ]
  }
}
```

### Worker Classes

| Class | Default Trust | Risk | Layer |
|-------|:-------------:|:----:|-------|
| `runtime-feature` | 0.5 | high | feature-repository |
| `foundation-fix` | 0.8 | medium | runtime-foundation |
| `docs-contract` | 0.9 | low | contract-planning |
| `health-gate` | 0.9 | low | health-diagnostic |
| `test-only` | 0.7 | medium | feature-repository |
| `refactor` | 0.4 | high | feature-repository |
| `review-audit` | 0.85 | low | review-audit |
| `merge-release` | 0.6 | high | merge-release |

### Scheduling Rules

| Trust Score | Action |
|:-----------:|--------|
| < 0.3 | Block launch |
| 0.3 – 0.7 | Launch with monitoring |
| >= 0.7 | Standard launch |

### Downstream Consumers

- **Orchestrator/launcher**: Reads `workerClasses` and `scheduling` to determine dispatch policy.
- **Launch gate**: Checks `allowedHealthStates` as a hard prerequisite.
- **State reconciler**: Provides `historicalSuccessRate` input.

### See Also

- [worker-trust.md](../../docs/ai-native/worker-trust.md) — Full documentation
- [main-health-policy.md](../../docs/ai-native/main-health-policy.md) — Health state definitions
