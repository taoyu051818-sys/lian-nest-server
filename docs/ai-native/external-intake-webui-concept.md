# External Intake WebUI Concept

Defines future WebUI views for ingesting external facts, opportunity signals, risk signals, and evidence into the AI-native control plane.

> **Status:** Concept. No implementation exists yet.
>
> **Reference:** [loop-model.md](loop-model.md) for the self-cycle runner,
> [planning-loop.md](planning-loop.md) for batch planning,
> [fact-event-ledger.md](fact-event-ledger.md) for the append-only event log,
> [meta-signals.md](meta-signals.md) for health/risk scoring,
> [gap-ledger.md](gap-ledger.md) for gap event recording.

---

## Purpose

The AI-native control plane currently consumes internal signals: health checks,
worker heartbeats, meta-signals, and gap ledger entries. External information —
market events, competitor moves, customer feedback, regulatory changes — enters
the system only through human-authored GitHub issues.

This concept defines WebUI views that let operators and automated feeders
introduce external information as **evidence** (not commands), so the planning
loop can factor it into prioritization without bypassing existing gates.

---

## Design Principles

| Principle | Meaning |
|-----------|---------|
| **Evidence, not commands** | External intake items are observations. They never directly launch workers, merge PRs, or mutate state. The planning loop decides whether and how to act. |
| **Gate-compatible** | Intake items flow through the same launch gate, conflict group, and health policy checks as internally-generated tasks. No bypass. |
| **Append-only provenance** | Every intake item is recorded in the fact event ledger before it can influence planning. This preserves auditability. |
| **Human-owned triage** | The WebUI presents intake items for operator review. Auto-classification is advisory; the operator confirms before an item becomes a task candidate. |
| **No secrets in intake** | External data is sanitized on entry. URLs, credentials, and raw payloads are never stored in state files. |

---

## WebUI Views

### 1. External Fact Intake

**Purpose:** Capture discrete external observations (market events, regulatory
changes, dependency advisories) as structured evidence.

**Fields:**

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `source` | string | yes | Origin of the fact (e.g. `rss-feed`, `manual`, `webhook`, `email-forward`) |
| `category` | string | yes | Domain classification: `market`, `regulatory`, `dependency`, `competitor`, `customer`, `internal` |
| `summary` | string | yes | One-line description of the fact (max 280 chars) |
| `evidenceUrl` | string | no | Link to source material (sanitized, no auth tokens) |
| `severity` | string | no | Operator-assessed impact: `low`, `medium`, `high`, `critical` |
| `tags` | string[] | no | Freeform labels for filtering |

**Behavior:**

1. Operator fills the form or a webhook posts to the intake endpoint.
2. The item is written to the fact event ledger as `external.intake` with full
   provenance (`source`, `capturedAt`, `actor`).
3. The item appears in the "Pending Triage" queue (View 5).
4. Operator classifies the item as actionable (creates a task candidate) or
   informational (archives it).

**Ledger event shape:**

```json
{
  "eventVersion": 1,
  "eventType": "external.intake",
  "subject": "New regulation affects auth flow",
  "facts": {
    "source": "manual",
    "category": "regulatory",
    "severity": "high",
    "evidenceUrl": "https://example.com/reg-123",
    "tags": ["compliance", "auth"]
  },
  "capturedAt": "2026-05-12T10:00:00Z",
  "actor": "webui-intake-form"
}
```

---

### 2. Opportunity Signal Tracker

**Purpose:** Track potential improvement opportunities surfaced from external
sources or internal analysis that don't map to existing issues.

**Fields:**

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `title` | string | yes | Short opportunity description |
| `sourceIntakeId` | string | no | Link to the originating `external.intake` event |
| `impactEstimate` | string | no | Operator estimate: `low`, `medium`, `high` |
| `effortEstimate` | string | no | Operator estimate: `small`, `medium`, `large` |
| `relatedModules` | string[] | no | Affected code modules or doc areas |
| `status` | string | yes | `proposed`, `accepted`, `rejected`, `converted` |

**Lifecycle:**

```
proposed → accepted → converted (becomes a GitHub issue/task candidate)
proposed → rejected (archived with reason)
```

**Behavior:**

1. Operator creates an opportunity from the intake form or directly.
2. The opportunity is recorded as `external.opportunity` in the fact event ledger.
3. When accepted, the operator can one-click create a GitHub issue with the
   opportunity context pre-filled in the CONTROL APPENDIX.
4. Status transitions are append-only events in the ledger.

---

### 3. Risk Signal Dashboard

**Purpose:** Surface external risk signals alongside internal meta-signals so
operators can see the full risk picture before launching a batch.

**Data sources:**

| Source | Signal Type | Refresh |
|--------|------------|---------|
| Meta-signals calculator | `failureScore`, `frictionScore`, `riskScore`, `trust` | On batch completion |
| Gap ledger | `worker-failed`, `health-gate-fail`, `launch-blocked` | Append-only |
| External intake | Severity-weighted count of untriaged items | On intake |
| Opportunity tracker | Count of high-impact unaccepted opportunities | On change |

**Dashboard layout:**

```
┌─────────────────────────────────────────────────────┐
│  Risk Signal Dashboard                              │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Internal      │  │ External     │  │ Combined  │ │
│  │ Risk Score: 45│  │ Intake: 3    │  │ Trust: 55 │ │
│  │ Top Pain:     │  │ Untriaged    │  │           │ │
│  │  runtime      │  │ Severity: 2h │  │           │ │
│  │  compile      │  │ 1m 1l        │  │           │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│                                                     │
│  Recent External Intake          Recent Gaps        │
│  ┌───────────────────────┐  ┌────────────────────┐ │
│  │ [high] New regulation │  │ [critical] health  │ │
│  │  affects auth flow    │  │  gate: tsc failed  │ │
│  │ [medium] Competitor X │  │ [high] worker #398 │ │
│  │  launched feature Y   │  │  stale > 10min     │ │
│  └───────────────────────┘  └────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Behavior:**

1. Reads meta-signals JSON (`.github/ai-state/meta-signals.json`).
2. Reads gap ledger (`.github/ai-state/gap-ledger.ndjson`).
3. Reads untriaged external intake items from fact event ledger.
4. Combines into a single risk view. External severity is additive to the
   internal risk score but does not override it.
5. Operators use this view to decide whether to proceed with the next batch,
   pause for triage, or escalate.

---

### 4. Evidence Review Panel

**Purpose:** Let operators inspect the evidence attached to an intake item
before deciding how to act on it.

**Fields displayed:**

| Field | Source |
|-------|--------|
| Intake summary | `external.intake` event `subject` |
| Source and category | `external.intake` event `facts` |
| Evidence URL | `external.intake` event `facts.evidenceUrl` |
| Recorded timestamp | `external.intake` event `capturedAt` |
| Related opportunities | Linked via `sourceIntakeId` |
| Related issues | Linked via CONTROL APPENDIX reference |

**Actions available:**

| Action | Effect |
|--------|--------|
| Create opportunity | Opens the opportunity form pre-filled from intake context |
| Create issue | Opens the issue form with CONTROL APPENDIX pre-filled |
| Archive | Marks intake as `reviewed-no-action`, appends ledger event |
| Escalate | Marks intake as `escalated`, surfaces on risk dashboard |

---

### 5. Pending Triage Queue

**Purpose:** Unified queue of all unprocessed external intake items, sorted by
severity and age.

**Sort order:**

1. Severity descending (`critical` > `high` > `medium` > `low`)
2. Age descending (oldest first within same severity)

**Filters:**

| Filter | Values |
|--------|--------|
| Category | `market`, `regulatory`, `dependency`, `competitor`, `customer`, `internal` |
| Source | `manual`, `rss-feed`, `webhook`, `email-forward` |
| Severity | `low`, `medium`, `high`, `critical` |
| Age | `< 1h`, `< 24h`, `< 7d`, `> 7d` |

**Behavior:**

1. Reads `external.intake` events from the fact event ledger.
2. Excludes items that have been triaged (have a subsequent `external.triage`
   event).
3. Displays count badge in the dashboard header.
4. Clicking an item opens the Evidence Review Panel (View 4).

---

## Integration with Existing Systems

### Fact Event Ledger

All external intake actions write append-only events to
`.github/ai-state/fact-events.ndjson`. New event types:

| Event Type | When |
|------------|------|
| `external.intake` | New external fact submitted |
| `external.opportunity` | Opportunity created from intake |
| `external.triage` | Intake item triaged (accepted, archived, escalated) |
| `external.escalate` | Intake item escalated to risk dashboard |

### Planning Loop

The planning loop (`plan-next-batch.ps1`) can optionally read accepted
opportunities as task candidates. This is a future extension — the initial
concept keeps intake and planning decoupled.

### Meta-Signals

External intake severity contributes to the risk signal as an additive factor:

```
combinedRisk = internalRiskScore + (untriagedHighSeverityCount * 5)
```

This is advisory. The meta-signals calculator does not mutate the internal
risk score; the WebUI computes the combined value at display time.

### Gap Ledger

If an external intake item is escalated and no action is taken within a
configurable window (default: 7 days), a `plan-drift` gap entry is recorded
automatically.

---

## Boundaries

### What the Intake WebUI Does

- Captures external information as structured evidence.
- Provides triage, classification, and review workflows.
- Surfaces external risk alongside internal signals.
- Links intake items to opportunities and issues.

### What the Intake WebUI Does Not Do

- Launch workers or merge PRs directly.
- Bypass the launch gate, health policy, or conflict group checks.
- Store raw external payloads, credentials, or unredacted content.
- Auto-create issues without operator confirmation.
- Modify meta-signals, gap ledger, or fact event ledger outside the defined
  event types.

---

## Implementation Status

| View | Status | Notes |
|------|--------|-------|
| External Fact Intake form | **Concept** | Requires intake endpoint and WebUI form |
| Opportunity Signal Tracker | **Concept** | Requires opportunity state store |
| Risk Signal Dashboard | **Concept** | Extends existing dashboard state emitter |
| Evidence Review Panel | **Concept** | Read-only view over fact event ledger |
| Pending Triage Queue | **Concept** | Read-only filtered view over fact event ledger |

---

## References

- [Loop Model](loop-model.md) — Self-cycle runner phases and boundaries.
- [Planning Loop](planning-loop.md) — Batch planning and prioritization.
- [Fact Event Ledger](fact-event-ledger.md) — Append-only event log.
- [Meta Signals](meta-signals.md) — Health/risk signal calculator.
- [Gap Ledger](gap-ledger.md) — Gap event recording.
- [Control Plane Dashboard State Actions](control-plane-dashboard-state-actions.md) — Existing dashboard action readiness.
- [Meta-Signal Task Suggestions](meta-signal-task-suggestions.md) — Next-task suggestion engine.
