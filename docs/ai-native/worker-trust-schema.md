# Worker Trust Schema

Defines the JSON schema for the worker trust state projection at `.github/ai-state/worker-trust.json`.

**Schema location:** `schemas/worker-trust.schema.json`

## Purpose

The worker trust projection establishes baseline trust scores for each worker class and defines how those scores gate scheduling decisions. The schema ensures:

- Consumers can validate the file before consuming it at dispatch time.
- Required fields are never omitted (e.g. `scheduling.rules`).
- Trust score inputs are structurally sound (weights, types, ranges).

| Layer | Reads | Purpose |
|-------|-------|---------|
| **Orchestrator / launcher** | `workerClasses`, `trustScore`, `scheduling` | Determines whether to dispatch a worker |
| **Launch gate** | `workerClasses.<class>.allowedHealthStates` | Hard gate before trust score computation |
| **State reconciler** | `trustScore.inputs` | Feeds historical success rate back into trust |
| **Heartbeat monitor** | `trustScore.inputs` | Provides stale worker count input |

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `markerVersion` | `1` (const) | yes | Schema version. Consumers reject other values. |
| `capturedAt` | date-time | yes | ISO-8601 timestamp when the projection was captured or last updated. |
| `description` | string | yes | Human-readable description of this trust projection. |
| `workerClasses` | object | yes | Per-worker-class trust defaults. Each key is a worker class name. |
| `trustScore` | object | yes | Trust score computation configuration. |
| `scheduling` | object | yes | Scheduling rules that map trust scores to launch actions. |

## Worker Class Entry

Each entry in `workerClasses` has these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `defaultTrustScore` | number [0.0, 1.0] | yes | Baseline trust score for this worker class. |
| `allowedHealthStates` | string[] | yes | Health states where this class may launch. Hard gate — checked before trust computation. |
| `riskTier` | `low` / `medium` / `high` | yes | Risk classification. |
| `layer` | enum | yes | Backend worker layer (`contract-planning`, `runtime-foundation`, `health-diagnostic`, `feature-repository`, `review-audit`, `merge-release`). |
| `note` | string or null | no | Human-readable rationale. |

### Known Worker Classes

| Class | Default Trust | Risk | Layer | Allowed Health States |
|-------|:-------------:|:----:|:-----:|:---------------------:|
| `runtime-feature` | 0.5 | high | feature-repository | green |
| `foundation-fix` | 0.8 | medium | runtime-foundation | green, yellow, red |
| `docs-contract` | 0.9 | low | contract-planning | green, yellow |
| `health-gate` | 0.9 | low | health-diagnostic | green, yellow, red |
| `test-only` | 0.7 | medium | feature-repository | green, yellow |
| `refactor` | 0.4 | high | feature-repository | green |
| `review-audit` | 0.85 | low | review-audit | green, yellow |
| `merge-release` | 0.6 | high | merge-release | green |

## Trust Score Inputs

Each entry in `trustScore.inputs` describes one weighted input to the composite trust score.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique input name. |
| `type` | `enum` / `float` / `integer` | yes | Data type of the input value. |
| `weight` | number [0.0, 1.0] | yes | Weight in the composite score. Weights should sum to 1.0. |
| `description` | string | yes | What this input measures. |
| `values` | string[] | no | Allowed enum values when `type` is `enum`. |
| `range` | [number, number] | no | Valid range when `type` is `float`. |
| `min` | integer | no | Minimum value when `type` is `integer`. |

### Default Inputs

| Input | Type | Weight | Description |
|-------|------|:------:|-------------|
| `mainHealthState` | enum | 0.30 | Current main branch health. Green = 1.0, yellow = 0.6, red = 0.2, black = 0.0. |
| `workerClassDefault` | float | 0.25 | Baseline trust from `workerClasses.<class>.defaultTrustScore`. |
| `historicalSuccessRate` | float | 0.20 | Rolling 30-day success rate for this worker class. |
| `staleWorkerCount` | integer | 0.15 | Currently stale workers. 0 = 1.0, 5+ = 0.0. |
| `conflictGroupLoad` | integer | 0.10 | In-flight workers in same conflict group. 0 = 1.0, 3+ = 0.0. |

### Formula

The composite trust score is a weighted sum clamped to [0.0, 1.0]:

```
trustScore = clamp(
  sum(normalize(input_i) * weight_i for each input),
  0.0, 1.0
)
```

Inputs are normalized to [0.0, 1.0] before weighting. The formula field is a human-readable description; actual computation is delegated to the orchestrator.

## Scheduling Rules

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `minTrustToLaunch` | number [0.0, 1.0] | yes | Minimum trust score to launch. Below this, the worker is blocked. |
| `highTrustThreshold` | number [0.0, 1.0] | yes | Trust score at or above which a worker gets standard launch. |
| `rules` | array | yes | Ordered rules mapping trust ranges to actions. |

### Rule Entry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `condition` | string | yes | Human-readable condition expression. |
| `action` | enum | yes | `block_launch`, `launch_with_monitoring`, or `launch_standard`. |
| `description` | string | yes | What happens when this rule fires. |

### Default Rules

| Condition | Action | Description |
|-----------|--------|-------------|
| `trustScore < 0.3` | `block_launch` | Trust too low. Orchestrator must not dispatch. |
| `0.3 <= trustScore < 0.7` | `launch_with_monitoring` | Proceed with mandatory heartbeat monitoring and review. |
| `trustScore >= 0.7` | `launch_standard` | Normal lifecycle through standard SOP. |

## Health Gate Interaction

The `allowedHealthStates` per worker class is a **hard gate** checked before trust score computation:

```
if currentHealth NOT IN workerClass.allowedHealthStates:
    block (hard gate)
else:
    compute trustScore
    apply scheduling rule based on trustScore
```

This prevents low-trust workers from launching in bad health states even if other inputs are favorable.

## Validation

The schema is a standard JSON Schema (draft-07) document. To validate a worker-trust.json file against it, use any JSON Schema validator:

```bash
# Example with ajv-cli
npx ajv validate -s schemas/worker-trust.schema.json -d .github/ai-state/worker-trust.json
```

## Design Decisions

- **Projection seed, not runtime state.** This file sets defaults. The orchestrator computes actual trust scores at dispatch time using live inputs.
- **No secrets or tokens.** The file contains only scheduling metadata and trust parameters.
- **`markerVersion` enables schema evolution.** Consumers check the version before parsing.
- **Weights are advisory.** The orchestrator may override weights based on operational experience. The projection file documents the recommended weights.
- **Hard health gate before soft trust gate.** `allowedHealthStates` is a prerequisite, not an input to the trust formula.

## References

- [worker-trust.md](worker-trust.md) — Trust score semantics and scheduling implications
- [health-state-schema.md](health-state-schema.md) — Main health state schema (consumed as trust input)
- [worker-telemetry-schema.md](worker-telemetry-schema.md) — Telemetry schema for post-execution accounting
- [backend-worker-layers.md](backend-worker-layers.md) — Layer model and blocked-by relationships
- [launch-gate.md](launch-gate.md) — Launch gate policy consumption
