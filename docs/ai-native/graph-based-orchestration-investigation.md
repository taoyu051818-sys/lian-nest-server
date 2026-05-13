# Graph-Based Orchestration Investigation

Investigates LangGraph's directed-graph workflow model and assesses
applicability to LIAN's AI-native orchestration lifecycle.

> **Closes:** [#1446](https://github.com/taoyu051818-sys/lian-nest-server/issues/1446)
>
> **Source type:** external-doc (reliability: high)
> **Captured:** 2026-05-13

---

## Summary

LIAN's orchestration is a **linear pipeline with manual wave boundaries**.
LangGraph models workflows as **directed graphs with typed state, conditional
edges, branching, and durable checkpoints**. This investigation finds that
LIAN already has several graph-congruent concepts (DAG scheduling, fact-based
dependencies, conflict groups) but lacks three capabilities that a graph model
would provide: **conditional routing**, **retry loops**, and **sub-workflow
composition**. Adopting LangGraph directly is not recommended; instead, LIAN
should incrementally add graph semantics to its existing orchestrator.

---

## LangGraph Model

LangGraph (by LangChain Inc.) models agent workflows as directed graphs
where:

| Concept | Description |
|---------|-------------|
| **Node** | A function that reads shared state, performs work, and returns state updates. Maps to a worker or gate step. |
| **Edge** | A deterministic transition from one node to the next. |
| **Conditional edge** | A routing function that evaluates current state and selects the next node dynamically. Enables if/else branching, loops, and multi-path workflows. |
| **State** | A typed dictionary passed through the graph. Each node reads and writes to it. State is the single source of truth. |
| **Checkpoint** | A durable snapshot of state at each node boundary. Enables pause/resume, human-in-the-loop gates, and rollback to any checkpoint. |
| **Cycle** | Unlike a DAG, LangGraph permits cycles. This enables retry loops and ReAct-style reason-act cycles. |

### Key LangGraph Capabilities

**Conditional routing:**
A routing function evaluates state after a node completes and selects
the next node. Example: after a review node, route to "merge" if approved,
"revise" if changes requested, or "escalate" if blocked.

**Retry loops:**
A node can loop back to itself or a predecessor when validation fails,
up to a configurable limit. The loop is explicit in the graph definition,
not ad-hoc retry logic.

**Sub-workflows (subgraphs):**
A node can itself be a graph. This enables hierarchical composition:
a "complex task" node expands into its own internal graph of steps.

**Human-in-the-loop:**
A node can pause execution and wait for external input (human approval,
manual data entry). The checkpoint preserves state until the human responds.

---

## LIAN's Current Model

LIAN's orchestration is a **linear pipeline** with the following stages:

```
issue queue → task compilation → launch gate → worker dispatch → PR opened
  → review gate → merge → health gate → next wave (human decision)
```

### What LIAN Already Has (Graph-Congruent)

| LangGraph Concept | LIAN Equivalent | Gap |
|-------------------|-----------------|-----|
| Node | Worker (in worktree) | Equivalent. Each worker is a function that reads task state and produces output. |
| Edge | Pipeline stage sequencing | Partial. Edges are implicit in script chaining, not declared in a graph. |
| State | Task JSON + fact registry + health state | Partial. State is scattered across files; no single typed state object. |
| DAG scheduling | `task-dag-scheduling-policy.md` | Policy only. The six-stage DAG (`contract -> fixture -> provider -> runtime -> test -> matrix-update`) is documented but not implemented as a runtime graph. |
| Fact dependencies | `dependsOnFacts` / `producesFacts` in task schema | Policy only. The fields exist in the task schema spec but the orchestrator does not traverse them. |
| Conflict groups | `conflictGroup` + `sharedLocks` | Implemented. The launch gate enforces serialization within groups. |
| Checkpoint | Git worktree + PR | Partial. Each worker's output is a branch/PR, which serves as a durable checkpoint. But there is no graph-level checkpoint that captures orchestration state. |

### What LIAN Lacks

**1. Conditional routing (branching)**

LIAN's pipeline has no branching. After the review gate, the only outcomes
are merge or human block. There is no mechanism to route a task to different
workers based on review feedback, health state, or task properties.

Current workaround: human decides next wave manually. The autopilot plan
mode (`-AutopilotPlan`) does dry-run planning but never executes branches.

**2. Retry loops**

When a worker fails or a PR requires revision, the current model defers
the task and waits for human intervention. There is no automatic retry
loop that re-dispatches the worker with updated context.

Current workaround: human re-launches the worker manually with a new task
contract.

**3. Sub-workflow composition**

LIAN treats each issue as an atomic task. There is no mechanism to decompose
a single issue into a sub-graph of steps that execute as a unit. The
`parallel-task-decomposition-policy.md` describes decomposition into
independent tasks, but these are separate issues — not a nested workflow.

Current workaround: human decomposes complex issues into multiple smaller
issues manually.

**4. Typed shared state**

LangGraph passes a single typed state object through all nodes. LIAN's
state is fragmented: task JSON (per-worker), fact registry (global),
health state (global), issue labels (GitHub). Workers read from multiple
sources with no unified state schema.

**5. Graph-level checkpointing**

LangGraph checkpoints state at every node boundary, enabling pause/resume
at any point. LIAN's checkpoints are per-worker (git branches). If the
orchestrator crashes mid-batch, there is no mechanism to resume from the
last successful stage.

---

## Gap Analysis

| Capability | LangGraph | LIAN Now | LIAN Target |
|------------|-----------|----------|-------------|
| Node execution | Typed function | Worker in worktree | Worker in worktree (no change) |
| Deterministic edges | Declared in graph | Script chaining | Script chaining (no change needed) |
| Conditional edges | Routing function | None | Health-state and review-result routing |
| Cycles / retry | Built-in | None | Bounded retry with max-attempt limit |
| Sub-workflows | Subgraph composition | None | Task decomposition into sub-stages |
| Typed state | TypedDict / Pydantic | Fragmented files | Unified state file per batch run |
| Checkpointing | Durable per-node | Per-worker git branch | Per-stage batch checkpoint |
| Human gate | Pause node | Human-owned wave boundary | Pause node with resume |
| Parallel branches | Fan-out / fan-in | Conflict groups | Conflict groups (already works) |

---

## Recommendations

### Do NOT adopt LangGraph directly

Reasons:

1. **Language mismatch.** LangGraph is a Python library. LIAN's orchestrator
   is PowerShell + JavaScript. Integrating Python into the pipeline adds
   dependency complexity with no existing Python infrastructure.

2. **Scope mismatch.** LangGraph is designed for LLM agent loops (ReAct,
   tool-use). LIAN's orchestration dispatches independent workers, not
   in-process agent loops. The graph semantics are useful but the runtime
   is overkill.

3. **Existing investment.** LIAN has 130+ scripts and 180+ docs defining
   the current orchestration. A wholesale replacement is high-risk and
   low-ROI.

### DO incrementally add graph semantics

The following changes bring LIAN closer to a graph model without a
platform rewrite:

**Phase 1: Conditional routing (low effort)**

Add routing logic to `run-self-cycle.ps1` that evaluates health state
and review outcomes to select the next stage. This replaces the current
linear chain with a branching pipeline.

- After health gate: route to "next task" (green), "defer runtime" (yellow),
  or "recovery worker" (red).
- After review gate: route to "merge" (approved), "revise" (changes requested),
  or "escalate" (blocked).

This is a localized change to the orchestrator script with no schema changes.

**Phase 2: Bounded retry (low effort)**

Add a retry counter to the task contract. When a worker fails (exit non-zero,
no PR), the orchestrator re-dispatches up to N times with updated context
from the failure log.

- Add `maxRetries` field to task JSON schema.
- Add retry loop to `batch-launch.ps1` after worker exit check.
- Log each retry attempt in the task ledger.

**Phase 3: Unified batch state (medium effort)**

Create a batch-level state file that captures orchestration progress:
which tasks are pending, running, completed, blocked, and what facts have
been produced. This is the LIAN equivalent of LangGraph's typed state.

- Create `scripts/ai/write-batch-state.js` to maintain a JSON state file
  per batch run.
- Update `run-self-cycle.ps1` to read/write batch state between stages.
- Enables resume-from-checkpoint if the orchestrator crashes mid-batch.

**Phase 4: Sub-workflow decomposition (medium effort)**

Extend the task contract to support `subStages` — an ordered list of
sub-tasks that execute within a single worker's scope. This enables a
single issue to decompose into a mini-pipeline without creating separate
issues.

- Add `subStages` field to task JSON schema.
- Worker executes sub-stages sequentially, committing after each.
- Orchestrator treats the parent task as a single unit for scheduling.

### Priority

| Phase | Effort | Impact | Priority |
|-------|--------|--------|----------|
| 1. Conditional routing | Low | High — eliminates manual routing for common cases | **Do first** |
| 2. Bounded retry | Low | Medium — reduces human intervention for transient failures | **Do second** |
| 3. Unified batch state | Medium | Medium — enables crash recovery and progress tracking | **Do third** |
| 4. Sub-workflow composition | Medium | Low — only needed for complex multi-step issues | **Do if needed** |

---

## What This Does NOT Change

- **Human-owned wave boundaries.** The orchestrator still pauses between
  waves. Conditional routing applies within a wave, not across waves.
- **Conflict group enforcement.** Parallel safety is already well-served
  by conflict groups and shared locks.
- **Worker isolation.** Each worker still runs in its own git worktree.
- **External intake as evidence.** External data still enters as evidence,
  never as commands.
- **Health gate authority.** The health gate still determines worker type
  permissions per state.

---

## References

- [Task DAG Scheduling Policy](task-dag-scheduling-policy.md) — Existing
  DAG model (policy only, not implemented as runtime)
- [Parallel Planning Reducer](parallel-planning-reducer.md) — DAG
  construction from fact dependencies
- [Parallel Task Decomposition Policy](parallel-task-decomposition-policy.md)
  — Fact-based task decomposition with DAG rules
- [Loop Model](loop-model.md) — Current self-cycle runner loop
- [Orchestration](orchestration.md) — Self-hosted batch launcher
- [External Reality Intake](external-reality-intake.md) — Evidence-only
  intake layer
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Launch Gate](launch-gate.md) — Pre-launch validation
- [#1446](https://github.com/taoyu051818-sys/lian-nest-server/issues/1446)
  — This investigation
