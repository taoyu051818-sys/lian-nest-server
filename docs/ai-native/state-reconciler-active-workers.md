# State Reconciler: Active Worker Projection Integration

The state reconciler can optionally read the active workers projection
(`.github/ai-state/active-workers.json`) to detect drift between the
projection and GitHub issue labels.

## Usage

```powershell
# Label-based drift only (existing behavior)
./scripts/ai/state-reconciler.ps1 -Repo "owner/repo"

# Label + projection drift
./scripts/ai/state-reconciler.ps1 -Repo "owner/repo" -ActiveWorkersPath ./.github/ai-state/active-workers.json

# Offline with fixture that embeds projection data
./scripts/ai/state-reconciler.ps1 -FixturePath ./snapshot.json
```

The `-ActiveWorkersPath` parameter is optional. When omitted, projection
drift rules are skipped and the reconciler behaves exactly as before.

## Projection Drift Rules

When `-ActiveWorkersPath` is provided, three additional rules run:

| Rule | Severity | Description |
|------|----------|-------------|
| `stale-worker-projection` | warning | Worker entry exists in projection but the issue label is `agent:done`. The worker should have been removed from the projection. |
| `running-missing-from-projection` | info | Issue has `agent:running` label but no matching entry in the active workers projection. Either the projection is out of date or the label is stale. |
| `stale-projection` | warning | `capturedAt` timestamp is older than the `-StaleHours` threshold (default 72h). The projection may need a refresh. |

## Fixture Format

Fixtures can embed projection data in an `activeWorkers` field:

```json
{
  "issues": [...],
  "expectedRules": ["stale-worker-projection"],
  "expectedCount": 1,
  "activeWorkers": {
    "markerVersion": 1,
    "capturedAt": "2026-05-11T12:00:00Z",
    "workers": [
      {
        "conflictGroup": "auth-core",
        "issue": 258,
        "branch": "claude/wave6-issue-258"
      }
    ]
  }
}
```

When `activeWorkers` is present in a fixture, the fixture validation
(`-FixtureDir`) runs projection drift rules alongside label-based rules.

## Evidence Precedence

The reconciler follows this precedence:

1. **Worker evidence** (active-workers projection) — authoritative for
   which conflict groups are in-flight
2. **PR state** — merged/open/closed PRs indicate work progress
3. **Issue labels** — `agent:*` labels reflect human/agent intent

Projection drift rules cross-reference layer 1 against layer 3 to surface
inconsistencies.

## Backward Compatibility

- All existing parameters and drift rules are unchanged.
- `-ActiveWorkersPath` is purely additive; omitting it skips projection rules.
- Fixture validation only runs projection rules when `activeWorkers` is
  present in the fixture JSON.
- The script remains dry-run by default with no auto-mutation.

## See Also

- [Active Workers State](active-workers-state.md) — Projection schema
- [State Reconciler](state-reconciler.md) — Core drift detection
- [Launch Gate](launch-gate.md) — Running-worker conflict detection
