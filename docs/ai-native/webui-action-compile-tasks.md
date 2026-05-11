# WebUI Action: Compile Tasks

WebUI action module that compiles issue JSON into worker task contracts.
Exposes the issue-to-task compiler through the WebUI action API.

> **Closes:** [#679](https://github.com/taoyu051818-sys/lian-nest-server/issues/679)

---

## Overview

The `compile-tasks` action module wraps the issue-to-task compiler logic
as a WebUI action. It validates issue JSON, reports warnings, and
compiles task contracts — all through the standard `/api/actions/preview`
and `/api/actions/execute` endpoints.

```
  Browser (localhost)
       │
       ▼
  POST /api/actions/preview   → validate + show what would compile
  POST /api/actions/execute   → validate + return compiled task JSON
```

The module is a **pure transformation** — no file I/O, no secrets, no
raw stdout/stderr. Both preview and execute are non-destructive.

---

## Action Contract

| Field | Value |
|-------|-------|
| `id` | `compile-tasks` |
| `label` | Compile Tasks |
| `description` | Compile issue JSON into worker task contracts |
| `dangerous` | `false` |
| `preview` | Validates input, returns compilation summary |
| `execute` | Validates input, returns full compiled task JSON |

---

## Payload

The payload mirrors the issue-to-task compiler input format.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `targetIssue` | integer | GitHub issue number |
| `taskType` | string | `execution`, `research`, or `review` |
| `risk` | string | `low`, `medium`, or `high` |
| `conflictGroup` | string | Concurrency group identifier |
| `allowedFiles` | string[] | Glob patterns for editable files (min 1) |
| `validationCommands` | string[] | Commands to run before PR (min 1) |
| `rolePacket` | object | Must contain `actorRole` (non-empty) |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `targetPR` | integer/null | Existing PR number, or null for new work |
| `issues` | integer[] | Additional related issue numbers |
| `expectedPR` | boolean | Whether the task should produce a PR |
| `forbiddenFiles` | string[] | Glob patterns the worker must not edit |
| `attentionAreas` | object | Focus areas and known blindspots |
| `reviewAndAcceptance` | object | Reviewer roles and acceptance owner |
| `budgets` | object | File/line/time limits |
| `complexityAssessment` | object | Complexity level and drivers |
| `stragglerPolicy` | object | Behavior when approaching time limits |
| `pmPhase` | string | Wave phase identifier |
| `knowledgeRefs` | string[] | File paths or URLs for semantic context |
| `promptHandoff` | string | Concise description of what to build |
| `llmExtracted` | boolean | True when LLM produced semantic fields |
| `outputMode` | string | `v1` (default) or `v2` |

---

## Preview Response

Returns validation result and compilation summary without the full task.

```json
{
  "actionId": "compile-tasks",
  "label": "Compile Tasks",
  "preview": {
    "valid": true,
    "outputMode": "v1",
    "targetIssue": 679,
    "taskType": "execution",
    "risk": "medium",
    "conflictGroup": "webui-action-compile-tasks",
    "allowedFileCount": 2,
    "forbiddenFileCount": 4,
    "validationCommandCount": 3,
    "warnings": [],
    "dryRun": true
  },
  "dryRun": true
}
```

Warnings are non-blocking. Errors (missing fields, invalid enums) throw
and return 500.

---

## Execute Response

Returns the full compiled task JSON.

```json
{
  "ok": true,
  "auditId": "audit-...",
  "result": {
    "ok": true,
    "outputMode": "v1",
    "task": {
      "taskType": "execution",
      "risk": "medium",
      "conflictGroup": "webui-action-compile-tasks",
      "targetIssue": 679,
      "allowedFiles": ["..."],
      "validationCommands": ["..."],
      "rolePacket": { "actorRole": "...", "description": "..." },
      "sourceIssue": "https://github.com/.../issues/679"
    },
    "warnings": []
  }
}
```

---

## v2 Output Mode

Pass `"outputMode": "v2"` in the payload to get task-v2 schema output:

- Promotes `rolePacket` → top-level `actorRole`, `roleDescription`
- Promotes `attentionAreas` → `attentionFocus`, `knownBlindspots`
- Promotes `reviewAndAcceptance` → `requiredReviewRoles`, `acceptanceOwner`
- Renames `validationCommands` → `validation`
- Renames `budgets` → `budget`
- Derives `workerClass` from `conflictGroup` if not provided
- Passes through v2-only fields: `writeSet`, `sharedLocks`, etc.

---

## Specificity Warnings

The module warns (non-blocking) when:

- `forbiddenFiles` is empty or missing
- `allowedFiles` contains overly broad patterns (`*`, `**`, `**/*`)
- `validationCommands` has fewer than 1 entry
- `llmExtracted=true` but `knowledgeRefs` or `promptHandoff` is missing

---

## Security

| Rule | Enforcement |
|------|-------------|
| No secrets in output | Pure transformation — no API keys, tokens, or credentials |
| No raw logs | Returns structured JSON only |
| No file I/O | Does not read or write files |
| Non-destructive | `dangerous: false` — no confirmation required |
| Sanitized by server | All results pass through `sanitizeObject()` |

---

## Safety Contract

### Schema Validation

Validation runs on both `preview` and `execute`. Errors throw; warnings
are non-blocking.

**Payload type guard:** Payload must be a non-null, non-array object.
`null`, `undefined`, primitives, and arrays all fail with
`"Payload must be a non-null object"`.

**Required fields:**
`targetIssue`, `taskType`, `risk`, `conflictGroup`, `allowedFiles`,
`validationCommands`, `rolePacket`.

Each required field is checked for three failure modes:
- `undefined` or `null`
- empty array
- whitespace-only string

All missing fields are batched into a single error message.

**Enum constraints:**

| Field | Valid values |
|-------|-------------|
| `taskType` | `execution`, `research`, `review` |
| `risk` | `low`, `medium`, `high` |

**Nested constraints:**
- `rolePacket.actorRole` must be truthy when `rolePacket` is an object.

**Known type-conflation gaps** ([#853](https://github.com/taoyu051818-sys/lian-nest-server/issues/853)):
The validator currently accepts strings where integers or arrays are
expected for `targetIssue`, `allowedFiles`, `validationCommands`, and
`rolePacket`. These are tracked as known defects.

### Dry-Run Output Guarantees

`preview` returns a summary only — the compiled `task` object is never
included:

| Field | Type | Description |
|-------|------|-------------|
| `valid` | `true` | Always set for payloads that pass validation |
| `outputMode` | string | `v1` or `v2` |
| `targetIssue` | integer | Echoed from input |
| `taskType` | string | Echoed from input |
| `risk` | string | Echoed from input |
| `conflictGroup` | string | Echoed from input |
| `allowedFileCount` | number | Count, not the array itself |
| `forbiddenFileCount` | number | Count, not the array itself |
| `validationCommandCount` | number | Count, not the array itself |
| `warnings` | string[] | Non-blocking warnings |
| `dryRun` | `true` | Always set |

No `task` key is present in the preview response. This prevents preview
from leaking compiled task data.

### Task Boundary Constraints

**Immutable defaults:**

| Field | Default |
|-------|---------|
| `targetPR` | `null` |
| `issues` | `[]` |
| `expectedPR` | `true` |
| `forbiddenFiles` | `[]` |
| `rolePacket.description` | `"Worker for issue #<targetIssue>"` |
| `sourceIssue` | Derived from repo URL + issue number |

**Array cloning:** All array fields (`allowedFiles`, `forbiddenFiles`,
`validationCommands`, `knowledgeRefs`) are shallow-cloned. Mutating
payload arrays after `execute()` does not affect the returned task.

**No field leakage:** Extra payload fields (e.g. `extraField`, `secrets`)
are not passed through to the output task. Only explicitly listed fields
are copied, preventing accidental exposure of payload metadata.

**Non-mutation guarantee:** Neither `preview` nor `execute` mutates the
input payload. All array fields remain reference-identical to their
pre-call values.

---

## Example: curl

```bash
# Preview
curl -s http://127.0.0.1:4179/api/actions/preview \
  -H "Content-Type: application/json" \
  -d '{
    "actionId": "compile-tasks",
    "payload": {
      "targetIssue": 679,
      "taskType": "execution",
      "risk": "medium",
      "conflictGroup": "webui-action-compile-tasks",
      "allowedFiles": ["tools/provider-pool-webui/actions/compile-tasks.js"],
      "validationCommands": ["npm run check", "npm run build"],
      "rolePacket": { "actorRole": "webui-control-console-worker" }
    }
  }' | jq .

# Execute
curl -s http://127.0.0.1:4179/api/actions/execute \
  -H "Content-Type: application/json" \
  -d '{
    "actionId": "compile-tasks",
    "payload": {
      "targetIssue": 679,
      "taskType": "execution",
      "risk": "medium",
      "conflictGroup": "webui-action-compile-tasks",
      "allowedFiles": ["tools/provider-pool-webui/actions/compile-tasks.js"],
      "validationCommands": ["npm run check", "npm run build"],
      "rolePacket": { "actorRole": "webui-control-console-worker" }
    }
  }' | jq .
```

---

## See Also

- [Provider Pool WebUI Actions API](provider-pool-webui-actions-api.md) — action module contract
- [Issue-to-Task Compiler](issue-to-task-compiler.md) — compiler documentation
- [Worker Task Contract](worker-task-contract.md) — task schema
- [#679](https://github.com/taoyu051818-sys/lian-nest-server/issues/679) — this feature
