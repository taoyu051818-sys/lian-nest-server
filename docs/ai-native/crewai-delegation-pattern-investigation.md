# CrewAI Delegation Pattern Investigation

Investigates CrewAI's role-based agent delegation model and
evaluates whether bounded sub-worker delegation would improve
LIAN's task decomposition quality.

> **Closes:** [#1367](https://github.com/taoyu051818-sys/lian-nest-server/issues/1367)
>
> **Cross-references:**
> [external-research-intake-loop.md](external-research-intake-loop.md) for the
> intake loop that produced this investigation,
> [worker-task-contract.md](worker-task-contract.md) for the current task
> contract schema,
> [parallel-task-decomposition-policy.md](parallel-task-decomposition-policy.md)
> for the existing decomposition model,
> [roles.md](roles.md) for the current role definitions,
> [worker-behavior-policy.md](worker-behavior-policy.md) for behavioral
> constraints.

---

## Source

| Field | Value |
|-------|-------|
| External project | [CrewAI](https://github.com/crewAIInc/crewAI) |
| Source class | `external-doc` |
| Reliability tier | B |
| Captured at | 2026-05-13T04:17:06.687Z |
| Applicability | Analogous |

---

## External Observation

CrewAI assigns agents specific roles (researcher, writer, reviewer)
with explicit delegation chains. A manager agent can delegate
subtasks to specialized agents, each with their own tools and
constraints. Supports sequential, parallel, and hierarchical
execution modes.

Key CrewAI design properties:

1. **Role specialization.** Each agent has a defined role, goal, and
   backstory. The role constrains what the agent can do and what
   tools it accesses.
2. **Delegation chains.** A manager agent can break a task into
   subtasks and assign each to a specialized agent. Delegation is
   explicit — the manager decides who does what.
3. **Execution modes.** Sequential (one agent at a time), parallel
   (independent agents concurrently), and hierarchical (manager
   delegates, agents report back).
4. **Shared context.** Agents in a crew share a context object that
   carries intermediate results between delegation steps.
5. **Tool binding.** Each agent has a specific set of tools it can
   use. Tools are scoped to the agent's role, not the entire crew.

---

## LIAN Surface

**Current state:** LIAN uses a flat orchestrator-worker model. The
orchestrator (`batch-launch.ps1`) dispatches workers into isolated
git worktrees. Each task maps to exactly one worker. Workers do not
delegate to or spawn other workers.

**Role packets** (`worker-task-contract.md`) are routing metadata —
they select a role prompt file but do not encode specialized tool
access or delegation authority.

**Task decomposition** (`parallel-task-decomposition-policy.md`)
operates at the orchestrator level before dispatch. Issues are
decomposed into independent fact changes with DAG dependencies.
Once a worker is dispatched, it works alone until completion or
straggler timeout.

**Gap description:** A worker that encounters a complex subtask
mid-execution (e.g., "I need to research X before I can write Y")
cannot spawn a specialized sub-worker. It must either:
- Do the subtask itself (even if it is outside the worker's
  primary role specialization)
- Comment a blocker and stop (losing the worktree slot and time)
- Open a partial PR and hope a future worker finishes

---

## Pattern Claim

LIAN's flat worker model is architecturally correct for isolation
and conflict safety, but it creates a specific quality gap:
**mid-task reasoning complexity is unbounded.** A worker's role
packet constrains which files it can edit but not which reasoning
tasks it must perform. A backend-programmer worker that discovers
it needs a security analysis mid-task will attempt the analysis
itself, producing lower-quality output than a dedicated
security-reviewer worker would.

CrewAI's delegation model addresses this by letting a manager agent
break reasoning work into role-specialized subtasks. The relevant
pattern for LIAN is not CrewAI's full multi-agent framework but a
narrower concept: **bounded in-task delegation** — a worker that
can request a read-only sub-worker for a specialized reasoning
subtask, subject to the same conflict-group and file-scope
constraints as the parent.

---

## Applicability Assessment

**Analogous.** The pattern solves a similar problem (reasoning
quality on complex tasks) but in a fundamentally different
architecture. CrewAI is a runtime multi-agent framework; LIAN is a
batch orchestrator with isolated worktrees. Direct adoption of
CrewAI's delegation model would conflict with LIAN's isolation
invariant.

### What LIAN Already Does Well

| CrewAI Feature | LIAN Equivalent | Gap? |
|---------------|-----------------|------|
| Role specialization | `rolePacket` + role prompts in `ops/agent-prompts/` | No — roles exist |
| Task decomposition | `parallel-task-decomposition-policy.md` + DAG scheduling | No — mature at orchestrator level |
| Conflict isolation | `allowedFiles` + `conflictGroup` + `writeSet` | No — stronger than CrewAI's |
| Execution modes | Parallel waves via `batch-launch.ps1 -Parallel` | No — orchestrator controls this |
| Tool scoping | `allowedFiles` + `forbiddenFiles` | No — file-level boundary |

### What LIAN Lacks

| CrewAI Feature | LIAN Gap | Severity |
|---------------|----------|----------|
| Mid-task delegation | Worker cannot request sub-assistance | Medium |
| Shared context between roles | No cross-worker context passing | Low (worktrees are isolated by design) |
| Manager/coordinator role | No in-task coordination role | Low (orchestrator fills this at batch level) |
| Dynamic tool binding per role | Tools are implicit (Claude Code's built-in tools) | Low (role prompts achieve similar scoping) |

---

## Hypothesis

> "If LIAN adds bounded read-only sub-worker requests (inspired by
> CrewAI's delegation chains), then task completion quality will
> improve for complex multi-concern tasks because each subtask is
> handled by the appropriate role specialist."

### Falsification Criteria

This hypothesis is **rejected** if any of the following are true:

1. **Isolation violation.** Sub-worker requests cannot be bounded
   to the parent's `allowedFiles` without creating a new worktree
   (which breaks the conflict-group invariant).
2. **Cost outweighs benefit.** The overhead of spawning sub-workers
   (worktree creation, LLM context setup, validation) exceeds the
   quality gain for the typical task complexity in LIAN.
3. **Orchestrator already solves it.** The existing
   `parallel-task-decomposition-policy.md` can express the same
   decomposition at the orchestrator level before dispatch, making
   in-task delegation redundant.
4. **Straggler amplification.** Sub-worker delegation increases
   task duration beyond `hardTimeMinutes` for a significant
   fraction of tasks.

---

## Evidence Analysis

### Evidence For (Sub-Worker Delegation Would Help)

1. **Complex tasks cross role boundaries.** A feature worker that
   discovers a security concern mid-task currently handles it
   without security-reviewer expertise. A read-only sub-worker
   with the `security-reviewer` role packet could produce higher
   quality analysis.

2. **Research tasks are inherently multi-concern.** A research
   worker investigating "should we adopt pattern X" may need to
   read source code (backend-programmer), evaluate security
   implications (security-reviewer), and assess migration risk
   (migration-auditor). Currently one worker does all three.

3. **CrewAI's adoption validates the pattern.** CrewAI has
   significant community adoption (60k+ GitHub stars), suggesting
   that role-based delegation addresses a real need in agent
   systems.

### Evidence Against (Sub-Worker Delegation Would Not Help)

1. **LIAN's decomposition is pre-dispatch, not mid-task.** The
   `parallel-task-decomposition-policy.md` and `task-dag-scheduling-policy.md`
   already decompose complex work into independent fact changes
   before any worker is dispatched. The orchestrator IS the manager
   agent — it just operates at batch time, not at runtime.

2. **Isolation is a hard invariant, not a preference.** LIAN's
   worktree isolation guarantees that two workers never write to
   the same file concurrently. Sub-workers that share a worktree
   with their parent would violate this invariant. Sub-workers in
   separate worktrees would need their own `allowedFiles` — which
   is exactly what the orchestrator already provides via task JSON.

3. **Read-only sub-workers add latency without clear value.** A
   read-only sub-worker (no file edits) is effectively a second
   LLM call with role-specific context. The same result could be
   achieved by expanding the parent worker's `knowledgeRefs` or
   `promptHandoff` to include role-specific guidance, which is
   zero-overhead.

4. **Task slicing quality gate already enforces single-concern.**
   The `task-slicing-quality-gate.md` requires each task slice to
   have a "Single Fact Change" — meaning a well-sliced task should
   not need multi-role reasoning. If a task needs security analysis
   AND implementation AND documentation, it should be three tasks,
   not one task with sub-workers.

5. **CrewAI's model assumes a different trust boundary.** CrewAI
   agents share a runtime and can freely delegate because they
   operate in a single-process environment. LIAN workers are
   isolated processes in separate git worktrees with independent
   validation. The trust model is fundamentally different.

---

## Verdict

**No actionable improvement.** The investigation finds that LIAN's
existing architecture already addresses the core concern (task
decomposition quality) through a different and arguably stronger
mechanism.

### Why the Gap Is Already Closed

| Concern | CrewAI Solution | LIAN Solution | Assessment |
|---------|----------------|---------------|------------|
| Complex tasks need multiple roles | In-task delegation | Pre-dispatch decomposition into single-role tasks | LIAN's approach preserves isolation |
| Specialized reasoning per subtask | Manager assigns to specialist agent | `rolePacket` + `knowledgeRefs` per task | Equivalent at task level |
| Intermediate results between stages | Shared context object | `dependsOnFacts` + `producesFacts` DAG edges | Stronger — fact-based, not context-based |
| Parallel execution of independent parts | Crew parallel mode | Parallel waves via `-Parallel` flag | Equivalent |

### What Could Be Improved (Not Via Sub-Workers)

Two lower-cost improvements could address the quality concern
without introducing delegation:

1. **Richer `knowledgeRefs` for cross-concern tasks.** When a task
   compiler detects that a task touches multiple concern areas
   (security + feature, migration + docs), it could automatically
   include relevant role prompts as `knowledgeRefs`. This gives the
   worker access to specialist guidance without spawning a
   sub-worker.

2. **Task slicing quality gate tightening.** The existing
   `task-slicing-quality-gate.md` "Single Fact Change" check could
   be extended to detect multi-role concerns and flag them for
   decomposition at the orchestrator level.

Both improvements stay within LIAN's existing architecture and
require no new worker capabilities.

---

## Recommendation

**Close with summary.** The CrewAI delegation pattern is well-suited
to its runtime multi-agent architecture but does not map cleanly to
LIAN's batch orchestrator model with worktree isolation. LIAN's
pre-dispatch decomposition already achieves the equivalent outcome
through a different mechanism that better preserves the isolation
invariant.

If future task quality metrics show a correlation between
multi-concern tasks and low completion quality, the two improvements
noted above (richer knowledgeRefs, tighter slicing gate) should be
explored before considering delegation.

---

## Key Files

| Path | Relevance |
|------|-----------|
| `docs/ai-native/worker-task-contract.md` | Current task schema — rolePacket, allowedFiles |
| `docs/ai-native/parallel-task-decomposition-policy.md` | Pre-dispatch decomposition model |
| `docs/ai-native/task-slicing-quality-gate.md` | Quality gate for task slices |
| `docs/ai-native/roles.md` | Role definitions |
| `docs/ai-native/worker-behavior-policy.md` | Worker behavioral constraints |
| `docs/ai-native/backend-worker-layers.md` | Six-layer worker model |
| `docs/ai-native/bounded-parallel-worker-execution.md` | Parallel execution bounds |
| `docs/ai-native/external-research-intake-loop.md` | Intake loop that produced this investigation |

---

## References

- [CrewAI](https://github.com/crewAIInc/crewAI) — Source project
- [External Research Intake Loop](external-research-intake-loop.md) — Intake pipeline
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Parallel Task Decomposition Policy](parallel-task-decomposition-policy.md) — Decomposition model
- [Task Slicing Quality Gate](task-slicing-quality-gate.md) — Slice quality checks
- [Roles](roles.md) — Role definitions
- [Bounded Experiment Policy](bounded-experiment-policy.md) — Experiment scoping
- [#1367](https://github.com/taoyu051818-sys/lian-nest-server/issues/1367) — This investigation
