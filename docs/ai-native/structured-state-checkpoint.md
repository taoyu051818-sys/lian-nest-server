# Structured State Checkpoint

Defines a structured checkpoint mechanism that captures a worker's decision
context, recent reflections, and pending actions — enabling continuity
across self-cycle iterations and recovery from interruptions.

> **Closes:** [#1414](https://github.com/taoyu051818-sys/lian-nest-server/issues/1414)
>
> **Evidence:** Hermes context compressor
> (`external-agent-research/hermes-agent/agent/context_compressor.py`)
> uses a structured template for state checkpoints with anti-thrashing
> and head/tail protection.
>
> **See also:**
> [self-cycle-runner.md](self-cycle-runner.md) for the orchestrator,
> [worker-heartbeat.md](worker-heartbeat.md) for liveness snapshots,
> [context-bundles.md](context-bundles.md) for doc manifests,
> [loop-model.md](loop-model.md) for the self-cycle loop.

---

## Problem

LIAN's self-cycle has no state checkpoint mechanism. When a worker runs
out of context or a cycle is interrupted, all decision context is lost.
The worker heartbeat tracks liveness (running/stale/done) but not
*semantic state* — what the worker was doing, what it decided, and what
remains.

Three failure modes this addresses:

1. **Context exhaustion** — A worker hits the context window limit mid-task.
   Without a checkpoint, the next iteration starts from scratch.
2. **Interruption loss** — A cycle is interrupted (health gate red, provider
   exhaustion, manual stop). The worker's partial progress and decisions
   are gone.
3. **Decision amnesia** — Across self-cycle iterations, the worker cannot
   recall why it chose approach A over approach B, leading to repeated
   exploration.

---

## Checkpoint Template

Adapted from the Hermes context compressor's structured template. Each
checkpoint captures a snapshot of the worker's decision state.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `checkpointVersion` | `1` | Yes | Schema version |
| `taskId` | string | Yes | Worker task identifier |
| `issueNumber` | integer/null | Yes | Linked GitHub issue |
| `activeTask` | string | Yes | One-line description of the current task |
| `goal` | string | Yes | What the worker is trying to achieve |
| `constraints` | string[] | Yes | Active constraints (allowed files, risk tier, conflict group) |
| `completedActions` | string[] | Yes | Steps already taken |
| `activeState` | string | Yes | Current phase: `exploring`, `implementing`, `testing`, `blocked`, `reviewing` |
| `inProgress` | string[] | Yes | Actions currently underway |
| `blocked` | string[] | Yes | Blockers preventing progress |
| `keyDecisions` | string[] | Yes | Decisions made and their rationale |
| `resolvedQuestions` | string[] | Yes | Questions that were answered |
| `pendingAsks` | string[] | Yes | Questions or decisions awaiting resolution |
| `relevantFiles` | string[] | Yes | Files read, modified, or relevant to the task |
| `remainingWork` | string[] | Yes | Steps still to be done |
| `criticalContext` | string | Yes | Non-obvious context a future iteration needs |
| `previousCheckpointHash` | string/null | No | SHA-256 of the previous checkpoint (chain integrity) |
| `compressionSkipped` | boolean | Yes | Whether anti-thrashing skipped compression |
| `compressionSkipReason` | string/null | Yes | Reason compression was skipped (null if not skipped) |
| `capturedAt` | string | Yes | ISO-8601 timestamp |

### Example

```json
{
  "checkpointVersion": 1,
  "taskId": "issue-1414-worker",
  "issueNumber": 1414,
  "activeTask": "Add structured state checkpoint to self-cycle",
  "goal": "Enable worker state persistence across context boundaries",
  "constraints": [
    "allowedFiles: docs/ai-native/**, scripts/ai/**",
    "risk: low",
    "forbiddenFiles: src/**, prisma/**"
  ],
  "completedActions": [
    "Read self-cycle-runner.md and related docs",
    "Analyzed Hermes context compressor pattern",
    "Designed checkpoint schema"
  ],
  "activeState": "implementing",
  "inProgress": [
    "Writing save-state-checkpoint.js script"
  ],
  "blocked": [],
  "keyDecisions": [
    "Use NDJSON append format (same as write-self-cycle-run.js)",
    "Default to dry-run mode for safety",
    "Include anti-thrashing check"
  ],
  "resolvedQuestions": [
    "Where to store checkpoints → .github/ai-state/state-checkpoints.ndjson"
  ],
  "pendingAsks": [],
  "relevantFiles": [
    "docs/ai-native/self-cycle-runner.md",
    "docs/ai-native/worker-heartbeat.md",
    "scripts/ai/write-self-cycle-run.js"
  ],
  "remainingWork": [
    "Create save-state-checkpoint.test.js",
    "Run npm run check validation"
  ],
  "criticalContext": "Hermes protects head (system prompt) and tail (recent 20K tokens). Anti-thrashing skips compression if last 2 runs saved < 10%.",
  "previousCheckpointHash": null,
  "compressionSkipped": false,
  "compressionSkipReason": null,
  "capturedAt": "2026-05-13T08:00:00Z"
}
```

---

## Anti-Thrashing

Inspired by the Hermes context compressor's anti-thrashing mechanism.
Compression (checkpoint save) is skipped when the change since the last
checkpoint is too small to be useful.

### Rule

> Skip compression if the last 2 checkpoints saved less than 10% new
> content compared to their predecessors.

### How It Works

1. When saving a checkpoint, compare the new `completedActions`,
   `keyDecisions`, and `remainingWork` arrays against the previous
   checkpoint.
2. Count the number of new items (items not present in the previous
   checkpoint).
3. If the ratio of new items to total items is < 10% for the last 2
   consecutive checkpoints, set `compressionSkipped: true` and
   `compressionSkipReason: "anti-thrash: < 10% new content in last 2 checkpoints"`.
4. The checkpoint is still written (for audit), but downstream consumers
   should treat it as a no-op.

### Rationale

Frequent small checkpoints create noise without value. The 10% threshold
ensures checkpoints capture meaningful state transitions, not incremental
drift.

---

## Head/Tail Protection

When a checkpoint is used to restore context in a new iteration:

1. **Head protection** — The system prompt and task contract are never
   compressed or summarized. They are always passed in full.
2. **Tail protection** — The most recent ~20K tokens of working context
   (recent file reads, recent decisions, recent reflections) are preserved
   in full. Only the middle portion of the context is eligible for
   compression.

This ensures the worker always has its instructions (head) and its most
recent working memory (tail), even when the middle context is compressed.

---

## Storage

Checkpoints are stored as NDJSON in
`.github/ai-state/state-checkpoints.ndjson`, following the same append-only
pattern as self-cycle runs and fact events.

| Property | Value |
|----------|-------|
| Format | NDJSON (one JSON object per line) |
| Path | `.github/ai-state/state-checkpoints.ndjson` |
| Mutability | Append-only |
| Retention | All entries preserved (no automatic pruning) |
| Idempotency | Each checkpoint has a unique `taskId` + `capturedAt` pair |

---

## Integration Points

### Self-Cycle Runner

The runner can invoke `save-state-checkpoint.js` at these points:

| Point | When | Purpose |
|-------|------|---------|
| Pre-launch | After task compilation, before worker dispatch | Capture initial state |
| Mid-cycle | At worker heartbeat intervals (optional) | Capture in-progress state |
| Post-worker | After worker exits (before health gate) | Capture final state |
| On interruption | When cycle is blocked or stopped | Capture interrupted state |

### Worker Heartbeat

The heartbeat tracks liveness; the checkpoint tracks semantics. They are
complementary:

| Aspect | Heartbeat | Checkpoint |
|--------|-----------|------------|
| What | Process alive/dead/silent | Decision context |
| When | Every 15s | At meaningful state transitions |
| Output | `monitor-state.json` (overwrite) | `state-checkpoints.ndjson` (append) |
| Consumer | State reconciler | Next worker iteration |

### Context Bundles

A checkpoint can inform the next iteration's context bundle. If a
checkpoint shows `relevantFiles` and `remainingWork`, the context bundle
generator can prioritize those files.

---

## Usage

```bash
# Show help
node scripts/ai/save-state-checkpoint.js --help

# Dry-run — print checkpoint to stdout
node scripts/ai/save-state-checkpoint.js \
  --task-id issue-1414-worker \
  --issue 1414 \
  --active-task "Add structured state checkpoint" \
  --goal "Enable worker state persistence" \
  --active-state implementing

# Execute — append to ledger
node scripts/ai/save-state-checkpoint.js \
  --task-id issue-1414-worker \
  --issue 1414 \
  --active-task "Add structured state checkpoint" \
  --goal "Enable worker state persistence" \
  --active-state implementing \
  --completed-actions '["Read docs","Designed schema"]' \
  --remaining-work '["Write test","Run validation"]' \
  --live

# Self-test
node scripts/ai/save-state-checkpoint.js --self-test
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Checkpoint processed (dry-run preview or live write) |
| `1` | Self-test failure |
| `2` | Invalid arguments |

---

## Design Constraints

- **Dry-run by default.** No file is modified unless `--live` is passed.
- **Append-only.** Checkpoints are never modified or deleted.
- **No secrets.** Sanitization strips tokens and credentials before writing.
- **Anti-thrashing.** Compression is skipped when new content is < 10%.
- **Head/tail protection.** System prompt and recent context are never
  compressed.
- **Complementary to heartbeat.** This does not replace liveness monitoring.

---

## References

- [Self-Cycle Runner](self-cycle-runner.md) — Orchestrator
- [Worker Heartbeat](worker-heartbeat.md) — Liveness monitoring
- [Context Bundles](context-bundles.md) — Doc manifests
- [Loop Model](loop-model.md) — Self-cycle loop
- [State Reconciler](state-reconciler.md) — Drift detection
- [Fact Event Schema](fact-event-schema.md) — Evidence recording
- [#1414](https://github.com/taoyu051818-sys/lian-nest-server/issues/1414) — This feature
