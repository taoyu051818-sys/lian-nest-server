# Gap Ledger Entry JSON Schema

Schema for individual NDJSON entries in the gap ledger.
Used by the planning loop, meta-signals calculator, and state reconciler.

> **Closes:** [#460](https://github.com/taoyu051818-sys/lian-nest-server/issues/460)

---

## Schema Location

`schemas/gap-ledger.schema.json`

---

## Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `entryVersion` | Yes | `1` (const) | Schema version. |
| `recordedAt` | Yes | date-time | ISO-8601 timestamp when the gap was recorded. |
| `gapType` | Yes | enum | Category of gap event. |
| `severity` | Yes | enum | Severity level. |
| `description` | Yes | string | Human-readable description of the gap. |
| `issue` | No | integer | GitHub issue number related to the gap. |
| `pr` | No | integer | GitHub PR number related to the gap. |
| `branch` | No | string | Git branch or worktree name. |
| `commit` | No | string | Git commit SHA (7-40 hex chars). |
| `meta` | No | object | Arbitrary key-value metadata. |

---

## Gap Types

| Value | Description | Typical Severity |
|-------|-------------|:----------------:|
| `worker-failed` | Worker exited non-zero without producing a PR. | high |
| `worker-stale` | Worker heartbeat went stale; likely hung or killed. | high |
| `health-gate-fail` | Post-merge health gate detected failures (tsc, build, prisma). | critical |
| `launch-blocked` | Launch gate rejected a task (conflict group, health policy, shared lock). | medium |
| `plan-drift` | Planned task deviated from expectation (deferred, rescope, partial). | low |
| `stale-row` | Migration matrix row detected as stale by the planner. | low |

---

## Severity Levels

| Value | When to use |
|-------|-------------|
| `low` | Stale rows, minor plan drift. |
| `medium` | Launch gate blocks — task rejected but recoverable. |
| `high` | Worker failure or stale worker — work was expected but not delivered. |
| `critical` | Health gate failure — main branch is broken. |

---

## Example: Worker Failure

```json
{
  "entryVersion": 1,
  "recordedAt": "2026-05-11T12:00:00Z",
  "gapType": "worker-failed",
  "severity": "high",
  "description": "Worker exited code 1, no PR produced",
  "issue": 398,
  "pr": null,
  "branch": "claude/wave11-20260511-123047-issue-398",
  "commit": "abc1234",
  "meta": { "exitCode": 1 }
}
```

---

## Example: Health Gate Failure

```json
{
  "entryVersion": 1,
  "recordedAt": "2026-05-11T12:05:00Z",
  "gapType": "health-gate-fail",
  "severity": "critical",
  "description": "tsc and build failed after merge",
  "commit": "def5678",
  "meta": { "failures": ["tsc", "build"] }
}
```

---

## Example: Launch Block with Metadata

```json
{
  "entryVersion": 1,
  "recordedAt": "2026-05-11T12:10:00Z",
  "gapType": "launch-blocked",
  "severity": "medium",
  "description": "conflict group collision",
  "issue": 398,
  "meta": { "conflictGroup": "auth-core", "blockingIssue": 258 }
}
```

---

## Example: Plan Drift

```json
{
  "entryVersion": 1,
  "recordedAt": "2026-05-11T12:15:00Z",
  "gapType": "plan-drift",
  "severity": "low",
  "description": "task deferred to next wave",
  "issue": 398,
  "meta": { "reason": "dependency not ready" }
}
```

---

## Commit Field Pattern

The `commit` field accepts 7-40 lowercase hex characters (`^[0-9a-f]{7,40}$`).
Short SHAs (7 chars) are acceptable for brevity; full SHAs (40 chars) for precision.

---

## Meta Field Usage

The `meta` object is unstructured. Common keys observed in practice:

| Key | Used by | Example |
|-----|---------|---------|
| `exitCode` | `worker-failed` | `1` |
| `failures` | `health-gate-fail` | `["tsc", "build"]` |
| `conflictGroup` | `launch-blocked` | `"auth-core"` |
| `blockingIssue` | `launch-blocked` | `258` |
| `reason` | `plan-drift` | `"dependency not ready"` |
| `staleSince` | `stale-row` | `"2026-05-10T08:00:00Z"` |

Consumers should tolerate unknown keys — the meta object may grow over time.

---

## Integration

### Gap Ledger Writer

Entries are written by `scripts/ai/write-gap-ledger.js`, which validates
against this schema before appending to the NDJSON file. See [gap-ledger.md](gap-ledger.md)
for CLI usage.

### Meta-Signals Calculator

The meta-signals calculator reads the ledger to compute failure and friction
scores. Each `worker-failed` or `health-gate-fail` entry contributes to the
failure score; `worker-stale` entries contribute to friction. See
[meta-signals.md](meta-signals.md).

### State Reconciler

The state reconciler cross-references gap entries with current worker and PR
state to detect unresolved gaps. See [state-reconciler.md](state-reconciler.md).

---

## Validation

The schema uses JSON Schema draft-07. Validate gap ledger entries against it:

```bash
# Using ajv-cli (if installed)
npx ajv validate -s schemas/gap-ledger.schema.json -d <entry-file>.json

# Using any draft-07 compatible validator
```

---

## See Also

- [Gap Ledger](gap-ledger.md) — Full ledger documentation, CLI usage, and integration diagram
- [Meta Signals](meta-signals.md) — Aggregate signal calculator
- [State Reconciler](state-reconciler.md) — Worker/PR state cross-reference
- [Loop Model](loop-model.md) — Self-cycle runner phases and failure modes
- [Main Health Policy](main-health-policy.md) — Health state definitions
- [Worker Heartbeat](worker-heartbeat.md) — Stale worker detection
- [Failure Taxonomy](failure-taxonomy.md) — Health failure classification
- [#460](https://github.com/taoyu051818-sys/lian-nest-server/issues/460) — This feature
