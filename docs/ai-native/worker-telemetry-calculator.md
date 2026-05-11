# Worker Telemetry Calculator

Non-destructive skeleton that reads worker manifest/result files when present and emits a `worker-telemetry` record conforming to [`schemas/worker-telemetry.schema.json`](../../schemas/worker-telemetry.schema.json).

**Script:** `scripts/ai/calculate-worker-telemetry.js`

## Purpose

After a worker task completes (or at checkpoint intervals), the calculator produces a telemetry record that captures cost, progress, and quality signals. This bridges the gap between budgeted plans (task contract) and actual resource consumption.

| Input | What it provides | Required? |
|-------|-----------------|-----------|
| Task contract JSON | Identity, budget, policy fields | No |
| Heartbeat NDJSON | Wall-clock elapsed time | No |
| Worker result JSON | Token usage, changed files, validation, quality signals | No |

When inputs are absent, the calculator produces a zeroed-out default record so downstream consumers never break.

## Usage

```bash
# Show help
node scripts/ai/calculate-worker-telemetry.js --help

# Default: read no inputs, write zeroed telemetry to .github/ai-state/worker-telemetry.json
node scripts/ai/calculate-worker-telemetry.js

# With task contract
node scripts/ai/calculate-worker-telemetry.js --task path/to/task.json

# With all inputs
node scripts/ai/calculate-worker-telemetry.js \
  --task task.json \
  --heartbeat heartbeat.ndjson \
  --result result.json

# Dry-run: print to stdout, no file written
node scripts/ai/calculate-worker-telemetry.js --task task.json --dry-run

# Pipe to stdout
node scripts/ai/calculate-worker-telemetry.js --task task.json --stdout

# Custom output path
node scripts/ai/calculate-worker-telemetry.js --task task.json --out custom/path.json
```

## Token Source Handling

Token usage has three source/confidence pairings:

| Source | Confidence | When |
|--------|-----------|------|
| `api_response` | `high` | Provider returned usage in API response headers |
| `log_parse` | `medium` | Parsed from worker output logs |
| `estimate` | `low` | Heuristic estimate (default when no source available) |

When no token data is available, the calculator emits `source: "estimate"`, `confidence: "low"`, and zero token counts with `pricingBasis: "unknown"`.

## Cost Calculation

Cost is derived from token counts using the pricing reference from [telemetry-budget-policy.json](../../.github/ai-policy/telemetry-budget-policy.json):

- Input: $3.00 per 1M tokens
- Output: $15.00 per 1M tokens
- Result: `amountCents` in USD cents

`pricingBasis` reflects the source:
- `api_list` when tokens come from API response headers
- `estimated` when tokens are parsed from logs
- `unknown` when using heuristic defaults

## Input Files

### Task Contract

Reads these fields when present:

| Field path | Used for |
|-----------|----------|
| `taskId` | Record identity |
| `taskType` | Record identity |
| `actorRole` / `rolePacket.actorRole` | Record identity |
| `pmPhase` | Wave/phase grouping |
| `targetIssue` | Issue number |
| `targetPR` | PR number |
| `budget` / `budgets` | File/line budgets, time limits |
| `mainHealthPolicy` | Gate outcome defaults |
| `generatedCodePolicy` | Gate outcome defaults |

### Heartbeat NDJSON

One JSON object per line. The latest entry's `elapsedMs` is used for `timing.elapsedMs`.

### Worker Result JSON

Reads these sections when present:

| Field | Maps to |
|-------|---------|
| `tokenUsage` | `tokenUsage` (with source/confidence) |
| `changedFiles` | `changedFiles` |
| `validationResults` | `validationResults` |
| `qualitySignals` | `qualitySignals` |
| `gateOutcome` | `gateOutcome` |

## Output

Writes a single JSON file conforming to `schemas/worker-telemetry.schema.json` to:
- Default: `.github/ai-state/worker-telemetry.json`
- Custom: `--out <path>`

## Relationship to Other Schemas

```
task.schema.json              — defines the plan (budgets, roles, commands)
monitor-state.schema.json     — captures runtime liveness
worker-telemetry.schema.json  — captures cost and outcome
```

The calculator reads from task contracts and heartbeat snapshots, then emits a telemetry record. Consumers join on `taskId` to correlate with the originating task.

## Dry-Run Validation

Use `--dry-run` to preview the telemetry JSON without writing any file. This is safe for CI and local development — it produces deterministic output and never modifies the filesystem.

```bash
node scripts/ai/calculate-worker-telemetry.js --task task.json --dry-run
```
