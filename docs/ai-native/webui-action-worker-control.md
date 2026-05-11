# WebUI Action: Worker Control

Module: `tools/provider-pool-webui/actions/worker-control.js`
Action ID: `worker.control`

## Overview

The worker-control action module provides list, preview, and stop operations for workers through the WebUI control console. It implements explicit worker targeting as a safety feature to prevent accidental operations on all workers.

## Safety Features

- **Explicit worker targeting**: All stop operations require the caller to specify which workers to operate on by ID. No wildcard or "all workers" operations are allowed. Wildcard strings (e.g. `["*"]`) are rejected as "not found" — there is no wildcard matching.
- **Preview-first**: The module is marked `dangerous: true`. The server's execute endpoint requires `confirm: true` before running it.
- **Reason required**: Stop operations require a human-readable reason string for audit purposes. Empty or whitespace-only reasons are rejected; leading/trailing whitespace is trimmed before storage.
- **Sanitized output**: All output passes through the server's `sanitizeObject()` before reaching the client. No raw stdout/stderr or secrets are returned.
- **Atomic state mutation**: If any worker ID in a stop request is not found, the entire operation fails and no state is modified. Partial stops do not occur.
- **Concurrency flooring**: `currentConcurrency` and `global.totalActiveWorkers` are clamped to a minimum of 0 and never go negative.
- **Source hygiene**: The module source is tested to contain no literal API key or token patterns (`sk-ant-*`, `ghp_*`, etc.).

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

## Test Coverage

Unit tests: `tools/provider-pool-webui/actions/worker-control.test.js`
Integration tests: `tools/provider-pool-webui/action-modules.test.js`

### Module Contract

- Exports `id` (`"worker.control"`), `label`, `description`, `dangerous` (`true`), `preview` (function), `execute` (function).

### Payload Validation

| Input | Expected Error |
|-------|---------------|
| `null` payload | `payload is required` |
| Missing `action` field | `action is required` |
| Non-string `action` (e.g. `123`) | `action is required` |
| Unknown action value | `Unknown action: X` |

Validation applies identically to both `preview` and `execute`.

### List Action

- Happy path returns `ok: true`, `action: "list"`, `total` matching concurrency sum, and worker array with explicit slot-pattern IDs (`{providerId}-slot-{index}`).
- All workers have status `"running"`.
- Empty providers returns `ok: true` with `total: 0` and empty array.
- Missing state file returns `Cannot load worker state`.
- `execute` list is identical to `preview` list (read-only, no mutation).

### Stop Preview

- Requires non-empty `workerIds` array; rejects missing, empty, or non-array.
- Returns `preview: true`, `total`, and `message` like `"Would stop N worker(s)"`.
- State file is **not** modified after preview (verified by re-reading file).
- Unknown worker ID fails with error mentioning the missing ID.
- Missing state file returns `Cannot load worker state`.

### Stop Execute

- Requires `workerIds` (non-empty array) and `reason` (non-empty after trim).
- Empty or whitespace-only `reason` is rejected.
- Happy path returns `ok: true`, `stopped` count, `workers` array, `reason`, and ISO `timestamp`.
- Decrements `currentConcurrency` for each affected provider and `global.totalActiveWorkers`.
- Multiple workers from the same provider: decrements that provider's concurrency by the count.
- Cross-provider stops: decrements each provider independently.
- Reason with leading/trailing whitespace is trimmed before storage.
- Concurrency values floor at 0 (never negative).
- Unknown worker ID: entire operation fails, state unchanged (atomic).
- Missing state file returns `Cannot load worker state`.

### Explicit Targeting Safety

- Empty `workerIds` array: rejected.
- Missing `workerIds` field: rejected.
- Wildcard string `["*"]`: rejected as "not found" (no wildcard matching).
- State unchanged after all rejections.

### Preview Read-Only Guarantee

- Calling `preview` for both `stop` and `list` does not modify the state file (verified by byte-comparing file content before and after).

### Source Hygiene

- Module source contains no literal token patterns (`sk-ant-*`, `sk-[A-Za-z0-9]{20,}`, `ghp_*`).
