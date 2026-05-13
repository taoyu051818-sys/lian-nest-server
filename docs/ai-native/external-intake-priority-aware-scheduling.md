# External Intake Priority-Aware Scheduling

Investigation into priority queuing, resource-aware scheduling, and
work-stealing for the external intake path. Current scheduling is flat:
conflict-group mutex is the only concurrency control. No priority field
exists on tasks, no resource-aware slot allocation beyond the basic
four-dimension model, and no work-stealing mechanism.

> **Closes:** [#1503](https://github.com/taoyu051818-sys/lian-nest-server/issues/1503)

---

## Current State

### Scheduling Pipeline

```
plan-next-batch.ps1 (candidate selection)
  -> check-launch-gate.ps1 (health + conflict validation)
    -> allocate-conflict-groups.js (conflict group assignment)
      -> plan-concurrency-backfill.js (wave planning)
        -> batch-launch.ps1 (worker dispatch)
          -> wait-parallel-workers.ps1 (wave completion)
```

### What Exists

| Capability | Status | Location |
|-----------|--------|----------|
| Conflict-group mutex | Implemented | `allocate-conflict-groups.js`, `batch-launch.ps1` Build-Waves |
| Shared lock serialization | Implemented | `allocate-conflict-groups.js` (4 lock types) |
| Risk-tier concurrency | Implemented | `batch-launch.ps1` (high-risk solo waves) |
| Static priority ordering | Defined | `resource-slot-scheduling.md` (5 tiers: foundation > health > runtime > docs > research) |
| Meta-signals ranking | Implemented | `plan-next-batch.ps1` (composite score = riskRank + trustPenalty) |
| Pain demotion | Implemented | `plan-next-batch.ps1` (top-pain tasks get +2 offset) |
| Resource slot model | Defined | `resource-slot-scheduling.md` (4 dimensions: provider, local, GitHub API, user-max) |
| External intake signals | Implemented | `external-intake-executable-loop.md` (capture → classify → score → route) |

### What Does NOT Exist

| Gap | Impact |
|-----|--------|
| No `priority` field on tasks | External intake signals cannot express urgency (critical/high/normal/low) |
| No priority-aware wave ordering | All tasks within a risk tier sort the same; urgent work waits behind routine work |
| No resource-aware slot allocation | Slot model is defined but not implemented; launcher uses flat `globalMaxWorkers` |
| No work-stealing | When a conflict-group slot is free but no tasks in that group are ready, the slot sits idle |
| No external-intake-to-priority bridge | Risk signals have severity weights but they don't flow into task scheduling priority |

---

## Gap Analysis

### Gap 1: No Priority Field on Tasks

The task contract (`worker-task-contract.md`) and CONTROL APPENDIX schema
have no `priority` field. The planner sorts by readiness, then composite
score, then issue number. External intake signals (risk signals with
severity `critical`/`high`/`medium`/`low`/`info`) have severity weights
but these only affect `meta-signals.json` aggregate scores — they don't
assign priority to individual tasks.

**Current flow:**
```
external fact → risk signal (severity: critical)
  → calculate-meta-signals.js → riskScore elevated
    → plan-next-batch.ps1 → composite score adjusted
      → sort order shifted (but no per-task priority)
```

**Missing link:** A critical CVE risk signal elevates the aggregate
riskScore, which shifts the composite score for ALL tasks uniformly.
There is no mechanism to say "this specific task is critical because
it addresses a critical risk signal."

### Gap 2: No Priority-Aware Wave Ordering

`plan-concurrency-backfill.js` uses greedy bin-packing with two rules:
- High-risk tasks get solo waves
- Normal tasks are packed into waves respecting conflict group constraints

There is no priority-based ordering within waves. If 5 low-risk tasks
are eligible and 3 slots exist, the selection is arbitrary (or by issue
number). A critical external-intake task has no way to preempt or outrank
a routine docs task.

### Gap 3: No Work-Stealing

When the launcher builds waves, it processes conflict groups in order.
If group A has no ready tasks but group B has 3 ready tasks, group A's
slot sits idle. There is no mechanism to "steal" the idle slot and
assign it to a task from a different group.

**Example:**
```
Wave 1 slots: 3
Conflict groups: auth (1 ready), docs (0 ready), runtime (2 ready)
Current behavior: auth gets 1 slot, runtime gets 2 slots, docs slot idle
With work-stealing: auth gets 1 slot, runtime gets 2 slots (full utilization)
```

In practice this is less critical because the conflict-group allocator
already groups by overlap, so "no ready tasks in a group" is rare.
But it matters when external intake creates urgent tasks in a group
that has no other ready tasks.

### Gap 4: Resource-Aware Slot Allocation

The four-dimension slot model in `resource-slot-scheduling.md` is
well-defined but not implemented. The launcher currently uses only
`globalMaxWorkers` as a flat cap. The provider quota, local machine
capacity, and GitHub API dimensions are documented but not wired into
the dispatch logic.

This means the launcher cannot respect provider capacity limits or
memory constraints at dispatch time.

---

## Proposed Design

### Priority Field

Add an optional `priority` field to the task contract and CONTROL
APPENDIX schema:

| Priority | Value | Behavior |
|----------|-------|----------|
| `critical` | 4 | Launches first; may preempt waiting tasks in other groups |
| `high` | 3 | Launches before normal/low; respected within wave packing |
| `normal` | 2 | Default; current behavior |
| `low` | 1 | Launches last; fills remaining slots |

**Integration point:** The CONTROL APPENDIX already has a `risk` field.
Priority is orthogonal — a low-risk research task could be critical
(e.g., investigate a production outage) while a high-risk runtime
task could be normal (routine refactor).

**Backward compatibility:** When `priority` is absent, default to
`normal`. Existing issues without the field continue to work.

### External-Intake-to-Priority Bridge

Connect risk signal severity to task priority:

```
risk signal severity → priority mapping:
  critical → critical (if task's allowedFiles overlap affectedAreas)
  high     → high (if task addresses the risk domain)
  medium   → normal (no priority boost)
  low/info → normal (no priority boost)
```

This mapping happens at `compile-issue-to-task-json.ps1` time, when
the task contract is generated. The compiler reads risk signals and
assigns priority based on overlap between the task's allowedFiles and
the risk signal's affectedAreas.

### Priority-Aware Wave Packing

Modify `plan-concurrency-backfill.js` to sort candidates by priority
before bin-packing:

```
1. Sort candidates: critical > high > normal > low
2. Within same priority: readiness first, then composite score
3. Bin-pack into waves respecting conflict groups and shared locks
4. Higher-priority tasks fill waves first
```

This is a small change to the sort comparator — the bin-packing
algorithm itself doesn't change.

### Work-Stealing (Slot Recycling)

When building a wave, if a conflict group has no ready tasks but slots
remain, recycle those slots to the next ready task regardless of group:

```
Build-Waves (modified):
  1. For each slot in effectiveSlots:
     a. Pick highest-priority ready task whose conflictGroup is not in this wave
     b. If no such task exists, pick any ready task (work-stealing)
     c. If still no task, leave slot empty
```

This is a minor extension to the existing `Build-Waves` function in
`batch-launch.ps1`. The conflict-group mutex is preserved — a stolen
slot still cannot run two tasks from the same group simultaneously.

### Resource-Aware Slots (Future)

Implement the four-dimension slot model from `resource-slot-scheduling.md`:

1. Read `provider-pool.json` → `providerQuotaSlots`
2. Query local machine → `localMachineSlots`
3. Check GitHub API rate limit → `githubApiSlots`
4. Read `active-workers.json` → `userMaxSlots`
5. `effectiveSlots = min(all four)`

This replaces the current flat `globalMaxWorkers` check. It is the
largest change and should be a separate issue/PR.

---

## Implementation Plan

### Phase 1: Priority Field (Low Risk)

| Step | File | Change |
|------|------|--------|
| 1 | `docs/ai-native/worker-task-contract.md` | Document `priority` field |
| 2 | `scripts/ai/compile-issue-to-task-json.ps1` | Parse `priority` from CONTROL APPENDIX, default `normal` |
| 3 | `scripts/ai/plan-next-batch.ps1` | Add priority to sort order (before composite score) |

**Scope:** docs/ai-native/** and scripts/ai/** only. No src/** changes.

### Phase 2: Priority-Aware Wave Packing (Low Risk)

| Step | File | Change |
|------|------|--------|
| 1 | `scripts/ai/plan-concurrency-backfill.js` | Sort by priority before bin-packing |
| 2 | `scripts/ai/plan-concurrency-backfill.test.js` | Test priority ordering |

**Scope:** scripts/ai/** only.

### Phase 3: Work-Stealing (Low Risk)

| Step | File | Change |
|------|------|--------|
| 1 | `scripts/ai/batch-launch.ps1` | Modify Build-Waves to recycle idle slots |
| 2 | `docs/ai-native/bounded-parallel-worker-execution.md` | Document work-stealing behavior |

**Scope:** scripts/ai/** and docs/ai-native/**.

### Phase 4: External-Intake Bridge (Low Risk)

| Step | File | Change |
|------|------|--------|
| 1 | `scripts/ai/compile-issue-to-task-json.ps1` | Read risk signals, map severity to priority |
| 2 | `docs/ai-native/external-intake-executable-loop.md` | Document priority bridge |

**Scope:** scripts/ai/** and docs/ai-native/**.

### Phase 5: Resource-Aware Slots (Separate Issue)

Implement the four-dimension slot model. This is a larger change that
should be tracked as a separate issue.

---

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|-----------|
| Priority field | Low | Optional field, backward-compatible default |
| Wave packing | Low | Sort order change only; bin-packing logic unchanged |
| Work-stealing | Low | Preserves conflict-group mutex; only recycles truly idle slots |
| External-intake bridge | Low | Read-only signal consumption; no mutation of risk signals |
| Resource-aware slots | Medium | Touches dispatch logic; needs integration tests |

All phases 1-4 stay within `docs/ai-native/**` and `scripts/ai/**`.
No changes to `src/**`, `prisma/**`, or `package.json`.

---

## Validation

After implementation, verify:

```bash
# Existing tests pass
node scripts/ai/allocate-conflict-groups.test.js
node scripts/ai/plan-concurrency-backfill.test.js

# Planner shows priority in output
pwsh ./scripts/ai/plan-next-batch.ps1 -Repo owner/name

# Dry-run wave plan respects priority
pwsh ./scripts/ai/batch-launch.ps1 -TaskFile test-tasks.json -Parallel -DryRun
```

---

## References

- [Resource Slot Scheduling](resource-slot-scheduling.md) — Four-dimension slot model
- [Planner Meta-Signals Ranking](planner-meta-signals-ranking.md) — Current ranking algorithm
- [External Reality Intake](external-reality-intake.md) — Intake boundary contract
- [External Intake Executable Loop](external-intake-executable-loop.md) — Capture/classify/score/route pipeline
- [Conflict Group Allocator](conflict-group-allocator.md) — Union-Find group assignment
- [Bounded Parallel Worker Execution](bounded-parallel-worker-execution.md) — Wave-based scheduling
- [Task DAG Scheduling Policy](task-dag-scheduling-policy.md) — Stage pipeline and parallel decomposition
- [Parallel Work Policy](parallel-work-policy.md) — Conflict group and shared lock rules
- [Risk Signal Schema](risk-signal-schema.md) — Severity weights and domains
- [#1503](https://github.com/taoyu051818-sys/lian-nest-server/issues/1503) — This investigation
