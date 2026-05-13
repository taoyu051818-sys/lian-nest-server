# Delegation and Oversight Investigation

Investigates whether CrewAI's role-based agent team pattern (manager
delegation to specialized sub-agents) could improve LIAN's task
decomposition quality. Produced as part of the external research intake
loop for issue #1367.

> **Closes:** [#1367](https://github.com/taoyu051818-sys/lian-nest-server/issues/1367)
>
> **Source:** [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)
>
> **Source class:** `external-doc` — structured and maintained, not
> version-pinned to LIAN
>
> **Reliability tier:** B
>
> **See also:**
> [external-research-intake-loop.md](external-research-intake-loop.md)
> for the intake loop,
> [parallel-task-decomposition-policy.md](parallel-task-decomposition-policy.md)
> for LIAN's current decomposition model,
> [worker-task-contract.md](worker-task-contract.md) for the task JSON
> schema,
> [worker-behavior-policy.md](worker-behavior-policy.md) for behavioral
> principles.

---

## Summary

**Finding: No actionable improvement for LIAN at this time.** CrewAI's
delegation chain pattern solves a problem LIAN already addresses through
a different architecture. The investigation recommends closing this issue
with no code or policy changes, but recording the pattern for future
reference if LIAN's orchestration model evolves.

---

## CrewAI Pattern Analysis

### How CrewAI Delegation Works

CrewAI organizes work into **crews** — teams of specialized agents that
collaborate on a shared goal. Each agent has:

| Attribute | Description |
|-----------|-------------|
| `role` | Specialized function (researcher, writer, reviewer) |
| `goal` | What this agent optimizes for |
| `backstory` | Context that shapes agent behavior |
| `tools` | Specific capabilities (web search, file I/O, code execution) |
| `allow_delegation` | Whether this agent can spawn sub-tasks for other agents |

The **manager agent** (or hierarchical process) decomposes a high-level
goal into sub-tasks and delegates each to the most appropriate
specialized agent. Delegation chains can be:

- **Sequential** — Agent A finishes, hands output to Agent B
- **Parallel** — Agents work simultaneously on independent sub-tasks
- **Hierarchical** — Manager delegates to leads who delegate to workers

### Key CrewAI Capabilities

1. **Runtime delegation** — An agent mid-task can decide it needs help
   and spawn a sub-task for another agent with specific instructions.
2. **Tool scoping** — Each agent receives only the tools relevant to its
   role, limiting blast radius.
3. **Delegation chains** — Agent A delegates to B, who may delegate to C,
   creating a tree of responsibility.
4. **Process modes** — Sequential, parallel, and hierarchical execution
   with different coordination overhead.

---

## LIAN Current State

### What LIAN Already Has

| CrewAI Concept | LIAN Equivalent | Gap? |
|----------------|-----------------|------|
| Specialized roles | `rolePacket.actorRole` + role prompts in `ops/agent-prompts/` | No gap — LIAN has 10+ specialized roles |
| Tool scoping | `allowedFiles` / `forbiddenFiles` globs per task | No gap — LIAN's file boundary is stricter than CrewAI's tool list |
| Parallel execution | Wave-based parallel dispatch with conflict groups, shared locks, write sets | No gap — LIAN has more granular parallel safety |
| Sequential execution | DAG dependencies via `dependsOnFacts` / `producesFacts` | No gap — LIAN has explicit fact-based ordering |
| Task decomposition | Pre-launch decomposition by orchestrator (issue-to-task compiler, opportunity-to-task compiler) | **Different timing** — LIAN decomposes before dispatch, not at runtime |
| Manager oversight | Launch gate, self-cycle runner, command steward agent | No gap — LIAN has multi-layer oversight |
| Goal orientation | `sourceIssue` acceptance criteria, `attentionAreas` | No gap — workers have explicit acceptance criteria |

### What LIAN Lacks (The Gap)

The one capability CrewAI has that LIAN does not: **runtime
delegation** — a worker mid-task deciding it needs a specialized
sub-worker and spawning one.

In LIAN today, if a worker discovers mid-task that it needs a
specialized sub-task (e.g., a backend-programmer worker realizes it
needs a migration-auditor to validate a schema change), it must:

1. Stop and comment a blocker on the issue
2. Wait for a human or the orchestrator to create a new task
3. The new task goes through the full launch pipeline

CrewAI would let the worker delegate directly at runtime.

---

## Analysis: Would Runtime Delegation Help LIAN?

### Arguments FOR Adding Delegation

1. **Reduced human intervention** — Workers could self-resolve certain
   sub-task needs without blocking on the orchestrator.
2. **Faster iteration** — Delegation chains could complete multi-step
   tasks in a single worker session instead of across multiple launch
   cycles.
3. **Better context preservation** — A sub-worker spawned at runtime
   inherits the parent's context (files read, decisions made) instead
   of starting cold.

### Arguments AGAINST Adding Delegation

1. **LIAN's pre-launch decomposition is a feature, not a bug.**
   LIAN deliberately decomposes tasks *before* dispatch so the launch
   gate can validate conflict groups, write sets, risk tiers, and
   resource slots. Runtime delegation bypasses this safety layer.

2. **File boundary enforcement becomes ambiguous.** If Worker A spawns
   Sub-Worker B, whose `allowedFiles` govern B? A's? B's own? The
   intersection? CrewAI handles this with tool lists, but LIAN's glob
   boundaries are more complex (conflict groups, shared locks, write
   sets).

3. **Conflict group integrity breaks.** If Worker A (conflict group:
   `user-search`) spawns Sub-Worker B that touches files in
   `user-cache`, B is not tracked in any conflict group. The launch
   gate cannot prevent B from conflicting with a concurrent worker in
   the `user-cache` group.

4. **Telemetry and accountability blur.** LIAN tracks workers by issue
   number, branch, worktree, and PID. A sub-worker spawned at runtime
   has no entry in `active-workers.json`, no telemetry events, and no
   merge path. Who owns the PR?

5. **The orchestrator already solves this.** LIAN's self-cycle runner
   detects blocked workers and can auto-compile follow-up tasks. The
   `stragglerPolicy` already handles partial progress. The gap is not
   delegation — it's orchestrator responsiveness.

6. **Complexity budget.** CrewAI's delegation model adds significant
   runtime complexity (delegation resolution, chain tracking, tool
   re-assignment). LIAN's strength is its simple, auditable worker
   lifecycle. Adding delegation would increase the surface area for
   failures without a proportional quality improvement.

### Verdict

**The pattern does not map cleanly to LIAN's architecture.** LIAN's
pre-launch decomposition with conflict groups, write sets, and DAG
dependencies is a *different* solution to the same problem CrewAI solves
with runtime delegation. Both are valid approaches, but they are
mutually exclusive in their safety models:

| Property | CrewAI (runtime delegation) | LIAN (pre-launch decomposition) |
|----------|---------------------------|-------------------------------|
| Safety validation | Per-agent tool scoping | Per-task file boundaries + conflict groups + launch gate |
| Parallelism control | Process-level (sequential/parallel/hierarchical) | DAG-level with write set and risk tier checks |
| Accountability | Crew-level output | Per-worker PR with telemetry |
| Recovery | Agent retry within crew | Straggler policy + orchestrator re-launch |

Adding runtime delegation to LIAN would require rethinking the conflict
group model, the active worker manifest, the telemetry schema, and the
merge pipeline — all to solve a problem the orchestrator already handles
through follow-up task compilation.

---

## What Could Be Improved Instead

While runtime delegation is not recommended, the investigation
identified two smaller, bounded improvements that address the same
underlying need (better task decomposition quality):

### 1. Orchestrator Responsiveness for Blocked Workers

**Problem:** When a worker discovers a sub-task need, the latency
between "worker posts blocker comment" and "orchestrator compiles
follow-up task" can be long.

**Proposal:** Add a `blocker-type` structured field to worker blocker
comments so the orchestrator can auto-classify and auto-compile
follow-up tasks without human triage. This is a smaller change than
runtime delegation and preserves the pre-launch safety model.

**Out of scope for this issue** — would require a new issue with
`allowedFiles: ["docs/ai-native/**", "scripts/ai/**"]`.

### 2. Context Handoff for Follow-Up Tasks

**Problem:** When a follow-up task is compiled from a blocker, the new
worker starts cold — it must re-read all the context the blocked worker
already gathered.

**Proposal:** Allow workers to emit a `contextHandoff` artifact (a
structured JSON file in the worktree) that the orchestrator passes to
the follow-up task's `knowledgeRefs`. This preserves context without
runtime delegation.

**Out of scope for this issue** — would require a new issue.

---

## Opportunity Signal

Following the external research intake loop, this investigation
produces the following opportunity signal assessment:

| Field | Value |
|-------|-------|
| Pattern ID | `pat-delegation-oversight-1367` |
| External Project | CrewAI |
| LIAN Surface | Worker dispatch, task decomposition, orchestrator |
| Applicability | **Analogous** — solves a similar problem with a different architecture |
| Recommendation | **Do not adopt.** Record pattern for future reference. |

### Hypothesis (Falsifiable)

> "If LIAN added runtime worker-to-worker delegation (inspired by
> CrewAI), then task completion latency for multi-role tasks would
> decrease because workers would not block on orchestrator follow-up
> compilation."

**Assessment:** Hypothesis is plausible but the tradeoff is unacceptable
— delegation would break conflict group integrity, telemetry
accountability, and the pre-launch safety model. The cost exceeds the
benefit.

---

## Conclusion

**Close issue #1367 with no code or policy changes.** CrewAI's
delegation chain pattern is a valid approach for multi-agent systems
that lack pre-launch task decomposition. LIAN already has a stronger
safety model (conflict groups, write sets, DAG dependencies, launch
gate) that solves the same problem at a different stage of the
lifecycle.

The two follow-up improvements (orchestrator responsiveness, context
handoff) are better addressed as separate, bounded issues that extend
LIAN's existing model rather than replacing it with runtime delegation.

---

## References

- [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) — Source
  project
- [External Research Intake Loop](external-research-intake-loop.md) —
  Intake loop governance
- [Parallel Task Decomposition Policy](parallel-task-decomposition-policy.md) —
  LIAN's decomposition model
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Worker Behavior Policy](worker-behavior-policy.md) — Behavioral
  principles
- [Self-Cycle Runner](self-cycle-runner.md) — Orchestrator lifecycle
- [Launch Gate](launch-gate.md) — Pre-launch validation
- [Straggler Policy](worker-task-contract.md#stragglerpolicy) — Partial
  progress handling
