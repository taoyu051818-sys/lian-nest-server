# Opportunity Signal JSON Schema

Formal schema definition for `opportunity-signals.json`, the structured
signal that captures an external reality observation, a falsifiable
hypothesis about it, and the experiment to validate the hypothesis before
committing worker capacity.

> **Closes:** [#892](https://github.com/taoyu051818-sys/lian-nest-server/issues/892)

---

## Overview

An opportunity signal is the intake artifact for the external reality
intake loop. It transforms an observation (from monitoring, user feedback,
incident review, or manual analysis) into a structured object that the
planning loop can evaluate, rank, and schedule.

The signal is intentionally lightweight: it is not a task, not a PR, and
not a plan. It is a *claim* backed by evidence, with a built-in
falsification mechanism. The planning loop promotes a signal to a task
only after the acceptance gate passes.

| Aspect | Value |
|--------|-------|
| Schema version | `schemaVersion: 1` |
| JSON Schema draft | `draft-07` |
| Lifecycle | `draft` → `validated` → `accepted` → `scheduled` or `rejected` |
| State file path | `.github/ai-state/opportunity-signals/` (one JSON per signal) |

---

## Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | `integer` (const `1`) | Schema version. Increment when the shape changes. |
| `signalId` | `string` | Unique identifier. Format: `opp-<short-uuid>`. |
| `createdAt` | `string` (ISO-8601) | Timestamp when this signal was created. |
| `status` | `string` enum | Lifecycle state: `draft`, `validated`, `accepted`, `scheduled`, `rejected`. |
| `sourceFacts` | `SourceFact[]` | Evidence backing this signal. At least one required. |
| `hypothesis` | `Hypothesis` | The falsifiable claim derived from the source facts. |
| `expectedImpact` | `ExpectedImpact` | Quantified expected outcome if the hypothesis holds. |
| `experiment` | `Experiment` | The minimal action to validate the hypothesis. |
| `risk` | `Risk` | Assessment of what could go wrong. |
| `acceptanceGate` | `AcceptanceGate` | Criteria that must pass before promoting to a task. |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `updatedAt` | `string` (ISO-8601) | Timestamp of last modification. |
| `promotedTaskId` | `string \| null` | Task ID if this signal was promoted to a scheduled task. |
| `rejectionReason` | `string \| null` | Why the signal was rejected. Present only when `status` is `rejected`. |
| `tags` | `string[]` | Freeform labels for filtering (e.g. `"performance"`, `"auth"`, `"ux"`). |

---

## SourceFact

Each source fact is a piece of evidence. The signal must cite at least
one. Multiple facts strengthen the signal.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `factId` | `string` | Yes | Unique identifier. Format: `fact:<domain>:<slug>` (e.g. `fact:perf:p95-latency-spike`). |
| `description` | `string` | Yes | Human-readable description of what was observed. |
| `source` | `string` | Yes | Where the fact came from: issue number, PR, doc path, monitoring URL, or log file. |
| `observedAt` | `string` (ISO-8601) | No | When the observation was made. |
| `confidence` | `string` enum | No | `high` (direct measurement), `medium` (inferred), `low` (anecdotal). Defaults to `medium` if omitted. |

### Source Fact Examples

```json
{
  "factId": "fact:perf:p95-latency-spike",
  "description": "P95 latency on GET /api/users spiked from 120ms to 450ms after deploy 2026.05.10",
  "source": "grafana dashboard /d/api-latency",
  "observedAt": "2026-05-11T08:30:00Z",
  "confidence": "high"
}
```

```json
{
  "factId": "fact:feedback:onboarding-confusion",
  "description": "3 support tickets in the last week mention confusion during the onboarding flow step 3",
  "source": "zendesk tag:onboarding search:step-3",
  "observedAt": "2026-05-10T14:00:00Z",
  "confidence": "medium"
}
```

---

## Hypothesis

The hypothesis is the signal's core claim. It must be falsifiable — the
experiment either confirms or denies it.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `claim` | `string` | Yes | A single sentence stating what the signal asserts. Must be testable. |
| `reasoning` | `string` | Yes | Why the source facts suggest this claim. Links the evidence to the assertion. |
| `alternativesConsidered` | `string[]` | No | Other explanations for the observed facts. Helps reviewers assess whether the hypothesis was narrowed sufficiently. |

### Hypothesis Example

```json
{
  "claim": "The N+1 query in the user-list endpoint causes the P95 latency spike under concurrent load.",
  "reasoning": "The spike correlates with the deploy that added the profile-picture join. The query plan shows a sequential scan on the avatar table per user row.",
  "alternativesConsidered": [
    "Database connection pool exhaustion (ruled out: pool metrics are stable)",
    "Upstream API timeout (ruled out: no 504s in gateway logs)"
  ]
}
```

---

## ExpectedImpact

Quantifies what success looks like. The planning loop uses these values
for ranking signals by value.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `metric` | `string` | Yes | What will be measured (e.g. `"p95 latency"`, `"conversion rate"`, `"error count"`). |
| `currentValue` | `string` | Yes | The observed baseline (e.g. `"450ms"`, `"12%"`, `"~200/day"`). |
| `targetValue` | `string` | Yes | The desired outcome (e.g. `"150ms"`, `"15%"`, `"<50/day"`). |
| `timeToImpact` | `string` | No | Estimated time to see the effect after the experiment (e.g. `"1 day"`, `"1 week"`). |
| `confidence` | `string` enum | No | `high`, `medium`, `low`. How confident in the target. Defaults to `medium`. |

### Expected Impact Example

```json
{
  "metric": "p95 latency",
  "currentValue": "450ms",
  "targetValue": "150ms",
  "timeToImpact": "immediate after deploy",
  "confidence": "high"
}
```

---

## Experiment

The minimal action to validate the hypothesis. The experiment must be
small enough that failure is cheap.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` enum | Yes | `code-change`, `config-change`, `data-collection`, `prototype`, `ab-test`. |
| `description` | `string` | Yes | What the experiment does. Should be specific enough for a worker to execute. |
| `scope` | `string` | Yes | Boundary of the change (e.g. `"single endpoint"`, `"one feature flag"`, `"staging only"`). |
| `duration` | `string` | No | How long the experiment runs (e.g. `"1 hour"`, `"3 days"`, `"one deploy cycle"`). |
| `rollbackPlan` | `string` | No | How to undo if the experiment goes wrong. |
| `successCriteria` | `string[]` | Yes | Specific, measurable conditions that confirm the hypothesis. At least one required. |

### Experiment Example

```json
{
  "type": "code-change",
  "description": "Add batch-loading for avatar URLs in the user-list endpoint using DataLoader",
  "scope": "GET /api/users only, no other endpoints affected",
  "duration": "one deploy cycle (observe for 24h)",
  "rollbackPlan": "Revert the DataLoader commit; the N+1 returns but is functionally correct.",
  "successCriteria": [
    "P95 latency returns below 200ms under normal load",
    "No increase in error rate on GET /api/users",
    "Query count per request drops from N+1 to 2"
  ]
}
```

---

## Risk

Assessment of what could go wrong. Required for every signal, even
low-risk ones.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `level` | `string` enum | Yes | `low`, `medium`, `high`. |
| `concerns` | `string[]` | Yes | Specific risks. At least one required. |
| `mitigations` | `string[]` | No | How each concern is addressed. |

### Risk Level Guidelines

| Level | When to Use |
|-------|-------------|
| `low` | Docs-only, isolated config, no runtime behavior change. |
| `medium` | Cross-module change, performance-sensitive path, or data-impacting. |
| `high` | Auth, public API, data migration, or anything that could cause data loss. |

### Risk Example

```json
{
  "level": "medium",
  "concerns": [
    "DataLoader caching could serve stale avatar URLs if the cache TTL is misconfigured",
    "Batch size could cause memory pressure for users with very large lists"
  ],
  "mitigations": [
    "Set DataLoader cache TTL to 30s (short enough to be safe, long enough to help)",
    "Cap batch size at 100 with cursor-based pagination"
  ]
}
```

---

## AcceptanceGate

Criteria that must pass before the signal is promoted from `validated` to
`accepted` and becomes eligible for task scheduling.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requiredReviewRoles` | `string[]` | Yes | Roles that must sign off (e.g. `["architect"]`, `["qa-contract-reviewer"]`). |
| `acceptanceOwner` | `string` | Yes | Who has final authority to promote or reject. |
| `criteria` | `string[]` | Yes | Specific pass/fail checks. At least one required. |
| `healthGate` | `string` enum | No | `gate-all`, `gate-docs-only`, `gate-none`. Health checks required before the experiment can run. Defaults to `gate-all`. |

### Acceptance Gate Example

```json
{
  "requiredReviewRoles": ["architect"],
  "acceptanceOwner": "codex orchestrator",
  "criteria": [
    "Source facts verified against primary data source",
    "Experiment scope does not touch forbidden files",
    "Success criteria are measurable with existing telemetry",
    "Rollback plan is feasible within the experiment duration"
  ],
  "healthGate": "gate-all"
}
```

---

## Full Example

A complete opportunity signal for a latency regression:

```json
{
  "schemaVersion": 1,
  "signalId": "opp-a1b2c3d4",
  "createdAt": "2026-05-12T10:00:00Z",
  "updatedAt": "2026-05-12T10:30:00Z",
  "status": "draft",
  "tags": ["performance", "api"],
  "sourceFacts": [
    {
      "factId": "fact:perf:p95-latency-spike",
      "description": "P95 latency on GET /api/users spiked from 120ms to 450ms after deploy 2026.05.10",
      "source": "grafana dashboard /d/api-latency",
      "observedAt": "2026-05-11T08:30:00Z",
      "confidence": "high"
    },
    {
      "factId": "fact:perf:query-plan-scan",
      "description": "EXPLAIN ANALYZE shows sequential scan on avatar table per user row",
      "source": "psql EXPLAIN output captured in incident #890",
      "observedAt": "2026-05-11T09:00:00Z",
      "confidence": "high"
    }
  ],
  "hypothesis": {
    "claim": "The N+1 query in the user-list endpoint causes the P95 latency spike under concurrent load.",
    "reasoning": "The spike correlates exactly with the deploy that added the profile-picture join. The query plan confirms a sequential scan per row.",
    "alternativesConsidered": [
      "Database connection pool exhaustion (ruled out: pool metrics stable)",
      "Upstream API timeout (ruled out: no 504s in gateway logs)"
    ]
  },
  "expectedImpact": {
    "metric": "p95 latency on GET /api/users",
    "currentValue": "450ms",
    "targetValue": "150ms",
    "timeToImpact": "immediate after deploy",
    "confidence": "high"
  },
  "experiment": {
    "type": "code-change",
    "description": "Add batch-loading for avatar URLs using DataLoader with a 30s cache TTL",
    "scope": "GET /api/users only",
    "duration": "one deploy cycle (observe for 24h)",
    "rollbackPlan": "Revert the DataLoader commit; the N+1 returns but is functionally correct.",
    "successCriteria": [
      "P95 latency returns below 200ms under normal load",
      "No increase in error rate on GET /api/users",
      "Query count per request drops from N+1 to 2"
    ]
  },
  "risk": {
    "level": "medium",
    "concerns": [
      "DataLoader caching could serve stale avatar URLs if cache TTL misconfigured",
      "Batch size could cause memory pressure for large user lists"
    ],
    "mitigations": [
      "Set DataLoader cache TTL to 30s",
      "Cap batch size at 100 with cursor-based pagination"
    ]
  },
  "acceptanceGate": {
    "requiredReviewRoles": ["architect"],
    "acceptanceOwner": "codex orchestrator",
    "criteria": [
      "Source facts verified against primary data source",
      "Experiment scope does not touch forbidden files",
      "Success criteria are measurable with existing telemetry",
      "Rollback plan is feasible within the experiment duration"
    ],
    "healthGate": "gate-all"
  },
  "promotedTaskId": null,
  "rejectionReason": null
}
```

---

## Lifecycle

```
draft  →  validated  →  accepted  →  scheduled
                  ↘                ↘
                 rejected         rejected
```

| State | Meaning | Transition Trigger |
|-------|---------|-------------------|
| `draft` | Signal created, not yet reviewed. | Initial state. |
| `validated` | Source facts verified, hypothesis is falsifiable, experiment is scoped. | Reviewer confirms structure and evidence. |
| `accepted` | Acceptance gate passed. Eligible for task scheduling. | All `acceptanceGate.criteria` pass. |
| `scheduled` | Promoted to a worker task. `promotedTaskId` is set. | Planning loop assigns a worker. |
| `rejected` | Signal will not proceed. `rejectionReason` is set. | Reviewer rejects or acceptance gate fails. |

---

## Integration with Existing Systems

| System | Integration Point |
|--------|-------------------|
| **Task v2 schema** | A promoted signal maps to a `taskType: "execution"` task. The `experiment.scope` maps to `allowedFiles`; `experiment.successCriteria` inform `validation` commands. |
| **Fact registry** | `sourceFacts[].factId` values should be registered in the fact system. `experiment.successCriteria` may declare new `producesFacts` when promoted. |
| **Meta-signals** | The planning loop reads `risk.level` and `expectedImpact.confidence` alongside meta-signal scores for ranking. |
| **Health gate** | `acceptanceGate.healthGate` controls pre-experiment health checks, using the same enum as `task-v2.mainHealthPolicy`. |
| **Launch gate** | The launch gate validates that a promoted signal's experiment scope does not conflict with in-flight workers. |

---

## Validation

Opportunity signal JSON files should validate against the schema once the
corresponding `schemas/opportunity-signal.schema.json` is added. Until
then, structural validation is manual.

---

## References

- [loop-model.md](loop-model.md) — Automated loop that consumes signals for task scheduling.
- [worker-task-contract.md](worker-task-contract.md) — Base task JSON contract (promotion target).
- [task-schema-v2.md](task-schema-v2.md) — v2 task schema with fact-based dependency fields.
- [meta-signals-schema.md](meta-signals-schema.md) — Health signals consumed alongside opportunity signals.
- [docs-authority-map.md](docs-authority-map.md) — Folder authority and worker context selection.
