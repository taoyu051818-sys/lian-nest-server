# Gate Result JSON Schema

Common schema for gate decision outputs across the AI-native control plane.
Used by launch review, PR review, merge gates, and post-merge health gates.

> **Closes:** [#362](https://github.com/taoyu051818-sys/lian-nest-server/issues/362)

---

## Schema Location

`schemas/gate-result.schema.json`

---

## Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `schemaVersion` | Yes | `1` (const) | Schema version. |
| `gateType` | Yes | enum | Which gate produced this result. |
| `decision` | Yes | enum | Gate outcome. |
| `severity` | No | enum | Severity of the finding. |
| `markerId` | Yes | string | Machine-readable idempotency marker. |
| `capturedAt` | Yes | date-time | ISO-8601 timestamp of evaluation. |
| `targetIssue` | No | integer or null | GitHub issue number. |
| `targetPR` | No | integer or null | GitHub PR number. |
| `factsRead` | No | array | Evidence sources consulted. |
| `blockers` | No | array | Hard failures that prevent pass. |
| `warnings` | No | array | Advisory findings. |
| `producedFacts` | No | array | Structured facts for downstream. |
| `overrideJustification` | Conditional | string or null | Required when `decision` is `override`. |

---

## Gate Types

| Value | Gate | Doc |
|-------|------|-----|
| `launch` | Pre-launch batch validation | [launch-gate.md](launch-gate.md) |
| `pr-review` | PR review checklist | [pr-review-gate.md](pr-review-gate.md) |
| `merge` | Merge eligibility check | [merge-closure-sop.md](merge-closure-sop.md) |
| `post-merge-health` | Post-merge health verification | [post-merge-health-gate.md](post-merge-health-gate.md) |

---

## Decisions

| Value | Meaning |
|-------|---------|
| `pass` | All checks cleared. |
| `block` | Hard failure — gate blocks progress. |
| `warn` | Advisory finding — does not block. |
| `override` | Repo-owner bypass with documented justification. |

---

## Severity Levels

| Value | When to use |
|-------|-------------|
| `info` | Normal pass, no findings. |
| `warning` | Advisory finding, non-blocking. |
| `error` | Blockable issue (build failure, scope violation). |
| `critical` | Security or data-loss risk. |

---

## Marker ID Rules

- Alphanumeric, hyphens, underscores, and dots only (`^[a-zA-Z0-9._-]+$`).
- Must be unique per result type on a given issue/PR.
- Recommended format: `issue-<N>-<gateType>` or `pr-<N>-<gateType>`.
- Used by the result publisher for idempotent comment updates.

---

## Example: Launch Gate (pass)

```json
{
  "schemaVersion": 1,
  "gateType": "launch",
  "decision": "pass",
  "severity": "info",
  "markerId": "issue-68-launch",
  "capturedAt": "2026-05-11T12:00:00.000Z",
  "targetIssue": 68,
  "targetPR": null,
  "factsRead": [
    {
      "source": ".github/ai-state/main-health.json",
      "summary": "Main branch health: green"
    }
  ],
  "blockers": [],
  "warnings": [],
  "producedFacts": [
    { "key": "health-state", "value": "green" },
    { "key": "worker-type", "value": "foundation-fix" }
  ]
}
```

---

## Example: Launch Gate (block)

```json
{
  "schemaVersion": 1,
  "gateType": "launch",
  "decision": "block",
  "severity": "error",
  "markerId": "issue-73-launch",
  "capturedAt": "2026-05-11T12:00:00.000Z",
  "targetIssue": 73,
  "targetPR": null,
  "factsRead": [
    {
      "source": ".github/ai-state/main-health.json",
      "summary": "Main branch health: red"
    }
  ],
  "blockers": [
    {
      "code": "WORKER_TYPE_NOT_PERMITTED",
      "message": "Worker type 'runtime-feature' is not permitted when main is red."
    }
  ],
  "warnings": [],
  "producedFacts": [
    { "key": "health-state", "value": "red" },
    { "key": "worker-type", "value": "runtime-feature" }
  ]
}
```

---

## Example: PR Review Gate (warn)

```json
{
  "schemaVersion": 1,
  "gateType": "pr-review",
  "decision": "warn",
  "severity": "warning",
  "markerId": "pr-90-review",
  "capturedAt": "2026-05-11T14:30:00.000Z",
  "targetIssue": null,
  "targetPR": 90,
  "factsRead": [
    {
      "source": "pr-body",
      "summary": "PR body has all 7 required sections"
    }
  ],
  "blockers": [],
  "warnings": [
    {
      "code": "VALIDATION_EVIDENCE_TRUNCATED",
      "message": "Validation evidence exceeds 200 lines and was truncated."
    }
  ],
  "producedFacts": []
}
```

---

## Example: Override

```json
{
  "schemaVersion": 1,
  "gateType": "merge",
  "decision": "override",
  "severity": "error",
  "markerId": "pr-92-merge",
  "capturedAt": "2026-05-11T16:00:00.000Z",
  "targetIssue": 88,
  "targetPR": 92,
  "factsRead": [],
  "blockers": [
    {
      "code": "BUILD_FAIL",
      "message": "npm run build failed with exit code 1."
    }
  ],
  "warnings": [],
  "producedFacts": [],
  "overrideJustification": "Flaky test on main, not caused by this PR. Merge to unblock wave 8."
}
```

---

## Integration

### Result Publisher

The `markerId` field aligns with the idempotency contract in [result-publishing.md](result-publishing.md).
Gate results can be published as comments using the same marker-based upsert logic.

### Worker Task Contract

Gate results reference tasks via `targetIssue` and `targetPR`, matching the
fields in the [worker task contract](worker-task-contract.md).

### State Reconciler

The state reconciler can consume gate results as evidence when comparing
worker state against issue labels and PR state.

---

## Validation

The schema uses JSON Schema draft-07. Validate gate results against it:

```bash
# Using ajv-cli (if installed)
npx ajv validate -s schemas/gate-result.schema.json -d <result-file>.json

# Using any draft-07 compatible validator
```

---

## See Also

- [Launch Gate](launch-gate.md) — Pre-launch validation
- [PR Review Gate](pr-review-gate.md) — PR review criteria
- [Merge Closure SOP](merge-closure-sop.md) — Merge eligibility
- [Post-Merge Health Gate](post-merge-health-gate.md) — Post-merge verification
- [Result Publishing](result-publishing.md) — Comment idempotency contract
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [#362](https://github.com/taoyu051818-sys/lian-nest-server/issues/362) — This feature
