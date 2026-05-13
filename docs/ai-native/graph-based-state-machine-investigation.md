# Investigation: Graph-Based State Machine for Worker Lifecycle

Research investigation into LangGraph's directed acyclic graph approach for
modeling agent workflows, and its applicability to LIAN's worker lifecycle
management.

> **Closes:** [#1363](https://github.com/taoyu051818-sys/lian-nest-server/issues/1363)
>
> **Source:** [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph)
>
> **Evidence class:** `external-doc` — Tier B (structured, not version-pinned to LIAN)
>
> **Captured:** 2026-05-13
>
> **See also:**
> [external-research-intake-loop.md](external-research-intake-loop.md) for the
> intake loop that produced this investigation,
> [active-workers-schema.md](active-workers-schema.md) for the current worker
> state schema,
> [bounded-parallel-worker-execution.md](bounded-parallel-worker-execution.md)
> for the parallel execution model,
> [backend-worker-layers.md](backend-worker-layers.md) for the layer model.

---

## Summary

LangGraph models agent workflows as directed acyclic graphs where each node
is a processing step and edges define explicit state transitions. It supports
parallel branching, conditional routing, checkpointing, and human-in-the-loop
interrupts. This investigation assesses which of these patterns LIAN should
adopt and which add unnecessary complexity.

**Finding:** LIAN's worker lifecycle would benefit from an explicit state
machine definition with guarded transitions, but does not need LangGraph's
full DAG runtime. The gap is in transition documentation and guard enforcement,
not in runtime graph execution.

---

## LangGraph Patterns Investigated

### Pattern 1: Explicit State Transitions as Edges

**External observation:** LangGraph defines every state change as a typed edge
between nodes. Each edge has a condition function that determines whether the
transition is valid. Invalid transitions are structurally impossible — the
graph has no edge for them.

**Applicability to LIAN:** Direct.

LIAN's worker lifecycle has seven states (`planned`, `running`, `completed`,
`failed`, `stale`, `blocked`, `needs-human`) but transitions between them are
implicit — encoded in PowerShell scripts (`batch-launch.ps1`,
`wait-parallel-workers.ps1`) and JavaScript modules rather than declared in a
transition table. This means:

- A worker can theoretically move from `completed` back to `running` if a
  script writes the wrong status.
- There is no guard preventing `failed` → `planned` without explicit retry
  approval.
- The `stale` → `running` transition (heartbeat recovery) is not formally
  distinguished from `planned` → `running` (fresh launch).

An explicit transition table would make invalid states structurally rejected
rather than merely unlikely.

### Pattern 2: Conditional Routing

**External observation:** LangGraph edges carry condition functions that
inspect current state and route to different next-nodes. A single node can
have multiple outgoing edges, each with a different condition.

**Applicability to LIAN:** Partial.

LIAN already has conditional routing in `wait-parallel-workers.ps1` (failure
classification routes to retry, follow-up issue, or human-required) and in
`check-launch-gate.ps1` (health state routes to allow or block). The routing
logic exists but is scattered across scripts rather than declared as a
transition graph.

The value of formalizing this is discoverability — an operator can read the
state machine definition to understand all possible paths without tracing
through scripts.

### Pattern 3: Checkpointing

**External observation:** LangGraph checkpoints state at each node boundary,
enabling replay from any checkpoint and resume after interruption.

**Applicability to LIAN:** Analogous.

LIAN's `active-workers.json` is a projection (snapshot) that is rewritten on
every state change. It is not an append-only checkpoint log. The fact event
ledger (`fact-events.ndjson`) serves as an audit trail but does not capture
full worker state at each transition.

For LIAN's use case, checkpointing is already partially addressed by the
combination of:
- `active-workers.json` (current state)
- `fact-events.ndjson` (event history)
- Worker log files (`.out.log`, `.err.log`, `.result.json`)

A full checkpoint-and-replay system would add complexity without clear benefit,
since workers are disposable and re-launchable.

### Pattern 4: Human-in-the-Loop Interrupts

**External observation:** LangGraph supports interrupt nodes that pause
execution and wait for human input before proceeding.

**Applicability to LIAN:** Direct.

LIAN already has the `needs-human` status in `active-workers.json` and the
human gate boundaries in `external-intake-human-gate.md`. The mechanism exists
but the interrupt-resume flow is not formalized as a state transition:

```
running → needs-human → (human input) → running
```

This is a valid use of explicit state machine thinking — the
`needs-human` → `running` transition should have a guard that verifies human
input was actually provided.

### Pattern 5: Parallel Branching

**External observation:** LangGraph supports fan-out (one node to many) and
fan-in (many nodes to one) with barrier synchronization.

**Applicability to LIAN:** Partial.

LIAN's `batch-launch.ps1` already implements wave-based parallel execution
with conflict-group serialization. The barrier is the wave boundary — no
worker in wave N+1 starts until all workers in wave N complete. This is
simpler than LangGraph's general fan-out/fan-in but sufficient for LIAN's
needs.

---

## Current LIAN State Analysis

### Existing Worker States

From `active-workers-schema.md`, workers track these status values:

| Status | Meaning | Set By |
|--------|---------|--------|
| `planned` | Queued for launch | `batch-launch.ps1` |
| `running` | Currently executing | `batch-launch.ps1` |
| `completed` | Finished successfully | `wait-parallel-workers.ps1` |
| `failed` | Finished with error | `wait-parallel-workers.ps1` |
| `stale` | No heartbeat / timed out | `wait-parallel-workers.ps1` |
| `blocked` | Waiting on dependency | `batch-launch.ps1` |
| `needs-human` | Requires human input | Worker or reconciler |

### Implicit Transitions (Current)

The following transitions are implemented across multiple scripts without a
centralized definition:

```
planned → running          (batch-launch.ps1 dispatches worker)
planned → blocked          (launch gate blocks due to conflict/health)
running → completed        (wait-parallel-workers.ps1 detects exit 0)
running → failed           (wait-parallel-workers.ps1 detects exit non-zero)
running → stale            (wait-parallel-workers.ps1 detects timeout)
running → needs-human      (worker or reconciler flags human input)
blocked → planned          (conflict clears, re-queued)
stale → completed          (late success detection)
stale → failed             (confirmed failure after timeout)
needs-human → running      (human provides input — not formally guarded)
```

### Gaps Identified

1. **No centralized transition table.** Transitions are encoded in scripts.
   A new script author has no reference for valid transitions.

2. **No guard on `needs-human` → `running`.** The transition from
   `needs-human` back to `running` should verify that human input was
   actually provided, but no guard enforces this.

3. **No guard on `failed` → `planned`.** A failed worker could be
   re-planned without explicit retry approval. The retry decision should
   be an explicit transition with a condition.

4. **No guard on `stale` → `running`.** Stale workers should not resume
   without re-validation. The current system re-launches rather than
   resumes, but the schema does not distinguish these paths.

5. **Missing `cancelled` state.** There is no explicit state for workers
   that were planned but intentionally cancelled (e.g., superseded by a
   higher-priority task). Currently these become stale or are manually
   removed from the projection.

---

## Recommendations

### Recommendation 1: Define an Explicit Transition Table

Add a transition table to `active-workers-schema.md` or a new
`worker-lifecycle-state-machine.md` that declares every valid transition
and its guard condition.

```markdown
| From          | To            | Guard Condition                        |
|---------------|---------------|----------------------------------------|
| planned       | running       | Launch gate passes, PID assigned       |
| planned       | blocked       | Launch gate blocks (conflict/health)   |
| planned       | cancelled     | Explicit cancel command                |
| blocked       | planned       | Conflict cleared, re-queued            |
| blocked       | cancelled     | Explicit cancel command                |
| running       | completed     | Exit code 0, result file written       |
| running       | failed        | Exit code non-zero or timeout          |
| running       | needs-human   | Human gate boundary triggered          |
| running       | stale         | Heartbeat timeout exceeded             |
| needs-human   | running       | Human input recorded in fact event     |
| stale         | failed        | Confirmed failure after grace period   |
| stale         | cancelled     | Explicit cancel after stale timeout    |
| completed     | (terminal)    | No outgoing transitions                |
| failed        | planned       | Explicit retry approval (human gate)   |
| cancelled     | (terminal)    | No outgoing transitions                |
```

### Recommendation 2: Add a `cancelled` Status

Extend the schema with a `cancelled` terminal state for workers that are
intentionally removed from the queue without failure.

### Recommendation 3: Guard `needs-human` Resume

Add a guard that requires a fact event ID referencing the human input before
allowing `needs-human` → `running`. This can be implemented in the
reconciler or batch launcher.

### Recommendation 4: Do NOT Adopt a DAG Runtime

LIAN's worker lifecycle is a linear state machine, not a DAG. Workers do not
branch into sub-workers or converge from multiple predecessors. Adopting a
DAG runtime (like LangGraph's `StateGraph`) would add architectural
complexity without solving a current problem.

The wave-based parallel execution model already handles concurrency at the
orchestration level. Individual workers are single-path: start, run, finish.

---

## Falsifiable Hypothesis

> If LIAN adds an explicit worker lifecycle state machine with guarded
> transitions (inspired by LangGraph's edge-based transition model), then
> invalid state transitions will be structurally prevented because the
> transition table makes every legal path explicit and every illegal path
> absent.

**Measurable outcome:** After implementing the transition table and guards,
zero instances of invalid state transitions (e.g., `completed` → `running`,
`failed` → `planned` without approval) in a 30-day observation window.

**Validation method:** Add a transition validator script that checks
`active-workers.json` updates against the transition table and rejects
violations. Run it in the reconciler.

---

## Bounded Experiment

### Scope

| Aspect | Value |
|--------|-------|
| Allowed files | `docs/ai-native/**`, `scripts/ai/**` |
| Deliverable 1 | Transition table document (`worker-lifecycle-state-machine.md`) |
| Deliverable 2 | Transition validator script (`scripts/ai/validate-worker-transition.js`) |
| Deliverable 3 | Schema update adding `cancelled` status |

### Success Criteria

1. Transition table is documented and cross-referenced by
   `active-workers-schema.md` and `bounded-parallel-worker-execution.md`.
2. Validator script rejects invalid transitions when run against
   `active-workers.json` updates.
3. `cancelled` status is added to the schema with proper documentation.

### Rollback

Remove the transition table document and validator script. The schema
`cancelled` addition is backward-compatible (new optional status value).

---

## What Was NOT Adopted from LangGraph

| LangGraph Feature | Why Not Adopted |
|-------------------|-----------------|
| DAG runtime | LIAN workers are linear, not branching graphs |
| Checkpoint/replay | Existing projection + fact event log is sufficient |
| Typed state objects | `active-workers.json` schema already provides typed fields |
| Graph visualization | Workers are few enough to inspect directly |
| Sub-graph composition | No current need for nested worker graphs |

---

## References

- [LangGraph documentation](https://github.com/langchain-ai/langgraph)
- [Active Workers Schema](active-workers-schema.md) — Current worker state schema
- [Active Workers State](active-workers-state.md) — Projection semantics
- [Bounded Parallel Worker Execution](bounded-parallel-worker-execution.md) — Wave model
- [Backend Worker Layers](backend-worker-layers.md) — Layer model
- [External Intake Executable Loop](external-intake-executable-loop.md) — Intake pipeline
- [External Research Intake Loop](external-research-intake-loop.md) — Research intake stages
- [External Intake Human Gate](external-intake-human-gate.md) — Human review boundaries
- [#1363](https://github.com/taoyu051818-sys/lian-nest-server/issues/1363) — This investigation
