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

### Show suggested label commands

```powershell
./scripts/ai/state-reconciler.ps1 -Repo "owner/name" -Apply
```

This prints `gh issue edit` commands for manual review. No labels are
changed automatically.

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
- **Fixture support.** CI can run the reconciler against a JSON snapshot
  without GitHub API access.
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
