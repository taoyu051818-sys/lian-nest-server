# Launch Gate Resource Policy

Integrates local machine resource guard into the pre-launch gate so the
orchestrator blocks worker dispatch when CPU, memory, disk, or process count
exceed safe thresholds.

> **Closes:** [#601](https://github.com/taoyu051818-sys/lian-nest-server/issues/601)

---

## Overview

The launch gate (`scripts/ai/check-launch-gate.ps1`) already validates tasks
against main health state, launch policy, provider pool, and conflict metadata.
This integration adds a **local resource guard** layer that checks whether the
host machine has capacity to run additional workers.

| Check | Source File | Gate Action |
|-------|-------------|-------------|
| Main health state | `.github/ai-state/main-health.json` | Block/warn by worker type |
| Launch policy | `.github/ai-policy/launch-policy.json` | Permission matrix |
| Provider pool | `.github/ai-state/provider-pool.json` | API quota warnings |
| **Local resources** | `.github/ai-state/local-resource.json` | **Block/warn by resource capacity** |
| Conflict groups | (task JSON) | Duplicate/running-worker detection |

---

## How It Works

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-ResourceFile` | `.github/ai-state/local-resource.json` | Local resource state snapshot |
| `-ResourcePolicyFile` | `.github/ai-policy/local-resource-policy.json` | Resource thresholds and sampling config |

### Evaluation Order

Resources are evaluated in the order recommended by the policy file
(cheapest first):

1. **Process count** — most likely binding constraint
2. **CPU** — OS call, moderate cost
3. **Memory** — OS call, moderate cost
4. **Disk** — filesystem call, least likely binding

### Decision Logic

| Condition | Result |
|-----------|--------|
| `global.resourceState` is `critical` | **Block launch** |
| `global.resourceState` is `unknown` | **Block launch** (fail-closed) |
| ANY resource at or above `launchBlock` threshold | **Block launch** |
| ANY resource at or above `launchWarn` threshold (none at block) | **Warn, proceed** |
| ALL resources below warn thresholds | **Clear, proceed** |
| Resource file missing or unparseable | **Block launch** (fail-closed) |

### Thresholds

Default thresholds (overridden by policy file when present):

| Resource | Warn | Block |
|----------|:----:|:-----:|
| CPU usage % | 75 | 90 |
| Memory usage % | 80 | 92 |
| Disk usage % | 85 | 95 |
| Process count | 25 | 30 |

---

## JSON Report Fields

The launch gate report includes these resource-related fields:

```json
{
  "resourceLoaded": true,
  "resourcePolicyLoaded": true,
  "resourceGlobalState": "healthy",
  "resourceBlocking": false,
  "resourceWarnings": [],
  "resourceChecks": {
    "cpu": { "usagePercent": 45.2, "level": "healthy", "warn": 75, "block": 90 },
    "memory": { "usagePercent": 62.1, "level": "healthy", "warn": 80, "block": 92 },
    "disk": { "usagePercent": 55.0, "level": "healthy", "warn": 85, "block": 95 },
    "processCount": { "runningCount": 8, "level": "healthy", "warn": 25, "block": 30 }
  },
  "allAllowed": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `resourceLoaded` | boolean | Whether the resource state file was loaded |
| `resourcePolicyLoaded` | boolean | Whether the resource policy file was loaded |
| `resourceGlobalState` | string | Aggregate state: `healthy`, `constrained`, `critical`, `unknown` |
| `resourceBlocking` | boolean | Whether resource guard is blocking the launch |
| `resourceWarnings` | string[] | Human-readable resource warnings |
| `resourceChecks` | object | Per-resource check details with level, thresholds |
| `allAllowed` | boolean | Combined gate result (health + conflicts + resources) |

---

## Console Output

When resource guard blocks a launch:

```
Resource guard:  critical (3 warnings)
Resource guard warnings:
  Local resources CRITICAL — launch blocked.
  CPU at 94.2% — exceeds block threshold (90%).
  Process count at 32 — exceeds block threshold (30).

Gate CHECK FAILED — one or more tasks blocked, conflicts detected, or resources critical.
```

When resource guard warns:

```
Resource guard:  constrained (1 warnings)
Resource guard warnings:
  Memory at 82.5% — exceeds warning threshold (80%).

Gate CHECK PASSED — all tasks cleared for launch.
```

---

## Dry-Run Mode

The dry-run report includes resource guard configuration:

```
Resource state:    ./.github/ai-state/local-resource.json (loaded: True, state: healthy)
Resource policy:   ./.github/ai-policy/local-resource-policy.json (loaded: True)
Resource guard: no warnings
```

---

## Fail-Closed Behavior

The resource guard follows the fail-closed principle defined in the resource
policy (`enforcement.failClosed: true`):

- If the resource state file cannot be parsed → **block**
- If `global.resourceState` is `unknown` → **block**
- If the resource file is missing → checks skipped (no block, but warn)

This prevents silent resource exhaustion when tooling is broken or state is stale.

---

## Relationship to Other Guards

| Guard | Scope | This Integration |
|-------|-------|-----------------|
| [local-resource-guard.md](local-resource-guard.md) | Standalone Node.js guard | Consumed via policy/state files |
| [local-resource-policy.md](local-resource-policy.md) | Threshold definitions | Policy file provides thresholds |
| [provider-pool-guard.md](provider-pool-guard.md) | API quota | Independent check, both must pass |
| [launch-gate.md](launch-gate.md) | Health + conflict | This adds resource layer to the same gate |

---

## Usage

```powershell
# Standard check (resource guard included automatically)
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json

# Custom resource file paths
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json `
    -ResourceFile ./my-resource.json `
    -ResourcePolicyFile ./my-policy.json

# JSON output (includes resource fields)
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json -Json

# Dry-run (shows resource config)
./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/batch-1.json -DryRun
```

---

## References

- [local-resource-guard.md](local-resource-guard.md) — Standalone resource guard
- [local-resource-policy.md](local-resource-policy.md) — Threshold definitions
- [local-resource-state.md](local-resource-state.md) — State file schema
- [resource-pressure-sampler.md](resource-pressure-sampler.md) — Pressure classification
- [launch-gate.md](launch-gate.md) — Main launch gate documentation
- [launch-policy.md](launch-policy.md) — Health-state launch gating
