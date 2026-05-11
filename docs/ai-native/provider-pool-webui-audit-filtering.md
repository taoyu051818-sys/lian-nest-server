# Provider Pool WebUI — Audit Filtering API

> **Closes:** [#693](https://github.com/taoyu051818-sys/lian-nest-server/issues/693)

---

## Overview

The audit filtering API extends the existing `GET /api/audit` endpoint with
query parameters that allow operators to inspect the action execution audit
trail more efficiently. This is a **read-only** enhancement — no mutation
of the audit log occurs.

---

## Endpoint

### `GET /api/audit`

Retrieve the action execution audit trail with optional filters.

**Query Parameters:**

| Parameter  | Type   | Required | Description                                      |
|------------|--------|----------|--------------------------------------------------|
| `actionId` | string | No       | Filter entries by exact action id match          |
| `status`   | string | No       | Filter entries by status (`success` or `error`)  |
| `limit`    | number | No       | Max entries to return (capped at 500)            |

**Response:** `200 OK`

```json
{
  "entries": [
    {
      "id": "audit-1715500000000-abc123",
      "actionId": "rotate-keys",
      "startedAt": "2026-05-12T10:00:00.000Z",
      "completedAt": "2026-05-12T10:00:01.000Z",
      "status": "success",
      "payload": {},
      "result": {},
      "confirmationToken": "provided"
    }
  ],
  "total": 1,
  "unfilteredTotal": 42,
  "filters": {
    "actionId": "rotate-keys",
    "limit": 50
  }
}
```

**Field Descriptions:**

| Field             | Description                                            |
|-------------------|--------------------------------------------------------|
| `entries`         | Array of audit entries matching the applied filters    |
| `total`           | Count of entries in this response                      |
| `unfilteredTotal` | Total entries in the audit log before filtering        |
| `filters`         | Object describing the applied filters (omitted if none)|

---

## Safety Properties

- **Read-only:** The endpoint never modifies the audit log.
- **Limit capped:** The `limit` parameter is capped at 500 to prevent
  excessive memory usage or response size.
- **No raw command output:** Audit entries only contain sanitized payloads
  and results — no raw stdout/stderr.
- **Local-only:** The server binds to `127.0.0.1` and is not accessible
  from the network.

---

## Examples

### Get the last 10 audit entries

```
GET /api/audit?limit=10
```

### Get all failed executions

```
GET /api/audit?status=error
```

### Get successful executions of a specific action

```
GET /api/audit?actionId=rotate-keys&status=success
```

### Get the last 5 failed executions of a specific action

```
GET /api/audit?actionId=rotate-keys&status=error&limit=5
```

---

## Error Responses

| Status | Condition                           | Body                                            |
|--------|-------------------------------------|-------------------------------------------------|
| 400    | Invalid `limit` parameter           | `{ "error": "Invalid limit parameter" }`        |
| 404    | Unknown route                       | `{ "error": "Not found" }`                      |

---

## Validation

Run the following commands to verify the implementation:

```bash
npm run check
npm run build
node tools/provider-pool-webui/server.test.js
```

---

## Non-Goals

- No pagination cursor support (simple offset-based limit is sufficient
  for local audit logs).
- No sorting options (entries are returned in log order).
- No real-time push notifications for new audit entries.
- No modification or deletion of audit entries through this endpoint.
