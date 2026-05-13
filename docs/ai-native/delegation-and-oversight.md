# Delegation and Oversight

Investigates whether LIAN workers should support bounded
sub-worker delegation, inspired by CrewAI's role-based agent
teams with explicit delegation chains.

> **Closes:** [#1408](https://github.com/taoyu051818-sys/lian-nest-server/issues/1408)
>
> **Source:** [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)
>
> **See also:**
> [parallel-task-decomposition-policy.md](parallel-task-decomposition-policy.md)
> for the current task decomposition model,
> [worker-task-contract.md](worker-task-contract.md) for the
> task JSON schema,
> [worker-behavior-policy.md](worker-behavior-policy.md) for
> behavioral principles,
> [seed-constitution.md](seed-constitution.md) for immutable
> boundaries,
> [orchestration.md](orchestration.md) for the launcher
> architecture.

---

## What CrewAI Does

CrewAI assigns agents specific roles (researcher, writer,
reviewer) with explicit delegation chains. Key properties:

| Property | CrewAI Implementation |
|----------|----------------------|
| Role assignment | Each agent has a named role, goal, and backstory |
| Delegation chain | A manager agent delegates subtasks to specialized agents |
| Tool scoping | Each agent has its own tools and constraints |
| Execution modes | Sequential, parallel, and hierarchical |
| Sub-task spawning | Agents can spawn sub-agents for specialized work |
| Oversight | Manager reviews sub-agent output before accepting |

The core pattern: a manager agent decomposes a complex task
at runtime, assigns subtasks to role-specialized agents, and
synthesizes their outputs. Each sub-agent operates within its
own tool and scope boundaries.

---

## What LIAN Has Today

LIAN's current architecture handles task decomposition through
a different mechanism:

| Concern | LIAN Mechanism | CrewAI Equivalent |
|---------|---------------|-------------------|
| Task decomposition | `compile-issue-to-task-json.ps1` at compile time | Manager agent at runtime |
| Role assignment | `rolePacket.actorRole` in task JSON | Agent role definition |
| Scope boundaries | `allowedFiles` / `forbiddenFiles` globs | Tool scoping per agent |
| Parallel execution | Conflict groups + shared locks | Parallel execution mode |
| Sequential dependencies | `dependsOnFacts` / `producesFacts` DAG | Sequential/hierarchical mode |
| Worker isolation | Git worktrees per worker | Agent-level isolation |
| Oversight | Launch gate + health gate + PR review | Manager agent review |

### What LIAN Lacks

1. **No runtime delegation.** A worker cannot spawn a sub-worker
   for a specialized subtask. If a backend-programmer worker
   discovers it needs a security review mid-task, it cannot
   delegate that subtask — it must either do it itself or
   comment a blocker.

2. **No task-time decomposition.** Decomposition happens at
   compile time. A worker that realizes its task should be
   split cannot re-decompose.

3. **No manager-worker hierarchy.** Workers are flat peers.
   There is no concept of a worker that oversees other workers.

---

## Gap Analysis

### Is the Gap Real?

Partially. LIAN already decomposes tasks before launch using
the parallel task decomposition policy. The DAG model with
`dependsOnFacts` and `producesFacts` handles sequencing. The
launch gate handles conflict safety.

The gap is narrow: **a worker that discovers mid-task that it
needs specialized help has no structured way to request it.**

Current behavior when a worker hits this:

| Situation | Current Response |
|-----------|-----------------|
| Needs security review | Comments blocker on issue |
| Needs docs update | Does it within its own scope or skips |
| Task too large | Publishes partial via straggler policy |
| Needs specialist knowledge | Reads `knowledgeRefs` or stops |

### Does CrewAI's Pattern Apply?

**Partially.** CrewAI's runtime delegation is powerful but
conflicts with LIAN's design principles:

| Principle | CrewAI Delegation | LIAN Constraint |
|-----------|-------------------|-----------------|
| Scope immutability | Workers can spawn sub-workers with new scopes | Seed constitution §5: no worker scope expansion |
| Pre-planned tasks | Decomposition is runtime, dynamic | Decomposition is compile-time, auditable |
| Gate enforcement | Manager agent gates sub-agents | Launch gate gates all workers |
| Conflict safety | Runtime coordination | Static conflict groups |

**Full CrewAI-style delegation would violate the seed
constitution.** A worker spawning a sub-worker with its own
`allowedFiles` is effectively expanding its own scope through
a proxy.

---

## Recommendation: Bounded Sub-Worker Delegation

Adopt a **limited delegation pattern** that preserves LIAN's
governance model while giving workers a structured way to
request specialized subtasks.

### Design Constraints

1. **No autonomous spawning.** Workers cannot create
   sub-workers. They can only *request* delegation.
2. **Orchestrator approval.** The batch launcher decides
   whether to fulfill a delegation request.
3. **Same conflict group.** Sub-tasks inherit the parent's
   conflict group. No new conflict groups from delegation.
4. **Narrower scope only.** A sub-task's `allowedFiles` must
   be a subset of the parent's `allowedFiles`.
5. **No recursive delegation.** Sub-workers cannot delegate
   further.
6. **Audit trail.** Every delegation request is recorded in
   the task ledger.

### Proposed Mechanism: Delegation Request

A worker that needs specialized help emits a structured
delegation request in its output (PR body or result JSON):

```json
{
  "delegationRequest": {
    "requestedRole": "security-reviewer",
    "subtask": "Review auth module changes for injection vectors",
    "suggestedFiles": ["src/modules/auth/auth.service.ts"],
    "reason": "Task touches auth flow; security-reviewer role is better suited",
    "blocking": true
  }
}
```

The orchestrator reads this request and decides:

| Decision | Action |
|----------|--------|
| Approve | Create a new task JSON with the requested role and narrower scope, launch as a sub-task in the same worktree branch |
| Reject | Comment rejection reason on the PR; original worker continues |
| Escalate | Route to human for manual triage |

### What This Does NOT Add

- No runtime agent spawning
- No manager-worker hierarchy
- No recursive delegation
- No scope expansion beyond parent boundaries
- No changes to the seed constitution

### What This Adds

- Structured way for workers to request help
- Orchestrator-mediated delegation (not autonomous)
- Audit trail for delegation decisions
- Better utilization of role specialization

---

## Comparison

| Dimension | CrewAI | LIAN Current | LIAN + Delegation Request |
|-----------|--------|-------------|--------------------------|
| Decomposition | Runtime, dynamic | Compile-time, static | Compile-time + runtime requests |
| Delegation | Autonomous | None | Orchestrator-mediated |
| Scope control | Per-agent | Per-task (immutable) | Per-task (requests are narrower) |
| Oversight | Manager agent | Gate stack | Gate stack + orchestrator decision |
| Auditability | Agent logs | Task ledger | Task ledger + delegation log |
| Seed constitution compatible | No | Yes | Yes |

---

## Implementation Path

If the team decides to pursue delegation requests:

1. Add `delegationRequest` schema to `worker-task-contract.md`
2. Update `worker-behavior-policy.md` with delegation request
   guidelines
3. Add delegation request parsing to `batch-launch.ps1`
4. Add delegation decision logic to `check-launch-gate.ps1`
5. Update `task-ledger-schema.md` with delegation audit fields

Estimated scope: medium. Touches orchestration scripts and
task contract docs. No backend code changes.

---

## Non-Goals

- No runtime agent spawning
- No changes to `src/` or `prisma/`
- No recursive delegation
- No modification to the seed constitution
- No autonomous manager-worker hierarchy

---

## References

- [CrewAI](https://github.com/crewAIInc/crewAI) — Source
  project for delegation patterns
- [CrewAI Docs](https://docs.crewai.com) — Official
  documentation
- [Parallel Task Decomposition Policy](parallel-task-decomposition-policy.md)
- [Worker Task Contract](worker-task-contract.md)
- [Worker Behavior Policy](worker-behavior-policy.md)
- [Seed Constitution](seed-constitution.md)
- [Orchestration](orchestration.md)
- [#1408](https://github.com/taoyu051818-sys/lian-nest-server/issues/1408)
  — This investigation
