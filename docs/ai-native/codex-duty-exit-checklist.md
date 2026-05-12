# Codex Duty Exit Checklist

Defines the exit checklist for Codex orchestration duties. Each item
states what must be owned by Command Steward, WebUI, gates, or
self-cycle artifacts before Codex can step back from routine
orchestration.

> **Closes:** [#1260](https://github.com/taoyu051818-sys/lian-nest-server/issues/1260)
>
> **See also:**
> [codex-retirement-runbook.md](codex-retirement-runbook.md) for full
> retirement criteria and fallback,
> [codex-exit-readiness-gate.md](codex-exit-readiness-gate.md) for the
> gate decision rule and two-cycle acceptance test,
> [command-steward-agent.md](command-steward-agent.md) for the
> human-facing control-plane interface,
> [guarded-autopilot-execute-policy.md](guarded-autopilot-execute-policy.md)
> for guarded execute preconditions.

---

## Purpose

Codex currently acts as the manual orchestrator for worker dispatch,
health monitoring, merge routing, and issue triage. Before it can exit
that role, every duty must have a verified owner — either automated
(self-cycle artifacts, gates) or human (Command Steward, WebUI). This
checklist provides the per-duty ownership map and verification
commands.

---

## Duty Ownership Map

### 1. Worker Dispatch

| Item | Owner | Verification | Status |
|------|-------|-------------|--------|
| Issue discovery and batch proposal | Self-cycle (`plan-next-batch.ps1`) | `run-self-cycle.ps1 -PlanFirst` produces valid batch | MET |
| Launch gate validation | Gate (`check-launch-gate.ps1`) | Gate blocks invalid batches without human review | MET |
| Worktree creation and worker launch | Self-cycle (`batch-launch.ps1`) | Worker starts in isolated worktree | MET |
| Conflict group enforcement | Gate (launch gate) | Gate rejects colliding tasks | MET |
| Shared lock enforcement | Gate (launch gate) | Gate rejects locked resources | MET |

**Exit criterion:** Self-cycle runner chains discovery, gate check,
and dispatch without Codex routing. Human confirms at the launch gate.

---

### 2. Health Monitoring

| Item | Owner | Verification | Status |
|------|-------|-------------|--------|
| Post-merge health check | Gate (`post-merge-health-gate.js`) | `node scripts/post-merge-health-gate.js --quick` exits 0 | MET |
| Health state writer | Self-cycle (`write-main-health-state.ps1`) | `.github/ai-state/main-health.json` updated after merge | MET |
| Health gate auto-trigger after merge | CI (pending) | Health gate runs without manual invocation | PARTIAL |
| Health state classification | Gate (health policy) | State correctly classified green/yellow/red/black | MET |
| Red-state recovery dispatch | Self-cycle (pending) | Recovery worker launches automatically on red | PARTIAL |

**Exit criterion:** Health gate runs after every merge and writes the
state marker. Red-state recovery dispatches automatically. Until
auto-trigger and auto-dispatch are wired, an operator runs these
manually (safe but slower).

---

### 3. Merge Control

| Item | Owner | Verification | Status |
|------|-------|-------------|--------|
| PR eligibility check | Gate (merge script) | `merge-clean-pr-batch.ps1` rejects ineligible PRs | MET |
| Guard check integration | Gate (`-RunGuards`) | Guard failures block merge | MET |
| Post-merge health gate | Gate (`-RunHealthGate`) | Health runs after merge batch | MET |
| Merge approval | Human (Command Steward / WebUI) | Human confirms with `MERGE` phrase | MET |
| Batch merge execution | Self-cycle (`merge-clean-pr-batch.ps1`) | Script merges with `-Execute` flag | MET |

**Exit criterion:** Merge is human-owned. The self-cycle script
executes the merge; the human approves it. No change from current
design.

---

### 4. Issue Lifecycle

| Item | Owner | Verification | Status |
|------|-------|-------------|--------|
| Done-issue detection | Self-cycle (`state-reconciler.ps1`) | Reconciler flags merged-PR-open-issue drift | MET |
| Issue closure | Self-cycle (`issue-state` action) | Eligible issues closed with audit comment | MET |
| Label reconciliation | Self-cycle (`state-reconciler.ps1`) | Stale labels detected and reported | MET |
| Umbrella issue refusal | Gate (issue-state action) | Umbrella issues not auto-closed | MET |

**Exit criterion:** Issue lifecycle is handled by self-cycle artifacts.
Command Steward surfaces drift reports for human review.

---

### 5. Observability

| Item | Owner | Verification | Status |
|------|-------|-------------|--------|
| Worker heartbeat monitoring | Self-cycle (worker heartbeat) | Stale detection fires within 10 min | MET |
| State reconciliation | Self-cycle (`state-reconciler.ps1`) | Drift between issues, PRs, and labels detected | MET |
| Audit trail | WebUI (action audit store) | Every skill invocation logged | MET |
| Daily brief | Command Steward | Read-only state summary at session start | MET |

**Exit criterion:** Observability is split between self-cycle artifacts
(automated checks) and Command Steward (human-facing summaries).

---

### 6. Wave Sequencing

| Item | Owner | Verification | Status |
|------|-------|-------------|--------|
| Next-wave decision | Human (operator) | Human reviews completed PRs and decides | MET |
| Wave initiation | Human (Command Steward / WebUI) | Human confirms wave launch | MET |
| Follow-up wave blocking | Self-cycle (guarded execute policy) | Runner stops after one batch; no autonomous follow-up | MET |

**Exit criterion:** Wave sequencing is human-owned by design. The
self-cycle runner does not initiate follow-up waves.

---

### 7. Preview-First Enforcement

| Item | Owner | Verification | Status |
|------|-------|-------------|--------|
| Preview before execute | WebUI (action contract) | `preview()` called before `execute()` for all mutating skills | MET |
| Guarded execute preconditions | Gate (guarded execute policy) | All 8 preconditions pass before auto-execute | MET |
| Risk classification | Gate (control skill registry) | Low-risk only for guarded execute | MET |
| Explicit allowlists | Gate (task contract) | `allowedFiles` bounded to `docs/**`, `tests/**`, config | MET |

**Exit criterion:** Preview-first is enforced by the WebUI action
contract and the guarded execute policy. No live side effects without
preceding preview.

---

## Gate Summary

| Gate | Blocks Exit? | Current State |
|------|-------------|---------------|
| Self-cycle runner autonomy | Yes | MET |
| Launch gate enforcement | Yes | MET |
| Health gate operational | Yes | MET |
| Health gate auto-trigger | No (post-exit upgrade) | PARTIAL |
| Recovery worker auto-dispatch | No (post-exit upgrade) | PARTIAL |
| Merge control | Yes | MET |
| Human-owned boundaries | Yes | MET |
| Observability | Yes | MET |

Gates marked PARTIAL are non-blocking. Without them, an operator runs
the health gate and launches recovery workers manually.

---

## Two-Cycle Acceptance Test

Before Codex exits, two consecutive full cycles must complete without
fallback or Codex intervention. See
[codex-exit-readiness-gate.md](codex-exit-readiness-gate.md) for the
full acceptance test definition.

---

## Codex Re-Entry Conditions

Codex returns to routine orchestration only when:

1. A high-risk change touches `src/**`, `prisma/**`, auth, database,
   or security code.
2. An architecture upgrade requires migration wave orchestration.
3. Health stays red for more than 2 cycles, the self-cycle runner
   fails with exit code 2, or the worker count drops to 0 for more
   than 1 day.

Codex does **not** re-enter for routine docs-only or script-only
tasks, normal queue delays, or individual worker failures handled by
the runner.

---

## Non-Goals

- This document does not define runtime behavior — it defines the
  ownership map for Codex duties.
- This document does not weaken any existing gate or safety invariant.
- This document does not allow autonomous merge or follow-up waves.

---

## References

- [Codex Retirement Runbook](codex-retirement-runbook.md) — Full
  retirement criteria, safe fallback, daily workflow
- [Codex Exit Readiness Gate](codex-exit-readiness-gate.md) — Gate
  decision rule, two-cycle acceptance test, re-entry conditions
- [Command Steward Agent](command-steward-agent.md) — Human-facing
  control-plane interface
- [Guarded Autopilot Execute Policy](guarded-autopilot-execute-policy.md)
  — Guarded execute preconditions and safety invariants
- [Control Skill Registry](control-skill-registry.md) — Skill risk
  classification and governance rules
- [Self-Cycle Runner](self-cycle-runner.md) — Standard orchestrator
- [Loop Model](loop-model.md) — Self-cycle runner phases
