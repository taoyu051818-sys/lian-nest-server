# Self-Cycle Autopilot Plan Mode

Non-stop dry-run planning that chains all self-cycle steps without human review gates.

> **Closes:** [#593](https://github.com/taoyu051818-sys/lian-nest-server/issues/593)
>
> **Cross-references:**
> [self-cycle-runner.md](self-cycle-runner.md) for the standard orchestrator,
> [loop-model.md](loop-model.md) for the loop model,
> [planning-loop.md](planning-loop.md) for the batch planner,
> [codex-retirement-runbook.md](codex-retirement-runbook.md) for exit criteria.

---

## Purpose

The standard self-cycle runner (`run-self-cycle.ps1`) stops at every human decision gate — plan-first review, dry-run discovery review, health blocks, provider pool blocks, and launch gate failures. This is safe but requires an operator to babysit each step.

**Autopilot plan mode** removes the intermediate human stops and chains all dry-run steps into a single non-stop pass. It produces a comprehensive plan showing what would happen if `-Execute` were passed, without ever launching workers.

### Use Cases

| Scenario | Why Autoplan Plan |
|----------|-------------------|
| CI pipeline batch planning | Run unattended, produce a plan artifact for review |
| Morning batch assessment | Check what's ready without manually stepping through gates |
| Pre-launch validation | Verify all gates pass before committing to a launch |
| Loop model automation | Feed plan output into the next-wave decision loop |

---

## Command

```powershell
# Autopilot plan mode — non-stop dry-run through all steps
./scripts/ai/run-self-cycle.ps1 -AutopilotPlan -IssueLabel "agent:codex-action-needed" -Repo owner/name

# With plan-first (migration matrix awareness, then full pipeline)
./scripts/ai/run-self-cycle.ps1 -AutopilotPlan -PlanFirst -IssueLabel "agent:codex-action-needed" -Repo owner/name
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `-AutopilotPlan` | Yes | `$false` | Enable autopilot plan mode. Chains all dry-run steps without human stops. Always dry-run (never launches workers). |
| `-IssueLabel` | Yes | — | GitHub issue label for discovery. Required when using `-AutopilotPlan`. |
| `-Repo` | Yes | `$env:GH_REPO` | GitHub repo in OWNER/NAME format. Required when using `-AutopilotPlan`. |
| `-PlanFirst` | No | `$false` | Run `plan-next-batch.ps1` first (adds migration matrix awareness), then continue through the full pipeline without stopping. |
| `-MaxTasks` | No | `10` | Maximum tasks per cycle. Safety cap. |
| `-HealthFile` | No | `./.github/ai-state/main-health.json` | Path to main health state marker. |
| `-SkipReconcile` | No | `$false` | Skip the state-reconciler step. |

---

## How It Works

### Pipeline Flow

```
Step 0: Plan-First Proposal (if -PlanFirst)
    Run plan-next-batch.ps1 -Json
    Capture proposal — NO human stop, continue to Step 0a

        |
        v

Step 0a: Issue Discovery & Task Compilation
    Discover issues by label, compile to task JSON
    Capture compiled tasks — NO human stop, continue to Step 1

        |
        v

Step 1: State Reconciler
    Detect drift across issues/PRs

        |
        v

Step 2: Main Health State
    Read health marker (green/yellow/red/black)
    If red/black: WARN but continue (does not exit)

        |
        v

Step 2.5: Provider Pool Preflight
    Check provider availability and capacity
    If all exhausted/at-capacity: WARN but continue (does not exit)

        |
        v

Step 3: Launch Gate
    Validate tasks against health + conflict policy
    If blocked: WARN but continue (does not exit)

        |
        v

Step 4: Batch Launch (dry-run)
    Generate launch plan (dry-run only)

        |
        v

Step 5: Summary + Autopilot Plan Summary
    Print step-by-step results table
    Print autopilot plan summary with next actions
```

### Key Differences from Standard Mode

| Behavior | Standard Mode | Autopilot Plan Mode |
|----------|---------------|---------------------|
| Plan-first review | Stops for human review | Continues through pipeline |
| Discovery review (dry-run) | Stops, prints contracts, exits | Continues through pipeline |
| Health red/black | Blocks, exits with code 1 | Warns, continues, records blocked |
| Provider pool exhausted | Blocks, exits with code 1 | Warns, continues, records blocked |
| Launch gate failure | Blocks, exits with code 1 | Warns, continues, records blocked |
| Execute mode | Requires human confirmation | Not allowed (always dry-run) |
| Final output | Step table + next action | Step table + autopilot plan summary |

### Safety Invariants

1. **Always dry-run.** `-AutopilotPlan` forces `$Execute = $false` regardless of what the caller passes. Workers are never launched.
2. **Hard safety limits still apply.** Max-task breach is a hard failure (exit code 1) even in autopilot mode — this prevents runaway batch sizes.
3. **Missing inputs fail fast.** If `-IssueLabel` or `-Repo` are missing, the script exits immediately with code 2.
4. **No autonomous merge.** The autopilot plan mode never merges PRs or makes merge decisions. That remains human-owned per the [codex-retirement-runbook](codex-retirement-runbook.md#human-owned-decisions).
5. **No seed constitution bypass.** The autopilot plan mode does not bypass seed constitution or human-required high-risk boundaries.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Autopilot plan completed (ready, warnings, or blocked) |
| 1 | Hard safety limit breached (max-task overflow) |
| 2 | Fatal error (missing inputs, script failure) |

---

## Final Status Values

| Status | Color | Meaning |
|--------|-------|---------|
| `autopilot-plan-ready` | Green | All checks passed. Ready to execute. |
| `autopilot-plan-warnings` | Yellow | Completed with warnings. Review before executing. |
| `autopilot-plan-blocked` | Red | One or more steps blocked. Fix before executing. |

---

## Output

### Console Output

The runner produces color-coded step-by-step progress, followed by an autopilot plan summary:

```
==========================================================
  AUTOPILOT PLAN SUMMARY
==========================================================

  Status: ALL CHECKS PASSED

  If you run with -Execute, the following would happen:
    1. Task contracts would be compiled from discovered issues
    2. State reconciliation would run
    3. Health gate would be checked
    4. Provider pool preflight would run
    5. Launch gate would validate tasks
    6. Workers would be dispatched via batch-launch.ps1

  To execute:
    ./scripts/ai/run-self-cycle.ps1 -TaskFile <file> -Execute

==========================================================
```

### Markdown Report

The runner produces a markdown report with `<!-- ai-self-cycle:report:begin/end -->` markers, embeddable in issues or PRs.

### Task File

The compiled task file is saved to a temp directory (`self-cycle-discovered-tasks.json`). The autopilot plan summary includes the path for re-use with `-Execute`.

---

## Typical Workflow

### 1. Run Autopilot Plan

```powershell
./scripts/ai/run-self-cycle.ps1 -AutopilotPlan -IssueLabel "agent:codex-action-needed" -Repo owner/name
```

### 2. Review Output

- Check the step table for any blocked or warning steps.
- Review the autopilot plan summary for the recommended next action.

### 3. Execute (if ready)

```powershell
./scripts/ai/run-self-cycle.ps1 -TaskFile <file> -Execute
```

### 4. Or Fix and Re-plan

If the plan shows blocked steps, fix the issues and re-run the autopilot plan to verify.

---

## Integration with Loop Model

The autopilot plan mode is the planning phase of the loop model's control loop:

```
┌─────────────────────────────────────────────────────────┐
│                    autopilot plan mode                    │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐    │
│  │  issue    │──▶│  compile │──▶│  gate check      │    │
│  │  discover │   │  tasks   │   │  (health+launch) │    │
│  └──────────┘   └──────────┘   └────────┬─────────┘    │
│       ▲                                   │             │
│       │                                   ▼             │
│  ┌──────────┐                    ┌──────────────────┐   │
│  │  next    │◀───────────────────│  plan output     │   │
│  │  wave    │                    │  (ready/blocked) │   │
│  └──────────┘                    └──────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

The autopilot plan mode produces the plan; the human decides whether to execute. This preserves the human-owned "next-wave decision" boundary from the [codex-retirement-runbook](codex-retirement-runbook.md#human-owned-decisions).

---

## CI Integration

```powershell
# Run autopilot plan, capture exit code
./scripts/ai/run-self-cycle.ps1 -AutopilotPlan -IssueLabel "agent:codex-action-needed" -Repo owner/name
$planExit = $LASTEXITCODE

if ($planExit -eq 0) {
    Write-Host "Plan ready — review and execute"
} else {
    Write-Host "Plan blocked or errored — investigate"
}
```

---

## Relationship to Other Modes

| Mode | Flag | Behavior |
|------|------|----------|
| Standard dry-run | (none) | Stops at every human gate |
| Plan-first | `-PlanFirst` | Proposes batch, stops for review |
| Execute | `-Execute` | Launches workers after human confirmation |
| Autopilot plan | `-AutopilotPlan` | Non-stop dry-run through all steps |
| Autopilot plan + plan-first | `-AutopilotPlan -PlanFirst` | Migration matrix awareness + full pipeline |

---

## Design Constraints

- **Dry-run by default.** Autopilot plan mode never launches workers.
- **No autonomous merge.** Merge decisions remain human-owned.
- **No seed constitution bypass.** High-risk boundaries are preserved.
- **Hard safety limits.** Max-task breach is a hard failure, not a warning.
- **Idempotent.** Running the same autopilot plan twice produces the same result.
- **Read-only mutations.** The autopilot plan mode only reads state files and writes temp files. It does not modify health markers, launch locks, or provider pool state.

---

## References

- [Self-Cycle Runner](self-cycle-runner.md) — standard orchestrator with human stops
- [Loop Model](loop-model.md) — automated loop model
- [Planning Loop](planning-loop.md) — dry-run batch planner
- [Codex Retirement Runbook](codex-retirement-runbook.md) — exit criteria and human-owned decisions
- [Launch Gate](launch-gate.md) — pre-launch validation policy
- [Main Health Policy](main-health-policy.md) — health state definitions
- [Provider Pool](provider-pool.md) — provider availability and capacity
