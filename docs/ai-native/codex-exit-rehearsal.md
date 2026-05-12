# Codex Exit Rehearsal

Defines the exact two-cycle rehearsal sequence that proves the
self-cycle runner can sustain daily orchestration without Codex.
Each cycle is a full end-to-end traversal of the loop phases.
Both cycles must pass consecutively before Codex exits.

> **Closes:** [#1158](https://github.com/taoyu051818-sys/lian-nest-server/issues/1158)
>
> **Complements:**
> [codex-exit-readiness-gate.md](codex-exit-readiness-gate.md) for
> the gate decision rule and pass criteria,
> [codex-exit-readiness.md](codex-exit-readiness.md) for per-gate
> readiness checks,
> [codex-retirement-runbook.md](codex-retirement-runbook.md) for
> safe fallback and retirement criteria.

---

## Purpose

This script answers: **What does the operator actually do to prove
Codex can exit?** It sequences every command, WebUI action, and
verification step across two consecutive cycles. If both cycles
complete without fallback or Codex intervention, the exit gate
unlocks.

---

## Prerequisites

Before starting the rehearsal, confirm all blocking readiness gates
pass. These are the same checks defined in
[codex-exit-readiness.md](codex-exit-readiness.md).

| # | Prerequisite | Command | Pass |
|---|-------------|---------|------|
| 1 | Main health is green | `node scripts/post-merge-health-gate.js --quick` | Exit 0, state `green` |
| 2 | Health marker exists | `cat .github/ai-state/main-health.json` | `state: green` |
| 3 | No stale worktrees | `git worktree list` | No `stale` entries |
| 4 | Provider pool has capacity | `cat .github/ai-state/provider-pool.json` | At least one `available` with `headroom > 0` |
| 5 | Open issues labeled correctly | `gh issue list --label "agent:codex-action-needed"` | At least one issue with `CONTROL APPENDIX` in body |
| 6 | State reconciler clean | `./scripts/ai/state-reconciler.ps1 -Repo owner/name` | Exit 0, no critical drift |

If any prerequisite fails, do not start the rehearsal. Resolve the
blocker first.

---

## Cycle 1: First Autonomous Cycle

### Step 1.1 — Health Check and Marker

Run the health gate and write the state marker.

```powershell
# Health gate
node scripts/post-merge-health-gate.js --quick

# Write marker (replace <state> with actual result)
./scripts/ai/write-main-health-state.ps1 -State <state> -Checks "tsc,build"
```

**WebUI action:** Health indicator badge in Operation Console shows
`green`.

**Pass:** Exit code 0, `.github/ai-state/main-health.json` shows
`state: green`.

**Fail:** Exit code non-zero or state is not green. Stop — resolve
health before continuing.

---

### Step 1.2 — Dry-Run Batch Proposal

Run the self-cycle runner in plan-first mode to preview the batch.

```powershell
./scripts/ai/run-self-cycle.ps1 -PlanFirst -IssueLabel "agent:codex-action-needed" -Repo owner/name
```

**WebUI action:** Planning Console → Queue tab shows proposed tasks
with no conflicts.

**Pass:** Runner outputs a proposed batch with task count > 0 and no
blocked tasks.

**Fail:** No tasks discovered or all tasks blocked. Stop — check
issue labels and conflict groups.

---

### Step 1.3 — Launch Gate Validation

Validate the proposed batch against the launch gate.

```powershell
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/issue-<N>.json
```

**WebUI action:** Command Steward console → Recommended Actions
shows `Launch Batch` as green (not blocked).

**Pass:** Exit code 0, no blocked tasks.

**Fail:** Gate blocks a task. Stop — review gate report, resolve
the conflict or health issue.

---

### Step 1.4 — Execute Cycle 1

Launch the self-cycle runner in execute mode.

```powershell
./scripts/ai/run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name -Execute
```

**WebUI action:** Operation Console → Workers tab shows a new worker
entry with `running` status. The operator confirms the launch at the
human gate when prompted.

**Pass:** Worker dispatches successfully, worktree created.

**Fail:** Runner exits non-zero before dispatch. Stop — follow safe
fallback.

---

### Step 1.5 — Monitor Worker

Wait for the worker to complete. Monitor via:

```powershell
# Check worker status
git worktree list

# Check for PR
gh pr list --head claude/issue-<N>
```

**WebUI action:** Operation Console → Workers tab shows worker
transitions from `running` to `complete`. Queue tab shows task
moves to `awaiting-review`.

**Pass:** Worker exits with code 0 and a PR is opened.

**Fail:** Worker exits non-zero or no PR opened. Stop — follow safe
fallback.

---

### Step 1.6 — Review and Merge PR

Review the PR using the worker acceptance checklist, then merge.

```powershell
# Review the PR
gh pr view <PR-N>

# Merge via controlled merge script
./scripts/ai/merge-clean-pr-batch.ps1 -PRs <N> -Repo owner/name -RunGuards -RunHealthGate -Execute
```

**WebUI action:** Merge Queue screen shows PR with guard results.
Human confirms merge with `MERGE` phrase.

**Pass:** PR merges successfully.

**Fail:** Guards block the merge. Stop — review guard report,
resolve violations.

---

### Step 1.7 — Post-Merge Health Gate

Run the health gate after merge and verify state.

```powershell
node scripts/post-merge-health-gate.js --quick
./scripts/ai/write-main-health-state.ps1 -State <state> -Checks "tsc,build"
```

**WebUI action:** Health indicator badge remains `green`.

**Pass:** Exit code 0, state `green`.

**Fail:** State is yellow or red. Stop — investigate the regression.

---

### Step 1.8 — Issue Close and Reconciliation

Close the done issue and run state reconciliation.

```powershell
# Close issue
gh issue close <N> --comment "Completed via self-cycle runner. PR #<PR-N> merged."

# State reconciliation
./scripts/ai/state-reconciler.ps1 -Repo owner/name
```

**WebUI action:** Command Steward console → Audit Trail shows
`issue-state` action with `success` status.

**Pass:** Issue closed with `done` label, reconciler exits 0 with
no critical drift.

**Fail:** Reconciler reports critical drift. Stop — investigate
drift before continuing.

---

### Cycle 1 Evidence Checklist

| # | Criterion | Evidence | Pass |
|---|-----------|----------|------|
| 1 | Worker exits with code 0 | Process exit code | |
| 2 | PR opened and merged | `gh pr list --head claude/issue-<N>` returns PR; PR merged | |
| 3 | Health gate passes post-merge | `node scripts/post-merge-health-gate.js --quick` exits 0 | |
| 4 | Health state is green | `.github/ai-state/main-health.json` shows `state: green` | |
| 5 | No fallback triggered | Fallback Log has no new entries | |
| 6 | State reconciler reports no critical drift | `state-reconciler.ps1` exit 0 | |
| 7 | Issue labeled `done` | Issue has `done` label | |
| 8 | No Codex intervention required | Operator did not invoke Codex | |

All eight criteria must pass. If any fail, do not proceed to
Cycle 2 — diagnose and resolve first.

---

## Cycle 2: Second Autonomous Cycle

Cycle 2 repeats the same sequence as Cycle 1 to prove the result
is reproducible, not a one-off. The two-cycle counter resets if
either cycle fails.

### Step 2.1 — Health Check and Marker

```powershell
node scripts/post-merge-health-gate.js --quick
./scripts/ai/write-main-health-state.ps1 -State <state> -Checks "tsc,build"
```

**Pass:** State `green`.

---

### Step 2.2 — Dry-Run Batch Proposal

```powershell
./scripts/ai/run-self-cycle.ps1 -PlanFirst -IssueLabel "agent:codex-action-needed" -Repo owner/name
```

**Pass:** Proposed batch with task count > 0.

---

### Step 2.3 — Launch Gate Validation

```powershell
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/issue-<N>.json
```

**Pass:** Exit code 0.

---

### Step 2.4 — Execute Cycle 2

```powershell
./scripts/ai/run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name -Execute
```

**Pass:** Worker dispatches successfully.

---

### Step 2.5 — Monitor Worker

```powershell
git worktree list
gh pr list --head claude/issue-<N>
```

**Pass:** Worker exits 0, PR opened.

---

### Step 2.6 — Review and Merge PR

```powershell
gh pr view <PR-N>
./scripts/ai/merge-clean-pr-batch.ps1 -PRs <N> -Repo owner/name -RunGuards -RunHealthGate -Execute
```

**Pass:** PR merges.

---

### Step 2.7 — Post-Merge Health Gate

```powershell
node scripts/post-merge-health-gate.js --quick
./scripts/ai/write-main-health-state.ps1 -State <state> -Checks "tsc,build"
```

**Pass:** State `green`.

---

### Step 2.8 — Issue Close and Reconciliation

```powershell
gh issue close <N> --comment "Completed via self-cycle runner. PR #<PR-N> merged."
./scripts/ai/state-reconciler.ps1 -Repo owner/name
```

**Pass:** Issue closed, reconciler clean.

---

### Cycle 2 Evidence Checklist

| # | Criterion | Evidence | Pass |
|---|-----------|----------|------|
| 1 | Worker exits with code 0 | Process exit code | |
| 2 | PR opened and merged | `gh pr list --head claude/issue-<N>` returns PR; PR merged | |
| 3 | Health gate passes post-merge | `node scripts/post-merge-health-gate.js --quick` exits 0 | |
| 4 | Health state is green | `.github/ai-state/main-health.json` shows `state: green` | |
| 5 | No fallback triggered | Fallback Log has no new entries | |
| 6 | State reconciler reports no critical drift | `state-reconciler.ps1` exit 0 | |
| 7 | Issue labeled `done` | Issue has `done` label | |
| 8 | No Codex intervention required | Operator did not invoke Codex | |

---

## Pass Criteria (Both Cycles)

The rehearsal passes when **all 16 criteria** (8 per cycle) are
satisfied across two consecutive cycles.

| # | Criterion | Verification |
|---|-----------|-------------|
| 1 | Worker exits with code 0 | Process exit code is 0 |
| 2 | PR opened and merged | `gh pr list --head claude/issue-<N>` returns PR; PR is merged |
| 3 | Health gate passes post-merge | `node scripts/post-merge-health-gate.js --quick` exits 0 |
| 4 | Health state is green | `.github/ai-state/main-health.json` shows `state: green` |
| 5 | No fallback triggered | Fallback Log in codex-retirement-runbook.md has no new entries |
| 6 | State reconciler reports no critical drift | `state-reconciler.ps1` exit 0 with no critical findings |
| 7 | Issue labeled `done` | Issue has `done` label after cycle completion |
| 8 | No Codex intervention required | Operator did not invoke Codex for dispatch, health, or merge routing |

---

## Failure and Rollback

### If a Cycle Fails

1. **Stop the rehearsal.** Do not proceed to the next cycle.
2. **Follow the safe fallback procedure** in
   [codex-retirement-runbook.md § Safe Fallback](codex-retirement-runbook.md#safe-fallback).
3. **Diagnose the failure** against the relevant gate:
   - Worker exit code non-zero → Gate 1 (runner autonomy)
   - Launch gate blocks → Gate 2 (launch enforcement)
   - Health gate fails → Gate 3 (health operational)
   - Merge guards fail → Gate 5 (merge control)
   - Reconciler drift → Gate 7 (observability)
4. **Do not re-attempt** until the root cause is resolved and the
   gate check passes again.
5. **The two-cycle counter resets.** Both cycles must pass
   consecutively — a failure in Cycle 2 requires restarting from
   Cycle 1.

### Escalation Paths

| Failure | Escalation | Action |
|---------|------------|--------|
| Health drops to red | Operator + `repo-owner` | Launch recovery worker per [main-health-policy.md](main-health-policy.md) |
| Runner bug (exit code 2) | File issue, tag `backend-programmer` | Do not restart until fix is merged |
| Provider exhaustion | Operator | Rotate or retry providers via WebUI Resources tab |
| Conflict group collision | Operator | Defer one task, relaunch the other |
| Worker stale > 10 min | Operator | Kill worker via CLI, investigate worktree |
| State drift (critical) | Operator + `repo-owner` | Resolve drift manually before resuming |

### Rollback to Codex Orchestration

If the rehearsal fails and cannot be resolved within the session:

1. Re-enable Codex orchestration by resuming the manual
   continuation SOP in [SOP.md](SOP.md).
2. File a follow-up issue for the failure root cause.
3. Do not re-attempt the rehearsal until the issue is resolved.

---

## Post-Rehearsal: Exit Announcement

When both cycles pass, announce the exit on the tracking issue:

```markdown
## Codex Exit Rehearsal — PASS

**Date:** <date>
**Operator:** <name>

### Cycle 1
| # | Criterion | Result |
|---|-----------|--------|
| 1 | Worker exit 0 | PASS |
| 2 | PR opened + merged | PASS — #<PR-N> |
| 3 | Health gate post-merge | PASS |
| 4 | Health state green | PASS |
| 5 | No fallback | PASS |
| 6 | Reconciler clean | PASS |
| 7 | Issue done label | PASS |
| 8 | No Codex intervention | PASS |

### Cycle 2
| # | Criterion | Result |
|---|-----------|--------|
| 1 | Worker exit 0 | PASS |
| 2 | PR opened + merged | PASS — #<PR-N> |
| 3 | Health gate post-merge | PASS |
| 4 | Health state green | PASS |
| 5 | No fallback | PASS |
| 6 | Reconciler clean | PASS |
| 7 | Issue done label | PASS |
| 8 | No Codex intervention | PASS |

**Conclusion:** Self-cycle runner is production-ready. Codex exits
routine orchestration. Escalation triggers documented in
codex-exit-readiness-gate.md remain active.
```

---

## Rehearsal Log

| Date | Operator | Cycle 1 | Cycle 2 | Result | Notes |
|------|----------|---------|---------|--------|-------|
| — | — | — | — | — | No rehearsals yet |

---

## WebUI Visibility During Rehearsal

The Command Steward console and related screens provide real-time
visibility throughout the rehearsal.

| Rehearsal Stage | WebUI Surface | What to Watch |
|-----------------|---------------|---------------|
| Pre-flight (Step x.1) | Operation Console → Health indicator | Green badge |
| Batch proposal (Step x.2) | Planning Console → Queue tab | Proposed tasks, no conflicts |
| Launch gate (Step x.3) | Command Steward → Recommended Actions | `Launch Batch` not blocked |
| Worker dispatch (Step x.4) | Operation Console → Workers tab | New worker, `running` status |
| Worker complete (Step x.5) | Operation Console → Workers tab | Worker `complete`, PR visible |
| Merge (Step x.6) | Merge Queue screen | PR with guard pass, human confirms |
| Post-merge (Step x.7) | Operation Console → Health indicator | Still green |
| Reconciliation (Step x.8) | Command Steward → Audit Trail | `issue-state` success entry |

---

## Relationship to Existing Docs

| Document | Role |
|----------|------|
| [codex-exit-readiness.md](codex-exit-readiness.md) | Per-gate readiness checks with verification commands |
| [codex-exit-readiness-gate.md](codex-exit-readiness-gate.md) | Gate decision rule, two-cycle acceptance test definition, re-entry conditions |
| [codex-retirement-runbook.md](codex-retirement-runbook.md) | Safe fallback, retirement checklist, daily workflow |
| **codex-exit-rehearsal.md** | **This doc** — operator-facing rehearsal script with exact commands |
| [command-steward-agent.md](command-steward-agent.md) | Command Steward role and workflows |
| [webui-command-steward-console.md](webui-command-steward-console.md) | WebUI surface for rehearsal visibility |

---

## References

- [codex-exit-readiness-gate.md](codex-exit-readiness-gate.md) — Gate decision rule and pass criteria.
- [codex-exit-readiness.md](codex-exit-readiness.md) — Gate definitions and verification commands.
- [codex-retirement-runbook.md](codex-retirement-runbook.md) — Safe fallback and retirement criteria.
- [loop-model.md](loop-model.md) — Self-cycle runner model.
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
- [command-steward-agent.md](command-steward-agent.md) — Command Steward workflows.
- [controlled-auto-merge.md](controlled-auto-merge.md) — Merge script safety guarantees.
