# Self-Cycle Runner

Top-level dry-run orchestrator that chains the self-hosted loop pieces into a single command.

## Purpose

Instead of manually calling each script (state-reconciler, health writer, launch gate, batch launcher), the self-cycle runner executes them in sequence with built-in human decision stop points.

## Command

```powershell
# Dry-run (default) — prints every step, makes no changes
./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/issue-148.json

# Execute mode — launches worker after human confirmation gate
./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/issue-148.json -Execute

# Discover issues by label and compile to task JSON (dry-run stops for review)
./scripts/ai/run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name

# Skip reconciliation (quick gate check)
./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/issue-148.json -SkipReconcile
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `-TaskFile` | Yes* | — | Path to task JSON file (single object or array). Mutually exclusive with `-IssueLabel`. |
| `-IssueLabel` | Yes* | — | GitHub issue label for discovery. The runner fetches open issues, compiles them to task JSON, and (in execute mode) feeds them into the pipeline. Mutually exclusive with `-TaskFile`. |
| `-Repo` | No | `$env:GH_REPO` | GitHub repo in OWNER/NAME format. Required when using `-IssueLabel`. |
| `-HealthFile` | No | `./.github/ai-state/main-health.json` | Path to main health state marker |
| `-Execute` | No | `$false` | Switch from dry-run to execute mode |
| `-SkipReconcile` | No | `$false` | Skip the state-reconciler step |

*One of `-TaskFile` or `-IssueLabel` is required.

## Pipeline Steps

```
Step 0: Issue Discovery (only with -IssueLabel)
    Discover open issues by label via gh issue list
    Extract CONTROL APPENDIX metadata from issue bodies
    Compile each issue into a task JSON contract
    Save compiled tasks to temp file
    Dry-run: Print contracts, exit for human review
    Execute: Feed compiled task file into Steps 1-5

        |
        v

Step 1: State Reconciler
    Detect drift across issues/PRs (stale-running, done-without-merge, etc.)
    Script: state-reconciler.ps1
    Output: Drift report (informational)

        |
        v

Step 2: Main Health State
    Read the main health marker (green/yellow/red/black)
    Source: .github/ai-state/main-health.json (written by write-main-health-state.ps1)
    Human stop: RED or BLACK blocks the cycle, missing marker blocks the cycle

        |
        v

Step 3: Launch Gate
    Validate task(s) against health policy, conflict groups, shared locks
    Script: check-launch-gate.ps1
    Human stop: Any blocked task stops the cycle

        |
        v

Step 4: Batch Launch
    Dry-run: Print launch plan
    Execute: Human confirmation gate, then batch-launch.ps1
    Script: batch-launch.ps1
    Human stop: Execute mode always requires explicit confirmation

        |
        v

Step 5: Cycle Summary
    Print step-by-step results table
    Recommend next human action
```

## Health Marker Workflow

The self-cycle runner depends on `.github/ai-state/main-health.json` existing
before Step 2. The marker is NOT written by the runner itself — it must be
produced beforehand:

```
post-merge-health-gate.js --quick
        |
        v
write-main-health-state.ps1 -State <state> -Checks "..."
        |
        v
.github/ai-state/main-health.json   ◄── runner reads this at Step 2
```

**Typical sequence:**

1. A PR merges into main.
2. The health gate runs (`post-merge-health-gate.js --quick`).
3. The writer records the result (`write-main-health-state.ps1`).
4. The self-cycle runner starts and reads the marker at Step 2.

If the marker file is missing, the runner stops with an error. The operator
must run the health gate and writer before starting a cycle.

See [main-health-policy.md](main-health-policy.md) for the full write workflow
and [ai-state/README.md](../../.github/ai-state/README.md) for the marker schema.

## Human Decision Stop Points

The runner stops and surfaces a decision to the operator in these cases:

| Stop Point | Condition | Required Action |
|------------|-----------|-----------------|
| No repo specified | `-Repo` not set and `GH_REPO` unset | Pass `-Repo` or set env var |
| Issue discovery review | `-IssueLabel` in dry-run mode | Review compiled task contracts, re-run with `-TaskFile` and `-Execute` |
| No issues found | Label matches zero open issues | Verify label name, check issue state |
| Main health RED/BLACK | Health marker indicates broken main | Fix main health before continuing |
| Launch gate failure | Task blocked by policy, duplicate conflict group, or shared lock conflict | Resolve conflict or wait for health improvement |
| Execute confirmation | Running with `-Execute` flag | Explicitly confirm worker launch |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Cycle completed (dry-run, discovery-complete, or all steps passed) |
| 1 | Cycle blocked by health state or launch gate |
| 2 | Cycle errored (missing file, script failure) |

## Output

The runner produces:

1. **Console output** — color-coded step-by-step progress with human decision callouts.
2. **Markdown report** — embeddable with `<!-- ai-self-cycle:report:begin/end -->` markers for posting to issues or PRs.

## Relationship to Existing Scripts

The runner does NOT replace any existing script. It calls them in sequence:

| Existing Script | Role in Cycle |
|-----------------|---------------|
| `state-reconciler.ps1` | Step 1: Drift detection |
| `write-main-health-state.ps1` | Pre-cycle: Write the marker (called after health gate, before cycle). Step 2 reads the resulting JSON file. |
| `check-launch-gate.ps1` | Step 3: Task validation (reads the same marker) |
| `batch-launch.ps1` | Step 4: Worker dispatch |

## Design Constraints

- **Dry-run by default** — nothing changes unless `-Execute` is passed.
- **No autonomous planning** — the runner accepts an explicit task file; it does not generate or discover tasks.
- **No runtime changes** — the runner only orchestrates existing scripts.
- **Skeleton mode** — in execute mode the runner still requires human re-confirmation before launching. This is the primary safety gate.
- **Idempotent** — running the same cycle twice produces the same result.

## Issue Discovery & Task Compilation Handoff

When `-IssueLabel` is provided, the runner automates the first-mile handoff from GitHub issues to the task pipeline:

1. **Discovery**: `gh issue list --label <label> --state open` fetches matching issues.
2. **Metadata extraction**: The runner parses each issue body for CONTROL APPENDIX fields (taskType, risk, conflictGroup, allowedFiles, validationCommands, rolePacket).
3. **Fallback defaults**: Missing fields use conservative defaults (`taskType=execution`, `risk=medium`, `allowedFiles=["docs/**"]`).
4. **Compilation**: Each issue becomes a task JSON contract conforming to the worker task schema.
5. **Review gate**: In dry-run mode, the runner prints compiled contracts and exits. The operator reviews and re-runs with `-TaskFile <file> -Execute`.

### CONTROL APPENDIX Format

Issues should include these fields in their body for best results:

```
Task type: execution
Risk: medium
Conflict group: ai-self-cycle
Allowed files:
- scripts/ai/run-self-cycle.ps1
Forbidden files:
- src/**
Validation commands:
- npm run check
Actor role: automation-cycle-worker
```

When these fields are absent, the runner uses safe defaults and logs a warning.

## Future Work

- [x] Auto-generate task files from GitHub issues with agent labels (`-IssueLabel`)
- [ ] Parallel launch with conflict group awareness
- [ ] Post-cycle result publishing to issues/PRs
- [ ] Integration with merge queue assistant for end-to-end close
- [ ] Retry/continue from a specific step

## References

- [Orchestration](orchestration.md) — batch launcher overview
- [Launch Gate](launch-gate.md) — health policy matrix
- [State Reconciler](state-reconciler.md) — drift detection rules
- [Main Health Policy](main-health-policy.md) — health state definitions and writer workflow
- [write-main-health-state.ps1](../../scripts/ai/write-main-health-state.ps1) — Health marker writer
- [ai-state/README.md](../../.github/ai-state/README.md) — Marker schema and downstream consumers
