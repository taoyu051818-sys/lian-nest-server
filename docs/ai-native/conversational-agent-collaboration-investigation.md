# Conversational Agent Collaboration — Investigation

Investigates whether AutoGen-style multi-agent conversational collaboration
can improve LIAN's worker coordination. Finds that AutoGen's runtime
negotiation model conflicts with LIAN's isolation-first architecture, but
identifies three bounded improvements that capture the collaboration benefits
without sacrificing parallelism safety.

> **Closes:** [#1364](https://github.com/taoyu051818-sys/lian-nest-server/issues/1364)
>
> **See also:**
> [external-research-intake-loop.md](external-research-intake-loop.md) for
> the intake loop that produced this investigation,
> [backend-worker-layers.md](backend-worker-layers.md) for the canonical
> layer model,
> [worker-architecture-decision-summary.md](worker-architecture-decision-summary.md)
> for open decisions including `handoffOutputs`,
> [bounded-parallel-worker-execution.md](bounded-parallel-worker-execution.md)
> for parallelism policy,
> [context-bundles.md](context-bundles.md) for worker context delivery.

---

## External Observation

**Source:** [Microsoft AutoGen](https://github.com/microsoft/autogen)
(source class: `external-doc`, reliability tier: B)

AutoGen enables multi-agent collaboration through structured conversations.
Agents negotiate task allocation, share context through message history, and
can request human feedback at decision points. Supports nested conversations
for subtask decomposition.

Key AutoGen patterns:

| Pattern | Description |
|---------|-------------|
| **Conversational protocol** | Agents exchange structured messages in a shared conversation thread |
| **Task negotiation** | Agents bid on or delegate tasks based on capability declarations |
| **Nested conversations** | A parent agent spawns child conversations for subtasks |
| **Human-in-the-loop** | Agents pause at decision points for human feedback |
| **Shared message history** | All agents in a group chat see the full conversation |

---

## LIAN Architecture Gap

LIAN workers operate in full isolation. Each worker runs in its own git
worktree, on its own branch, with no runtime visibility into peer workers.
Coordination is entirely pre-launch and post-completion:

| Coordination Phase | Mechanism | Timing |
|-------------------|-----------|--------|
| Pre-launch | Conflict groups, shared locks, layer ordering | Before worker starts |
| At launch | Static context bundle (docs, schemas, policies) | Worker start time |
| During execution | **None** — worker is isolated | Runtime |
| Post-completion | PR body handoff, knowledge writeback | After worker finishes |

The gap: workers in the same wave cannot share discoveries, negotiate
resource contention, or coordinate complementary work during execution.
If Worker A discovers a dependency Worker B needs, Worker A can only write
it to a PR body — Worker B will not see it until the next batch cycle.

---

## Applicability Assessment

### What AutoGen Does That LIAN Lacks

| AutoGen Pattern | LIAN Gap | Severity |
|----------------|----------|----------|
| Shared conversation thread | No inter-worker communication channel | Medium |
| Task negotiation at runtime | Conflict resolution only at scheduling time | Low |
| Nested subtask decomposition | `handoffOutputs` not implemented (open decision #3) | Medium |
| Human-in-the-loop during execution | Workers run autonomously once launched | Low |
| Live message history | Context bundles are static snapshots | Medium |

### Why AutoGen's Model Does Not Directly Fit

AutoGen assumes agents share a runtime environment and can exchange messages
synchronously. LIAN's architecture deliberately isolates workers to enable
safe parallelism:

1. **Isolation is a safety feature.** Workers in the same `conflictGroup`
   are never co-scheduled precisely because concurrent access to the same
   files causes merge conflicts. A shared message bus that allows runtime
   negotiation would weaken this guarantee.

2. **Workers are stateless processes.** Each worker is a Claude Code process
   launched with a task JSON contract. It has no persistent identity, no
   capability registry, and no mechanism to receive mid-execution messages
   from a bus.

3. **Wave boundaries require human review.** The SOP states that the
   launcher does not auto-generate follow-up waves. This means
   cross-wave coordination must pass through human review regardless.

4. **Cost and latency.** AutoGen-style group chats multiply token
   consumption by the number of agents in the conversation. LIAN's
   per-worker token budgets are already a constraint.

---

## Findings

### Finding 1: Structured Handoff Protocol (Applicability: Direct)

The `handoffOutputs` field in the task JSON contract is listed as "Not
implemented" in the worker architecture decision summary (open decision
#3). The PR body "Follow-up Handoff" section serves as an implicit
handoff, but it is free-form text that downstream tools cannot reliably
parse.

**Recommendation:** Implement `handoffOutputs` as a structured JSON array
in the worker result schema. Each entry carries a target surface, a
description, and optional data payload. This gives workers a
machine-readable way to communicate findings to downstream workers without
requiring a runtime message bus.

**Pattern source:** AutoGen's structured message format — agents exchange
typed messages, not free-form text.

**Bounded scope:**

- Add `handoffOutputs` array to the worker result JSON schema
- Each entry: `{ "target": string, "description": string, "data"?: object }`
- `publish-agent-result.ps1` includes handoff outputs in the PR body as
  a structured section
- `generate-context-bundle.js` reads handoff outputs from peer PRs in
  the same wave when building context bundles

### Finding 2: Wave-Local Fact Sharing (Applicability: Partial)

AutoGen's shared message history allows all agents in a conversation to
see discoveries in real-time. LIAN's context bundles are static snapshots
generated at launch time — they cannot include facts discovered by
co-running workers.

**Recommendation:** Add a wave-local fact file
(`.github/ai-state/wave-facts/<wave-id>.ndjson`) that workers in the same
wave can append to during execution. Workers read this file when building
their context, gaining visibility into peer discoveries without a
synchronous message bus. This is append-only and file-based, consistent
with LIAN's existing NDJSON ledger pattern.

**Pattern source:** AutoGen's shared message history — all agents see the
full conversation.

**Bounded scope:**

- New NDJSON file per wave: `.github/ai-state/wave-facts/<wave-id>.ndjson`
- Workers append facts with `write-fact-event.js --type wave.discovery`
- `generate-context-bundle.js` includes wave facts from the current wave
- No synchronous messaging — workers poll the file at natural breakpoints
  (e.g., between subtasks)

### Finding 3: Worker Capability Declarations (Applicability: Anologous)

AutoGen agents declare their capabilities so the orchestrator can assign
tasks to the most suitable agent. LIAN workers receive fixed task
contracts — there is no mechanism for a worker to signal "I can also help
with X" or "I discovered I need Y first."

**Recommendation:** Not actionable now. LIAN's task assignment is
deterministic (conflict groups, layers, risk levels). Worker capability
self-reporting would add complexity without clear benefit given the
current task granularity. Revisit if workers become more autonomous.

---

## Rejected Approaches

### Shared Conversation Thread (Rejected)

Adding a shared conversation thread where workers exchange messages in
real-time would require:

- A message broker or shared file with locking
- Workers capable of receiving and processing mid-execution messages
- Token budget for reading and responding to peer messages
- Conflict resolution for contradictory peer messages

This conflicts with LIAN's isolation model and would multiply token costs.
The wave-local fact file (Finding 2) achieves the read-sharing benefit
without the complexity.

### Runtime Task Negotiation (Rejected)

AutoGen-style task bidding requires workers to declare capabilities and
compete for tasks. LIAN's task assignment is deterministic — conflict
groups and layer ordering prevent overlap by construction. Adding runtime
negotiation would complicate the scheduler without reducing conflicts
that the pre-launch system already prevents.

### Nested Subtask Conversations (Rejected)

AutoGen's nested conversations allow agents to spawn child agents for
subtasks. LIAN workers already decompose work via the PR handoff
mechanism — a worker that discovers subtasks writes them as follow-up
handoff entries. Implementing `handoffOutputs` (Finding 1) formalizes
this without requiring runtime child process spawning.

---

## Opportunity Signal

If any finding is promoted to a bounded experiment, it should follow the
standard intake loop:

| Finding | Hypothesis | LIAN Surface | Experiment |
|---------|-----------|--------------|------------|
| Structured handoff | If LIAN adds `handoffOutputs` to worker results, then downstream worker context quality will improve because handoff data is machine-readable | Worker result schema, context bundles | Add schema field, update `publish-agent-result.ps1` and `generate-context-bundle.js` |
| Wave-local facts | If LIAN adds wave-local fact sharing, then duplicate work between co-running workers will decrease because workers can see peer discoveries | Fact event ledger, context bundles | Add wave NDJSON file, update context bundle generator |

Both findings are low-risk and bounded to `docs/ai-native/**` and
`scripts/ai/**`. They do not touch `src/**` or `prisma/**`.

---

## Conclusion

AutoGen's conversational collaboration model does not directly fit LIAN's
isolation-first architecture. The runtime negotiation and shared
conversation patterns conflict with the deliberate worker isolation that
enables safe parallelism.

However, the investigation identifies two bounded improvements that
capture the collaboration benefits without sacrificing isolation:

1. **Structured handoff protocol** — formalize the existing PR body
   handoff as machine-readable JSON (closes open decision #3)
2. **Wave-local fact sharing** — append-only NDJSON file for co-running
   workers to share discoveries

Both are low-risk, file-based, and consistent with LIAN's existing
NDJSON ledger patterns. They should be promoted through the standard
intake loop as opportunity signals if the owner agrees they address
real coordination gaps.

---

## References

- [Microsoft AutoGen](https://github.com/microsoft/autogen) — Multi-agent
  collaboration framework
- [external-research-intake-loop.md](external-research-intake-loop.md) —
  Intake loop that produced this investigation
- [backend-worker-layers.md](backend-worker-layers.md) — Canonical layer
  model
- [worker-architecture-decision-summary.md](worker-architecture-decision-summary.md) —
  Open decisions including `handoffOutputs` (decision #3)
- [bounded-parallel-worker-execution.md](bounded-parallel-worker-execution.md) —
  Parallelism policy
- [context-bundles.md](context-bundles.md) — Worker context delivery
- [pr-handoff-template.md](pr-handoff-template.md) — Current implicit
  handoff mechanism
- [knowledge-driven-scaling.md](knowledge-driven-scaling.md) — Knowledge
  writeback invariant
- [#1364](https://github.com/taoyu051818-sys/lian-nest-server/issues/1364) —
  This investigation
