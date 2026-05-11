# Provider Pool WebUI API Contract

Local-only REST API surface for the provider pool management WebUI.
All endpoints are served from the local dev server and are **never
exposed to the public internet**.

> **Closes:** [#735](https://github.com/taoyu051818-sys/lian-nest-server/issues/735)
> **Scope:** Docs/contract only. No runtime changes.

---

## Overview

The provider pool WebUI exposes three API groups:

| Group | Prefix | Purpose |
|-------|--------|---------|
| Provider Pool | `/api/provider-pool/*` | Providers, workers, resources, assignments |
| Actions | `/api/actions/*` | Preview and execute operational actions |
| Audit | `/api/audit` | Action execution audit trail |
| Planning | `/api/planning` | Planning console state (read-only) |

All endpoints bind to `127.0.0.1` only. No authentication is required
(local-only access). No secrets are ever returned by any endpoint.

---

## Base URL

```
http://localhost:3000/api
```

---

## Security Constraints

| Rule | Enforcement |
|------|-------------|
| No secrets in responses | All endpoints strip credential data via `sanitizeObject` |
| Localhost only | Server binds to `127.0.0.1`, not `0.0.0.0` |
| Preview-first | Mutating actions expose `/preview` before `/execute` |
| Confirmation gate | Dangerous actions require `confirm: true` + matching `confirmationToken` |

---

## `/api/actions` — Action Endpoints

### `GET /api/actions`

List all registered action modules.

**Response:** `200 OK`

```json
{
  "actions": [
    {
      "id": "compile-tasks",
      "label": "Compile Tasks",
      "description": "Compile issue JSON into worker task contracts",
      "dangerous": false
    },
    {
      "id": "create-issues",
      "label": "Create Issues",
      "description": "Propose/create GitHub issues from gap analysis",
      "dangerous": true
    },
    {
      "id": "issue-state",
      "label": "Issue State",
      "description": "Reconcile issue labels/PRs and close done issues",
      "dangerous": true
    },
    {
      "id": "launch-batch",
      "label": "Launch Batch",
      "description": "Run launch gate on queued tasks and dispatch workers",
      "dangerous": true
    },
    {
      "id": "merge-prs",
      "label": "Merge PRs",
      "description": "Merge explicit allowlist of PRs with health gate",
      "dangerous": true
    },
    {
      "id": "plan.next.batch",
      "label": "Plan Next Batch",
      "description": "Preview next worker batch respecting conflict groups",
      "dangerous": false
    },
    {
      "id": "provider-rotation",
      "label": "Provider Rotation",
      "description": "Preview/execute provider credential rotation",
      "dangerous": true
    },
    {
      "id": "worker.control",
      "label": "Worker Control",
      "description": "List, preview, and stop workers",
      "dangerous": true
    }
  ]
}
```

---

### `POST /api/actions/preview`

Dry-run preview of an action. No side effects, no audit written.

**Request Body:**

```json
{
  "actionId": "plan.next.batch",
  "payload": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `actionId` | string | Yes | Action module id |
| `payload` | object | No | Action-specific parameters |

**Response:** `200 OK`

```json
{
  "actionId": "plan.next.batch",
  "label": "Plan Next Batch",
  "description": "Preview next worker batch respecting conflict groups",
  "preview": {
    "candidates": [],
    "notes": "No queued issues"
  },
  "dryRun": true
}
```

**Errors:**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Missing actionId" }` |
| 404 | `{ "error": "Action not found" }` |
| 500 | `{ "error": "Preview failed", "details": "..." }` |

---

### `POST /api/actions/execute`

Execute an action with audit logging. Dangerous actions require
explicit confirmation.

**Request Body:**

```json
{
  "actionId": "provider-rotation",
  "payload": { "providerId": "provider-default" },
  "confirm": true,
  "confirmationToken": "ROTATE"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `actionId` | string | Yes | Action module id |
| `payload` | object | No | Action-specific parameters |
| `confirm` | boolean | Yes* | Required `true` for dangerous actions |
| `confirmationToken` | string | Yes* | Typed confirmation phrase |

\* Required when `action.dangerous === true`.

**Response:** `200 OK`

```json
{
  "ok": true,
  "auditId": "audit-1715500000000-abc123",
  "result": {
    "providerId": "provider-default",
    "status": "available",
    "cooldownCleared": true
  }
}
```

**Errors:**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Missing actionId" }` |
| 404 | `{ "error": "Action not found" }` |
| 409 | `{ "error": "Dangerous action requires confirm: true" }` |
| 500 | `{ "error": "Execution failed", "auditId": "audit-...", "details": "..." }` |

---

### Registered Action Modules

| Module | id | dangerous | Description |
|--------|----|-----------|-------------|
| compile-tasks | `compile-tasks` | No | Compile issue JSON into worker task contracts |
| create-issues | `create-issues` | Yes | Propose/create GitHub issues from gap analysis |
| issue-state | `issue-state` | Yes | Reconcile issue labels/PRs and close done issues |
| launch-batch | `launch-batch` | Yes | Run launch gate on queued tasks, dispatch workers |
| merge-prs | `merge-prs` | Yes | Merge explicit allowlist of PRs with health gate |
| plan-next-batch | `plan.next.batch` | No | Preview next worker batch respecting conflict groups |
| provider-rotation | `provider-rotation` | Yes | Preview/execute provider credential rotation |
| worker-control | `worker.control` | Yes | List, preview, and stop workers |

Each module exports `{ id, label, description, dangerous, preview(payload), execute(payload) }`.

---

## `/api/audit` — Audit Trail

### `GET /api/audit`

Retrieve the action execution audit trail. Read-only; never modifies
the audit log.

**Query Parameters:**

| Param | Type | Default | Constraints | Description |
|-------|------|---------|-------------|-------------|
| `actionId` | string | — | Exact match | Filter by action id |
| `status` | string | — | `success` or `error` | Filter by outcome |
| `limit` | number | 50 | Max 500 | Entries to return |

**Response:** `200 OK`

```json
{
  "entries": [
    {
      "id": "audit-1715500000000-abc123",
      "actionId": "provider-rotation",
      "startedAt": "2026-05-12T10:00:00.000Z",
      "completedAt": "2026-05-12T10:00:01.000Z",
      "status": "success",
      "payload": { "providerId": "***" },
      "result": { "enabled": true },
      "confirmationToken": "provided"
    }
  ],
  "total": 1,
  "unfilteredTotal": 42,
  "filters": { "actionId": "provider-rotation", "limit": 50 }
}
```

The `filters` and `unfilteredTotal` fields are present only when
query filters are applied. All `payload` and `result` fields pass
through `sanitizeObject` — fields matching `api_key`, `token`,
`secret`, `password`, `credential`, `auth` are redacted; long
alphanumeric strings (>20 chars) are masked.

**Errors:**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Invalid limit" }` |

---

## `/api/planning` — Planning Console

### `GET /api/planning`

Read-only planning console state. Always returns HTTP 200 — when the
state file is missing, an empty projection is returned.

Data source: `.github/ai-state/webui-planning-console.json`

**Response:** `200 OK`

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-12T00:30:00Z",
  "candidates": [
    {
      "issueNumber": 689,
      "title": "Implement feature X",
      "taskType": "execution",
      "risk": "medium",
      "conflictGroup": "auth-slice",
      "actorRole": "claude-code-worker",
      "readiness": "ready",
      "readinessNote": "All dependencies resolved"
    }
  ],
  "summary": {
    "ready": 1,
    "blocked": 0,
    "done": 0,
    "total": 1
  }
}
```

**Empty projection** (state file missing):

```json
{
  "schemaVersion": 1,
  "capturedAt": null,
  "candidates": [],
  "summary": {
    "ready": 0,
    "blocked": 0,
    "done": 0,
    "total": 0
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | number | Always `1` |
| `capturedAt` | string\|null | ISO 8601 timestamp of state capture |
| `candidates` | array | Planning candidates with readiness status |
| `summary` | object | Aggregate counts by readiness |

**Candidate Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `issueNumber` | number | GitHub issue number |
| `title` | string | Issue title |
| `taskType` | string | `execution`, `docs`, or `test` |
| `risk` | string | `low`, `medium`, `high`, or `critical` |
| `conflictGroup` | string | Concurrency conflict group identifier |
| `actorRole` | string | Required actor role for execution |
| `readiness` | string | `ready`, `blocked`, or `done` |
| `readinessNote` | string | Human-readable readiness explanation |

All candidate fields are sanitized via `sanitizeObject`.

---

## Error Format

All endpoints use a consistent error shape:

```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE",
  "statusCode": 400
}
```

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `MISSING_ACTION_ID` | 400 | `actionId` not provided |
| `ACTION_NOT_FOUND` | 404 | Action module id not registered |
| `CONFIRMATION_REQUIRED` | 409 | Dangerous action without `confirm: true` |
| `PREVIEW_FAILED` | 500 | Action preview threw |
| `EXECUTION_FAILED` | 500 | Action execution threw |
| `INVALID_LIMIT` | 400 | Audit limit exceeds 500 or is not a number |

---

## Data Sources

| Endpoint Group | Primary Source | Secondary Source |
|----------------|----------------|------------------|
| `/api/actions` | `tools/provider-pool-webui/actions/*.js` | Action registry at startup |
| `/api/audit` | In-memory audit log (per session) | — |
| `/api/planning` | `.github/ai-state/webui-planning-console.json` | — |

---

## Preview-First Safety Contract

Every action module exports both `preview()` and `execute()`:

```js
// tools/provider-pool-webui/actions/<name>.js
module.exports = {
  id: 'provider-rotation',
  label: 'Provider Rotation',
  description: 'Preview/execute provider credential rotation',
  dangerous: true,
  preview(payload) { /* dry-run, no side effects */ },
  execute(payload) { /* mutates state, writes audit */ }
};
```

The `/api/actions/preview` endpoint calls `preview()` and returns
the projected result without writing audit or mutating state. The UI
shows the preview result with a blue badge before allowing execute.

---

## Non-Goals

- No real-time WebSocket push (polling is sufficient for local use).
- No external network access or cloud deployment.
- No user authentication or role-based access control.
- No modification of actual API credentials through the WebUI.
- No integration with the production NestJS application modules.

---

## Cross-References

- [Provider Pool WebUI API (ai-native)](../ai-native/provider-pool-webui-api.md)
- [WebUI Actions API](../ai-native/provider-pool-webui-actions-api.md)
- [WebUI Audit Filtering](../ai-native/provider-pool-webui-audit-filtering.md)
- [WebUI Planning API](../ai-native/provider-pool-webui-planning-api.md)
- [WebUI Control Map](../ai-native/webui-control-map.md)
- [Operation Console](../ai-native/provider-pool-webui-operation-console.md)
