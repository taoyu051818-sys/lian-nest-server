# Spending Ledger

Append-only NDJSON log that records worker token, time, cost, provider, and
budget events.

> **File:** `.github/ai-state/spending-ledger.ndjson`
> **Schema:** `schemas/spending-ledger.schema.json`
> **Writer:** `scripts/ai/write-spending-ledger.js`
> **Format:** NDJSON
> **Related issue:** `#1294`

## Purpose

The spending ledger is the resource-accounting companion to worker telemetry.
It records:

- Which worker spent resources: `taskId`, `issueNumber`, `agentId`, `role`
- Which provider carried the work: `providerAlias`, `model`
- What was spent: token counts, elapsed wall-clock time, estimated cost
- Which budget threshold was in play: token, time, or cost budgets

The ledger is append-only and dry-run-first. Scripts preview entries by default
and only append when `--live` is explicitly passed.

## Event Types

| Event Type | Meaning |
|------------|---------|
| `start` | Task launched and provider assignment is known. |
| `checkpoint` | Intermediate resource snapshot during execution. |
| `complete` | Final resource snapshot after task completion. |
| `budget-warning` | Budget crossed a warning threshold. |
| `budget-critical` | Budget crossed a critical threshold. |

## Entry Shape

```jsonc
{
  "schemaVersion": 1,
  "entryId": "uuid",
  "recordedAt": "2026-05-12T10:00:00Z",
  "taskId": "wave16-issue-1294-worker-001",
  "issueNumber": 1294,
  "prNumber": 1305,
  "agentId": "claude-sonnet-4-6",
  "role": "telemetry-budget-worker",
  "providerAlias": "anthropic-primary",
  "model": "claude-sonnet-4-6",
  "eventType": "budget-warning",
  "elapsedMs": 180000,
  "tokenUsage": {
    "inputTokens": 2400,
    "outputTokens": 800,
    "source": "actual",
    "confidence": "actual"
  },
  "estimatedCost": {
    "amountCents": 9,
    "currency": "USD",
    "pricingBasis": "api-list",
    "model": "claude-sonnet-4-6"
  },
  "budget": {
    "kind": "cost",
    "limit": 10,
    "used": 9,
    "unit": "cents",
    "state": "warning",
    "percentUsed": 90
  },
  "description": "cost budget crossed warning threshold",
  "meta": null
}
```

## Design Notes

- The spending ledger is an event stream, not a snapshot file.
- Cost remains an estimate, not a billing fact.
- Token source and confidence follow the same `actual` / `estimated` /
  `unknown` contract used by worker telemetry.
- Budget snapshots are required for `budget-warning` and `budget-critical`
  events so downstream consumers can reason about why the threshold fired.

## Usage

```bash
# Preview a checkpoint entry
node scripts/ai/write-spending-ledger.js \
  --task-id wave16-issue-1294-worker-001 \
  --issue 1294 \
  --agent-id claude-sonnet-4-6 \
  --provider anthropic-primary \
  --event checkpoint \
  --desc "mid-task spend snapshot" \
  --input-tokens 2400 \
  --output-tokens 800 \
  --token-source actual \
  --token-confidence actual \
  --cost-cents 9 \
  --pricing-basis api-list

# Record a budget warning
node scripts/ai/write-spending-ledger.js \
  --task-id wave16-issue-1294-worker-001 \
  --issue 1294 \
  --agent-id claude-sonnet-4-6 \
  --provider anthropic-primary \
  --event budget-warning \
  --desc "token budget crossed warning threshold" \
  --budget-kind token \
  --budget-limit 10000 \
  --budget-used 8600 \
  --budget-unit tokens \
  --budget-state warning \
  --budget-percent 86 \
  --live

# Run focused validation
node scripts/ai/write-spending-ledger.js --self-test
node scripts/ai/write-spending-ledger.test.js
```

## Relationship to Existing Facts

- `write-worker-telemetry-event.js` records sanitized lifecycle telemetry events.
- `spending-ledger.ndjson` provides a dedicated resource-accounting stream for
  token, time, cost, provider, and budget events.
- `token-time-fact-layer.md` remains the source of truth for actual versus
  estimated semantics.
