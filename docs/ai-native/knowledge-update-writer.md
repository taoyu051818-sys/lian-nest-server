# Knowledge Update Writer

Append-only NDJSON ledger for recording structured knowledge gained from
merged PRs. Each entry captures what was learned, which PR/issue it relates
to, and the category of knowledge.

> **File:** `.github/ai-state/knowledge-updates.ndjson`
> **Writer:** `scripts/ai/write-knowledge-update.ps1`
> **Format:** NDJSON (one JSON object per line, never truncated)

> **Closes:** [#596](https://github.com/taoyu051818-sys/lian-nest-server/issues/596)

---

## Overview

After a PR merges, the orchestrator or human records knowledge gained during
the work. This ledger provides a structured, machine-readable history of
project learnings that downstream consumers (planner, context bundle
generator, orchestrator) can query without re-reading PR diffs.

The writer defaults to dry-run mode. No files are modified unless `-Write`
is explicitly passed (via the standard `-DryRun` switch being absent).

---

## Entry Schema

Each line in the NDJSON file is a JSON object conforming to this schema:

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `schemaVersion` | integer | yes | Always `1` |
| `category` | string | yes | One of: `migration`, `architecture`, `policy`, `test`, `docs`, `infrastructure`, `security`, `performance` |
| `summary` | string | yes | One-line summary of the knowledge gained |
| `capturedAt` | string | yes | ISO 8601 UTC timestamp |
| `commitSha` | string | yes | 7-40 hex character git SHA |
| `issueNumber` | integer | yes | Related GitHub issue number (0 if none) |
| `prNumber` | integer | yes | Related GitHub PR number (0 if none) |
| `tags` | array | yes | Filterable tags (may be empty) |
| `details` | string | no | Optional multi-line details |

### Example Entry

```jsonc
{
  "schemaVersion": 1,
  "category": "migration",
  "summary": "Slice A3 requires Prisma seed reset before parity tests",
  "capturedAt": "2026-05-11T14:30:00.000Z",
  "commitSha": "abc1234def5678",
  "issueNumber": 596,
  "prNumber": 600,
  "tags": ["prisma", "seed", "parity"],
  "details": "The seed script truncates migration_state rows. Run prisma db seed before parity tests."
}
```

---

## Usage

### Preview (dry-run, default)

```powershell
./scripts/ai/write-knowledge-update.ps1 `
  -Category migration `
  -Summary "Slice A3 requires Prisma seed reset" `
  -IssueNumber 596 `
  -PrNumber 600 `
  -Tags "prisma,seed,parity"
```

### Write (persist entry)

```powershell
./scripts/ai/write-knowledge-update.ps1 `
  -Category architecture `
  -Summary "Provider pool uses local secret store" `
  -PrNumber 582 `
  -Write
```

### Validate only

```powershell
./scripts/ai/write-knowledge-update.ps1 `
  -Category policy `
  -Summary "Dry-run default for all write-capable automation" `
  -ValidateOnly
```

### Self-test

```powershell
./scripts/ai/write-knowledge-update.ps1 -SelfTest
```

The self-test exercises entry construction, schema validation, NDJSON
round-trip serialization, and edge cases without writing files.

---

## Parameters

| Parameter | Required | Default | Description |
|-----------|:--------:|---------|-------------|
| `-Category` | yes | — | Knowledge category (see schema) |
| `-Summary` | yes | — | One-line summary |
| `-IssueNumber` | no | `0` | Related issue number |
| `-PrNumber` | no | `0` | Related PR number |
| `-CommitSha` | no | `HEAD` | Git SHA (auto-resolved from HEAD) |
| `-Details` | no | `""` | Multi-line details |
| `-Tags` | no | `""` | Comma-separated tags |
| `-OutputPath` | no | `.github/ai-state/knowledge-updates.ndjson` | Output file path |
| `-DryRun` | no | `$true` (default) | Preview without writing |
| `-ValidateOnly` | no | `$false` | Validate only, no output |
| `-SelfTest` | no | `$false` | Run self-tests |

---

## Exit Codes

| Code | Meaning |
|:----:|---------|
| `0` | Success (dry-run preview, write, validate-only, or self-test pass) |
| `1` | Schema validation failure or self-test failure |
| `2` | Invalid arguments (missing required parameters) |

---

## Integration

```
Worker PR merges
       |
       v
write-knowledge-update.ps1    (record knowledge from PR)
       |
       v
knowledge-updates.ndjson      (append-only ledger)
       |
       v
generate-context-bundle.js    (include recent entries in context)
       |
       v
plan-next-batch.ps1           (inform planning decisions)
```

### Downstream Consumers

| Consumer | Usage |
|----------|-------|
| Context bundle generator | Includes recent knowledge entries in worker context |
| Planning loop | Queries entries to avoid repeating known issues |
| Orchestrator | Surfaces relevant knowledge before launching workers |
| State reconciler | Cross-references knowledge with current state |

---

## Design Decisions

- **Append-only.** Entries are never modified or deleted. The ledger is a
  historical record, not a mutable state file.
- **Dry-run default.** The script never writes files unless explicitly
  opted in. This prevents accidental ledger pollution during exploration.
- **No secrets.** The entry schema contains no fields for API keys, tokens,
  or credentials. Tags and summaries are public-surface descriptions.
- **Schema versioned.** The `schemaVersion` field allows future schema
  evolution without breaking existing consumers.
- **NDJSON format.** One JSON object per line enables streaming reads,
  append operations without parsing the full file, and `git diff` showing
  individual entries.
- **Caller-provided content.** The script does not analyze PR diffs or
  auto-generate knowledge. The caller (human or orchestrator) decides what
  is worth recording.

---

## References

- [Fact Event Ledger](./fact-event-ledger.md) — Similar append-only NDJSON pattern
- [Gap Ledger](./gap-ledger.md) — Another NDJSON writer pattern
- [Context Bundles](./context-bundles.md) — How knowledge entries feed into worker context
- [Planning Loop](./planning-loop.md) — How knowledge informs batch planning
- [Migration Matrix Updater](./migration-matrix-updater.md) — Related migration knowledge
