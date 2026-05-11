# Market and Tech Watch Contract

Defines how external signals — competitor moves, framework releases, security advisories, and market shifts — are captured as evidence and routed into the AI-native control plane. External information is never a direct command; it is an input that humans evaluate before it becomes a task.

> **Reference:** [loop-model.md](loop-model.md) for the worker dispatch loop,
> [meta-signals.md](meta-signals.md) for risk-aware prioritization,
> [fact-event-ledger.md](fact-event-ledger.md) for append-only fact recording,
> [docs-authority-map.md](docs-authority-map.md) for folder authority rules.

---

## Core Principle

External reality (market, competitor, framework, security) enters the system as **evidence**, not as a **command**. A worker or human must evaluate the signal before it influences task creation, prioritization, or scope.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  External    │────▶│  Evidence    │────▶│  Human       │────▶│  Task or     │
│  Signal      │     │  Record      │     │  Evaluation  │     │  Dismissal   │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

No arrow in this pipeline is automated end-to-end. The system records and surfaces; humans decide.

---

## Signal Categories

| Category | Examples | Typical Source | Urgency Range |
|----------|----------|----------------|---------------|
| **Market** | Competitor feature launch, pricing change, partnership announcement | Manual observation, news feeds | Low to Medium |
| **Competitor** | New API surface, migration tool, deprecation of shared standard | Release notes, changelogs | Medium |
| **Framework** | Major/minor release, breaking change, security patch, deprecation timeline | npm advisories, GitHub releases, RSS | Medium to High |
| **Security** | CVE in dependency, supply-chain compromise, auth bypass disclosure | npm audit, GitHub advisories, Snyk | High to Critical |

---

## Evidence Record Schema

Each external signal is recorded as a fact event in the append-only ledger
(`.github/ai-state/fact-events.ndjson`) using the `external.signal` event type.

```jsonc
{
  "eventVersion": 1,
  "eventType": "external.signal",
  "subject": "Next.js 15.4 released with Turbopack stable",
  "facts": {
    "category": "framework",
    "source": "https://github.com/vercel/next.js/releases/tag/v15.4.0",
    "severity": "medium",
    "capturedBy": "human",
    "relatedIssue": null,
    "disposition": "pending"
  },
  "capturedAt": "2026-05-12T10:00:00Z",
  "actor": "market-watch"
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `eventType` | string | Always `"external.signal"` |
| `subject` | string | One-line summary of the signal |
| `facts.category` | string | One of: `market`, `competitor`, `framework`, `security` |
| `facts.source` | string | URL or citation for the signal origin |
| `facts.severity` | string | `low`, `medium`, `high`, `critical` |
| `facts.disposition` | string | `pending`, `accepted`, `dismissed`, `superseded` |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `facts.capturedBy` | string | `human` or `automated` (if a scanner produced it) |
| `facts.relatedIssue` | string or null | GitHub issue number if a task was created |
| `facts.notes` | string | Free-text human evaluation notes |

---

## Disposition Lifecycle

```
pending  →  accepted   →  (task created)
         →  dismissed  →  (no action)
         →  superseded →  (replaced by newer signal)
```

| Disposition | Meaning | Who Sets It |
|-------------|---------|-------------|
| `pending` | Recorded, not yet evaluated | Automatic on capture |
| `accepted` | Human reviewed and determined action is needed | Human |
| `dismissed` | Human reviewed and determined no action needed | Human |
| `superseded` | A newer signal covers the same ground | Human or automated dedup |

Workers MUST NOT create tasks from `pending` signals. Only `accepted` signals with a `relatedIssue` may feed into the task queue.

---

## Severity to Priority Mapping

Severity is an input signal. Priority is a human decision. The mapping below is
a recommendation, not a rule — humans override freely.

| Severity | Suggested Response Time | Auto-Escalation |
|----------|------------------------|-----------------|
| `critical` | Same day | Security signals with `critical` severity trigger an immediate issue label (`security:urgent`) |
| `high` | Within 3 days | None |
| `medium` | Within 1 week | None |
| `low` | Backlog | None |

Auto-escalation only applies to the labeling step. Task creation, scoping, and
prioritization remain human-owned.

---

## Integration Points

### Fact Event Ledger

Evidence records are written to the same append-only ledger used by the control
plane. This keeps all observable facts in one auditable stream.

```bash
# Record a framework signal
node scripts/ai/write-fact-event.js --type external.signal \
  --subject "Express 5.0 stable release" \
  --facts '{"category":"framework","source":"https://expressjs.com/","severity":"medium","disposition":"pending"}' \
  --live
```

### Meta Signals

Aggregated evidence counts can feed into the meta-signals calculator as a
risk input. A cluster of `critical` security signals should increase the
`riskScore` in the planning loop.

| Signal Count (last 7 days) | Impact on riskScore |
|----------------------------|---------------------|
| 0 | None |
| 1-2 `critical` | +20 |
| 3+ `critical` | +40 |
| 5+ `high` | +15 |

These weights are advisory. The meta-signals calculator does not currently
consume `external.signal` events — this is a future integration point.

### Context Bundles

Workers can receive relevant evidence records in their context bundles. The
bundle generator filters by:

- `disposition: accepted` (only evaluated signals)
- `category` matching the worker's domain (e.g., `framework` for a dependency worker)
- Recency (last 30 days by default)

---

## Boundaries

### What the System Automates

- Recording evidence to the fact event ledger.
- Surfacing pending signals in dashboards or context bundles.
- Labeling `critical` security signals for urgency.
- Deduplication of identical signals (same source URL within 7 days).

### What Remains Human-Owned

- Evaluating whether a signal requires action.
- Setting disposition (`accepted`, `dismissed`).
- Creating and scoping issues from accepted signals.
- Determining priority and wave placement.
- Deciding whether a signal changes architecture or just needs a patch.

---

## Automated Scanners (Future)

The contract anticipates automated scanners that feed into the evidence pipeline.
If implemented, scanners MUST:

1. Write events with `facts.capturedBy: "automated"`.
2. Set `disposition: "pending"` — never `accepted`.
3. Include a `source` URL for human verification.
4. Respect the same sanitization rules as the fact event ledger (no secrets, truncated strings).
5. Not trigger task creation directly.

### Scanner Sources (candidates)

| Source | Category | Frequency | Status |
|--------|----------|-----------|--------|
| `npm audit` | security | Daily | Not implemented |
| GitHub Dependabot | security | On advisory | Not implemented |
| npm registry diff | framework | Weekly | Not implemented |
| Manual entry | all | Ad-hoc | Supported via `write-fact-event.js` |

---

## Failure Modes

| Failure | System Behavior | Human Action |
|---------|-----------------|--------------|
| Signal recorded with wrong severity | Record persists; severity is editable | Update the event or create a corrected follow-up |
| Pending signal never evaluated | Stale after 30 days; flagged in dashboard | Review and disposition |
| Duplicate signals from different sources | Dedup by source URL; manual merge for different URLs | Dismiss duplicate, link to primary |
| Scanner produces false positive | Recorded as `pending` with `capturedBy: automated` | Dismiss; tune scanner if recurring |

---

## References

- [fact-event-ledger.md](fact-event-ledger.md) — Append-only fact recording
- [meta-signals.md](meta-signals.md) — Risk-aware prioritization signals
- [context-bundle-fact-projection.md](context-bundle-fact-projection.md) — Worker context assembly
- [loop-model.md](loop-model.md) — Worker dispatch loop
- [docs-authority-map.md](docs-authority-map.md) — Folder authority rules
