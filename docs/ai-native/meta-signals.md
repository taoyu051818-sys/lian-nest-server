# Meta Signals Calculator

Deterministic calculator that aggregates planning feedback from health checks and worker heartbeats into a single meta-signals snapshot for the AI-native control plane.

## Purpose

The planning loop and batch launcher need a lightweight health summary to inform risk-aware prioritization. This script produces that summary by reading NDJSON log files (optional) and computing six signals:

| Signal | Range | Description |
|--------|-------|-------------|
| `failureScore` | 0-100 | Aggregated failure severity weighted by category |
| `frictionScore` | 0-100 | Friction from stale workers and no-output episodes |
| `riskScore` | 0-100 | Unresolved high-risk slices |
| `cost` | 0+ | Elapsed worker-minutes in the batch window |
| `trust` | 0-100 | Inverse of failure+friction (100 = full trust) |
| `topPain` | string | Category with the highest recent failure count |

## Command

```bash
# Show help
node scripts/ai/calculate-meta-signals.js --help

# Compute from NDJSON inputs and write to default path
node scripts/ai/calculate-meta-signals.js --healthLog health.ndjson --heartbeatLog heartbeats.ndjson

# Print to stdout instead of writing a file
node scripts/ai/calculate-meta-signals.js --stdout

# Custom output path
node scripts/ai/calculate-meta-signals.js --out ./my-signals.json

# Run with no inputs (produces zeroed-out default snapshot)
node scripts/ai/calculate-meta-signals.js
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--healthLog` | No | null | NDJSON file with health check entries |
| `--heartbeatLog` | No | null | NDJSON file with heartbeat snapshots |
| `--out` | No | `.github/ai-state/meta-signals.json` | Output file path |
| `--stdout` | No | false | Print JSON to stdout instead of writing a file |
| `--help` | No | — | Show usage and exit |

## Input Formats

### Health Log (NDJSON)

Each line is a JSON object with at minimum:

```json
{"state": "red", "category": "runtime compile", "severity": "high"}
```

| Field | Type | Description |
|-------|------|-------------|
| `state` | string | `"red"` triggers failure scoring; other values are ignored |
| `category` | string | One of: `dependency/generate`, `runtime compile`, `boundary guard`, `docs guard`, `unknown` |
| `severity` | string | `"high"` / `"Red"` adds 20 risk points; `"medium"` / `"Yellow"` adds 10 |

### Heartbeat Log (NDJSON)

Each line conforms to `monitor-state.schema.json`:

```json
{"snapshotVersion": 1, "taskId": "123", "state": "stale", "elapsedMs": 45000, "noOutputMs": 320000, "capturedAt": "2026-05-11T10:00:00Z", "lastOutputAt": "2026-05-11T09:55:00Z", "exitCode": null, "issueNumber": 87, "prNumber": null, "label": null}
```

| Field | Impact on Signals |
|-------|-------------------|
| `state: "stale"` | +30 friction points |
| `state: "running:no-output"` | +10 friction points |
| `noOutputMs > 300000` | +20 friction points |
| `noOutputMs > 60000` | +5 friction points |
| `elapsedMs` | Added to cost (worker-minutes) |

## Failure Category Weights

| Category | Weight (failureScore) |
|----------|----------------------|
| `dependency/generate` | 30 |
| `runtime compile` | 25 |
| `unknown` | 20 |
| `boundary guard` | 15 |
| `docs guard` | 10 |

## Scoring Formulas

- **failureScore**: Sum of weights for red-state entries, capped at 100.
- **frictionScore**: Sum of friction points from heartbeat states, capped at 100.
- **riskScore**: Sum of severity points (high=20, medium=10), capped at 100.
- **cost**: Sum of `elapsedMs` across all heartbeat entries, converted to minutes.
- **trust**: `clamp(100 - (failureScore * 0.6 + frictionScore * 0.4), 0, 100)`.
- **topPain**: Category with the highest count among red-state health entries; `"none"` if no failures.

## Output

The script writes a JSON snapshot to `.github/ai-state/meta-signals.json` (default):

```json
{
  "snapshotVersion": 1,
  "calculatedAt": "2026-05-11T12:00:00.000Z",
  "inputSources": {
    "healthLog": "health.ndjson",
    "heartbeatLog": "heartbeats.ndjson",
    "healthEntryCount": 5,
    "heartbeatEntryCount": 12
  },
  "signals": {
    "failureScore": 45,
    "frictionScore": 30,
    "riskScore": 20,
    "cost": 12,
    "trust": 55,
    "topPain": "runtime compile"
  }
}
```

## Safe Skeleton Behavior

When input files are missing or empty:

- All scores default to 0.
- `trust` defaults to 100 (full trust).
- `topPain` defaults to `"none"`.
- The script never throws on missing files — it produces a valid zeroed-out snapshot.

This makes the script safe to run in any environment without pre-existing log data.

## Integration

```
plan-next-batch.ps1              (reads meta-signals for risk-aware prioritization)
        |
        v
calculate-meta-signals.js        (this script — produces the snapshot)
        |
        v
.github/ai-state/meta-signals.json  (consumed by planning loop)
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Snapshot produced |
| 2 | Invalid arguments |
