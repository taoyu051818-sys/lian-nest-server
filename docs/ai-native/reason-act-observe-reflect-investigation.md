# Reason-Act-Observe-Reflect Investigation

Investigation of the Symphony Dynamic Solver's Reason-Act-Observe-Reflect cycle
against LIAN's existing self-cycle-loop.ps1 Observe-Decide-Execute pattern.
Tracks [issue #1435](https://github.com/taoyu051818-sys/lian-nest-server/issues/1435).

> **Source:** Symphony Dynamic Solver `02-rules.md` (external-doc, Tier B)
> **Source reliability:** high
> **Captured:** 2026-05-13T07:42:56.911Z

---

## External Pattern: Reason-Act-Observe-Reflect

Symphony Dynamic Solver implements a formal 4-phase reflective loop:

1. **Reason** -- Before acting, classify the problem type and select a
   reasoning method (Self Consistency, Tree of Thoughts, ReAct, Direct Logic).
2. **Act** -- Execute the selected action.
3. **Observe** -- Collect the outcome (success, failure, partial).
4. **Reflect** -- Evaluate the outcome against expectations, log the
   reflection with timestamps, and store it for future reference. The
   reflection informs the next cycle's reasoning.

The key addition over a simple observe-decide-execute loop:

- **Method selection** happens before the loop entry, not inside it.
- **Reflect** is a first-class phase that runs after every cycle, not
  only on failures. It evaluates whether the action achieved its goal
  and writes structured reflections to a persistent log.

---

## LIAN Current State: Observe-Decide-Execute

LIAN's `self-cycle-loop.ps1` implements a 3-phase cycle:

```
Phase 1: Observe   -- Prune-StaleState + Observe-State
Phase 2: Decide    -- Decide-Action (priority: merge > close > produce > implement > reconcile > wait)
Phase 3: Execute   -- Execute-Action (merge, close, produce, implement, or wait)
```

### What LIAN Already Has

| Symphony Phase | LIAN Equivalent | Status |
|---------------|-----------------|--------|
| Reason (method selection) | `Decide-Action` priority ordering | **Partial** -- selects action by priority, not by problem classification |
| Act | `Execute-Action` dispatches workers, merges PRs, closes issues | **Implemented** |
| Observe | `Observe-State` gathers mergeable PRs, closeable issues, queue size, health | **Implemented** |
| Reflect | `classify-self-cycle-failure.js` + `generate-failure-reflection.js` | **Partial** -- exists as separate scripts, not wired into main loop |

### What LIAN Lacks

1. **Reflect is not a loop phase.** The reflection scripts exist but are
   invoked externally (piped from failure classification). The main loop
   in `self-cycle-loop.ps1` does not call them after each cycle.

2. **Reflection only fires on failure.** The current pipeline
   (`classify-self-cycle-failure.js` -> `generate-failure-reflection.js`)
   is triggered when a worker fails. There is no reflection on successful
   cycles -- no record of *why* an action succeeded or whether it achieved
   its intended goal.

3. **No pre-loop method selection.** The `Decide-Action` function uses a
   fixed priority order. There is no problem-type classification that
   selects a different reasoning strategy based on the current state
   pattern (e.g., "high entropy + stale worktrees" vs "healthy + empty queue").

4. **Reflections are not fed back into decisions.** The gap ledger stores
   reflections in `meta.reflection`, but `Decide-Action` does not read
   past reflections to inform its choice. The `plan-next-batch.ps1`
   planner demotes `topPain` categories but has no per-failure memory.

---

## Gap Analysis

### Gap 1: Reflect Phase in Main Loop

**Current:** Reflection is a separate pipeline triggered by failure
classification. The main loop runs Observe-Decide-Execute without any
post-execution evaluation.

**Symphony pattern:** Reflect runs after every cycle, not just failures.
It evaluates whether the action achieved its goal and stores the result.

**Impact:** The loop cannot learn from successful strategies or detect
that a "successful" action did not actually achieve its intended outcome
(e.g., workers launched but all failed silently).

**Bounded fix:** Add a `Reflect-ActionResult` function to
`self-cycle-loop.ps1` that runs after `Execute-Action`. It evaluates
the action result against the decision reason and writes a structured
reflection to `autonomous-loop-events.ndjson` (existing event ledger).
On failure, it pipes through the existing
`classify-self-cycle-failure.js` -> `generate-failure-reflection.js`
pipeline. On success, it records a lightweight success reflection.

### Gap 2: Pre-Loop Method Selection

**Current:** `Decide-Action` uses a fixed priority order
(merge > close > produce > implement > reconcile > wait).

**Symphony pattern:** Before entering the loop, the agent classifies the
problem type and selects a reasoning method.

**Impact:** Low. LIAN's decision space is narrower than a general-purpose
solver. The fixed priority order is appropriate for the control plane's
bounded action set. Adding problem-type classification would increase
complexity without clear benefit.

**Recommendation:** Do not add pre-loop method selection. The current
priority ordering is a deliberate design choice that matches LIAN's
bounded action set. If future actions require different reasoning
strategies, method selection can be added at that time.

### Gap 3: Reflection Feeding Back into Decisions

**Current:** `Decide-Action` does not read past reflections. The planner
uses aggregate `topPain` but not per-failure lessons.

**Symphony pattern:** Reflections inform the next cycle's reasoning.

**Impact:** Medium. Repeat failures of the same error class are not
detected or escalated. The loop may retry the same failing action
without adjusting strategy.

**Bounded fix:** Add a `Read-RecentReflections` helper that queries the
gap ledger for reflections from the last N cycles. If the same error
class has fired 3+ times with the same recommended action, escalate to
`wait` with a human-required reason. This is a small addition to
`Decide-Action` that does not change the priority order.

---

## Existing Infrastructure Map

The following scripts already exist and support the Reflect phase:

| Script | Role in Reflect Phase | Status |
|--------|----------------------|--------|
| `classify-self-cycle-failure.js` | Classifies worker failures into 9 error classes | **Implemented** |
| `generate-failure-reflection.js` | Produces structured self-critique from classification | **Implemented** |
| `gap-ledger.ndjson` | Stores reflections in `meta.reflection` field | **Schema ready** |
| `calculate-meta-signals.js` | Aggregates `topPain` from gap ledger | **Implemented** |
| `autonomous-loop-events.ndjson` | Loop lifecycle events (cycle-complete, loop-end) | **Implemented** |

What is missing is the wiring: calling the reflection pipeline from the
main loop and feeding reflections back into decisions.

---

## Proposed Bounded Experiment

### Hypothesis

"If LIAN adds a Reflect phase that evaluates every cycle's action outcome
and stores reflections in the loop event ledger, then repeat failure rate
will decrease because the loop will detect and escalate recurring error
patterns within 3 cycles instead of retrying indefinitely."

### Experiment Scope

| Dimension | Bound |
|-----------|-------|
| Files changed | `scripts/ai/self-cycle-loop.ps1` (add Reflect phase), `docs/ai-native/reason-act-observe-reflect-investigation.md` (this doc) |
| New files | None -- uses existing `classify-self-cycle-failure.js` and `generate-failure-reflection.js` |
| Validation | `npm run check` (TypeScript compilation) |
| Success metric | Repeat failure count for the same error class decreases within 2 cycles of deployment |
| Rollback | Remove the `Reflect-ActionResult` function and the `Read-RecentReflections` call from `Decide-Action` |

### Implementation Plan

1. Add `Reflect-ActionResult` function to `self-cycle-loop.ps1`:
   - On failure: pipe error output through `classify-self-cycle-failure.js`
     and `generate-failure-reflection.js`, store in gap ledger.
   - On success: write a lightweight success event to
     `autonomous-loop-events.ndjson` with action type and result summary.
   - Always: record cycle-level reflection in the cycle log.

2. Add `Read-RecentReflections` helper to `self-cycle-loop.ps1`:
   - Query gap ledger for reflections from the last N cycles.
   - Return error class counts and recommended actions.

3. Add escalation logic to `Decide-Action`:
   - If the same error class has fired 3+ times with the same recommended
     action, override to `wait` with reason "Repeat failure escalation:
     [errorClass] -- human review required".

### What This Does NOT Change

- The priority order of actions (merge > close > produce > implement > reconcile > wait).
- The health preflight gate.
- The human-owned decision boundaries.
- The worker dispatch mechanism.
- Any files in `src/`, `prisma/`, or `package.json`.

---

## Decision

This investigation finds that LIAN's self-cycle-loop already has most of
the Reflect infrastructure in place (classification, critique generation,
gap ledger storage). The gap is wiring: the main loop does not call the
reflection pipeline after each cycle, and decisions do not consult past
reflections.

The recommended action is a bounded experiment that adds Reflect as a
fourth phase to the main loop. The experiment is low-risk (additive only,
no changes to existing phases), uses existing scripts, and has a clear
success metric (repeat failure rate).

If the experiment shows no measurable improvement after 2 cycles of
deployment, the Reflect phase should be removed and this issue closed
with a summary of findings.

---

## References

- [Reflexion Self-Reflection Investigation](reflexion-self-reflection-investigation.md) -- Prior investigation of Reflexion pattern against LIAN
- [Loop Model](loop-model.md) -- Current self-cycle runner phases
- [External Research Intake Loop](external-research-intake-loop.md) -- How external research enters the system
- [Goal-Driven Action Verification](goal-driven-action-verification.md) -- Success criteria pattern for self-cycle actions
- [#1435](https://github.com/taoyu051818-sys/lian-nest-server/issues/1435) -- This investigation
