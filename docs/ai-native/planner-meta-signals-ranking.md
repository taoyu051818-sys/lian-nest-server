# Planner Meta-Signals Ranking

Teaches `plan-next-batch.ps1` to consume the meta-signals snapshot when ranking
candidate tasks for the next worker batch.

## Purpose

The meta-signals snapshot (produced by `calculate-meta-signals.js`) captures
recent failure, friction, and trust data from health checks and worker
heartbeats. The planner reads this snapshot and uses two signals to adjust
candidate ranking:

1. **Trust score** — lower trust increases a risk penalty, demoting
   higher-risk tasks when the system is unhealthy.
2. **Top pain** — tasks whose conflict group or title matches the top pain
   category are demoted by a fixed offset.

This makes the planner risk-aware: when recent batches show high failure or
friction, the planner prefers lower-risk work and avoids tasks in the area
that is currently failing.

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `-MetaSignalsPath` | No | `.github/ai-state/meta-signals.json` | Path to the meta-signals JSON snapshot |

All existing parameters (`-IssueLabel`, `-Repo`, `-MatrixPath`, `-MaxTasks`,
`-Json`, `-Help`) are unchanged.

## Ranking Algorithm

### Composite Score

Each candidate receives a composite score used for sorting:

```
compositeScore = riskRank + trustPenalty
```

Where:
- `riskRank`: low=0, medium=1, high=2
- `trustPenalty`: `(100 - trust) / 50` — ranges from 0 (full trust) to 2 (zero trust)

### Pain Demotion

During sort, if the candidate's conflict group or title contains a keyword from
`topPain` (split on spaces and `/`), an additional +2 offset is applied to its
sort key. This pushes pain-area tasks below equivalent-risk tasks in other
areas.

### Sort Order

1. Readiness: ready before blocked
2. Composite score + pain demotion: lower score first
3. Issue number: ascending (tiebreaker)

### Backward Compatibility

When the meta-signals file is missing or unparseable:
- `trust` defaults to 100 (full trust, no penalty)
- `topPain` defaults to `"none"` (no demotion)
- Ranking falls back to the original risk-only behavior

## Console Output

When meta-signals are loaded, the planner prints a summary section:

```
  Meta-Signals:
    trust: 55  failure: 45  friction: 30  topPain: runtime compile
    pain keywords: runtime, compile — matching tasks demoted
```

Each candidate also shows its `compositeScore`:

```
  #123  [medium]  tool-planner  ready
    Fix compile guard
    type=execution  role=ai-native-tooling-worker
    allowed: scripts/ai/**
    compositeScore: 1.9
```

## JSON Output

When `-Json` is used, the output includes two additional fields:

```json
{
  "metaSignals": { "failureScore": 45, "frictionScore": 30, "riskScore": 20, "cost": 12, "trust": 55, "topPain": "runtime compile" },
  "painKeywords": ["runtime", "compile"]
}
```

## Dry-Run Validation

```bash
# Show help (includes -MetaSignalsPath)
pwsh ./scripts/ai/plan-next-batch.ps1 -Help

# Dry-run with default meta-signals path
pwsh ./scripts/ai/plan-next-batch.ps1 -Repo owner/name

# Dry-run with explicit meta-signals path
pwsh ./scripts/ai/plan-next-batch.ps1 -Repo owner/name -MetaSignalsPath ./custom-signals.json

# JSON output for CI
pwsh ./scripts/ai/plan-next-batch.ps1 -Repo owner/name -Json
```

## Integration

```
calculate-meta-signals.js
        |
        v
.github/ai-state/meta-signals.json
        |
        v
plan-next-batch.ps1   (reads signals, adjusts ranking)
        |
        v
Proposed batch plan   (console or JSON)
```
