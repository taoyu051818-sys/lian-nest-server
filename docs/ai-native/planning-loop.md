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

### Self-Cycle Runner Integration (-PlanFirst)

The self-cycle runner can invoke this planner directly via the `-PlanFirst` switch:

```powershell
# Propose next batch, stop for review
./scripts/ai/run-self-cycle.ps1 -PlanFirst -IssueLabel "agent:codex-action-needed" -Repo owner/name
```

When `-PlanFirst` is set, the runner calls `plan-next-batch.ps1 -Json`, displays the proposed batch with risk/conflict/readiness details, saves the proposal to a temp file, and stops with a human decision point. No workers are launched.

This provides migration matrix awareness and slice readiness filtering that the runner's built-in issue discovery (Step 0) does not include.

## Stale-Row Detection

Route parity matrix rows can become stale when their lifecycle stalls between
statuses. The planner flags these before proposing a batch so operators can
address drift before launching workers.

### Staleness Conditions

A route parity row is considered stale when **any** of the following hold:

| Condition | Detection | Meaning |
|-----------|-----------|---------|
| `impl_pr` set but status still `CONTRACTED` | PR merged, row not advanced | Status drift — worker finished, matrix not updated |
| `test_status` is `PASS` but status < `PARITY_TESTED` | Parity confirmed, status behind | Test results landed, matrix step skipped |
| `status` is `IMPLEMENTED` for > 14 days with no `test_status` change | Timestamp heuristic (manual or script-assessed) | Implementation exists but parity work stalled |
| `status` is `PARITY_TESTED` but `shutdown_ready` is empty | Shutdown gate not evaluated | Ready-for-shutdown row not yet retired |

### Planner Behavior on Stale Rows

1. **Detection pass.** Before prioritization (Step 4), the planner scans
   `route-parity-matrix.md` for stale conditions above.
2. **Emit stale candidates.** Each stale row becomes a synthetic task candidate
   with `taskType: "review"`, `risk: "low"`, and `conflictGroup` matching the
   row's family. The candidate title is prefixed with `[stale-row]`.
3. **Prioritization override.** Stale-row candidates sort **ahead** of normal
   implementation tasks to unblock downstream work.
4. **No auto-mutation.** The planner proposes; it never writes to the matrix.
   The operator or a follow-up script must advance the row.

### Stale-Row Candidate Output Fields

| Field | Value |
|-------|-------|
| `taskType` | `review` |
| `risk` | `low` |
| `actorRole` | `state-reconciler` |
| `allowedFiles` | `docs/migration/route-parity-matrix.md` |
| `validationCommands` | `["node scripts/check-route-parity.js"]` |
| `readiness` | `ready` |
| `readinessNote` | `Stale row detected: <condition>` |

## Handoff Rules: Row → Task → Retire

Route parity rows follow a three-phase lifecycle that the planner and matrix
updater must honor:

### Phase 1: Row → Task Candidate

A row becomes a task candidate when its slice is `CONTRACTED` or later and the
row's `status` is not yet `LEGACY_DISABLED`. The planner maps rows to candidates
by family and slice:

- All rows in the same family and slice share a single conflict group.
- A row with `status: CONTRACTED` and no `impl_pr` produces an **implementation**
  candidate.
- A row with `status: IMPLEMENTED` and `test_status: --` produces a **parity
  test** candidate.
- A stale row (see above) produces a **review** candidate.

### Phase 2: Task Completion → Matrix Update

When a worker PR merges that advances one or more rows:

1. The orchestrator runs `update-migration-matrix.ps1` with the slice and target
   status.
2. The script suggests row-level updates (dry-run by default).
3. The operator applies the suggestions with `-Write` or manually edits.
4. `check-route-parity.js` validates that the Progress Summary counts still
   match.

### Phase 3: Row Retirement

A row is retired when it reaches `LEGACY_DISABLED`. At that point:

- The row is excluded from all future task candidate generation.
- The planner's Step 4 filter removes `LEGACY_DISABLED` rows before
  prioritization.
- The `check-route-parity.js` guard confirms the Progress Summary reflects the
  retirement.

A row must not skip statuses. The matrix updater enforces linear transitions:
`CONTRACTED` → `IMPLEMENTED` → `PARITY_TESTED` → `LEGACY_DISABLED`.

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

## Duplicate Route Detection

Before launching a batch, the planner can check whether two or more open issues
target overlapping routes. This prevents the same route from being worked on in
parallel or in a later batch without coordination.

### How It Works

The `check-duplicate-route-tasks.js` script:

1. Fetches open issues with the configured label via `gh issue list`.
2. Parses each issue's **CONTROL APPENDIX** to extract `allowedFiles` and
   `conflictGroup`.
3. Derives route identifiers from `allowedFiles` patterns (e.g.
   `src/modules/auth/**` → `auth`).
4. Flags a conflict when two issues share the same `conflictGroup` **or** their
   route sets overlap.

### Command

```bash
# Scan default label (agent:codex-action-needed)
node scripts/ai/check-duplicate-route-tasks.js --repo owner/name

# Custom label
node scripts/ai/check-duplicate-route-tasks.js --label my-label --repo owner/name

# JSON output for CI
node scripts/ai/check-duplicate-route-tasks.js --repo owner/name --json

# Show help
node scripts/ai/check-duplicate-route-tasks.js --help
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--label` | No | `agent:codex-action-needed` | GitHub issue label to scan |
| `--repo` | No | `$GH_REPO` | GitHub repo in `OWNER/NAME` format |
| `--json` | No | `false` | Output as JSON |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No duplicates found |
| 1 | Duplicate route conflicts detected |
| 2 | Bad arguments or `gh` CLI failure |

### When to Run

Run **before** `batch-launch.ps1` or `run-self-cycle.ps1` to catch conflicts
early. The script is read-only and safe to run in CI or locally.

```
plan-next-batch.ps1             (propose candidates)
        |
        v
check-duplicate-route-tasks.js  (detect conflicts)  <-- this script
        |
        v
batch-launch.ps1                (launch workers)
```

### Limitations

- Route detection is heuristic: it derives routes from `allowedFiles` path
  segments, not from a route registry.
- Broad patterns like `src/**` are skipped to avoid false positives.
- This is a dry-run detector. It does not block launches automatically.

## References

- [Self-Cycle Runner](self-cycle-runner.md) — orchestrator that consumes planning output
- [Migration Matrix](../migration/migration-matrix.md) — slice status source
- [Batch Launcher](../../scripts/ai/batch-launch.ps1) — worker dispatch
- [Task Schema](../../scripts/ai/task.schema.json) — worker task contract
- [Duplicate Route Detector](../../scripts/ai/check-duplicate-route-tasks.js) — dry-run conflict checker
