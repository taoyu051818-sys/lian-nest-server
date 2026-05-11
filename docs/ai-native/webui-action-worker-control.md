# WebUI Action: Worker Control

Module: `tools/provider-pool-webui/actions/worker-control.js`
Action ID: `worker.control`

## Overview

The worker-control action module provides list, preview, and stop operations for workers through the WebUI control console. It implements explicit worker targeting as a safety feature to prevent accidental operations on all workers.

## Safety Features

- **Explicit worker targeting**: All stop operations require the caller to specify which workers to operate on by ID. No wildcard or "all workers" operations are allowed.
- **Preview-first**: The module is marked `dangerous: true`. The server's execute endpoint requires `confirm: true` before running it.
- **Reason required**: Stop operations require a human-readable reason string for audit purposes.
- **Sanitized output**: All output passes through the server's `sanitizeObject()` before reaching the client. No raw stdout/stderr or secrets are returned.

## Actions

### List Workers

Read-only action that returns all active workers derived from the provider pool state.

```json
{
  "action": "list"
}
```

Response:

```json
{
  "ok": true,
  "action": "list",
  "workers": [
    { "workerId": "provider-1-slot-0", "providerId": "provider-1", "status": "running", "startedAt": "..." }
  ],
  "total": 3
}
```

### Preview Stop

Dry-run that shows what would happen without mutating state.

```json
{
  "action": "stop",
  "workerIds": ["provider-1-slot-0", "provider-1-slot-1"]
}
```

Response:

```json
{
  "ok": true,
  "action": "stop",
  "preview": true,
  "workers": [...],
  "total": 2,
  "message": "Would stop 2 worker(s)"
}
```

### Execute Stop

Mutating action that stops the specified workers and updates provider pool state.

```json
{
  "action": "stop",
  "workerIds": ["provider-1-slot-0"],
  "reason": "Scaling down provider-1"
}
```

The server requires `confirm: true` in the request body since this module is marked `dangerous`.

Response:

```json
{
  "ok": true,
  "action": "stop",
  "stopped": 1,
  "workers": ["provider-1-slot-0"],
  "reason": "Scaling down provider-1",
  "timestamp": "2026-05-12T00:00:00.000Z"
}
```

## Validation Rules

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `action` | Yes | `"list"` or `"stop"` | Must be a non-empty string |
| `workerIds` | For stop | `string[]` | Must be non-empty array of valid worker IDs |
| `reason` | For execute stop | `string` | Must be non-empty after trimming |

## Worker ID Format

Worker IDs follow the pattern `{providerId}-slot-{index}`. These are derived from the provider pool state file at `.github/ai-state/provider-pool.json`.

## API Examples

### List all workers

```bash
curl -X POST http://127.0.0.1:4179/api/actions/preview \
  -H "Content-Type: application/json" \
  -d '{"actionId": "worker.control", "payload": {"action": "list"}}'
```

### Preview stopping specific workers

```bash
curl -X POST http://127.0.0.1:4179/api/actions/preview \
  -H "Content-Type: application/json" \
  -d '{"actionId": "worker.control", "payload": {"action": "stop", "workerIds": ["provider-1-slot-0"]}}'
```

### Stop workers (requires confirmation)

```bash
curl -X POST http://127.0.0.1:4179/api/actions/execute \
  -H "Content-Type: application/json" \
  -d '{
    "actionId": "worker.control",
    "payload": {
      "action": "stop",
      "workerIds": ["provider-1-slot-0"],
      "reason": "Maintenance window"
    },
    "confirm": true
  }'
```

## State Mutation

When executing a stop action, the module:

1. Loads the provider pool state from `.github/ai-state/provider-pool.json`
2. Decrements `currentConcurrency` for each affected provider
3. Decrements `global.totalActiveWorkers` by the number of stopped workers
4. Writes the updated state back to the file

Concurrency values are clamped to a minimum of 0.

## Error Cases

| Error | Cause |
|-------|-------|
| `payload is required` | Null or undefined payload |
| `action is required` | Missing `action` field |
| `Unknown action: X` | Action is not `list` or `stop` |
| `Cannot load worker state` | State file missing or malformed |
| `workerIds array is required` | Stop action without `workerIds` |
| `Workers not found: X` | One or more worker IDs not in state |
| `reason is required for stop action` | Execute stop without a reason |

## Integration

This module is loaded by `server.js` via the `loadActionModules()` / `resolveAction()` functions. It is exposed through:

- `GET /api/actions` -- lists available modules
- `POST /api/actions/preview` -- dry-run preview
- `POST /api/actions/execute` -- mutation with audit trail

## Audit

All execute operations are logged to the server's audit file (`.audit-log.json`) with:

- Action ID and timestamp
- Sanitized payload (secrets stripped)
- Result summary
- Confirmation status
