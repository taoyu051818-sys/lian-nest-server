# Codex Exit Readiness Gate

Defines the gate decision for removing Codex from daily orchestration,
the two-cycle full closure acceptance test that proves the self-cycle
runner is production-ready, and the conditions under which Codex
re-enters.

> **Closes:** [#1137](https://github.com/taoyu051818-sys/lian-nest-server/issues/1137)
>
> **Complements:**
> [codex-exit-readiness.md](codex-exit-readiness.md) for the
> per-gate readiness checks,
> [codex-retirement-runbook.md](codex-retirement-runbook.md) for
> full retirement criteria and fallback.

---

## Purpose

This document answers two questions:

1. **When is Codex allowed to exit?** — the gate rule that aggregates
   all readiness checks into a single go/no-go decision.
2. **How do we prove the exit is safe?** — the two-cycle closure
   acceptance test that must pass before Codex steps back.

---

## Gate Decision Rule

Codex exits the routine control loop when the
[codex-exit-readiness.md](codex-exit-readiness.md) verdict is
`ready` — all blocking gates pass.

| Gate | Blocking? | Source |
|------|-----------|--------|
| 1 — Self-Cycle Runner Autonomy | Yes | codex-exit-readiness.md |
| 2 — Launch Gate Enforcement | Yes | codex-exit-readiness.md |
| 3 — Health Gate Operational (3.1, 3.2) | Yes | codex-exit-readiness.md |
| 3.3 — Health Gate Auto-Trigger | **No** | post-exit upgrade |
| 4 — Recovery Path (4.1, 4.2) | Yes | codex-exit-readiness.md |
| 4.3 — Recovery Auto-Dispatch | **No** | post-exit upgrade |
| 5 — Merge Control | Yes | codex-exit-readiness.md |
| 6 — Human-Owned Boundaries | Yes | codex-exit-readiness.md |
| 7 — Observability | Yes | codex-exit-readiness.md |

Gates 3.3 and 4.3 are non-blocking. They improve automation maturity
but are not safety prerequisites. Without them, an operator runs the
health gate and launches recovery workers manually — slower but safe.

---

## Two-Cycle Full Closure Acceptance Test

Before Codex exits, two consecutive full cycles must complete without
fallback or human intervention (except human-owned decisions). Each
cycle traverses every loop phase end-to-end.

### Cycle Phases

```
plan → launch → monitor → merge → health → issue close → reconcile
```

| Phase | What Must Happen | Gate |
|-------|-----------------|------|
| Plan | Runner discovers issues, compiles tasks, proposes batch | Gate 1 |
| Launch | Launch gate validates health + conflict + locks; runner dispatches workers | Gate 2 |
| Monitor | Worker heartbeat tracks liveness; stale detection fires within 10 min | Gate 7 |
| Merge | Human approves PR; controlled merge script executes with guards | Gate 5 |
| Health | Post-merge health gate runs and classifies state (green/yellow/red) | Gate 3 |
| Issue Close | Done-issue closure runs; labels reconciled; umbrella issues refused | Gate 3 |
| Reconcile | State reconciler detects drift between issues, PRs, and labels | Gate 7 |

### Pass Criteria

Both cycles must satisfy:

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

### Failure During Acceptance

If either cycle fails:

1. Follow the [Safe Fallback](codex-retirement-runbook.md#safe-fallback)
   procedure in codex-retirement-runbook.md.
2. Diagnose the failure against the relevant gate.
3. Do not re-attempt the acceptance test until the root cause is
   resolved and the gate check passes again.
4. The two-cycle counter resets — both cycles must pass consecutively.

---

## Codex Re-Entry Conditions

After exit, Codex returns to routine orchestration **only** when one of
the following escalation triggers fires:

| Trigger | Condition | Action |
|---------|-----------|--------|
| **High-risk change** | PR touches `src/**`, `prisma/**`, auth, database, or security code | Codex assists with orchestration and review routing |
| **Architecture upgrade** | Structural migration, dependency overhaul, or cross-cutting refactor | Codex orchestrates the migration wave |
| **Stuck-system escalation** | Health stays red > 2 cycles, self-cycle runner fails with exit code 2, worker count drops to 0 for > 1 day, or legacy migration stalls | Codex re-engages for recovery orchestration |

Codex does **not** re-enter for:

- Routine docs-only or script-only tasks.
- Normal queue processing delays.
- Individual worker failures that the runner handles via deferral.

These are handled by the self-cycle runner and operator using the
[daily workflow](codex-retirement-runbook.md#daily-workflow-self-cycle-active).

---

## Relationship to Existing Docs

| Document | Role |
|----------|------|
| [codex-exit-readiness.md](codex-exit-readiness.md) | Defines per-gate readiness checks with verification commands |
| [codex-exit-readiness-gate.md](codex-exit-readiness-gate.md) | **This doc** — gate decision rule, two-cycle acceptance test, re-entry conditions |
| [codex-retirement-runbook.md](codex-retirement-runbook.md) | Full retirement criteria, fallback procedure, daily workflow |
| [codex-exit-readiness-verdict.md](codex-exit-readiness-verdict.md) | Machine-readable verdict schema for the planning console |
| [codex-exit-webui-criteria.md](codex-exit-webui-criteria.md) | WebUI-visible criteria for exit readiness |
| [loop-model.md](loop-model.md) | Self-cycle runner loop model |

---

## References

- [codex-exit-readiness.md](codex-exit-readiness.md) — Gate definitions and verification commands.
- [codex-retirement-runbook.md](codex-retirement-runbook.md) — Retirement checklist, safe fallback, daily workflow.
- [loop-model.md](loop-model.md) — Self-cycle runner model and loop phases.
- [controlled-auto-merge.md](controlled-auto-merge.md) — Merge script safety guarantees.
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
