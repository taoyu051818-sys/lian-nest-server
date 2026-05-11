# Self-Cycle Fixtures

Dry-run fixtures proving the planner-to-launch-gate path works without live GitHub access.

## Files

| File | Purpose |
|------|---------|
| `01-planner-output-task.json` | Compiled task JSON (planner output) with expected gate result |
| `02-health-green.json` | Green health marker fixture |
| `03-issue-body.md` | Sample issue body with CONTROL APPENDIX for reference |

## Usage

```powershell
# Validate fixtures through the launch gate
./scripts/ai/run-self-cycle.ps1 -DryRunFixture ./tests/fixtures/self-cycle

# Or pass task + health files directly
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tests/fixtures/self-cycle/01-planner-output-task.json -HealthFile ./tests/fixtures/self-cycle/02-health-green.json
```

## What This Proves

1. A task JSON compiled from an issue's CONTROL APPENDIX has the required fields
2. The launch gate classifies the worker type correctly (docs-only → "docs")
3. A green health state permits the task to proceed
4. No live GitHub API calls are needed for validation
