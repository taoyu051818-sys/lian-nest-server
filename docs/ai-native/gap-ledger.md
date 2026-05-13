# Gap Ledger

Append-only NDJSON log that records discrete gap events from the planning loop.
Each line is a self-contained JSON object representing one gap.

> **File:** `.github/ai-state/gap-ledger.ndjson`
> **Writer:** `scripts/ai/write-gap-ledger.js`
> **Format:** NDJSON (one JSON object per line, never truncated)

## Purpose

The gap ledger captures events where the planning loop deviated from expectation:

- A worker failed or stalled without producing a PR.
- The post-merge health gate blocked further work.
- The launch gate rejected a task.
- A planned task drifted from its expected outcome.
- A migration matrix row was detected as stale.

This creates an auditable, append-only record that downstream tools (meta-signals
calculator, state reconciler, operator dashboards) can consume without coupling
to the scripts that produced the gaps.

## Gap Types

| Type | Description | Typical Severity |
|------|-------------|:----------------:|
| `worker-failed` | Worker exited non-zero without producing a PR. | high |
| `worker-stale` | Worker heartbeat went stale; worker likely hung or killed. | high |
| `health-gate-fail` | Post-merge health gate detected failures (tsc, build, prisma). | critical |
| `launch-blocked` | Launch gate rejected a task (conflict group, health policy, shared lock). | medium |
| `plan-drift` | Planned task deviated from expectation (deferred, rescope, partial). | low |
| `stale-row` | Migration matrix row detected as stale by the planner. | low |

## Entry Schema

Each NDJSON line conforms to this structure:

```jsonc
{
  "entryVersion": 1,
  "recordedAt": "2026-05-11T12:00:00Z",
  "gapType": "worker-failed",
  "severity": "high",
  "description": "Worker exited code 1, no PR produced",
  "issue": 398,                   // optional
  "pr": 401,                      // optional
  "branch": "claude/wave11-...",  // optional
  "commit": "abc1234",            // optional
  "meta": {}                      // optional arbitrary metadata
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `entryVersion` | `number` | yes | Schema version (currently `1`). |
| `recordedAt` | `string` | yes | ISO 8601 timestamp of when the gap was recorded. |
| `gapType` | `string` | yes | One of the gap types listed above. |
| `severity` | `string` | yes | One of: `low`, `medium`, `high`, `critical`. |
| `description` | `string` | yes | Human-readable description of the gap. |
| `issue` | `number` | no | GitHub issue number related to the gap. |
| `pr` | `number` | no | GitHub PR number related to the gap. |
| `branch` | `string` | no | Git branch or worktree name. |
| `commit` | `string` | no | Git commit SHA (7-40 hex chars). |
| `meta` | `object` | no | Arbitrary key-value metadata for downstream analysis. |

## Command

```bash
# Show help
node scripts/ai/write-gap-ledger.js --help

# Record a worker failure
node scripts/ai/write-gap-ledger.js \
  --type worker-failed \
  --issue 398 \
  --branch claude/wave11-20260511-123047-issue-398 \
  --severity high \
  --desc "Worker exited code 1, no PR produced"

# Record a health gate failure
node scripts/ai/write-gap-ledger.js \
  --type health-gate-fail \
  --commit abc1234 \
  --severity critical \
  --desc "tsc and build failed"

# Record a launch block with metadata
node scripts/ai/write-gap-ledger.js \
  --type launch-blocked \
  --issue 398 \
  --desc "conflict group collision" \
  --meta '{"conflictGroup":"auth-core","blockingIssue":258}'

# Dry-run (preview without writing)
node scripts/ai/write-gap-ledger.js \
  --type plan-drift \
  --issue 398 \
  --desc "task deferred to next wave" \
  --dry-run
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|:--------:|---------|-------------|
| `--type` | yes | — | Gap type (see table above). |
| `--desc` | yes | — | Human-readable description. |
| `--issue` | no | — | GitHub issue number. |
| `--pr` | no | — | GitHub PR number. |
| `--branch` | no | — | Git branch or worktree name. |
| `--commit` | no | — | Git commit SHA (7-40 hex). |
| `--severity` | no | `medium` | Severity: `low`, `medium`, `high`, `critical`. |
| `--meta` | no | — | JSON string for extra metadata. |
| `--out` | no | `.github/ai-state/gap-ledger.ndjson` | Output ledger path. |
| `--dry-run` | no | — | Print entry without writing. |
| `--help` | no | — | Show usage and exit. |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Entry appended (or dry-run printed). |
| 2 | Invalid arguments. |

## Integration with Planning Loop

```
plan-next-batch.ps1              (detects stale rows, proposes tasks)
        |
        v
check-launch-gate.ps1            (blocks tasks on policy violations)
        |
        v
batch-launch.ps1                 (dispatches workers)
        |
        v
write-gap-ledger.js              (records gaps at each stage)
        |
        v
.github/ai-state/gap-ledger.ndjson
        |
        v
calculate-meta-signals.js        (consumes ledger for failure/friction scores)
```

The gap ledger is the single write target for gap events. Scripts that detect
gaps call `write-gap-ledger.js` to record them rather than writing to the file
directly. This keeps the NDJSON format consistent and the entry schema validated.

### When to Record

| Event | Gap Type | Caller |
|-------|----------|--------|
| Worker exits non-zero, no PR | `worker-failed` | batch-launch / self-cycle runner |
| Worker heartbeat stale > 10 min | `worker-stale` | worker-heartbeat monitor |
| Health gate state is red/black | `health-gate-fail` | write-main-health-state |
| Launch gate blocks a task | `launch-blocked` | check-launch-gate |
| Task deferred or rescoped | `plan-drift` | plan-next-batch / operator |
| Stale migration matrix row | `stale-row` | plan-next-batch |

## Downstream Consumers

- **Meta-signals calculator** (`calculate-meta-signals.js`): Reads the ledger
  to compute failure and friction scores. Each `worker-failed` or
  `health-gate-fail` entry contributes to the failure score; `worker-stale`
  entries contribute to friction.
- **State reconciler** (`state-reconciler.ps1`): Cross-references gap entries
  with current worker/PR state to detect unresolved gaps.
- **Operator dashboards**: The NDJSON format is trivially parseable by log
  aggregation tools or custom dashboards.

## Design Decisions

- **Append-only**: The file is never truncated. Each call adds exactly one line.
  This prevents data loss and allows concurrent writers.
- **NDJSON over JSON array**: NDJSON is streamable, appendable, and doesn't
  require parsing the entire file to read the latest entry.
- **No secrets**: The ledger contains only structural metadata (issue numbers,
  branch names, commit SHAs). No tokens, credentials, or log content.
- **Dry-run by default for discovery**: The `--dry-run` flag lets operators
  preview entries before committing them, matching the project's dry-run-first
  convention.
- **Schema versioning**: `entryVersion` allows future schema evolution without
  breaking existing consumers.

## Failure Reflections (Reflexion Pattern)

Gap ledger entries for `worker-failed` events can include a structured
self-critique in `meta.reflection`, generated by
`generate-failure-reflection.js`. Based on the Reflexion framework
(Shinn et al., 2023), this enables the system to learn from individual
failures, not just aggregate patterns.

### Reflection Schema

```jsonc
{
  "entryVersion": 1,
  "recordedAt": "2026-05-13T04:30:00Z",
  "gapType": "worker-failed",
  "severity": "high",
  "description": "Worker exited code 1: TASK_CONTRACT_INVALID",
  "issue": 1366,
  "meta": {
    "errorClass": "TASK_CONTRACT_INVALID",
    "confidence": "high",
    "reflection": {
      "version": 1,
      "critique": "The task contract was missing rolePacket.actorRole. The compile script does not default this field.",
      "rootCause": "No default actorRole in compile-issue-to-task-json.ps1",
      "nextAction": "Add a default actorRole when the issue body omits the Role Packet section.",
      "similarPastCount": 2,
      "reflectionId": "refl-20260513-001"
    }
  }
}
```

### Reflection Fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | `number` | Reflection schema version (currently `1`). |
| `critique` | `string` | Verbal self-critique: what went wrong and why. |
| `rootCause` | `string` | Specific root cause identified from the failure. |
| `nextAction` | `string` | Concrete action to avoid repeating this failure. |
| `similarPastCount` | `number` | How many similar reflections exist in the ledger. |
| `reflectionId` | `string` | Unique ID for this reflection instance. |

### Generating Reflections

```bash
# Pipe classifier output into reflection generator
node scripts/ai/classify-self-cycle-failure.js --step compile --file err.txt \
  | node scripts/ai/generate-failure-reflection.js

# With explicit ledger path
node scripts/ai/generate-failure-reflection.js --file classification.json \
  --ledger .github/ai-state/gap-ledger.ndjson
```

### Retrieving Past Reflections

Before dispatching a worker, the self-cycle runner can query recent
reflections for a specific error class:

```bash
# Find recent TASK_CONTRACT_INVALID reflections
grep '"errorClass":"TASK_CONTRACT_INVALID"' .github/ai-state/gap-ledger.ndjson \
  | tail -5 \
  | jq '.meta.reflection'
```

The retrieval window is limited to the last 5 reflections per error
class to prevent stale data from dominating the context.

### Design Notes

- **Deterministic.** Reflections are generated from classifier output
  using templates, not LLM calls. This avoids latency, cost, and
  non-determinism.
- **Backward-compatible.** Existing gap ledger consumers ignore the
  `meta.reflection` field. New consumers opt in to reading it.
- **Append-only.** Reflections do not modify existing entries. Each
  reflection is embedded in a new gap ledger entry.
- **Sanitized.** Reflections go through the same sanitization as all
  gap ledger metadata (no secrets, no tokens).

See [reflexion-investigation.md](reflexion-investigation.md) for the
full analysis and rationale.

## References

- [Planning Loop](planning-loop.md) — Dry-run planner that detects gaps.
- [Failure Taxonomy](failure-taxonomy.md) — Health failure classification categories.
- [Loop Model](loop-model.md) — Self-cycle runner phases and failure modes.
- [Main Health Policy](main-health-policy.md) — Health state definitions.
- [Worker Heartbeat](worker-heartbeat.md) — Stale worker detection.
- [Meta Signals](meta-signals.md) — Aggregate signal calculator.
- [Reflexion Investigation](reflexion-investigation.md) — Self-reflection analysis.
