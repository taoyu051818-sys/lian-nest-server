# Graph-Based Orchestration Research

Investigates LangGraph's directed-graph workflow model and assesses
relevance to LIAN's linear lifecycle orchestration.

> **Closes:** [#1500](https://github.com/taoyu051818-sys/lian-nest-server/issues/1500)
>
> **Source:** LangGraph documentation, external research intake
>
> **See also:**
> [task-dag-scheduling-policy.md](task-dag-scheduling-policy.md) for
> LIAN's existing DAG concepts,
> [parallel-task-decomposition-policy.md](parallel-task-decomposition-policy.md)
> for fact-based dependency graphs,
> [external-research-intake-loop.md](external-research-intake-loop.md)
> for the intake pipeline.

---

## External Pattern Summary

LangGraph models workflows as directed graphs where:

- **Nodes** are functions that transform typed state
- **Edges** are transitions, optionally with conditional routing
- **State** is a typed dictionary passed through the graph
- **Checkpoints** capture graph state at each node for durability and replay
- **Subgraphs** enable nested workflows with their own state
- **Human-in-the-loop** gates pause execution at specific nodes for input

Key capabilities this enables that a linear pipeline cannot:

| Capability | Description |
|------------|-------------|
| Conditional edges | Route to different next-nodes based on state inspection |
| Parallel branches | Fan-out to multiple nodes, fan-in when all complete |
| Retry loops | Cycle back to a previous node on failure with state mutation |
| Human gates | Pause at a node, persist state, resume on external signal |
| Sub-workflows | Delegate a node to a full sub-graph with isolated state |
| Durable checkpoints | Replay from any checkpoint, enabling crash recovery and time-travel |

---

## Mapping to LIAN Architecture

### What LIAN Already Has

LIAN's orchestration already implements several graph concepts, though
not as a unified graph runtime:

| LangGraph Concept | LIAN Equivalent | Gap |
|-------------------|-----------------|-----|
| Directed graph | Task DAG scheduling policy (`task-dag-scheduling-policy.md`) | **Documented but not implemented** as a runtime; current dispatch is wave-based linear |
| Typed state | Task JSON contract with `dependsOnFacts`, `producesFacts`, `writeSet` | State is implicit in file system and GitHub issue labels, not a typed dictionary |
| Conditional routing | Meta-signals system (`calculate-meta-signals.js`) drives priority selection | Routes between task *types* (fix-pain, reduce-friction), not between *stages* of a single task |
| Parallel branches | Wave-based batching in `batch-launch.ps1` with conflict group serialization | True parallel branches with fan-in/fan-out not supported; waves are flat batches |
| Human gates | Human gate in external intake, launch gate, merge gate | Gates are at fixed pipeline boundaries, not at arbitrary graph nodes |
| Retry loops | State reconciler detects drift; no automatic retry with state mutation | Workers that fail get `agent:blocked`; no graph-based retry-back edge |
| Sub-workflows | Not implemented | Workers are monolithic; no delegation to nested workflows |
| Checkpoints | Git worktrees + commits provide checkpoint-like durability | No mid-workflow checkpoint; checkpoint granularity is per-PR |

### What LIAN Lacks (Actionable Gaps)

**Gap 1: No conditional routing within a task lifecycle.**
A task moves through a fixed sequence: issue -> worker -> PR -> review -> merge.
There is no mechanism to branch based on intermediate results (e.g., "if
tests fail, route to a fix-worker; if security review flags issues, route
to a security-worker"). The current model requires creating a new issue
for follow-up work.

**Gap 2: No retry-back edges.**
When a worker fails or a PR review requests changes, the current model
creates a new issue or labels the existing one `agent:blocked`. A graph
model would route back to the worker node with the review feedback as
additional state, without creating a new issue.

**Gap 3: No sub-workflow delegation.**
Complex tasks that could be decomposed into sub-tasks (e.g., "implement
feature X" -> [contract, fixture, provider, runtime, test, matrix-update])
are currently either monolithic workers or manually decomposed into
separate issues. A sub-graph would enable automatic decomposition with
typed state passing between stages.

**Gap 4: No fan-out/fan-in within a single task.**
The parallel task decomposition policy defines how to decompose tasks,
but the launcher processes waves as flat batches. There is no mechanism
to say "launch these 3 sub-tasks in parallel, wait for all 3, then
proceed to the next stage."

**Gap 5: DAG scheduling is documented but not implemented.**
The `task-dag-scheduling-policy.md` and `parallel-task-decomposition-policy.md`
define a complete DAG model with `dependsOnFacts`/`producesFacts` edges,
topological traversal, and risk-gated parallelism. The `groups-migration-decomposition-example.md`
explicitly notes: "No implementation of the DAG scheduler (planning doc only)."

---

## Applicability Assessment

| Dimension | Rating | Rationale |
|-----------|--------|-----------|
| Applicability | **Partial** | Many LangGraph concepts already exist as LIAN policy documents; the gap is runtime implementation, not conceptual novelty |
| Risk | **Low** | Research-only; no code changes proposed |
| Complexity | **High** | Implementing a graph runtime would require significant changes to `batch-launch.ps1`, task JSON schema, and the self-cycle runner |
| Urgency | **Low** | The current wave-based model works for LIAN's linear lifecycle; graph-based orchestration is a future optimization |

---

## Recommendations

### What NOT to do

1. **Do not adopt LangGraph as a dependency.** LIAN's orchestration is
   shell-based (PowerShell + Node.js scripts) with GitHub as the state
   store. Adding a Python graph runtime would create an architectural
   boundary violation and operational complexity.

2. **Do not redesign the lifecycle as a graph.** The issue -> worker -> PR
   -> review -> merge pipeline is intentionally linear with human gates.
   Making it a graph would undermine the predictability and auditability
   that the SOP enforces.

3. **Do not implement all five gaps at once.** Each gap is an independent
   optimization. The highest-value, lowest-risk starting point is Gap 5
   (implementing the existing DAG scheduler policy).

### What TO consider (bounded experiments)

**Experiment 1: Implement the DAG scheduler (Gap 5).**
The policy documents already define the complete model. The experiment
would implement `scripts/ai/reduce-planner-gaps.js` to perform the
five-phase reduction (collect, deduplicate, build DAG, risk gate, schedule).
Success metric: the DAG scheduler produces the same wave assignments as
the current manual planning for a known test batch.

**Experiment 2: Add conditional routing to task contracts (Gap 1).**
Extend the CONTROL APPENDIX with optional `conditionalEdges` that define
routing rules based on validation output. Example: if `npm run check`
fails, route to a `fix-check` worker class instead of `agent:blocked`.
Success metric: a failed-validation task automatically creates a bounded
fix issue without human intervention.

**Experiment 3: Add retry-back edges (Gap 2).**
When a PR review requests changes, instead of creating a new issue,
re-dispatch the same worker with the review comments as additional state.
The task contract would carry a `retryCount` and `maxRetries` field.
Success metric: PR review cycles reduce from new-issue creation to
automatic re-dispatch.

---

## Integration with External Intake

This research follows the external research intake loop
([external-research-intake-loop.md](external-research-intake-loop.md)):

| Stage | Status |
|-------|--------|
| Source Capture | Complete — fact event recorded |
| Evidence Score | Tier B (external-doc, structured but not version-pinned) |
| Pattern Extract | Complete — five gaps identified, mapped to LIAN surfaces |
| Opportunity Signal | Three bounded experiments proposed |
| Gate | Pending human review |

---

## Key Files

| Path | Relevance |
|------|-----------|
| `docs/ai-native/task-dag-scheduling-policy.md` | Existing DAG model (not implemented) |
| `docs/ai-native/parallel-task-decomposition-policy.md` | Fact-based dependency graph (not implemented) |
| `docs/ai-native/parallel-planning-reducer.md` | Five-phase reduction contract (not implemented) |
| `scripts/ai/batch-launch.ps1` | Current wave-based dispatcher |
| `scripts/ai/run-self-cycle.ps1` | Current linear orchestrator |
| `scripts/ai/calculate-meta-signals.js` | Current priority-based routing |
| `docs/ai-native/issue-lifecycle.md` | Current linear lifecycle states |
| `docs/ai-native/loop-model.md` | Current loop model (no autonomous next-wave) |

---

## References

- [Task DAG Scheduling Policy](task-dag-scheduling-policy.md) — LIAN's documented DAG model
- [Parallel Task Decomposition Policy](parallel-task-decomposition-policy.md) — Fact-based dependency graph
- [Parallel Planning Reducer](parallel-planning-reducer.md) — Five-phase reduction contract
- [External Research Intake Loop](external-research-intake-loop.md) — How external research enters LIAN
- [Bounded Experiment Policy](bounded-experiment-policy.md) — Experiment scoping rules
- [#1500](https://github.com/taoyu051818-sys/lian-nest-server/issues/1500) — This investigation
