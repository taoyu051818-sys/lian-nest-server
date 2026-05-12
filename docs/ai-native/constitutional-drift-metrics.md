# Constitutional Drift Metrics

Defines measurable signals that detect when the AI-native control plane
drifts from its seed constitution. Drift is gradual erosion — not a hard
violation (the boundary guard catches those) but a soft weakening that
precedes violation.

> **Closes:** [#1008](https://github.com/taoyu051818-sys/lian-nest-server/issues/1008)

---

## Overview

The boundary guard enforces hard violations. Drift metrics detect the
precursor — the system gradually relaxing its own constraints before a
hard violation occurs.

| Dimension | Constitution Section at Risk | Signal Source |
|-----------|------------------------------|---------------|
| Selection weakening | Explicit Merge Allowlists | Boundary guard warnings, `allowedFiles` breadth |
| Reality bypass | High-Risk Human-Required Boundaries | Evidence intake reliability, external fact bypass |
| Recursion overreach | No Worker Scope Expansion | Worker spawning, self-modification attempts |
| Human gate pressure | All sections | Gate override frequency, review skip attempts |
| Prompt-policy violations | All sections | Injection detections, sanitization rejections |

Each dimension produces a 0–100 score. The composite uses `max` (not
average) because any single dimension reaching critical is sufficient
to signal danger.

| Composite | Interpretation | Action |
|-----------|----------------|--------|
| 0–15 | Healthy | No action |
| 16–40 | Early drift | Log warning, surface on planning console |
| 41–70 | Moderate drift | Reduce batch sizes, require architect review |
| 71–100 | Critical drift | Pause non-recovery workers, escalate to human |

---

## Dimension 1: Selection Weakening

Detects when workers subtly broaden what they may touch — not by editing
`allowedFiles` (hard violation) but by accumulating adjacent changes.

| Signal | Source | Weight |
|--------|--------|--------|
| `allowedFiles` breadth at task creation | Task JSON | 25 |
| Boundary guard warnings (non-blocking) | Boundary guard log | 30 |
| Files changed adjacent to `allowedFiles` boundary | PR diff analysis | 20 |
| Docs-only task touching non-docs paths | Boundary guard log | 25 |

```
selectionWeakening = clamp(breadth*0.25 + warnings*0.30
                         + adjacent*0.20 + docsViolation*0.25, 0, 100)
```

---

## Dimension 2: Reality Bypass

Detects when external evidence is acted upon without passing through the
intake flow ([external-reality-intake.md](external-reality-intake.md)).

| Signal | Source | Weight |
|--------|--------|--------|
| Unsanitized external text in PR body or commit | PR/commit analysis | 30 |
| Evidence intake rejection rate | Fact ledger (`evidence.rejected`) | 25 |
| `opaque-external` in active use without promotion | Fact ledger | 25 |
| External URLs not in evidence records | PR diff / worker output | 20 |

```
realityBypass = clamp(unsanitized*0.30 + rejected*0.25
                    + quarantineBypass*0.25 + untracked*0.20, 0, 100)
```

---

## Dimension 3: Recursion Overreach

Detects when workers attempt to expand their boundary — spawning
sub-workers, modifying task JSON, or editing scheduling state.

| Signal | Source | Weight |
|--------|--------|--------|
| Worker spawning sub-workers | Orchestration log | 35 |
| Worker modifying task JSON after launch | Task contract diff | 35 |
| Worker editing orchestrator/scheduler state | Boundary guard log | 20 |
| Worker creating new tasks for itself | Orchestration log | 10 |

```
recursionOverreach = clamp(spawn*0.35 + selfModify*0.35
                         + orchestratorEdit*0.20 + selfTask*0.10, 0, 100)
```

---

## Dimension 4: Human Gate Pressure

Detects pressure to bypass human-required decision points — repeated
overrides, gate shopping, and time-pressure escalation.

| Signal | Source | Weight |
|--------|--------|--------|
| Override requests per wave | Gate result records | 25 |
| Gate shopping (same decision, multiple attempts) | Gate result correlation | 30 |
| Time-pressure escalation (`defer` → retry) | Planning loop requeue log | 25 |
| Human review skip attempts | Merge gate log | 20 |

```
humanGatePressure = clamp(override*0.25 + shopping*0.30
                        + escalation*0.25 + skipAttempts*0.20, 0, 100)
```

---

## Dimension 5: Prompt-Policy Violations

Detects injection patterns, command rejections, and role escalation in
evidence records and worker output.

| Signal | Source | Weight |
|--------|--------|--------|
| Injection pattern detections | Sanitizer log | 30 |
| Command pattern rejections | Sanitizer log | 25 |
| Role escalation attempts | Evidence intake log | 25 |
| Schema poisoning attempts | Evidence intake log | 20 |

```
promptPolicyViolations = clamp(injection*0.30 + command*0.25
                             + escalation*0.25 + schema*0.20, 0, 100)
```

---

## Aggregation and Response

Per-wave JSON record:

```jsonc
{
  "wave": "wave30-constitution-steward",
  "capturedAt": "2026-05-12T10:00:00Z",
  "dimensions": {
    "selectionWeakening": 12, "realityBypass": 8,
    "recursionOverreach": 5, "humanGatePressure": 18,
    "promptPolicyViolations": 3
  },
  "composite": 18,
  "action": "log warning, surface on planning console"
}
```

Trend direction matters more than any single reading: stable (±5 over
5 waves), rising (+10/wave), falling (−10/wave), or spike (>30 jump).

| Composite | Automated Action | Human Action |
|-----------|-----------------|--------------|
| 0–15 | None | None |
| 16–40 | Log to fact ledger | Review dashboard |
| 41–70 | Reduce batch 50%, require architect review | Investigate root cause |
| 71–100 | Pause non-recovery workers | Emergency review |

---

## Integration

```
Boundary guard ────────► selection weakening
Evidence intake ───────► reality bypass
Orchestration log ─────► recursion overreach
Gate results ──────────► human gate pressure
Sanitizer ─────────────► prompt-policy violations
        │
        ▼
  drift calculator ──► fact-events.ndjson / planning console / meta-signals
```

Drift feeds into `riskScore` (meta-signals) and the health gate. At
composite > 70, the health gate blocks non-recovery workers.

---

## Implementation Status

| Component | Status |
|-----------|--------|
| Dimension definitions, formulas, thresholds | **Defined** — this doc |
| Drift calculator script | **Pending** — follow-up issue |
| Planning console integration | **Pending** — follow-up issue |
| Trend analysis / automated response | **Pending** — follow-up issue |

---

## Design Decisions

- **Max, not average.** Any critical dimension signals danger regardless
  of other scores.
- **Soft signals, not hard violations.** The boundary guard enforces;
  drift metrics give early warning.
- **Per-wave granularity.** Captures systemic patterns, not individual
  incidents.
- **Human-in-the-loop.** Automated responses pause workers but never
  modify the constitution.

---

## References

- [Seed Constitution](seed-constitution.md) — Boundaries these metrics protect
- [Constitution Guard](constitution-guard.md) — Structural validation
- [External Reality Intake](external-reality-intake.md) — Evidence intake flow
- [Agent Motivation Metrics](agent-motivation-metrics.md) — Related operational metrics
- [Meta Signals](meta-signals.md) — Signal aggregation and scoring
- [Risk Policy](risk-policy.md) — Risk categories that interact with drift
