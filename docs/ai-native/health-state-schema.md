# Health State JSON Schema

Formal JSON Schema for `.github/ai-state/main-health.json`, the main branch
health projection consumed by the launch gate, self-cycle runner, merge scripts,
and monitoring.

> **Schema file:** [`schemas/health-state.schema.json`](../../schemas/health-state.schema.json)
> **Closes:** [#361](https://github.com/taoyu051818-sys/lian-nest-server/issues/361)

---

## Overview

The health state marker is a single JSON file that records the result of a
post-merge health gate run. It is the canonical source of truth for whether
the main branch is safe for automated work.

| Aspect | Value |
|--------|-------|
| Schema version | `markerVersion: 1` |
| JSON Schema draft | `draft-07` |
| Writer | `scripts/ai/write-main-health-state.ps1` |
| Path | `.github/ai-state/main-health.json` |

---

## Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `markerVersion` | `integer` (const `1`) | Schema version. Increment when the shape changes. |
| `state` | `string` enum | Health state: `green`, `yellow`, `red`, or `black`. |
| `commitSha` | `string` (7-40 hex) | Git SHA of the commit this state was captured for. |
| `capturedAt` | `string` (ISO-8601) | Timestamp when this health state was captured. |
| `checks` | `string[]` | Names of all health checks evaluated (e.g. `tsc`, `build`, `prisma`). |
| `failedChecks` | `string[]` | Subset of `checks` that failed. Empty array when all pass. |
| `allowedWorkerClasses` | `string[]` enum | Worker classes permitted to launch. See [Worker Classes](#worker-classes). |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `blockedWorkerClasses` | `string[]` enum | Worker classes explicitly blocked. Complement of `allowedWorkerClasses`. |
| `failureClassifications` | `FailureClassification[]` | Structured failure details when `failedChecks` is non-empty. |
| `reason` | `string` | Human-readable reason for the state transition. |

---

## Health States

| State | Meaning | `allowedWorkerClasses` |
|-------|---------|----------------------|
| `green` | All checks pass. Main is safe for automated work. | `["all"]` |
| `yellow` | Non-critical failure (test env flake, boundary guard warning). | `["fix-only", "docs"]` |
| `red` | Critical failure (build broken, type-check fails, Prisma invalid). | `[]` |
| `black` | Unrecoverable state. Manual intervention required. | `[]` |

See [main-health-policy.md](main-health-policy.md) for full state detection
rules and the worker permission matrix.

---

## Worker Classes

Worker classes control which automation may target main when health is
degraded:

### Allowed Classes (`allowedWorkerClasses`)

| Value | Meaning |
|-------|---------|
| `all` | Any worker class may proceed. |
| `fix-only` | Workers whose task is to fix the failing check. |
| `docs` | Documentation-only workers (no runtime impact). |

### Blocked Classes (`blockedWorkerClasses`)

| Value | Meaning |
|-------|---------|
| `runtime-feature` | NestJS source, API endpoints, services. |
| `foundation-fix` | Dependency, Prisma, build config repair. |
| `docs` | Documentation/contract/policy workers. |
| `health-repair` | Health gate / CI repair workers. |
| `test-only` | Add or fix tests, no source change. |
| `research` | Read-only exploration workers. |
| `refactor` | Source code restructure. |

The `blockedWorkerClasses` field is optional; consumers can derive it from
`allowedWorkerClasses` and the permission matrix in
[launch-gate.md](launch-gate.md). It is included for explicit enforcement
without requiring consumers to embed the full matrix.

---

## Failure Classifications

When `failedChecks` is non-empty, the `failureClassifications` array may
contain structured classification for each failure. Each entry follows the
`FailureClassification` definition:

```json
{
  "checkName": "tsc",
  "category": "runtime compile",
  "confidence": "high",
  "matchedPatterns": ["error TS\\d+:", "Build failed"]
}
```

### Categories

| Category | Severity | Recovery Worker Type |
|----------|----------|---------------------|
| `runtime compile` | critical | foundation-fix |
| `dependency/generate` | critical | foundation-fix |
| `database foundation` | critical | foundation-fix |
| `conflict refresh` | critical | foundation-fix |
| `boundary guard` | warning | docs |
| `docs guard` | warning | docs |
| `test env` | warning | test-only |
| `unknown` | — | — |

### Confidence Levels

| Level | Meaning |
|-------|---------|
| `high` | 3+ pattern matches. |
| `medium` | 2 pattern matches. |
| `low` | 1 pattern match. |
| `none` | No patterns matched. |

Classifications are produced by `scripts/ai/classify-health-failure.js`.

---

## Validation Rules

The writer script enforces these constraints at write time:

| Rule | Enforcement |
|------|-------------|
| `state` must be one of `green`, `yellow`, `red`, `black` | Hard fail |
| `commitSha` must be 7-40 hex characters | Hard fail |
| `failedChecks` entries must each appear in `checks` | Hard fail |
| `checks` must not be empty when `failedChecks` is provided | Hard fail |
| `state=green` with non-empty `failedChecks` | Warning (non-blocking) |

The JSON Schema enforces structural correctness (types, enums, patterns)
but does not encode the cross-field consistency rules (e.g. failedChecks
subset of checks). Those are enforced by the writer script.

---

## Example: Green State

```json
{
  "markerVersion": 1,
  "state": "green",
  "commitSha": "abc1234def5678",
  "capturedAt": "2026-05-11T12:00:00Z",
  "checks": ["tsc", "build", "prisma"],
  "failedChecks": [],
  "allowedWorkerClasses": ["all"],
  "blockedWorkerClasses": []
}
```

## Example: Yellow State with Failure Classification

```json
{
  "markerVersion": 1,
  "state": "yellow",
  "commitSha": "abc1234def5678",
  "capturedAt": "2026-05-11T12:00:00Z",
  "checks": ["tsc", "build", "prisma"],
  "failedChecks": ["prisma"],
  "allowedWorkerClasses": ["fix-only", "docs"],
  "blockedWorkerClasses": ["runtime-feature", "refactor", "test-only"],
  "failureClassifications": [
    {
      "checkName": "prisma",
      "category": "dependency/generate",
      "confidence": "high",
      "matchedPatterns": ["prisma generate", "prisma validate"]
    }
  ],
  "reason": "Prisma schema drift detected"
}
```

## Example: Red State

```json
{
  "markerVersion": 1,
  "state": "red",
  "commitSha": "abc1234def5678",
  "capturedAt": "2026-05-11T12:00:00Z",
  "checks": ["tsc", "build", "prisma"],
  "failedChecks": ["tsc", "build"],
  "allowedWorkerClasses": [],
  "blockedWorkerClasses": ["runtime-feature", "foundation-fix", "docs", "test-only", "research", "refactor"],
  "failureClassifications": [
    {
      "checkName": "tsc",
      "category": "runtime compile",
      "confidence": "high",
      "matchedPatterns": ["error TS\\d+:", "Build failed"]
    },
    {
      "checkName": "build",
      "category": "runtime compile",
      "confidence": "medium",
      "matchedPatterns": ["nest build"]
    }
  ],
  "reason": "Type-check and build broken"
}
```

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **Launch gate** | `state`, `allowedWorkerClasses`, `blockedWorkerClasses` | Block/allow worker dispatch. |
| **Self-cycle runner** | `state` | Gate the automated cycle. Red/black stops the cycle. |
| **Merge scripts** | `state` | Block merge on red/black. |
| **Monitoring** | `capturedAt` | Detect stale markers. |
| **Follow-up creator** | `failedChecks`, `failureClassifications` | Classify failures and generate recovery issues. |

---

## References

- [ai-state/README.md](../../.github/ai-state/README.md) — Marker schema overview and writer usage.
- [main-health-policy.md](main-health-policy.md) — Health states, detection rules, worker permission matrix.
- [launch-gate.md](launch-gate.md) — Launch gate checker and permission matrix.
- [post-merge-health-gate.md](post-merge-health-gate.md) — Health gate runner and failure categories.
- [write-main-health-state.ps1](../../scripts/ai/write-main-health-state.ps1) — Health marker writer.
- [classify-health-failure.js](../../scripts/ai/classify-health-failure.js) — Failure classifier.
