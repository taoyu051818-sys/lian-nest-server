# Merge Manifest Schema

JSON Schema for controlled auto-merge batch manifests. Validates the
structure of files written to `.ai/merge-batch-manifests/` by the
`merge-clean-pr-batch.ps1` script.

## Schema Location

```
schemas/merge-manifest.schema.json
```

## Purpose

Every run of the controlled auto-merge script produces a manifest that
records:

- Which PRs were in the explicit allowlist
- Per-PR merge outcomes (eligible, merged, failed)
- Pre/post merge commit SHAs
- Post-merge health gate result
- Blocked PRs and failure reasons

The schema ensures manifests are machine-readable and auditable across
waves.

## Required Fields

| Field        | Type     | Description                                          |
| ------------ | -------- | ---------------------------------------------------- |
| `batchId`    | string   | Unique batch identifier (`merge-batch-<timestamp>`)  |
| `timestamp`  | string   | ISO 8601 UTC timestamp of the run                    |
| `repository` | string   | Target repository (`OWNER/NAME`)                     |
| `mode`       | string   | `dry-run` or `execute`                               |
| `prs`        | array    | Explicit PR list with per-PR outcomes                |

## Optional Fields

| Field              | Type          | Description                                        |
| ------------------ | ------------- | -------------------------------------------------- |
| `preCommit`        | string\|null  | Git HEAD SHA before merges                         |
| `postCommit`       | string\|null  | Git HEAD SHA after merges                          |
| `healthGate`       | string        | `pass`, `fail`, `not-found`, or `skipped`          |
| `postHealthCommand`| string\|null  | Health command path used                           |
| `blockedPrs`       | array         | PRs blocked by guard or eligibility failures       |
| `failureReason`    | string\|null  | Top-level abort reason                             |

## PR Entry Schema

Each entry in `prs` contains:

| Field          | Type             | Description                                |
| -------------- | ---------------- | ------------------------------------------ |
| `number`       | integer          | GitHub PR number (minimum: 1)              |
| `title`        | string           | PR title                                   |
| `status`       | string           | `eligible`, `merged`, or `failed`          |
| `failureReason`| string\|null     | Detail when status is `failed`             |

## Blocked PR Entry Schema

Each entry in `blockedPrs` contains:

| Field    | Type    | Description                                    |
| -------- | ------- | ---------------------------------------------- |
| `number` | integer | GitHub PR number (minimum: 1)                  |
| `reason` | string  | Why the PR was blocked                         |

## Health Gate Values

| Value       | Meaning                                        |
| ----------- | ---------------------------------------------- |
| `pass`      | Health gate ran and passed                     |
| `fail`      | Health gate ran and failed (non-zero exit)     |
| `not-found` | Health gate script missing from disk           |
| `skipped`   | `-RunHealthGate` was not specified             |

## Example Manifests

### Successful Execute Batch

```json
{
  "batchId": "merge-batch-20260511-173000",
  "timestamp": "2026-05-11T17:30:00.0000000Z",
  "repository": "owner/name",
  "mode": "execute",
  "prs": [
    { "number": 42, "title": "feat: add TagsModule", "status": "merged" },
    { "number": 45, "title": "docs: update SOP", "status": "merged" }
  ],
  "preCommit": "abc1234def5678",
  "postCommit": "9876fedcba4321",
  "healthGate": "pass",
  "postHealthCommand": "scripts/post-merge-health-gate.js",
  "blockedPrs": [],
  "failureReason": null
}
```

### Dry-Run

```json
{
  "batchId": "merge-batch-20260511-172500",
  "timestamp": "2026-05-11T17:25:00.0000000Z",
  "repository": "owner/name",
  "mode": "dry-run",
  "prs": [
    { "number": 42, "title": "feat: add TagsModule", "status": "eligible" }
  ],
  "preCommit": null,
  "postCommit": null,
  "healthGate": "skipped",
  "postHealthCommand": null,
  "blockedPrs": [],
  "failureReason": null
}
```

### Failed Merge (Partial Batch)

```json
{
  "batchId": "merge-batch-20260511-173500",
  "timestamp": "2026-05-11T17:35:00.0000000Z",
  "repository": "owner/name",
  "mode": "execute",
  "prs": [
    { "number": 42, "title": "feat: add TagsModule", "status": "merged" },
    { "number": 45, "title": "docs: update SOP", "status": "failed", "failureReason": "Not mergeable" }
  ],
  "preCommit": "abc1234def5678",
  "postCommit": null,
  "healthGate": "skipped",
  "postHealthCommand": "scripts/post-merge-health-gate.js",
  "blockedPrs": [],
  "failureReason": null
}
```

### Blocked Batch (Guard Failure)

```json
{
  "batchId": "merge-batch-20260511-174000",
  "timestamp": "2026-05-11T17:40:00.0000000Z",
  "repository": "owner/name",
  "mode": "execute",
  "prs": [
    { "number": 42, "title": "feat: add TagsModule", "status": "eligible" }
  ],
  "preCommit": null,
  "postCommit": null,
  "healthGate": "skipped",
  "postHealthCommand": null,
  "blockedPrs": [
    { "number": 42, "reason": "Task boundary guard: src/modules/auth/auth.module.ts is in forbiddenFiles" }
  ],
  "failureReason": "Guard failure: task boundary violation"
}
```

## Validation

Validate a manifest file against the schema:

```bash
# Using ajv-cli (if installed)
npx ajv validate -s schemas/merge-manifest.schema.json -d .ai/merge-batch-manifests/merge-batch-*.json

# Using the script's built-in schema printer
.\scripts\ai\merge-clean-pr-batch.ps1 -ManifestSchema
```

## Integration

- **merge-clean-pr-batch.ps1** writes manifests conforming to this schema
- **merge-closure-sop.md** references manifests for post-merge audit
- **controlled-auto-merge.md** documents manifest fields and examples

## See Also

- [Controlled Auto-Merge](./controlled-auto-merge.md) — Batch merge script docs
- [Merge Closure SOP](./merge-closure-sop.md) — Post-merge procedure
- [#366](https://github.com/nicholasxsxs/lian-nest-server/issues/366) — Schema implementation issue
