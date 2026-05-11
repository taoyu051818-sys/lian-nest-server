# Codex Retirement Runbook

Defines the exit criteria for Codex to stop acting as the manual orchestrator,
the human-owned decisions that survive automation, the safe-fallback procedure
when self-cycle fails, and the daily workflow once the self-cycle runner is
active.

> **Closes:** [#150](https://github.com/taoyu051818-sys/lian-nest-server/issues/150)
>
> **Cross-references:**
> [orchestration-ownership.md](orchestration-ownership.md) for ownership
> boundaries, [SOP.md](SOP.md) for the full lifecycle,
> [lian-platform-server-orchestration-retirement.md](../migration/lian-platform-server-orchestration-retirement.md)
> for legacy retirement tracking,
> [loop-model.md](loop-model.md) for the self-cycle runner model.

---

## Exit Criteria

Codex orchestration is no longer needed when **all** of the following are true:

| # | Criterion | How to Verify |
|---|-----------|---------------|
| 1 | **Self-cycle runner launches workers autonomously** | `batch-launch.ps1` dispatches from a task queue without manual invocation. |
| 2 | **Launch gate runs unattended** | `check-launch-gate.ps1` blocks invalid batches without an orchestrator reviewing the report. |
| 3 | **Post-merge health gate auto-triggers** | Health gate runs after every merge and sets state (green/yellow/red) without human initiation. |
| 4 | **Recovery workers auto-dispatch on red** | When health drops to red, a foundation-fix or health-repair worker is launched automatically. |
| 5 | **PR review gate operates without Codex triage** | Reviewers receive PRs and apply the acceptance checklist without Codex routing. |
| 6 | **Next-wave decisions are human-initiated, not Codex-initiated** | Humans decide wave boundaries; Codex does not generate or launch follow-up waves (per SOP). |
| 7 | **Legacy `lian-platform-server` orchestration is RETIRED** | All rows in the [migration checklist](../migration/lian-platform-server-orchestration-retirement.md#migration-checklist) show `RETIRED`. |
| 8 | **Loop-model runner is operational** | Self-cycle runner executes issue-to-PR cycles without Codex hand-holding. See [loop-model.md](loop-model.md). |

### Decision Rule

If any criterion in the table above is **not met**, Codex orchestration
continues. The orchestrator role is not retired incrementally — it stays active
until the full set is satisfied.

---

## Human-Owned Decisions

The following decisions remain human-owned regardless of automation maturity.
Codex must never make these autonomously.

### High-Risk Decisions

| Decision | Why Human-Owned | Escalation Path |
|----------|-----------------|-----------------|
| Merge or block a PR | Architectural mismatch, scope drift, or security risk may not be detectable by automation. | `repo-owner` makes the final call. |
| Launch or defer a wave | Wave dependencies are non-obvious until the prior wave's diff is reviewed. | Human reviews diff, then issues next wave. |
| Approve auth or database cutover | Auth and schema changes have irreversible production impact. | `architect` + `security-reviewer` sign-off required. |
| Override health gate | Blocking all workers may be wrong if the gate misclassifies a flake as red. | `repo-owner` manually overrides with documented reason. |

### Product Direction

| Decision | Why Human-Owned |
|----------|-----------------|
| Issue scope and acceptance criteria | Business value is not automatable. |
| Priority and wave ordering | Trade-offs require product context. |
| Deprecation of a feature or endpoint | Legal, compliance, and UX implications. |

### Orchestration Policy Changes

| Decision | Why Human-Owned |
|----------|-----------------|
| Adding or removing a worker type | Affects launch permissions across all health states. |
| Changing conflict group rules | Parallel work safety depends on domain knowledge. |
| Modifying the acceptance checklist | Review gate contract between orchestrator and reviewers. |

---

## Safe Fallback

When the self-cycle runner fails or produces unexpected results, follow this
procedure to fall back to manual orchestration without losing work.

### Detection

The self-cycle runner is considered failed when any of the following occur:

- Worker exits with non-zero code and no PR was opened.
- Launch gate blocks all tasks in a batch and no recovery worker dispatches.
- Health gate stays red for more than 2 consecutive cycles.
- Worker heartbeat enters `stale` state and does not recover within 10 minutes.

### Fallback Steps

```
1. STOP the self-cycle runner.
   - Kill the batch-launch process if running.
   - Record the failure in the issue thread (comment with symptoms).

2. ASSESS partial progress.
   - Check for uncommitted changes in active worktrees:
     git worktree list
   - Check for open PRs from the failed cycle:
     gh pr list --head claude/issue-<N>

3. PRESERVE work-in-progress.
   - If a worktree has uncommitted changes, commit them on the worker branch.
   - If a PR was opened but not reviewed, label it "needs-manual-review".
   - If a PR was reviewed but not merged, hold it until main recovers.

4. DIAGNOSE the failure.
   - Check worker heartbeat snapshot (monitor-state.json).
   - Check launch gate report for blocked tasks.
   - Check health gate output for state classification.

5. RESUME with manual orchestration.
   - Follow the Manual Continuation SOP in SOP.md.
   - Use Option A (manual orchestrator) for the next wave.
   - Do not restart the self-cycle runner until the failure is understood.

6. RECORD the fallback.
   - Add a row to the Fallback Log below.
   - File a follow-up issue for the root cause if it is a runner bug.
```

### Fallback Log

| Date | Trigger | Root Cause | Resolution | Follow-up Issue |
|------|---------|------------|------------|-----------------|
| — | — | — | — | No fallbacks yet |

---

## Daily Workflow (Self-Cycle Active)

Once the self-cycle runner is operational, the daily workflow for humans shifts
from orchestration to oversight.

### Morning Check

1. Review the overnight batch report (written by the launcher monitor).
2. Check main branch health state: `node scripts/post-merge-health-gate.js --quick`.
3. Review any open PRs from overnight workers.
4. Approve or request changes on PRs that passed the review gate.

### During the Day

1. Create or triage new issues with bounded scope and acceptance criteria.
2. The self-cycle runner picks up queued issues and launches workers.
3. Review PRs as they arrive. Use the [worker acceptance checklist](worker-acceptance-checklist.md).
4. Make next-wave decisions after reviewing completed PRs.

### End of Day

1. Verify no workers are stuck in `stale` state.
2. Check that all merged PRs triggered a successful health gate.
3. If health is red, launch a recovery worker or defer until morning.

### Weekly Review

1. Audit the Fallback Log for recurring failures.
2. Review the [migration checklist](../migration/lian-platform-server-orchestration-retirement.md#migration-checklist) for stalled components.
3. Update retirement criteria progress.

---

## Retirement Checklist

Use this checklist to track progress toward retiring Codex orchestration.

### Automation Maturity

- [ ] Self-cycle runner launches workers from a task queue.
- [ ] Launch gate blocks invalid batches without human review.
- [ ] Health gate auto-triggers after every merge.
- [ ] Recovery workers auto-dispatch on red state.
- [ ] PR review gate operates without Codex routing.
- [ ] Loop-model runner is operational (see [loop-model.md](loop-model.md)).

### Human Process

- [ ] Next-wave decisions documented as human-owned (not Codex-initiated).
- [ ] Fallback procedure tested at least once.
- [ ] Daily workflow documented and adopted by the team.

### Legacy Retirement

- [ ] Launcher migrated and at `PARITY`.
- [ ] Monitor migrated and at `PARITY`.
- [ ] Publisher migrated and at `PARITY`.
- [ ] Merge helper migrated and at `PARITY`.
- [ ] Health gate migrated and at `PARITY`.
- [ ] All legacy components at `RETIRED`.

### Sign-Off

- [ ] Architect confirms exit criteria are met.
- [ ] Repo-owner confirms legacy retirement is complete.
- [ ] Codex orchestrator role formally retired (remove from [roles.md](roles.md)).

---

## References

- [SOP.md](SOP.md) — Full AI-native development lifecycle.
- [orchestration-ownership.md](orchestration-ownership.md) — Ownership boundaries.
- [lian-platform-server-orchestration-retirement.md](../migration/lian-platform-server-orchestration-retirement.md) — Legacy retirement tracking.
- [loop-model.md](loop-model.md) — Self-cycle runner model.
- [worker-acceptance-checklist.md](worker-acceptance-checklist.md) — PR review criteria.
- [launch-gate.md](launch-gate.md) — Pre-launch validation.
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
