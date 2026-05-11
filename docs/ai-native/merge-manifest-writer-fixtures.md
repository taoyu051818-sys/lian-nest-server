# Merge Manifest Writer Fixtures

Fixture-based test coverage for the merge manifest writer in
`merge-clean-pr-batch.ps1`. Validates manifest structure, field
conformance, and edge cases without contacting GitHub.

> **Closes:** [#453](https://github.com/taoyu051818-sys/lian-nest-server/issues/453)

---

## Running

```bash
pwsh ./scripts/ai/merge-clean-pr-batch.manifest.test.ps1
```

Exits 0 on success, non-zero on any failure. Creates a temp directory
for manifest output and cleans up after itself.

---

## Test Matrix

| # | Scenario | Mode | Key assertions |
|---|----------|------|----------------|
| 1 | Dry-run, all eligible | `dry-run` | `batchId` pattern, `mode`, `prs` statuses, `healthGate: skipped`, null `preCommit`/`postCommit`/`failureReason` |
| 2 | Dry-run with blocked PRs | `dry-run` | `blockedPrs` populated, `failureReason` set, reason text preserved |
| 3 | Execute success | `execute` | `preCommit`/`postCommit` set, `healthGate: pass`, PRs all `merged`, null `failureReason` |
| 4 | Execute merge failure | `execute` | Partial outcomes preserved, `postCommit` null, PR-level `failureReason`, batch `failureReason` references PR number |
| 5 | Health gate failure | `execute` | `healthGate: fail`, `failureReason` captures exit code |
| 6 | Blocked batch (guard abort) | `dry-run` | `blockedPrs` reason references task boundary, `failureReason` references guard |
| 7 | Health gate not-found | `execute` | `healthGate: not-found`, `postHealthCommand` records path |
| 8 | Schema field type validation | `dry-run` | `batchId` string, `timestamp` ISO 8601, `prs[0].number` integer, `blockedPrs` array |
| 9 | Empty blockedPrs normalization | `dry-run` | Passing `$null` for `blockedPrs` normalizes to empty array |
| 10 | Valid JSON loadability | `execute` | Manifest parses as valid JSON |

---

## Fixture Design

Each test constructs a manifest via `Write-MergeManifest` with explicit
parameters:

- `PreCommit` / `PostCommit` — git SHA strings or `$null`
- `Outcomes` — array of PR outcome objects (`number`, `title`, `status`)
- `HealthResult` — one of `pass`, `fail`, `not-found`, `skipped`
- `BlockedPRs` — array of blocked PR objects (`number`, `reason`)
- `FailureReason` — string or `$null`
- `ManifestDir` — temp directory (cleaned up after run)
- `RepoName` — `owner/repo` string
- `IsExecute` — boolean mode flag

No GitHub API calls are made. No real merges are performed.

---

## Schema Conformance

Manifests are validated against the inline schema embedded in
`merge-clean-pr-batch.ps1 -ManifestSchema`. The schema file is at
`schemas/merge-manifest.schema.json`.

Key constraints enforced by the fixtures:

- `batchId` matches `^merge-batch-[a-z0-9-]+$`
- `mode` is `dry-run` or `execute`
- `prs` array has minimum 1 entry
- `blockedPrs` normalizes null to empty array
- `failureReason` is null on success paths, string on failure paths

---

## Integration

- **merge-clean-pr-batch.ps1** — source script with `Write-MergeManifest`
- **merge-manifest-schema.md** — schema field definitions
- **merge-manifest-writer.md** — manifest write behavior documentation
- **merge-policy.md** — eligibility and guard policy

---

## References

- [Merge Manifest Writer](./merge-manifest-writer.md) — Write behavior docs
- [Merge Manifest Schema](./merge-manifest-schema.md) — Field definitions
- [#453](https://github.com/taoyu051818-sys/lian-nest-server/issues/453) — This fixture coverage task
