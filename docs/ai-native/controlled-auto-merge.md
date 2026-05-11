# Controlled Auto-Merge

Batch-merge script for allowlisted, low-risk CLEAN PRs. This is a
PowerShell script that requires explicit PR numbers — it will never
discover, guess, or merge unspecified PRs.

When `-RunGuards` is specified, local guard checks execute before merge
to enforce task boundaries, PR handoff structure, docs authority, and
generated Prisma freshness. Guard failures block merge (fail-closed).
Guards are skipped when their required inputs are not present.

## When to Use

Use this script when you have a batch of low-risk PRs that are all:

- Already reviewed and approved
- Status checks are CLEAN (all green)
- Not drafts
- Mergeable (no conflicts)

**Do NOT use this script for:**

- PRs touching `src/**`, `prisma/**`, auth, runtime, or database code
  without human review
- PRs with `blocked`, `do-not-merge`, or `wip` labels
- PRs that have not been reviewed by the required roles
- Any PR not in your explicit allowlist

## Quick Start

```powershell
# Dry-run — validate PRs and print merge plan (DEFAULT, no merges)
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42,45 -Repo owner/name

# Execute — actually merge the PRs
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42,45 -Repo owner/name -Execute

# Execute with post-merge health gate (quick mode — default)
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42 -Repo owner/name -Execute -RunHealthGate

# Execute with full health gate (for src-touching or 3+ PR batches)
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42 -Repo owner/name -Execute -RunHealthGate -PostHealthCommand "scripts/post-merge-health-gate.js --full"

# Execute with custom post-merge health command
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42 -Repo owner/name -Execute -RunHealthGate -PostHealthCommand "scripts/custom-check.js --strict"

# Dry-run with guard checks
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42,45 -Repo owner/name -RunGuards

# Execute with guards
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42,45 -Repo owner/name -Execute -RunGuards

# Print manifest JSON schema (no merge)
.\scripts\ai\merge-clean-pr-batch.ps1 -ManifestSchema

# Print guard fixture templates (no merge)
.\scripts\ai\merge-clean-pr-batch.ps1 -ShowFixtures
```

## Parameters

| Parameter        | Required | Description                                                    |
| ---------------- | -------- | -------------------------------------------------------------- |
| `-PRs`           | Yes*     | One or more PR numbers to merge (inline)                       |
| `-AllowlistFile` | Yes*     | Path to a text file with one PR number per line                |
| `-Repo`          | Yes**    | Target repository in `OWNER/NAME` format                       |
| `-DryRun`        | No       | Validate only, print plan (DEFAULT)                            |
| `-Execute`       | No       | Perform real merges                                            |
| `-RunHealthGate` | No       | Run post-merge health command after successful batch           |
| `-PostHealthCommand` | No   | Custom health command for `-RunHealthGate` (default: `scripts/post-merge-health-gate.js`) |
| `-RunGuards`     | No       | Run local guard checks before merge (fail-closed on violations) |
| `-ManifestSchema`| No       | Print the merge batch manifest JSON schema and exit              |
| `-ShowFixtures`  | No       | Print guard fixture templates and exit                           |

\* Either `-PRs` or `-AllowlistFile` is required, not both.
\** Falls back to `GH_REPO` environment variable.

## Allowlist File Format

Create a text file with one PR number per line:

```
# Low-risk docs PRs
42
45
# Infrastructure script PRs
51
```

- Blank lines are ignored
- Lines starting with `#` are comments
- Each non-comment line must be a valid integer

## Eligibility Checks

Before merging, the script verifies each PR meets ALL of the following:

| Check             | Pass condition               |
| ----------------- | ---------------------------- |
| State             | `OPEN`                       |
| Draft             | `false`                      |
| Mergeable         | `MERGEABLE`                  |
| Status checks     | No `FAILURE`, `CANCELLED`, or `TIMED_OUT` |

If ANY PR fails eligibility, the entire batch is aborted — no PRs are
merged. Fix the excluded PR or remove it from the allowlist.

## Execute Behavior

When `-Execute` is passed:

1. All PRs are re-validated immediately before merge.
2. PRs are merged sequentially with `--squash --delete-branch`.
3. **Stops on the first merge failure.**
4. Reports how many PRs were merged before the failure.

## Safety Guarantees

| Guarantee                         | How                                        |
| --------------------------------- | ------------------------------------------ |
| No unspecified PRs merged         | Script only processes PRs in the allowlist |
| No draft PRs merged               | Draft check fails the batch                |
| No non-CLEAN PRs merged           | Status check verification fails the batch  |
| No partial batches on failure     | Any excluded PR aborts the entire batch    |
| Dry-run is the default            | No merges without `-Execute`               |
| Fail-fast on merge error          | First failure stops the batch              |
| Guard failures block merge        | `-RunGuards` enforces fail-closed          |
| Guards skipped without inputs     | Missing manifest/body skips, not errors    |
| Manifest persisted every run      | `.ai/merge-batch-manifests/` written always |

## Merge Batch Manifest

Every run (dry-run and execute) writes a JSON manifest to
`.ai/merge-batch-manifests/merge-batch-<timestamp>.json`. The manifest
provides traceability for which PRs were processed, what happened, and
the health state of main afterward.

### Manifest Fields

| Field        | Type     | Description                                          |
| ------------ | -------- | ---------------------------------------------------- |
| `timestamp`  | string   | ISO 8601 UTC timestamp of the run                    |
| `repository` | string   | Target repository (`OWNER/NAME`)                     |
| `mode`       | string   | `dry-run` or `execute`                               |
| `prs`        | array    | Per-PR entries: `{number, title, status}`            |
| `preCommit`  | string?  | Git HEAD commit SHA before merges (null in dry-run)  |
| `postCommit` | string?  | Git HEAD commit SHA after merges (null in dry-run)   |
| `healthGate` | string   | `pass`, `fail`, `not-found`, or `skipped`            |
| `postHealthCommand` | string? | Health command path (null when `-RunHealthGate` not used) |

### PR Status Values

- `eligible` — PR passed all checks (dry-run only)
- `merged` — PR was successfully squash-merged
- `failed: <reason>` — PR merge failed with error detail

### Health Gate Values

- `pass` — health gate ran and passed
- `fail` — health gate ran and failed (non-zero exit)
- `not-found` — health gate script not present on disk
- `skipped` — `-RunHealthGate` was not specified

### Example Manifest (Execute)

```json
{
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
  "postHealthCommand": "scripts/post-merge-health-gate.js"
}
```

### Example Manifest (Dry-Run)

```json
{
  "timestamp": "2026-05-11T17:25:00.0000000Z",
  "repository": "owner/name",
  "mode": "dry-run",
  "prs": [
    { "number": 42, "title": "feat: add TagsModule", "status": "eligible" }
  ],
  "preCommit": null,
  "postCommit": null,
  "healthGate": "skipped",
  "postHealthCommand": "scripts/post-merge-health-gate.js"
}
```

### Example Manifest (Failed Merge)

When a merge fails mid-batch, the script stops and writes a manifest with
partial outcomes. Successfully merged PRs show `merged`; the failing PR
shows `failed: <reason>`.

```json
{
  "timestamp": "2026-05-11T17:35:00.0000000Z",
  "repository": "owner/name",
  "mode": "execute",
  "prs": [
    { "number": 42, "title": "feat: add TagsModule", "status": "merged" },
    { "number": 45, "title": "docs: update SOP", "status": "failed: Not mergeable" }
  ],
  "preCommit": "abc1234def5678",
  "postCommit": null,
  "healthGate": "skipped",
  "postHealthCommand": "scripts/post-merge-health-gate.js"
}
```

Note: `postCommit` is `null` when the batch does not complete. `healthGate`
is `skipped` because the health gate only runs after a fully successful batch.

### Example Manifest (Health Gate Failure)

When all PRs merge but the health gate fails, the manifest records the
failure for post-incident review.

```json
{
  "timestamp": "2026-05-11T17:40:00.0000000Z",
  "repository": "owner/name",
  "mode": "execute",
  "prs": [
    { "number": 42, "title": "feat: add TagsModule", "status": "merged" }
  ],
  "preCommit": "abc1234def5678",
  "postCommit": "9876fedcba4321",
  "healthGate": "fail",
  "postHealthCommand": "scripts/post-merge-health-gate.js"
}
```

### Example Manifest (Health Gate Not Found)

When `-RunHealthGate` is specified but the health script is missing from
disk, the manifest records `not-found`.

```json
{
  "timestamp": "2026-05-11T17:45:00.0000000Z",
  "repository": "owner/name",
  "mode": "execute",
  "prs": [
    { "number": 42, "title": "feat: add TagsModule", "status": "merged" }
  ],
  "preCommit": "abc1234def5678",
  "postCommit": "9876fedcba4321",
  "healthGate": "not-found",
  "postHealthCommand": "scripts/post-merge-health-gate.js"
}
```

### Blocked PRs (No Manifest)

When any PR fails eligibility or guard checks, the batch is **aborted
before any merges** and **no manifest is written**. The script prints
the excluded PRs and their reasons, then exits with code 1.

This is by design — a manifest only records what actually happened
(dry-run validation or real merges), not what was blocked.

### Using Manifests for Audit

After a batch, review the manifest to confirm:

| Scenario             | What to check                                                    |
| -------------------- | ---------------------------------------------------------------- |
| Successful batch     | All `prs[].status` = `merged`, `healthGate` = `pass`             |
| Dry-run              | All `prs[].status` = `eligible`, `healthGate` = `skipped`        |
| Failed merge         | Mixed statuses (`merged` + `failed:`), `postCommit` = `null`     |
| Health gate failure  | All `prs[].status` = `merged`, `healthGate` = `fail`             |
| Health gate missing  | All `prs[].status` = `merged`, `healthGate` = `not-found`        |
| Blocked/excluded     | No manifest written (batch aborted before merge)                 |

Additional audit checks:
1. Only allowlisted PRs appear in `prs`.
2. `preCommit` and `postCommit` bracket the merge window (both non-null
   only when all PRs merged successfully).
3. `repository` matches the target repo.

### Manifest Schema

To print the JSON Schema for the merge batch manifest (for validation
or tooling integration), use `-ManifestSchema`:

```powershell
.\scripts\ai\merge-clean-pr-batch.ps1 -ManifestSchema
```

This outputs the full JSON Schema describing all manifest fields, their
types, required status, and allowed values. Use it to:

- Validate a manifest file against the expected structure
- Generate TypeScript/JSON interfaces for manifest consumers
- Understand the complete set of fields without reading the script

## Guard Integration

When `-RunGuards` is specified, four guard checks run before merge:

| Guard             | Scope       | Behavior    | Required Input                      |
| ----------------- | ----------- | ----------- | ----------------------------------- |
| Task boundary     | Per-PR diff | **Blocking**| `.ai/task-manifest.json`            |
| PR handoff        | Per-PR body | **Blocking**| PR body (from `gh pr view`)         |
| Docs authority    | Repo-wide   | Warning     | `docs/` directory                   |
| Generated Prisma  | Per-PR diff | **Blocking**| PR changed files                    |

### Task Boundary Guard

Checks that each PR's changed files stay inside `allowedFiles` globs and
do not touch `forbiddenFiles` globs from the task manifest. Violations
block merge. Skipped if `.ai/task-manifest.json` does not exist.

### PR Handoff Guard

Validates that the PR body contains all seven required handoff sections:
Summary, Changed Files, Linked Issues, Validation, Non-Goals,
Risk / Rollback, and Follow-up Handoff. Missing sections block merge.

### Docs Authority Guard

Runs `scripts/guards/check-docs-authority.js` in warn-only mode once
before the batch. Reports duplicate basenames, duplicate H1 titles, and
missing frontmatter fields. Does **not** block merge — warnings only.

### Generated Prisma Guard

Checks that if `src/generated/prisma/` files changed, the corresponding
`prisma/schema.prisma` also changed. Generated-only changes without a
schema update block merge (fail-closed for ownership enforcement).

## Guard Fixtures

Guard fixtures are example files that demonstrate and test the guard
safety behavior. Use them to bootstrap guard testing for a new task.

### Printing Fixtures

```powershell
# Print all guard fixture templates and exit
.\scripts\ai\merge-clean-pr-batch.ps1 -ShowFixtures
```

This prints:
- A **safe** `task-manifest.json` with allowedFiles outside forbiddenFiles
- A **high-risk** `task-manifest.json` that would be blocked
- A **PR body template** that passes the handoff guard

### Task Manifest Fixture (Safe)

```json
{
  "taskId": "170-merge-guard-fixtures",
  "allowedFiles": [
    "scripts/ai/merge-clean-pr-batch.ps1",
    "docs/ai-native/controlled-auto-merge.md",
    "docs/ai-native/merge-closure-sop.md"
  ],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    "package.json",
    "package-lock.json"
  ]
}
```

This manifest is safe: every `allowedFiles` entry falls outside the
`forbiddenFiles` globs. The boundary guard will pass for any PR that
only touches these files.

### Task Manifest Fixture (High-Risk — Blocked)

```json
{
  "taskId": "example-high-risk",
  "allowedFiles": [
    "src/modules/auth/auth.module.ts",
    "src/modules/auth/dto/login.dto.ts"
  ],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    "package.json",
    "package-lock.json"
  ]
}
```

This manifest is **always blocked**: `allowedFiles` entries overlap
with `forbiddenFiles` (`src/**`). High-risk PRs touching runtime,
database, auth, or dependency files must remain human-required. The
boundary guard rejects these regardless of the allowlist.

### PR Body Fixture (Passes Handoff Guard)

```markdown
## Summary
Add guard fixture templates for explicit allowlist safety testing.

## Changed files
- scripts/ai/merge-clean-pr-batch.ps1
- docs/ai-native/controlled-auto-merge.md
- docs/ai-native/merge-closure-sop.md

## Linked issues
Closes #170

## Validation
- npm run check: PASS
- Dry-run with -RunGuards: PASS

## Non-goals
- No changes to src/** or prisma/**
- No runtime behavior changes

## Risk / rollback
Low risk — docs and fixture-only changes. Revert commit to roll back.

## Follow-up handoff
None required. All guard fixtures self-contained.
```

All seven required handoff sections are present. Missing any one of
them blocks merge.

### Explicit Allowlist Safety

The controlled auto-merge script enforces explicit allowlist safety
through three mechanisms:

1. **Script-level**: Only PRs passed via `-PRs` or `-AllowlistFile`
   are ever processed. The script never discovers or guesses PRs.
2. **Guard-level**: When `-RunGuards` is active, each PR's changed
   files are validated against the task manifest's `allowedFiles` and
   `forbiddenFiles` globs. Files outside the allowlist block merge.
3. **Policy-level**: High-risk categories (`src/**`, `prisma/**`,
   `package.json`, auth/security code) are forbidden from auto-merge.
   These always require human review from the designated roles.

This triple-layer safety ensures that no unspecified, out-of-boundary,
or high-risk PR is merged without explicit human approval.

### Dry-Run Report

In dry-run mode with `-RunGuards`, the script prints a guard
configuration table showing which guards are CHECKING, SKIPPED, or WARN,
followed by per-PR guard results in the eligibility report.

## High-Risk PRs Require Human Approval

The following PR categories must NOT be auto-merged. They require
explicit human review and approval from the designated roles:

- **Runtime code** (`src/**`) — backend-programmer + architect review
- **Database/Prisma** (`prisma/**`) — migration-auditor review
- **Auth/security** — security-reviewer review
- **Dependencies** (`package.json`, `package-lock.json`) — repo-owner review
- **Infrastructure scripts** (`scripts/merge-queue-assistant.js`,
  `scripts/post-merge-health-gate.js`) — devops-automation-engineer review

See [roles.md](roles.md) for full role definitions and
[pr-review-gate.md](pr-review-gate.md) for review criteria.

## Integration with Existing Tools

This script complements the existing merge tooling:

- **merge-queue-assistant.js** — discovers eligible PRs from the full
  open set. Use it to scout; use this script to merge a known batch.
- **post-merge-health-gate.js** — runs after merge to verify main is
  healthy. Use `-RunHealthGate` to invoke it automatically.

### Health Gate Mode Selection

When `-RunHealthGate` is used without `-PostHealthCommand`, the default
health command is `scripts/post-merge-health-gate.js` (quick mode). To
run full mode for higher-risk batches, pass it explicitly:

```powershell
-RunHealthGate -PostHealthCommand "scripts/post-merge-health-gate.js --full"
```

Pick `--full` when the batch touches `src/**`, contains 3+ PRs, or
follows a red-main fix. Otherwise `--quick` is sufficient. See
[post-merge-health-gate.md](post-merge-health-gate.md#when-to-use-each-mode)
for the decision table.

## Exit Codes

| Code | Meaning                                     |
| ---- | ------------------------------------------- |
| 0    | All PRs validated (dry-run) or merged (execute) |
| 1    | One or more PRs excluded, fetch error, or merge failure |

## Examples

### Dry-run from allowlist file

```powershell
# pr-allowlist.txt contains: 42, 45, 51
.\scripts\ai\merge-clean-pr-batch.ps1 -AllowlistFile .\pr-allowlist.txt -Repo owner/name
```

### Execute with health gate

```powershell
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42,45 -Repo owner/name -Execute -RunHealthGate
```

### Execute with custom health command

```powershell
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42 -Repo owner/name -Execute -RunHealthGate -PostHealthCommand "scripts/custom-check.js --strict"
```

### Verify a single PR before manual merge

```powershell
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42 -Repo owner/name
# Output shows eligibility status, then exits (dry-run)
```

### Dry-run with guard checks

```powershell
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42,45 -Repo owner/name -RunGuards
# Shows guard configuration and per-PR guard results
```

### Execute with guards and health gate

```powershell
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42 -Repo owner/name -Execute -RunGuards -RunHealthGate
# Guards block merge on failure; health gate runs after success
```

## See Also

- [SOP](./SOP.md) — Full development lifecycle
- [Merge Closure SOP](./merge-closure-sop.md) — Controlled merge procedure
- [Merge Queue Assistant](./merge-queue-assistant.md) — PR discovery tool
- [Post-Merge Health Gate](./post-merge-health-gate.md) — Post-merge verification
- [PR Review Gate](./pr-review-gate.md) — Review criteria
- [#89](https://github.com/nicholasxsxs/lian-nest-server/issues/89) — This feature
