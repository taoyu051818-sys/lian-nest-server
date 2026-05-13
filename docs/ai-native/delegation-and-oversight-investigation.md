# Delegation and Oversight Investigation

Investigation into whether LIAN workers should support bounded sub-worker
delegation, modeled on CrewAI's role-based agent teams with explicit
delegation chains.

> **Closes:** [#1432](https://github.com/taoyu051818-sys/lian-nest-server/issues/1432)
>
> **Source:** CrewAI delegation model (external-doc, reliability: high)
>
> **See also:**
> [worker-task-contract.md](worker-task-contract.md) for the task JSON schema,
> [backend-worker-layers.md](backend-worker-layers.md) for the layer model,
> [bounded-parallel-worker-execution.md](bounded-parallel-worker-execution.md) for parallelism,
> [worker-behavior-policy.md](worker-behavior-policy.md) for behavioral principles.

---

## What CrewAI Does

CrewAI assigns agents specific roles (researcher, writer, reviewer) with
explicit delegation chains. Key properties:

| Property | CrewAI Implementation |
|----------|----------------------|
| Role assignment | Each agent has a defined role, backstory, and toolset |
| Delegation chain | Manager agent can delegate subtasks to specialized agents |
| Execution modes | Sequential, parallel, and hierarchical |
| Tool scoping | Each agent has its own allowed tools |
| Constraint inheritance | Sub-agents inherit the parent's constraints |

The hierarchical process mode is the most relevant: a manager agent
automatically decomposes a complex task and assigns subtasks to crew
members, collecting and synthesizing results.

---

## What LIAN Currently Has

LIAN's worker system already covers several aspects of role-based execution:

| Aspect | LIAN Implementation | Coverage |
|--------|---------------------|----------|
| Role assignment | `rolePacket.actorRole` in task JSON | Full |
| Role definitions | `roles.md` with 8 defined roles | Full |
| Tool/file scoping | `allowedFiles` / `forbiddenFiles` in task JSON | Full |
| Constraint enforcement | Launcher validates boundaries before worker start | Full |
| Parallel execution | Conflict-group-based wave scheduling | Full |
| Task decomposition | `plan-next-batch.ps1` + issue splitting | Partial |
| Delegation chains | Not supported | Missing |
| Sub-worker spawning | Not supported | Missing |
| Result aggregation | PR-level only (no sub-task synthesis) | Partial |

### Current Task Decomposition Path

```
plan-next-batch.ps1
  → reads open issues
  → ranks by meta-signals
  → emits batch JSON
    → compile-issue-to-task-json.ps1
      → emits per-issue task JSON
        → batch-launch.ps1
          → launches one worker per issue (parallel waves)
```

Decomposition happens **at planning time**, not at execution time. A
worker receives a pre-decomposed task and cannot further subdivide it.

---

## Gap Analysis

### What LIAN Lacks (Relative to CrewAI)

| Gap | Impact | Severity |
|-----|--------|----------|
| **Runtime task decomposition** | Worker cannot split a complex task into subtasks during execution | Medium |
| **Sub-worker spawning** | Worker cannot delegate a specialized subtask (e.g., "run security scan") to a sub-agent | Medium |
| **Hierarchical execution** | No manager-worker relationship within a single task | Low |
| **Result synthesis** | No mechanism for a parent worker to collect and merge sub-worker outputs | Low |

### What LIAN Already Covers

| CrewAI Concept | LIAN Equivalent | Assessment |
|----------------|-----------------|------------|
| Role-based agents | `rolePacket` + `roles.md` | Equivalent |
| Tool scoping | `allowedFiles` / `forbiddenFiles` | Stricter (glob-based) |
| Parallel execution | Conflict-group waves | More deterministic |
| Constraint inheritance | Task JSON contract | Equivalent (flat, not hierarchical) |
| Specialized agents | Layer model (6 layers) | Different axis but same goal |

---

## Risk Assessment

### Risks of Adding Runtime Delegation

| Risk | Description | Likelihood | Impact |
|------|-------------|------------|--------|
| Scope creep | Sub-workers could expand beyond original task boundaries | High | High |
| Conflict resolution | Sub-workers within the same parent may have overlapping file needs | Medium | High |
| Debugging complexity | Nested worker failures are harder to trace | Medium | Medium |
| Launcher complexity | `batch-launch.ps1` would need nested worker tracking | Medium | Medium |
| Violation of surgical scope | Principle 3 (worker-behavior-policy.md) assumes a flat file boundary | High | Medium |
| Telemetry gaps | Active worker tracking assumes one worker per issue | Low | Medium |

### Risks of NOT Adding Delegation

| Risk | Description | Likelihood | Impact |
|------|-------------|------------|--------|
| Over-decomposed issues | Issues that need multi-concern work get split into too many small issues | Low | Low |
| Worker overreach | Worker tries to handle concerns outside its expertise (e.g., code worker does security review) | Medium | Low |
| Slower iteration | Complex tasks require multiple waves instead of one adaptive execution | Low | Low |

---

## Analysis

### Why LIAN's Current Model Is Sufficient

LIAN's architecture makes a deliberate trade: **deterministic decomposition
at planning time** over **adaptive decomposition at execution time**. This
trade is well-suited to the current operating context:

1. **Issue granularity already controls decomposition.** The `plan-next-batch`
   and `compile-issue-to-task-json` scripts split work at issue boundaries.
   If a task needs code + security review, it should be two issues, not one
   issue with sub-worker delegation.

2. **Parallel waves already provide concurrency.** Workers run in parallel
   across conflict groups. Adding sub-worker spawning within a worker would
   create nested parallelism that the conflict resolver doesn't handle.

3. **The layer model already provides specialization.** Layer 4 (Feature)
   workers implement code; Layer 5 (Review/Audit) workers review it. This
   is CrewAI's researcher/writer/reviewer split, just at the wave level
   instead of the sub-task level.

4. **Surgical scope depends on flat boundaries.** The `allowedFiles` /
   `forbiddenFiles` contract is the foundation of the worker behavior
   policy. Sub-workers would need their own sub-boundaries, creating a
   tree of file scopes that the launcher would need to validate recursively.

### Where Delegation Would Add Value

The one scenario where delegation would genuinely help:

- **Complex multi-concern tasks that resist issue splitting.** Example:
  a single endpoint that needs implementation + migration + security review
  as an atomic unit. Currently this requires either (a) one worker that
  overreaches its role, or (b) multiple sequential waves with handoff
  overhead.

  This is rare in practice. The current solution — issue splitting with
  blocked-by relationships — handles most cases.

---

## Recommendation

**Close this investigation with no code change.** The current architecture
covers the delegation use case through planning-time decomposition and
wave-level parallelism. Adding runtime sub-worker delegation would increase
complexity without proportional benefit.

### Actionable Improvements (No Delegation Required)

If the team wants to improve task decomposition quality without adding
delegation chains, these targeted changes would help:

| Change | Effort | Impact |
|--------|--------|--------|
| Add `blockedBy` field to issue templates for multi-concern tasks | Low | Medium |
| Document issue-splitting heuristics in `plan-next-batch` guidance | Low | Low |
| Add a `layer` field to task JSON (already defined in backend-worker-layers.md but not enforced) | Low | Low |

### Future Revisit Triggers

Revisit this investigation if:

1. Workers frequently need to handle multiple concerns in a single issue
   (more than 20% of issues resist clean splitting).
2. The system scales past 30 concurrent workers and needs hierarchical
   orchestration.
3. A specific task type (e.g., migration + feature + audit) consistently
   requires more than 2 sequential waves.

---

## References

- [CrewAI Documentation](https://docs.crewai.com) — Source of delegation pattern
- [Worker Task Contract](worker-task-contract.md) — LIAN task JSON schema
- [Backend Worker Layers](backend-worker-layers.md) — Layer model with specialization
- [Worker Behavior Policy](worker-behavior-policy.md) — Surgical scope principle
- [Bounded Parallel Worker Execution](bounded-parallel-worker-execution.md) — Conflict-group parallelism
- [SOP.md](SOP.md) — Full lifecycle and batch execution
