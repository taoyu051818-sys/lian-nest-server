# Migration Matrix Updater

Suggests matrix row updates from PR metadata or CLI args without mutating by
default. Script: `scripts/ai/update-migration-matrix.ps1`.

## Overview

After a migration PR merges, the orchestrator runs this script to suggest
status advances. The script supports two modes:

- **Endpoint mode** (default) — targets `legacy-shutdown-matrix.md`, updates
  per-endpoint rows matched by HTTP method and path.
- **Slice mode** (`-SliceMatrix`) — targets `migration-matrix.md`, updates
  slice-level status rows in the execution phase tables.

Dry-run is the default mode — no markdown files are modified.

## Status Progression

Linear, one-step only: `CONTRACTED` -> `IMPLEMENTED` -> `PARITY_TESTED` -> `LEGACY_DISABLED`

`NOT_STARTED` is not a valid target — endpoints must be `CONTRACTED` first
via the migration queue assignment process. When advancing to `PARITY_TESTED`
or `LEGACY_DISABLED`, the shutdown blocker is cleared automatically.

## Usage

### Endpoint mode (legacy-shutdown-matrix)

```powershell
# Dry-run suggestion
./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED

# With custom blocker
./scripts/ai/update-migration-matrix.ps1 -Slice P1 -TargetStatus IMPLEMENTED -ShutdownBlocker "Tests pending"

# Apply (print replacement rows)
./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED -Apply

# Write (modify file)
./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED -Write
```

### Slice mode (migration-matrix)

```powershell
# Dry-run suggestion for slice-level status
./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED -SliceMatrix

# Write slice status
./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED -SliceMatrix -Write
```

In slice mode, the script parses execution phase tables (Phase 1–3) in
`docs/migration/migration-matrix.md` and updates the Status column for
matching slice rows.

### PR metadata mode

```powershell
./scripts/ai/update-migration-matrix.ps1 -PrMetaPath ./pr-meta.json
```

JSON format:

```json
{
  "slice": "A3",
  "targetStatus": "IMPLEMENTED",
  "shutdownBlocker": "...",
  "matrixType": "slice"
}
```

When `matrixType` is `"slice"`, the script automatically targets
`migration-matrix.md` in slice mode.

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
2. **Orchestrator** runs `update-migration-matrix.ps1` with `-SliceMatrix` and target status.
3. **Script** suggests slice-level status updates in `migration-matrix.md`.
4. **Orchestrator** re-runs without `-SliceMatrix` for endpoint-level updates in `legacy-shutdown-matrix.md`.
5. **Repo-owner** reviews and commits suggested changes (or uses `-Write`).
6. **State reconciler** can verify matrix/issue consistency.

## See Also

- [Migration Matrix](../migration/migration-matrix.md)
- [Legacy Shutdown Matrix](../migration/legacy-shutdown-matrix.md)
- [Route Parity Tracker](../migration/route-parity-tracker.md)
- [State Reconciler](state-reconciler.md)
- [Orchestration](orchestration.md)
- [#131](https://github.com/nicholasxsxs/lian-nest-server/issues/131)
- [#169](https://github.com/nicholasxsxs/lian-nest-server/issues/169)
