# Planning Loop

Dry-run planner that proposes the next worker batch from open issues and migration matrices.

## Purpose

Before launching workers, the planning loop scans labeled GitHub issues, parses their CONTROL APPENDIX metadata, cross-references the migration matrix for slice readiness, and outputs a prioritized batch plan with conflict groups and risk.

This script **never launches workers**. It is a read-only planning tool.

## Command

```powershell
# Propose next batch (default label: agent:codex-action-needed)
./scripts/ai/plan-next-batch.ps1 -Repo owner/name

# Explicit label
./scripts/ai/plan-next-batch.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name

# JSON output for CI consumption
./scripts/ai/plan-next-batch.ps1 -Repo owner/name -Json

# Show help
./scripts/ai/plan-next-batch.ps1 -Help
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `-IssueLabel` | No | `agent:codex-action-needed` | GitHub issue label to discover open issues |
| `-Repo` | No | `$env:GH_REPO` | GitHub repo in OWNER/NAME format |
| `-MatrixPath` | No | `docs/migration/migration-matrix.md` | Path to migration matrix |
| `-MaxTasks` | No | `5` | Maximum tasks in proposed batch |
| `-Json` | No | `$false` | Output as JSON instead of console text |
| `-Help` | No | — | Show usage examples and exit |

## Pipeline

```
Step 1: Issue Discovery
    gh issue list --label <label> --state open
    Fetch open issues with CONTROL APPENDIX metadata

        |
        v

Step 2: Migration Matrix Context
    Read slice statuses from migration-matrix.md
    Map slice IDs to current status (CONTRACTED, IMPLEMENTED, etc.)

        |
        v

Step 3: Metadata Extraction
    Parse CONTROL APPENDIX from each issue body:
    - taskType, risk, conflictGroup, allowedFiles
    - validationCommands, actorRole, slice reference

        |
        v

Step 4: Prioritization
    Filter out completed slices (LEGACY_DISABLED)
    Sort: ready first, then blocked; within each group, lower risk first
    Apply MaxTasks limit

        |
        v

Step 5: Conflict Detection
    Detect conflictGroup collisions in proposed batch
    Warn when multiple tasks share a group

        |
        v

Step 6: Output
    Console: color-coded plan with risk, conflict groups, readiness
    JSON: structured plan for CI or downstream scripts
```

## Output Fields

Each proposed candidate includes:

| Field | Description |
|-------|-------------|
| `issueNumber` | GitHub issue number |
| `title` | Issue title |
| `taskType` | execution, research, or review |
| `risk` | low, medium, or high |
| `conflictGroup` | Group name for concurrency control |
| `actorRole` | Worker role assignment |
| `allowedFiles` | File patterns the worker may edit |
| `forbiddenFiles` | File patterns the worker must not edit |
| `validationCommands` | Commands to run before PR |
| `sliceRef` | Migration matrix slice ID (if detected) |
| `sliceStatus` | Current slice status from matrix |
| `readiness` | ready, blocked, or done |
| `readinessNote` | Human-readable readiness explanation |

## Readiness Logic

| Slice Status | Readiness | Meaning |
|--------------|-----------|---------|
| `CONTRACTED` | ready | Slice defined, ready for implementation |
| `IMPLEMENTED` | ready | Implementation exists, can proceed |
| `PARITY_TESTED` | ready | Parity verified, can proceed to shutdown |
| `NOT_STARTED` | blocked | Slice not yet defined |
| `LEGACY_DISABLED` | done | Slice complete, skip |

When no slice reference is detected, readiness defaults to `ready`.

## Integration with Other Scripts

```
plan-next-batch.ps1          (this script — read-only planning)
        |
        v
run-self-cycle.ps1           (orchestrator — chains reconciler, gate, launch)
        |
        v
batch-launch.ps1             (worker dispatch)
```

The planning loop is the first step in the batch workflow:

1. **Plan** — `plan-next-batch.ps1` proposes candidates
2. **Review** — Operator reviews proposed batch
3. **Execute** — `run-self-cycle.ps1` or `batch-launch.ps1` launches workers

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Plan produced (or no issues found) |
| 1 | Fatal error (missing repo, gh failure) |

## Examples

### Typical workflow

```powershell
# 1. Propose next batch (default label)
./scripts/ai/plan-next-batch.ps1 -Repo owner/name

# 2. Review proposed batch output

# 3. Launch via self-cycle runner
./scripts/ai/run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name
```

### CI integration

```powershell
# JSON output for pipeline consumption (default label)
$plan = ./scripts/ai/plan-next-batch.ps1 -Repo owner/name -Json | ConvertFrom-Json

# Check if any tasks are ready
$ready = @($plan.candidates | Where-Object { $_.readiness -eq "ready" })
if ($ready.Count -gt 0) {
    Write-Host "$($ready.Count) task(s) ready for batch"
}
```

## References

- [Self-Cycle Runner](self-cycle-runner.md) — orchestrator that consumes planning output
- [Migration Matrix](../migration/migration-matrix.md) — slice status source
- [Batch Launcher](../../scripts/ai/batch-launch.ps1) — worker dispatch
- [Task Schema](../../scripts/ai/task.schema.json) — worker task contract
