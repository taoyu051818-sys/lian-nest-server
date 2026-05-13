# Reason-Act-Observe-Reflect Investigation

Investigation of the Reason-Act-Observe-Reflect cycle from Symphony Dynamic
Solver against LIAN's self-cycle loop.
Tracks [issue #1435](https://github.com/taoyu051818-sys/lian-nest-server/issues/1435).

> **Source:** Symphony Dynamic Solver rules
> (`external-agent-research/Symphony/.roo/rules-symphony-dynamic-solver/02-rules.md`)
> **Source reliability:** high
> **Captured:** 2026-05-13

---

## Symphony Dynamic Solver Pattern

The Symphony Dynamic Solver implements a formal four-phase reflective loop:

1. **Reason** — Before entering the loop, classify the problem type and
   select a reasoning method (Self Consistency, Tree of Thoughts, ReAct,
   Direct Logic). Each method has different tradeoffs for exploration vs.
   exploitation.
2. **Act** — Execute the chosen action using the selected reasoning method.
3. **Observe** — Observe the outcome of the action.
4. **Reflect** — Evaluate action outcomes, generate a structured reflection,
   and persist it with timestamps. Reflections feed back into the next
   Reason phase, enabling the agent to learn from failures and adjust
   strategy across cycles.

The key insight: method selection before acting and reflection after acting
create a closed learning loop. The agent does not just observe state — it
evaluates *what happened* and *why*, then uses that knowledge to pick a
better strategy next time.

---

## Mapping to LIAN

| Symphony Phase | LIAN Equivalent | Status |
|----------------|-----------------|--------|
| **Reason** (method selection) | `Decide-Action` in `self-cycle-loop.ps1` — priority-based, no method selection | **Missing** |
| **Reason** (problem classification) | `classify-self-cycle-failure.js` — post-failure only, not pre-action | **Partial** |
| **Act** | `Execute-Action` in `self-cycle-loop.ps1` + `batch-launch.ps1` | **Implemented** |
| **Observe** | `Observe-State` in `self-cycle-loop.ps1` — gathers health, queue, workers | **Implemented** |
| **Reflect** (outcome evaluation) | `verify-action-success-criteria.js` (from #1415 investigation) | **Proposed, not implemented** |
| **Reflect** (critique generation) | `generate-failure-reflection.js` — deterministic self-critiques | **Implemented on main** |
| **Reflect** (persistence) | `write-failure-reflection.js` — NDJSON persistence | **In worktree only, not on main** |
| **Reflect** (feedback to next cycle) | Gap ledger `meta.reflection` + meta-signals `topPain` | **Partial** |

---

## Current LIAN Loop: Observe-Decide-Execute

`self-cycle-loop.ps1` implements a three-phase loop:

```
Observe  →  Decide  →  Execute  →  [pause]  →  Observe  →  ...
```

- **Observe** — prune stale state, gather health, count issues/PRs/workers
- **Decide** — priority-based action selection (merge > close > produce >
  implement > reconcile > wait)
- **Execute** — dispatch the chosen action

After Execute, the loop goes directly back to Observe. There is no phase
that evaluates *what happened* or *why*.

---

## Identified Gaps

### Gap 1: No Reflect Phase in the Loop

The loop has no post-execution evaluation step. After `Execute-Action`
returns, the loop logs the result string and moves on. There is no
mechanism to:

1. Evaluate whether the action achieved its intended goal.
2. Generate a structured reflection about the outcome.
3. Persist the reflection for future reference.
4. Feed reflection insights back into the next Decide phase.

**Existing partial solutions:**
- `generate-failure-reflection.js` (on main) produces deterministic
  self-critiques from failure classifications, but is only invoked
  externally — not wired into the loop.
- `write-failure-reflection.js` (in worktree, not on main) persists
  reflections to `failure-reflections.ndjson`, but is not deployed.
- `goal-driven-action-verification.md` (investigation from #1415)
  proposes success criteria and verification, but is not implemented.

### Gap 2: No Method Selection (Reason Phase)

`Decide-Action` uses a fixed priority order. It does not classify the
*type* of problem before selecting an action strategy. Symphony's method
selection (Self Consistency, Tree of Thoughts, ReAct, Direct Logic) maps
to LIAN choosing between different execution strategies based on context:

| Symphony Method | LIAN Analog | When to Use |
|----------------|-------------|-------------|
| Direct Logic | Single-pass execution | Simple, well-understood tasks |
| ReAct | Observe-Decide-Execute (current loop) | Standard tasks with known failure modes |
| Self Consistency | Parallel workers on same task | High-stakes tasks where consensus matters |
| Tree of Thoughts | Branching exploration | Novel problem types with unknown solutions |

Currently, all tasks use the same execution strategy regardless of
complexity or failure history.

### Gap 3: Failure Reflections Not Wired to Decisions

`generate-failure-reflection.js` can produce critiques and query past
reflections from the gap ledger, but `Decide-Action` in the loop does
not read reflections. The planner (`plan-next-batch.ps1`) demotes tasks
in the `topPain` category, but has no memory of *what was tried* or
*what the reflection recommended*.

---

## Relationship to Existing Investigations

| Investigation | Overlap | Differentiation |
|---------------|---------|-----------------|
| [Reflexion Self-Reflection](reflexion-self-reflection-investigation.md) (#1407) | Maps Reflexion Actor-Evaluator-SelfReflection to LIAN | Focuses on failure reflections only; this investigation covers the full loop including method selection and success reflections |
| [Goal-Driven Action Verification](goal-driven-action-verification.md) (#1415) | Proposes success criteria and post-action verification | Focuses on verification mechanics; this investigation adds the reflection persistence and feedback loop |

This investigation builds on both: verification provides the *input* to
reflection, and Reflexion provides the *storage* mechanism. The missing
piece is the loop integration — wiring verification output into reflection
generation and feeding reflections back into decision-making.

---

## Recommended Experiment

A bounded, incremental experiment to add a Reflect phase to the
self-cycle loop. Three layers, each independently valuable:

### Layer 1: Post-Action Reflection (Loop Integration)

Wire `generate-failure-reflection.js` into `self-cycle-loop.ps1` after
`Execute-Action`. On failure (non-zero exit or unexpected result), the
loop classifies the failure and generates a reflection.

```
Observe  →  Decide  →  Execute  →  Reflect  →  [pause]  →  Observe  →  ...
                                       │
                                       ├─ classify failure
                                       ├─ generate reflection
                                       └─ persist to NDJSON
```

**Scope:** 1 script change (`self-cycle-loop.ps1`), 1 new script
(`write-loop-reflection.js` to persist to `loop-reflections.ndjson`).

**Validation:** After 10 cycles with simulated failures, verify that
`loop-reflections.ndjson` contains structured reflections with
`errorClass`, `critique`, `rootCause`, `nextAction`, and timestamps.

### Layer 2: Reflection-Aware Decisions

Extend `Decide-Action` to read recent reflections from
`loop-reflections.ndjson` before selecting an action. If the last N
cycles all failed with the same error class and the recommended action
was not taken, escalate or adjust strategy.

**Scope:** 1 function change in `self-cycle-loop.ps1`.

**Validation:** After deploying Layer 1, trigger the same failure 3
times. Verify that the 4th cycle's decision accounts for the reflection
history (e.g., escalates instead of retrying).

### Layer 3: Method Selection (Optional, Higher Risk)

Add a lightweight method selection step before `Execute-Action` that
considers task complexity and failure history. For standard tasks, use
the current single-pass strategy. For tasks with repeated failures,
switch to a more exploratory strategy.

**Scope:** New function in `self-cycle-loop.ps1` + method selection
logic.

**Validation:** After Layers 1-2 are stable, introduce a task type that
benefits from parallel exploration. Verify method selection adapts.

---

## Hypothesis

> "If LIAN adds a Reflect phase to the self-cycle loop that persists
> structured reflections and feeds them back into decision-making, then
> repeat failure rate will decrease because the agent will learn from
> past failures instead of retrying the same approach."

**Measurable outcome:** Count of consecutive failures for the same
`errorClass` across cycles. Target: reduction from current baseline
(measured after Layer 1 deployment) within 2 cycles of Layer 2 deployment.

---

## Implementation Boundary

All changes stay within allowed files:

| Change | File | Risk |
|--------|------|------|
| Add Reflect phase call | `scripts/ai/self-cycle-loop.ps1` | Low — additive, no existing behavior changed |
| Persist reflections | `scripts/ai/write-loop-reflection.js` (new) | Low — append-only NDJSON write |
| Reflection-aware decisions | `scripts/ai/self-cycle-loop.ps1` | Low — reads new file, falls back to current behavior if absent |
| Investigation doc | `docs/ai-native/reason-act-observe-reflect-investigation.md` | None — documentation |

No changes to `src/`, `prisma/`, or `package.json`.

---

## Decision

This investigation finds that LIAN's self-cycle loop is missing a Reflect
phase that Symphony Dynamic Solver formalizes. The building blocks exist
(`classify-self-cycle-failure.js`, `generate-failure-reflection.js`,
goal-driven verification investigation) but are not wired into the loop.

The recommendation is to proceed with Layer 1 (post-action reflection) as
a bounded experiment. If it shows value, Layer 2 (reflection-aware
decisions) follows. Layer 3 (method selection) is deferred pending
evidence from Layers 1-2.

If the experiment shows no measurable reduction in repeat failures after
2 cycles, the Reflect phase should be removed and this issue closed with
a summary of findings.

---

## References

- [#1435](https://github.com/taoyu051818-sys/lian-nest-server/issues/1435) — This investigation
- [Reflexion Self-Reflection Investigation](reflexion-self-reflection-investigation.md) — Actor-Evaluator-SelfReflection mapping (#1407)
- [Goal-Driven Action Verification](goal-driven-action-verification.md) — Success criteria pattern (#1415)
- [Loop Model](loop-model.md) — Self-cycle loop phases
- [Self-Cycle Runner](self-cycle-runner.md) — Orchestrator documentation
- [External Research Intake Loop](external-research-intake-loop.md) — Research intake pipeline
