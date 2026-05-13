# Conversational Agent Collaboration Analysis

Investigation into multi-agent structured conversation patterns —
specifically Microsoft AutoGen's approach — and their applicability to
LIAN's worker isolation architecture.

> **Closes:** [#1364](https://github.com/taoyu051818-sys/lian-nest-server/issues/1364)
>
> **Source:** [microsoft/autogen](https://github.com/microsoft/autogen)
> (external-doc, Tier B)
>
> **See also:**
> [external-research-intake-loop.md](external-research-intake-loop.md)
> for the intake loop that produced this analysis,
> [parallel-work-policy.md](parallel-work-policy.md) for current
> conflict resolution,
> [bounded-parallel-worker-execution.md](bounded-parallel-worker-execution.md)
> for worker dispatch,
> [context-bundles.md](context-bundles.md) for worker context model.

---

## Purpose

LIAN workers currently operate in complete isolation — each worker runs
in its own git worktree with no runtime communication channel to other
workers. Coordination is entirely preventive (conflict groups, shared
locks, launch gate) rather than reactive. This analysis investigates
whether structured conversation patterns from AutoGen could improve
inter-worker coordination without sacrificing the isolation guarantees
that prevent file-level conflicts.

---

## AutoGen Patterns Observed

### Pattern 1: Structured Conversations

AutoGen agents communicate through typed message sequences. Each message
has a role (user/assistant/tool), content, and metadata. Agents
negotiate task allocation by exchanging proposals and counter-proposals
within a conversation thread.

**Relevance to LIAN:** Low direct applicability. LIAN workers are
dispatched by a central orchestrator (batch launcher), not
self-organizing. Adding negotiation protocols would require workers to
be aware of each other at runtime, which conflicts with the isolation
model.

### Pattern 2: Shared Context Through Message History

AutoGen maintains a shared message history that all participants can
read. New agents joining a conversation receive the full history,
enabling context carry-over without explicit handoff.

**Relevance to LIAN:** Moderate. LIAN's context bundles already provide
static context (docs, schemas, policies). The gap is dynamic context —
what other workers have discovered or changed during the current batch.
A read-only shared observation log could serve this purpose without
enabling write conflicts.

### Pattern 3: Human Feedback at Decision Points

AutoGen supports `human_input_mode` where agents pause and request
operator input at configurable decision points.

**Relevance to LIAN:** Already addressed. LIAN's human gate
(`external-intake-human-gate.md`) and agent idea review gate
(`agent-idea-review-gate.md`) provide structured human decision points.
No gap identified.

### Pattern 4: Nested Conversations for Subtask Decomposition

AutoGen supports parent-child conversation trees where a coordinator
agent spawns sub-conversations for subtasks, then aggregates results.

**Relevance to LIAN:** Low. LIAN's task decomposition happens at the
planning layer (issue-to-task compiler, planning loop), not at worker
runtime. Workers receive pre-decomposed tasks. Adding runtime
decomposition would blur the planning/execution boundary.

---

## LIAN's Current Coordination Model

| Mechanism | Type | Timing | Gap |
|-----------|------|--------|-----|
| Conflict groups | Preventive | Pre-launch | None — prevents file overlap |
| Shared locks | Preventive | Pre-launch | None — prevents resource contention |
| Launch gate | Preventive | Pre-launch | None — blocks conflicting dispatches |
| Active workers projection | Observational | Periodic | Stale — snapshot, not live |
| Worker assignment ledger | Audit | Post-hoc | No runtime use |
| Heartbeat monitor | Observational | Periodic | One-directional (monitor → worker) |
| PR body handoff | Post-hoc | Post-completion | Not structured, no schema |
| State reconciler | Observational | Periodic | Detects drift, doesn't prevent it |

### What LIAN Lacks

1. **No runtime observation sharing.** Workers cannot see what other
   workers in the same batch have discovered. If Worker A finds that a
   file has an unexpected structure, Worker B (working on a different
   file in the same subsystem) has no way to know.

2. **No structured handoff schema.** The `handoffOutputs` field in the
   worker task contract is "Not implemented." Workers communicate
   results through unstructured PR bodies.

3. **No batch-scoped shared memory.** Workers share nothing at runtime.
   The active workers projection is written by the orchestrator, not by
   workers.

---

## Gap Analysis

| AutoGen Pattern | LIAN Gap | Severity | Recommended Action |
|----------------|----------|----------|-------------------|
| Structured conversations | Workers are dispatched, not self-organizing | None | Do not adopt — conflicts with isolation model |
| Shared message history | No runtime observation sharing | Low | Consider read-only observation log |
| Human feedback at decision points | Already implemented (human gate) | None | No action needed |
| Nested conversations | Task decomposition is pre-runtime | None | Do not adopt — blurs planning/execution boundary |

---

## Recommendation: Read-Only Observation Log

The only actionable gap is the lack of runtime observation sharing. The
recommended approach is a **read-only, append-only observation log**
scoped to a batch — not a bidirectional message bus.

### Design Constraints

1. **Append-only.** Workers can write observations but cannot read other
   workers' observations until after their own task completes (or at a
   configured checkpoint). This preserves the isolation model.

2. **Batch-scoped.** Observations are scoped to a `batchId`. They are
   discarded after the batch completes. No cross-batch persistence.

3. **Structured schema.** Each observation has a fixed schema: `workerId`,
   `timestamp`, `category` (discovery|blocker|warning|info), `subject`,
   `summary`, `evidenceRefs`. No free-form messaging.

4. **No write conflicts.** Each worker writes to its own observation
   file (e.g., `.github/ai-state/batch-observations/{batchId}/{workerId}.ndjson`).
   No shared file, no merge conflicts.

5. **Post-hoc aggregation.** The state reconciler or a new
   `batch-observation-aggregator` script merges per-worker observations
   into a batch summary after the batch completes. This summary is
   available to the next batch's context bundles.

### What This Does NOT Enable

- No real-time worker-to-worker messaging
- No negotiation or task reallocation at runtime
- No shared mutable state
- No breaking of the worktree isolation model

### Bounded Experiment Proposal

**Hypothesis:** "If LIAN adds a structured observation log to worker
task contracts, then post-batch reconciliation quality will improve
because the state reconciler will have structured worker-discovered
evidence instead of only PR bodies."

**Experiment scope:**
- Add `observationLog` field to worker task contract schema
- Add `write-observation.js` script (append-only, per-worker file)
- Add `aggregate-batch-observations.js` script (post-batch merge)
- Update context bundle generator to include prior batch observations
- Measure: reconciliation accuracy (drift detection false
  positive/negative rate) before and after

**Allowed files:** `docs/ai-native/**`, `scripts/ai/**`, `schemas/**`
**Risk:** Low — additive, no changes to existing dispatch or isolation
**Rollback:** Remove observation fields from task contract, delete
observation scripts

---

## Hard Boundaries

1. **No runtime inter-worker messaging.** Any proposal that requires
   workers to read each other's state during execution violates the
   isolation model and is rejected.

2. **No self-organizing workers.** LIAN uses a central orchestrator for
   task allocation. Worker-initiated task negotiation is out of scope.

3. **No breaking worktree isolation.** Each worker must remain in its
   own git worktree with its own file namespace.

4. **Observations are evidence, not commands.** Worker observations
   cannot trigger task reallocation, worker termination, or policy
   changes at runtime. They are input for post-batch analysis.

---

## References

- [microsoft/autogen](https://github.com/microsoft/autogen) — Source
  project for multi-agent conversation patterns
- [External Research Intake Loop](external-research-intake-loop.md) —
  Intake loop stages
- [Parallel Work Policy](parallel-work-policy.md) — Conflict resolution
  rules
- [Bounded Parallel Worker Execution](bounded-parallel-worker-execution.md)
  — Worker dispatch model
- [Context Bundles](context-bundles.md) — Worker context model
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Active Workers State](active-workers-state.md) — Worker projection
- [Worker Heartbeat](worker-heartbeat.md) — Liveness monitoring
- [State Reconciler Active Workers](state-reconciler-active-workers.md) —
  Drift detection
- [Worker Behavior Policy](worker-behavior-policy.md) — Behavioral rules
- [#1364](https://github.com/taoyu051818-sys/lian-nest-server/issues/1364) —
  This investigation
