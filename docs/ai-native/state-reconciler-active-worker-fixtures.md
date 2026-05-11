# State Reconciler: Active Worker Fixture Coverage

This document describes the fixture-based test coverage for the active worker
projection drift rules in the state reconciler.

## Motivation

The state reconciler's projection drift rules (`stale-worker-projection`,
`running-missing-from-projection`, `stale-projection`) need deterministic
offline coverage. The test script exercises these rules via synthetic fixture
files without calling GitHub APIs.

## Test Script

```
pwsh ./scripts/ai/state-reconciler.active-workers.test.ps1
```

The script is fully offline. It writes temporary fixture JSON files to a
system temp directory, invokes `state-reconciler.ps1 -FixtureDir` against
them, and asserts that the expected drift rules fire.

## Fixture Inventory

| Fixture | Rule Tested | Description |
|---------|-------------|-------------|
| `01-stale-worker-projection.json` | `stale-worker-projection` | Worker entry exists in projection but the issue label is `agent:done`. |
| `02-running-missing-from-projection.json` | `running-missing-from-projection` | Issue has `agent:running` label but no matching entry in the projection. |
| `03-stale-projection.json` | `stale-projection` | `capturedAt` timestamp is older than the stale threshold (72h). |
| `04-clean-no-projection-drift.json` | _(none)_ | Worker and label are consistent; projection is fresh. Expects 0 drifts. |

All fixtures are generated at runtime by the test script and cleaned up
after the run. They follow the same schema as the static fixtures in
`tests/fixtures/state-reconciler/`.

## Fixture Schema

Each fixture JSON file follows this structure:

```json
{
  "description": "Human-readable test description",
  "expectedRules": ["rule-name"],
  "expectedCount": 1,
  "issues": [
    {
      "number": 301,
      "title": "Issue title",
      "state": "OPEN",
      "labels": [{"name": "agent:done"}],
      "updatedAt": "2026-05-10T12:00:00Z"
    }
  ],
  "activeWorkers": {
    "markerVersion": 1,
    "capturedAt": "2026-05-11T12:00:00Z",
    "workers": [
      {
        "conflictGroup": "auth-core",
        "issue": 301,
        "branch": "claude/wave10-issue-301"
      }
    ]
  }
}
```

The `activeWorkers` field is what triggers projection drift rules in
`Invoke-FixtureValidation`. Without it, only label-based drift rules run.

## Projection Drift Rules Reference

| Rule | Severity | Condition |
|------|----------|-----------|
| `stale-worker-projection` | warning | Worker in projection, issue label is `agent:done`. |
| `running-missing-from-projection` | info | Issue is `agent:running`, no matching projection entry. |
| `stale-projection` | warning | `capturedAt` older than `StaleHours` threshold (default 72h). |

## Adding New Projection Fixtures

1. Add a new JSON file to the test script's fixture generation block.
2. Set `expectedRules` to the rule(s) the fixture should trigger.
3. Set `expectedCount` to the total number of expected drifts.
4. Include an `activeWorkers` field with the projection data.
5. Run the test script to confirm the new fixture passes.

## See Also

- [Active Workers Projection Integration](state-reconciler-active-workers.md) — Full usage guide
- [State Reconciler](state-reconciler.md) — Core drift detection
- [Launch Gate](launch-gate.md) — Running-worker conflict detection
