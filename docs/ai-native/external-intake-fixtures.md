# External Intake Fixture Examples

Safe, non-secret fixture data for testing external intake flows. Every
fixture uses synthetic values — no real credentials, URLs, or hashes.

> **Closes:** [#978](https://github.com/taoyu051818-sys/lian-nest-server/issues/978)
>
> **Cross-references:**
> [external-intake-executable-loop.md](external-intake-executable-loop.md) for
> the intake loop overview,
> [opportunity-signal-schema.md](opportunity-signal-schema.md) for
> opportunity signal fields,
> [risk-signal-schema.md](risk-signal-schema.md) for risk signal fields,
> [agent-idea-review-gate.md](agent-idea-review-gate.md) for idea gate
> criteria and result schema,
> [runtime-signal-intake-contract.md](runtime-signal-intake-contract.md)
> for runtime signal rules.

---

## Usage

Each section shows an **Input** (what a worker or script receives) and an
**Output** (what it produces). Copy-paste these into test harnesses,
dry-run scripts, or CI fixtures. Replace synthetic values with real ones
only in live environments.

---

## 1. External Fact (Fact Event)

### Input

Command to record a fact event:

```bash
node scripts/ai/write-fact-event.js \
  --type evidence.intake \
  --subject "synthetic: dependency audit finding" \
  --actor "fixture-worker" \
  --live \
  --facts '{"sourceClass":"web-scan","reliabilityTier":"medium","rawHash":"aabb1122ccdd3344eeff5566aabb7788990011223344556677889900aabbccdd","sanitized":true}'
```

### Output

Appended to `.github/ai-state/fact-events.ndjson`:

```json
{
  "eventVersion": 1,
  "eventType": "evidence.intake",
  "subject": "synthetic: dependency audit finding",
  "facts": {
    "sourceClass": "web-scan",
    "reliabilityTier": "medium",
    "rawHash": "aabb1122ccdd3344eeff5566aabb7788990011223344556677889900aabbccdd",
    "sanitized": true
  },
  "capturedAt": "2026-05-12T10:00:00Z",
  "actor": "fixture-worker"
}
```

---

## 2. Opportunity Signal

### Input

Source facts feeding the signal:

```json
[
  {
    "factId": "fact:perf:p95-latency-spike",
    "description": "P95 latency exceeded 300ms for 3 consecutive health checks",
    "source": "fact-events.ndjson",
    "observedAt": "2026-05-11T08:30:00Z",
    "confidence": "high"
  }
]
```

### Output

Written to `.github/ai-state/opportunity-signals/opp-fixture01.json`:

```json
{
  "schemaVersion": 1,
  "signalId": "opp-fixture01",
  "createdAt": "2026-05-12T10:00:00Z",
  "status": "draft",
  "sourceFacts": [
    {
      "factId": "fact:perf:p95-latency-spike",
      "description": "P95 latency exceeded 300ms for 3 consecutive health checks",
      "source": "fact-events.ndjson",
      "observedAt": "2026-05-11T08:30:00Z",
      "confidence": "high"
    }
  ],
  "hypothesis": {
    "claim": "Adding a response cache to the query endpoint will reduce P95 latency below 200ms",
    "reasoning": "The endpoint recomputes the same result on every request. A short TTL cache eliminates redundant work.",
    "alternativesConsidered": [
      "Database index optimization",
      "Query result pagination"
    ]
  },
  "expectedImpact": {
    "metric": "p95-latency-ms",
    "currentValue": 320,
    "targetValue": 180,
    "timeToImpact": "1 sprint",
    "confidence": "medium"
  },
  "experiment": {
    "type": "code-change",
    "description": "Add a 30-second TTL in-memory cache to the query endpoint handler",
    "scope": "src/modules/query/handler.ts",
    "successCriteria": [
      "P95 latency below 200ms over a 24-hour window",
      "No stale-data incidents reported within 48 hours"
    ],
    "duration": "48 hours",
    "rollbackPlan": "Remove the cache decorator and redeploy"
  },
  "risk": {
    "level": "low",
    "concerns": [
      "Stale cache could serve outdated data if upstream changes within TTL"
    ],
    "mitigations": [
      "Short 30-second TTL limits staleness window",
      "Cache bypass header available for force-refresh"
    ]
  },
  "acceptanceGate": {
    "requiredReviewRoles": ["ai-architecture-reviewer"],
    "acceptanceOwner": "codex-orchestrator",
    "criteria": [
      "P95 latency benchmark passes",
      "No regression in data freshness tests"
    ],
    "healthGate": "gate-all"
  }
}
```

---

## 3. Risk Signal

### Input

External source: synthetic NVD advisory.

### Output

Written to `.github/ai-state/risk-signals.json`:

```json
{
  "signalVersion": 1,
  "capturedAt": "2026-05-12T10:00:00Z",
  "source": "fixture-scan",
  "signals": [
    {
      "id": "CVE-2026-99999",
      "domain": "security",
      "severity": "high",
      "title": "Prototype pollution in synthetic-parser",
      "detectedAt": "2026-05-12T09:00:00Z",
      "status": "open",
      "source": "fixture-nvd",
      "description": "A prototype pollution vulnerability allows remote code execution via crafted JSON input.",
      "evidence": [
        "https://example.test/advisories/CVE-2026-99999"
      ],
      "affectedAreas": [
        "src/modules/parser/**"
      ],
      "tags": [
        "dependency",
        "parser"
      ]
    }
  ],
  "notes": "Synthetic fixture — not a real CVE."
}
```

---

## 4. Bounded Experiment

### Input

Experiment definition extracted from an opportunity signal:

```json
{
  "type": "config-change",
  "description": "Enable feature flag for async job processing",
  "scope": "src/modules/jobs/config.ts",
  "successCriteria": [
    "Job completion rate above 99% over 24 hours",
    "No increase in error rate for synchronous path"
  ],
  "duration": "24 hours",
  "rollbackPlan": "Disable feature flag and restart workers"
}
```

### Output

Fact event recording the experiment start:

```json
{
  "eventVersion": 1,
  "eventType": "evidence.intake",
  "subject": "experiment: async-job-processing-flag",
  "facts": {
    "sourceClass": "human-instruction",
    "reliabilityTier": "authoritative",
    "rawHash": "1234abcd5678ef901234abcd5678ef901234abcd5678ef901234abcd5678ef90",
    "sanitized": true,
    "experimentType": "config-change",
    "scope": "src/modules/jobs/config.ts",
    "duration": "24 hours"
  },
  "capturedAt": "2026-05-12T10:00:00Z",
  "actor": "fixture-worker"
}
```

Fact event recording the experiment outcome:

```json
{
  "eventVersion": 1,
  "eventType": "evidence.intake",
  "subject": "experiment-result: async-job-processing-flag",
  "facts": {
    "sourceClass": "human-instruction",
    "reliabilityTier": "authoritative",
    "rawHash": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    "sanitized": true,
    "experimentOutcome": "success",
    "jobCompletionRate": 99.7,
    "errorRateDelta": 0
  },
  "capturedAt": "2026-05-13T10:00:00Z",
  "actor": "fixture-worker"
}
```

---

## 5. Idea Gate

### Input

Idea candidate fed to the review gate:

```json
{
  "source": "meta-signal",
  "title": "Add retry logic to external API client",
  "reason": "failureScore=18, topPain=external-api-timeout. Recent gap ledger shows 3 timeout entries in 48 hours.",
  "confidence": 62,
  "priority": "medium",
  "signalValues": { "failureScore": 18, "topPain": "external-api-timeout" },
  "actionHint": "Add exponential backoff retry to the HTTP client wrapper.",
  "suggestedConflictGroup": "api-client-resilience",
  "SuggestedAllowedFiles": ["src/modules/api-client/**"],
  "suggestedWorkerType": "foundation-fix"
}
```

### Output — Promote

Gate result when the idea passes all criteria:

```json
{
  "schemaVersion": 1,
  "gateType": "idea-review",
  "decision": "promote",
  "severity": "info",
  "markerId": "idea-fixture-promote-review",
  "capturedAt": "2026-05-12T10:00:00Z",
  "targetIssue": null,
  "targetPR": null,
  "factsRead": [
    {
      "source": ".github/ai-state/meta-signals.json",
      "summary": "failureScore=18, topPain=external-api-timeout"
    },
    {
      "source": ".github/ai-state/gap-ledger.ndjson",
      "summary": "3 timeout entries in last 48 hours"
    }
  ],
  "blockers": [],
  "warnings": [],
  "producedFacts": [
    { "key": "idea-source", "value": "meta-signal" },
    { "key": "conflict-group", "value": "api-client-resilience" },
    { "key": "worker-type", "value": "foundation-fix" }
  ]
}
```

### Output — Block

Gate result when the idea is blocked by a duplicate issue:

```json
{
  "schemaVersion": 1,
  "gateType": "idea-review",
  "decision": "block",
  "severity": "error",
  "markerId": "idea-fixture-block-review",
  "capturedAt": "2026-05-12T10:00:00Z",
  "targetIssue": null,
  "targetPR": null,
  "factsRead": [
    {
      "source": "github-issues",
      "summary": "Open issue #200 with conflictGroup=api-client-resilience"
    }
  ],
  "blockers": [
    {
      "code": "DUPLICATE_ISSUE",
      "message": "Open issue #200 already covers this scope with conflictGroup=api-client-resilience."
    }
  ],
  "warnings": [],
  "producedFacts": []
}
```

### Output — Defer

Gate result when the batch is at capacity:

```json
{
  "schemaVersion": 1,
  "gateType": "idea-review",
  "decision": "defer",
  "severity": "info",
  "markerId": "idea-fixture-defer-review",
  "capturedAt": "2026-05-12T10:00:00Z",
  "targetIssue": null,
  "targetPR": null,
  "factsRead": [
    {
      "source": ".github/ai-state/main-health.json",
      "summary": "Batch at capacity (5/5)"
    }
  ],
  "blockers": [],
  "warnings": [
    {
      "code": "BATCH_FULL",
      "message": "Current batch at capacity. Will requeue for next planning cycle."
    }
  ],
  "producedFacts": []
}
```

---

## Fixture Design Notes

- All hashes are synthetic 64-character hex strings — they do not
  correspond to real file contents.
- All dates use `2026-05-12` as the anchor to keep fixtures consistent.
- All `source` and `actor` fields use `fixture-*` prefixes to make
  test data visually distinct from production data.
- CVE IDs use the `CVE-2026-99999` sentinel — this is not a real
  vulnerability.
- Opportunity signal IDs use the `opp-fixture*` prefix.
- Idea gate marker IDs use the `idea-fixture*-review` prefix.

---

## References

- [External Intake Executable Loop](external-intake-executable-loop.md) — Full intake loop protocol
- [Opportunity Signal Schema](opportunity-signal-schema.md) — Opportunity signal field definitions
- [Risk Signal Schema](risk-signal-schema.md) — Risk signal field definitions
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Idea gate criteria and result schema
- [Runtime Signal Intake Contract](runtime-signal-intake-contract.md) — Runtime signal envelope rules
- [Gate Result Schema](gate-result-schema.md) — Common gate result JSON schema
