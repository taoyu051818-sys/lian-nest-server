# Meta-Signal Memory — Structured Retrieval Layer

Adds a MemGPT-style tiered memory retrieval layer on top of historical meta-signals snapshots, enabling the issue producer to focus on the most impactful gaps through relevance ranking.

> **Script:** [`scripts/ai/calculate-meta-signal-memory.js`](../../scripts/ai/calculate-meta-signal-memory.js)
> **Schema:** [`schemas/meta-signal-memory.schema.json`](../../schemas/meta-signal-memory.schema.json)
> **Closes:** [#1371](https://github.com/taoyu051818-sys/lian-nest-server/issues/1371)

---

## Purpose

The current `meta-signals.json` is a flat snapshot of six signals. This script reads a directory of historical snapshots and organizes them into three memory tiers with relevance ranking, inspired by MemGPT's tiered memory architecture:

| Tier | Purpose | Content |
|------|---------|---------|
| **Working** | Immediate decision-making | Most recent N snapshots, ranked by relevance |
| **Archival** | Historical patterns | Aggregated category patterns with trend detection |
| **Episodic** | Notable events | Trust drops, failure spikes, friction surges, recoveries |

The **relevance ranking** merges entries from all tiers into a single ordered list for issue production focus.

---

## Command

```bash
# Show help
node scripts/ai/calculate-meta-signal-memory.js --help

# Compute from default history directory
node scripts/ai/calculate-meta-signal-memory.js

# Custom history directory
node scripts/ai/calculate-meta-signal-memory.js --historyDir ./my-history/

# Limit working memory window
node scripts/ai/calculate-meta-signal-memory.js --workingWindow 3

# Print to stdout
node scripts/ai/calculate-meta-signal-memory.js --stdout

# Custom output path
node scripts/ai/calculate-meta-signal-memory.js --out ./my-memory.json
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--historyDir` | No | `.github/ai-state/meta-signals-history/` | Directory of historical meta-signals JSON snapshots |
| `--workingWindow` | No | `5` | Number of recent snapshots for working memory |
| `--topGaps` | No | `10` | Number of top gaps in relevance ranking |
| `--out` | No | `.github/ai-state/meta-signal-memory.json` | Output file path |
| `--stdout` | No | `false` | Print JSON to stdout instead of writing a file |
| `--help` | No | — | Show usage and exit |

## Input Format

The history directory should contain JSON files, each conforming to the meta-signals schema (`schemas/meta-signals.schema.json`). Each file must have `calculatedAt` and `signals` fields.

Files are read in lexicographic order. Malformed JSON files are skipped silently.

---

## Memory Tiers

### Working Memory

The most recent N snapshots (controlled by `--workingWindow`), each assigned a relevance score based on:

- **Recency**: Exponential decay with 72-hour half-life. More recent = higher relevance.
- **Severity**: Weighted combination of failureScore, frictionScore, riskScore, and inverse trust.
- **Frequency**: Baseline 1.0 for individual signals.

Each working signal includes a `decayFactor` (0-1) indicating time-based relevance decay.

### Archival Memory

Compressed patterns extracted by grouping snapshots by `topPain` category:

- **Frequency**: How many snapshots had this category as topPain.
- **Trend**: `increasing`, `stable`, or `decreasing` (detected by comparing first-half vs second-half frequency).
- **Average severity**: Mean failureScore across appearances.

Patterns with `topPain: "none"` are excluded.

### Episodic Memory

Notable events detected by comparing consecutive snapshots:

| Episode Type | Trigger |
|--------------|---------|
| `trust-drop` | Trust decreases by >= 15 points |
| `failure-spike` | FailureScore increases by >= 20 points |
| `friction-surge` | FrictionScore increases by >= 25 points |
| `recovery` | Trust increases by >= 15 points when below 50 |
| `anomaly` | High cost (>60 worker-min) with low failure (<10) and low friction (<10) |

Episodes are sorted by significance descending.

---

## Relevance Ranking

The `relevanceRanking` field merges entries from all three tiers into a single ordered list:

1. **Working entries**: Use their computed relevance score.
2. **Archival entries**: Scored by recency, severity, and frequency; boosted 30% if trend is `increasing`, reduced 30% if `decreasing`.
3. **Episodic entries**: Use their significance score directly.

Entries are deduplicated by `sourceTier:category` (highest score wins), sorted by relevance descending, and limited to `--topGaps`.

---

## Relevance Score Formula

```
relevance = (RECENCY_WEIGHT * decayFactor + SEVERITY_WEIGHT * severityComponent + FREQUENCY_WEIGHT * frequencyComponent) * 100
```

Where:
- `RECENCY_WEIGHT = 0.4`
- `SEVERITY_WEIGHT = 0.35`
- `FREQUENCY_WEIGHT = 0.25`
- `decayFactor = 0.5^(ageHours / 72)` (half-life of 72 hours)
- `severityComponent = failureScore*0.3 + frictionScore*0.2 + (100-trust)*0.2 + riskScore*0.3` (normalized 0-1)
- `frequencyComponent = 1.0` for individual signals

---

## Output

```json
{
  "schemaVersion": 1,
  "calculatedAt": "2026-05-13T00:00:00.000Z",
  "inputSources": {
    "snapshotCount": 10,
    "snapshotPaths": ["snapshot-000.json", "snapshot-001.json", "..."]
  },
  "working": {
    "signals": [
      {
        "signalId": "mem-a1b2c3d4",
        "tier": "working",
        "relevanceScore": 72.5,
        "capturedAt": "2026-05-12T18:00:00.000Z",
        "signals": { "failureScore": 45, "frictionScore": 30, "riskScore": 20, "cost": 12, "trust": 55, "topPain": "runtime compile" },
        "decayFactor": 0.917
      }
    ],
    "windowSize": 5,
    "summary": { "avgFailureScore": 35, "avgFrictionScore": 25, "avgTrust": 60, "topPain": "runtime compile", "dominantCategory": "runtime compile" }
  },
  "archival": {
    "patterns": [
      {
        "patternId": "pat-a1b2c3d4",
        "category": "runtime compile",
        "trend": "increasing",
        "frequency": 7,
        "avgSeverity": 38.5,
        "firstSeen": "2026-05-01T00:00:00.000Z",
        "lastSeen": "2026-05-12T18:00:00.000Z"
      }
    ],
    "windowSize": 10,
    "summary": { "..." : "..." }
  },
  "episodic": [
    {
      "episodeId": "ep-e5f6g7h8",
      "type": "trust-drop",
      "description": "Trust dropped 20 points (from 80 to 60). Top pain: runtime compile.",
      "detectedAt": "2026-05-10T12:00:00.000Z",
      "signals": { "..." : "..." },
      "significance": 70
    }
  ],
  "relevanceRanking": {
    "topGaps": [
      {
        "rank": 1,
        "relevanceScore": 82.3,
        "sourceTier": "archival",
        "category": "runtime compile",
        "description": "Historical pattern: \"runtime compile\" seen 7x, trend=increasing, avgSeverity=38.5.",
        "signalRef": "pat-a1b2c3d4"
      }
    ],
    "totalRanked": 5
  }
}
```

---

## Safe Skeleton Behavior

When the history directory is missing or empty:
- `inputSources.snapshotCount` = 0
- Working, archival, and episodic memories are empty
- `relevanceRanking.topGaps` is empty
- The script never throws on missing directories

---

## Integration

```
calculate-meta-signals.js                    (produces per-batch snapshots)
        |
        v
.github/ai-state/meta-signals-history/*.json (accumulated history)
        |
        v
calculate-meta-signal-memory.js              (this script — builds tiered memory)
        |
        v
.github/ai-state/meta-signal-memory.json     (consumed by issue producer)
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Snapshot produced |
| 2 | Invalid arguments |

## References

- [meta-signals.md](meta-signals.md) — Upstream meta-signals calculator
- [meta-signals-schema.md](meta-signals-schema.md) — Meta-signals JSON schema
- [opportunity-signal.schema.json](../../schemas/opportunity-signal.schema.json) — Opportunity signal schema (consumer of relevance ranking)
