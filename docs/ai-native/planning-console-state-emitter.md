# Planning Console State Emitter

> **Issue:** #687
> **File:** `scripts/ai/emit-planning-console-state.js`
> **Output:** `.github/ai-state/planning-console-state.json`

Read-only projection that aggregates gap ledger events, meta-signals, active
workers, worker trust, and queue state into a single JSON snapshot for the
WebUI Planning Console.

## Purpose

The Planning Console needs a consolidated view of gap discovery data to show
operators where the planning loop has deviated from expectations. This emitter
reads existing state files, computes gap summaries and trends, and produces a
sanitized JSON snapshot that the WebUI can consume without touching raw NDJSON
or internal state files.

## Command

```bash
# Dry-run preview (default)
node scripts/ai/emit-planning-console-state.js

# Write snapshot to file
node scripts/ai/emit-planning-console-state.js --live

# Print JSON to stdout (no banner)
node scripts/ai/emit-planning-console-state.js --stdout

# Custom output path
node scripts/ai/emit-planning-console-state.js --live --out /tmp/planning.json

# Show help
node scripts/ai/emit-planning-console-state.js --help

# Run built-in self-test
node scripts/ai/emit-planning-console-state.js --self-test
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|:--------:|---------|-------------|
| `--live` | no | — | Write the snapshot to the output file. Without this flag, dry-run mode prints a preview. |
| `--out <path>` | no | `.github/ai-state/planning-console-state.json` | Output path for the JSON snapshot. |
| `--stdout` | no | — | Print JSON to stdout without banner. Overrides dry-run display. |
| `--self-test` | no | — | Run built-in assertions and exit. |
| `--help` | no | — | Show usage and exit. |

## Input Files

All inputs are optional. Absent files produce null/empty defaults.

| File | Format | Description |
|------|--------|-------------|
| `.github/ai-state/gap-ledger.ndjson` | NDJSON | Append-only gap events from the planning loop. |
| `.github/ai-state/meta-signals.json` | JSON | Aggregate health signals (failure, friction, risk, trust). |
| `.github/ai-state/active-workers.json` | JSON | Currently in-flight workers. |
| `.github/ai-state/worker-trust.json` | JSON | Worker trust scores and scheduling rules. |
| `.github/ai-state/queue-state.json` | JSON | Queue lifecycle entries and summary. |

## Output Schema

```jsonc
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "gapSummary": {
    "total": 0,
    "byType": {
      "worker-failed": 0,
      "worker-stale": 0,
      "health-gate-fail": 0,
      "launch-blocked": 0,
      "plan-drift": 0,
      "stale-row": 0
    },
    "bySeverity": { "low": 0, "medium": 0, "high": 0, "critical": 0 }
  },
  "unresolvedGaps": {
    "count": 0,
    "bySeverity": { "low": 0, "medium": 0, "high": 0, "critical": 0 },
    "entries": []           // sanitized (no meta field)
  },
  "recentGaps": {
    "count": 0,
    "windowHours": 24,
    "entries": []           // sanitized, within last 24h
  },
  "trend": {
    "total7d": 0,
    "total30d": 0,
    "byType7d": { /* gap type counts for last 7 days */ }
  },
  "planningHealth": {       // null when meta-signals absent
    "failureScore": 0,
    "frictionScore": 0,
    "riskScore": 0,
    "trust": 100,
    "topPain": "none"
  },
  "activeWorkers": { "count": 0 },
  "workerTrust": {          // null when worker-trust absent
    "minTrustToLaunch": 0,
    "highTrustThreshold": 0,
    "ruleCount": 0
  },
  "queue": {
    "entryCount": 0,
    "summary": null         // null when queue-state absent
  },
  "inputSources": {
    "gapLedgerLoaded": false,
    "metaSignalsLoaded": false,
    "activeWorkersLoaded": false,
    "workerTrustLoaded": false,
    "queueLoaded": false
  }
}
```

### Gap Entry Sanitization

Gap entries in `unresolvedGaps.entries` and `recentGaps.entries` are sanitized:
- The `meta` field is stripped to prevent secret leakage.
- Only safe fields are kept: `gapType`, `severity`, `description`, `recordedAt`, `issue`, `pr`, `branch`.

### Unresolved Gap Heuristic

Gaps are considered unresolved when their type suggests an open problem:
- `worker-failed`, `worker-stale`, `health-gate-fail`, `launch-blocked` are unresolved.
- `plan-drift`, `stale-row` are considered terminal/handled.

When multiple gaps exist for the same issue number, only the most recent one is
counted as unresolved.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Snapshot produced (or self-test passed). |
| 2 | Invalid arguments. |

## Integration

```
gap-ledger.ndjson             (written by write-gap-ledger.js)
meta-signals.json             (written by calculate-meta-signals.js)
active-workers.json           (written by state reconciler)
worker-trust.json             (written by state reconciler)
queue-state.json              (written by queue manager)
        |
        v
emit-planning-console-state.js    <-- this script
        |
        v
planning-console-state.json       (consumed by WebUI Planning Console)
```

The emitter is a pure read-only projection. It never mutates its inputs and
produces a self-contained snapshot that the WebUI can render without accessing
the underlying NDJSON or state files.

## Design Decisions

- **Read-only projection**: No writes to input files. The output is a new JSON snapshot.
- **Safe skeleton**: Missing or malformed inputs produce null/empty defaults, never errors.
- **Secret sanitization**: The `meta` field from gap entries is stripped in all output arrays.
- **Dry-run default**: Consistent with the project convention — preview without writing.
- **Schema versioning**: `schemaVersion` allows future evolution without breaking consumers.
- **Unresolved heuristic**: Conservative — treats non-terminal gap types as unresolved. Operators can refine based on context.

## References

- [Gap Ledger](gap-ledger.md) — Append-only gap event writer.
- [Gap Ledger Schema](gap-ledger-schema.md) — JSON schema for gap entries.
- [Meta Signals](meta-signals.md) — Aggregate health signal calculator.
- [Planning Loop](planning-loop.md) — Dry-run planner that detects gaps.
- [Dashboard State Emitter](control-plane-dashboard-state-actions.md) — Related dashboard projection.
