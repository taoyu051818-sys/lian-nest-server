# Lightweight Agent Handoff Investigation

Investigates whether worker-to-worker function routing (inspired by
OpenAI Swarm) could reduce Command Steward bottleneck while preserving
existing safety boundaries.

> **Closes:** [#1433](https://github.com/taoyu051818-sys/lian-nest-server/issues/1433)
>
> **Evidence source:** [openai/swarm](https://github.com/openai/swarm)
> — function calling for inter-agent handoff. Reliability: medium.
>
> **See also:**
> [command-steward-agent.md](command-steward-agent.md) for current
> orchestrator role,
> [conflict-group-allocator.md](conflict-group-allocator.md) for
> parallel safety,
> [bounded-parallel-worker-execution.md](bounded-parallel-worker-execution.md)
> for wave model.

---

## Current Architecture

The Command Steward is the single orchestrator between human intent and
worker dispatch. Every action flows through:

```
Human → Command Steward → Launch Gate → Worker
```

Workers are isolated in worktrees with explicit `allowedFiles` boundaries.
They cannot request help, delegate subtasks, or hand off to peers. If a
worker discovers it needs work outside its scope, it must either:
- Complete what it can within bounds and note the gap in its PR body.
- Fail and let the Command Steward decide the next action.

This creates a bottleneck: every inter-task dependency requires a human
or Steward round-trip.

---

## Swarm Model (Reference)

OpenAI Swarm uses function calling to let agents hand off to each other.
Each agent exposes named functions; when one agent calls another's
function, context transfers. There is no central orchestrator — agents
self-route based on capabilities.

Key properties:
- Agents declare handoff functions (e.g., `transfer_to_billing_agent`).
- Calling a handoff function transfers the conversation context.
- Each agent has a bounded instruction set and tool access.
- No persistent state between handoffs unless explicitly threaded.

---

## Applicability Analysis

### What Transfers Well

| Swarm Concept | LIAN Equivalent | Fit |
|---------------|-----------------|-----|
| Agent capabilities | `allowedFiles` + `layer` | Strong — already defined per task |
| Handoff functions | Subtask request protocol | Moderate — needs new protocol |
| Bounded instructions | Task JSON contract | Strong — already exists |
| Context transfer | Task JSON passthrough | Strong — already structured |

### What Does Not Transfer

| Swarm Concept | LIAN Constraint | Why It Fails |
|---------------|-----------------|--------------|
| No central orchestrator | Seed Constitution requires human approval | Constitution mandates human-in-the-loop for mutations |
| Self-routing | Conflict groups require pre-assignment | Post-hoc conflict detection is too late for parallel safety |
| Free-form context | Worktree isolation | Workers cannot read each other's worktrees |
| No gate bypass | Launch gate is mandatory | Handoffs must pass through the same gate as initial dispatch |

---

## Proposed Hybrid: Bounded Worker Handoff

Instead of full Swarm-style self-routing, a bounded handoff protocol
lets workers request subtasks within the existing safety model.

### Protocol

```
Worker A (running)                    Command Steward
    │                                      │
    │  discovers out-of-scope dependency    │
    │                                      │
    │  writes handoff request to            │
    │  .ai/handoff-requests.ndjson          │
    │─────────────────────────────────────▶│
    │                                      │  evaluates request
    │                                      │  against conflict groups
    │                                      │  and launch gate
    │                                      │
    │  ◀── handoff result ─────────────────│
    │  (accepted + new task, or rejected)   │
    │                                      │
    │  if accepted:                         │
    │    Worker B launched in new worktree  │
    │    Worker A continues or waits        │
```

### Handoff Request Schema

```jsonc
{
  "requestVersion": 1,
  "requestedBy": "issue-1433",
  "requestedAt": "2026-05-13T10:00:00Z",
  "targetScope": {
    "allowedFiles": ["scripts/ai/new-helper.js"],
    "layer": "contract-planning",
    "conflictGroup": "ai-scripts"
  },
  "reason": "Need utility function outside current allowedFiles",
  "blockingCurrentTask": true,
  "context": {
    "callerBranch": "claude/issue-1433",
    "callerWorktree": ".claude/worktrees/claude/issue-1433",
    "relatedFiles": ["scripts/ai/existing-file.js"]
  }
}
```

### Safety Invariants Preserved

| Invariant | Enforcement |
|-----------|-------------|
| Conflict group safety | Steward checks against in-flight workers before accepting |
| Launch gate | Handoff requests pass through same gate as manual launches |
| File boundaries | `targetScope.allowedFiles` must not overlap with caller's scope |
| Human approval | High-risk handoffs (touching `src/**`) require human confirmation |
| Layer ordering | Handoff target must not violate layer dependency rules |
| Wave budget | Handoff counts against effective parallelism limit |

### Rejection Conditions

The Steward rejects a handoff request when:

1. Target `allowedFiles` overlaps with any in-flight worker.
2. Launch gate would block the target scope.
3. Effective parallelism is at capacity.
4. Target scope is high-risk (`src/**`, `prisma/**`) without human approval.
5. Caller's own task is high-risk (handoffs from high-risk tasks are blocked).
6. Target layer depends on a layer that is not yet stable.

---

## Implementation Path (If Approved)

### Phase 1: Observational (No Handoff Execution)

- Workers write handoff requests to `.ai/handoff-requests.ndjson`.
- Steward reads requests and logs acceptance/rejection decisions.
- No actual worker dispatch from handoffs.
- Measures: request rate, rejection reasons, scope patterns.

### Phase 2: Steward-Mediated Handoff

- Steward evaluates handoff requests against full gate model.
- Accepted requests compile into task JSON and dispatch via existing
  `batch-launch.ps1`.
- Results written back to caller via `.ai/handoff-results.ndjson`.
- Caller can read results and incorporate into its own output.

### Phase 3: Bounded Autonomy (Optional, Requires Constitution Review)

- Low-risk handoffs (docs, scripts/ai) auto-accept if gate passes.
- Medium-risk handoffs still require Steward evaluation.
- High-risk handoffs always require human confirmation.
- **Requires Seed Constitution amendment** to allow worker-initiated
  dispatch for low-risk scopes.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Handoff loop (A→B→A) | Low | Medium | Track handoff depth; max 2 hops |
| Conflict group bypass | Low | High | Steward re-checks on every handoff |
| Scope creep via handoff chain | Medium | Medium | Cumulative scope tracking; reject if chain exceeds 3 files |
| Worker stalls waiting for handoff | Medium | Low | Timeout after 10 min; continue with partial result |
| Increased Steward load | Medium | Medium | Batch handoff evaluation; async processing |

---

## Recommendation

**Do not implement full Swarm-style self-routing.** The LIAN control
plane requires human-in-the-loop approval and pre-assigned conflict
groups. Removing the central orchestrator violates the Seed Constitution.

**Implement Phase 1 (observational) as a bounded experiment.** Workers
write handoff requests; Steward logs decisions but does not dispatch.
After 2 weeks of data, evaluate whether handoff patterns justify Phase 2.

**Key metrics to collect:**
- How often do workers discover out-of-scope dependencies?
- What file patterns appear in handoff requests?
- What percentage would pass the launch gate?
- Does the current bottleneck (Steward round-trip) materially slow work?

If Phase 1 shows >20% of workers would benefit from handoffs and >80%
of requests would pass the gate, Phase 2 is justified. Otherwise, close
this investigation with findings and no code changes.

---

## References

- [OpenAI Swarm](https://github.com/openai/swarm) — Function routing
  between specialized agents
- [Command Steward Agent](command-steward-agent.md) — Current
  orchestrator role and authority boundaries
- [Conflict Group Allocator](conflict-group-allocator.md) — Parallel
  safety via pre-assigned groups
- [Bounded Parallel Worker Execution](bounded-parallel-worker-execution.md)
  — Wave model and effective parallelism
- [Backend Worker Layers](backend-worker-layers.md) — Layer ordering
  and dependency rules
- [Loop Model](loop-model.md) — Self-cycle runner phases
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
