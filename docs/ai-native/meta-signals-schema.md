# Meta-Signals JSON Schema

Formal JSON Schema for `.github/ai-state/meta-signals.json`, the meta-signals
snapshot consumed by the planning loop and batch launcher for risk-aware
prioritization.

> **Schema file:** [`schemas/meta-signals.schema.json`](../../schemas/meta-signals.schema.json)
> **Closes:** [#465](https://github.com/taoyu051818-sys/lian-nest-server/issues/465)

---

## Overview

The meta-signals snapshot is a single JSON file that aggregates planning
feedback from health checks and worker heartbeats. It provides six signals
that the planning loop uses to rank candidate tasks for the next worker batch.

| Aspect | Value |
|--------|-------|
| Schema version | `snapshotVersion: 1` |
| JSON Schema draft | `draft-07` |
| Writer | `scripts/ai/calculate-meta-signals.js` |
| Path | `.github/ai-state/meta-signals.json` |

---

## Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `snapshotVersion` | `integer` (const `1`) | Schema version. Increment when the shape changes. |
| `calculatedAt` | `string` (ISO-8601) | Timestamp when this snapshot was calculated. |
| `inputSources` | `InputSources` | Metadata about the input log files used to produce this snapshot. |
| `signals` | `Signals` | The computed health signals aggregated from input logs. |

---

## InputSources

Metadata about the NDJSON log files fed into the calculator.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `healthLog` | `string \| null` | Yes | Path to the health NDJSON log file, or `null` if not provided. |
| `heartbeatLog` | `string \| null` | Yes | Path to the heartbeat NDJSON log file, or `null` if not provided. |
| `healthEntryCount` | `integer` (min 0) | Yes | Number of entries parsed from the health log. |
| `heartbeatEntryCount` | `integer` (min 0) | Yes | Number of entries parsed from the heartbeat log. |

---

## Signals

The six computed health signals. All score fields are integers in the range
0-100 except `cost` (a non-negative number) and `topPain` (a string).

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `failureScore` | `integer` | 0-100 | Aggregated failure severity weighted by category. Sum of category weights for red-state entries, capped at 100. |
| `frictionScore` | `integer` | 0-100 | Friction from stale workers and no-output episodes. Sum of friction points from heartbeat states, capped at 100. |
| `riskScore` | `integer` | 0-100 | Unresolved high-risk slices. Sum of severity points (high=20, medium=10), capped at 100. |
| `cost` | `number` | 0+ | Elapsed worker-minutes in the batch window. Sum of `elapsedMs` across all heartbeat entries, converted to minutes. |
| `trust` | `integer` | 0-100 | Inverse of failure+friction. Formula: `clamp(100 - (failureScore * 0.6 + frictionScore * 0.4), 0, 100)`. 100 = full trust. |
| `topPain` | `string` | — | Category with the highest recent failure count. `"none"` when no failures are recorded. |

### Failure Category Weights

| Category | Weight (failureScore) |
|----------|----------------------|
| `dependency/generate` | 30 |
| `runtime compile` | 25 |
| `unknown` | 20 |
| `boundary guard` | 15 |
| `docs guard` | 10 |

### Friction Point Sources

| Condition | Points |
|-----------|--------|
| `state: "stale"` | +30 |
| `state: "running:no-output"` | +10 |
| `noOutputMs > 300000` | +20 |
| `noOutputMs > 60000` | +5 |

### Risk Severity Points

| Severity | Points |
|----------|--------|
| `high` / `Red` | 20 |
| `medium` / `Yellow` | 10 |

---

## Safe Skeleton Behavior

When input files are missing or empty, the calculator produces a zeroed-out
snapshot with `trust: 100` and `topPain: "none"`. This makes the schema
validation pass even for the default skeleton output.

---

## Examples

### Zeroed-Out Skeleton (Default)

```json
{
  "snapshotVersion": 1,
  "calculatedAt": "2026-05-11T00:00:00.000Z",
  "inputSources": {
    "healthLog": null,
    "heartbeatLog": null,
    "healthEntryCount": 0,
    "heartbeatEntryCount": 0
  },
  "signals": {
    "failureScore": 0,
    "frictionScore": 0,
    "riskScore": 0,
    "cost": 0,
    "trust": 100,
    "topPain": "none"
  }
}
```

### Populated Snapshot

```json
{
  "snapshotVersion": 1,
  "calculatedAt": "2026-05-11T12:00:00.000Z",
  "inputSources": {
    "healthLog": "health.ndjson",
    "heartbeatLog": "heartbeats.ndjson",
    "healthEntryCount": 5,
    "heartbeatEntryCount": 12
  },
  "signals": {
    "failureScore": 45,
    "frictionScore": 30,
    "riskScore": 20,
    "cost": 12,
    "trust": 55,
    "topPain": "runtime compile"
  }
}
```

### High-Friction, Low-Trust Snapshot

```json
{
  "snapshotVersion": 1,
  "calculatedAt": "2026-05-11T14:30:00.000Z",
  "inputSources": {
    "healthLog": "health.ndjson",
    "heartbeatLog": "heartbeats.ndjson",
    "healthEntryCount": 2,
    "heartbeatEntryCount": 8
  },
  "signals": {
    "failureScore": 25,
    "frictionScore": 80,
    "riskScore": 10,
    "cost": 45,
    "trust": 53,
    "topPain": "boundary guard"
  }
}
```

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **Planning loop** (`plan-next-batch.ps1`) | `signals.trust`, `signals.topPain` | Risk-aware task ranking. Lower trust increases risk penalty; tasks matching `topPain` are demoted. |
| **Batch launcher** | `signals.failureScore`, `signals.frictionScore` | Decide whether to launch a new batch or pause. |
| **Monitoring** | `calculatedAt` | Detect stale snapshots. |

---

## References

- [meta-signals.md](meta-signals.md) — Calculator script usage, input formats, scoring formulas.
- [planner-meta-signals-ranking.md](planner-meta-signals-ranking.md) — How the planning loop consumes signals for task ranking.
- [health-state-schema.md](health-state-schema.md) — Health state JSON schema (source of failure categories).
- [worker-telemetry-schema.md](worker-telemetry-schema.md) — Worker telemetry schema (source of heartbeat data).
- [calculate-meta-signals.js](../../scripts/ai/calculate-meta-signals.js) — Calculator script.

---

## Failure Self-Critique (Reflexion-Style Reflection)

`classify-self-cycle-failure.js` now produces a `selfCritique` block alongside
the existing classification output. This structured reflection captures
actionable lessons from each failure so that downstream consumers can detect
repeat failure patterns and prevent the same mistakes.

### selfCritique Fields

| Field | Type | Description |
|-------|------|-------------|
| `rootCause` | `string` | Specific root cause analysis (more detailed than `likelyCause`). |
| `lessonLearned` | `string` | What the system should learn from this failure. |
| `preventionCheck` | `string` | A specific check or guard that could prevent this failure next time. |
| `repeatRiskSignal` | `"elevated" \| "normal"` | Whether this failure type tends to repeat. `elevated` signals need proactive prevention. |
| `errorClass` | `string` | The classified error class (same as top-level `errorClass`). |
| `failedStep` | `string` | The pipeline step that failed (same as top-level `failedStep`). |
| `matchedPatternCount` | `integer` | Number of regex patterns that matched. |
| `reflectedAt` | `string` (ISO-8601) | Timestamp when the reflection was generated. |

### Example Output

```json
{
  "failedStep": "batch-launch",
  "errorClass": "WORKTREE_STALE",
  "humanSummary": "A git worktree is stale, locked, or has diverged from its expected base branch.",
  "safeToRetry": true,
  "confidence": "high",
  "selfCritique": {
    "rootCause": "A previous worker left behind a stale, locked, or corrupted worktree that blocked the current run.",
    "lessonLearned": "Worktree cleanup must be automatic, not manual. The janitor should run as a pre-launch gate, not as a remediation step after failures.",
    "preventionCheck": "Run worktree-janitor.ps1 as a mandatory gate before batch-launch. Reject launches if any stale worktrees are detected after cleanup.",
    "repeatRiskSignal": "elevated",
    "errorClass": "WORKTREE_STALE",
    "failedStep": "batch-launch",
    "matchedPatternCount": 3,
    "reflectedAt": "2026-05-13T12:00:00.000Z"
  }
}
```

### Repeat Risk Signal

The `repeatRiskSignal` field indicates whether a failure type tends to recur:

| Signal | Error Classes | Meaning |
|--------|---------------|---------|
| `elevated` | `TASK_CONTRACT_INVALID`, `ISSUE_BODY_PARSE_BLEED`, `RUNNER_STRICT_MODE_VARIABLE`, `WORKTREE_STALE`, `UNKNOWN_CONTROL_PLANE_FAILURE` | These failures have structural causes that persist until a code fix is applied. Proactive prevention checks are recommended. |
| `normal` | `BATCH_SINGLE_TASK_MISMATCH`, `PROVIDER_UNAVAILABLE`, `DISK_PRESSURE`, `HUMAN_REQUIRED` | These failures are situational or self-resolving. Standard retry logic is sufficient. |

### Downstream Usage

Self-critiques are designed to be stored in meta-signals or planning feedback
so the planning loop can:

1. **Detect repeat failures** — if the same `errorClass` appears in consecutive
   runs, escalate priority of the `preventionCheck` fix.
2. **Weight task ranking** — tasks that address `elevated` repeat-risk signals
   get a priority boost in the next batch.
3. **Surface lessons** — the `lessonLearned` text can be included in follow-up
   issue bodies to give recovery workers full context.
