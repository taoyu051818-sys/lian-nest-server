# AI State Markers

Machine-readable state files consumed by AI automation (scheduler, launch gate, merge scripts).

## Directory Layout

```
.github/ai-state/
  main-health.json   # Current main branch health state
  provider-pool.json # API provider pool availability state (no secrets)
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
