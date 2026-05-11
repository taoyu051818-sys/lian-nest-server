# User Feedback Intake Contract

Defines how external user feedback enters the AI-native control plane, the
reliability classification of each source, the privacy boundaries that govern
storage, and the conversion path from raw feedback to actionable opportunities.

> **Closes:** [#901](https://github.com/taoyu051818-sys/lian-nest-server/issues/901)
>
> **Reference:** [fact-event-ledger.md](fact-event-ledger.md) for the append-only
> event store, [meta-signals.md](meta-signals.md) for signal aggregation,
> [issue-lifecycle.md](issue-lifecycle.md) for issue state machine.

---

## Overview

User feedback is external evidence about product behavior, pain points, and
feature requests. This contract ensures that feedback is ingested consistently,
classified by source reliability, stripped of private data before storage, and
routed through a defined conversion path to become tracked work items.

```
┌──────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  Feedback Source │────▶│  Intake Gate      │────▶│  Feedback Ledger │
│  (external)      │     │  (classify + strip)│     │  (NDJSON)        │
└──────────────────┘     └───────────────────┘     └────────┬─────────┘
                                                            │
                                                            ▼
                                                   ┌──────────────────┐
                                                   │  Opportunity     │
                                                   │  Converter       │
                                                   │  (issue creation)│
                                                   └──────────────────┘
```

---

## Source Reliability Tiers

Every feedback entry carries a `sourceTier` that reflects how much the system
trusts the signal. Higher tiers receive more weight in prioritization.

| Tier | Source Examples | Reliability | Weight |
|------|----------------|-------------|--------|
| `T1` | Direct user report with reproduction steps, authenticated support ticket | **High** — actionable as-is | 1.0 |
| `T2` | GitHub issue from known contributor, structured survey response | **Medium-High** — usually actionable, may need clarification | 0.8 |
| `T3` | App store review, social media mention, community forum post | **Medium** — directional signal, requires validation | 0.5 |
| `T4` | Anecdotal hearsay, secondhand report, unattributed comment | **Low** — weak signal, use for pattern detection only | 0.2 |

### Tier Assignment Rules

| Condition | Assigned Tier |
|-----------|---------------|
| Reporter is authenticated AND includes reproduction steps | `T1` |
| Reporter is authenticated AND issue is on GitHub | `T2` |
| Source is a public platform (store review, forum, social) | `T3` |
| Source is unverifiable or secondhand | `T4` |
| Ambiguous source | Default to `T3`, escalate to `T2` if reproduction steps are present |

---

## Ingestion Format

Each feedback entry is a single NDJSON line appended to the feedback ledger.
The format mirrors the fact event schema but uses a dedicated `feedback.*`
event prefix.

### Entry Schema

```jsonc
{
  "eventVersion": 1,
  "eventType": "feedback.intake",
  "subject": "login button unresponsive on mobile Safari",
  "facts": {
    "sourceTier": "T1",
    "sourceType": "github-issue",
    "sourceUrl": null,
    "reporterId": "user-abc",
    "category": "bug",
    "severity": "medium",
    "reproductionSteps": true,
    "environment": {
      "platform": "ios",
      "browser": "safari",
      "version": "17.4"
    },
    "rawExcerpt": "[redacted]",
    "tags": ["mobile", "auth"]
  },
  "capturedAt": "2026-05-12T10:00:00Z",
  "actor": "feedback-ingester"
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `eventVersion` | `number` | yes | Schema version. Currently `1`. |
| `eventType` | `string` | yes | Always `feedback.intake` for ingested feedback. |
| `subject` | `string` | yes | Sanitized one-line summary of the feedback. |
| `facts.sourceTier` | `string` | yes | Reliability tier: `T1`, `T2`, `T3`, `T4`. |
| `facts.sourceType` | `string` | yes | Origin channel: `github-issue`, `support-ticket`, `survey`, `app-review`, `forum`, `social`, `other`. |
| `facts.sourceUrl` | `string \| null` | no | URL to the original feedback, if public. **Must not contain auth tokens or private URLs.** |
| `facts.reporterId` | `string \| null` | no | Anonymized reporter identifier. Never store raw email or PII. |
| `facts.category` | `string` | yes | One of: `bug`, `feature-request`, `ux-friction`, `performance`, `documentation`, `other`. |
| `facts.severity` | `string` | yes | One of: `critical`, `high`, `medium`, `low`. |
| `facts.reproductionSteps` | `boolean` | yes | Whether the feedback includes steps to reproduce. |
| `facts.environment` | `object \| null` | no | Platform/browser/device info if provided. |
| `facts.rawExcerpt` | `string` | yes | Sanitized excerpt of the original feedback text (max 500 chars). |
| `facts.tags` | `string[]` | no | Freeform tags for downstream filtering. |
| `capturedAt` | `string` | yes | ISO-8601 timestamp. |
| `actor` | `string` | yes | Ingestion script or agent identifier. |

### Event Types

| Event Type | When Used |
|------------|-----------|
| `feedback.intake` | New feedback ingested from an external source. |
| `feedback.validated` | Feedback confirmed as reproducible/valid after triage. |
| `feedback.promoted` | Feedback converted to a GitHub issue (opportunity). |
| `feedback.duplicate` | Feedback matched against an existing issue. |
| `feedback.dismissed` | Feedback triaged as out-of-scope or invalid. |

---

## Privacy Boundaries

All feedback passes through a sanitization gate before storage. The gate
enforces these rules:

### Never Store

| Data | Action |
|------|--------|
| Raw email addresses | Replace with `[redacted-email]` |
| Phone numbers | Replace with `[redacted-phone]` |
| Full names (unless public handle) | Replace with `[redacted-name]` |
| Auth tokens, API keys, passwords | Replace with `[redacted-secret]` |
| IP addresses | Replace with `[redacted-ip]` |
| Session IDs or cookies | Replace with `[redacted-session]` |
| Internal URLs with auth parameters | Strip query params, keep path only |
| Full stack traces with local paths | Truncate to function name + error only |

### Allowed (Sanitized)

| Data | Condition |
|------|-----------|
| Public GitHub usernames | Only if sourced from public GitHub issues |
| Anonymized reporter IDs | Hash or opaque identifier, not reversible to PII |
| Public platform handles | Only if the feedback source is a public forum |
| Error messages | Strip local paths, keep error type and message |
| Environment metadata | Platform, browser version, OS version — no device IDs |

### Sanitization Pipeline

```
Raw feedback
    │
    ▼
┌──────────────────────┐
│ 1. PII scanner       │  Regex-based detection of emails, phones, tokens
│ 2. Path stripper     │  Remove local filesystem paths
│ 3. Token redactor    │  Replace auth tokens with placeholders
│ 4. Truncator         │  Cap rawExcerpt at 500 chars
│ 5. Validator         │  Confirm no PII remains before write
└──────────────────────┘
    │
    ▼
Sanitized entry → feedback ledger
```

The same sanitization rules used by the [fact event writer](fact-event-ledger.md#sanitization)
apply to feedback entries. The feedback ingester reuses `write-fact-event.js`
with feedback-specific event types.

---

## Opportunity Conversion

Feedback becomes actionable work through a defined conversion pipeline.
Not all feedback produces an issue — conversion depends on validation,
deduplication, and priority scoring.

### Conversion States

```
INTAKE  →  VALIDATED  →  PROMOTED (issue created)
    \          \
     \          └──→  DISMISSED
      └────────────→  DUPLICATE (merged with existing issue)
```

| State | Meaning | Transition Trigger |
|-------|---------|-------------------|
| `INTAKE` | Feedback ingested, not yet triaged | Automatic on ingestion |
| `VALIDATED` | Confirmed reproducible or high-signal | Manual triage or automated pattern match |
| `PROMOTED` | Converted to a GitHub issue | Triage decision |
| `DUPLICATE` | Matched against an existing issue | Deduplication check |
| `DISMISSED` | Out-of-scope, invalid, or unactionable | Triage decision |

### Conversion Rules

| Condition | Action |
|-----------|--------|
| `T1` + reproduction steps + not duplicate | Promote to issue immediately |
| `T1` + no reproduction steps | Mark `VALIDATED`, request steps, promote when provided |
| `T2` + severity `critical` or `high` | Promote to issue with `priority:high` |
| `T2` + severity `medium` or `low` | Mark `VALIDATED`, batch for next wave |
| `T3` + matches 2+ other `T3` entries on same topic | Promote as aggregated signal |
| `T3` + no pattern match | Hold in ledger, re-evaluate on next planning cycle |
| `T4` | Hold in ledger for pattern detection only |
| Any tier + exact duplicate of existing issue | Mark `DUPLICATE`, link to existing issue |

### Issue Template for Promoted Feedback

When feedback is promoted to a GitHub issue, the issue body follows the
standard [issue template](issue-lifecycle.md#issue-template) with this
additional section:

```markdown
## Feedback Origin
- **Source Tier:** T1
- **Source Type:** github-issue
- **Feedback ID:** <ledger entry capturedAt + subject hash>
- **Reporter:** <anonymized ID>
- **Original Excerpt:** <sanitized, max 500 chars>
```

This section is traceable back to the ledger entry but contains no PII.

---

## Integration

### Fact Event Ledger

Feedback entries are written to the same NDJSON ledger as other fact events
(`.github/ai-state/fact-events.ndjson`) using the `feedback.*` event prefix.
This keeps a single append-only audit trail.

### Meta Signals

Feedback volume and severity feed into the meta-signals calculator:

| Feedback Signal | Impact on Meta-Signals |
|----------------|----------------------|
| ≥ 3 `T1` entries unresolved | `failureScore` +10 |
| ≥ 5 `T3` entries on same topic | `riskScore` +15 |
| `feedback.promoted` count in batch window | `cost` +1 per promoted item |

### Planning Loop

The planning loop consults the feedback ledger when generating next-wave
suggestions. Feedback with high source tiers and unresolved status increases
the priority of related issues in the batch.

### Gap Ledger

If a promoted feedback item fails to convert into a merged PR within 2 waves,
a `plan-drift` gap entry is recorded with the original feedback ID in `meta`.

---

## Design Decisions

- **NDJSON, not separate store.** Feedback shares the fact event ledger to
  keep a single audit trail and reuse existing sanitization, read patterns,
  and downstream consumers.
- **Tiered reliability, not binary trust.** Source tiers let the system weight
  signals without discarding weak evidence. T4 entries are never promoted
  directly but can contribute to pattern detection.
- **Privacy-first ingestion.** All PII is stripped before write. The ledger
  is append-only and never modified — if PII slips through, the entry cannot
  be edited, only followed by a corrective entry.
- **Conversion is human-owned.** Automatic promotion only happens for T1
  entries with reproduction steps. All other conversions require triage.
  This preserves the human-owned product direction boundary from the
  [loop model](loop-model.md#what-remains-human-owned).
- **No external API calls during ingestion.** The ingester is a pure function
  that validates, sanitizes, and appends. External enrichment (deduplication
  search, user lookup) happens in a separate validation step.

---

## References

- [Fact Event Ledger](fact-event-ledger.md) — Append-only NDJSON event store
- [Fact Event Schema](fact-event-schema.md) — JSON schema for event entries
- [Meta Signals](meta-signals.md) — Signal aggregation for planning
- [Gap Ledger](gap-ledger.md) — Gap event recording
- [Issue Lifecycle](issue-lifecycle.md) — Issue state machine and labels
- [Loop Model](loop-model.md) — Self-cycle runner and human-owned boundaries
- [#901](https://github.com/taoyu051818-sys/lian-nest-server/issues/901) — This feature
