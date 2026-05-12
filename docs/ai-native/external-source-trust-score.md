# External Source Trust Scoring

Defines a numeric trust score for every external source that enters the
AI-native control plane and describes how that score affects planning
priority, gate decisions, and signal routing.

> **Closes:** [#985](https://github.com/taoyu051818-sys/lian-nest-server/issues/985)
>
> **Cross-references:**
> [external-intake-executable-loop.md](external-intake-executable-loop.md)
> for the intake loop stages,
> [external-intake-source-matrix.md](external-intake-source-matrix.md)
> for source classification,
> [evidence-reliability-policy.md](evidence-reliability-policy.md) for
> reliability tiers,
> [external-source-threat-model.md](external-source-threat-model.md)
> for threat categories,
> [meta-signals-schema.md](meta-signals-schema.md) for the aggregated
> trust signal.

---

## Overview

External sources carry different levels of trustworthiness. This document
converts the qualitative reliability classes (Highest / High / Medium / Low)
and evidence tiers (A / B / C / D) into a numeric score on a 0--100 scale.
The score governs three downstream decisions:

1. **Planning priority** — higher trust sources produce signals that rank
   higher in the planning loop.
2. **Gate decisions** — low-trust evidence is rejected or quarantined
   before it can influence task creation.
3. **Signal routing** — the score determines whether evidence becomes an
   opportunity signal, risk signal, or is held in quarantine.

```
External Source
    │
    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Classify    │────▶│  Base Score   │────▶│  Modifiers   │
│  (source     │     │  (from class) │     │  (staleness, │
│   class)     │     │               │     │   validation)│
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │  Final Trust  │
                                          │  Score 0-100  │
                                          └──────┬───────┘
                                                  │
                            ┌─────────────────────┼─────────────────────┐
                            ▼                     ▼                     ▼
                     ┌────────────┐        ┌────────────┐       ┌────────────┐
                     │  Planning  │        │   Gate     │       │  Signal    │
                     │  Priority  │        │  Decision  │       │  Route     │
                     └────────────┘        └────────────┘       └────────────┘
```

---

## Base Trust Scores

Each source class defined in
[external-intake-executable-loop.md](external-intake-executable-loop.md)
Stage 2 maps to a base trust score.

| Source Class | Base Score | Rationale |
|---|---|---|
| `human-instruction` | 95 | Repo-owner authority; accepted directly |
| `github-issue` (CONTROL APPENDIX) | 85 | Structured, schema-validated |
| `github-pr` | 85 | Structured, required sections validated |
| `ci-result` | 80 | Machine-verified exit code and log hash |
| `github-issue` (free-form) | 60 | Semi-structured; requires LLM extraction |
| `external-doc` | 50 | Version-matched first-party docs; may be stale |
| `web-scan` | 45 | Structured tool output; source URL validated |
| `user-paste` | 25 | Unstructured; requires manual review |
| `opaque-external` | 10 | Unknown source; quarantined by default |

---

## Score Modifiers

The base score is adjusted by modifiers before producing the final trust
score. Modifiers are applied additively and the result is clamped to
[0, 100].

### Staleness Modifier

External evidence degrades over time. The staleness modifier is based on
the age of the evidence since capture.

| Age | Modifier | Rationale |
|---|---|---|
| < 24 hours | 0 | Fresh evidence |
| 24--72 hours | -5 | Slightly stale |
| 72 hours -- 7 days | -15 | Moderately stale |
| 7 days -- 30 days | -25 | Stale |
| > 30 days | -40 | Likely outdated |

### Validation Modifier

Evidence that passes additional validation receives a bonus; evidence that
fails validation is penalized.

| Validation Result | Modifier |
|---|---|
| Schema-validated (CONTROL APPENDIX, structured JSON) | +10 |
| Cross-referenced with repo state (file exists at HEAD) | +5 |
| Cross-referenced with independent source | +5 |
| Validation failed (missing fields, schema mismatch) | -20 |
| Contradicts existing fact in ledger | -30 |

### Sanitization Modifier

All external text passes through sanitization per the rules in
[external-intake-executable-loop.md](external-intake-executable-loop.md)
Stage 3. The sanitization outcome affects the score.

| Sanitization Outcome | Modifier |
|---|---|
| Clean (no redactions needed) | 0 |
| Redactions applied (tokens, secrets stripped) | -5 |
| Injection markers detected and stripped | -15 |
| Sanitization failed (unparseable) | -30 |

---

## Final Trust Score

```
finalScore = clamp(baseScore + staleness + validation + sanitization, 0, 100)
```

### Score Tiers

The final numeric score maps to a trust tier that determines downstream
behavior.

| Score Range | Tier | Planning Behavior | Gate Decision | Signal Route |
|---|---|---|---|---|
| 80--100 | **High** | Signals rank at normal priority | Auto-accept as task input | Route to opportunity or risk signal |
| 50--79 | **Medium** | Signals receive a priority penalty of -10 | Accept with citation required | Route to opportunity or risk signal with caveat |
| 25--49 | **Low** | Signals receive a priority penalty of -25 | Reject for execution tasks; advisory for research | Route to signal with explicit low-trust warning |
| 0--24 | **Untrusted** | Signals are excluded from planning | Quarantine | Route to quarantine |

---

## Integration with Meta-Signals

The aggregated `trust` signal in
[meta-signals-schema.md](meta-signals-schema.md) incorporates external
source trust scores. When the meta-signal calculator runs:

1. It collects all fact events with `eventType: evidence.intake` from the
   ledger.
2. For each event, it reads the `trustScore` from the event facts.
3. The aggregate external trust is the weighted average of all intake
   events in the current batch window, weighted by recency.

The external trust component feeds into the composite trust formula:

```
metaSignals.trust = clamp(
  100 - (failureScore * 0.6 + frictionScore * 0.4),
  0,
  100
) * (externalTrust / 100)
```

When no external intake events exist, `externalTrust` defaults to 100
(no degradation).

---

## Gate Matrix

The trust score determines whether external evidence may enter the task
creation pipeline.

| Task Type | High (80+) | Medium (50-79) | Low (25-49) | Untrusted (0-24) |
|---|---|---|---|---|
| **execution** | Auto-accept | Accept with citation | Reject | Quarantine |
| **research** | Auto-accept | Auto-accept | Accept with caveat | Reject |
| **review** | Auto-accept | Accept with citation | Advisory only | Quarantine |
| **planning** | Auto-accept | Auto-accept | Accept as input, not decision basis | Quarantine |

This matrix aligns with the gate matrix in
[evidence-reliability-policy.md](evidence-reliability-policy.md) but maps
to numeric score ranges instead of letter tiers.

---

## Fact Event Integration

When an external source is captured via `write-fact-event.js`, the trust
score is recorded in the event facts:

```jsonc
{
  "eventVersion": 1,
  "eventType": "evidence.intake",
  "subject": "github issue #985",
  "facts": {
    "sourceClass": "github-issue",
    "baseScore": 85,
    "stalenessModifier": 0,
    "validationModifier": 10,
    "sanitizationModifier": 0,
    "trustScore": 95,
    "trustTier": "high",
    "rawHash": "a1b2c3",
    "sanitized": true
  },
  "capturedAt": "2026-05-12T10:00:00Z",
  "actor": "external-intake"
}
```

The `trustScore` field is the final clamped value. Downstream consumers
(readers of the fact ledger) use this field directly without recomputing.

---

## Quarantine Rules

Evidence scoring below 25 (Untrusted tier) enters quarantine:

1. The fact event is recorded with `eventType: evidence.quarantined`.
2. The evidence is blocked from all downstream signal consumers.
3. A human must explicitly promote the evidence via `evidence.promoted`
   before it can influence planning or gate decisions.
4. Quarantined evidence retains its original trust score. Promotion does
   not change the score — it overrides the quarantine gate.

---

## Safe Skeleton Behavior

When the trust score calculator encounters missing or malformed input:

| Condition | Behavior |
|---|---|
| Missing `sourceClass` | Default to `opaque-external` (base score 10) |
| Missing `capturedAt` | Assume maximum staleness modifier (-40) |
| Missing validation result | Apply -20 (validation failed) |
| Calculator script error | Log error; emit fact event with `trustScore: 0` |

---

## Relationship to Existing Policies

| Policy | Interaction |
|---|---|
| [evidence-reliability-policy.md](evidence-reliability-policy.md) | Provides the A/B/C/D tier framework. This document maps tiers to numeric scores. |
| [external-intake-source-matrix.md](external-intake-source-matrix.md) | Defines source classes and reliability labels. This document quantifies them. |
| [external-source-threat-model.md](external-source-threat-model.md) | Defines threats. Low trust scores trigger the quarantine behavior described there. |
| [meta-signals-schema.md](meta-signals-schema.md) | Consumes the aggregated external trust score in the `trust` signal. |
| [external-intake-executable-loop.md](external-intake-executable-loop.md) | Stage 3 (Score) produces the reliability tier. This document provides the numeric model behind it. |
| [worker-trust.md](worker-trust.md) | Worker trust is separate from source trust, but both contribute to the composite `trust` signal. |

---

## References

- [external-intake-executable-loop.md](external-intake-executable-loop.md) — Intake loop stages
- [external-intake-source-matrix.md](external-intake-source-matrix.md) — Source classification
- [evidence-reliability-policy.md](evidence-reliability-policy.md) — Reliability tiers
- [external-source-threat-model.md](external-source-threat-model.md) — Threat model
- [meta-signals-schema.md](meta-signals-schema.md) — Aggregated signal schema
- [fact-event-ledger.md](fact-event-ledger.md) — Fact event recording
- [worker-trust.md](worker-trust.md) — Worker trust model
