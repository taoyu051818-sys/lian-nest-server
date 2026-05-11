# Provider Pool WebUI API Contract

Local-only REST API surface for the provider pool management WebUI.
All endpoints are served from the local dev server and are **never
exposed to the public internet**.

> **Closes:** [#532](https://github.com/taoyu051818-sys/lian-nest-server/issues/532)

---

## Overview

The provider pool WebUI allows operators to view and manage providers,
workers, resource quotas, and worker-provider assignments through a
local dashboard. All data comes from the policy and state files defined
in the provider pool architecture.

```
  ┌──────────────────────┐
  │  WebUI (localhost)    │
  │  provider-pool-panel  │
  └──────────┬───────────┘
             │ HTTP (localhost only)
             ▼
  ┌──────────────────────────────────┐
  │  /api/provider-pool/*            │
  │  (local Nest dev server)         │
  └──────────┬───────────────────────┘
             │ reads
             ▼
  ┌──────────────────────────────────┐
  │  .github/ai-policy/              │
  │    provider-pool-policy.json     │
  │  .github/ai-state/               │
  │    provider-pool.json            │
  └──────────────────────────────────┘
```

---

## Base URL

```
http://localhost:3000/api/provider-pool
```

All endpoints require the server to be running locally. No
authentication is required (local-only access). No secrets are ever
returned by any endpoint.

---

## Endpoints

### Providers

#### `GET /providers`

List all configured providers with current status.

**Response:** `200 OK`

```json
{
  "providers": [
    {
      "id": "provider-default",
      "label": "Primary Claude credential",
      "status": "available",
      "capabilities": ["claude-code", "print-mode"],
      "currentConcurrency": 2,
      "maxConcurrency": 5,
      "cooldownExpiresAt": null,
      "lastFailureClass": null
    }
  ],
  "global": {
    "totalProviders": 1,
    "available": 1,
    "exhausted": 0,
    "disabled": 0
  }
}
```

#### `GET /providers/:id`

Get details for a single provider.

**Parameters:**

| Name | In   | Type   | Description     |
|------|------|--------|-----------------|
| `id` | path | string | Provider id     |

**Response:** `200 OK`

```json
{
  "id": "provider-default",
  "label": "Primary Claude credential",
  "status": "available",
  "capabilities": ["claude-code", "print-mode"],
  "currentConcurrency": 2,
  "maxConcurrency": 5,
  "cooldownExpiresAt": null,
  "lastFailureClass": null,
  "history": [
    {
      "timestamp": "2026-05-11T12:00:00Z",
      "event": "exhausted",
      "failureClass": "exhaustion"
    }
  ]
}
```

**Errors:**

| Status | Body                              |
|--------|-----------------------------------|
| 404    | `{ "error": "Provider not found" }` |

---

### Workers

#### `GET /workers`

List all active workers with provider assignments.

**Response:** `200 OK`

```json
{
  "workers": [
    {
      "workerId": "wave14-worker-07",
      "providerId": "provider-default",
      "status": "running",
      "startedAt": "2026-05-11T12:00:00Z",
      "taskType": "execution",
      "issueNumber": 532
    }
  ],
  "summary": {
    "totalActive": 5,
    "byProvider": {
      "provider-default": 3,
      "provider-secondary": 2
    },
    "byStatus": {
      "running": 4,
      "idle": 1
    }
  }
}
```

#### `GET /workers/:id`

Get details for a single worker.

**Parameters:**

| Name | In   | Type   | Description   |
|------|------|--------|---------------|
| `id` | path | string | Worker id     |

**Response:** `200 OK`

```json
{
  "workerId": "wave14-worker-07",
  "providerId": "provider-default",
  "status": "running",
  "startedAt": "2026-05-11T12:00:00Z",
  "taskType": "execution",
  "issueNumber": 532,
  "heartbeat": {
    "lastSeen": "2026-05-11T12:15:00Z",
    "interval": 60
  }
}
```

**Errors:**

| Status | Body                              |
|--------|-----------------------------------|
| 404    | `{ "error": "Worker not found" }` |

---

### Resources

#### `GET /resources`

Get current resource quota status across all providers.

**Response:** `200 OK`

```json
{
  "concurrency": {
    "globalMaxWorkers": 30,
    "currentActiveWorkers": 12,
    "headroom": 18
  },
  "providers": [
    {
      "id": "provider-default",
      "maxConcurrency": 15,
      "currentConcurrency": 8,
      "headroom": 7,
      "status": "available"
    },
    {
      "id": "provider-secondary",
      "maxConcurrency": 15,
      "currentConcurrency": 4,
      "headroom": 11,
      "status": "available"
    }
  ],
  "utilization": {
    "percentage": 40,
    "level": "normal"
  }
}
```

#### `PUT /resources/limits`

Update global or per-provider concurrency limits. Requires a running
server; changes are persisted to the policy file.

**Request Body:**

```json
{
  "globalMaxWorkers": 35
}
```

or per-provider:

```json
{
  "providerId": "provider-default",
  "maxConcurrency": 20
}
```

**Response:** `200 OK`

```json
{
  "ok": true,
  "updated": {
    "field": "globalMaxWorkers",
    "oldValue": 30,
    "newValue": 35
  }
}
```

**Errors:**

| Status | Body                                           |
|--------|------------------------------------------------|
| 400    | `{ "error": "Invalid limit value" }`           |
| 404    | `{ "error": "Provider not found" }`            |

---

### Assignments

#### `GET /assignments`

List current worker-to-provider assignments.

**Response:** `200 OK`

```json
{
  "assignments": [
    {
      "workerId": "wave14-worker-07",
      "providerId": "provider-default",
      "assignedAt": "2026-05-11T12:00:00Z",
      "status": "active"
    }
  ],
  "unassigned": []
}
```

#### `POST /assignments`

Create a new worker-to-provider assignment (manual override).

**Request Body:**

```json
{
  "workerId": "wave14-worker-08",
  "providerId": "provider-secondary"
}
```

**Response:** `201 Created`

```json
{
  "ok": true,
  "assignment": {
    "workerId": "wave14-worker-08",
    "providerId": "provider-secondary",
    "assignedAt": "2026-05-11T12:30:00Z",
    "status": "active",
    "source": "manual"
  }
}
```

**Errors:**

| Status | Body                                           |
|--------|------------------------------------------------|
| 400    | `{ "error": "Missing workerId or providerId" }` |
| 404    | `{ "error": "Provider not found" }`             |
| 409    | `{ "error": "Worker already assigned" }`        |

#### `DELETE /assignments/:workerId`

Remove a worker-to-provider assignment.

**Parameters:**

| Name       | In   | Type   | Description |
|------------|------|--------|-------------|
| `workerId` | path | string | Worker id   |

**Response:** `200 OK`

```json
{
  "ok": true,
  "removed": {
    "workerId": "wave14-worker-08",
    "providerId": "provider-secondary"
  }
}
```

**Errors:**

| Status | Body                                   |
|--------|----------------------------------------|
| 404    | `{ "error": "Assignment not found" }`  |

---

## Data Sources

| Endpoint Group | Primary Source | Secondary Source |
|----------------|----------------|------------------|
| `/providers`   | `.github/ai-state/provider-pool.json` | `.github/ai-policy/provider-pool-policy.json` |
| `/workers`     | Active worker heartbeats | Worker telemetry ndjson |
| `/resources`   | `.github/ai-state/provider-pool.json` | `.github/ai-policy/provider-pool-policy.json` |
| `/assignments` | Worker dispatch records | Provider selector output |

---

## Security Constraints

| Rule | Enforcement |
|------|-------------|
| No secrets in responses | All endpoints strip credential data before returning |
| Localhost only | Server binds to `127.0.0.1`, not `0.0.0.0` |
| No auth tokens | Endpoints are unauthenticated (local dev only) |
| No provider secrets | `apiKey`, `token`, `secret` fields are never exposed |
| Read-heavy | Write endpoints only modify policy/state JSON, not credentials |

---

## Error Format

All errors follow a consistent shape:

```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE",
  "statusCode": 400
}
```

| Code                  | HTTP Status | Meaning                          |
|-----------------------|-------------|----------------------------------|
| `PROVIDER_NOT_FOUND`  | 404         | Provider id does not exist       |
| `WORKER_NOT_FOUND`    | 404         | Worker id does not exist         |
| `ASSIGNMENT_CONFLICT` | 409         | Worker already assigned          |
| `INVALID_LIMIT`       | 400         | Concurrency limit is not valid   |
| `MISSING_FIELD`       | 400         | Required request body field missing |

---

## Non-Goals

- No real-time WebSocket push (polling is sufficient for local use).
- No external network access or cloud deployment.
- No user authentication or role-based access control.
- No modification of actual API credentials through the WebUI.
- No integration with the production NestJS application modules.

---

## References

- [Provider Pool](provider-pool.md) — full architecture and planning
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch validation
- [Worker Heartbeat](worker-heartbeat.md) — process-level monitoring
- [Worker Telemetry Schema](worker-telemetry-schema.md) — telemetry format
- [Launch Gate](launch-gate.md) — pre-launch health checks
