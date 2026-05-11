# Risk Signal JSON Schema

Formal JSON Schema for `risk-signals.json`, the external risk signal
snapshot consumed by the planning loop for risk-aware prioritization
across compliance, security, product, runtime, and market domains.

> **Schema file:** [`schemas/risk-signal.schema.json`](../../schemas/risk-signal.schema.json)
> **Closes:** [#893](https://github.com/taoyu051818-sys/lian-nest-server/issues/893)

---

## Overview

External risk signals capture evidence from outside the automation
boundary — regulatory changes, security advisories, product decisions,
runtime incidents, and market shifts. The planning loop uses these
signals alongside internal meta-signals to rank and gate tasks.

| Aspect | Value |
|--------|-------|
| Schema version | `signalVersion: 1` |
| JSON Schema draft | `draft-07` |
| Path | `.github/ai-state/risk-signals.json` |
| Writer | Manual or future `calculate-risk-signals.js` |

---

## Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `signalVersion` | `integer` (const `1`) | Schema version. Increment when the shape changes. |
| `capturedAt` | `string` (ISO-8601) | Timestamp when this snapshot was assembled. |
| `signals` | `RiskSignal[]` | Array of individual risk signal entries. |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `source` | `string` | Human-readable origin of the snapshot (e.g. `"manual"`, `"planner-intake"`). |
| `notes` | `string` | Free-text context for the snapshot. |

---

## RiskSignal

Each entry represents one external risk observation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Stable identifier for deduplication (e.g. `"CVE-2026-1234"`, `"GDPR-ART-17"`). |
| `domain` | `string` enum | Yes | Risk domain: `compliance`, `security`, `product`, `runtime`, `market`. |
| `severity` | `string` enum | Yes | Impact level: `critical`, `high`, `medium`, `low`, `info`. |
| `title` | `string` | Yes | Short human-readable summary. |
| `detectedAt` | `string` (ISO-8601) | Yes | When the signal was first observed or published. |
| `status` | `string` enum | Yes | Current state: `open`, `acknowledged`, `mitigated`, `accepted`, `expired`. |
| `source` | `string` | Yes | External origin (e.g. `"NVD"`, `"internal-audit"`, `"support-escalation"`). |
| `description` | `string` | No | Detailed explanation of the risk. |
| `evidence` | `string[]` | No | URLs, CVE IDs, or document references supporting the signal. |
| `expiresAt` | `string` (ISO-8601) | No | When the signal should be considered stale. |
| `tags` | `string[]` | No | Freeform labels for filtering (e.g. `["pci-dss", "auth", "p0"]`). |
| `affectedAreas` | `string[]` | No | File patterns or module names at risk (e.g. `["src/**/auth/**"]`). |

---

## Domains

| Domain | Typical Sources | Planning Impact |
|--------|----------------|-----------------|
| `compliance` | Regulatory audits, legal reviews, GDPR/PCI-DSS findings | Blocks affected task areas until mitigated. |
| `security` | CVEs, pen-test reports, dependency advisories | Elevates priority of dependency and auth tasks. |
| `product` | Stakeholder decisions, roadmap changes, deprecation notices | Reorders task priority within a wave. |
| `runtime` | Production incidents, SLA breaches, capacity alerts | Triggers health-repair or foundation-fix workers. |
| `market` | Competitor moves, pricing changes, partnership deadlines | Influences wave scoping and deadline pressure. |

---

## Severity Levels

| Severity | Score Weight | Planning Behavior |
|----------|-------------|-------------------|
| `critical` | 40 | Blocks task areas in `affectedAreas`. Requires resolution before wave proceeds. |
| `high` | 25 | High priority boost for matching tasks. Flagged in batch plan output. |
| `medium` | 10 | Moderate priority adjustment. Included in risk score calculation. |
| `low` | 3 | Logged for awareness. No automatic planning impact. |
| `info` | 0 | Recorded only. No planning effect. |

---

## Status Lifecycle

```
open  →  acknowledged  →  mitigated
  │                         │
  │         ┌───────────────┘
  │         ▼
  └──→  accepted (risk accepted, no further action)
          │
          ▼
        expired (signal aged out or superseded)
```

| Status | Meaning | Planning Behavior |
|--------|---------|-------------------|
| `open` | Newly detected, not yet reviewed. | Full severity weight applied to planning. |
| `acknowledged` | Reviewed, action pending. | Full severity weight applied. |
| `mitigated` | Fix deployed or control in place. | Weight reduced to 25% of severity score. |
| `accepted` | Risk formally accepted by owner. | No planning weight. Logged for audit. |
| `expired` | Signal aged past `expiresAt` or superseded. | Excluded from planning. Retained for history. |

---

## Integration with Meta-Signals

External risk signals feed into the `riskScore` component of
[meta-signals](meta-signals.md). The integration point is:

```
risk-signals.json                    meta-signals.json
  │                                    │
  │  domain weights × severity         │  signals.riskScore
  │  (external contribution)           │  (internal contribution)
  │                                    │
  └──────────┬─────────────────────────┘
             │
             ▼
     plan-next-batch.ps1
     (combined risk-aware ranking)
```

The planning loop reads both snapshots. Internal risk (from health
failures) and external risk (from this schema) are summed with a cap
of 100 for the composite `riskScore`.

### Weight Calculation

Each active signal contributes to the composite risk score:

```
contribution = severityWeight × domainMultiplier
```

| Domain | Multiplier |
|--------|-----------|
| `security` | 1.5 |
| `compliance` | 1.3 |
| `runtime` | 1.2 |
| `product` | 1.0 |
| `market` | 0.8 |

Signals with `status` of `mitigated` contribute at 25% of their
computed weight. Signals with `accepted` or `expired` contribute 0.

---

## Relationship to Risk Policy

[risk-policy.md](risk-policy.md) defines file-pattern-based risk
categories for worker dispatch and merge gates. External risk signals
*overlay* that policy: when a signal lists `affectedAreas`, those
patterns are temporarily elevated to the signal's severity for
planning purposes.

Example: A CVE affecting `src/**/auth/**` raises that area from
`high` (permanently defined in risk-policy.json) to `critical`
(temporarily, until the signal is `mitigated` or `expired`).

---

## Example: Security CVE

```json
{
  "signalVersion": 1,
  "capturedAt": "2026-05-12T10:00:00Z",
  "source": "manual",
  "signals": [
    {
      "id": "CVE-2026-12345",
      "domain": "security",
      "severity": "critical",
      "title": "Remote code execution in passport-jwt < 4.1.0",
      "detectedAt": "2026-05-12T08:30:00Z",
      "status": "open",
      "source": "NVD",
      "description": "Unpatched passport-jwt allows JWT signature bypass.",
      "evidence": ["https://nvd.nist.gov/vuln/detail/CVE-2026-12345"],
      "expiresAt": "2026-06-12T00:00:00Z",
      "tags": ["cve", "auth", "jwt"],
      "affectedAreas": ["src/**/auth/**", "src/**/passport/**"]
    }
  ]
}
```

## Example: Compliance Audit Finding

```json
{
  "signalVersion": 1,
  "capturedAt": "2026-05-12T14:00:00Z",
  "source": "internal-audit",
  "signals": [
    {
      "id": "AUDIT-2026-Q2-003",
      "domain": "compliance",
      "severity": "high",
      "title": "Session tokens stored without expiry enforcement",
      "detectedAt": "2026-05-10T09:00:00Z",
      "status": "acknowledged",
      "source": "internal-audit",
      "description": "PCI-DSS 8.1.8 requires session timeout ≤ 15 minutes.",
      "evidence": ["PCI-DSS-v4.0-8.1.8"],
      "tags": ["pci-dss", "session"],
      "affectedAreas": ["src/**/session/**"]
    }
  ]
}
```

## Example: Mixed Signals (Zeroed-Out Default)

```json
{
  "signalVersion": 1,
  "capturedAt": "2026-05-12T00:00:00Z",
  "signals": []
}
```

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **Planning loop** (`plan-next-batch.ps1`) | `signals[].severity`, `signals[].status`, `signals[].affectedAreas` | Risk-aware task ranking. Higher severity signals demote or block matching tasks. |
| **Batch launcher** | `signals[].status` | Detect `critical` + `open` signals that may block dispatch. |
| **Monitoring** | `capturedAt` | Detect stale snapshots. |
| **Audit trail** | All fields | Retained for compliance evidence. |

---

## References

- [meta-signals.md](meta-signals.md) — Internal health signal calculator.
- [meta-signals-schema.md](meta-signals-schema.md) — Meta-signals JSON schema.
- [risk-policy.md](risk-policy.md) — File-pattern-based risk categories.
- [failure-taxonomy.md](failure-taxonomy.md) — Health gate failure classification.
- [planner-meta-signals-ranking.md](planner-meta-signals-ranking.md) — How the planning loop consumes signals.
- [health-state-schema.md](health-state-schema.md) — Health state JSON schema.
