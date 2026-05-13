# Investigation: Pluggable Checkers Architecture

**Issue:** #1448
**Date:** 2026-05-13
**Status:** Research complete — findings below

---

## Current State

Constitution checking is split across three independent scripts with no shared registry, no plugin interface, and no configuration-driven check selection.

### Scripts

| Script | Lines | Check Functions | Has Tests |
|--------|-------|----------------|-----------|
| `scripts/ai/check-constitution-health.js` | 1020 | 14 (3 Laws + 3 Seed Rules + 8 Runtime Health) | No |
| `scripts/guards/check-constitution.js` | 280 | 5 (structural section validation) | Yes |
| `scripts/guards/check-constitution-steward.js` | 300 | 5 pattern categories (22 regex rules) | Yes |

### Hardcoded Thresholds in `check-constitution-health.js`

All thresholds are inline constants with no external config surface:

| Category | Thresholds |
|----------|-----------|
| State file TTLs | active-workers: 60m, local-resource: 10m, meta-signals: 30m, provider-pool: 60m, operational-entropy: 30m, risk-signals: 60m |
| Trust scores | violation < 30, warning < 60 |
| Failure/friction | failure >= 50, friction >= 30 |
| Memory | violation > 90%, warning > 75% |
| Process headroom | warning < 20% |
| Provider capacity | warning > 80% |
| Worker lifecycle | orphan: 30m, long-running: 10m |
| PR staleness | 7 days |
| Loop staleness | 24 hours |
| Git windows | evidence: 7d, high-risk: 24h |

### Schema Divergence

- `check-constitution-health.js` produces ad-hoc JSON with `decision`, `checks[]`, `violations[]`, `warnings[]`
- `check-constitution.js` produces `{ ok, sections, mismatches }`
- `schemas/constitution-check-result.schema.json` defines a formal schema with `checkId`, `checkType`, `lawsEvaluated`, `proposedAmendments` — neither script fully conforms to it

---

## Plugin Architecture Design

### Standard Check Interface

Each check module would export:

```js
module.exports = {
  id: 'state-file-staleness',
  category: 'runtime-health',       // three-laws | seed-rules | runtime-health | sop
  description: 'State files within TTL',
  lawsEvaluated: [],                 // which constitutional laws this check relates to
  configKeys: ['ttlMinutes'],       // which config keys this check reads
  check(ctx, config) {
    // ctx: { stateDir, gitLog, workers, mainHealth, ... }
    // config: resolved thresholds for this check
    return {
      decision: 'pass' | 'violation' | 'warning',
      findings: [{ message, severity, evidence }]
    };
  }
};
```

### Registry

A registry module would:
1. Discover check modules from a `checks/` directory (or explicit manifest)
2. Load external config (JSON file) and merge with defaults
3. Run checks in order, collecting results
4. Produce output conforming to `schemas/constitution-check-result.schema.json`

### Config File Surface

```json
{
  "$schema": "../schemas/constitution-check-config.schema.json",
  "version": 1,
  "checks": {
    "state-file-staleness": {
      "enabled": true,
      "ttlMinutes": {
        "active-workers": 60,
        "local-resource": 10,
        "meta-signals": 30,
        "provider-pool": 60,
        "operational-entropy": 30,
        "risk-signals": 60
      }
    },
    "meta-signals-vitality": {
      "enabled": true,
      "trustViolation": 30,
      "trustWarning": 60,
      "failureThreshold": 50,
      "frictionThreshold": 30
    }
  }
}
```

---

## Findings and Recommendation

### What works today

- `check-constitution-health.js` is functionally comprehensive — 14 checks covering all three constitutional layers
- The two guard scripts (`check-constitution.js`, `check-constitution-steward.js`) have tests and are well-bounded
- `schemas/constitution-check-result.schema.json` already defines a formal output schema that could serve as the target contract

### What doesn't work

- **No configurability:** Tuning any threshold requires editing source code and redeploying
- **No test coverage** on the main health checker (1020 lines, 0 tests)
- **Three scripts, three output formats:** No unified runner or result aggregation
- **Schema debt:** The formal schema exists but nothing conforms to it
- **No check discovery:** Adding a new check requires editing the monolith

### Actionable next steps (in priority order)

1. **Extract thresholds to a config file** — Lowest risk, highest immediate value. Create `config/constitution-check-defaults.json` with all hardcoded constants. Update `check-constitution-health.js` to read from it with fallback to current defaults. Zero behavior change, full configurability.

2. **Add tests for `check-constitution-health.js`** — The 1020-line monolith has zero test coverage. Before any refactoring, add tests that capture current behavior for each check function. Use the same self-contained pattern as the guard tests.

3. **Align output with formal schema** — Make `check-constitution-health.js` conform to `schemas/constitution-check-result.schema.json`. This unblocks downstream consumers and validates the schema is fit for purpose.

4. **Extract checks into a `checks/` directory** — Each check becomes a module with the standard interface. The monolith becomes a thin runner that loads from the registry. This is the actual plugin architecture step, but it's safe only after steps 1-3.

### Risk assessment

- Steps 1-3 are low risk (config extraction, test addition, schema alignment)
- Step 4 is medium risk (structural refactor of a production-critical script with no tests)
- The issue title says "investigate" — this document completes that investigation
- Full plugin architecture implementation should be a separate issue, gated on steps 1-3
