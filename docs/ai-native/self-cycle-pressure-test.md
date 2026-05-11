# Self-Cycle Pressure Test Runbook

How to run and evaluate 20-40 worker pressure tests against the provider pool,
health gate, and launch gate pipeline.

> **Closes:** [#470](https://github.com/taoyu051818-sys/lian-nest-server/issues/470)

---

## Purpose

Validate that the self-cycle runner, provider pool, launch gate, and heartbeat
monitor behave correctly under high concurrency (20-40 simultaneous workers).
This runbook covers setup, execution, monitoring, and evaluation.

---

## Prerequisites

| Requirement | Check |
|-------------|-------|
| Main branch health is `green` | `.github/ai-state/main-health.json` has `"state": "green"` |
| Provider pool state exists | `.github/ai-state/provider-pool.json` present |
| Provider pool policy exists | `.github/ai-policy/provider-pool-policy.json` present |
| Sufficient provider capacity | `globalMaxWorkers >= target worker count` |
| `npm run check` passes | Type-check clean |
| `npm run build` passes | Build clean |

---

## Configuration

### 1. Raise Global Worker Cap

The default `globalMaxWorkers` is 3. For a 40-worker pressure test, raise it
in both policy and state files.

**`.github/ai-policy/provider-pool-policy.json`** — update `concurrency`:

```json
{
  "concurrency": {
    "globalMaxWorkers": 40,
    "selectionStrategy": "least-loaded",
    "fallbackBehavior": "block"
  }
}
```

**`.github/ai-state/provider-pool.json`** — update `global`:

```json
{
  "global": {
    "globalMaxWorkers": 40,
    "activeWorkers": 0,
    "availableProviders": 1,
    "exhaustedProviders": 0,
    "disabledProviders": 0
  }
}
```

### 2. Configure Provider Max Concurrency

Ensure each provider entry can handle its share of workers:

```json
{
  "providers": [
    {
      "id": "provider-default",
      "status": "available",
      "currentConcurrency": 0,
      "maxConcurrency": 40
    }
  ]
}
```

### 3. Raise Self-Cycle MaxTasks Limit

The default `-MaxTasks` cap is 10. Override it to allow the full batch:

```powershell
./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/pressure-batch.json -MaxTasks 40
```

### 4. Adjust Heartbeat Thresholds (Optional)

For pressure tests, consider relaxing stale detection to avoid false alarms
when many workers contend for resources:

```powershell
.\scripts\ai\wait-claude-batch.ps1 -DryRun `
    -NoOutputThresholdMs 120000 `
    -StaleThresholdMs 600000
```

---

## Test Execution

### Phase 1: Dry-Run Validation

Always dry-run first. This validates task contracts, conflict groups, and gate
results without launching workers.

```powershell
# Validate the full batch through the pipeline
./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/pressure-batch.json -MaxTasks 40
```

Verify in the dry-run output:

- All tasks pass the launch gate (`allAllowed: true`)
- No duplicate conflict groups
- No shared lock conflicts
- Provider pool preflight passes

### Phase 2: Fixture-Based Gate Validation

Use fixtures to validate the gate pipeline end-to-end without live GitHub:

```powershell
./scripts/ai/run-self-cycle.ps1 -DryRunFixture ./tests/fixtures/self-cycle -MaxTasks 40
```

### Phase 3: Scaled Batch Launch

After dry-run passes, execute with human confirmation:

```powershell
# Execute mode — requires explicit confirmation
./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/pressure-batch.json -MaxTasks 40 -Execute
```

### Alternative: Direct Batch Launch

For finer control, use `batch-launch.ps1` directly:

```powershell
# Dry-run first
./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/pressure-batch.json

# Execute
./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/pressure-batch.json -Execute
```

---

## Monitoring During Test

### Heartbeat Monitoring

Monitor each worker's heartbeat state. At high concurrency, expect some workers
to enter `running:no-output` as they contend for API capacity.

```powershell
# Check a specific worker's snapshot
$snapshot = Get-Content ./scripts/ai/monitor-state.json | ConvertFrom-Json
if ($snapshot.state -eq "stale") {
    Write-Warning "Worker $($snapshot.taskId) is stale"
}
```

### Provider Pool State

Poll the provider pool state to track exhaustion and cooldown:

```powershell
# Check provider pool guard
node scripts/guards/check-provider-pool.js --json
```

Key signals during the test:

| Signal | Meaning | Action |
|--------|---------|--------|
| `available` count dropping | Workers consuming capacity | Normal under load |
| `exhausted` count rising | Rate limits or quota hit | Wait for cooldown |
| All providers exhausted | Pool fully consumed | Cycle will block — wait |
| `at-capacity` | Concurrency limit reached | New workers queued |

### Telemetry Budget Guard

After workers complete, validate their telemetry against budgets:

```bash
# Check a completed worker's telemetry
node scripts/guards/check-telemetry-budget.js --file telemetry.json --json
```

Watch for:

| Metric | Warning | Violation |
|--------|---------|-----------|
| Wall-clock (execution) | > 45 min | > 90 min |
| Input tokens (execution) | > 400k | > 500k |
| Output tokens (execution) | > 120k | > 150k |
| Cost | > 80% budget | > 100% budget |

---

## Evaluation Criteria

### Pass Conditions

| Criterion | How to Verify |
|-----------|---------------|
| No launch gate false negatives | All valid tasks passed the gate |
| No launch gate false positives | No invalid tasks slipped through |
| Provider pool state consistent | `check-provider-pool.js` exits 0 |
| Conflict groups respected | No two workers in same group ran simultaneously |
| Shared locks enforced | No concurrent `app-module` writers |
| Heartbeat snapshots complete | Every worker has a final `done` or `failed` snapshot |
| Budget guard passes | No unexplained cost or token overruns |
| Health state stable | Main remains `green` throughout |

### Failure Indicators

| Symptom | Likely Cause | Investigation |
|---------|--------------|---------------|
| Workers stuck in `stale` | API hang or provider exhaustion | Check provider pool state |
| Gate blocks valid tasks | Health state degraded during test | Check `main-health.json` |
| Duplicate conflict group launch | Batch launcher bug | Check batch-launch logs |
| Provider pool guard exits 1 | State/policy mismatch | Run `check-provider-pool.js --json` |
| Budget overruns | Token leak or context explosion | Check telemetry records |

---

## Scaling Strategy

| Batch Size | Expected Behavior | Risk |
|------------|-------------------|------|
| 10 workers | Default limit, low risk | Baseline |
| 20 workers | Moderate contention | Some `running:no-output` |
| 30 workers | High contention | Provider cooldown likely |
| 40 workers | Maximum stress | Expect exhaustion events |

### Recommended Progression

1. **10 workers** — validate basic pipeline under light load
2. **20 workers** — confirm conflict group enforcement at scale
3. **30 workers** — stress provider pool and cooldown recovery
4. **40 workers** — full pressure test, evaluate all criteria

---

## Post-Test Cleanup

After the pressure test:

1. **Reset provider pool** — restore `globalMaxWorkers` to production value
2. **Reset MaxTasks** — restore default limit of 10
3. **Review telemetry** — run budget guard on all completed worker records
4. **Check health state** — confirm main is still `green`
5. **Archive results** — save heartbeat snapshots and telemetry for comparison

---

## References

- [Self-Cycle Runner](self-cycle-runner.md) — top-level orchestrator
- [Provider Pool](provider-pool.md) — provider pool architecture
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch provider validation
- [Launch Gate](launch-gate.md) — health and conflict validation
- [Worker Heartbeat](worker-heartbeat.md) — process monitoring
- [Telemetry Budget Guard](telemetry-budget-guard.md) — budget validation
- [Parallel Work Policy](parallel-work-policy.md) — conflict group rules
- [Self-Cycle Provider Pool Preflight](self-cycle-provider-pool-preflight.md) — pre-gate provider check
