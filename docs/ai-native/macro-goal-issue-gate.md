# Macro-Goal Issue Alignment Gate

Defines criteria for evaluating issue candidates against the macro goal of
autonomous self-cycle, Codex exit, and reliable value creation. Sits between
issue proposal and issue creation in the orchestration pipeline — every
issue candidate MUST pass this gate before promotion to a GitHub issue.

> **Closes:** [#1337](https://github.com/taoyu051818-sys/lian-nest-server/issues/1337)
> **See also:** [gate-result-schema.md](gate-result-schema.md) for the
> common gate result JSON schema,
> [agent-idea-review-gate.md](agent-idea-review-gate.md) for the upstream
> idea review gate.

---

## Problem

The self-cycle could request 30 workers but only had 5 executable issues.
Existing generated issues were too shallow and lacked enough evidence and
acceptance structure. This kept Codex in the task-production loop, which
violates the Codex exit objective.

## Solution

A deterministic gate that evaluates every issue candidate against three
criteria before it can become a GitHub issue. Issues that do not advance
the macro goal are blocked. Issues with weak advancement signals produce
warnings that must be addressed before promotion.

---

## Overview

The AI-native control plane produces issue candidates from gap detection,
meta-signal suggestions, and self-cycle planning. Each candidate must
declare which macro goal it serves and provide structured evidence of
its value.

The macro-goal alignment gate evaluates each candidate against:

```
  issue candidate (from propose-self-cycle-issues.js, etc.)
              |
              v
  ┌───────────────────────────────────┐
  │  macro-goal alignment gate        │  ◄── this document
  │                                   │
  │  1. lane alignment                │
  │  2. evidence quality              │
  │  3. advancement rationale         │
  └───────────┬───────────────────────┘
              |
     ┌────────┼────────┐
     v        v        v
   pass     warn     block
     |        |        |
     v        v        v
  issue    issue    logged
  created  with     & dropped
           notes
```

---

## Gate Criteria

Every issue candidate MUST satisfy all three criteria to be promoted.

### 1. Lane Alignment

The candidate's `macroGoal` must map to a recognized priority lane from
`.github/ai-state/macro-goal.json`.

| Check | Pass Condition |
|-------|---------------|
| macroGoal present | Candidate declares a non-empty `macroGoal` string |
| Priority lane match | `macroGoal` fuzzy-matches one of the 6 priority lanes, or `priorityLane` is explicitly set to a valid lane |

**Priority lanes** (from `macro-goal.json`):
- `self-cycle-runner`
- `command-steward`
- `webui-control-plane`
- `telemetry-budget`
- `issue-lifecycle`
- `state-reconcile`

**Block reason:** `NO_MACRO_GOAL` — candidate has no macroGoal field.

**Block reason:** `UNKNOWN_PRIORITY_LANE` — explicit priorityLane is not
in the recognized set.

**Warn reason:** `UNMATCHED_MACRO_GOAL` — macroGoal does not fuzzy-match
any priority lane. Consider setting `priorityLane` explicitly.

### 2. Evidence Quality

The candidate must include all required structural fields for a
well-formed, executable issue.

| Check | Pass Condition |
|-------|---------------|
| allowedFiles present | Non-empty array of file patterns |
| forbiddenFiles present | Non-empty array of excluded patterns |
| validationCommands present | Non-empty array of commands to verify outcome |
| conflictGroup present | Non-empty string for deduplication |
| risk present | Non-empty string: `low`, `medium`, `high`, or `critical` |
| No overly broad scope | `allowedFiles` does not contain `src/**`, `**/*`, or `**` |
| Evidence provided | At least one evidence item (warn) |
| Rollback plan | Non-empty rollbackPlan string (warn) |
| Follow-up | Non-empty followUp string (warn) |

**Block reason:** `MISSING_REQUIRED_FIELD` — a required field is absent.

**Block reason:** `EMPTY_REQUIRED_FIELD` — a required field is present
but empty.

**Block reason:** `SCOPE_TOO_BROAD` — allowedFiles contains an overly
broad pattern.

**Warn reason:** `NO_EVIDENCE`, `NO_ROLLBACK_PLAN`, `NO_FOLLOW_UP` —
advisory fields are missing.

### 3. Advancement Rationale

The candidate must demonstrate how it advances the macro goal of autonomous
self-cycle or Codex exit. Shallow cosmetic work is blocked.

| Check | Pass Condition |
|-------|---------------|
| Rationale present | Non-empty rationale string (>= 20 chars) |
| Advancement signal | Rationale or title mentions self-cycle, Codex exit, control-plane, or related concepts |
| Not shallow work | Title does not match shallow patterns (fix typo, add comment, etc.) without advancement signal |

**Advancement keywords:** self-cycle, codex exit, autonomous, command
steward, health gate, reconcil, telemetry, budget, launch gate, merge
gate, issue lifecycle, state reconcil, control-plane, priority lane,
north star, lane alignment.

**Shallow patterns:** "add comment", "rename X", "update readme",
"fix typo", "add logging".

**Block reason:** `NO_RATIONALE` — candidate has no rationale.

**Block reason:** `RATIONALE_TOO_SHORT` — rationale is under 20 characters.

**Block reason:** `SHALLOW_WORK` — title matches a shallow pattern and
rationale lacks advancement signals.

**Warn reason:** `WEAK_ADVANCEMENT_SIGNAL` — rationale does not mention
any advancement keywords.

---

## Decision Matrix

| Decision | Meaning | Action |
|----------|---------|--------|
| **pass** | All criteria pass | Create GitHub issue with CONTROL APPENDIX |
| **warn** | All hard criteria pass, one or more warnings | Promote with warnings attached as issue comment |
| **block** | One or more blockers | Log rejection. No issue created. |

---

## Gate Result Schema

The gate produces a JSON result conforming to
[gate-result-schema.md](gate-result-schema.md) with
`gateType: "macro-goal-alignment"`.

```json
{
  "schemaVersion": 1,
  "gateType": "macro-goal-alignment",
  "decision": "pass",
  "severity": "info",
  "markerId": "macro-goal-<hash>-alignment",
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "targetIssue": null,
  "targetPR": null,
  "factsRead": [
    {
      "source": "macro-goal.json",
      "summary": "priorityLanes=[self-cycle-runner, command-steward, ...]"
    },
    {
      "source": "candidate.macroGoal",
      "summary": "macroGoal=self-cycle-runner"
    },
    {
      "source": "candidate.rationale",
      "summary": "rationale length=142"
    }
  ],
  "blockers": [],
  "warnings": [],
  "producedFacts": [
    { "key": "macro-goal", "value": "self-cycle-runner" },
    { "key": "conflict-group", "value": "self-cycle-health-gate" },
    { "key": "risk", "value": "low" }
  ]
}
```

### Block Example

```json
{
  "schemaVersion": 1,
  "gateType": "macro-goal-alignment",
  "decision": "block",
  "severity": "error",
  "markerId": "macro-goal-<hash>-alignment",
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "targetIssue": null,
  "targetPR": null,
  "factsRead": [],
  "blockers": [
    {
      "code": "NO_MACRO_GOAL",
      "message": "Candidate has no macroGoal field. Every issue must declare which macro goal it serves."
    },
    {
      "code": "MISSING_REQUIRED_FIELD",
      "message": "Required field \"allowedFiles\" is missing from candidate."
    },
    {
      "code": "SHALLOW_WORK",
      "message": "Title \"Fix typo\" matches a shallow-work pattern and rationale lacks advancement signals."
    }
  ],
  "warnings": [],
  "producedFacts": []
}
```

---

## Pipeline Position

The macro-goal alignment gate sits between issue proposal and issue
creation, after the idea review gate:

```
propose-self-cycle-issues.js
        |
        v
  agent idea review gate (check-agent-idea-gate.js)
        |
        v
  macro-goal alignment gate  ◄── this document
        |
   pass | warn
        v
  GitHub issue created (CONTROL APPENDIX)
        |
        v
  issue-to-task compiler
        |
        v
  launch gate
        |
        v
  batch launch → worker
```

### Upstream Consumers

| Source | How It Feeds Candidates |
|--------|------------------------|
| [planner-create-issues-mode.md](planner-create-issues-mode.md) | Gap-to-issue pipeline with CONTROL APPENDIX |
| [propose-self-cycle-issues.js](../../scripts/ai/propose-self-cycle-issues.js) | Policy-gated autonomous issue seeding |
| [suggest-next-tasks-from-meta-signals.js](../../scripts/ai/suggest-next-tasks-from-meta-signals.js) | Meta-signal ranked suggestions |

### Downstream Integration

| Consumer | How It Uses Gate Output |
|----------|------------------------|
| Issue creation | `pass` decisions produce GitHub issues with CONTROL APPENDIX |
| Planning console | Displays gate results in the Issue Review section |
| Audit log | Records all decisions (pass/warn/block) for traceability |

---

## Usage

```bash
# Evaluate a candidate file
node scripts/ai/check-issue-macro-goal-alignment.js --candidate issue.json

# Print result to stdout
node scripts/ai/check-issue-macro-goal-alignment.js --candidate issue.json --stdout

# Pipe from stdin
cat issue.json | node scripts/ai/check-issue-macro-goal-alignment.js --stdin

# Custom state and output paths
node scripts/ai/check-issue-macro-goal-alignment.js \
  --candidate issue.json \
  --state .github/ai-state/macro-goal.json \
  --out .github/ai-state/my-result.json
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | pass or warn (no hard blockers) |
| 1 | block (one or more blockers) |
| 2 | invalid arguments |

---

## Issue Candidate Schema

```json
{
  "title": "string (required)",
  "macroGoal": "string — freeform label for the macro goal this issue serves",
  "priorityLane": "string — one of macro-goal.json priorityLanes (optional)",
  "taskType": "string — execution type",
  "risk": "low | medium | high | critical",
  "conflictGroup": "string (required)",
  "allowedFiles": ["path/pattern", ...],
  "forbiddenFiles": ["path/pattern", ...],
  "validationCommands": ["cmd1", ...],
  "rationale": "string — why this issue advances the macro goal",
  "evidence": ["evidence item 1", ...],
  "rollbackPlan": "string — how to revert if this fails",
  "followUp": "string — what to do after this issue is closed"
}
```

---

## Marker ID Format

Marker IDs follow the pattern `macro-goal-<hash>-alignment` where `<hash>`
is a short deterministic hash of the candidate's `title` + `conflictGroup`.
This ensures:

- Idempotency — the same candidate evaluated twice produces the same marker.
- Uniqueness — different candidates produce different markers.
- Traceability — the marker links back to the candidate content.

---

## References

- [gate-result-schema.md](gate-result-schema.md) — Common gate result JSON schema.
- [agent-idea-review-gate.md](agent-idea-review-gate.md) — Upstream idea review gate.
- [codex-exit-readiness-gate.md](codex-exit-readiness-gate.md) — Codex exit readiness evaluation.
- [meta-governance-review-gate.md](meta-governance-review-gate.md) — Constitution Steward governance gate.
- [issue-lifecycle.md](issue-lifecycle.md) — Issue states and label transitions.
- [planner-create-issues-mode.md](planner-create-issues-mode.md) — Gap-to-issue pipeline.
- [macro-goal.json](../../.github/ai-state/macro-goal.json) — Macro goal definition.
