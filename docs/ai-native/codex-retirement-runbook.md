# Codex Retirement Runbook

Defines the exit criteria for Codex to stop acting as the manual orchestrator,
the human-owned decisions that survive automation, the safe-fallback procedure
when self-cycle fails, and the daily workflow once the self-cycle runner is
active.

> **Closes:** [#150](https://github.com/taoyu051818-sys/lian-nest-server/issues/150), [#257](https://github.com/taoyu051818-sys/lian-nest-server/issues/257)
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

| # | Criterion | How to Verify | Status |
|---|-----------|---------------|--------|
| 1 | **Self-cycle runner launches workers autonomously** | `run-self-cycle.ps1` chains discovery, reconciliation, health check, launch gate, and batch dispatch. | **MET** — `scripts/ai/run-self-cycle.ps1` exists with `-IssueLabel` discovery and `-Execute` mode. |
| 2 | **Launch gate runs unattended** | `check-launch-gate.ps1` blocks invalid batches without an orchestrator reviewing the report. | **MET** — `scripts/ai/check-launch-gate.ps1` validates health state, conflict groups, and shared locks. |
| 3 | **Post-merge health gate auto-triggers** | Health gate runs after every merge and sets state (green/yellow/red) without human initiation. | **PARTIAL** — `post-merge-health-gate.js` and `write-main-health-state.ps1` exist, but auto-trigger after merge requires manual invocation or CI wiring. |
| 4 | **Recovery workers auto-dispatch on red** | When health drops to red, a foundation-fix or health-repair worker is launched automatically. | **PARTIAL** — Health policy defines red-state recovery worker rules in [main-health-policy.md](main-health-policy.md), but auto-dispatch is not wired. |
| 5 | **PR review gate operates without Codex triage** | Reviewers receive PRs and apply the acceptance checklist without Codex routing. | **MET** — PR review gate is documented and checklist-driven. |
| 6 | **Next-wave decisions are human-initiated, not Codex-initiated** | Humans decide wave boundaries; Codex does not generate or launch follow-up waves (per SOP). | **MET** — By design. Self-cycle runner pauses after wave completion; human issues next wave. |
| 7 | **Legacy `lian-platform-server` orchestration is RETIRED** | All rows in the [migration checklist](../migration/lian-platform-server-orchestration-retirement.md#migration-checklist) show `RETIRED`. | **OPEN** — Migration tracking continues. |
| 8 | **Loop-model runner is operational** | Self-cycle runner executes issue-to-PR cycles without Codex hand-holding. See [loop-model.md](loop-model.md). | **MET** — `run-self-cycle.ps1` orchestrates the full loop. `plan-next-batch.ps1` provides batch proposals. |

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

## Remaining Manual Gates

The following gates still require human action and block full Codex retirement.

### Gate 1: Health Gate Auto-Trigger After Merge

**Current state:** `post-merge-health-gate.js` and `write-main-health-state.ps1`
exist but must be invoked manually after each merge.

**What's needed:** CI wiring (GitHub Actions or equivalent) that automatically
runs the health gate and writes the marker after every merge to `main`.

**Impact until resolved:** The self-cycle runner's Step 2 (health check) fails
if no marker file exists. An operator must run the health gate and writer
before starting each cycle.

### Gate 2: Recovery Worker Auto-Dispatch on Red

**Current state:** The [main-health-policy.md](main-health-policy.md) defines
which worker types are permitted in each health state and describes the
recovery worker flow. However, no script automatically dispatches a recovery
worker when health drops to red.

**What's needed:** A trigger (in the self-cycle runner or CI) that detects
red state and launches a foundation-fix or health-repair worker without
human initiation.

**Impact until resolved:** When health is red, an operator must manually
create a fix issue and launch a recovery worker.

### Gate 3: Legacy Migration Completion

**Current state:** The
[migration checklist](../migration/lian-platform-server-orchestration-retirement.md#migration-checklist)
tracks legacy component retirement. None are at `RETIRED` yet.

**What's needed:** Each legacy component (launcher, monitor, publisher,
merge helper, health gate) must reach `PARITY` and then `RETIRED`.

**Impact until resolved:** Codex orchestration cannot be formally retired
until all legacy components are at `RETIRED`.

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

The self-cycle runner and supporting scripts are operational. The daily workflow
for humans shifts from orchestration to oversight.

### Available Scripts

| Script | Purpose |
|--------|---------|
| `run-self-cycle.ps1` | Top-level orchestrator — chains all steps with human stop points |
| `plan-next-batch.ps1` | Proposes next worker batch from open issues |
| `batch-launch.ps1` | Launches workers in isolated worktrees |
| `check-launch-gate.ps1` | Validates tasks against health policy and conflict groups |
| `post-merge-health-gate.js` | Runs post-merge health checks (`--quick` or `--full`) |
| `write-main-health-state.ps1` | Records health state marker for downstream consumers |
| `state-reconciler.ps1` | Detects drift between issues, PRs, and labels |
| `publish-agent-result.ps1` | Posts structured result comments to issues/PRs |
| `merge-clean-pr-batch.ps1` | Controlled auto-merge for allowlisted CLEAN PRs |
| `merge-queue-assistant.js` | Lists eligible PRs and prints merge commands |
| `worktree-janitor.ps1` | Classifies and removes stale worktrees |

### Morning Check

1. Run the self-cycle runner to discover and propose the next batch:
   ```powershell
   ./scripts/ai/run-self-cycle.ps1 -PlanFirst -IssueLabel "agent:codex-action-needed" -Repo owner/name
   ```
2. Check main branch health state: `node scripts/post-merge-health-gate.js --quick`.
3. Write the health marker: `./scripts/ai/write-main-health-state.ps1 -State <green|yellow|red>`.
4. Review any open PRs from overnight workers.
5. Approve or request changes on PRs that passed the review gate.

### During the Day

1. Create or triage new issues with bounded scope and acceptance criteria.
2. Run the self-cycle runner to compile and launch workers:
   ```powershell
   ./scripts/ai/run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name -Execute
   ```
3. Review PRs as they arrive. Use the [worker acceptance checklist](worker-acceptance-checklist.md).
4. Merge approved PRs:
   ```powershell
   ./scripts/ai/merge-clean-pr-batch.ps1 -PRs <N> -Repo owner/name -Execute -RunGuards -RunHealthGate
   ```
5. Make next-wave decisions after reviewing completed PRs.

### End of Day

1. Run the state reconciler to check for drift:
   ```powershell
   ./scripts/ai/state-reconciler.ps1 -Repo owner/name
   ```
2. Run the worktree janitor to clean up merged worktrees:
   ```powershell
   ./scripts/ai/worktree-janitor.ps1 -RemoveMerged
   ```
3. Verify no workers are stuck in `stale` state.
4. If health is red, launch a recovery worker or defer until morning.

### Weekly Review

1. Audit the Fallback Log for recurring failures.
2. Review the [migration checklist](../migration/lian-platform-server-orchestration-retirement.md#migration-checklist) for stalled components.
3. Update retirement criteria progress.

---

## Retirement Checklist

Use this checklist to track progress toward retiring Codex orchestration.

### Automation Maturity

- [x] Self-cycle runner launches workers from a task queue. (`run-self-cycle.ps1` with `-IssueLabel` discovery)
- [x] Launch gate blocks invalid batches without human review. (`check-launch-gate.ps1`)
- [ ] Health gate auto-triggers after every merge. (script exists; CI wiring pending)
- [ ] Recovery workers auto-dispatch on red state. (policy defined; auto-dispatch pending)
- [x] PR review gate operates without Codex routing. (checklist-driven, no Codex triage)
- [x] Loop-model runner is operational. (`run-self-cycle.ps1` chains all loop phases)
- [x] State reconciler detects drift. (`state-reconciler.ps1`)
- [x] Result publisher posts structured summaries. (`publish-agent-result.ps1`)
- [x] Worktree janitor classifies and cleans stale worktrees. (`worktree-janitor.ps1`)
- [x] Planner proposes next batch from issues. (`plan-next-batch.ps1`)

### Human Process

- [x] Next-wave decisions documented as human-owned (not Codex-initiated).
- [ ] Fallback procedure tested at least once.
- [x] Daily workflow documented and adopted by the team.

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
