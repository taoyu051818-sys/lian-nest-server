# Telemetry Budget Guard

Validates worker telemetry records against the [telemetry budget policy](telemetry-budget-policy.md) and reports pass/warn/fail decisions.

> **Script:** `scripts/guards/check-telemetry-budget.js`
> **Tests:** `scripts/guards/check-telemetry-budget.test.js`
> **Policy:** `.github/ai-policy/telemetry-budget-policy.json`

---

## Purpose

Workers emit telemetry records (defined by [worker-telemetry.schema.json](../../schemas/worker-telemetry.schema.json)) that capture actual resource consumption. This guard validates those records against the budget policy to detect:

1. **Wall-clock overruns** — elapsed time exceeds soft or hard limits by task type
2. **Token budget overruns** — input/output tokens exceed default budgets by task type
3. **Cost overruns** — estimated cost exceeds warning (80%), critical (100%), or hard-stop (150%) thresholds

The guard is advisory — it reports decisions but does not terminate workers.

---

## Usage

```bash
# Check a telemetry record file
node scripts/guards/check-telemetry-budget.js --file telemetry.json

# Pipe from stdin
cat telemetry.json | node scripts/guards/check-telemetry-budget.js

# Machine-readable JSON output
node scripts/guards/check-telemetry-budget.js --file telemetry.json --json

# Validate record shape only (skip budget checks)
node scripts/guards/check-telemetry-budget.js --file telemetry.json --dry-run

# Downgrade failures to warnings
node scripts/guards/check-telemetry-budget.js --file telemetry.json --warn-only

# Override task type for budget lookup
node scripts/guards/check-telemetry-budget.js --file telemetry.json --task-type docs

# Set explicit cost cap
node scripts/guards/check-telemetry-budget.js --file telemetry.json --max-cost-usd 2.50
```

---

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--file <path>` | Path to a worker telemetry JSON record | stdin |
| `--task-type <type>` | Override task type for budget lookup: `docs`, `execution`, `review` | from record |
| `--max-cost-usd <n>` | Explicit cost cap in USD | derived from token usage |
| `--json` | Print JSON summary to stdout | false |
| `--warn-only` | Downgrade failures to warnings | false |
| `--dry-run` | Validate record shape only, skip budget checks | false |
| `--help, -h` | Show help | |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Pass — all budget checks OK |
| 1 | Violation — budget exceeded or record invalid |
| 2 | Usage error — bad arguments or file not found |

---

## Budget Checks

### Wall-Clock Limits

Compares `timing.elapsedMs` against soft and hard limits from the policy.

| Task Type | Soft Limit | Hard Limit |
|-----------|------------|------------|
| `docs` | 15 min | 30 min |
| `execution` | 45 min | 90 min |
| `review` | 20 min | 40 min |
| default | 30 min | 60 min |

- **Warning** when elapsed > soft limit
- **Violation** when elapsed > hard limit

### Token Budget

Compares `tokenUsage.inputTokens` and `tokenUsage.outputTokens` against default budgets.

| Task Type | Max Input | Max Output |
|-----------|-----------|------------|
| `docs` | 200,000 | 50,000 |
| `execution` | 500,000 | 150,000 |
| `review` | 300,000 | 80,000 |

- **Warning** when usage >= 80% of budget
- **Violation** when usage exceeds budget

### Cost Overrun

Compares `estimatedCost.amountCents` (converted to USD) against a cost budget. The budget is derived from token usage and pricing reference ($3.00/1M input, $15.00/1M output), or from `--max-cost-usd` if provided.

| Threshold | Default | Action |
|-----------|---------|--------|
| Warning | 80% | Log warning |
| Critical | 100% | Violation |
| Hard stop | 150% | Violation |

---

## JSON Output

With `--json`, the guard prints a structured result:

```json
{
  "status": "pass|warn|fail",
  "violations": [],
  "warnings": [],
  "summary": {
    "recordValid": true,
    "taskType": "execution",
    "wallClock": { "elapsedMin": 30, "softLimit": 45, "hardLimit": 90, "softPct": 67, "hardPct": 33 },
    "tokenBudget": { "inputTokens": 100000, "outputTokens": 50000, "maxInputTokens": 500000, "maxOutputTokens": 150000, "inputPct": 20, "outputPct": 33 },
    "cost": { "costUsd": 1.05, "maxCostUsd": 1.05, "pct": 100 }
  }
}
```

---

## Integration

This guard can be wired into:

- **Worker completion hooks** — validate telemetry before publishing
- **Orchestrator post-merge gates** — aggregate telemetry across tasks
- **CI pipelines** — enforce budget compliance on telemetry artifacts

The guard reads policy defaults from the embedded `POLICY` constant, which mirrors `.github/ai-policy/telemetry-budget-policy.json`. No external file reads are required at runtime.

---

## Relationship to Existing Policies

| Policy | Relationship |
|--------|-------------|
| [Telemetry Budget Policy](telemetry-budget-policy.md) | This guard enforces the thresholds defined there |
| [Worker Telemetry Schema](worker-telemetry-schema.md) | Input records must conform to this schema |
| [Worker Task Contract](worker-task-contract.md) | Task type and budget fields from the contract drive budget lookup |
| [Worker Heartbeat](worker-heartbeat.md) | Telemetry records correlate to heartbeat taskId |
