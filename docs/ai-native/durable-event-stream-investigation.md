# Durable Event Stream Investigation

Research into whether LIAN workers should adopt an event stream with
checkpoint semantics, inspired by OpenHands EventStream and LangGraph
checkpoint patterns.

> **Closes:** [#1444](https://github.com/taoyu051818-sys/lian-nest-server/issues/1444)
>
> **Source:** External research on OpenHands `openhands/events/` and
> LangGraph checkpoint architecture.
>
> **Task type:** Research (read-only investigation, no runtime changes)

---

## External Patterns Studied

### OpenHands EventStream

OpenHands centers on an `EventStream` where all agent actions, tool calls,
and observations are serialized as events. Key properties:

| Property | Description |
|----------|-------------|
| **Append-only** | Every action, tool call, and observation is a new event entry |
| **Timestamped** | Each event has a `timestamp` field |
| **Parent references** | Events reference their parent event, forming a DAG |
| **Checkpointable** | The agent can be paused at any event boundary |
| **Replayable** | Given the event log, the agent state can be reconstructed |
| **Branchable** | A new execution can fork from any historical event |

The stream acts as the single source of truth. The agent's current state
is derived by replaying events from the last checkpoint.

### LangGraph Checkpoints

LangGraph provides durable state snapshots at graph node boundaries:

| Property | Description |
|----------|-------------|
| **State snapshots** | Full graph state captured at each node transition |
| **Durable storage** | Checkpoints persist to a backing store (SQLite, Postgres, etc.) |
| **Resume from checkpoint** | Execution restarts from a specific checkpoint, not from scratch |
| **Thread-based** | Each execution thread has its own checkpoint chain |
| **Fork support** | New threads can branch from any checkpoint |

The key insight: LangGraph separates "what happened" (events) from
"what the state was" (checkpoints). Events are cheap to append;
checkpoints are expensive but enable fast resume.

---

## Current LIAN Worker State

### What LIAN Already Has

| Component | Pattern | Gap for Checkpointing |
|-----------|---------|----------------------|
| **Fact event ledger** (`fact-events.ndjson`) | Append-only NDJSON, typed events, sanitized | Records *observable facts* (launches, health changes) — not worker-level actions |
| **Worker heartbeat** (`monitor-state.json`) | Snapshot-overwrite, liveness states | Tracks *whether* a worker is alive, not *what it did* |
| **State projections** (active-workers, provider-pool) | Idempotent JSON snapshots | Point-in-time state, no history of transitions |
| **Gap ledger** (`gap-ledger.ndjson`) | Append-only NDJSON for failures | Records failures after the fact, not during execution |
| **Recovery policy** | Six categories, writeSet isolation | Restarts from scratch — no checkpoint resume |

### The Core Gap

LIAN workers (Claude Code instances in worktrees) are stateless from the
orchestrator's perspective:

1. **No action log.** The orchestrator sees launch → heartbeat → done/failed.
   What happened between launch and completion is opaque.

2. **No checkpoint.** If a worker crashes at 80% progress, the orchestrator
   cannot resume from the 80% mark. It restarts from scratch.

3. **No replay.** Debugging a failed worker means reading git history and
   PR diffs — there's no structured action log to replay.

4. **No branching.** Cannot fork a worker's execution from a mid-point
   to try an alternative approach.

---

## Feasibility Assessment

### What an Event Stream Would Require

| Requirement | Effort | Notes |
|-------------|--------|-------|
| Define event schema for worker actions | Low | Extend `fact-event.schema.json` with worker action types |
| Instrument Claude Code to emit events | **High** | Requires hooking into Claude Code's tool-use loop — not directly controllable |
| Persist events durably during execution | Medium | Could write to worktree-local file, sync to ai-state |
| Implement checkpoint/resume protocol | **High** | Requires Claude Code to accept a "resume from checkpoint" prompt |
| Replay engine | Medium | Reconstruct worker state from event log |
| Branching support | Medium | Fork event chain at arbitrary point |

### The Fundamental Blocker

LIAN workers are Claude Code instances — third-party AI agents running as
black-box processes. The orchestrator launches them and waits for exit.
There is no hook into Claude Code's internal action loop to:

- Intercept each tool call as it happens
- Serialize intermediate state
- Inject a "resume from checkpoint X" instruction mid-execution

This means the event stream pattern from OpenHands (which controls its own
agent runtime) cannot be directly transplanted to LIAN's architecture.

### What IS Feasible Without Runtime Changes

Three incremental improvements that stay within LIAN's current control
plane:

#### 1. Worker Action Fact Events (Low Effort)

Extend the fact event ledger with worker-lifecycle events that the
orchestrator *can* observe:

| Event Type | Source | When |
|------------|--------|------|
| `worker.action.tool-call` | Claude Code stdout parsing | Tool call detected in output |
| `worker.action.file-edit` | Git diff after completion | File changed by worker |
| `worker.action.checkpoint` | Worker self-report | Worker emits structured marker |

This creates a *post-hoc* action log — not real-time, but reconstructable.

#### 2. Partial Progress Recovery (Medium Effort)

When a worker crashes, the orchestrator can:

1. Read the worktree's git state (committed + uncommitted changes).
2. Generate a "partial progress" fact event summarizing what was completed.
3. Launch a recovery worker with the partial progress as context.

This is not checkpoint-resume, but it avoids the "restart from scratch"
problem for workers that made partial progress before crashing.

#### 3. Structured Worker Output Protocol (Low Effort)

Define a protocol where workers emit structured markers during execution:

```
::checkpoint::issue-397::step-3-of-7::files-modified-2
::checkpoint::issue-397::step-5-of-7::files-modified-4
```

The orchestrator parses these from stdout (like it already does for
heartbeat state) and records them as fact events. On recovery, the new
worker receives the last checkpoint marker as context.

This is the closest LIAN can get to checkpoint semantics without modifying
Claude Code itself.

---

## Recommendation

**Do not implement a full event stream with checkpoint/resume.** The
fundamental blocker (Claude Code is a black-box process) makes the
OpenHands/LangGraph patterns inapplicable without major architectural
changes.

**Instead, pursue three bounded improvements:**

| Priority | Improvement | Closes | Effort |
|----------|-------------|--------|--------|
| 1 | Worker action fact events | Partial #1444 | Low — extend existing event schema |
| 2 | Structured worker output protocol | Partial #1444 | Low — stdout parsing in heartbeat monitor |
| 3 | Partial progress recovery | Partial #1444 | Medium — extend recovery policy |

These three changes give LIAN 60-70% of the debugging and recovery value
of a full event stream, without requiring control over Claude Code's
internal execution loop.

### Future Path

If LIAN moves to a custom agent runtime (replacing Claude Code with a
self-hosted agent loop), a full event stream becomes feasible. The fact
event infrastructure built for the bounded improvements above would serve
as the foundation for that architecture.

---

## Comparison Matrix

| Capability | OpenHands | LangGraph | LIAN Current | LIAN + Bounded Improvements |
|------------|-----------|-----------|--------------|----------------------------|
| Action logging | Full (real-time) | Full (node-level) | None | Post-hoc (stdout + git) |
| Checkpoint | Any event | Any node | None | Worker-emitted markers |
| Resume | From any checkpoint | From any checkpoint | None | From last marker + git state |
| Branch | Fork event chain | Fork thread | None | Not feasible |
| Replay | Full | Full | None | Partial (fact events) |
| Debugging | Full trace | Full trace | Git diff only | Structured action log |

---

## References

- [Fact Event Schema](fact-event-schema.md) — Existing event schema
- [Fact Event Ledger](fact-event-ledger.md) — Append-only ledger
- [Worker Heartbeat](worker-heartbeat.md) — Liveness monitoring
- [Parallel Recovery Policy](parallel-recovery-policy.md) — Recovery categories
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Loop Model](loop-model.md) — Self-cycle runner
- [Backend Worker Layers](backend-worker-layers.md) — Layer model
