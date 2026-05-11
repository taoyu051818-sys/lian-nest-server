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

# Skip reconciliation (quick gate check)
./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/issue-148.json -SkipReconcile
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `-TaskFile` | Yes | — | Path to task JSON file (single object or array) |
| `-Repo` | No | `$env:GH_REPO` | GitHub repo in OWNER/NAME format |
| `-HealthFile` | No | `./.github/ai-state/main-health.json` | Path to main health state marker |
| `-Execute` | No | `$false` | Switch from dry-run to execute mode |
| `-SkipReconcile` | No | `$false` | Skip the state-reconciler step |

## Pipeline Steps

```
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
| Main health RED/BLACK | Health marker indicates broken main | Fix main health before continuing |
| Launch gate failure | Task blocked by policy, duplicate conflict group, or shared lock conflict | Resolve conflict or wait for health improvement |
| Execute confirmation | Running with `-Execute` flag | Explicitly confirm worker launch |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Cycle completed (dry-run or all steps passed) |
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

## Future Work

- [ ] Auto-generate task files from GitHub issues with agent labels
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
