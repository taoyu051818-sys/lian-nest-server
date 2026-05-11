# Agent Idea Review Gate

Defines criteria for evaluating agent-generated ideas before they become
GitHub issues or experiments. Sits upstream of issue creation in the
orchestration pipeline — every agent-produced idea MUST pass this gate
before promotion.

> **Closes:** [#907](https://github.com/taoyu051818-sys/lian-nest-server/issues/907)
> **See also:** [gate-result-schema.md](gate-result-schema.md) for the
> common gate result JSON schema,
> [meta-signal-task-suggestions.md](meta-signal-task-suggestions.md) for
> the suggestion engine that feeds this gate.

---

## Overview

The AI-native control plane produces candidate ideas from multiple sources:
meta-signal suggestions, stale-row detection, gap ledger entries, and
planning console proposals. Each idea is raw — it describes *what* to do
but has not been validated against scope, feasibility, or architectural
fit.

The agent idea review gate evaluates each candidate against a checklist
of criteria. Only ideas that pass all criteria are promoted to GitHub
issues with a CONTROL APPENDIX. Ideas that fail are deferred (needs more
context) or rejected (not viable).

```
  meta-signals / stale-row / gap-ledger
              |
              v
  raw idea candidate
              |
              v
  ┌───────────────────────────┐
  │  agent idea review gate   │  ◄── this document
  │                           │
  │  - signal quality         │
  │  - novelty check          │
  │  - scope feasibility      │
  │  - architectural fit      │
  │  - resource availability  │
  └───────────┬───────────────┘
              |
     ┌────────┼────────┐
     v        v        v
  promote   defer    reject
     |        |        |
     v        v        v
  issue    requeue   logged
  created  for later  & dropped
```

---

## Gate Criteria

Every idea candidate MUST satisfy all five criteria to be promoted.

### 1. Signal Quality

The idea must be grounded in observable system signals, not speculation.

| Check | Pass Condition |
|-------|---------------|
| Source signal exists | Idea traces to a meta-signal, gap ledger entry, stale-row detection, or explicit human request |
| Signal is current | Source signal was captured within the last 7 days |
| Signal severity justifies action | `failureScore > 0`, `frictionScore > 30`, `riskScore > 40`, or human-authored |

**Block reason:** `STALE_SIGNAL` — signal older than 7 days may no longer
reflect current system state.

**Block reason:** `NO_SOURCE_SIGNAL` — idea has no traceable origin.

### 2. Novelty Check

The idea must not duplicate an existing open issue or in-flight task.

| Check | Pass Condition |
|-------|---------------|
| No duplicate issue | No open GitHub issue with the same `conflictGroup` and overlapping `allowedFiles` |
| No in-flight worker | No active worker heartbeat with a matching `conflictGroup` |
| Not already completed | No merged PR in the last 30 days that addressed the same scope |

**Block reason:** `DUPLICATE_ISSUE` — an open issue already covers this scope.

**Block reason:** `WORKER_IN_FLIGHT` — a worker is actively implementing
overlapping scope.

**Warn reason:** `RECENTLY_COMPLETED` — a merged PR addressed similar scope
within 30 days. May be regression or different angle.

### 3. Scope Feasibility

The idea must be scoped to a single worker task with bounded files and
clear acceptance criteria.

| Check | Pass Condition |
|-------|---------------|
| File scope is bounded | Proposed `allowedFiles` contains 1-10 entries, none broader than `src/modules/<name>/**` |
| Single responsibility | Idea addresses one concern (feature, fix, refactor, or docs — not a combination) |
| Acceptance criteria exist | Idea includes at least one verifiable acceptance criterion |
| Validation commands exist | At least one command can verify the outcome |

**Block reason:** `SCOPE_TOO_BROAD` — `allowedFiles` exceeds 10 entries or
contains overly broad patterns (`src/**`, `**/*`).

**Block reason:** `NO_ACCEPTANCE_CRITERIA` — no way to verify completion.

**Warn reason:** `MULTI_CONCERN` — idea mixes feature work with refactoring
or docs. Consider splitting.

### 4. Architectural Fit

The idea must align with module boundaries and the current migration phase.

| Check | Pass Condition |
|-------|---------------|
| Module boundary respected | `allowedFiles` does not cross module boundaries defined in `docs/architecture/` |
| Migration phase compatible | If touching a migration slice, the slice status is `CONTRACTED` or `IMPLEMENTED` (not `LEGACY_DISABLED`) |
| No forbidden patterns | Idea does not propose editing files in `forbiddenFiles` sets (`.env`, `dist/`, `node_modules/`, `prisma/migrations/`) |

**Block reason:** `BOUNDARY_VIOLATION` — proposed scope crosses module boundaries.

**Block reason:** `LEGACY_DISABLED_SLICE` — the target slice is already retired.

**Warn reason:** `UNMAPPED_SCOPE` — proposed files are not covered by any
existing architecture doc. May need architect review before promotion.

### 5. Resource Availability

The idea must be launchable given current system state.

| Check | Pass Condition |
|-------|---------------|
| Main health permits | Worker type is allowed in current health state (see [main-health-policy.md](main-health-policy.md)) |
| No conflict group collision | Proposed `conflictGroup` does not collide with in-flight workers |
| Batch capacity available | Current batch has fewer than `MaxTasks` (default 5) candidates |

**Block reason:** `HEALTH_BLOCKS_TYPE` — main health state does not permit
this worker type.

**Block reason:** `CONFLICT_GROUP_COLLISION` — proposed group collides with
an active worker.

**Defer reason:** `BATCH_FULL` — batch at capacity. Requeue for next cycle.

---

## Decision Matrix

| Decision | Meaning | Action |
|----------|---------|--------|
| **promote** | All criteria pass | Create GitHub issue with CONTROL APPENDIX, label `agent:queued` |
| **defer** | One or more `Defer` reasons | Requeue for next planning cycle. No issue created. |
| **reject** | One or more `Block` reasons with no remediation path | Log rejection reason. No issue created. |
| **warn** | All hard criteria pass, one or more `Warn` reasons | Promote with warnings attached as issue comment. |

### Override

A `repo-owner` can override any block or defer with documented
justification. Override follows the same pattern as the merge gate:

```json
{
  "decision": "override",
  "overrideJustification": "Human-supplied reason for bypassing the block"
}
```

---

## Gate Result Schema

The gate produces a JSON result conforming to
[gate-result-schema.md](gate-result-schema.md) with `gateType: "idea-review"`.

```json
{
  "schemaVersion": 1,
  "gateType": "idea-review",
  "decision": "promote",
  "severity": "info",
  "markerId": "idea-<hash>-review",
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "targetIssue": null,
  "targetPR": null,
  "factsRead": [
    {
      "source": ".github/ai-state/meta-signals.json",
      "summary": "failureScore=25, topPain=runtime compile"
    }
  ],
  "blockers": [],
  "warnings": [],
  "producedFacts": [
    { "key": "idea-source", "value": "meta-signal" },
    { "key": "conflict-group", "value": "runtime-compile-fix" },
    { "key": "worker-type", "value": "foundation-fix" }
  ]
}
```

### Block Example

```json
{
  "schemaVersion": 1,
  "gateType": "idea-review",
  "decision": "block",
  "severity": "error",
  "markerId": "idea-<hash>-review",
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "targetIssue": null,
  "targetPR": null,
  "factsRead": [
    {
      "source": "github-issues",
      "summary": "Open issue #142 with conflictGroup=runtime-compile-fix"
    }
  ],
  "blockers": [
    {
      "code": "DUPLICATE_ISSUE",
      "message": "Open issue #142 already covers this scope with conflictGroup=runtime-compile-fix."
    }
  ],
  "warnings": [],
  "producedFacts": []
}
```

---

## Pipeline Position

The idea review gate sits between idea generation and issue creation:

```
calculate-meta-signals.js
        |
        v
suggest-next-tasks-from-meta-signals.js
        |
        v
  agent idea review gate    ◄── this document
        |
   promote |
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

| Source | How It Feeds Ideas |
|--------|-------------------|
| [meta-signal-task-suggestions.md](meta-signal-task-suggestions.md) | Produces ranked suggestions from health/heartbeat signals |
| [planning-loop.md](planning-loop.md) Stale-Row Detection | Produces review candidates from stalled migration rows |
| [gap-ledger.md](gap-ledger.md) | Produces candidates from unresolved gap entries |
| Human request | Direct idea via planning console or issue comment |

### Downstream Integration

| Consumer | How It Uses Gate Output |
|----------|------------------------|
| Issue creation | `promote` decisions produce GitHub issues with CONTROL APPENDIX |
| Planning console | Displays gate results in the Idea Review section |
| Result publisher | Publishes gate result as issue comment (when idea is promoted) |
| Audit log | Records all decisions (promote/defer/reject/warn) for traceability |

---

## Evaluation Workflow

### Step 1: Candidate Ingestion

The gate receives an idea candidate as structured JSON:

```json
{
  "source": "meta-signal",
  "title": "Fix runtime compile failures in auth module",
  "reason": "failureScore=25, topPain=runtime compile. Recent health checks report red-state entries.",
  "confidence": 54,
  "priority": "high",
  "signalValues": { "failureScore": 25, "topPain": "runtime compile" },
  "actionHint": "Review recent health check logs for red-state entries and address root causes.",
  "suggestedConflictGroup": "runtime-compile-fix",
  "SuggestedAllowedFiles": ["src/modules/auth/**"],
  "suggestedWorkerType": "foundation-fix"
}
```

### Step 2: Criteria Evaluation

Run each of the five criteria checks in order. Stop on first `Block`.

### Step 3: Decision

Aggregate results into a single decision:

1. Any `Block` → **reject** (unless overridden)
2. No `Block` but has `Defer` → **defer**
3. No `Block` or `Defer` but has `Warn` → **warn** (promote with warnings)
4. All pass → **promote**

### Step 4: Action

| Decision | Action |
|----------|--------|
| `promote` | Create issue, apply labels, attach gate result |
| `defer` | Write to requeue manifest, retry next cycle |
| `reject` | Log to audit, no issue created |
| `warn` | Create issue with warnings as comment |

---

## Marker ID Format

Marker IDs follow the pattern `idea-<hash>-review` where `<hash>` is a
short deterministic hash of the idea's `title` + `suggestedConflictGroup`.
This ensures:

- Idempotency — the same idea evaluated twice produces the same marker.
- Uniqueness — different ideas produce different markers.
- Traceability — the marker links back to the idea content.

---

## References

- [gate-result-schema.md](gate-result-schema.md) — Common gate result JSON schema.
- [meta-signal-task-suggestions.md](meta-signal-task-suggestions.md) — Suggestion engine producing candidates.
- [planning-loop.md](planning-loop.md) — Dry-run planner with stale-row detection.
- [gap-ledger.md](gap-ledger.md) — Gap tracking producing candidates.
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
- [parallel-work-policy.md](parallel-work-policy.md) — Conflict groups and parallelism rules.
- [issue-lifecycle.md](issue-lifecycle.md) — Issue states and label transitions.
- [issue-to-task-compiler.md](issue-to-task-compiler.md) — Downstream compiler consuming promoted issues.
- [launch-gate.md](launch-gate.md) — Pre-launch validation after issue promotion.
- [planning-console-action-policy.md](planning-console-action-policy.md) — Planning console display of gate results.
