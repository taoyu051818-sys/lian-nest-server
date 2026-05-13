# Pluggable Checkers Investigation

> **Closes:** [#1448](https://github.com/taoyu051818-sys/lian-nest-server/issues/1448)

## Summary

`scripts/ai/check-constitution-health.js` is a 1020-line monolith with 14
check functions, zero plugin infrastructure, no configuration surface for
thresholds, and no test suite. This document inventories the current state,
maps every hardcoded threshold, documents schema divergence, and proposes a
prioritized path to a pluggable architecture.

---

## Current State

| Metric | Value |
|--------|-------|
| File | `scripts/ai/check-constitution-health.js` |
| Lines | 1020 |
| Check functions | 14 |
| Hardcoded thresholds | 23 |
| Tests | 0 |
| Plugin system | None |
| Config surface | None |

### Check Functions

| # | Function | Category | Lines |
|---|----------|----------|-------|
| 1 | `checkRealityBeforeJudgment` | Three Laws | 179-258 |
| 2 | `checkSelectionBeforeMemory` | Three Laws | 262-327 |
| 3 | `checkGovernedRecursion` | Three Laws | 331-418 |
| 4 | `checkHighRiskBoundaries` | Seed Constitution | 422-492 |
| 5 | `checkMainRedLaunchStop` | Seed Constitution | 496-548 |
| 6 | `checkWorkerScopeExpansion` | Seed Constitution | 552-613 |
| 7 | `checkRepositoryBoundary` | SOP | 617-658 |
| 8 | `checkStateFileStaleness` | Runtime Health | 662-690 |
| 9 | `checkMetaSignalsVitality` | Runtime Health | 694-722 |
| 10 | `checkBuildVitality` | Runtime Health | 726-746 |
| 11 | `checkWorkerLifecycleHealth` | Runtime Health | 750-784 |
| 12 | `checkConflictGroupContention` | Runtime Health | 788-806 |
| 13 | `checkPRQueueHealth` | Runtime Health | 810-827 |
| 14 | `checkAutonomousLoopHealth` | Runtime Health | 831-850 |
| 15 | `checkResourcePressure` | Runtime Health | 854-879 |

---

## Hardcoded Thresholds Inventory

Every threshold below is an inline constant. Tuning requires a source edit
and a new commit.

### State File Staleness TTLs (lines 666-673)

| State File | TTL | Hardcoded Value |
|------------|-----|-----------------|
| `active-workers.json` | 60 min | `60 * 60 * 1000` |
| `local-resource.json` | 10 min | `10 * 60 * 1000` |
| `meta-signals.json` | 30 min | `30 * 60 * 1000` |
| `provider-pool.json` | 60 min | `60 * 60 * 1000` |
| `operational-entropy.json` | 30 min | `30 * 60 * 1000` |
| `risk-signals.json` | 60 min | `60 * 60 * 1000` |

### Meta Signals Thresholds (lines 703-719)

| Signal | Threshold | Decision | Line |
|--------|-----------|----------|------|
| `trust` | `< 30` | VIOLATION | 714 |
| `trust` | `< 60` | WARNING | 715 |
| `failureScore` | `>= 50` | VIOLATION | 718 |
| `frictionScore` | `>= 30` | WARNING | 719 |
| All-zero detection | `=== 0` (all four signals) | WARNING | 703 |

### Resource Pressure Thresholds (lines 862-874)

| Resource | Threshold | Decision | Line |
|----------|-----------|----------|------|
| Memory usage | `> 90%` | VIOLATION | 862 |
| Memory usage | `> 75%` | WARNING | 863 |
| Process headroom | `< 20%` | WARNING | 866 |
| Provider utilization | `> 80%` | WARNING | 874 |

### Worker Lifecycle Thresholds (lines 769-782)

| Condition | Threshold | Decision | Line |
|-----------|-----------|----------|------|
| Orphaned worker age | `> 30 min` | WARNING | 769 |
| Long-running worker | `> 600000 ms` (10 min) | WARNING | 780 |

### PR Queue Thresholds (lines 819-820)

| Condition | Threshold | Decision | Line |
|-----------|-----------|----------|------|
| Stale PR age | `> 7 days` | WARNING | 819 |

### Autonomous Loop Thresholds (line 844)

| Condition | Threshold | Decision | Line |
|-----------|-----------|----------|------|
| Last event age | `> 24 hours` | WARNING | 844 |

### Git Lookback Windows (lines 233, 448)

| Context | Window | Line |
|---------|--------|------|
| Policy commit evidence check | `7 days` | 233 |
| High-risk file modification check | `24 hours` | 448 |

### Build Health Timeout (line 731)

| Operation | Timeout | Line |
|-----------|---------|------|
| `npm run check` | `90000 ms` (90s) | 731 |

---

## Schema Divergence

The formal output contract is defined in
`schemas/constitution-check-result.schema.json`. The checker's actual output
diverges from this schema in several ways:

| Schema Field | Schema Type | Checker Output | Divergence |
|--------------|-------------|----------------|------------|
| `checkId` | Required string | Not emitted | **Missing** |
| `checkType` | Required enum | Emits `checkType: "constitution-health"` | Value not in enum (`full-audit`, `targeted-audit`, `pre-merge`, `pre-launch`, `amendment-review`) |
| `decision` | Required enum (`pass`/`warn`/`block`) | Emits `overallDecision` with values `pass`/`warning`/`violation` | **Different field name, different enum values** |
| `lawsEvaluated` | Required array of law enums | Not emitted | **Missing** |
| `checks[].name` | Required string | Not emitted per-finding | **Missing** |
| `checks[].law` | Required law enum | Uses free-text `law` field (e.g., `"reality-before-judgment"`) | **Not in enum** |
| `violations[].code` | Required string | Not emitted | **Missing** |
| `violations[].severity` | Required enum (`error`/`critical`) | Not emitted | **Missing** |
| `warnings[].code` | Required string | Not emitted | **Missing** |
| `proposedAmendments` | Optional array | Not emitted | **Missing** |
| `summary.humanReviewRequired` | Required boolean | Not emitted | **Missing** |
| `targetScope` | Optional object | Not emitted | Missing (acceptable) |

The checker produces a custom nested structure (`threeLaws`, `seedConstitution`,
`sop`, `runtimeHealth`) that does not appear in the schema at all. The schema
expects a flat `checks` array with per-check `name`, `law`, and `pass` fields.

---

## Test Coverage

| Script | Has Tests | Lines |
|--------|-----------|-------|
| `check-constitution-health.js` | **No** | 1020 |
| `check-launch-gate.ps1` | Yes (guard tests) | — |
| `auto-trigger-health-gate.js` | Yes (guard tests) | — |

The main checker has zero test coverage. Any refactor risk is unmitigated
by automated tests.

---

## Proposed Architecture

### Target Interface

Each check becomes a separate module in `scripts/ai/checks/` with a
standard interface:

```js
// scripts/ai/checks/meta-signals-vitality.js
module.exports = {
  id: 'meta-signals-vitality',
  description: 'Validates meta signals (trust, failure, friction) are within bounds',
  category: 'runtime-health',
  law: 'reality',  // which constitutional law this check evaluates

  /**
   * @param {object} ctx - Shared context (repo root, state dir, config)
   * @returns {Array<Finding>} findings
   */
  check(ctx) {
    const thresholds = ctx.config['meta-signals-vitality'] || {};
    const trustViolation = thresholds.trustViolation ?? 30;
    const trustWarning = thresholds.trustWarning ?? 60;
    // ... check logic using configurable thresholds
    return findings;
  },
};
```

### Registry Loader

```js
// scripts/ai/check-registry.js
const checks = [];
for (const file of fs.readdirSync(path.join(__dirname, 'checks'))) {
  if (!file.endsWith('.js')) continue;
  checks.push(require(path.join(__dirname, 'checks', file)));
}
module.exports = { checks };
```

### Config File

```json
// config/constitution-check-defaults.json
{
  "state-staleness": {
    "active-workers.json": { "maxAgeMs": 3600000 },
    "local-resource.json": { "maxAgeMs": 600000 },
    "meta-signals.json": { "maxAgeMs": 1800000 },
    "provider-pool.json": { "maxAgeMs": 3600000 },
    "operational-entropy.json": { "maxAgeMs": 1800000 },
    "risk-signals.json": { "maxAgeMs": 3600000 }
  },
  "meta-signals-vitality": {
    "trustViolation": 30,
    "trustWarning": 60,
    "failureScoreViolation": 50,
    "frictionScoreWarning": 30
  },
  "resource-pressure": {
    "memoryViolation": 90,
    "memoryWarning": 75,
    "headroomWarning": 20,
    "providerUtilizationWarning": 80
  },
  "worker-lifecycle": {
    "orphanAgeMs": 1800000,
    "longRuntimeMs": 600000
  },
  "pr-queue": {
    "stalePrDays": 7
  },
  "autonomous-loop": {
    "staleEventHours": 24
  },
  "git-lookback": {
    "policyCommitDays": 7,
    "highRiskFileHours": 24
  },
  "build-health": {
    "timeoutMs": 90000
  }
}
```

---

## Prioritized Implementation Steps

Steps 1-3 are prerequisites for the plugin architecture (step 4). Each
step is independently shippable and low-risk.

### Step 1: Extract Thresholds to Config (Low Risk)

**What:** Create `config/constitution-check-defaults.json` with all 23
thresholds. Modify `check-constitution-health.js` to read from config
with inline defaults as fallback.

**Why:** Enables threshold tuning without source edits. Zero behavior
change — defaults match current hardcoded values.

**Effort:** ~2 hours.

### Step 2: Add Test Coverage (Low Risk)

**What:** Create `scripts/ai/__tests__/check-constitution-health.test.js`
with unit tests for each check function. Use mock state files in a temp
directory. Cover: pass case, warning case, violation case per function.

**Why:** 1020 lines with zero tests is the highest-risk aspect. Tests
must exist before any refactor.

**Effort:** ~4 hours.

### Step 3: Align Output with Schema (Low Risk)

**What:** Modify the output assembly in `main()` to conform to
`schemas/constitution-check-result.schema.json`. Add missing fields
(`checkId`, `checkType` enum values, `lawsEvaluated`, per-check `name`
and `law` enum, violation `code` and `severity`, `summary.humanReviewRequired`).

**Why:** The schema exists but is not followed. Alignment enables
consumers to validate output reliably.

**Effort:** ~3 hours.

### Step 4: Extract Checks to Plugin Architecture (Medium Risk)

**What:** After steps 1-3, extract each check function into
`scripts/ai/checks/<id>.js` with the standard interface. Create
`scripts/ai/check-registry.js` as the loader. Refactor `main()` to
iterate the registry.

**Why:** Enables adding/removing checks without touching the runner.
Each check becomes independently testable and reviewable.

**Effort:** ~6 hours. **Gated on steps 1-3.**

---

## Risk Assessment

| Step | Risk | Mitigation |
|------|------|------------|
| 1. Config extraction | Low | Defaults match current values; fallback chain |
| 2. Test coverage | Low | Additive only; no behavior change |
| 3. Schema alignment | Low | Output changes are additive; consumers should tolerate new fields |
| 4. Plugin extraction | Medium | Requires step 2 (tests) to catch regressions |

---

## Recommendation

Steps 1-3 should be completed as a single PR. Step 4 should be a separate
issue gated on the test coverage from step 2. This investigation closes
with the recommendation that the plugin architecture is feasible and
well-bounded, but requires the prerequisite steps to be safe.
