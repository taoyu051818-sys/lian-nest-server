# Command Steward Issue-Production Recommendations

Defines the issue-production slice of the Command Steward brief.
Surfaces ready issue count, active workers, top-up gap, and
recommended issue-production action so the Steward can decide
when to produce more issues.

> **Closes:** [#1331](https://github.com/taoyu051818-sys/lian-nest-server/issues/1331)
>
> **See also:**
> [command-steward-brief-contract.md](command-steward-brief-contract.md)
> for the full brief field table,
> [command-steward-decision-table.md](command-steward-decision-table.md)
> for the state-to-action decision table,
> [detect-launch-candidates.js](../../scripts/ai/detect-launch-candidates.js)
> for the launch candidate detector that produces `launch-candidates.json`.

---

## Problem

The self-cycle runner could request 30 parallel workers but only
had 5 executable issues available. Without visibility into the
issue pool, the Steward could not detect this shortage or recommend
issue production. This gap kept Codex in the task-production loop,
blocking the Codex exit objective.

---

## Data Flow

```
detect-launch-candidates.js
       │
       ▼
launch-candidates.json ──────┐
                             │
active-workers.json ─────────┤
                             ▼
              emit-command-steward-brief.js
                             │
                             ▼
              command-steward-brief.json
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
     issueProductionSummary          operatorBrief.issueProduction
```

### Input: `launch-candidates.json`

Produced by `detect-launch-candidates.js`. Contains:

| Field | Type | Description |
|-------|------|-------------|
| `summary.candidateCount` | number | Issues eligible for worker dispatch |
| `summary.totalOpen` | number | Total open issues scanned |
| `summary.excludedCount` | number | Issues excluded by policy |
| `candidates[]` | array | Each candidate with `number`, `title`, `workerClass`, `risk` |

### Input: `active-workers.json`

Provides `requestedParallelism` (how many workers the system wants)
and `workers[]` with per-worker status.

---

## `issueProductionSummary` Section

Added to the Command Steward brief. Fields:

| Field | Type | Description |
|-------|------|-------------|
| `loaded` | boolean | Whether `launch-candidates.json` was available |
| `readyIssueCount` | number | Issues ready for dispatch |
| `totalOpen` | number | Total open issues scanned |
| `excludedCount` | number | Issues excluded by policy |
| `requestedParallelism` | number or null | Workers the system wants |
| `effectiveParallelism` | number or null | Workers that can actually run |
| `activeWorkerCount` | number | Currently running workers |
| `topUpGap` | number or null | `requestedParallelism - readyIssueCount` (positive = deficit) |
| `topUpNeeded` | boolean | True when `topUpGap > 0` |
| `riskBreakdown` | object | `{ low, medium, high }` counts of ready issues by risk |
| `classBreakdown` | object | Counts of ready issues by `workerClass` |
| `lastCycle` | object or null | `{ selectedCandidates, finalStatus }` from last self-cycle run |
| `recommendation` | string | Human-readable recommendation |

### Top-Up Logic

| Scenario | `topUpNeeded` | `topUpGap` | Recommendation |
|----------|---------------|------------|----------------|
| No launch data | false | null | Run `detect-launch-candidates` |
| `readyIssueCount >= requestedParallelism` | false | <= 0 | Pool sufficient |
| `readyIssueCount < requestedParallelism`, gap <= 10 | true | 1-10 | "Top up with N more issues" |
| `readyIssueCount < requestedParallelism`, gap > 10 | true | >10 | "Critical gap: produce at least N more issues" |
| `readyIssueCount === 0` | true | requestedParallelism | "No ready issues. Produce immediately." |

---

## Blockers

When `topUpNeeded` is true, a blocker is added:

| Gap | Severity | Source |
|-----|----------|--------|
| > 10 | `high` | `issue-production` |
| 1-10 | `medium` | `issue-production` |

---

## Recommended Actions

| Condition | Action | Priority | Human Required |
|-----------|--------|----------|----------------|
| No ready issues, parallelism requested | `produce-issues` | urgent | yes |
| Gap > 10 | `produce-issues` | high | yes |
| Gap 1-10 | `top-up-issues` | medium | no |
| No launch data | `run-launch-candidate-detection` | low | no |

---

## Operator Brief

The `operatorBrief.issueProduction` field provides a one-line
human-readable summary:

- `"5 ready issues. Top-up needed: gap of 25."`
- `"10 ready issues. Pool sufficient."`
- `"Issue production data unavailable."`

---

## Validation

| Check | Command | Expected |
|-------|---------|----------|
| Self-test | `node scripts/ai/emit-command-steward-brief.js --self-test` | Exit 0 |
| Focused tests | `node scripts/ai/emit-command-steward-brief.test.js` | Exit 0 |
| TypeScript check | `npm run check` | Exit 0 |

---

## Cross-References

- [Command Steward Brief Contract](command-steward-brief-contract.md) — Full brief field table
- [Command Steward Decision Table](command-steward-decision-table.md) — State-to-action mappings
- [Command Steward Agent](command-steward-agent.md) — Role definition
- [Detect Launch Candidates](../../scripts/ai/detect-launch-candidates.js) — Produces `launch-candidates.json`
- [Propose Self-Cycle Issues](../../scripts/ai/propose-self-cycle-issues.js) — Issue proposal generator
- [Write Planned Issues](../../scripts/ai/write-planned-issues.ps1) — Issue creation script
- [Issue Lifecycle](issue-lifecycle.md) — Issue states and labels
- [Issue Producer Run Ledger](issue-producer-run-ledger.md) — Production audit trail
