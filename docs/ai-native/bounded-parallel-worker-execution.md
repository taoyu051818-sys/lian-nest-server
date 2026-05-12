# Bounded Parallel Worker Execution

`scripts/ai/batch-launch.ps1` was intentionally sequential while the
self-cycle path was being hardened. Sequential launch made every failure local:
one task created one worktree, one worker ran, and the launcher stopped at the
first control-plane bug. That was the right default while the runner,
telemetry, recovery classifier, and Command Steward brief were still unstable.

The system can now plan bounded parallel waves, but parallelism is still gated.
The long-term operating target is up to 30 active workers, not an unconditional
30-worker blast.

## Effective Parallelism

When `-Parallel` is supplied, the launcher computes:

```text
effectiveParallelism = min(
  requested MaxParallelWorkers,
  provider slots,
  local resource slots,
  conflict-safe slots,
  risk-safe slots,
  review capacity,
  merge capacity,
  failure budget
)
```

The launcher prints each input:

```text
Requested parallelism: N
Provider slots: N
Resource slots: N
Conflict-safe slots: N
Risk-safe slots: N
Review capacity: N
Merge capacity: N
Failure budget: N
Effective parallelism: N
```

Provider slots come from `.github/ai-state/provider-pool.json`. Local resource
slots come from `.github/ai-state/local-resource.json`. Missing state is treated
conservatively as one slot. If a provider or local resource file only allows one
worker, requesting 30 still results in effective parallelism of one.

## Conflict And Risk Rules

Tasks with the same `conflictGroup` never run in the same wave. Tasks with
overlapping `sharedLocks` are serialized into separate waves. High-risk or
human-required tasks are forced to solo waves unless future policy explicitly
allows otherwise.

Parallel launch does not bypass `check-launch-gate.ps1`. A blocked gate still
blocks execute mode.

## Dry-Run

Preview a 30-worker plan without launching anything:

```powershell
pwsh -NoProfile -File scripts/ai/batch-launch.ps1 `
  -TaskFile .ai/tasks/wave/tasks.json `
  -Parallel `
  -MaxParallelWorkers 30
```

For test fixtures or Command Steward preview artifacts, explicitly pass a
manifest path. The launcher writes planned worker entries and single-task JSON
fixtures, but still launches no workers:

```powershell
pwsh -NoProfile -File scripts/ai/batch-launch.ps1 `
  -TaskFile .ai/tasks/wave/tasks.json `
  -Parallel `
  -MaxParallelWorkers 30 `
  -WorkerManifestPath .ai/tmp/active-workers.preview.json `
  -LogDir .ai/tmp/worker-logs
```

## Controlled Execute

Start a small bounded wave:

```powershell
pwsh -NoProfile -File scripts/ai/batch-launch.ps1 `
  -TaskFile .ai/tasks/wave/tasks.json `
  -Execute `
  -Parallel `
  -MaxParallelWorkers 3
```

The launcher starts workers asynchronously inside each wave, writes separate
stdout/stderr/result files, then calls:

```powershell
pwsh -NoProfile -File scripts/ai/wait-parallel-workers.ps1 `
  -WorkerManifestPath .github/ai-state/active-workers.json
```

It does not start the next wave until the current wave finishes. This preserves
conflict and shared-lock safety.

## Active Worker Inspection

The active projection lives at:

```text
.github/ai-state/active-workers.json
```

Each worker entry records:

```text
issueNumber, branch, worktree, taskFile, pid, status, startedAt, endedAt,
exitCode, logPath, stderrPath, resultPath, conflictGroup, risk, actorRole,
providerSlot
```

Local logs are written under:

```text
.ai/worker-logs/<batch-id>/
  issue-<number>.out.log
  issue-<number>.err.log
  issue-<number>.result.json
```

These are runtime artifacts and should not be committed.

## Failure Recovery

`wait-parallel-workers.ps1` updates the active manifest with:

```text
completed, failed, stillRunning, stale, blocked, needsHuman
```

Failed workers are classified with
`scripts/ai/classify-self-cycle-failure.js` when stderr/stdout is available.
The wait script returns non-zero if any selected worker failed, became stale, or
still runs in `-Once` mode.

Safe recovery sequence:

1. Inspect `.github/ai-state/active-workers.json`.
2. Inspect the worker's `.err.log`, `.out.log`, and `.result.json`.
3. Run `wait-parallel-workers.ps1 -Once` to refresh status.
4. Use the failure class to decide retry, follow-up issue, or human-required.

## Command Steward Reporting

The Command Steward should report:

- requested parallelism
- effective parallelism
- active worker count
- blocked parallelism reason
- whether provider/resource/concurrency state allows a larger wave
- next recommended action

It should not recommend increasing concurrency when active workers are failed,
stale, or missing result markers.
