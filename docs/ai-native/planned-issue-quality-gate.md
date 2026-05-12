# Planned Issue Quality Gate

Defines criteria for evaluating planned issues before they enter the
worker scheduling pipeline. Rejects shallow generated issues that lack
evidence, boundaries, validation, rollback, or unique conflict groups.

> **Closes:** [#1325](https://github.com/taoyu051818-sys/lian-nest-server/issues/1325)
> **See also:** [gate-result-schema.md](gate-result-schema.md) for the
> common gate result JSON schema,
> [write-planned-issues.md](write-planned-issues.md) for the issue
> writer that produces candidates.

---

## Overview

The AI-native control plane generates planned issues from planner
output. Each issue must be a bounded, executable task with clear
evidence, file boundaries, validation commands, risk declaration,
rollback strategy, and a machine-readable CONTROL APPENDIX.

Shallow issues — those missing required sections, boundaries, or
metadata — cause workers to produce low-quality output or fail at
runtime. This gate catches those issues before they reach the launch
gate.

```
  plan-next-batch.ps1
          |
          v
  write-planned-issues.ps1
          |
          v
  ┌───────────────────────────────┐
  │  planned issue quality gate   │  ◄── this document
  │                               │
  │  - evidence (4 sections)      │
  │  - file boundaries            │
  │  - validation commands        │
  │  - conflict group             │
  │  - risk declaration           │
  │  - rollback plan              │
  │  - CONTROL APPENDIX           │
  └───────────┬───────────────────┘
              |
     ┌────────┼────────┐
     v        v        v
   pass     warn     block
     |        |        |
     v        v        v
  launch   launch   rejected
  gate     gate     (logged)
```

---

## Gate Criteria

Every planned issue MUST satisfy all seven criteria to pass.

### 1. Evidence

The issue body must contain the four standard sections from the issue
template defined in [issue-lifecycle.md](issue-lifecycle.md).

| Check | Pass Condition |
|-------|---------------|
| Goal section present | `## Goal` heading exists in body |
| Scope section present | `## Scope` heading exists in body |
| Acceptance section present | `## Acceptance` heading exists in body |
| Constraints section present | `## Constraints` heading exists in body |
| Sections are substantive | Each section has at least 10 characters of content |

**Block reason:** `MISSING_SECTIONS` — one or more required sections
(Goal, Scope, Acceptance, Constraints) are missing.

**Warn reason:** `THIN_SECTIONS` — sections exist but appear too thin
to guide workers effectively.

---

### 2. File Boundaries

The issue must declare which files workers may and may not touch.

| Check | Pass Condition |
|-------|---------------|
| allowedFiles declared | `Allowed files` present in CONTROL APPENDIX or body |
| forbiddenFiles declared | `Forbidden files` present in CONTROL APPENDIX or body |

**Block reason:** `NO_ALLOWED_FILES` — no file scope boundary declared.

**Warn reason:** `NO_FORBIDDEN_FILES` — no exclusion boundary declared.

---

### 3. Validation

The issue must include at least one validation command.

| Check | Pass Condition |
|-------|---------------|
| Validation commands exist | `Validation commands` in CONTROL APPENDIX or acceptance mentions a command |

**Block reason:** `NO_VALIDATION` — no way to verify the outcome.

---

### 4. Conflict Group

The CONTROL APPENDIX must declare a unique conflict group for
deduplication and parallel scheduling.

| Check | Pass Condition |
|-------|---------------|
| Conflict group present | `Conflict group` field in CONTROL APPENDIX |
| Conflict group non-empty | Value is a non-empty string |

**Block reason:** `NO_CONFLICT_GROUP` — no conflict group declared.

**Block reason:** `EMPTY_CONFLICT_GROUP` — conflict group field is empty.

---

### 5. Risk Declaration

The CONTROL APPENDIX must declare the risk level.

| Check | Pass Condition |
|-------|---------------|
| Risk field present | `Risk` field in CONTROL APPENDIX |
| Risk value valid | One of: `low`, `medium`, `high` |

**Block reason:** `NO_RISK_DECLARED` — no risk field found.

**Block reason:** `INVALID_RISK` — risk value is not a valid enum.

**Warn reason:** `HIGH_RISK_ISSUE` — high-risk issues should get human
review before launching workers.

---

### 6. Rollback Plan

The issue must describe how to recover if the change causes problems.

| Check | Pass Condition |
|-------|---------------|
| Rollback strategy declared | Body or CONTROL APPENDIX contains rollback, revert, follow-up, or mitigation strategy |

**Block reason:** `NO_ROLLBACK_PLAN` — no recovery strategy found.

---

### 7. Control Appendix

The issue body must contain a `CONTROL APPENDIX` block with required
machine-readable metadata.

| Check | Pass Condition |
|-------|---------------|
| CONTROL APPENDIX present | `CONTROL APPENDIX` marker found in body |
| Required fields present | `Task type`, `Risk`, `Conflict group` all present |

**Block reason:** `NO_CONTROL_APPENDIX` — no machine-readable block found.

**Block reason:** `INCOMPLETE_APPENDIX` — one or more required fields
missing from the CONTROL APPENDIX.

---

## Decision Matrix

| Decision | Meaning | Action |
|----------|---------|--------|
| **pass** | All criteria pass | Proceed to launch gate |
| **warn** | All hard criteria pass, one or more warn reasons | Proceed with warnings attached |
| **block** | One or more blockers | Reject issue, log reason |
| **override** | Repo-owner bypass with justification | Proceed with override documented |

---

## Gate Result Schema

The gate produces a JSON result conforming to
[gate-result-schema.md](gate-result-schema.md) with
`gateType: "planned-issue-quality"`.

```json
{
  "schemaVersion": 1,
  "gateType": "planned-issue-quality",
  "decision": "pass",
  "severity": "info",
  "markerId": "issue-1325-planned-quality",
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "targetIssue": 1325,
  "targetPR": null,
  "factsRead": [
    {
      "source": "issue-body",
      "summary": "sections present: Goal, Scope, Acceptance, Constraints"
    },
    {
      "source": "issue-body",
      "summary": "validation present: true"
    },
    {
      "source": "CONTROL APPENDIX",
      "summary": "fields: Task type, Risk, Conflict group, ..."
    }
  ],
  "blockers": [],
  "warnings": [],
  "producedFacts": []
}
```

### Block Example

```json
{
  "schemaVersion": 1,
  "gateType": "planned-issue-quality",
  "decision": "block",
  "severity": "error",
  "markerId": "issue-42-planned-quality",
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "targetIssue": 42,
  "targetPR": null,
  "factsRead": [
    {
      "source": "issue-body",
      "summary": "sections present: Goal"
    }
  ],
  "blockers": [
    {
      "code": "MISSING_SECTIONS",
      "message": "Issue body missing required sections: Scope, Acceptance, Constraints."
    },
    {
      "code": "NO_CONTROL_APPENDIX",
      "message": "No CONTROL APPENDIX block found."
    }
  ],
  "warnings": [],
  "producedFacts": []
}
```

---

## Pipeline Position

The planned issue quality gate sits between issue creation and the
launch gate:

```
plan-next-batch.ps1 -Json
        |
        v
write-planned-issues.ps1
        |
        v
  planned issue quality gate    ◄── this document
        |
   pass |
        v
  compile-issue-to-task-json
        |
        v
  task slicing quality gate
        |
        v
  launch gate
        |
        v
  batch launch → worker
```

### Upstream Consumers

| Source | How It Feeds Issues |
|--------|-------------------|
| [write-planned-issues.md](write-planned-issues.md) | Creates issues from plan JSON with CONTROL APPENDIX |
| Human author | Manual issue creation following the template |

### Downstream Integration

| Consumer | How It Uses Gate Output |
|----------|------------------------|
| Launch gate | `block` results prevent worker scheduling |
| Audit log | Records all decisions for traceability |
| Issue comment | Gate result published as comment on the issue |

---

## Evaluation Workflow

### Step 1: Issue Ingestion

The gate receives an issue body as markdown text. The body should follow
the standard template from [issue-lifecycle.md](issue-lifecycle.md) and
include a CONTROL APPENDIX block.

### Step 2: Criteria Evaluation

Run each of the seven criteria checks in order. Collect all blockers
and warnings.

### Step 3: Decision

1. Any `Block` → **block** (unless overridden)
2. No `Block` but has `Warn` → **warn**
3. All pass → **pass**

### Step 4: Action

| Decision | Action |
|----------|--------|
| `pass` | Proceed to compile and launch |
| `warn` | Proceed with warnings attached as issue comment |
| `block` | Reject issue, log to audit |

---

## Marker ID Format

Marker IDs follow the pattern `issue-<N>-planned-quality` where `<N>` is
the GitHub issue number (or `unknown` if not available). This ensures:

- Idempotency — re-evaluating the same issue produces the same marker.
- Uniqueness — different issues produce different markers.
- Traceability — the marker links back to the issue number.

---

## References

- [gate-result-schema.md](gate-result-schema.md) — Common gate result JSON schema.
- [write-planned-issues.md](write-planned-issues.md) — Issue writer producing candidates.
- [issue-lifecycle.md](issue-lifecycle.md) — Issue template and states.
- [task-slicing-quality-gate.md](task-slicing-quality-gate.md) — Downstream quality gate.
- [launch-gate.md](launch-gate.md) — Pre-launch validation.
- [agent-idea-review-gate.md](agent-idea-review-gate.md) — Upstream idea quality gate.
