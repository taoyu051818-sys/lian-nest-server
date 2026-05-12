# Guarded Autopilot Execute Policy

Defines how the self-cycle runner can move from preview to guarded
execute for low-risk operations without violating governance
boundaries.

> **Closes:** [#1250](https://github.com/taoyu051818-sys/lian-nest-server/issues/1250)
>
> **See also:**
> [self-cycle-autopilot-plan-mode.md](self-cycle-autopilot-plan-mode.md)
> for the dry-run autopilot plan,
> [self-cycle-runner.md](self-cycle-runner.md) for the standard
> orchestrator,
> [command-steward-agent.md](command-steward-agent.md) for the
> human-facing control-plane interface,
> [control-skill-registry.md](control-skill-registry.md) for the skill
> risk classification model,
> [launch-gate.md](launch-gate.md) for pre-launch validation.

---

## Purpose

The standard self-cycle runner has two modes:

1. **Dry-run** (default / `-AutopilotPlan`) — plans everything, executes
   nothing. Safe but requires a human to manually re-run with `-Execute`.
2. **Execute** (`-Execute`) — launches workers after human confirmation
   at every gate. Safe but requires the human to babysit each step.

**Guarded autopilot execute** defines a middle path: the self-cycle
runner can automatically execute certain low-risk, preview-validated
operations when all guard conditions pass. It reduces operator toil
for routine, low-risk batch launches while preserving the governance
hierarchy for anything high-risk.

The policy prevents three failure modes:

1. **Silent high-risk execution** — operations that touch `src/**`,
   `prisma/**`, auth, security, or database code must never auto-execute.
2. **Gate bypass** — health gates, launch gates, conflict group checks,
   and seed constitution boundaries cannot be skipped.
3. **Runaway batches** — hard safety limits on batch size and scope
   prevent unbounded automated execution.

---

## Preconditions for Guarded Execute

An operation may use guarded autopilot execute **only when every one
of the following conditions is true**:

| # | Condition | Gate |
|---|-----------|------|
| 1 | Main branch health is **green** | Health gate |
| 2 | All tasks pass the **launch gate** (conflict groups, shared locks, worker type policy) | Launch gate |
| 3 | All tasks are classified **low-risk** | Risk classification |
| 4 | All tasks have explicit **allowlists** (`allowedFiles` bounded to `docs/**`, `tests/**`, or config files) | Boundary |
| 5 | No task touches **high-risk files** (`src/**`, `prisma/**`, `.env`, auth/security code) | Boundary |
| 6 | Batch size does not exceed **MaxTasks** hard safety limit | Safety limit |
| 7 | No task targets a **forbidden file** pattern | Task contract |
| 8 | A **preview pass** completed successfully before execute | Preview-first |

If **any** precondition fails, the operation falls back to
human-gated execution. The runner does not downgrade, skip, or
weaken any gate.

---

## Preview-First Requirement

Every guarded execute must be preceded by a preview pass in the same
run. The pipeline enforces this as a two-phase commit:

```
Phase 1: Preview (always runs)
    - Validate inputs against task JSON schema
    - Run launch gate checks
    - Run health gate checks
    - Compute projected effects (files changed, issues targeted)
    - Produce structured preview result

         |
         v

Phase 2: Guarded Execute (only if all preconditions pass)
    - Re-validate preconditions from Phase 1
    - Execute the operation
    - Run post-execution health gate (if applicable)
    - Produce audit entry
```

The preview result must be **structurally identical** to what execute
will produce. If the preview shows `blocked` or `warnings`, guarded
execute does not proceed.

---

## Explicit Allowlists

Guarded execute operates only on explicit, bounded allowlists. There
is no implicit discovery, guessing, or expansion.

### Allowed File Patterns

| Pattern | Risk | Auto-Execute Eligible |
|---------|------|----------------------|
| `docs/**/*.md` | Low | Yes |
| `tests/**/*.test.*` | Low | Yes |
| `tests/**/*.spec.*` | Low | Yes |
| `.ai/*.json` (non-state) | Low | Yes |
| `tools/provider-pool-webui/actions/*.js` | Medium | No — requires human gate |
| `scripts/ai/*.ps1` | Medium | No — requires human gate |
| `src/**` | High | **Never** |
| `prisma/**` | High | **Never** |
| `.env` | Critical | **Never** |

### Task Contract Boundary

Each task JSON declares its `allowedFiles` set. The guarded execute
policy enforces that the intersection of `allowedFiles` and the
allowed file patterns above is non-empty. If a task requests files
outside the allowed patterns, it is rejected during the preview phase.

---

## Health Gate Requirements

| Health State | Guarded Execute Allowed |
|-------------|------------------------|
| `green` | Yes (all preconditions still apply) |
| `yellow` | No — human gate required |
| `red` | No — cycle blocked |
| `black` | No — cycle blocked |
| Missing | No — cycle blocked |

The health gate is checked at two points:

1. **Pre-execute** — before the guarded execute phase begins.
2. **Post-execute** — after the batch completes (when
   `-RunHealthGate` is applicable).

If post-execute health degrades, the runner reports the degradation
and pauses for human review. It does not launch additional workers.

---

## Risk Classification

Guarded execute is limited to **low-risk** operations as defined by
the control skill registry risk model:

| Risk Level | Confirmation | Guarded Execute |
|-----------|-------------|-----------------|
| `low` | Optional / implicit | Eligible |
| `medium` | Required | Not eligible — human gate |
| `high` | Required + human gate | Not eligible — human gate |
| `critical` | Typed phrase + reason | Not eligible — human gate |

Risk classification comes from the task JSON `risk` field and the
control skill registry metadata. The runner does not override or
downgrade risk levels.

---

## Rollback and Follow-Up Behavior

When guarded execute completes, the following behaviors apply:

### Success Path

1. Worker launches with bounded task contract.
2. Worker commits changes within `allowedFiles`.
3. Worker opens PR linked to target issue.
4. PR enters the standard review gate pipeline.
5. Merge remains **human-owned** — guarded execute does not merge.

### Failure Path

| Failure Type | Behavior |
|-------------|----------|
| Worker fails mid-task | Worker worktree is preserved for human review. No auto-retry. |
| Health degrades post-execute | Runner reports degradation. Subsequent batches paused for human review. |
| Launch gate fails on next batch | Cycle stops. Human must resolve the gate failure. |
| PR checks fail | PR remains open. Human reviews and decides (retry, close, or fix). |
| Conflict detected with in-flight worker | Current batch blocked. Human resolves the conflict. |

### Follow-Up Waves

Guarded execute does **not** initiate follow-up waves autonomously.
After a guarded batch completes, the runner produces a plan summary
and stops. The human decides whether to:

1. Launch the next wave with another guarded execute.
2. Switch to human-gated execution for higher-risk tasks.
3. Adjust scope or fix issues before continuing.

---

## Safety Invariants

These invariants are **hard constraints** that cannot be overridden,
configured, or bypassed:

1. **Always preview first.** No execute without a preceding preview in
   the same run.
2. **Low-risk only.** High-risk and critical operations always require
   human confirmation.
3. **Explicit allowlists.** No implicit file discovery or scope
   expansion.
4. **Health gate is mandatory.** Green health required for guarded
   execute. Yellow/red/black block or require human gate.
5. **No autonomous merge.** Merge decisions remain human-owned per
   the codex retirement runbook.
6. **No seed constitution bypass.** The seed constitution and its
   protected boundaries cannot be weakened by guarded execute.
7. **No follow-up waves.** The runner stops after one batch. The human
   decides the next action.
8. **Audit every invocation.** Every guarded execute produces an audit
   entry with the full precondition check results.
9. **Hard safety limits.** Max-task breach is a hard failure, not a
   warning. Batch size cannot exceed the configured limit.
10. **Fail-closed.** If any precondition check errors or returns an
    ambiguous result, the operation defaults to human-gated execution.

---

## Relationship to Existing Modes

| Mode | Flag(s) | Behavior |
|------|---------|----------|
| Standard dry-run | (none) | Stops at every human gate |
| Plan-first | `-PlanFirst` | Proposes batch, stops for review |
| Autopilot plan | `-AutopilotPlan` | Non-stop dry-run through all steps |
| Execute | `-Execute` | Launches workers after human confirmation |
| **Guarded execute** | `-Execute -Guarded` | Auto-execute low-risk tasks when all preconditions pass |

Guarded execute is a **subset** of execute mode. It applies the same
governance rules but allows the runner to proceed without intermediate
human confirmation for operations that meet all preconditions. Any
operation that fails a precondition reverts to the standard
human-gated execute flow.

---

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-Guarded` | `$false` | Enable guarded autopilot execute. Requires `-Execute`. |
| `-MaxTasks` | `10` | Hard safety limit on batch size. |
| `-RunHealthGate` | `$false` | Run post-execute health check. Recommended for guarded mode. |
| `-AllowedRiskLevels` | `low` | Comma-separated risk levels eligible for guarded execute. |

When `-Guarded` is passed without `-Execute`, the runner exits with
code 2 (fatal error). Guarded mode only applies to execute runs.

---

## Decision Flow

```
  ┌────────────────────┐
  │  Task submitted    │
  └────────┬───────────┘
           │
           v
  ┌────────────────────┐     ┌──────────────────────┐
  │  Preview pass      │────▶│  Preview blocked?    │
  └────────────────────┘     └──────────┬───────────┘
                                        │
                              ┌─────────┴──────────┐
                              │ Yes                 │ No
                              v                     v
                     ┌────────────────┐    ┌────────────────────┐
                     │ Human gate     │    │ Risk = low?        │
                     └────────────────┘    └────────┬───────────┘
                                                    │
                                          ┌─────────┴──────────┐
                                          │ No                 │ Yes
                                          v                    v
                                 ┌────────────────┐   ┌────────────────────┐
                                 │ Human gate     │   │ Health = green?    │
                                 └────────────────┘   └────────┬───────────┘
                                                               │
                                                     ┌─────────┴──────────┐
                                                     │ No                 │ Yes
                                                     v                    v
                                            ┌────────────────┐   ┌────────────────────┐
                                            │ Human gate     │   │ Launch gate pass?  │
                                            └────────────────┘   └────────┬───────────┘
                                                                           │
                                                                 ┌─────────┴──────────┐
                                                                 │ No                 │ Yes
                                                                 v                    v
                                                        ┌────────────────┐   ┌────────────────┐
                                                        │ Human gate     │   │ Guarded        │
                                                        └────────────────┘   │ Execute        │
                                                                              └────────────────┘
```

---

## Non-Goals

- This policy does not modify the self-cycle runner scripts — it
  defines the governance rules that would govern such modifications.
- This policy does not allow autonomous merge — merge remains
  human-owned.
- This policy does not weaken the seed constitution or any existing
  gate.
- This policy does not apply to high-risk, critical, or
  architecture-level operations.

---

## References

- [Self-Cycle Autopilot Plan Mode](self-cycle-autopilot-plan-mode.md)
  — dry-run autopilot plan
- [Self-Cycle Runner](self-cycle-runner.md) — standard orchestrator
- [Command Steward Agent](command-steward-agent.md) — human-facing
  control-plane interface
- [Control Skill Registry](control-skill-registry.md) — skill risk
  classification model
- [Launch Gate](launch-gate.md) — pre-launch validation policy
- [Main Health Policy](main-health-policy.md) — health state
  definitions
- [Bounded Experiment Policy](bounded-experiment-policy.md) — idea to
  experiment scoping
- [Codex Retirement Runbook](codex-retirement-runbook.md) —
  human-owned decisions
- [#1250](https://github.com/taoyu051818-sys/lian-nest-server/issues/1250)
  — this feature
