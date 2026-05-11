# Worker PR Reconciler

Maps running issues to their open PRs and suggests state label corrections.
This is the final control-loop layer that lets Codex exit routine orchestration.

The script lives at `scripts/ai/reconcile-worker-prs.ps1`.

## Overview

The worker PR reconciler scans agent-labeled issues and their linked PRs to
identify mismatches between issue labels and PR readiness. Unlike the
[state reconciler](state-reconciler.md) which detects broad lifecycle drift,
this script focuses specifically on the issue-to-PR mapping and produces
concrete label correction suggestions.

Dry-run is the default mode. No labels, issues, or PRs are modified.

## Reconciliation Rules

| Rule | Condition | Current | Suggested | Severity |
|------|-----------|---------|-----------|----------|
| `running-pr-ready` | `agent:running` + CLEAN open PR | `agent:running` | `agent:done` | action |
| `running-pr-draft` | `agent:running` + draft PR | `agent:running` | `agent:running` | info |
| `running-pr-conflicts` | `agent:running` + merge conflicts | `agent:running` | `agent:blocked` | action |
| `running-pr-checks-fail` | `agent:running` + failing checks | `agent:running` | `agent:blocked` | action |
| `done-without-pr` | `agent:done` + no PR exists | `agent:done` | `agent:running` | action |
| `queued-with-open-pr` | `agent:queued` + open PR exists | `agent:queued` | `agent:done` | action |
| `blocked-with-ready-pr` | `agent:blocked` + CLEAN PR | `agent:blocked` | `agent:done` | action |
| `stale-pr` | PR open >StaleDays with no activity | *(any)* | review/close | warning |

### PR Cleanliness

A PR is considered **CLEAN** when all of the following are true:
- State is `OPEN`
- Not a draft
- Mergeable (no conflicts)
- No status checks in `FAILURE`, `CANCELLED`, or `TIMED_OUT`

## Usage

### Scan all agent-labeled issues

```powershell
./scripts/ai/reconcile-worker-prs.ps1 -Repo "owner/name"
```

### Scan specific issues

```powershell
./scripts/ai/reconcile-worker-prs.ps1 -Repo "owner/name" -IssueNumbers 610,611
```

### Use a fixture file (offline / CI)

```powershell
./scripts/ai/reconcile-worker-prs.ps1 -FixturePath ./snapshot.json
```

Fixture JSON format:

```json
{
  "description": "Human-readable scenario description",
  "expectedRules": ["running-pr-ready"],
  "expectedCount": 1,
  "issues": [
    {
      "number": 601,
      "title": "Example issue",
      "state": "OPEN",
      "labels": [{"name": "agent:running"}],
      "updatedAt": "2026-05-11T10:00:00Z",
      "linkedPRs": [
        {
          "number": 650,
          "title": "feat: example #601",
          "state": "OPEN",
          "isDraft": false,
          "mergeable": "MERGEABLE",
          "statusCheckRollup": [],
          "updatedAt": "2026-05-11T09:00:00Z"
        }
      ]
    }
  ]
}
```

### Validate fixture directory (CI regression)

```powershell
./scripts/ai/reconcile-worker-prs.ps1 -FixtureDir ./tests/fixtures/reconcile-worker-prs/
```

Each JSON file in the directory must include `issues`, `expectedRules`, and
`expectedCount`. The validator checks that each fixture produces exactly the
expected rules and count. Exit code is non-zero if any fixture fails.

### Print suggested label commands

```powershell
./scripts/ai/reconcile-worker-prs.ps1 -Repo "owner/name" -Apply
```

This prints `gh issue edit` commands for manual review. No labels are
changed automatically.

### JSON output

```powershell
./scripts/ai/reconcile-worker-prs.ps1 -Repo "owner/name" -Json
```

Outputs a structured JSON report for CI consumption.

### Run self-test

```powershell
./scripts/ai/reconcile-worker-prs.ps1 -SelfTest
```

Creates temporary fixtures covering the reconciliation rules, validates
them, and reports PASS/FAIL. No network calls.

### Show help

```powershell
./scripts/ai/reconcile-worker-prs.ps1 -Help
```

## Output

The reconciler produces:

1. **Console report** -- grouped by severity (action, warning, info)
2. **JSON report** -- when `-Json` is passed, structured for CI consumption
3. **Markdown report** -- wrapped in idempotency markers for posting as
   a GitHub comment

### Comment Markers

```
<!-- ai-reconcile-worker-prs:begin -->
... report table ...
<!-- ai-reconcile-worker-prs:end -->
```

### JSON Report Structure

```json
{
  "reconcilerVersion": 1,
  "capturedAt": "2026-05-11T12:00:00.0000000Z",
  "repo": "owner/name",
  "mode": "dry-run",
  "totalCorrections": 2,
  "corrections": [
    {
      "issue": 610,
      "title": "Add worker reconciliation",
      "rule": "running-pr-ready",
      "current": "agent:running",
      "suggest": "agent:done",
      "detail": "PR #650 is CLEAN and ready for review",
      "severity": "action",
      "pr": 650
    }
  ]
}
```

## Stale PR Threshold

Customize the stale PR threshold with `-StaleDays`:

```powershell
./scripts/ai/reconcile-worker-prs.ps1 -Repo "owner/name" -StaleDays 14
```

Default is 7 days.

## Design Constraints

- **No auto-mutation.** The script never calls `gh issue edit` or
  `gh label`. All suggested changes are printed for manual review.
- **Read-only by default.** The `-Apply` flag only prints commands;
  it does not execute them.
- **Dry-run is default.** No mutation occurs without explicit `-Apply`.
- **Fixture support.** CI can run the reconciler against a JSON snapshot
  without GitHub API access. The `-FixtureDir` mode validates expected
  rules, providing regression coverage.
- **Idempotent output.** Markdown markers allow re-posting without
  duplicates.

## Integration

The reconciler fits into the orchestration workflow:

1. **Batch launcher** picks up queued issues and launches workers.
2. **Workers** implement, open PRs, and set `agent:done`.
3. **Worker PR reconciler** verifies labels match PR state.
4. **State reconciler** detects broader lifecycle drift.
5. **Repo-owner** reviews correction suggestions and applies fixes.

This script is the final control-loop layer before Codex can exit
routine orchestration. It catches the common case where a worker has
finished (PR is ready) but the label hasn't been updated.

## Relationship to State Reconciler

| Aspect | Worker PR Reconciler | State Reconciler |
|--------|---------------------|------------------|
| Focus | Issue-to-PR label mapping | Broad lifecycle drift |
| Rules | PR readiness, conflicts, checks | Stale running, done without merge |
| Output | Label correction suggestions | Drift report with transitions |
| Use case | After worker batch completes | Periodic health check |

Use the worker PR reconciler when you need to verify that PR readiness
matches issue labels. Use the state reconciler for broader drift detection
including stale workers, merged-but-open issues, and projection consistency.

## See Also

- [State Reconciler](state-reconciler.md) -- Broader lifecycle drift detection
- [Issue Lifecycle](issue-lifecycle.md) -- State machine and label definitions
- [Orchestration](orchestration.md) -- Full orchestration flow
- [Controlled Auto-Merge](controlled-auto-merge.md) -- Batch merge for eligible PRs
- [SOP](SOP.md) -- Full development lifecycle
- [#610](https://github.com/nicholasxsxs/lian-nest-server/issues/610) -- This feature
