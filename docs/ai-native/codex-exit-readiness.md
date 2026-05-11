# Codex Exit Readiness

Defines exact readiness checks for removing Codex from the routine
control loop. When all checks pass, Codex exits orchestration and
only high-risk human approvals remain.

> **Closes:** [#614](https://github.com/taoyu051818-sys/lian-nest-server/issues/614)
>
> **Complements:** [codex-retirement-runbook.md](codex-retirement-runbook.md)
> for full retirement criteria and fallback,
> [self-cycle-operator-checklist.md](self-cycle-operator-checklist.md)
> for the operator's daily checklist.

---

## Purpose

This runbook answers one question: **Is Codex ready to stop acting as
the routine orchestrator?**

Exit readiness is not the same as full retirement. Retirement (defined
in [codex-retirement-runbook.md](codex-retirement-runbook.md)) requires
all legacy components at `RETIRED`. Exit readiness only requires that
the self-cycle runner handles routine orchestration without Codex
hand-holding, and that human-owned boundaries are enforced.

Codex remains available for escalation, recovery, and wave-level
decisions. It steps back from per-task dispatch, health checks, and
merge routing.

---

## Readiness Checks

All checks must pass before Codex exits the control loop. Each check
is testable and has a verification command.

### Gate 1: Self-Cycle Runner Autonomy

| # | Check | Verification | Status |
|---|-------|-------------|--------|
| 1.1 | Runner chains discovery, reconciliation, health check, launch gate, and batch dispatch | `run-self-cycle.ps1 -DryRunFixture ./tests/fixtures/self-cycle` exits 0 | **PASS** |
| 1.2 | Runner handles issue discovery via label | `run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo <owner/name>` compiles tasks in dry-run | **PASS** |
| 1.3 | Runner plan-first mode proposes batches | `run-self-cycle.ps1 -PlanFirst -IssueLabel "agent:codex-action-needed" -Repo <owner/name>` produces proposal | **PASS** |

### Gate 2: Launch Gate Enforcement

| # | Check | Verification | Status |
|---|-------|-------------|--------|
| 2.1 | Launch gate blocks tasks when health is red | `check-launch-gate.ps1` rejects runtime workers on red health | **PASS** |
| 2.2 | Launch gate enforces conflict groups | Two tasks with same non-doc `conflictGroup` are blocked | **PASS** |
| 2.3 | Launch gate enforces shared locks | Two tasks editing the same file without a lock are blocked | **PASS** |

### Gate 3: Health Gate Operational

| # | Check | Verification | Status |
|---|-------|-------------|--------|
| 3.1 | Post-merge health gate runs and classifies state | `node scripts/post-merge-health-gate.js --quick` exits with correct state | **PASS** |
| 3.2 | Health state writer records marker | `write-main-health-state.ps1 -State green -Checks "tsc,build"` produces `.github/ai-state/main-health.json` | **PASS** |
| 3.3 | Health gate auto-triggers after merge | CI wiring runs health gate after every merge to `main` | **BLOCKED** — requires CI wiring |

### Gate 4: Recovery Path

| # | Check | Verification | Status |
|---|-------|-------------|--------|
| 4.1 | Recovery worker types are defined in health policy | [main-health-policy.md](main-health-policy.md) lists foundation-fix and health-repair as always-permitted | **PASS** |
| 4.2 | Red state blocks non-recovery workers | Launch gate rejects runtime/docs/test workers on red | **PASS** |
| 4.3 | Recovery worker auto-dispatches on red | Self-cycle runner or CI launches recovery worker without human initiation | **BLOCKED** — trigger not wired |

### Gate 5: Merge Control

| # | Check | Verification | Status |
|---|-------|-------------|--------|
| 5.1 | Controlled merge script defaults to dry-run | `merge-clean-pr-batch.ps1 -PRs <N> -Repo <owner/name>` without `-Execute` performs no merges | **PASS** |
| 5.2 | Guard checks block boundary violations | `merge-clean-pr-batch.ps1 -PRs <N> -Repo <owner/name> -RunGuards` rejects PRs touching forbidden files | **PASS** |
| 5.3 | High-risk PRs require human approval | PRs touching `src/**`, `prisma/**`, `package.json` cannot auto-merge | **PASS** |

### Gate 6: Human-Owned Boundaries

| # | Check | Verification | Status |
|---|-------|-------------|--------|
| 6.1 | Seed constitution boundaries are enforced | [seed-constitution.md](seed-constitution.md) lists immutable high-risk boundaries | **PASS** |
| 6.2 | Workers cannot self-expand scope | Task JSON `allowedFiles` is immutable after launch (worker contract + boundary guard) | **PASS** |
| 6.3 | Next-wave decisions remain human-owned | Self-cycle runner pauses after wave completion; no auto-wave-launch | **PASS** |

### Gate 7: Observability

| # | Check | Verification | Status |
|---|-------|-------------|--------|
| 7.1 | State reconciler detects drift | `state-reconciler.ps1` reports stale-running, done-without-merge | **PASS** |
| 7.2 | Worker heartbeat monitors liveness | Worker heartbeat detects stale workers within 10 minutes | **PASS** |
| 7.3 | Result publisher posts structured summaries | `publish-agent-result.ps1` writes to issues/PRs | **PASS** |

---

## Decision Rule

Codex exits the routine control loop when **all checks in Gates 1, 2,
4 (4.1, 4.2), 5, 6, and 7** pass. Gates 3.3 and 4.3 are
**non-blocking** for exit readiness — they represent automation
upgrades, not prerequisites.

| Gate | Blocking for Exit? |
|------|-------------------|
| 1 — Self-Cycle Runner Autonomy | **Yes** |
| 2 — Launch Gate Enforcement | **Yes** |
| 3 — Health Gate Operational | 3.1, 3.2 yes; **3.3 no** |
| 4 — Recovery Path | 4.1, 4.2 yes; **4.3 no** |
| 5 — Merge Control | **Yes** |
| 6 — Human-Owned Boundaries | **Yes** |
| 7 — Observability | **Yes** |

### Why 3.3 and 4.3 Are Non-Blocking

Health gate auto-trigger (3.3) and recovery auto-dispatch (4.3) improve
automation maturity but do not affect safety. Without them, an operator
runs the health gate manually and launches recovery workers by hand.
This is slower but not unsafe. These are post-exit upgrades tracked in
[codex-retirement-runbook.md § Remaining Manual Gates](codex-retirement-runbook.md#remaining-manual-gates).

---

## Human-Required Boundaries After Exit

These boundaries survive Codex exit and require explicit human action.
No automation may perform them.

| Boundary | Why | Enforcement |
|----------|-----|-------------|
| Merge or block a PR | Architectural mismatch, scope drift, or security risk | `repo-owner` makes the final call |
| Launch or defer a wave | Wave dependencies require diff review | Human reviews diff, issues next wave |
| Approve auth or database cutover | Irreversible production impact | `architect` + `security-reviewer` sign-off |
| Override health gate | Gate may misclassify a flake as red | `repo-owner` overrides with documented reason |
| Modify seed constitution | Self-expansion guard | `architecture-review` role required |
| Add/remove worker types | Affects launch permissions globally | Human-authored PR with architect review |

See [codex-retirement-runbook.md § Human-Owned Decisions](codex-retirement-runbook.md#human-owned-decisions)
for the full list.

---

## Dry-Run Default Mandate

All write-capable automation defaults to dry-run. This is a hard
constraint, not a preference.

| Script | Default Mode | Execute Flag |
|--------|-------------|--------------|
| `run-self-cycle.ps1` | Dry-run | `-Execute` |
| `merge-clean-pr-batch.ps1` | Dry-run | `-Execute` |
| `batch-launch.ps1` | Dry-run | `-Execute` |
| `write-main-health-state.ps1` | Dry-run | (writes by default; use `-DryRun` to suppress) |
| `worktree-janitor.ps1` | Dry-run | `-RemoveMerged` |

Workers and operators must always dry-run first. Execute mode requires
explicit confirmation or the `-Execute` flag. See
[self-cycle-runner.md § Design Constraints](self-cycle-runner.md#design-constraints).

---

## Exit Procedure

When all blocking checks pass, follow this procedure to exit Codex
from the control loop.

### Step 1: Verify Readiness

Run each verification command in the readiness checks table above.
Record pass/fail for each gate.

### Step 2: Announce Exit

Comment on the tracking issue (#614) with:
- The readiness check results table.
- The date of the last successful self-cycle run.
- The operator who will own the first post-exit cycle.

### Step 3: First Post-Exit Cycle

The operator runs the self-cycle runner without Codex assistance:

```powershell
# Morning: health check + dry-run
node scripts/post-merge-health-gate.js --quick
./scripts/ai/write-main-health-state.ps1 -State <state> -Checks "tsc,build"
./scripts/ai/run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name

# After review: execute
./scripts/ai/run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name -Execute
```

### Step 4: Monitor for Escalation Triggers

After exit, watch for these signals that require Codex re-engagement:

| Signal | Action |
|--------|--------|
| Health stays red for > 2 cycles | Re-engage Codex for recovery orchestration |
| Self-cycle runner fails with exit code 2 | Investigate; re-engage Codex if runner bug |
| Worker count drops to 0 for > 1 day | Check issue queue; re-engage Codex if queue is stuck |
| Legacy migration stalls | Re-engage Codex for migration orchestration |

### Step 5: Record the Exit

Update the retirement checklist in
[codex-retirement-runbook.md](codex-retirement-runbook.md#retirement-checklist)
to mark exit-readiness items as complete.

---

## Relationship to Codex Retirement

Exit readiness is a subset of full retirement:

| Concept | Definition | This Doc |
|---------|-----------|----------|
| **Exit readiness** | Codex stops routine orchestration; self-cycle runner handles dispatch | Defines and checks |
| **Full retirement** | All legacy components at `RETIRED`; Codex role removed from roles.md | Tracked in codex-retirement-runbook.md |

Codex can exit the control loop before full retirement. The remaining
retirement work (legacy migration, CI wiring for gates 3.3 and 4.3)
continues after exit.

---

## References

- [codex-retirement-runbook.md](codex-retirement-runbook.md) — Full retirement criteria, fallback, daily workflow.
- [self-cycle-operator-checklist.md](self-cycle-operator-checklist.md) — Operator's daily checklist.
- [seed-constitution.md](seed-constitution.md) — Immutable boundaries.
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
- [SOP.md](SOP.md) — Full AI-native development lifecycle.
- [loop-model.md](loop-model.md) — Self-cycle runner model.
- [controlled-auto-merge.md](controlled-auto-merge.md) — Merge script safety guarantees.
- [risk-policy.md](risk-policy.md) — High-risk categories and merge gates.
