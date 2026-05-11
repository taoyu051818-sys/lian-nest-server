# Migration Matrix Updater

Suggests legacy-shutdown-matrix.md row updates from PR metadata or CLI args
without mutating by default. Script: `scripts/ai/update-migration-matrix.ps1`.

## Overview

After a migration PR merges, the orchestrator runs this script to suggest
status advances for endpoints belonging to a given slice. Dry-run is the
default mode — no markdown files are modified.

## Status Progression

Linear, one-step only: `CONTRACTED` -> `IMPLEMENTED` -> `PARITY_TESTED` -> `LEGACY_DISABLED`

`NOT_STARTED` is not a valid target — endpoints must be `CONTRACTED` first
via the migration queue assignment process. When advancing to `PARITY_TESTED`
or `LEGACY_DISABLED`, the shutdown blocker is cleared automatically.

## Usage

### CLI suggestion mode (recommended)

```powershell
./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED
./scripts/ai/update-migration-matrix.ps1 -Slice P1 -TargetStatus IMPLEMENTED -ShutdownBlocker "Tests pending"
```

### PR metadata mode

```powershell
./scripts/ai/update-migration-matrix.ps1 -PrMetaPath ./pr-meta.json
```

JSON format: `{ "slice": "A3", "targetStatus": "IMPLEMENTED", "shutdownBlocker": "..." }`

### Print replacement rows

```powershell
./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED -Apply
```

### Write mode (explicit opt-in)

```powershell
./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED -Write
```

## Output

1. **Console report** — valid and invalid transitions with details
2. **Markdown report** — wrapped in idempotency markers for GitHub comments

```
<!-- ai-migration-matrix-updater:begin -->
... report table ...
<!-- ai-migration-matrix-updater:end -->
```

## Design Constraints

- **Dry-run default.** Never writes files unless `-Write` is passed.
- **Linear transitions only.** Skipping statuses is rejected.
- **CLI suggestion mode first.** Targets specific slices, not full matrix rewrites (straggler-safe).
- **No runtime changes.** Only touches `docs/migration/` markdown files.
- **Idempotent output.** Markdown markers allow re-posting without duplicates.

## Integration

1. **Worker PR merges** — migration slice implementation complete.
2. **Orchestrator** runs `update-migration-matrix.ps1` with slice and target status.
3. **Script** suggests matrix row updates.
4. **Repo-owner** reviews and commits suggested changes (or uses `-Write`).
5. **State reconciler** can verify matrix/issue consistency.

## See Also

- [Legacy Shutdown Matrix](../migration/legacy-shutdown-matrix.md)
- [Route Parity Tracker](../migration/route-parity-tracker.md)
- [State Reconciler](state-reconciler.md)
- [Orchestration](orchestration.md)
- [#131](https://github.com/nicholasxsxs/lian-nest-server/issues/131)
