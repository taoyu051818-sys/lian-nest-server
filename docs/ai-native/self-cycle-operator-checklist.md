# Self-Cycle Operator Checklist

Practical checklist for operators running the self-cycle runner after
Codex exits the control loop. Use this alongside
[codex-exit-readiness.md](codex-exit-readiness.md) for readiness
verification and [codex-retirement-runbook.md](codex-retirement-runbook.md)
for the full daily workflow.

> **Closes:** [#614](https://github.com/taoyu051818-sys/lian-nest-server/issues/614)

---

## Pre-Cycle Checks (Every Session)

Before starting any self-cycle run, verify the environment.

- [ ] **Git clean** — `git status` shows no uncommitted changes on `main`.
- [ ] **gh CLI authenticated** — `gh auth status` shows Logged in.
- [ ] **No stale worktrees** — `./scripts/ai/worktree-janitor.ps1` in dry-run
      shows no `merged` or `merged+dirty` entries.
- [ ] **Health marker exists** — `cat .github/ai-state/main-health.json` shows
      a valid JSON with `state` field.
- [ ] **Health marker is current** — marker's `commitSha` matches `main` HEAD
      (or was written after the last merge).

---

## Health Gate (Before Every Cycle)

The health gate determines which worker types may launch.

### Quick Mode (Default)

```powershell
node scripts/post-merge-health-gate.js --quick
```

### Full Mode (After src-touching merges or red recovery)

```powershell
node scripts/post-merge-health-gate.js --full
```

### Write the Marker

```powershell
# Green
./scripts/ai/write-main-health-state.ps1 -State green -Checks "tsc,build,prisma"

# Yellow (non-critical failure)
./scripts/ai/write-main-health-state.ps1 -State yellow `
  -Checks "tsc,build,prisma" -FailedChecks "prisma" `
  -Reason "Prisma schema drift detected"

# Red (critical failure)
./scripts/ai/write-main-health-state.ps1 -State red `
  -Checks "tsc,build,prisma" -FailedChecks "tsc,build" `
  -Reason "Type-check and build broken"
```

### Health State Decision

| State | May Launch | Action |
|-------|-----------|--------|
| **Green** | All worker types | Proceed to cycle |
| **Yellow** | Foundation-fix, docs, health-repair, test-only | Defer runtime feature work |
| **Red** | Foundation-fix, health-repair only | Launch recovery worker first |
| **Black** | None | Manual intervention required |

---

## Dry-Run Cycle

Always dry-run before executing. This validates the full pipeline
without making changes.

### Option A: From Issue Label

```powershell
./scripts/ai/run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name
```

### Option B: From Task File

```powershell
./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/batch-wave-N.json
```

### Option C: Plan-First (Propose Before Launch)

```powershell
./scripts/ai/run-self-cycle.ps1 -PlanFirst -IssueLabel "agent:codex-action-needed" -Repo owner/name
```

### Dry-Run Verification

- [ ] Exit code is 0.
- [ ] Launch gate report shows `allAllowed: true` for all tasks.
- [ ] No conflict group collisions.
- [ ] No shared lock violations.
- [ ] Health state matches the written marker.
- [ ] Task count is within `-MaxTasks` limit (default 10).

---

## Execute Cycle

After a successful dry-run, execute with explicit confirmation.

```powershell
./scripts/ai/run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name -Execute
```

Or with a task file:

```powershell
./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/batch-wave-N.json -Execute
```

### Execute Verification

- [ ] Confirmation prompt accepted after reviewing launch plan.
- [ ] Workers launched in isolated worktrees under `.claude/worktrees/`.
- [ ] Workers committed to their branches.
- [ ] `git diff main --name-only` on each branch shows only allowed files.

---

## Post-Merge (After PRs Merge)

After workers complete and PRs merge, maintain the control plane.

### 1. Health Gate

```powershell
node scripts/post-merge-health-gate.js --quick
./scripts/ai/write-main-health-state.ps1 -State <state> -Checks "tsc,build"
```

### 2. Worktree Cleanup

```powershell
./scripts/ai/worktree-janitor.ps1 -RemoveMerged
```

### 3. State Reconciliation

```powershell
./scripts/ai/state-reconciler.ps1 -Repo owner/name
```

### 4. Verify Drift

- [ ] No stale-running workers detected.
- [ ] No done-without-merge issues.
- [ ] No orphaned worktrees.

---

## Merge Gate (Approved PRs)

When PRs are approved and ready to merge.

### Dry-Run Merge Check

```powershell
./scripts/ai/merge-clean-pr-batch.ps1 -PRs 42,45 -Repo owner/name -RunGuards
```

### Execute Merge

```powershell
./scripts/ai/merge-clean-pr-batch.ps1 -PRs 42,45 -Repo owner/name -Execute -RunGuards -RunHealthGate
```

### Merge Verification

- [ ] Only allowlisted PRs were merged.
- [ ] Guard checks passed (task boundary, PR handoff, docs authority, generated Prisma).
- [ ] Health gate ran after merge and passed.
- [ ] Manifest written to `.ai/merge-batch-manifests/`.

---

## End-of-Day Checks

Before leaving the automation unattended.

- [ ] No workers in `stale` state (check worker heartbeat).
- [ ] Health state is not red (or recovery worker is in progress).
- [ ] All merged worktrees cleaned up.
- [ ] State reconciler ran and drift is documented (if any).
- [ ] Next-wave decision is documented (manual / router / serial).

---

## Escalation Triggers

Re-engage Codex or call for human intervention when:

| Trigger | Action |
|---------|--------|
| Health stays red for > 2 cycles | Re-engage Codex for recovery orchestration |
| Self-cycle runner exits with code 2 | Investigate runner bug; re-engage Codex if needed |
| Worker count drops to 0 for > 1 day | Check issue queue; create issues or re-engage Codex |
| Launch gate blocks all tasks in a batch | Resolve health or conflict issue manually |
| Worker heartbeat stale > 10 min | Kill worker, check worktree for partial progress, relaunch |
| Fallback procedure triggered | Follow [codex-retirement-runbook.md § Safe Fallback](codex-retirement-runbook.md#safe-fallback) |

---

## Quick Reference

### Script Summary

| Script | Purpose | Default Mode |
|--------|---------|-------------|
| `run-self-cycle.ps1` | Top-level orchestrator | Dry-run |
| `plan-next-batch.ps1` | Propose next batch from issues | Read-only |
| `check-launch-gate.ps1` | Validate tasks against health policy | Read-only |
| `batch-launch.ps1` | Launch workers in worktrees | Dry-run |
| `merge-clean-pr-batch.ps1` | Controlled auto-merge | Dry-run |
| `post-merge-health-gate.js` | Post-merge health check | Read-only |
| `write-main-health-state.ps1` | Record health marker | Writes (use `-DryRun` to suppress) |
| `state-reconciler.ps1` | Detect drift | Read-only |
| `publish-agent-result.ps1` | Post structured summaries | Writes |
| `worktree-janitor.ps1` | Clean stale worktrees | Dry-run |

### Key Paths

| Path | Contents |
|------|----------|
| `.github/ai-state/main-health.json` | Main branch health marker |
| `.ai/merge-batch-manifests/` | Merge batch manifests |
| `.claude/worktrees/` | Worker worktrees |
| `docs/ai-native/` | Governance docs (this folder) |

---

## References

- [webui-control-console.md](webui-control-console.md) — WebUI dashboard runbook for visual oversight of this checklist.
- [codex-exit-readiness.md](codex-exit-readiness.md) — Readiness checks for Codex exit.
- [codex-retirement-runbook.md](codex-retirement-runbook.md) — Full retirement criteria, fallback, daily workflow.
- [self-cycle-runner.md](self-cycle-runner.md) — Runner parameters, pipeline steps, exit codes.
- [control-plane-adoption-checklist.md](control-plane-adoption-checklist.md) — First-time adoption guide.
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
- [controlled-auto-merge.md](controlled-auto-merge.md) — Merge script safety guarantees.
- [seed-constitution.md](seed-constitution.md) — Immutable boundaries.
