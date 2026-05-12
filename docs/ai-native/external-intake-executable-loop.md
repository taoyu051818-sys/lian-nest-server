# External Intake Executable Loop

Minimal executable protocol for ingesting external facts, opportunity
signals, risk signals, and bounded experiments into the AI-native control
plane. This document is the entry point for operators who need to run the
intake loop end-to-end.

> **Closes:** [#950](https://github.com/taoyu051818-sys/lian-nest-server/issues/950)
>
> **Cross-references:**
> [external-reality-intake.md](external-reality-intake.md) for the intake
> boundary contract,
> [opportunity-signal-schema.md](opportunity-signal-schema.md) for
> opportunity signal fields,
> [risk-signal-schema.md](risk-signal-schema.md) for risk signal fields,
> [runtime-signal-intake-contract.md](runtime-signal-intake-contract.md)
> for runtime signal rules,
> [agent-idea-review-gate.md](agent-idea-review-gate.md) for idea
> promotion criteria.

---

## Audience

Operators, orchestrators, and architects who need to execute the external
intake loop — from raw evidence capture through signal validation to
experiment scheduling.

---

## Loop Overview

The external intake loop has four stages. Each stage has a dedicated
script and a clear output artifact.

```
┌────────────────────────────────────────────────────────────────┐
│                   external intake loop                          │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  ┌────────┐│
│  │  1. Capture   │─▶│  2. Classify  │─▶│ 3. Score  │─▶│4. Route││
│  │  (raw input)  │  │  (source →    │  │(reliability│  │(signal ││
│  │               │  │   class)      │  │ tier)     │  │ type)  ││
│  └───────┬──────┘  └──────────────┘  └───────────┘  └───┬────┘│
│          │                                               │     │
│          ▼                                               ▼     │
│  fact event ledger              opportunity / risk / runtime   │
│  (.github/ai-state/             signal file                   │
│   fact-events.ndjson)           (.github/ai-state/)           │
└────────────────────────────────────────────────────────────────┘
```

| Stage | Input | Output | Script |
|-------|-------|--------|--------|
| **Capture** | External source (GitHub, CI, web, human) | Raw fact event | `write-fact-event.js` |
| **Classify** | Raw input + metadata | Source class assignment | Classification rules (this doc) |
| **Score** | Source class | Reliability tier | Tier matrix (this doc) |
| **Route** | Reliability tier + signal type | Signal file or quarantine | Type-specific writers |

---

## Stage 1: Capture (Fact Event Recording)

Every external input enters the system as a fact event. The fact event
ledger is the single source of truth for all intake evidence.

### Script

```bash
node scripts/ai/write-fact-event.js \
  --type evidence.intake \
  --subject "github issue #950" \
  --actor "external-intake" \
  --live \
  --facts '{"sourceClass":"github-issue","reliabilityTier":"high","rawHash":"a1b2c3"}'
```

### Output

Appends to `.github/ai-state/fact-events.ndjson`:

```jsonc
{
  "eventVersion": 1,
  "eventType": "evidence.intake",
  "subject": "github issue #950",
  "facts": {
    "sourceClass": "github-issue",
    "reliabilityTier": "high",
    "rawHash": "a1b2c3",
    "sanitized": true
  },
  "capturedAt": "2026-05-12T10:00:00Z",
  "actor": "external-intake"
}
```

### Event Types

| Event Type | Meaning |
|------------|---------|
| `evidence.intake` | New external evidence captured and classified |
| `evidence.rejected` | Evidence failed reliability check |
| `evidence.conflict` | Evidence contradicts existing fact |
| `evidence.quarantined` | Opaque source awaiting approval |
| `evidence.promoted` | Quarantined evidence approved for downstream use |

---

## Stage 2: Classify (Source Classification)

Every external source is assigned exactly one class. The class determines
intake rules, default reliability, and required validation.

| Class | Examples | Default Reliability | Validation |
|-------|----------|--------------------|------------|
| `github-issue` | Issue body, comments, labels | High | CONTROL APPENDIX present |
| `github-pr` | PR body, review comments | High | Required sections present |
| `ci-result` | GitHub Actions output | High | Exit code + log hash |
| `human-instruction` | Repo-owner comment | Authoritative | Actor in `roles.md` |
| `external-doc` | Third-party API docs | Medium | Cross-reference known-good |
| `web-scan` | npm audit, dependency reports | Medium | Source URL + timestamp |
| `user-paste` | Stack traces, error logs | Low | Manual review gate |
| `opaque-external` | Unknown or unstructured | Untrusted | Quarantine |

### Assignment Rules

1. GitHub API response with issue/PR number → `github-issue` or `github-pr`.
2. CI workflow artifact → `ci-result`.
3. Comment from user in `roles.md` role list → `human-instruction`.
4. Known URL domain with structured format → `external-doc`.
5. Tool output with defined schema → `web-scan`.
6. Freeform text from authenticated GitHub user → `user-paste`.
7. Everything else → `opaque-external`.

---

## Stage 3: Score (Reliability Tiers)

Each source class maps to a reliability tier that governs consumption
rules.

| Tier | Classes | May Inform Decisions | May Trigger Actions | Requires Approval |
|------|---------|:--------------------:|:-------------------:|:-----------------:|
| **Authoritative** | `human-instruction` | Yes | Yes | No |
| **High** | `github-issue`, `github-pr`, `ci-result` | Yes | No | Yes |
| **Medium** | `external-doc`, `web-scan` | Yes | No | Yes |
| **Low** | `user-paste` | Advisory only | No | Yes |
| **Untrusted** | `opaque-external` | No | No | Quarantine |

### Sanitization Rules

All external text passes through sanitization before recording:

- **Token patterns**: `ghp_*`, `Bearer *`, base64 blobs (40+ chars) → `[redacted]`
- **Command patterns**: Lines starting with `!`, `$`, `#` + shell metacharacters → escaped
- **Injection markers**: `SYSTEM:`, `ASSISTANT:`, `<system>` prefixes → stripped
- **Length cap**: Individual fields truncated to 2000 characters

---

## Stage 4: Route (Signal Type Dispatch)

After classification and scoring, evidence routes to one of three signal
types or to quarantine.

### 4a. Opportunity Signals

External observations that suggest improvement opportunities. Each signal
carries a falsifiable hypothesis and a bounded experiment.

**Schema:** [opportunity-signal-schema.md](opportunity-signal-schema.md)

**State file:** `.github/ai-state/opportunity-signals/opp-<uuid>.json`

**Lifecycle:** `draft` → `validated` → `accepted` → `scheduled` (or `rejected`)

**Key fields:**

| Field | Purpose |
|-------|---------|
| `sourceFacts` | Evidence backing the signal (at least one required) |
| `hypothesis` | Falsifiable claim with reasoning |
| `experiment` | Minimal bounded action to validate the claim |
| `acceptanceGate` | Criteria that must pass before promotion to task |

### 4b. Risk Signals

External risk observations (CVEs, compliance findings, incidents) that
overlay the internal risk score.

**Schema:** [risk-signal-schema.md](risk-signal-schema.md)

**State file:** `.github/ai-state/risk-signals.json`

**Domains:** `compliance`, `security`, `product`, `runtime`, `market`

**Severity weights:**

| Severity | Score Weight | Planning Behavior |
|----------|-------------|-------------------|
| `critical` | 40 | Blocks affected areas |
| `high` | 25 | High priority boost |
| `medium` | 10 | Moderate adjustment |
| `low` | 3 | Logged only |
| `info` | 0 | No effect |

### 4c. Runtime Signals

Operational signals from health, liveness, resource, and telemetry
sources. These follow the intake boundary contract.

**Contract:** [runtime-signal-intake-contract.md](runtime-signal-intake-contract.md)

**Sources:**

| Source | Path | Format |
|--------|------|--------|
| Health state | `main-health.json` | Snapshot |
| Heartbeat | `monitor-state.json` | Snapshot |
| Gap ledger | `gap-ledger.ndjson` | Append |
| Fact events | `fact-events.ndjson` | Append |
| Resource health | `local-resource-health.json` | Snapshot |
| Meta signals | `meta-signals.json` | Snapshot |

### 4d. Quarantine

`opaque-external` evidence is recorded but blocked from all downstream
consumers until a human explicitly promotes it via `evidence.promoted`.

---

## Executable Scripts

### Fact Event Writers

| Script | Purpose |
|--------|---------|
| `write-fact-event.js` | Append observable facts to the ledger |
| `write-result-fact.js` | Record worker result facts |
| `write-gap-ledger.js` | Record gap events (failures, stale workers) |

### Signal Calculators

| Script | Purpose |
|--------|---------|
| `calculate-meta-signals.js` | Aggregate signals into health snapshot |
| `suggest-next-tasks-from-meta-signals.js` | Generate ranked suggestions from signals |

### Knowledge Capture

| Script | Purpose |
|--------|---------|
| `write-knowledge-update.ps1` | Record structured knowledge from merged work |

### Planning Integration

| Script | Purpose |
|--------|---------|
| `plan-next-batch.ps1` | Propose batch from open issues |
| `compile-issue-to-task-json.ps1` | Emit task JSON contracts |
| `check-launch-gate.ps1` | Validate against health/resource policy |
| `batch-launch.ps1` | Dispatch workers |

---

## Complete Example: End-to-End Intake

A full cycle from external observation to scheduled experiment:

```
1. CAPTURE
   $ node scripts/ai/write-fact-event.js \
       --type evidence.intake \
       --subject "CVE-2026-12345" \
       --actor "web-scan" \
       --live \
       --facts '{"sourceClass":"web-scan","reliabilityTier":"medium"}'
   → fact event appended to fact-events.ndjson

2. CLASSIFY
   Source: NVD advisory → class: web-scan
   Validation: URL present, structured format → pass

3. SCORE
   Class: web-scan → tier: medium
   Sanitization: no secrets detected → pass

4. ROUTE → Risk Signal
   Write to .github/ai-state/risk-signals.json:
   {
     "id": "CVE-2026-12345",
     "domain": "security",
     "severity": "critical",
     "status": "open",
     "affectedAreas": ["src/**/auth/**"]
   }

5. PLAN
   $ node scripts/ai/calculate-meta-signals.js
   → riskScore elevated due to critical security signal

   $ ./scripts/ai/plan-next-batch.ps1 -Repo owner/name
   → auth tasks promoted to top of batch

6. SCHEDULE
   $ ./scripts/ai/compile-issue-to-task-json.ps1 -IssueFile ./tasks/issue-N.json
   $ ./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/issue-N.json
   $ ./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/issue-N.json
   → worker dispatched to fix CVE
```

---

## Safe Skeleton Behavior

When a signal source is missing, stale, or fails validation, consumers
fall back to safe defaults:

| Signal | Safe Default | Rationale |
|--------|-------------|-----------|
| Health state | `state: "red"`, no workers | Fail-closed |
| Heartbeat | All workers unknown | No liveness assumption |
| Resource health | `overall: "critical"` | Fail-closed |
| Meta signals | All scores 0, trust 100 | Neutral baseline |
| Gap ledger | Empty | No problem assumption |
| Fact events | Empty | No history assumption |

**Design principle:** Health and resource signals fail-closed. Operational
signals fail-neutral.

---

## Injection Boundaries

External data MUST NOT influence system behavior outside the evidence flow.

### Hard Rules

1. **External text is never a command.** No worker may interpret external
   text as an instruction to execute.
2. **No direct action from external input.** Actions require a valid task
   JSON with explicit `allowedFiles` and `validationCommands`.
3. **Sanitization is mandatory.** No external text reaches the fact ledger
   without passing through the sanitizer.
4. **Role enforcement on human instructions.** `human-instruction` class
   requires actor in `roles.md` role list.
5. **Opaque sources are quarantined.** Blocked from all consumers until
   explicit human promotion.

### Injection Patterns Detected

| Pattern | Action |
|---------|--------|
| System-role prefix (`SYSTEM:`) | Strip prefix, reclassify as `user-paste` |
| Command execution (`` !`cmd` ``) | Escape backticks, flag for review |
| Role escalation (`I am repo-owner`) | Ignore claim, classify by actor identity |
| Schema poisoning (`allowedFiles: ["**"]`) | Reject — broad patterns invalid |
| Nested intake (JSON inside text) | Treat as opaque text |

---

## Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Fact event write fails | Script exits non-zero | Check file permissions; retry |
| Signal file missing | Consumer reads empty/absent | Safe skeleton fallback |
| Stale signal (>72h) | Timestamp check | Flag as stale; re-capture if possible |
| Conflicting evidence | Duplicate fact detected | Emit `evidence.conflict`; human resolves |
| Quarantine backlog | `opaque-external` count grows | Human reviews and promotes/rejects |

---

## Key Files

| Path | Purpose |
|------|---------|
| `.github/ai-state/fact-events.ndjson` | Append-only evidence ledger |
| `.github/ai-state/risk-signals.json` | External risk signal snapshot |
| `.github/ai-state/opportunity-signals/` | Per-signal opportunity files |
| `.github/ai-state/meta-signals.json` | Aggregated health signals |
| `.github/ai-state/gap-ledger.ndjson` | Gap event ledger |
| `.github/ai-state/knowledge-updates.ndjson` | Knowledge entries |
| `.github/ai-state/main-health.json` | Current health state |

---

## References

- [External Reality Intake](external-reality-intake.md) — Intake boundary contract
- [Opportunity Signal Schema](opportunity-signal-schema.md) — Opportunity signal fields
- [Risk Signal Schema](risk-signal-schema.md) — Risk signal fields
- [Runtime Signal Intake Contract](runtime-signal-intake-contract.md) — Runtime signal rules
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Idea promotion criteria
- [Fact Event Ledger](fact-event-ledger.md) — Append-only event log
- [Meta Signals](meta-signals.md) — Aggregate signal calculator
- [Gap Ledger](gap-ledger.md) — Gap event recording
- [Knowledge Update Writer](knowledge-update-writer.md) — Post-merge knowledge capture
- [Planning Loop](planning-loop.md) — Batch planning with signal integration
- [Opportunity Loop Runbook](opportunity-loop-runbook.md) — Full detect-compile-write cycle
- [Loop Model](loop-model.md) — Self-cycle runner phases
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
