# State Reconciler

Identifies label/PR/worker state drift without mutating by default.
The reconciler script lives at `scripts/ai/state-reconciler.ps1`.

## Overview

The state reconciler reads issue and PR data to detect inconsistencies
in the agent workflow lifecycle. It produces a drift report with
suggested label transitions but does **not** apply changes automatically.

Dry-run is the default mode. No labels, issues, or PRs are modified.

## Evidence Precedence

When determining the true state of an issue, evidence sources are
evaluated in this order (highest precedence first):

1. **Worker evidence** -- result comments, heartbeats, structured output
2. **PR state** -- open, merged, or closed pull requests linked to the issue
3. **Issue labels** -- `agent:*` labels on the issue itself

If a merged PR exists but the issue still has `agent:running`, the PR
state wins and the reconciler flags the label as stale.

## Drift Rules

| Rule | Condition | Severity | Suggested Action |
|------|-----------|----------|------------------|
| `stale-running` | `agent:running` with no open PR for >72h | warning | Transition to `agent:blocked` or close |
| `done-without-merge` | `agent:done` but no merged PR, issue open | error | Re-open work or close issue |
| `merged-pr-open-issue` | Merged PR exists, issue still open | error | Close issue |
| `stale-queued` | `agent:queued` for >72h without pickup | info | Re-triage or remove from queue |
| `blocked-with-open-pr` | `agent:blocked` with an open PR | info | Resume or mark done |
| `merged-pr-stale-label` | Merged PR but issue label is not `agent:done` | error | Transition label to `agent:done` |
| `done-with-closed-pr` | `agent:done` but PR closed without merge | error | Re-open work or close issue |
| `multiple-agent-labels` | More than one `agent:*` label on same issue | warning | Remove incorrect label, keep one |

### Customizing the Stale Threshold

Pass `-StaleHours N` to change the default 72-hour threshold:

```powershell
./scripts/ai/state-reconciler.ps1 -Repo "o/r" -StaleHours 48
```

## Usage

### Scan all agent-labeled issues

```powershell
./scripts/ai/state-reconciler.ps1 -Repo "owner/name"
```

### Scan specific issues

```powershell
./scripts/ai/state-reconciler.ps1 -Repo "owner/name" -IssueNumbers 113,114
```

### Use a fixture file (offline / CI)

```powershell
./scripts/ai/state-reconciler.ps1 -FixturePath ./state-snapshot.json
```

Fixture JSON format:

```json
[
  {
    "number": 113,
    "title": "Example issue",
    "state": "OPEN",
    "labels": [{"name": "agent:running"}],
    "updatedAt": "2026-05-10T12:00:00Z",
    "linkedPRs": [
      {
        "number": 120,
        "title": "Fix something",
        "state": "OPEN",
        "mergedAt": null
      }
    ]
  }
]
```

### Validate fixture directory (CI regression)

```powershell
./scripts/ai/state-reconciler.ps1 -FixtureDir ./tests/fixtures/state-reconciler/
```

Each JSON file in the directory must include:

```json
{
  "description": "Human-readable scenario description",
  "expectedRules": ["stale-running", "merged-pr-stale-label"],
  "expectedCount": 2,
  "issues": [
    {
      "number": 200,
      "title": "Example",
      "state": "OPEN",
      "labels": [{"name": "agent:running"}],
      "updatedAt": "2026-05-01T00:00:00Z",
      "linkedPRs": []
    }
  ]
}
```

The validator checks that each fixture produces exactly the expected
drift rules and count. Exit code is non-zero if any fixture fails.

Bundled fixtures live in `tests/fixtures/state-reconciler/` and cover:

| Fixture | Scenario | Expected Rules |
|---------|----------|----------------|
| `01-stale-running.json` | Running issue, no PR, >72h stale | `stale-running` |
| `02-merged-pr-stale-label.json` | Merged PR but label still `agent:running` | `merged-pr-stale-label`, `merged-pr-open-issue` |
| `03-done-with-closed-pr.json` | Done label but PR closed without merge | `done-with-closed-pr`, `done-without-merge` |
| `04-multiple-agent-labels.json` | Both `agent:running` and `agent:done` | `multiple-agent-labels` |
| `05-clean-no-drift.json` | Done label with merged PR (issue should close) | `merged-pr-open-issue` |
| `06-blocked-with-open-pr.json` | Blocked with open PR | `blocked-with-open-pr` |
| `07-stale-queued.json` | Queued for >72h | `stale-queued` |
| `08-done-without-merge.json` | Done label, no merged PR, issue open | `done-without-merge` |
| `09-no-drift-closed-issue.json` | Closed issue with merged PR and done label | *(none -- clean)* |
| `10-queued-fresh.json` | Recently queued, within stale threshold | *(none -- clean)* |

### Explicit dry-run confirmation

```powershell
./scripts/ai/state-reconciler.ps1 -Repo "owner/name" -DryRun
```

The script is always dry-run by default. The `-DryRun` flag makes this
contract explicit for CI pipelines that need to verify no mutation occurs.
`-DryRun` and `-Apply` are mutually exclusive.

### Show suggested label commands

```powershell
./scripts/ai/state-reconciler.ps1 -Repo "owner/name" -Apply
```

This prints `gh issue edit` commands for manual review. No labels are
changed automatically.

### Show help

```powershell
./scripts/ai/state-reconciler.ps1 -Help
```

Displays usage, available options, drift rule reference, and the dry-run
contract.

## Output

The reconciler produces:

1. **Console report** -- grouped by severity (error, warning, info)
2. **Markdown report** -- wrapped in idempotency markers for posting as
   a GitHub comment via the result publisher

### Comment Markers

```
<!-- ai-state-reconciler:report:begin -->
... report table ...
<!-- ai-state-reconciler:report:end -->
```

## Design Constraints

- **No auto-mutation.** The script never calls `gh issue edit` or
  `gh pr edit`. All suggested changes are printed for manual review.
- **Read-only by default.** The `-Apply` flag only prints commands;
  it does not execute them.
- **Explicit dry-run flag.** `-DryRun` makes the no-mutation contract
  explicit for CI. Conflicts with `-Apply` (which prints suggestion
  commands).
- **Fixture support.** CI can run the reconciler against a JSON snapshot
  without GitHub API access. The `-FixtureDir` mode validates expected
  drift rules, providing regression coverage for rule changes.
- **Idempotent output.** Markdown markers allow re-posting without
  duplicates (same pattern as `publish-agent-result.ps1`).

## Integration

The reconciler fits into the orchestration workflow:

1. **Batch launcher** picks up queued issues.
2. **Workers** implement and publish results.
3. **State reconciler** detects drift after a batch completes.
4. **Repo-owner** reviews the drift report and applies suggested fixes.

## See Also

- [Issue Lifecycle](issue-lifecycle.md) -- State machine and label definitions
- [Result Publishing](result-publishing.md) -- How workers publish results
- [Worker Heartbeat](worker-heartbeat.md) -- Liveness signals
- [Orchestration](orchestration.md) -- Full orchestration flow
- [#113](https://github.com/nicholasxsxs/lian-nest-server/issues/113) -- This feature
