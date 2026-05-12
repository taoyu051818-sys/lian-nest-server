# External Intake WebUI Actions

Defines preview-first WebUI actions for adding external facts, calculating
signals, and reviewing agent ideas through the external intake pipeline.

> **Closes:** [#983](https://github.com/taoyu051818-sys/lian-nest-server/issues/983)
>
> **Cross-references:**
> [external-intake-webui-concept.md](external-intake-webui-concept.md) for
> view definitions,
> [webui-action-module-registry.md](webui-action-module-registry.md) for the
> module contract,
> [external-intake-executable-loop.md](external-intake-executable-loop.md) for
> the intake pipeline,
> [external-reality-intake.md](external-reality-intake.md) for intake
> boundary rules.

---

## Purpose

The external intake pipeline currently runs through CLI scripts
(`write-fact-event.js`, `calculate-meta-signals.js`, etc.). These WebUI
actions expose the same operations through the control console with
preview-first safety: every mutation shows a dry-run result before the
operator can confirm execution.

No action bypasses the launch gate, health policy, or conflict group
checks.

---

## Design Principles

| Principle | Meaning |
|-----------|---------|
| **Preview-first** | Every mutating action defaults to `preview()`. Execute requires explicit `confirm: true`. |
| **Evidence, not commands** | Actions write evidence to the fact event ledger. They never directly launch workers or merge PRs. |
| **No direct execution bypass** | The execute path runs the same script as the CLI. There is no shortcut that skips sanitization or validation. |
| **Dangerous flag on writes** | Any action that appends to `.github/ai-state/` files sets `dangerous: true`. |
| **Audit trail** | Every execute call produces an audit entry with timestamp, action ID, and result hash. |

---

## Action Modules

### 1. intake.add-fact

**Purpose:** Capture an external observation as a fact event in the ledger.

| Field | Value |
|-------|-------|
| ID | `intake.add-fact` |
| Dangerous | Yes |
| Script | `scripts/ai/write-fact-event.js` |
| Risk level | Medium |
| Privileged | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `subject` | string | yes | One-line description of the fact |
| `source` | string | yes | Origin: `manual`, `rss-feed`, `webhook`, `email-forward` |
| `category` | string | yes | Domain: `market`, `regulatory`, `dependency`, `competitor`, `customer`, `internal` |
| `severity` | string | no | Impact: `low`, `medium`, `high`, `critical` |
| `evidenceUrl` | string | no | Link to source material (sanitized) |
| `tags` | string[] | no | Freeform labels |

**Preview** builds the fact event JSON, runs sanitization, and returns the
proposed ledger entry with `dryRun: true`. No file is written.

**Execute** invokes `write-fact-event.js --live` with the sanitized payload.
Appends to `.github/ai-state/fact-events.ndjson`. Returns the recorded
event with `capturedAt` timestamp.

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

### 2. intake.calculate-signals

**Purpose:** Generate a meta-signals snapshot from planning feedback,
health checks, and gap ledger entries.

| Field | Value |
|-------|-------|
| ID | `intake.calculate-signals` |
| Dangerous | No |
| Script | `scripts/ai/calculate-meta-signals.js` |
| Risk level | Low |
| Privileged | No |

**Parameters:** None. Reads from existing `.github/ai-state/` files.

**Preview** and **Execute** both invoke the calculator and return the
resulting snapshot. This is a read-transform operation — it overwrites
`.github/ai-state/meta-signals.json` but does not append to the ledger.
The action is non-dangerous because the output is deterministic and
idempotent.

**Result shape:**

```json
{
  "failureScore": 12,
  "frictionScore": 8,
  "riskScore": 45,
  "cost": 3,
  "trust": 72,
  "topPain": ["runtime", "compile"],
  "calculatedAt": "2026-05-12T10:05:00Z"
}
```

---

### 3. intake.suggest-tasks

**Purpose:** Generate ranked next-task suggestions from the current
meta-signals snapshot.

| Field | Value |
|-------|-------|
| ID | `intake.suggest-tasks` |
| Dangerous | No |
| Script | `scripts/ai/suggest-next-tasks-from-meta-signals.js` |
| Risk level | Low |
| Privileged | No |

**Parameters:** None. Reads `.github/ai-state/meta-signals.json`.

**Preview** and **Execute** both invoke the suggestion engine and return
the ranked list. This is a read-only operation — the output goes to
`.github/ai-state/next-task-suggestions.json` but does not create issues
or mutate state.

**Result shape:**

```json
{
  "suggestions": [
    {
      "category": "runtime",
      "title": "Fix health gate timeout",
      "reason": "failureScore elevated from 5 to 12",
      "confidence": 85,
      "priority": 1,
      "signals": { "failureScore": 12, "trust": 72 }
    }
  ],
  "generatedAt": "2026-05-12T10:06:00Z"
}
```

---

### 4. intake.opportunity-signals

**Purpose:** Calculate opportunity signal candidates from fact events and
meta-signals.

| Field | Value |
|-------|-------|
| ID | `intake.opportunity-signals` |
| Dangerous | No |
| Script | `scripts/ai/calculate-opportunity-signals.js` |
| Risk level | Low |
| Privileged | No |

**Parameters:** None. Reads fact events and meta-signals from
`.github/ai-state/`.

**Preview** and **Execute** both invoke the calculator. Output goes to
`.github/ai-state/opportunity-signals/`. Signals are created in `draft`
status — they do not become task candidates until an operator validates
them through the opportunity lifecycle.

**Result shape:**

```json
{
  "signals": [
    {
      "signalId": "opp-a1b2c3",
      "status": "draft",
      "sourceFacts": ["fact-event-2026-05-12-001"],
      "hypothesis": "Auth flow can be simplified based on regulatory change",
      "confidence": 60
    }
  ],
  "count": 1,
  "calculatedAt": "2026-05-12T10:07:00Z"
}
```

---

### 5. intake.idea-gate

**Purpose:** Evaluate an agent-generated idea candidate against the five
gate criteria before it becomes a GitHub issue.

| Field | Value |
|-------|-------|
| ID | `intake.idea-gate` |
| Dangerous | No |
| Script | `scripts/ai/check-agent-idea-gate.js` |
| Risk level | Low |
| Privileged | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `candidate` | object | yes | Idea candidate JSON (title, hypothesis, scope, affected areas) |

**Preview** and **Execute** both run the gate check and return the result.
This is a read-evaluate operation — it writes the gate result to
`.github/ai-state/agent-idea-gate-result.json` but does not create issues.

**Gate criteria:**

| Criterion | What it checks |
|-----------|---------------|
| Signal quality | Grounded in observable signals, current within 7 days |
| Novelty check | No duplicate issue, no in-flight worker |
| Scope feasibility | Bounded files (1-10), single responsibility |
| Architectural fit | Module boundaries respected |
| Resource availability | Main health permits, no conflict group collision |

**Result shape:**

```json
{
  "gateType": "idea-review",
  "decision": "promote",
  "criteria": {
    "signalQuality": { "pass": true, "reason": "Grounded in fact-event-001" },
    "noveltyCheck": { "pass": true, "reason": "No duplicate found" },
    "scopeFeasibility": { "pass": true, "reason": "3 files affected" },
    "architecturalFit": { "pass": true, "reason": "Within auth module" },
    "resourceAvailability": { "pass": true, "reason": "Health green" }
  },
  "evaluatedAt": "2026-05-12T10:08:00Z"
}
```

**Decisions:** `promote` (all pass), `defer` (has defer reasons),
`reject` (has block reasons), `warn` (pass with warnings).

---

### 6. intake.triage

**Purpose:** Record a triage decision on an existing intake item (accept,
archive, or escalate).

| Field | Value |
|-------|-------|
| ID | `intake.triage` |
| Dangerous | Yes |
| Script | `scripts/ai/write-fact-event.js` |
| Risk level | Medium |
| Privileged | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `intakeId` | string | yes | ID of the `external.intake` event to triage |
| `decision` | string | yes | `accept`, `archive`, or `escalate` |
| `reason` | string | no | Operator note explaining the decision |

**Preview** builds the triage event and returns the proposed ledger entry
with `dryRun: true`. Shows the current intake item for context.

**Execute** invokes `write-fact-event.js --live` to record the triage
event. The event type depends on the decision:

| Decision | Event type | Effect |
|----------|-----------|--------|
| `accept` | `external.triage` | Intake becomes a task candidate |
| `archive` | `external.triage` | Intake marked as reviewed, no further action |
| `escalate` | `external.escalate` | Intake surfaces on risk dashboard |

---

## Action Summary

| ID | Label | Dangerous | Risk | Script |
|----|-------|:---------:|------|--------|
| `intake.add-fact` | Add External Fact | Yes | Medium | `write-fact-event.js` |
| `intake.calculate-signals` | Calculate Meta-Signals | No | Low | `calculate-meta-signals.js` |
| `intake.suggest-tasks` | Suggest Next Tasks | No | Low | `suggest-next-tasks-from-meta-signals.js` |
| `intake.opportunity-signals` | Calculate Opportunity Signals | No | Low | `calculate-opportunity-signals.js` |
| `intake.idea-gate` | Check Idea Gate | No | Low | `check-agent-idea-gate.js` |
| `intake.triage` | Triage Intake Item | Yes | Medium | `write-fact-event.js` |

---

## Preview-First Flow

All actions follow the same preview-first contract defined in
[webui-action-module-registry.md](webui-action-module-registry.md):

```
1. Client calls POST /api/actions/preview
   └─ Module.preview(payload) called
   └─ Returns dry-run result with dryRun: true

2. Operator reviews preview (blue badge in UI)

3. Client calls POST /api/actions/execute
   └─ Server checks dangerous flag
   └─ If dangerous && confirm != true → 409 Conflict
   └─ Module.execute(payload) called
   └─ Audit entry written
```

Dangerous actions (`intake.add-fact`, `intake.triage`) require
`confirm: true` in the execute request. Non-dangerous actions
(`intake.calculate-signals`, `intake.suggest-tasks`,
`intake.opportunity-signals`, `intake.idea-gate`) execute without
confirmation but still produce audit entries.

---

## Boundaries

### What These Actions Do

- Write evidence to the fact event ledger.
- Calculate signals from existing state files.
- Evaluate idea candidates against gate criteria.
- Record triage decisions as ledger events.

### What These Actions Do Not Do

- Launch workers or merge PRs.
- Bypass the launch gate, health policy, or conflict group checks.
- Create GitHub issues without operator confirmation through a separate
  action (`create-issues`).
- Modify meta-signals or opportunity signals outside the defined scripts.
- Accept raw external payloads without sanitization.

---

## References

- [External Intake WebUI Concept](external-intake-webui-concept.md) — View definitions and integration points
- [WebUI Action Module Registry](webui-action-module-registry.md) — Module contract and ID naming
- [WebUI Action Contract](webui-action-contract.md) — Request/result/audit pipeline
- [WebUI Action Runner](webui-action-runner.md) — Safe execution layer
- [External Intake Executable Loop](external-intake-executable-loop.md) — CLI pipeline
- [External Reality Intake](external-reality-intake.md) — Intake boundary contract
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Idea promotion criteria
- [Opportunity Signal Schema](opportunity-signal-schema.md) — Signal lifecycle and fields
