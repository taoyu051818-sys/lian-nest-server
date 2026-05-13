# Operational Entropy Calculator

Deterministic calculator that measures operational friction across five
entropy sources and a companion suggestion engine that proposes bounded
reduction tasks.

> **See also:**
> [meta-signals.md](meta-signals.md) for the related health/friction
> signal calculator,
> [constitutional-drift-taxonomy.md](constitutional-drift-taxonomy.md)
> for drift classification,
> [gap-to-issue-reducer.md](gap-to-issue-reducer.md) for converting
> signals into issue proposals.

---

## Problem

The control plane accumulates friction from state drift, PR rejections,
main-branch red episodes, documentation conflicts, and token overruns.
Without a normalized entropy score, the planning loop cannot prioritize
reduction work or detect when operational health is degrading.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/ai/calculate-operational-entropy.js` | Reads NDJSON logs and produces a normalized entropy snapshot |
| `scripts/ai/suggest-entropy-reduction-tasks.js` | Reads the entropy snapshot and proposes bounded reduction tasks |

Both are dry-run / preview-only tools. Neither creates GitHub issues or
mutates external state.

---

## Entropy Sources

| Source | Weight | Input | Description |
|--------|--------|-------|-------------|
| `stateDrift` | 25 | `--stateDriftLog` | Reconciliation drift detections |
| `prRejection` | 20 | `--prRejectionLog` | PR rejection events |
| `mainRed` | 30 | `--mainRedLog` | Main branch health red events |
| `docsConflict` | 10 | `--docsConflictLog` | Documentation conflict detections |
| `tokenOverrun` | 15 | `--tokenOverrunLog` | Token budget overrun events |

### Severity Multipliers

| Severity | Multiplier |
|----------|------------|
| `critical` | 2.0 |
| `high` | 1.5 |
| `medium` | 1.0 |
| `low` | 0.5 |
| `info` | 0.1 |

### Scoring Formula

Each source score: `clamp(sum(weight * severityMultiplier per entry), 0, 100)`

Overall entropy: `clamp(round((sum of source scores / 500) * 100), 0, 100)`

---

## calculate-operational-entropy.js

### Usage

```bash
node scripts/ai/calculate-operational-entropy.js --help
node scripts/ai/calculate-operational-entropy.js
node scripts/ai/calculate-operational-entropy.js --stateDriftLog drift.ndjson
node scripts/ai/calculate-operational-entropy.js --mainRedLog main-red.ndjson --stdout
node scripts/ai/calculate-operational-entropy.js --out ./custom-path.json
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--stateDriftLog` | No | null | NDJSON with state drift entries |
| `--prRejectionLog` | No | null | NDJSON with PR rejection entries |
| `--mainRedLog` | No | null | NDJSON with main-red health entries |
| `--docsConflictLog` | No | null | NDJSON with docs conflict entries |
| `--tokenOverrunLog` | No | null | NDJSON with token overrun entries |
| `--out` | No | `.github/ai-state/operational-entropy.json` | Output path |
| `--stdout` | No | false | Print JSON to stdout |
| `--help` | No | — | Show usage and exit |

### Output

```json
{
  "snapshotVersion": 1,
  "calculatedAt": "2026-05-13T12:00:00.000Z",
  "inputSources": {
    "stateDriftLog": "drift.ndjson",
    "entryCounts": { "stateDrift": 3, "prRejection": 0, "mainRed": 1, "docsConflict": 0, "tokenOverrun": 0 }
  },
  "entropy": 28,
  "sourceScores": { "stateDrift": 45, "prRejection": 0, "mainRed": 60, "docsConflict": 0, "tokenOverrun": 0 },
  "topSources": [
    { "source": "mainRed", "score": 60 },
    { "source": "stateDrift", "score": 45 }
  ],
  "breakdown": { "stateDrift": 43, "prRejection": 0, "mainRed": 57, "docsConflict": 0, "tokenOverrun": 0 }
}
```

### Safe Skeleton

When all input files are missing or empty, the script produces a
zeroed-out snapshot with `entropy: 0` and empty `topSources`. Downstream
consumers never break on absent data.

---

## suggest-entropy-reduction-tasks.js

Reads an entropy snapshot and generates bounded task suggestions for the
planning console. Each suggestion includes risk level, worker class,
allowed file hints, and evidence.

### Usage

```bash
node scripts/ai/suggest-entropy-reduction-tasks.js --help
node scripts/ai/suggest-entropy-reduction-tasks.js
node scripts/ai/suggest-entropy-reduction-tasks.js --entropy path/to/entropy.json
node scripts/ai/suggest-entropy-reduction-tasks.js --stdout
```

### Thresholds

Each entropy dimension has a trigger threshold (0-100 scale):

| Dimension | Threshold | Worker Class | Suggested Action |
|-----------|-----------|--------------|------------------|
| `mainRed` | 30 | `foundation-fix` | Stabilize main branch health gate |
| `prHandoff` | 25 | `docs` | Add handoff guard checks for stalled PRs |
| `workerFriction` | 30 | `foundation-fix` | Reduce stale or silent worker friction |
| `mergeConflict` | 20 | `docs` | Stabilize merge queue and reduce conflict rate |

When all dimensions are below threshold, a single `info`-priority
suggestion is emitted indicating the system is healthy.

### Priority Mapping

| Score Range | Priority |
|-------------|----------|
| `mainRed >= 70` | critical |
| `mainRed >= 50` | high |
| `prHandoff >= 60`, `workerFriction >= 60` | high |
| `mergeConflict >= 50` | high |
| Mid-range | medium |
| Low-range | low |

### Output

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-13T12:00:00.000Z",
  "mode": "dry-run",
  "entropy": { "mainRed": 45, "prHandoff": 10, "workerFriction": 35, "mergeConflict": 5 },
  "suggestionCount": 2,
  "suggestions": [
    {
      "id": "health-gate-stabilize",
      "category": "mainRed",
      "title": "Stabilize main branch health gate",
      "reason": "mainRed entropy is 45 (threshold 30).",
      "confidence": 65,
      "priority": "medium",
      "risk": "low",
      "workerClass": "foundation-fix",
      "allowedFiles": ["scripts/ai/write-main-health-state.ps1", "..."],
      "evidence": { "mainRed": 45, "threshold": 30, "signal": "main-branch-health" },
      "actionHint": "Run health gate, diagnose root cause..."
    }
  ]
}
```

---

## Integration

```
NDJSON log files (state drift, PR rejection, etc.)
        |
        v
calculate-operational-entropy.js
        |
        v
.github/ai-state/operational-entropy.json
        |
        v
suggest-entropy-reduction-tasks.js
        |
        v
.github/ai-state/entropy-reduction-tasks.json
        |
        v
Planning console / Command Steward
```

---

## Tests

```bash
node scripts/ai/calculate-operational-entropy.test.js
node scripts/ai/suggest-entropy-reduction-tasks.test.js
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Snapshot or suggestions produced |
| 2 | Invalid arguments |

## References

- [Meta Signals](meta-signals.md) — Related health/friction calculator
- [Constitutional Drift Taxonomy](constitutional-drift-taxonomy.md) —
  Drift classification
- [Gap-to-Issue Reducer](gap-to-issue-reducer.md) — Converting signals
  to issue proposals
