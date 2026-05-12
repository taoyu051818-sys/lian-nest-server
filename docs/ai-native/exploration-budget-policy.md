# Exploration Budget Policy

Defines resource limits and risk ceilings for agent-generated exploration
activities — research passes, discovery scans, and opportunity evaluation —
before they become committed work items.

> **Closes:** [#896](https://github.com/taoyu051818-sys/lian-nest-server/issues/896)

---

## Purpose

Agents generate opportunities through exploration: research tasks, dry-run
planning passes, stale-row detection, meta-signal analysis, and duplicate
route scanning. These activities consume tokens, wall-clock time, and API
budget without producing committed code. Without a governance policy,
exploration can silently overrun cost limits or escalate risk beyond what
the operator expects from a read-only pass.

This policy codifies:

1. What counts as an exploration activity
2. Resource ceilings (time, tokens, cost, API calls)
3. Risk classification for exploration outputs
4. Escalation when exploration exceeds its budget
5. How exploration feeds into the committed task pipeline

---

## Exploration Activities

An exploration activity is any agent action that reads, analyzes, or
proposes without mutating committed state (no PRs, no file writes outside
worktrees, no GitHub state changes beyond comments).

| Activity | Source | Output |
|----------|--------|--------|
| Research task | Task JSON with `taskType: "research"` | Report or recommendation |
| Dry-run planning | `plan-next-batch.ps1` (no `-Execute`) | Proposed batch plan |
| Stale-row detection | Planning loop Step 4a | Stale-row candidates |
| Meta-signal analysis | `calculate-meta-signals.js` | Signal snapshot |
| Duplicate route scan | `check-duplicate-route-tasks.js` | Conflict report |
| Opportunity evaluation | Planning console or meta-signal suggestions | Ranked suggestion list |
| Autopilot plan mode | `run-self-cycle.ps1 -AutopilotPlan` | Comprehensive dry-run plan |

---

## Resource Ceilings

Every exploration activity is bounded by four resource dimensions. The
tightest bound governs.

### Wall-Clock Time

| Exploration Type | Soft Limit | Hard Limit |
|------------------|:----------:|:----------:|
| Research task | 15 min | 30 min |
| Dry-run planning pass | 5 min | 10 min |
| Stale-row scan | 2 min | 5 min |
| Meta-signal calculation | 1 min | 3 min |
| Duplicate route scan | 2 min | 5 min |
| Autopilot plan mode | 10 min | 20 min |

Soft limits emit warnings. Hard limits force-publish partial results.

### Token Budget

| Exploration Type | Max Input Tokens | Max Output Tokens |
|------------------|:----------------:|:-----------------:|
| Research task | 200,000 | 50,000 |
| Dry-run planning pass | 50,000 | 10,000 |
| Stale-row scan | 20,000 | 5,000 |
| Meta-signal calculation | 10,000 | 2,000 |
| Duplicate route scan | 20,000 | 5,000 |
| Autopilot plan mode | 100,000 | 25,000 |

### Cost Ceiling

| Exploration Type | Max Estimated Cost (USD) |
|------------------|:------------------------:|
| Research task | $0.50 |
| Dry-run planning pass | $0.15 |
| Stale-row scan | $0.05 |
| Meta-signal calculation | $0.03 |
| Duplicate route scan | $0.05 |
| Autopilot plan mode | $0.30 |

Cost is calculated using the pricing reference in
[telemetry-budget-policy.md](telemetry-budget-policy.md).

### API Call Budget

| Exploration Type | Max GitHub API Calls |
|------------------|:--------------------:|
| Research task | 30 |
| Dry-run planning pass | 50 |
| Stale-row scan | 10 |
| Meta-signal calculation | 5 |
| Duplicate route scan | 20 |
| Autopilot plan mode | 60 |

API calls include `gh issue list`, `gh issue view`, `gh pr view`, and
similar read-only operations. Calls from the worker process itself
(counted via heartbeat telemetry) are separate from orchestrator calls.

---

## Risk Classification

Exploration outputs carry a risk classification that determines how they
enter the committed task pipeline.

| Risk Level | Criteria | Handling |
|------------|----------|----------|
| **Informational** | No actionable task generated. Pure observation. | Log to telemetry. No further action. |
| **Low** | Single docs-only or config task proposed. No code impact. | Auto-promote to task candidate if budget permits. |
| **Medium** | Code change proposed within a single module. | Human review required before task creation. |
| **High** | Cross-module change, schema modification, or security-adjacent proposal. | Human review + architect approval before task creation. |

### Risk Escalation Triggers

An exploration output escalates from its base risk when:

| Trigger | Escalation |
|---------|------------|
| Exploration touched > 10 source files | +1 risk level |
| Exploration consumed > 80% of any resource ceiling | +1 risk level |
| Exploration produced > 3 distinct task proposals | Cap at medium; split into separate tasks |
| Exploration involved security-sensitive paths (`auth`, `guard`, `middleware`) | Cap at medium minimum |

---

## Budget Enforcement

### Pre-Launch Check

Before any exploration activity starts, the orchestrator validates:

1. Sufficient token budget remains in the wave allocation.
2. GitHub API rate limit has headroom (reserve threshold from
   [resource-slot-scheduling.md](resource-slot-scheduling.md)).
3. No higher-priority committed task is waiting for the same provider slot.

If any check fails, the exploration is deferred.

### During Exploration

The worker self-reports resource consumption at heartbeat intervals
(default: 60 seconds). The heartbeat snapshot includes:

| Field | Type | Description |
|-------|------|-------------|
| `explorationTokensUsed` | integer | Running token count for this session |
| `explorationCostEstimate` | number | Running cost estimate (USD) |
| `explorationApiCalls` | integer | GitHub API calls made so far |
| `explorationBudgetPercent` | number | Percentage of tightest ceiling consumed |

### Graduated Response

| Budget Consumed | Action |
|-----------------|--------|
| < 50% | Normal operation. No action. |
| 50–80% | Log warning. Worker continues. |
| 80–100% | Log critical. Worker MUST produce partial output. |
| > 100% | Force-stop. Publish whatever is available. No extension. |

Unlike committed tasks, exploration activities do **not** receive extensions
beyond the hard limit. The cost ceiling is absolute.

---

## Exploration-to-Task Pipeline

Exploration outputs feed into the committed task pipeline through a
controlled handoff:

```
exploration activity
       │
       ▼
  exploration output (report, suggestion, candidate list)
       │
       ├── risk: informational  →  log telemetry, done
       │
       ├── risk: low            →  auto-promote to task candidate
       │                          (planner includes in next batch)
       │
       ├── risk: medium         →  human reviews output
       │                          if approved → task candidate
       │
       └── risk: high           →  human + architect reviews
                                  if approved → task candidate with
                                  elevated review requirements
```

### Auto-Promotion Rules

A low-risk exploration output auto-promotes to a task candidate when:

1. The output includes a valid `allowedFiles` boundary.
2. The output does not conflict with any in-flight task's conflict group.
3. The wave's committed task count has not reached `maxTasksPerWave`.
4. The main health state permits the proposed worker type.

If any condition fails, the output is held for human review.

### Budget Accounting

Exploration budgets are **separate** from committed task budgets. A wave
allocates:

| Budget Pool | Default Share | Purpose |
|-------------|:-------------:|---------|
| Exploration | 20% of wave token budget | Research, planning, discovery |
| Committed tasks | 80% of wave token budget | Execution, reviews, fixes |

The split is configurable per wave. Operators adjust via the wave manifest.

---

## Relationship to Existing Policies

| Policy | Relationship |
|--------|-------------|
| [Telemetry Budget Policy](telemetry-budget-policy.md) | Exploration budgets use the same pricing reference and token counting. Cost-overrun escalation is shared. |
| [Resource Slot Scheduling](resource-slot-scheduling.md) | Exploration consumes a provider slot while active. It competes with committed tasks for `effectiveSlots`. |
| [Planning Loop](planning-loop.md) | Dry-run planning and stale-row detection are exploration activities governed by this policy. |
| [Meta-Signal Task Suggestions](meta-signal-task-suggestions.md) | Opportunity evaluation is an exploration activity. Output risk determines promotion path. |
| [Worker Task Contract](worker-task-contract.md) | The `budgets` section of task JSON applies to committed tasks only. Exploration uses this policy's ceilings. |
| [Launch Policy](launch-policy.md) | Exploration activities do not pass through the launch gate. They are pre-gate discovery. |
| [Parallel Work Policy](parallel-work-policy.md) | Exploration activities are exempt from conflict group rules (read-only). Auto-promoted tasks are not. |

---

## Enforcement

- **Mode:** advisory-with-budget-enforcement
- **Enforced by:** orchestrator pre-launch check + worker self-report
- **Fail-closed:** yes — exploration that cannot validate budget is deferred

Workers SHOULD report exploration telemetry fields and respect ceilings.
Hard enforcement (force-stop at 100%) is implemented by the orchestrator,
not by workers themselves.

### Operator Override

Human operators may override exploration budgets per-wave:

- `explorationTokenBudget` — explicit token cap for the wave's exploration pool
- `explorationCostBudgetUsd` — explicit cost cap (USD)
- `explorationOverrideReason` — documented reason for the override

---

## Future Work

- [ ] Wire exploration telemetry fields into heartbeat snapshot schema
- [ ] Add exploration budget section to wave manifest schema
- [ ] Implement exploration budget tracking in the orchestrator
- [ ] Add exploration compliance to the worker acceptance checklist
- [ ] Create exploration budget telemetry dashboard in WebUI

---

## References

- [Telemetry Budget Policy](telemetry-budget-policy.md) — Cost limits and escalation
- [Resource Slot Scheduling](resource-slot-scheduling.md) — Slot allocation across dimensions
- [Planning Loop](planning-loop.md) — Dry-run planning and discovery
- [Meta-Signal Task Suggestions](meta-signal-task-suggestions.md) — Opportunity evaluation engine
- [Worker Task Contract](worker-task-contract.md) — Committed task schema
- [Launch Policy](launch-policy.md) — Health-state launch gating
- [Worker Heartbeat](worker-heartbeat.md) — Process liveness monitoring
