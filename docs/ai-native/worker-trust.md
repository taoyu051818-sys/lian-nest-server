# Worker Trust State Projection

Defines per-worker-class trust defaults, trustScore input factors, and scheduling implications for the AI-native control plane.

> **Reference:** [ai-state/README.md](../../.github/ai-state/README.md) for marker conventions, [main-health-policy.md](main-health-policy.md) for health states, [backend-worker-layers.md](backend-worker-layers.md) for layer model.

---

## Overview

The worker trust projection is a machine-readable seed at `.github/ai-state/worker-trust.json`. It establishes baseline trust scores for each worker class and defines how those scores affect scheduling decisions. The orchestrator consults this file before dispatching workers.

This is a **projection seed** — it sets initial defaults. At runtime, the orchestrator adjusts trust scores dynamically based on observed inputs (health state, success rates, stale worker counts).

---

## Worker Class Trust Defaults

Each worker class has a `defaultTrustScore` in `[0.0, 1.0]`. Higher scores indicate more trust in the worker class to produce safe, reviewable output.

| Worker Class | Default Trust | Risk Tier | Allowed Health States |
|--------------|:-------------:|:---------:|:---------------------:|
| `runtime-feature` | 0.5 | high | green |
| `foundation-fix` | 0.8 | medium | green, yellow, red |
| `docs-contract` | 0.9 | low | green, yellow |
| `health-gate` | 0.9 | low | green, yellow, red |
| `test-only` | 0.7 | medium | green, yellow |
| `refactor` | 0.4 | high | green |
| `review-audit` | 0.85 | low | green, yellow |
| `merge-release` | 0.6 | high | green |

### Rationale

- **High trust (0.8+):** Docs and health-gate workers have low blast radius. They cannot break runtime or data integrity.
- **Medium trust (0.5-0.7):** Feature, test, and merge workers have moderate risk. Their output requires review and depends on main health.
- **Low trust (0.4):** Refactors on an unstable base amplify risk. Lowest default trust.

---

## Trust Score Inputs

The orchestrator computes a composite `trustScore` from five weighted inputs. Each input is normalized to `[0.0, 1.0]` before weighting.

| Input | Type | Weight | Description |
|-------|------|:------:|-------------|
| `mainHealthState` | enum | 0.30 | Current main branch health from `main-health.json`. Green = 1.0, yellow = 0.6, red = 0.2, black = 0.0. |
| `workerClassDefault` | float | 0.25 | Baseline trust from this projection file. |
| `historicalSuccessRate` | float | 0.20 | Rolling 30-day success rate for this worker class (derived from `agent:done` vs `agent:running` label transitions). |
| `staleWorkerCount` | integer | 0.15 | Number of currently stale workers. Normalized: 0 stale = 1.0, 5+ stale = 0.0. |
| `conflictGroupLoad` | integer | 0.10 | Number of in-flight workers in the same conflict group. Normalized: 0 = 1.0, 3+ = 0.0. |

### Computation

```
trustScore = clamp(
  0.30 * normalize(mainHealthState) +
  0.25 * workerClassDefault +
  0.20 * historicalSuccessRate +
  0.15 * normalize(staleWorkerCount) +
  0.10 * normalize(conflictGroupLoad),
  0.0, 1.0
)
```

The formula is a weighted sum clamped to `[0.0, 1.0]`. Normalization maps each input to the same range before weighting.

### Input Sources

| Input | Source |
|-------|--------|
| `mainHealthState` | `.github/ai-state/main-health.json` → `state` field |
| `workerClassDefault` | `.github/ai-state/worker-trust.json` → `workerClasses.<class>.defaultTrustScore` |
| `historicalSuccessRate` | Derived from issue label transitions (state reconciler output) |
| `staleWorkerCount` | Heartbeat monitor snapshots (`stale` state count) |
| `conflictGroupLoad` | In-flight worker manifests (task JSON `conflictGroup` matching) |

---

## Scheduling Implications

The computed `trustScore` gates whether a worker may launch and under what conditions.

| Trust Score | Action | Description |
|:-----------:|--------|-------------|
| < 0.3 | **Block launch** | Trust is too low. Orchestrator must not dispatch the worker. Record reason and defer. |
| 0.3 – 0.7 | **Launch with monitoring** | Worker proceeds but heartbeat monitoring is mandatory. PR requires review before merge. |
| >= 0.7 | **Standard launch** | Normal lifecycle. Worker proceeds through the standard SOP without additional gates. |

### Interaction with Health State

The `allowedHealthStates` per worker class is a **hard gate** — it is checked before trust score computation. If the current health state is not in a worker class's allowed list, the worker is blocked regardless of trust score.

```
if currentHealth NOT IN workerClass.allowedHealthStates:
    block (hard gate)
else:
    compute trustScore
    apply scheduling rule based on trustScore
```

---

## Schema

The projection file at `.github/ai-state/worker-trust.json` conforms to:

```jsonc
{
  "markerVersion": 1,
  "capturedAt": "ISO-8601 timestamp",
  "description": "Human-readable description",
  "workerClasses": {
    "<class-name>": {
      "defaultTrustScore": 0.0-1.0,
      "allowedHealthStates": ["green", "yellow", "red", "black"],
      "riskTier": "low | medium | high",
      "layer": "contract-planning | runtime-foundation | health-diagnostic | feature-repository | review-audit | merge-release",
      "note": "Human-readable rationale"
    }
  },
  "trustScore": {
    "inputs": [
      {
        "name": "input-name",
        "type": "enum | float | integer",
        "weight": 0.0-1.0,
        "description": "What this input measures"
      }
    ],
    "formula": "weightedSum(inputs) clamped to [0.0, 1.0]"
  },
  "scheduling": {
    "minTrustToLaunch": 0.3,
    "highTrustThreshold": 0.7,
    "rules": [
      {
        "condition": "trustScore < threshold",
        "action": "block_launch | launch_with_monitoring | launch_standard",
        "description": "What happens"
      }
    ]
  }
}
```

---

## Downstream Consumers

| Consumer | Reads | Purpose |
|----------|-------|---------|
| **Orchestrator / launcher** | `workerClasses`, `trustScore`, `scheduling` | Determines whether to dispatch a worker and under what monitoring level |
| **Launch gate** | `workerClasses.<class>.allowedHealthStates` | Hard gate before trust score computation |
| **State reconciler** | `trustScore.inputs.historicalSuccessRate` | Feeds success rate data back into trust computation |
| **Heartbeat monitor** | `trustScore.inputs.staleWorkerCount` | Provides stale worker count input |

---

## Design Decisions

- **Projection seed, not runtime state.** This file sets defaults. The orchestrator computes actual trust scores at dispatch time using live inputs.
- **No secrets or tokens.** The file contains only scheduling metadata and trust parameters.
- **`markerVersion` enables schema evolution.** Consumers check the version before parsing.
- **Weights are advisory.** The orchestrator may override weights based on operational experience. The projection file documents the recommended weights.
- **Hard health gate before soft trust gate.** `allowedHealthStates` is a prerequisite, not an input to the trust formula. This prevents low-trust workers from launching in bad health states even if other inputs are favorable.

---

## References

- [ai-state/README.md](../../.github/ai-state/README.md) — Marker file conventions
- [main-health-policy.md](main-health-policy.md) — Health state definitions and worker type permissions
- [backend-worker-layers.md](backend-worker-layers.md) — Layer model and blocked-by relationships
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema
- [worker-heartbeat.md](worker-heartbeat.md) — Liveness signals and stale detection
- [state-reconciler.md](state-reconciler.md) — Label/PR/worker drift detection
