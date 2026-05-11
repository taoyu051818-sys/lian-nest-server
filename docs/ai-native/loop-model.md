# Loop Model (Self-Cycle Runner)

Defines the automated loop that replaces Codex as the manual orchestrator:
issue queue → worker launch → PR → review → merge → health gate → next wave.

> **Status:** Implemented. All loop phases have corresponding scripts.
> See [self-cycle-runner.md](self-cycle-runner.md) for the orchestrator.
>
> **Related:** [codex-retirement-runbook.md](codex-retirement-runbook.md)
> exit criteria #1 and #8, [SOP.md](SOP.md) for the current manual lifecycle.

---

## Overview

The loop model is the target state where `lian-nest-server` runs a self-cycle
runner that drives the issue-to-PR lifecycle without Codex intervention. The
runner reads from a task queue, launches workers, monitors progress, and
triggers post-merge gates — all within the boundaries defined by the existing
task contract and health policy.

```
┌─────────────────────────────────────────────────────┐
│                   self-cycle runner                  │
│                                                     │
│  ┌──────────┐   ┌──────────┐   ┌────────────────┐  │
│  │  task     │──▶│  launch  │──▶│  worker        │  │
│  │  queue    │   │  gate    │   │  (worktree)    │  │
│  └──────────┘   └──────────┘   └───────┬────────┘  │
│       ▲                                 │           │
│       │                                 ▼           │
│  ┌──────────┐   ┌──────────┐   ┌────────────────┐  │
│  │  next    │◀──│  health  │◀──│  PR opened     │  │
│  │  wave    │   │  gate    │   │  (review gate) │  │
│  └──────────┘   └──────────┘   └────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Loop Phases

### 1. Task Queue Read

The runner reads pending issues from a queue (GitHub issues with specific labels
or a local manifest). Each entry maps to a task JSON conforming to
[worker-task-contract.md](worker-task-contract.md).

**Queue source (future):** GitHub issues labeled `agent:ready` filtered by
priority and wave.

### 2. Launch Gate

Before dispatching, the runner invokes `check-launch-gate.ps1` to validate:

- Main branch health permits the worker type.
- No conflict group collisions with in-flight workers.
- Shared locks are available.

If the gate blocks a task, the runner defers it and logs the reason.

### 3. Worker Dispatch

The runner invokes `batch-launch.ps1 -Execute` for each allowed task. This
creates a worktree, runs the worker via `run-claude-print.ps1`, and monitors
the process via the [worker heartbeat](worker-heartbeat.md).

### 4. PR and Review Gate

When the worker opens a PR, the runner:

- Verifies the PR body includes all required sections.
- Labels the PR for review (`agent:needs-review`).
- Does **not** make merge decisions (human-owned, see
  [codex-retirement-runbook.md](codex-retirement-runbook.md#human-owned-decisions)).

### 5. Health Gate

After a PR merges, the runner auto-triggers the post-merge health gate:

- Green → proceed to next task in queue.
- Yellow → defer runtime workers, continue docs/repair workers.
- Red → launch a recovery worker automatically.

### 6. Next Wave

The runner does **not** generate or launch follow-up waves autonomously. This
is a deliberate constraint from the SOP. After a wave completes:

- The runner pauses and waits for a human to issue the next wave.
- The human reviews the completed PR, decides scope, and creates the next
  batch of issues.
- The runner resumes reading from the queue.

---

## Boundaries

### What the Runner Automates

- Reading the task queue.
- Running the launch gate.
- Dispatching workers.
- Monitoring worker heartbeat.
- Triggering the health gate after merge.
- Deferring blocked tasks.
- Launching recovery workers on red state.

### What Remains Human-Owned

- Creating and scoping issues (product direction).
- Approving or blocking PRs (merge decision).
- Deciding next-wave boundaries (wave sequencing).
- Overriding the health gate (manual judgment).
- Auth and database cutover decisions.

See [codex-retirement-runbook.md § Human-Owned Decisions](codex-retirement-runbook.md#human-owned-decisions)
for the full list.

---

## Failure Modes

| Failure | Runner Behavior | Human Action |
|---------|-----------------|--------------|
| Worker exits non-zero, no PR | Log failure, defer task. | Investigate worker output, relaunch or rescope. |
| Launch gate blocks all tasks | Log block reasons, wait. | Resolve health issue or override gate. |
| Health gate stays red > 2 cycles | Stop auto-launch, enter fallback. | Follow [safe fallback procedure](codex-retirement-runbook.md#safe-fallback). |
| Worker heartbeat stale > 10 min | Kill worker, log, defer task. | Check worktree for partial progress, relaunch. |
| Queue empty | Idle, poll for new issues. | Create new issues or end the session. |

---

## Implementation Status

All loop phases have corresponding scripts. The orchestrator chains them
via `run-self-cycle.ps1`.

| Item | Status | Script |
|------|--------|--------|
| Task queue reader (GitHub labels) | **Done** | `run-self-cycle.ps1 -IssueLabel` |
| Runner main loop script | **Done** | `run-self-cycle.ps1` |
| Launch gate | **Done** | `check-launch-gate.ps1` |
| Batch worker dispatch | **Done** | `batch-launch.ps1` |
| State reconciliation | **Done** | `state-reconciler.ps1` |
| Health gate | **Done** | `post-merge-health-gate.js` |
| Health state writer | **Done** | `write-main-health-state.ps1` |
| Result publishing | **Done** | `publish-agent-result.ps1` |
| Batch planning | **Done** | `plan-next-batch.ps1` |
| Controlled merge | **Done** | `merge-clean-pr-batch.ps1` |
| Worktree cleanup | **Done** | `worktree-janitor.ps1` |
| Health gate auto-trigger after merge | **Pending** | Requires CI wiring |
| Recovery worker auto-dispatch on red | **Pending** | Policy defined, trigger not wired |
| Fallback mode with logging | **Pending** | Manual fallback procedure documented in [codex-retirement-runbook.md](codex-retirement-runbook.md#safe-fallback) |

---

## References

- [codex-retirement-runbook.md](codex-retirement-runbook.md) — Exit criteria and fallback.
- [SOP.md](SOP.md) — Current manual lifecycle.
- [orchestration.md](orchestration.md) — Self-hosted batch launcher.
- [launch-gate.md](launch-gate.md) — Pre-launch validation.
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
- [worker-heartbeat.md](worker-heartbeat.md) — Worker monitoring.
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema.
