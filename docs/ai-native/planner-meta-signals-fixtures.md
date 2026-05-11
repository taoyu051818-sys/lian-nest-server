# Planner Meta-Signals Fixtures

Documents the fixture coverage for `plan-next-batch.ps1` meta-signal ranking
logic, exercised by `scripts/ai/plan-next-batch.meta-signals.test.ps1`.

## Purpose

The test script validates composite-score calculation, pain-keyword demotion,
backward-compatibility defaults, and sort stability — all without calling the
GitHub API. Each fixture isolates one ranking behavior so regressions surface
as targeted failures.

## Fixtures

### Fixture 1 — Full trust, no pain

| Signal     | Value |
|------------|-------|
| trust      | 100   |
| topPain    | none  |

Validates that composite score equals raw risk rank (low=0, medium=1, high=2)
when trust is full and no pain keywords are active.

### Fixture 2 — Zero trust, no pain

| Signal     | Value |
|------------|-------|
| trust      | 0     |
| topPain    | none  |

Validates maximum trust penalty: `(100 - 0) / 50 = 2.0` added to every risk
rank. Low-risk becomes 2, medium becomes 3, high becomes 4.

### Fixture 3 — Mid trust with space-separated pain

| Signal     | Value            |
|------------|------------------|
| trust      | 55               |
| topPain    | runtime compile  |

Validates:
- Trust penalty of 0.9 (`(100 - 55) / 50`).
- Pain keyword splitting on whitespace.
- Conflict-group and title matching against pain keywords.
- Non-matching tasks are unaffected.

### Fixture 4 — Slash-separated pain keywords

| Signal     | Value              |
|------------|--------------------|
| topPain    | dependency/generate |

Validates that pain keywords split on both whitespace and `/`. Produces two
keywords: `dependency` and `generate`.

### Fixture 5 — Missing signals (backward compatibility)

Validates fallback defaults when meta-signals file is absent or unparseable:
- `trust` defaults to 100.
- `topPain` defaults to `"none"`.
- Composite scores fall back to risk-only ranking.
- Pain demotion is disabled.

### Fixture 6 — File round-trip

Writes a fixture JSON to a temp file, reads it back, and confirms all signal
values survive serialization/deserialization intact.

### Fixture 7 — Sort stability (issue-number tiebreaker)

Three candidates with identical composite scores and readiness. Validates that
`Sort-Object` orders them by ascending issue number as the final tiebreaker.

### Fixture 8 — Ready-before-blocked ordering

Mixed readiness candidates with varying composite scores. Validates that all
`ready` candidates appear before any `blocked` candidate regardless of score.

## Running

```bash
pwsh ./scripts/ai/plan-next-batch.meta-signals.test.ps1
```

Exit 0 on all-pass, exit 1 on any failure.

## Relationship to plan-next-batch.ps1

The test replicates the two ranking functions from the planner:

1. **Composite score**: `riskRank + (100 - trust) / 50`
2. **Pain match**: split `topPain` on `[\s/]+`, check if conflict group or
   title contains any keyword (case-insensitive)

These functions are extracted and tested in isolation. The planner itself is
tested via its dry-run mode with live GitHub data; these fixtures cover the
pure logic paths without external dependencies.
