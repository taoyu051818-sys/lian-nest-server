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

# Execute with post-merge health gate
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42 -Repo owner/name -Execute -RunHealthGate

# Dry-run with guard checks
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42,45 -Repo owner/name -RunGuards

# Execute with guards
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42,45 -Repo owner/name -Execute -RunGuards
```

## Parameters

| Parameter        | Required | Description                                                    |
| ---------------- | -------- | -------------------------------------------------------------- |
| `-PRs`           | Yes*     | One or more PR numbers to merge (inline)                       |
| `-AllowlistFile` | Yes*     | Path to a text file with one PR number per line                |
| `-Repo`          | Yes**    | Target repository in `OWNER/NAME` format                       |
| `-DryRun`        | No       | Validate only, print plan (DEFAULT)                            |
| `-Execute`       | No       | Perform real merges                                            |
| `-RunHealthGate` | No       | Run `scripts/post-merge-health-gate.js` after successful batch |
| `-RunGuards`     | No       | Run local guard checks before merge (fail-closed on violations) |

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
