# Provider Pool WebUI — Planning Console API

Read-only planning console state endpoint for the local-only Provider Pool
WebUI server. Exposes sanitized batch-planning candidates and readiness
summaries to the dashboard.

> **Closes:** [#689](https://github.com/taoyu051818-sys/lian-nest-server/issues/689)

---

## Overview

The planning console API adds a single read-only GET endpoint to the
existing WebUI server (`tools/provider-pool-webui/server.js`):

| Endpoint | Purpose | Data Source |
|----------|---------|-------------|
| `/api/planning` | Planning console state with candidates and readiness | `.github/ai-state/webui-planning-console.json` |

```
┌──────────────┐     GET /api/planning      ┌──────────────────────────┐
│  WebUI        │ ─────────────────────────> │  server.js               │
│  Dashboard    │ <───────────────────────── │                          │
│               │     200 JSON (sanitized)   │  reads + sanitizes       │
└──────────────┘                             │  planning-console.json   │
                                             └──────────────────────────┘
                                                      │
                                                      v
                                             ┌──────────────────────────┐
                                             │ .github/ai-state/        │
                                             │   webui-planning-        │
                                             │   console.json           │
                                             └──────────────────────────┘
```

The endpoint always returns HTTP 200 with valid JSON. When no planning
console state file exists, it returns an empty projection with zeroed
summary counts — matching the pattern used by `/api/queue`.

---

## Endpoints

### `GET /api/planning`

Returns the planning console state showing batch-planning candidates and
their readiness status. All values are sanitized — no API keys, tokens,
or local filesystem paths are exposed.

**Response:** `200 OK` (always returns valid JSON)

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-12T00:30:00Z",
  "candidates": [
    {
      "issueNumber": 689,
      "title": "Add WebUI Planning Console read API",
      "taskType": "execution",
      "risk": "medium",
      "conflictGroup": "planning-console-api",
      "actorRole": "webui-planning-console-worker",
      "readiness": "ready",
      "readinessNote": "Slice defined, ready for implementation"
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

When no planning console state file exists at
`.github/ai-state/webui-planning-console.json`, the endpoint returns an
empty projection (HTTP 200, not 503):

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

**Errors:**

This endpoint does not return error status codes. Missing or unreadable
state files produce the empty projection above (HTTP 200).

**Notes:**

- Candidate fields are sanitized via `sanitizeObject()` before response
  serialization. Any field matching the pattern
  `/(api[_-]?key|token|secret|password|credential)/i` is replaced with
  `***REDACTED***`. Long alphanumeric strings (>20 chars) are also masked.
- The `schemaVersion` field enables forward-compatible consumers. Current
  value is `1`.
- The `summary` object provides aggregate readiness counts for dashboard
  display without iterating the full candidate list.

---

## Security

| Constraint | Enforcement |
|------------|------------|
| No secrets | Response sanitized via `sanitizeObject()` — API keys, tokens, credentials redacted |
| No local paths | No `sourcePath` or filesystem paths in responses |
| Read-only | GET only — no POST/PUT/DELETE mutations |
| Localhost only | Server binds to `127.0.0.1` |

---

## Files

| File | Purpose |
|------|---------|
| `tools/provider-pool-webui/server.js` | Server implementation (endpoint handler) |
| `tools/provider-pool-webui/server.test.js` | Smoke tests (planning endpoint coverage) |
| `docs/ai-native/provider-pool-webui-planning-api.md` | This document |
| `.github/ai-state/webui-planning-console.json` | Planning console state (read by endpoint) |

---

## Non-Goals

- No write/mutation endpoints — planning state is read-only from the WebUI
- No worker launch or issue creation from this endpoint
- No direct integration with `plan-next-batch.ps1` — the state file is
  populated by separate tooling
- No real-time updates — dashboard polls on refresh

---

## References

- [Planning Loop](planning-loop.md) — batch-planning pipeline and output fields
- [Provider Pool WebUI API Contract](provider-pool-webui-api.md) — full REST API design
- [Provider Pool WebUI Workers API](provider-pool-webui-workers-api.md) — queue endpoint pattern (closest analog)
- [Provider Pool WebUI Server](provider-pool-webui-server.md) — server overview
