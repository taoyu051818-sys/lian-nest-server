# Issue Producer Run Ledger

Append-only NDJSON log that records issue production runs. Captures which facts
generated which issues, which were rejected, and why, making task production
auditable.

> **File:** `.github/ai-state/issue-producer-runs.ndjson`
> **Schema:** `schemas/issue-producer-run.schema.json`
> **Writer:** `scripts/ai/write-issue-producer-run.js`
> **Format:** NDJSON (one JSON object per line, never truncated)
> **Closes:** [#1332](https://github.com/taoyu051818-sys/lian-nest-server/issues/1332)

## Purpose

The issue producer run ledger answers three questions that the current system
cannot:

1. **What facts generated which issues?** Each run records the facts consumed
   as input and the issues produced as output, creating a traceable chain from
   system state to proposed work.
2. **Which issues were rejected and why?** Duplicate detection, policy gates,
   and conflict group collisions are recorded with explicit rejection reasons.
3. **Is task production auditable?** Every production run becomes a permanent
   record. Operators can review what was proposed, what was blocked, and whether
   the producer is generating useful work.

Without this ledger, the self-cycle can request 30 workers but only produce 5
executable issues, with no record of why the other 25 were rejected or whether
the input facts were stale.

## Run Modes

| Mode | Description |
|------|-------------|
| `dry-run` | Preview only. No issues were created on GitHub. |
| `execute` | Issues were created or attempted on GitHub. |

## Outcome Lifecycle

| Outcome | Description | Typical Trigger |
|---------|-------------|-----------------|
| `completed` | Run finished. Some issues may still be blocked or failed. | Normal completion. |
| `blocked` | Run could not start or was aborted. | Health gate failure, missing facts. |
| `errored` | Run failed due to an unexpected error. | CLI failure, network error. |

## Entry Schema

Each NDJSON line conforms to this structure:

```jsonc
{
  "schemaVersion": 1,
  "runId": "run-20260512-001",
  "recordedAt": "2026-05-12T10:00:00Z",
  "actor": "self-cycle",
  "mode": "execute",
  "factsConsumed": [
    {
      "factId": "fact:health:green",
      "source": "main-health.json",
      "description": "Main branch health is green"
    }
  ],
  "issuesProduced": [
    {
      "issueNumber": 1332,
      "title": "Add issue producer run record",
      "taskType": "execution",
      "risk": "low",
      "conflictGroup": "issue-producer-run-ledger",
      "actorRole": "issue-production-worker",
      "allowedFiles": ["scripts/ai/**", "schemas/**", "docs/ai-native/**"],
      "forbiddenFiles": ["src/**", "prisma/**"],
      "validationCommands": ["npm run check"],
      "rationale": "Task production is not auditable",
      "macroGoal": "issue-production-audit",
      "status": "created",
      "humanRequired": false
    }
  ],
  "issuesRejected": [
    {
      "title": "Old duplicate issue",
      "conflictGroup": "old-group",
      "reason": "title overlap with existing issue #1300"
    }
  ],
  "outcome": "completed",
  "blockReason": null,
  "meta": {}
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `schemaVersion` | `number` | yes | Schema version (currently `1`). |
| `runId` | `string` | yes | Unique identifier for this production run (UUID). |
| `recordedAt` | `string` | yes | ISO 8601 UTC timestamp of when the record was written. |
| `actor` | `string` | yes | Who or what initiated the run (e.g. `self-cycle`, `batch-launcher`). |
| `mode` | `string` | yes | `dry-run` or `execute`. |
| `factsConsumed` | `array` | yes | Facts read as input (may be empty). |
| `issuesProduced` | `array` | yes | Issues proposed or created (may be empty). |
| `issuesRejected` | `array` | yes | Issues rejected with reasons (may be empty). |
| `outcome` | `string` or null | no | `completed`, `blocked`, or `errored`. |
| `blockReason` | `string` or null | no | Top-level reason when outcome is `blocked`. |
| `meta` | `object` or null | no | Arbitrary metadata (no secrets). |

### Fact Reference (`factsConsumed` items)

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `factId` | `string` | yes | Unique identifier for the consumed fact. |
| `source` | `string` | yes | File or system the fact was read from. |
| `description` | `string` or null | no | Human-readable summary of the fact. |

### Produced Issue (`issuesProduced` items)

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `issueNumber` | `number` or null | no | GitHub issue number (null for dry-run or failed creation). |
| `title` | `string` | yes | Issue title. |
| `taskType` | `string` | yes | `execution`, `research`, or `review`. |
| `risk` | `string` | yes | `low`, `medium`, or `high`. |
| `conflictGroup` | `string` | yes | Logical conflict group for parallelism control. |
| `actorRole` | `string` or null | no | Worker role from the task contract. |
| `allowedFiles` | `array` | yes | File glob patterns the worker may edit. |
| `forbiddenFiles` | `array` | yes | File glob patterns the worker must not edit. |
| `validationCommands` | `array` | yes | Validation commands that must pass. |
| `rationale` | `string` or null | no | Why this issue was proposed. |
| `macroGoal` | `string` or null | no | Macro goal this issue serves. |
| `status` | `string` | yes | `proposed`, `created`, `blocked`, or `failed`. |
| `humanRequired` | `boolean` | yes | Whether human review is required before execution. |

### Rejected Issue (`issuesRejected` items)

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `title` | `string` | yes | Proposed issue title. |
| `conflictGroup` | `string` or null | no | Conflict group of the rejected issue. |
| `reason` | `string` | yes | Why the issue was rejected. |

## Command

```bash
# Show help
node scripts/ai/write-issue-producer-run.js --help

# Preview a dry-run production record
node scripts/ai/write-issue-producer-run.js \
  --run-id run-20260512-001 \
  --actor self-cycle \
  --mode dry-run

# Record a completed production run (live)
node scripts/ai/write-issue-producer-run.js \
  --run-id run-20260512-002 \
  --actor self-cycle \
  --mode execute \
  --outcome completed \
  --facts '[{"factId":"fact:health:green","source":"main-health.json"}]' \
  --produced '[{"title":"Add docs","taskType":"execution","risk":"low","conflictGroup":"docs","allowedFiles":["docs/**"],"forbiddenFiles":["src/**"],"validationCommands":["npm run check"],"status":"created","humanRequired":false}]' \
  --rejected '[{"title":"Old issue","reason":"title overlap with existing"}]' \
  --live

# Record a blocked run
node scripts/ai/write-issue-producer-run.js \
  --run-id run-20260512-003 \
  --actor self-cycle \
  --mode execute \
  --outcome blocked \
  --block-reason "Main health is red"

# Dry-run (preview without writing — default behavior)
node scripts/ai/write-issue-producer-run.js \
  --run-id run-20260512-004 \
  --actor self-cycle \
  --mode dry-run

# Run built-in self-test
node scripts/ai/write-issue-producer-run.js --self-test

# Run focused test suite
node scripts/ai/write-issue-producer-run.test.js
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|:--------:|---------|-------------|
| `--run-id` | yes | — | Unique run identifier. |
| `--actor` | yes | — | Who/what initiated the run. |
| `--mode` | yes | — | Run mode: `dry-run` or `execute`. |
| `--outcome` | no | — | Outcome: `completed`, `blocked`, `errored`. |
| `--block-reason` | no | — | Reason if outcome is blocked. |
| `--facts` | no | `[]` | JSON array of fact references consumed. |
| `--produced` | no | `[]` | JSON array of produced issue objects. |
| `--rejected` | no | `[]` | JSON array of rejected issue objects. |
| `--meta` | no | — | JSON string for extra metadata. |
| `--out` | no | `.github/ai-state/issue-producer-runs.ndjson` | Output ledger path. |
| `--dry-run` | no | (default) | Print record without writing. |
| `--live` | no | — | Append the record to the ledger file. |
| `--self-test` | no | — | Run built-in validation and exit. |
| `--help` | no | — | Show usage and exit. |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Record appended (or dry-run printed, or self-test passed). |
| 1 | Self-test failure. |
| 2 | Invalid arguments. |

## Integration with Planning Loop

```
propose-self-cycle-issues.js       (reads facts, generates candidates)
        |
        v
write-issue-producer-run.js        (records the production run)
        |
        v
.github/ai-state/issue-producer-runs.ndjson
        |
        v
calculate-meta-signals.js          (consumes ledger for production quality scores)
operator dashboards                (visualize production patterns)
audit log                          (append-only record for accountability)
```

The issue producer run ledger is the single write target for production run
accounting. Scripts that generate issues call `write-issue-producer-run.js` to
record runs rather than writing to the file directly.

### When to Record

| Event | Mode | Outcome | Caller |
|-------|------|---------|--------|
| Issue proposal preview | `dry-run` | `completed` | propose-self-cycle-issues |
| Issues created on GitHub | `execute` | `completed` | propose-self-cycle-issues |
| Health gate blocks production | `execute` | `blocked` | self-cycle runner |
| Production error | `execute` | `errored` | self-cycle runner |

## Downstream Consumers

- **Meta-signals calculator** (`calculate-meta-signals.js`): Reads the ledger
  to compute production quality scores. High rejection rates signal stale facts
  or poor gap detection.
- **Operator dashboards**: Visualize production patterns — rejection rates,
  fact-to-issue ratios, conflict group distribution.
- **Audit log**: Append-only record for production accountability.

## Design Decisions

- **Fact traceability.** Each run records exactly which facts were consumed,
  enabling operators to trace from system state to proposed work. When an issue
  turns out to be unnecessary, the facts field reveals why it was proposed.
- **Rejection recording.** Rejected issues are first-class entries, not silent
  discards. This prevents the producer from repeatedly proposing the same
  rejected work.
- **CONTROL APPENDIX fields.** Each produced issue carries the full set of
  worker contract fields (allowedFiles, forbiddenFiles, validationCommands,
  conflictGroup, risk, taskType) so the record is self-contained.
- **Append-only**: The file is never truncated. Each call adds exactly one line.
  This prevents data loss and allows concurrent writers.
- **NDJSON over JSON array**: NDJSON is streamable, appendable, and doesn't
  require parsing the entire file to read the latest entry.
- **No secrets**: The ledger contains only structural metadata. No tokens,
  credentials, or log content.
- **Dry-run by default**: Matching the project's safe-skeleton convention,
  the writer defaults to dry-run mode. Use `--live` to write.
- **Schema versioning**: `schemaVersion` allows future schema evolution without
  breaking existing consumers.
- **Unique runId**: Each run gets a UUID, enabling cross-referencing with other
  ledgers and audit trails.

## References

- [Propose Self Cycle Issues](../../scripts/ai/propose-self-cycle-issues.js) — Issue proposal generator.
- [Self Cycle Run Schema](self-cycle-run-schema.md) — Self-cycle run manifest.
- [Task Ledger Schema](task-ledger-schema.md) — Task lifecycle events.
- [Contribution Ledger](contribution-ledger.md) — Agent contribution tracking.
- [Gap Ledger](gap-ledger.md) — Planning loop gap events.
- [Meta Signals](meta-signals.md) — Aggregate signal calculator.
