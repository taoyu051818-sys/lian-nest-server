# Priority-Aware Scheduling Investigation

Investigates three scheduling gaps identified in the external intake
self-assessment: priority-aware task ordering, resource-aware slot allocation,
and conflict-group work-stealing.

> **Closes:** [#1450](https://github.com/taoyu051818-sys/lian-nest-server/issues/1450)

---

## Current State

LIAN scheduling is flat: conflict-group mutex is the only concurrency control.
The batch launcher (`batch-launch.ps1`) enforces these invariants:

1. Tasks in the same conflict group run sequentially.
2. Tasks sharing a `sharedLock` are serialized.
3. Effective parallelism = min(provider slots, local resource slots,
   conflict-safe slots, review capacity, merge capacity, failure budget).
4. Waves are built by `Build-Waves` which groups tasks by conflict group,
   ensuring no two tasks in the same wave share a group or lock.

**What exists:**

| Capability | Status | Location |
|-----------|--------|----------|
| Conflict-group mutex | Implemented | `allocate-conflict-groups.js`, `batch-launch.ps1` |
| Shared locks | Implemented | `allocate-conflict-groups.js`, `parallel-work-policy.md` |
| Resource slot model | Planning doc only | `resource-slot-scheduling.md` |
| Risk-tier concurrency | Implemented | `task-dag-scheduling-policy.md` |
| Composite scoring | Ad-hoc | `plan-next-batch.ps1` (risk + trust + pain keywords) |
| Priority field in task JSON | **Missing** | `worker-task-contract.md` |
| Work-stealing | **Missing** | No implementation or doc |
| Resource-aware slot allocation | **Partial** | Model defined, no allocator script |

---

## Gap 1: Priority-Aware Task Ordering

### Problem

The task JSON contract (`worker-task-contract.md`) has no `priority` field.
`plan-next-batch.ps1` uses a `compositeScore` derived from risk level, trust
penalty, and pain-keyword demotion, but this is not a formal priority system.
External intake proposals carry a `"priority"` string (low/medium/high) in
their fixture format, but the batch launcher ignores it.

The self-cycle aggregation layer (`aggregate-self-cycle-candidates.js`) has
`PRIORITY_RANK = {info:0, low:1, medium:2, high:3, critical:4}`, but this
is disconnected from the launcher.

### Gap Analysis

| Need | Current State | Gap |
|------|--------------|-----|
| Tasks tagged with priority | No `priority` field in task contract | Task contract must be extended |
| Priority used in wave ordering | `compositeScore` is ad-hoc, not priority-driven | Launcher must consume priority |
| Priority from external intake | Fixture has `priority` field, launcher ignores it | Intake-to-launcher pipeline broken |
| Priority from risk signals | Risk signal severity exists but not mapped to task priority | Signal-to-priority mapping needed |

### Proposed Design

**Task contract extension** (add to `worker-task-contract.md`):

```json
{
  "priority": "high"
}
```

Valid values: `critical`, `high`, `normal`, `low`. Default: `normal`.

**Priority sources:**

| Source | Mapping | Notes |
|--------|---------|-------|
| External intake proposal | Direct `priority` field | Already present in fixture format |
| Risk signal severity | `critical`→`critical`, `high`→`high`, `medium`→`normal`, `low`/`info`→`low` | Mapped by `calculate-meta-signals.js` |
| CONTROL APPENDIX | `risk: high` → `priority: high`, `risk: low` → `priority: normal` | Inferred from risk field |
| Operator override | Manual assignment | Via issue label or comment |

**Wave ordering change** in `batch-launch.ps1`:

Current: tasks ordered by `compositeScore` (ad-hoc).

Proposed: tasks ordered by priority first, then by compositeScore within
the same priority band:

```
critical tasks  → dispatched first, solo wave if risk warrants
high tasks      → dispatched before normal
normal tasks    → default
low tasks       → dispatched last, may be deferred if slots are scarce
```

Within a priority band, the existing merge-order heuristic (fewer dependents
first, smaller diff on tie) still applies.

**Slot reservation for critical tasks:**

When a `critical` task is ready but all slots are occupied by `normal` or
`low` tasks, the launcher MAY preempt a `low` task (pause its wave and
re-queue) if the operator has enabled preemption in the slot policy. This
is opt-in and off by default.

### Integration Points

| Component | Change Required |
|-----------|----------------|
| `worker-task-contract.md` | Add `priority` field (optional, default `normal`) |
| `compile-issue-to-task-json.ps1` | Map risk/labels to `priority` |
| `plan-next-batch.ps1` | Sort by priority before compositeScore |
| `batch-launch.ps1` | `Build-Waves` respects priority ordering |
| `aggregate-self-cycle-candidates.js` | Align `PRIORITY_RANK` with new field |

### Non-Goals

- No changes to `src/**` or `prisma/**`.
- No changes to `package.json`.
- Preemption is a future opt-in, not part of initial implementation.

---

## Gap 2: Resource-Aware Slot Allocation

### Problem

The resource slot model (`resource-slot-scheduling.md`) defines four
dimensions (provider quota, local machine, GitHub API, user max) and a
decision flow, but no allocator script exists. The launcher currently
checks capacity in an ad-hoc way. There is no feedback loop from
resource pressure to task ordering.

### Gap Analysis

| Need | Current State | Gap |
|------|--------------|-----|
| Provider capacity respected | `provider-pool.json` exists, launcher reads it | No formal slot allocator |
| Memory limits respected | `local-resource.json` exists with CPU/mem thresholds | No per-worker memory budget |
| Resource pressure affects ordering | No integration | High-pressure → defer low-priority |
| Slot telemetry | Model defined, no writer | No utilization tracking |

### Proposed Design

**Slot allocator script** (`scripts/ai/allocate-resource-slots.js`):

```
Input:  active-workers.json, provider-pool.json, local-resource.json
Output: available slots per dimension, bottleneck dimension, recommended dispatch count
```

The allocator computes:

```
providerSlots = sum(maxConcurrency for available providers) - activeProviderCount
localSlots    = min(floor(freeCores / coresPerWorker), floor(freeRamMB / ramPerWorkerMB))
githubSlots   = floor(remainingApiCalls / callsPerWorker)
userMaxSlots  = globalMaxWorkers - activeWorkerCount

effectiveSlots = min(providerSlots, localSlots, githubSlots, userMaxSlots)
```

**Resource-pressure-aware deferral:**

When any dimension is below 20% capacity (configurable threshold), the
launcher defers `low` priority tasks until pressure eases. This prevents
low-value work from consuming scarce resources.

```
if anyDimensionBelow(threshold=0.2):
    skip tasks with priority == "low"
    log "deferred:low-priority:resource-pressure"
```

**Per-worker memory budget:**

The `ramPerWorkerMB` parameter (default 512) is enforced by checking
available RAM before each dispatch. If free RAM < `ramPerWorkerMB`,
the launcher blocks with `blocked:local-capacity`.

### Integration Points

| Component | Change Required |
|-----------|----------------|
| `scripts/ai/allocate-resource-slots.js` | New script (read-only, no secrets) |
| `batch-launch.ps1` | Call allocator before dispatch, log slot telemetry |
| `check-launch-gate.ps1` | Consume allocator output for gate validation |
| `resource-slot-scheduling.md` | Mark slot allocator as implemented |

### Non-Goals

- No changes to `src/**` or `prisma/**`.
- No changes to `package.json`.
- No runtime memory enforcement (planning/scheduling only).

---

## Gap 3: Conflict-Group Work-Stealing

### Problem

When a conflict-group slot is free (the group's active worker finished)
but no tasks in that group are ready (blocked on dependency, health gate,
or human approval), the slot sits idle. Other groups may have ready tasks
that cannot launch because all slots are consumed by the idle group's
peers.

LIAN has no mechanism to "steal" an idle slot and reassign it to a ready
task in a different group.

### Gap Analysis

| Need | Current State | Gap |
|------|--------------|-----|
| Detect idle conflict-group slots | No detection | Launcher does not track "ready but blocked" state |
| Reassign idle slots to other groups | No mechanism | Slots are group-agnostic but launcher doesn't exploit this |
| Prevent starvation | No mechanism | Low-priority groups could be starved if high-priority always steals |

### Proposed Design

**Ready-state tracking:**

Extend the task queue state to track three states per task:

| State | Meaning |
|-------|---------|
| `ready` | All dependencies met, can launch when slot available |
| `blocked` | Waiting on dependency merge, health gate, or human |
| `queued` | In batch but not yet evaluated for readiness |

**Work-stealing rule:**

A slot is "stealable" when:

1. The slot's conflict group has no `ready` tasks.
2. Another conflict group has `ready` tasks.
3. The ready task's priority >= the slot's original group's highest
   blocked task priority.

The launcher reassigns the slot to the highest-priority ready task in
any conflict group. When the original group's task becomes ready, it
reclaims its slot at the next dispatch cycle (no preemption of the
stealing task).

```
for each idle slot (conflict group has no ready tasks):
    candidates = all ready tasks in other groups, sorted by priority desc
    if candidates[0].priority >= blockedGroup.maxPriority:
        dispatch candidates[0] into the idle slot
        log "stolen:slot:{conflictGroup}->{candidateGroup}"
```

**Starvation prevention:**

A task that has been `ready` for more than N dispatch cycles without
receiving a slot gets a priority boost. This prevents high-priority
tasks from permanently starving low-priority tasks.

```
if task.readyCycles > STARVATION_THRESHOLD:
    effectivePriority = min(task.priority + 1, critical)
```

### Integration Points

| Component | Change Required |
|-----------|----------------|
| `batch-launch.ps1` | Track ready/blocked/queued state, implement stealing loop |
| `plan-next-batch.ps1` | Emit ready-state metadata in batch proposal |
| `check-launch-gate.ps1` | Validate stolen-slot dispatch (no conflict group collision) |
| `parallel-work-policy.md` | Document work-stealing rules and starvation prevention |

### Non-Goals

- No changes to `src/**` or `prisma/**`.
- No changes to `package.json`.
- No preemption of in-flight workers (only idle slot reassignment).

---

## External Framework Comparison

### CrewAI Flow Orchestration

CrewAI supports priority queuing via task metadata and resource-aware
scheduling via crew-level capacity limits. Key patterns relevant to LIAN:

- **Priority queue:** Tasks declare priority; the dispatcher always picks
  the highest-priority ready task.
- **Resource-aware slots:** Each crew has a `max_agents` cap; the
  dispatcher respects it globally.
- **Work-stealing:** When a crew is idle, its agents can be reassigned
  to tasks from other crews.

LIAN can adopt the priority queue and work-stealing patterns without
adopting CrewAI's crew model (LIAN uses conflict groups instead).

### LangGraph Parallel Branches

LangGraph supports parallel branches with merge points. Key patterns:

- **Branch independence:** Parallel branches are independent until a
  merge node. LIAN's conflict groups are analogous — independent groups
  can run in parallel until a shared resource (merge point) is needed.
- **Fan-out/fan-in:** LangGraph fans out to parallel tasks and fans in
  at a barrier. LIAN's wave model does the same (Build-Waves creates
  parallel waves, wait-parallel-workers is the barrier).

LIAN's wave model already captures the fan-out/fan-in pattern. The gap
is in priority-aware ordering within waves and work-stealing across waves.

### What LIAN Should Adopt

| Pattern | Source | Applicability |
|---------|--------|---------------|
| Priority queue | CrewAI | Direct adoption — add `priority` field, sort by it |
| Resource-aware slots | CrewAI, resource-slot-scheduling.md | Already modeled, needs allocator script |
| Work-stealing | CrewAI | Adapted for conflict groups instead of crews |
| Fan-out/fan-in | LangGraph | Already implemented via wave model |

---

## Implementation Roadmap

### Phase 1: Priority Field (Low Risk, No Script Changes)

1. Add `priority` field to `worker-task-contract.md` (optional, default `normal`).
2. Update `compile-issue-to-task-json.ps1` to map risk/labels to priority.
3. Update `plan-next-batch.ps1` to sort by priority.
4. Update `batch-launch.ps1` `Build-Waves` to respect priority ordering.

**Files:** `docs/ai-native/worker-task-contract.md`,
`scripts/ai/compile-issue-to-task-json.ps1`,
`scripts/ai/plan-next-batch.ps1`,
`scripts/ai/batch-launch.ps1`

### Phase 2: Resource Slot Allocator (Low Risk, New Script)

1. Implement `scripts/ai/allocate-resource-slots.js` (read-only).
2. Integrate into `batch-launch.ps1` before dispatch.
3. Add resource-pressure deferral for low-priority tasks.
4. Write slot utilization telemetry.

**Files:** `scripts/ai/allocate-resource-slots.js`,
`scripts/ai/batch-launch.ps1`,
`docs/ai-native/resource-slot-scheduling.md`

### Phase 3: Work-Stealing (Medium Risk, Launcher Changes)

1. Add ready/blocked/queued state tracking to batch launcher.
2. Implement idle-slot detection and reassignment loop.
3. Add starvation prevention (priority boost after threshold).
4. Update `parallel-work-policy.md` with stealing rules.

**Files:** `scripts/ai/batch-launch.ps1`,
`docs/ai-native/parallel-work-policy.md`,
`scripts/ai/plan-next-batch.ps1`

### Phase 4: Telemetry and Monitoring (Low Risk, New Script)

1. Emit slot utilization records after each dispatch cycle.
2. Track work-stealing events in gap ledger.
3. Add priority distribution metrics to meta-signals.

**Files:** `scripts/ai/write-gap-ledger.js`,
`scripts/ai/calculate-meta-signals.js`

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Priority inversion (low blocks high) | Medium | Starvation prevention + priority boost |
| Work-stealing causes conflict | Medium | Steal only into conflict-safe slots, re-validate at gate |
| Resource pressure miscalculation | Low | Conservative thresholds, fail-closed |
| Backward compatibility (no priority field) | Low | Default to `normal`, existing tasks unaffected |

---

## Validation

Each phase should be validated with:

```bash
npm run check
node scripts/ai/allocate-conflict-groups.test.js
node scripts/ai/batch-launch.ps1 -DryRun
```

Phase 2 additionally:

```bash
node scripts/ai/allocate-resource-slots.js --help
node scripts/ai/allocate-resource-slots.js --dry-run
```

---

## References

- [Resource Slot Scheduling](resource-slot-scheduling.md) — Four-dimension slot model
- [Parallel Work Policy](parallel-work-policy.md) — Conflict group rules
- [Backend Worker Layers](backend-worker-layers.md) — Layer model and launch order
- [Bounded Parallel Worker Execution](bounded-parallel-worker-execution.md) — Wave model
- [Task DAG Scheduling Policy](task-dag-scheduling-policy.md) — Pipeline DAG and edge rules
- [Conflict Group Allocator](conflict-group-allocator.md) — Union-Find group assignment
- [Active Worker Resource Sampler](active-worker-resource-sampler.md) — Process resource sampling
- [Gap Ledger](gap-ledger.md) — Gap event recording
- [External Intake Executable Loop](external-intake-executable-loop.md) — Intake pipeline
- [#1450](https://github.com/taoyu051818-sys/lian-nest-server/issues/1450) — This investigation
