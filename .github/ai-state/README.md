# AI State Markers

Machine-readable state files consumed by AI automation (scheduler, launch gate, merge scripts).

## Directory Layout

```
.github/ai-state/
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
- **Merge scripts**: Checks `state` is not `red`/`black` before merging.
- **Monitoring**: Reads `capturedAt` to detect stale markers.

## Design Decisions

- Marker is a single JSON file, not a log. Each write replaces the previous marker.
- No secrets or tokens are stored in marker files.
- `markerVersion` enables schema evolution without breaking consumers.
- `DryRun` is a switch parameter; omitting it writes the file.
- CI integration is not wired yet (future work).
