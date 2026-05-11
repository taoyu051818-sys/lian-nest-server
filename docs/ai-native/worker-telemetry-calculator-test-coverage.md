# Worker Telemetry Calculator Test Coverage

**Test file:** `scripts/ai/calculate-worker-telemetry.test.js`
**Target:** `scripts/ai/calculate-worker-telemetry.js`

## Coverage Summary

| Area | Tests | Status |
|------|-------|--------|
| Missing manifests (no inputs) | 21 | passing |
| Estimated token source (default + overrides) | 21 | passing |
| Sanitized output (no secrets/logs) | 13 | passing |
| Task contract budget and identity | 12 | passing |
| Full integration (all inputs) | 17 | passing |
| File output (--out) | 3 | passing |
| **Total** | **87** | **passing** |

## Test Areas

### 1. Missing Manifests

When no task contract, heartbeat, or result file is provided, the calculator produces a zeroed-out default record. Tests verify:

- `schemaVersion` is 1
- `taskId` falls back to `unknown-` prefix
- All identity fields (`taskType`, `actorRole`, `pmPhase`, `issueNumber`, `prNumber`) are null
- `timing.elapsedMs` is 0, budget fields are null
- `changedFiles` is zeroed out (count=0, linesAdded=0, linesRemoved=0)
- `validationResults` is empty array, `qualitySignals` is null
- `gateOutcome.passed` defaults to false

### 2. Estimated Token Source

Token usage defaults to `estimate`/`low` when no source is available. Tests verify:

- Default: `source: "estimate"`, `confidence: "low"`, zero token counts, `pricingBasis: "unknown"`
- With `log_parse` source in result: `pricingBasis: "estimated"`, cost > 0
- With `api_response` source in result: `pricingBasis: "api_list"`, `cachedInputTokens` and `apiCalls` preserved

### 3. Sanitized Output

Output never contains secrets or raw worker data. Tests verify:

- No `GITHUB_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` values in JSON
- No `sk-ant-` or `ghp_` key prefixes
- No `llm_io_logs` references
- Arbitrary `secret` and `apiKey` fields from task contract are NOT present in output
- Heartbeat `token` field is NOT leaked into output

### 4. Task Contract Budget and Identity

When a task contract is provided, identity and budget fields are correctly mapped. Tests verify:

- `taskId`, `taskType`, `actorRole`, `pmPhase`, `issueNumber`, `prNumber` from contract
- `timing.softTimeMinutes` and `hardTimeMinutes` from budget
- `changedFiles.maxBudget` from `budgets.maxFiles` (or `budget.maxFiles`)
- Both `budget` (singular) and `budgets` (plural) aliases work

### 5. Full Integration

All three inputs combined. Tests verify end-to-end field mapping from task contract, heartbeat, and result file.

### 6. File Output

The `--out` flag writes a valid JSON file to disk.

## Running

```bash
node scripts/ai/calculate-worker-telemetry.test.js
```
