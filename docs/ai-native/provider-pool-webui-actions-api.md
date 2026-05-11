# Provider Pool WebUI Actions API

Local-only action endpoints for the provider pool WebUI control console.
Enables preview, execution, and audit of orchestration actions through
action modules loaded from `tools/provider-pool-webui/actions/`.

> **Closes:** [#649](https://github.com/taoyu051818-sys/lian-nest-server/issues/649)

---

## Overview

The actions API extends the WebUI server with controlled action
execution. Action modules are optional `.js` files in the `actions/`
directory. If no modules exist, the endpoints return empty results
gracefully.

```
  Browser (localhost)
       │
       ▼
  GET /api/actions           → list available actions
  POST /api/actions/preview  → dry-run preview
  POST /api/actions/execute  → execute with audit
  GET /api/audit             → view audit trail
```

---

## Action Modules

Each action module is a `.js` file in `tools/provider-pool-webui/actions/`
that exports:

```js
module.exports = {
  id: "my-action",
  label: "My Action",
  description: "Does something useful",
  dangerous: false,           // requires confirm: true if true
  preview(payload) { ... },   // optional: returns preview object
  execute(payload) { ... },   // required: performs the action
};
```

### Module contract

| Field        | Type    | Required | Description                                |
|-------------|---------|----------|--------------------------------------------|
| `id`        | string  | yes      | Unique action identifier                   |
| `label`     | string  | yes      | Human-readable display name                |
| `description`| string | no       | Short description shown in listings        |
| `dangerous` | boolean | no       | If true, execute requires `confirm: true`  |
| `preview`   | function| no       | Dry-run; returns what execute would do     |
| `execute`   | function| yes      | Performs the action; returns result object |

---

## Endpoints

### `GET /api/actions`

List all available action modules.

**Response:** `200 OK`

```json
{
  "actions": [
    {
      "id": "reset-cooldown",
      "label": "Reset Provider Cooldown",
      "description": "Clear cooldown timer for a provider",
      "dangerous": false
    }
  ]
}
```

Returns `{ "actions": [] }` when no action modules are installed.

---

### `POST /api/actions/preview`

Preview what an action would do (dry-run, no side effects).

**Request Body:**

```json
{
  "actionId": "reset-cooldown",
  "payload": { "providerId": "provider-default" }
}
```

**Response:** `200 OK`

```json
{
  "actionId": "reset-cooldown",
  "label": "Reset Provider Cooldown",
  "description": "Clear cooldown timer for a provider",
  "preview": {
    "wouldReset": true,
    "providerId": "provider-default",
    "currentCooldown": "2026-05-11T12:05:00Z"
  },
  "dryRun": true
}
```

**Errors:**

| Status | Body                                    |
|--------|-----------------------------------------|
| 400    | `{ "error": "Missing actionId" }`       |
| 404    | `{ "error": "Action not found" }`       |
| 500    | `{ "error": "Preview failed: ..." }`    |

---

### `POST /api/actions/execute`

Execute an action. All payloads and results are sanitized (secrets
stripped). Dangerous actions require `confirm: true`.

**Request Body:**

```json
{
  "actionId": "reset-cooldown",
  "payload": { "providerId": "provider-default" },
  "confirm": true,
  "confirmationToken": "optional-token"
}
```

**Response:** `200 OK`

```json
{
  "ok": true,
  "auditId": "audit-1683812400000-x7k9m2",
  "result": {
    "reset": true,
    "providerId": "provider-default"
  }
}
```

**Errors:**

| Status | Body                                                        |
|--------|-------------------------------------------------------------|
| 400    | `{ "error": "Missing actionId" }`                           |
| 404    | `{ "error": "Action not found" }`                           |
| 409    | `{ "error": "...marked dangerous. Set confirm: true..." }`  |
| 500    | `{ "ok": false, "auditId": "...", "error": "..." }`         |

Every execution (success or failure) is written to the audit log.

---

### `GET /api/audit`

View the action execution audit trail.

**Response:** `200 OK`

```json
{
  "entries": [
    {
      "id": "audit-1683812400000-x7k9m2",
      "actionId": "reset-cooldown",
      "startedAt": "2026-05-11T12:00:00.000Z",
      "completedAt": "2026-05-11T12:00:00.015Z",
      "status": "success",
      "payload": { "providerId": "provider-default" },
      "result": { "reset": true },
      "confirmationToken": "provided"
    }
  ],
  "total": 1
}
```

Audit entries never contain raw secrets — all fields are sanitized
before storage.

---

## Security

| Rule | Enforcement |
|------|-------------|
| Localhost only | Server binds to `127.0.0.1` |
| No secrets in responses | All payloads/results pass through `sanitizeObject` |
| Dangerous actions gated | `dangerous: true` modules require `confirm: true` |
| Audit trail | Every execute call writes an audit entry |
| Secret key detection | Keys matching `api_key`, `token`, `secret`, etc. are redacted |
| Token-like values | Strings >20 chars matching `[A-Za-z0-9_-]+` are masked |

---

## Sanitization

All action payloads and results are sanitized before storage or
response. Fields matching secret-related patterns are replaced with
`***REDACTED***`:

- `api_key`, `apiKey`, `token`, `secret`, `password`, `credential`, `auth`
- Long alphanumeric strings (>20 chars) that resemble tokens

---

## Non-Goals

- No client UI (dashboard changes are out of scope)
- No bypass of policy/gate semantics
- No remote access — localhost binding only
- No modification of NestJS application modules

---

## References

- [Provider Pool WebUI API](provider-pool-webui-api.md) — base API surface
- [Provider Pool WebUI Architecture](provider-pool-webui-architecture.md) — architecture
- [Provider Pool WebUI Security](provider-pool-webui-security.md) — security model
