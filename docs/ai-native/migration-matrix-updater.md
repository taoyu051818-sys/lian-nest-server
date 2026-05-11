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

# Idempotent check (exit 0 if already at target)
./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED -Idempotent
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

## Idempotency

Repeated self-cycle runs are safe by design. The updater never duplicates rows
or re-applies transitions that are already complete.

### How It Works

1. **Skip-at-target.** When a row already matches `$TargetStatus`, the updater
   skips it and reports it as `[SKIP]` rather than emitting a duplicate
   suggestion. This applies to both endpoint mode and slice mode.
2. **No-op detection.** If all matched rows are already at the target status,
   the updater reports "All matched rows already at target status. No-op
   (idempotent)." and exits cleanly.
3. **`-Idempotent` flag.** Pass this flag to assert that the run should be a
   pure no-op. If any rows still need updating, the flag has no effect. If all
   rows are already at target, the script exits 0 immediately — useful in CI
   to confirm a prior run already applied changes.

### Self-Cycle Usage

During automated self-cycle orchestration, always pass `-Idempotent` on
re-runs to guarantee no duplicate mutations:

```powershell
# First run: applies updates
./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED -SliceMatrix -Write

# Re-run: safe, reports skip, exits 0
./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED -SliceMatrix -Idempotent
```

### Markdown Report Markers

The updater wraps its markdown report in markers:

```
<!-- ai-migration-matrix-updater:begin -->
... report table ...
<!-- ai-migration-matrix-updater:end -->
```

When posting to GitHub comments, replace the previous marker block rather than
appending. This prevents duplicate report tables from accumulating across
multiple self-cycle runs.

### Verification

To verify the matrix is in the expected state after a run, use the route
parity guard:

```bash
node scripts/check-route-parity.js
```

This catches any drift between the matrix rows and the Progress Summary.

## Integration

1. **Worker PR merges** — migration slice implementation complete.
2. **Orchestrator** runs `update-migration-matrix.ps1` with `-SliceMatrix` and target status.
3. **Script** suggests slice-level status updates in `migration-matrix.md`.
4. **Orchestrator** re-runs without `-SliceMatrix` for endpoint-level updates in `legacy-shutdown-matrix.md`.
5. **Repo-owner** reviews and commits suggested changes (or uses `-Write`).
6. **State reconciler** can verify matrix/issue consistency.

## Route Parity Matrix Guard

After any matrix update, run the guard script to verify Progress Summary counts
match the actual matrix rows:

```bash
node scripts/check-route-parity.js
```

The guard parses every family endpoint table in `route-parity-matrix.md`, counts
statuses, and compares against the Progress Summary section. Mismatches cause a
non-zero exit, preventing stale summary counts from landing on `main`.

Use this in CI or as a local pre-commit check to catch drift early.

## Stale-Row Guard

When the matrix updater suggests status advances, it should also flag stale
route parity rows — rows whose lifecycle has stalled between statuses.

### Detection Conditions

The guard checks for these conditions against `route-parity-matrix.md`:

| Condition | Meaning |
|-----------|---------|
| `impl_pr` set but status still `CONTRACTED` | PR merged, row not advanced |
| `test_status` is `PASS` but status < `PARITY_TESTED` | Parity confirmed, status behind |
| `status` is `PARITY_TESTED` but `shutdown_ready` is empty | Shutdown gate not evaluated |

### Handoff to Planner

When stale rows are detected:

1. The updater emits a warning table in its markdown report.
2. The warning includes row identifiers (endpoint, family, slice) so the
   planning loop can emit `[stale-row]` review candidates.
3. The updater **does not** auto-advance stale rows — it only surfaces them.

### Integration with Planning Loop

The stale-row guard runs between the updater's matrix suggestion step and the
planner's prioritization step:

```
update-migration-matrix.ps1 -SliceMatrix    (suggest status advances)
        |
        v
stale-row detection                         (flag stalled rows)
        |
        v
plan-next-batch.ps1                         (emit stale-row candidates)
```

This ensures stale rows surface as high-priority review tasks before new
implementation work is dispatched.

## See Also

- [Migration Matrix](../migration/migration-matrix.md)
- [Legacy Shutdown Matrix](../migration/legacy-shutdown-matrix.md)
- [Route Parity Tracker](../migration/route-parity-tracker.md)
- [Route Parity Matrix](../migration/route-parity-matrix.md)
- [State Reconciler](state-reconciler.md)
- [Orchestration](orchestration.md)
- [#131](https://github.com/nicholasxsxs/lian-nest-server/issues/131)
- [#169](https://github.com/nicholasxsxs/lian-nest-server/issues/169)
