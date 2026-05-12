# WebUI Action: produce-issues

Preview-first issue producer that drafts high-quality proposals with
evidence, CONTROL APPENDIX, and quality scoring.

> **Closes:** [#1330](https://github.com/taoyu051818-sys/lian-nest-server/issues/1330)

---

## Overview

`produce-issues` is a read-only WebUI action that takes issue
specifications and drafts fully-structured proposals. It validates
specs, builds CONTROL APPENDIX bodies, and scores each proposal on
completeness. The action never creates GitHub issues — use
`create-issues` for that.

```
  Command Steward
       │
       ▼
  POST /api/actions/preview
  { action: "produce-issues", specs: [...] }
       │
       ▼
  produce-issues.js
    ├─ validate specs
    ├─ build CONTROL APPENDIX body
    ├─ score quality (0-100%)
    └─ return draft proposals
       │
       ▼
  Review proposals → pass to create-issues
```

---

## Module contract

| Field | Value |
|-------|-------|
| ID | `produce-issues` |
| Label | Produce Issues |
| Dangerous | `false` |
| Preview | Drafts proposals from specs |
| Execute | Blocked (returns error) |

---

## Input payload

```json
{
  "specs": [
    {
      "title": "feat: add example feature",
      "goal": "Add example feature to improve DX",
      "evidence": ["Gap identified in code review"],
      "scope": "Implement the example feature module",
      "acceptance": ["Feature works as described", "Tests pass"],
      "constraints": ["No breaking changes"],
      "risk": "medium",
      "taskType": "execution",
      "conflictGroup": "wave-example",
      "allowedFiles": ["src/example.ts"],
      "forbiddenFiles": ["src/auth/**"],
      "validationCommands": ["npm run check"],
      "rollbackPlan": "Revert the PR",
      "followUp": "Add integration tests",
      "priority": "medium",
      "rolePacket": { "actorRole": "feature-worker" },
      "budgets": { "softTimeMinutes": 30 }
    }
  ],
  "labels": ["ai-generated"],
  "specsPath": ".github/ai-state/issue-specs.json"
}
```

### Required spec fields

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Issue title |
| `goal` | string | What the issue accomplishes |
| `risk` | string | One of: `low`, `medium`, `high`, `critical` |
| `conflictGroup` | string | Concurrency group for worker isolation |
| `allowedFiles` | string[] | Files the worker may modify (non-empty, no wildcards) |
| `validationCommands` | string[] | Commands to validate the change |

### Optional spec fields

| Field | Type | Description |
|-------|------|-------------|
| `evidence` | string[] or string | Evidence supporting the issue |
| `scope` | string | Scope description |
| `acceptance` | string[] | Acceptance criteria |
| `constraints` | string[] | Hard constraints |
| `taskType` | string | `execution`, `research`, or `review` |
| `forbiddenFiles` | string[] | Files the worker must not touch |
| `rollbackPlan` | string | How to revert if needed |
| `followUp` | string | Follow-up work after completion |
| `priority` | string | Priority level |
| `rolePacket` | object | Worker role metadata |
| `budgets` | object | Time/resource budgets |

---

## Output shape

```json
{
  "ok": true,
  "status": "preview",
  "dryRun": true,
  "proposals": [
    {
      "title": "feat: add example feature",
      "body": "## Goal\n...",
      "labels": ["ai-generated"],
      "priority": "medium",
      "taskType": "execution",
      "risk": "medium",
      "conflictGroup": "wave-example",
      "allowedFiles": ["src/example.ts"],
      "forbiddenFiles": ["src/auth/**"],
      "validationCommands": ["npm run check"],
      "hasEvidence": true,
      "hasAcceptance": true,
      "hasRollback": true,
      "hasFollowUp": true,
      "quality": {
        "score": 6,
        "maxScore": 6,
        "percentage": 100,
        "feedback": []
      }
    }
  ],
  "summary": {
    "total": 1,
    "valid": 1,
    "invalid": 0,
    "avgQuality": 100,
    "mode": "preview"
  },
  "message": "Drafted 1 proposal(s) with avg quality 100%",
  "timestamp": "2026-05-12T00:00:00.000Z"
}
```

---

## Quality scoring

Each proposal is scored on 6 criteria:

| Criterion | Score | Description |
|-----------|-------|-------------|
| Has evidence | 1 | `evidence` field is non-empty |
| Has acceptance | 1 | `acceptance` array has entries |
| Has forbidden files | 1 | `forbiddenFiles` array is non-empty |
| Has rollback plan | 1 | `rollbackPlan` field is set |
| Has follow-up | 1 | `followUp` field is set |
| No broad patterns | 1 | `allowedFiles` has no `*`, `**`, `**/*`, or `src/**` |

Proposals are sorted by quality score descending. The summary includes
`avgQuality` across all proposals.

---

## CONTROL APPENDIX format

Each proposal body includes a `CONTROL APPENDIX` section with:

- Task type, risk, conflict group
- Target issue/PR references
- Allowed files list
- Forbidden files list
- Validation commands
- Rollback plan (if provided)
- Follow-up (if provided)
- Budgets (if provided)
- Role packet (if provided)

This structure enables workers to parse their constraints from the
issue body without requiring external metadata.

---

## Validation

The action validates each spec before drafting:

- All required fields must be present and non-empty
- `risk` must be a valid risk level
- `taskType` must be a valid task type (if provided)
- `allowedFiles` must not contain overly broad patterns (`*`, `**`, `**/*`)

Invalid specs are excluded from proposals. If all specs are invalid,
the action returns `{ ok: false, status: "error" }` with validation
errors. If some are valid, it returns the valid proposals plus
validation errors for the invalid ones.

---

## Execute mode

Execute is blocked. The action returns:

```json
{
  "ok": false,
  "status": "blocked",
  "error": "Execute mode is not supported for produce-issues. ..."
}
```

To create GitHub issues from proposals, pass them to the
`create-issues` action.

---

## Testing

```bash
node tools/provider-pool-webui/actions/produce-issues.test.js
```

Tests cover: module contract, secret isolation, empty/null payloads,
valid specs, proposal structure, CONTROL APPENDIX content, quality
scoring, multiple specs sorting, validation errors, broad pattern
rejection, file reading, label passthrough, sanitization, execute
blocking, and temp file safety.

---

## References

- [create-issues](../../tools/provider-pool-webui/actions/create-issues.js) — creates GitHub issues from proposals
- [compile-tasks](../../tools/provider-pool-webui/actions/compile-tasks.js) — compiles issue JSON into task contracts
- [WebUI Action Contract](webui-action-contract.md) — safe action lifecycle
- [WebUI Action Module Registry](webui-action-module-registry.md) — module catalogue
