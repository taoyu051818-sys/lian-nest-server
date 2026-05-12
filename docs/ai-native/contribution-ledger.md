# Contribution Ledger

Append-only NDJSON log that records agent contribution entries, separating claimed
contribution from accepted contribution after PR merge and health green.

> **File:** `.github/ai-state/contribution-ledger.ndjson`
> **Schema:** `schemas/contribution-ledger.schema.json`
> **Writer:** `scripts/ai/write-contribution-ledger.js`
> **Format:** NDJSON (one JSON object per line, never truncated)
> **Closes:** [#1295](https://github.com/taoyu051818-sys/lian-nest-server/issues/1295)

## Purpose

Token cost is not contribution. The contribution ledger provides auditable accounting
of agent work by tracking what was actually delivered and validated, not how many
tokens were consumed. Each entry records:

- **Who** performed the work (`agentId`, `role`)
- **What** was contributed (`contributionType`, `description`)
- **Where** it landed (`issueNumber`, `prNumber`, `branch`, `commit`)
- **Whether** it was validated (`validated`, `status`)
- **Whether** it reused prior work (`reused`)

This creates a separation between *claimed* work (submitted but not yet validated)
and *accepted* work (merged and health green), enabling downstream tools to compute
true contribution metrics.

## Contribution Types

| Type | Description |
|------|-------------|
| `code-change` | Source code modification (features, fixes, refactors). |
| `schema-change` | Database schema or API contract change. |
| `doc-change` | Documentation addition or update. |
| `test-change` | Test addition or modification. |
| `config-change` | Configuration, CI/CD, or tooling change. |
| `fact-produced` | Fact created for downstream consumption. |
| `review` | Code or PR review performed. |
| `research` | Investigation or research task completed. |

## Status Lifecycle

| Status | Description | Typical Trigger |
|--------|-------------|-----------------|
| `claimed` | Work submitted but not yet validated. | Worker completes task, opens PR. |
| `accepted` | PR merged and health gate green. | Post-merge health check passes. |
| `rolled-back` | Contribution reverted after merge. | Health failure or defect detected. |
| `disputed` | Contribution rejected or contested. | Review rejection, policy violation. |

```
claimed  ──►  accepted    (PR merged + health green)
   │
   ├──►  disputed         (rejected or contested)
   │
   └──►  rolled-back      (reverted after merge)
```

## Entry Schema

Each NDJSON line conforms to this structure:

```jsonc
{
  "schemaVersion": 1,
  "entryId": "a1b2c3d4-...",
  "recordedAt": "2026-05-12T10:00:00Z",
  "taskId": "wave16-issue-588-worker-001",
  "issueNumber": 588,
  "prNumber": 590,                     // nullable
  "agentId": "claude-opus-4-7",
  "role": "worker",
  "contributionType": "code-change",
  "status": "accepted",
  "validated": true,
  "reused": false,                     // nullable
  "rollbackOf": null,                  // nullable, set for rolled-back entries
  "branch": "claude/wave16-...",       // nullable
  "commit": "abc1234",                 // nullable
  "conflictGroup": "auth-core",        // nullable
  "description": "Auth module implementation",
  "meta": {}                           // nullable
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `schemaVersion` | `number` | yes | Schema version (currently `1`). |
| `entryId` | `string` | yes | Unique identifier for this ledger entry (UUID). |
| `recordedAt` | `string` | yes | ISO 8601 timestamp of when the entry was recorded. |
| `taskId` | `string` | yes | Worker task identifier. |
| `issueNumber` | `number` | yes | GitHub issue number this contribution targets. |
| `prNumber` | `number` or null | no | GitHub PR number produced by this contribution. |
| `agentId` | `string` | yes | Identifier of the AI agent that performed the work. |
| `role` | `string` | yes | Worker role from the task contract `rolePacket`. |
| `contributionType` | `string` | yes | One of the contribution types listed above. |
| `status` | `string` | yes | One of: `claimed`, `accepted`, `rolled-back`, `disputed`. |
| `validated` | `boolean` | yes | Whether the contribution passed all validation gates. |
| `reused` | `boolean` or null | no | Whether this contribution reused prior work. |
| `rollbackOf` | `string` or null | no | EntryId of the original contribution (for `rolled-back` status). |
| `branch` | `string` or null | no | Git branch or worktree name. |
| `commit` | `string` or null | no | Git commit SHA (7-40 hex chars) of the merged commit. |
| `conflictGroup` | `string` or null | no | Conflict group for parallelism control. |
| `description` | `string` | yes | Human-readable description of the contribution. |
| `meta` | `object` or null | no | Arbitrary key-value metadata (no secrets). |

## Command

```bash
# Show help
node scripts/ai/write-contribution-ledger.js --help

# Claim a code contribution
node scripts/ai/write-contribution-ledger.js \
  --task-id wave16-issue-588-worker-001 \
  --issue 588 \
  --agent-id claude-opus-4-7 \
  --role worker \
  --type code-change \
  --status claimed \
  --validated false \
  --desc "Auth module implementation"

# Accept a contribution (after PR merge + health green)
node scripts/ai/write-contribution-ledger.js \
  --task-id wave16-issue-588-worker-001 \
  --issue 588 \
  --pr 590 \
  --agent-id claude-opus-4-7 \
  --role worker \
  --type code-change \
  --status accepted \
  --validated true \
  --commit abc1234 \
  --desc "Auth module implementation" \
  --live

# Record a rollback
node scripts/ai/write-contribution-ledger.js \
  --task-id wave16-issue-588-worker-001 \
  --issue 588 \
  --pr 590 \
  --agent-id claude-opus-4-7 \
  --role worker \
  --type code-change \
  --status rolled-back \
  --validated false \
  --rollback-of <original-entry-id> \
  --desc "Auth module reverted due to health failure" \
  --live

# Dry-run (preview without writing — default behavior)
node scripts/ai/write-contribution-ledger.js \
  --task-id wave16-issue-588-worker-001 \
  --issue 588 \
  --agent-id claude-opus-4-7 \
  --role worker \
  --type code-change \
  --status claimed \
  --validated false \
  --desc "Auth module implementation"

# Run built-in self-test
node scripts/ai/write-contribution-ledger.js --self-test
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|:--------:|---------|-------------|
| `--task-id` | yes | — | Worker task identifier. |
| `--issue` | yes | — | GitHub issue number. |
| `--agent-id` | yes | — | Agent identifier (e.g. `claude-opus-4-7`). |
| `--role` | yes | — | Worker role from task contract. |
| `--type` | yes | — | Contribution type (see table above). |
| `--status` | yes | — | Contribution status: `claimed`, `accepted`, `rolled-back`, `disputed`. |
| `--validated` | yes | — | Whether validation passed: `true` or `false`. |
| `--desc` | yes | — | Human-readable description. |
| `--pr` | no | — | GitHub PR number. |
| `--branch` | no | — | Git branch or worktree name. |
| `--commit` | no | — | Git commit SHA (7-40 hex). |
| `--conflict-group` | no | — | Conflict group for parallelism control. |
| `--reused` | no | — | Whether this reused prior work: `true` or `false`. |
| `--rollback-of` | no | — | EntryId of original contribution (required for `rolled-back`). |
| `--meta` | no | — | JSON string for extra metadata. |
| `--out` | no | `.github/ai-state/contribution-ledger.ndjson` | Output ledger path. |
| `--dry-run` | no | (default) | Print entry without writing. |
| `--live` | no | — | Append the entry to the ledger file. |
| `--self-test` | no | — | Run built-in validation and exit. |
| `--help` | no | — | Show usage and exit. |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Entry appended (or dry-run printed, or self-test passed). |
| 1 | Self-test failure. |
| 2 | Invalid arguments. |

## Integration with Planning Loop

```
batch-launch.ps1                 (dispatches workers)
        |
        v
write-task-ledger-entry.js      (records task lifecycle events)
        |
        v
reconcile-worker-prs.ps1        (detects merged PRs, health status)
        |
        v
write-contribution-ledger.js    (records contribution entries)
        |
        v
.github/ai-state/contribution-ledger.ndjson
        |
        v
calculate-meta-signals.js       (consumes ledger for contribution scores)
```

The contribution ledger is the single write target for contribution accounting.
Scripts that detect accepted work call `write-contribution-ledger.js` to record
contributions rather than writing to the file directly.

### When to Record

| Event | Status | Caller |
|-------|--------|--------|
| Worker opens a PR | `claimed` | batch-launch / reconcile-worker-prs |
| PR merged + health green | `accepted` | reconcile-worker-prs |
| Health failure after merge | `rolled-back` | state-reconciler |
| Review rejection or policy violation | `disputed` | PR review gate |

## Downstream Consumers

- **Meta-signals calculator** (`calculate-meta-signals.js`): Reads the ledger
  to compute contribution scores. Accepted contributions increase the score;
  rolled-back or disputed entries decrease it.
- **Operator dashboards**: Visualize contribution rates by agent, role, and type.
- **Audit log**: Append-only record for contribution accountability.

## Design Decisions

- **Contribution ≠ cost.** Token usage is tracked by worker-telemetry. The
  contribution ledger tracks validated outcomes — what was actually delivered,
  not what it cost to produce.
- **Claimed vs accepted.** The two-phase lifecycle prevents gaming: work is not
  counted as contribution until it passes all gates (merge + health green).
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
- **Unique entryId**: Each entry gets a UUID, enabling rollback references via
  the `rollbackOf` field.

## References

- [Task Ledger Schema](task-ledger-schema.md) — Task lifecycle events.
- [Gap Ledger](gap-ledger.md) — Planning loop gap events.
- [Worker Assignment Ledger Schema](worker-assignment-ledger-schema.md) — Worker assignment lifecycle.
- [Worker Task Contract](worker-task-contract.md) — Task contract and role definitions.
- [Meta Signals](meta-signals.md) — Aggregate signal calculator.
- [Issue Lifecycle](issue-lifecycle.md) — Issue states and transitions.
