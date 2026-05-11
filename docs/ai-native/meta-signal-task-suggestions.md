# Meta-Signal Task Suggestions

Deterministic next-task suggestion engine that reads a meta-signals snapshot and produces actionable suggestions for the AI-native planning console.

## Purpose

The planning console needs a lightweight way to decide what to do next based on system health. This script reads the meta-signals snapshot (produced by `calculate-meta-signals.js`) and generates ranked suggestions with reasons and confidence scores.

This is a **dry-run / preview-only** tool. It never creates GitHub issues or mutates external state. All output is machine-readable JSON for WebUI consumption.

## Command

```bash
# Show help
node scripts/ai/suggest-next-tasks-from-meta-signals.js --help

# Use default signals path (.github/ai-state/meta-signals.json)
node scripts/ai/suggest-next-tasks-from-meta-signals.js

# Explicit signals path
node scripts/ai/suggest-next-tasks-from-meta-signals.js --signals path/to/meta-signals.json

# Print to stdout (for piping or CI)
node scripts/ai/suggest-next-tasks-from-meta-signals.js --stdout

# Custom output path
node scripts/ai/suggest-next-tasks-from-meta-signals.js --out ./my-suggestions.json
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--signals` | No | `.github/ai-state/meta-signals.json` | Path to the meta-signals JSON snapshot |
| `--out` | No | `.github/ai-state/next-task-suggestions.json` | Output file path |
| `--stdout` | No | false | Print JSON to stdout instead of writing a file |
| `--help` | No | — | Show usage and exit |

## Suggestion Rules

Each signal maps to one suggestion category. Suggestions are generated when a signal exceeds its threshold:

| Signal | Threshold | Category | Trigger |
|--------|-----------|----------|---------|
| `failureScore` | > 0 | `failure` | Any red-state health entries |
| `frictionScore` | > 30 | `friction` | Significant stale/silent workers |
| `riskScore` | > 40 | `risk` | Elevated unresolved risk |
| `trust` | < 50 | `trust` | Combined failure+friction eroding confidence |
| `cost` | > 30 | `cost` | Worker-minutes accumulating |
| all healthy | — | `health` | System is healthy, safe to proceed |

## Priority Levels

| Priority | Meaning | When Assigned |
|----------|---------|---------------|
| `critical` | Must address immediately | failureScore ≥ 60, riskScore ≥ 70, trust ≤ 20 |
| `high` | Should address soon | failureScore 30-59, frictionScore ≥ 60, riskScore 40-69, trust 21-50 |
| `medium` | Worth monitoring | failureScore 1-29, frictionScore 31-59, riskScore 41-69, cost ≥ 120 |
| `low` | Background concern | frictionScore 31-59, cost 31-119 |
| `info` | Informational only | System healthy (proceed suggestion) |

## Confidence Scoring

Confidence scales with signal severity within each category's range:

| Category | Range | Scaling |
|----------|-------|---------|
| failure | 40-95 | Linear with failureScore (1→40, 100→95) |
| friction | 35-90 | Linear with frictionScore (1→35, 100→90) |
| risk | 30-90 | Linear with riskScore (1→30, 100→90) |
| trust | 35-90 | Linear with inverse trust (100→35, 0→90) |
| cost | 25-75 | Linear with cost (1→25, 100→75) |
| health | 85 | Fixed when all signals are healthy |

## Sort Order

Suggestions are sorted by:
1. **Priority** (descending): critical > high > medium > low > info
2. **Confidence** (descending): higher confidence first within same priority

## Output Format

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-12T00:30:00.000Z",
  "mode": "dry-run",
  "signals": {
    "failureScore": 25,
    "frictionScore": 45,
    "riskScore": 50,
    "cost": 60,
    "trust": 40,
    "topPain": "runtime compile"
  },
  "suggestionCount": 5,
  "suggestions": [
    {
      "id": "fix-top-pain-area",
      "category": "failure",
      "title": "Investigate and fix failures in runtime compile",
      "reason": "failureScore is 25 with topPain=\"runtime compile\". Recent health checks report red-state entries in this area.",
      "confidence": 54,
      "priority": "high",
      "signalValues": { "failureScore": 25, "topPain": "runtime compile" },
      "actionHint": "Review recent health check logs for red-state entries and address root causes."
    }
  ]
}
```

## Suggestion Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the suggestion type |
| `category` | string | One of: `failure`, `friction`, `risk`, `trust`, `cost`, `health` |
| `title` | string | Human-readable suggestion title |
| `reason` | string | Explanation of why this suggestion was generated |
| `confidence` | integer | 0-100, scales with signal severity |
| `priority` | string | One of: `critical`, `high`, `medium`, `low`, `info` |
| `signalValues` | object | The specific signal values that triggered this suggestion |
| `actionHint` | string | Recommended next step for the operator |

## Safe Skeleton Behavior

When the meta-signals file is missing or unparseable:
- All signal values default to 0 (trust defaults to 100).
- Only the `proceed-with-next-batch` suggestion is generated.
- The script never throws on missing files.

## Integration

```
calculate-meta-signals.js
        |
        v
.github/ai-state/meta-signals.json
        |
        v
suggest-next-tasks-from-meta-signals.js   (this script)
        |
        v
.github/ai-state/next-task-suggestions.json
        |
        v
WebUI / planning console   (reads suggestions for display)
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Suggestions produced |
| 2 | Invalid arguments |

## Tests

```bash
node scripts/ai/suggest-next-tasks-from-meta-signals.test.js
```

Covers: signal threshold boundaries, confidence scaling, priority assignment, sort order, safe skeleton behavior, output structure, and subprocess integration.
