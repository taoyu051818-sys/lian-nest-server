# Meta Signals Calculator — Test Coverage

Self-tests for `scripts/ai/calculate-meta-signals.js` added in issue #446.

## Test file

`scripts/ai/calculate-meta-signals.test.js` — framework-free, runs with `node scripts/ai/calculate-meta-signals.test.js`.

## Coverage summary

| Area | Tests | What is covered |
|------|-------|-----------------|
| failureScore | 6 | Empty input, no red entries, known/unknown/missing category, cap at 100, multi-category accumulation |
| frictionScore | 7 | Empty input, stale (+30), running:no-output (+10), noOutputMs thresholds (60k/300k), cap at 100, exact boundary values |
| riskScore | 5 | Empty input, high/Red (+20), medium/Yellow (+10), low (+0), cap at 100 |
| cost | 4 | Empty input, ms-to-minutes conversion, sum of entries, zero/null/missing elapsedMs |
| trust | 5 | Full failure, full friction, both full (0), clamp below 0, typical moderate values |
| topPain | 4 | Empty, null, single category, multi-category with winner |
| clamp | 3 | Within range, below min, above max |
| integration (subprocess) | 8 | --stdout zeroed snapshot, --help exit 0, unknown arg exit 2, health log scoring, heartbeat friction/cost, combined snapshot, --out file write, malformed NDJSON resilience, nonexistent file path |
| **Total** | **51** | |

## Scenarios from issue #446

- **Missing inputs**: Covered by empty-array unit tests and integration test with no arguments.
- **Empty ledgers**: Covered by zero-entry tests for each metric function and integration `--stdout` with no files.
- **Basic score output**: Covered by integration snapshot structure validation and per-metric unit tests.

## How to run

```bash
node scripts/ai/calculate-meta-signals.test.js
```
