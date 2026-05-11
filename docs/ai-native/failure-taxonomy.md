# Failure Taxonomy

Deterministic classification categories for post-merge health gate failures.
Used by `scripts/ai/classify-health-failure.js` to drive self-healing follow-up issue generation.

## Categories

| Category | Severity | Health State | Description |
|---|---|---|---|
| `dependency/generate` | Red (critical) | red | Missing or stale dependencies, Prisma client not generated, npm install/CI failures |
| `runtime compile` | Red (critical) | red | TypeScript type errors, build failures, missing source modules |
| `boundary guard` | Yellow (non-critical) | yellow | Repository boundary violations (data-store imports outside allowed paths) |
| `docs guard` | Yellow (non-critical) | yellow | Documentation authority violations, outdated or missing required docs |
| `unknown` | Red (conservative) | red | No known pattern matched; requires manual triage |

## Severity Mapping

- **Red** — blocks all non-recovery workers. Requires a recovery worker to fix before normal launches resume.
- **Yellow** — limits workers to fix-only and docs types. Does not block the pipeline entirely.
- **Unknown** — treated as red (conservative). Manual triage determines the actual category.

## Pattern Matching

Classification is deterministic and rule-based. Each category has a set of regex patterns matched against the combined stdout+stderr of a failed check. The category with the most matching patterns wins; ties are broken by definition order.

Confidence levels:
- **high** — 3+ patterns matched
- **medium** — 2 patterns matched
- **low** — 1 pattern matched

## Relationship to Existing Categories

The existing `post-merge-health-gate.js` uses six inline categories. This taxonomy consolidates them:

| Existing Category | Mapped To |
|---|---|
| `dependency/generate` | `dependency/generate` |
| `database foundation` | `dependency/generate` |
| `runtime compile` | `runtime compile` |
| `conflict refresh` | `runtime compile` |
| `test env` | `unknown` (requires triage) |
| `boundary guard` | `boundary guard` |
| (not present) | `docs guard` (new) |

## Usage

```bash
# Classify from a file
node scripts/ai/classify-health-failure.js --file failure-output.txt

# Classify from stdin
npm run check 2>&1 | node scripts/ai/classify-health-failure.js

# Classify a string directly
node scripts/ai/classify-health-failure.js --text "error TS2345: Argument of type..."

# Show help
node scripts/ai/classify-health-failure.js --help
```

## Output Format

```json
{
  "category": "runtime compile",
  "matchedPatterns": ["error TS\\d+:"],
  "confidence": "low",
  "allMatches": {
    "runtime compile": ["error TS\\d+:"]
  }
}
```
