# Provider Pool WebUI — Workers API

Worker, resource, and queue endpoints for the local-only Provider Pool
WebUI server. These extend the base state/policy endpoints with
control-loop data needed by the orchestrator and dashboard.

> **Closes:** [#605](https://github.com/taoyu051818-sys/lian-nest-server/issues/605)

---

## Overview

The workers API adds three read-only GET endpoints to the existing
WebUI server (`tools/provider-pool-webui/server.js`):

| Endpoint | Purpose | Data Source |
|----------|---------|-------------|
| `/api/workers` | Active worker slots per provider | Derived from `provider-pool.json` |
| `/api/resources` | Concurrency utilization and headroom | Derived from state + policy |
| `/api/queue` | Queue state projection | `.github/ai-state/webui-queue-state.json` |

All endpoints are read-only and serve no secrets. The server continues
to bind to `127.0.0.1` only.

---

## Endpoints

### `GET /api/workers`

Returns active worker slots derived from the provider pool state. Each
provider with `currentConcurrency > 0` generates that many synthetic
worker slot entries.

**Response:** `200 OK`

```json
{
  "workers": [
    {
      "workerId": "provider-default-slot-0",
      "providerId": "provider-default",
      "status": "running",
      "startedAt": "2026-05-11T00:00:00Z"
    }
  ],
  "summary": {
    "totalActive": 1,
    "byProvider": {
      "provider-default": 1
    },
    "byStatus": {
      "running": 1
    }
  }
}
```

**Errors:**

| Status | Body | Meaning |
|--------|------|---------|
| 503 | `{ "error": "State file not available" }` | `provider-pool.json` missing or unreadable |

**Notes:**

- Worker slots are derived, not individually tracked. The state file
  records aggregate concurrency counts per provider; individual worker
  metadata (task type, issue number, heartbeat) is not yet available
  from this projection.
- The `workerId` format `{providerId}-slot-{index}` is stable for a
  given state snapshot but not persistent across updates.

---

### `GET /api/resources`

Returns concurrency utilization and headroom across all providers.

**Response:** `200 OK`

```json
{
  "concurrency": {
    "globalMaxWorkers": 3,
    "currentActiveWorkers": 0,
    "headroom": 3
  },
  "providers": [
    {
      "id": "provider-default",
      "maxConcurrency": 1,
      "currentConcurrency": 0,
      "headroom": 1,
      "status": "available"
    }
  ],
  "utilization": {
    "percentage": 0,
    "level": "normal"
  }
}
```

**Utilization levels:**

| Percentage | Level | Meaning |
|------------|-------|---------|
| 0–69% | `normal` | Plenty of headroom |
| 70–89% | `elevated` | Approaching capacity |
| 90–100% | `critical` | At or near global limit |

**Errors:**

| Status | Body | Meaning |
|--------|------|---------|
| 503 | `{ "error": "State or policy file not available" }` | Either file missing or unreadable |

---

### `GET /api/queue`

Returns the queue state projection showing all tracked tasks and their
lifecycle state.

**Response:** `200 OK` (always returns valid JSON, even when no queue
file exists)

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T15:00:00Z",
  "entries": [
    {
      "issueNumber": 605,
      "state": "running",
      "updatedAt": "2026-05-11T14:45:00Z",
      "conflictGroup": "webui-server-workers-api",
      "branch": "claude/wave16-20260511-142540-issue-605-webui-api-workers",
      "prNumber": null,
      "actorRole": "ai-native-final-layer-worker",
      "pmPhase": "final-control-loop-wave16"
    }
  ],
  "summary": {
    "queued": 0,
    "launching": 0,
    "running": 1,
    "prCreated": 0,
    "blocked": 0,
    "done": 0
  }
}
```

When no queue state file exists at
`.github/ai-state/webui-queue-state.json`, the endpoint returns an
empty projection (HTTP 200, not 503):

```json
{
  "schemaVersion": 1,
  "capturedAt": null,
  "entries": [],
  "summary": {
    "queued": 0,
    "launching": 0,
    "running": 0,
    "prCreated": 0,
    "blocked": 0,
    "done": 0
  }
}
```

**Schema:** See [webui-queue-state-schema.md](webui-queue-state-schema.md)
for the full entry and summary field definitions.

---

## Security

| Constraint | Enforcement |
|------------|------------|
| No secrets | All endpoints derive data from sanitized state files |
| No local paths | No `sourcePath` or filesystem paths in responses |
| Read-only | No POST/PUT/DELETE endpoints |
| Localhost only | Server binds to `127.0.0.1` |

---

## Files

| File | Purpose |
|------|---------|
| `tools/provider-pool-webui/server.js` | Server implementation (all endpoints) |
| `docs/ai-native/provider-pool-webui-workers-api.md` | This document |
| `.github/ai-state/provider-pool.json` | Provider state (read by workers + resources) |
| `.github/ai-policy/provider-pool-policy.json` | Provider policy (read by resources) |
| `.github/ai-state/webui-queue-state.json` | Queue state projection (read by queue) |

---

## References

- [Provider Pool WebUI API Contract](provider-pool-webui-api.md) — full REST API design
- [Provider Pool WebUI Server](provider-pool-webui-server.md) — server overview
- [Worker Resource Schema](worker-resource-schema.md) — per-worker resource snapshot shape
- [WebUI Queue State Schema](webui-queue-state-schema.md) — queue entry lifecycle
