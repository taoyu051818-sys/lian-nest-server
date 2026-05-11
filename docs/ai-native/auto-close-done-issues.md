# Auto-Close Done Issues

Dry-run helper that closes issues whose linked PRs have been merged,
completing the final step of the agent issue lifecycle.

> **Closes:** [#611](https://github.com/taoyu051818-sys/lian-nest-server/issues/611)

---

## Overview

The auto-close helper bridges the gap between "PR merged" and "issue
closed" in the agent lifecycle. The [state reconciler](state-reconciler.md)
detects `merged-pr-open-issue` drift but does not mutate. This script
acts on that drift by closing eligible issues and removing `agent:done`
labels.

```
agent:done  →  PR merged  →  [this script]  →  issue closed, label removed
```

Dry-run is the default. No issues are closed without `-Execute`.

---

## Eligibility Rules

An issue is eligible for closing when **all** of the following are true:

| # | Criterion | Evidence source |
|---|-----------|----------------|
| 1 | Issue has `agent:done` label | `gh issue view` labels |
| 2 | A linked PR is merged | `gh pr list --state merged` — title or body references `#N` |
| 3 | Main health is green | `.github/ai-state/main-health.json` (optional, skippable) |

If any criterion fails, the issue is reported but not closed.

### Health Gate Behavior

| Main health state | Behavior |
|-------------------|----------|
| `green` | Issues eligible for closing |
| `yellow` / `red` / `black` | Issues flagged as health-blocked, not closed |
| File missing | Health check skipped, issues eligible |
| `-SkipHealthCheck` | Health check skipped, issues eligible |

---

## Usage

### Dry-run report (default)

```powershell
./scripts/ai/auto-close-done-issues.ps1 -Repo "owner/name"
```

Prints a classification report showing which issues would be closed,
which have no merged PR, and which are blocked by health gate. No
changes are made.

### Explicit dry-run

```powershell
./scripts/ai/auto-close-done-issues.ps1 -Repo "owner/name" -DryRun
```

Same as default but intent is explicit for CI pipelines.

### Close eligible issues (mutating)

```powershell
./scripts/ai/auto-close-done-issues.ps1 -Repo "owner/name" -Execute
```

For each eligible issue:
1. Posts an idempotent closing comment for audit trail.
2. Removes all `agent:*` labels.
3. Closes the issue via `gh issue close`.

### Scan specific issues

```powershell
./scripts/ai/auto-close-done-issues.ps1 -Repo "owner/name" -IssueNumbers 113,114
```

Limits the scan to specific issue numbers. Non-`agent:done` issues are
skipped with an info message.

### Skip health gate

```powershell
./scripts/ai/auto-close-done-issues.ps1 -Repo "owner/name" -Execute -SkipHealthCheck
```

Use when main health is unknown or independently verified.

### JSON output for CI

```powershell
./scripts/ai/auto-close-done-issues.ps1 -Repo "owner/name" -Json
```

Outputs structured JSON for downstream consumption:

```json
{
  "mainHealth": "green",
  "dryRun": true,
  "totalIssues": 3,
  "eligible": 2,
  "noPr": 1,
  "blocked": 0,
  "alreadyClosed": 0,
  "results": [
    {
      "issue": 113,
      "title": "Add TagsModule",
      "status": "eligible",
      "detail": "PR #120 merged; issue ready to close",
      "mergedPR": 120,
      "action": "would-close"
    }
  ]
}
```

### Display help

```powershell
./scripts/ai/auto-close-done-issues.ps1 -Help
```

---

## Dry-Run Contract

This script defaults to dry-run. The contract:

- **Default mode:** No issues closed, no labels removed. Report only.
- **`-DryRun` flag:** Same as default; explicit confirmation for CI.
- **`-Execute` flag:** Required for mutation. Conflicts with `-DryRun`.
- **`-Execute` + health gate:** Issues blocked by non-green health are
  skipped even in execute mode.
- **Closing comment:** Every closed issue gets an idempotent audit
  comment with `<!-- ai-auto-close:begin/end -->` markers.

---

## Closing Comment Format

Each closed issue receives an audit-trail comment:

```
<!-- ai-auto-close:begin -->
Auto-closed: linked PR #120 has been merged into main.
Main health at close: green
<!-- ai-auto-close:end -->
```

The markers enable idempotent detection if the script is re-run.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No actionable items (all clear or already closed) |
| 1 | Eligible issues found (dry-run) or close failures (execute) |
| 2 | Script error (missing repo, API failure) |

In dry-run mode, exit 1 signals that there are issues ready to close
(actionable items). In execute mode, exit 1 signals that some closes
failed.

---

## Integration

The auto-close helper fits into the orchestration workflow:

```
1. Workers complete PRs        → agent:done label set
2. Merge batch runs            → PRs merged into main
3. Post-merge health gate      → main health verified green
4. Auto-close done issues      → issues closed, labels removed  ← THIS SCRIPT
5. State reconciler            → confirms no remaining drift
6. Planning loop               → next wave candidates evaluated
```

### When to run

| Scenario | When |
|----------|------|
| After merge batch | After health gate passes |
| Reconciliation cycle | When state-reconciler reports `merged-pr-open-issue` drift |
| Manual cleanup | Operator reviewing stale `agent:done` issues |

### Relationship to state reconciler

The [state-reconciler](state-reconciler.md) detects the `merged-pr-open-issue`
drift rule but never mutates. This script is the mutation companion:
it reads the same evidence (merged PRs, issue labels) and performs the
close action. Run the reconciler first to audit, then this script to
act.

---

## Design Decisions

- **Dry-run default.** Consistent with all other `scripts/ai/*.ps1`
  scripts. No mutation without explicit opt-in.
- **Batch PR fetch.** Queries `gh pr list --state merged` once and
  matches locally, avoiding N+1 API calls.
- **Health gate is optional.** The file may not exist in early
  orchestration phases. `-SkipHealthCheck` provides an escape hatch.
- **Closing comment with markers.** Provides an audit trail and enables
  idempotent re-runs.
- **Label removal is comprehensive.** Removes all `agent:*` labels, not
  just `agent:done`, to prevent label drift from prior states.

---

## See Also

- [Issue Lifecycle](issue-lifecycle.md) — State machine and label definitions
- [State Reconciler](state-reconciler.md) — Drift detection (read-only companion)
- [Merge Result Fact Projection](merge-result-fact-projection.md) — How merge facts flow into the next loop
- [Merge Closure SOP](merge-closure-sop.md) — Post-merge procedure
- [Controlled Auto-Merge](controlled-auto-merge.md) — Batch merge for allowlisted PRs
- [Result Publishing](result-publishing.md) — Label transitions after worker completion
