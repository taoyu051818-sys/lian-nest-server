# WebUI Action: launch-batch

WebUI action module that runs the launch gate on queued tasks and produces a
launch plan.  Preview mode returns the plan without side effects; execute mode
dispatches the batch when the gate passes.

> **Closes:** [#680](https://github.com/taoyu051818-sys/lian-nest-server/issues/680)

---

## Module Location

```
tools/provider-pool-webui/actions/launch-batch.js
```

Loaded dynamically by the WebUI server via `loadActionModules()`.

---

## Action Contract

| Field | Value |
|-------|-------|
| `id` | `launch-batch` |
| `label` | Launch Batch |
| `dangerous` | `true` |
| `preview` | Returns gate report + launch plan (dry-run) |
| `execute` | Dispatches batch via `batch-launch.ps1` |

Execute requires `confirm: true` in the request body (enforced by the server).

---

## Payload

```json
{
  "tasks": [
    {
      "targetIssue": 680,
      "conflictGroup": "webui-action-launch-batch",
      "risk": "high",
      "taskType": "execution",
      "mainHealthPolicy": null,
      "allowedFiles": [
        "tools/provider-pool-webui/actions/launch-batch.js",
        "docs/ai-native/webui-action-launch-batch.md"
      ],
      "sharedLocks": [],
      "budget": {
        "maxFiles": 4,
        "maxLinesChanged": 700,
        "softTimeMinutes": 45,
        "hardTimeMinutes": 90
      }
    }
  ]
}
```

When `payload.tasks` is omitted or empty, the module falls back to reading
`.github/ai-state/webui-queue-state.json` and uses entries with
`status: "queued"`.

---

## Launch Gate Logic

The module implements the same gate logic as `check-launch-gate.ps1`:

### 1. Worker Type Classification

| Priority | Condition | Type |
|----------|-----------|------|
| 1 | `mainHealthPolicy = "gate-docs-only"` | `docs` |
| 1 | `mainHealthPolicy = "gate-none"` | `research` |
| 2 | All `allowedFiles` under `docs/` | `docs` |
| 2 | All `allowedFiles` under `scripts/` (no `src/`) | `health-repair` |
| 3 | `allowedFiles` includes `src/` with `risk: "high"` | `foundation-fix` |
| 3 | `allowedFiles` includes `src/` otherwise | `runtime-feature` |
| 4 | `taskType = "research"` | `research` |
| 5 | Fallback | `health-repair` |

### 2. Permission Matrix

| Worker Type | Green | Yellow | Red | Black |
|-------------|:-----:|:------:|:---:|:-----:|
| Runtime feature | Yes | No | No | No |
| Foundation fix | Yes | Yes | Yes | No |
| Docs | Yes | Yes | No | No |
| Health / CI repair | Yes | Yes | Yes | No |
| Test-only | Yes | Yes | No | No |
| Research | Yes | Yes | Yes | No |

### 3. Conflict Detection

- **Duplicate conflict groups** — two tasks in the same batch with the same
  `conflictGroup` (non-docs) are flagged.
- **Shared lock overlap** — two tasks claiming the same `sharedLocks` entry
  are flagged.
- **Running worker conflict** — tasks whose `conflictGroup` matches an active
  worker (from `.github/ai-state/running-tasks.json`) are blocked.

---

## Preview Response

```json
{
  "status": "preview",
  "mode": "dry-run",
  "mainHealth": { "state": "green", "source": ".github/ai-state/main-health.json" },
  "gateReport": {
    "reportVersion": 1,
    "capturedAt": "2026-05-12T00:15:00.000Z",
    "mainState": "green",
    "taskCount": 1,
    "tasks": [
      {
        "targetIssue": 680,
        "conflictGroup": "webui-action-launch-batch",
        "risk": "high",
        "taskType": "execution",
        "workerType": "foundation-fix",
        "mainState": "green",
        "allowed": true,
        "reason": null,
        "rule": null
      }
    ],
    "duplicateConflictGroups": [],
    "sharedLockConflicts": [],
    "runningWorkerConflicts": [],
    "allAllowed": true
  },
  "launchPlan": { "..." : "..." },
  "message": "All 1 task(s) cleared for launch."
}
```

---

## Execute Response (Success)

```json
{
  "status": "launched",
  "mode": "execute",
  "mainHealth": { "state": "green" },
  "gateReport": { "..." : "..." },
  "launchPlan": { "..." : "..." },
  "dispatch": {
    "dispatched": true,
    "exitCode": 0,
    "summary": "Batch launched successfully."
  },
  "message": "Batch launched successfully."
}
```

---

## Execute Response (Blocked)

When the gate blocks any task, execute returns without dispatching:

```json
{
  "status": "blocked",
  "message": "Launch gate blocked 1 task(s). Resolve blockers before executing.",
  "gateReport": { "..." : "..." },
  "blockedTasks": [
    {
      "targetIssue": 680,
      "reason": "Worker type 'runtime-feature' is not permitted when main is red.",
      "rule": "health-state-blocked"
    }
  ]
}
```

---

## Safety Guards

| Guard | Implementation |
|-------|---------------|
| Preview-first | `preview()` computes the full plan without side effects. |
| Dangerous flag | Server requires `confirm: true` before calling `execute()`. |
| Gate blocks dispatch | `execute()` refuses to launch when `allAllowed` is false. |
| Sanitized JSON | All output passes through the server's `sanitizeObject()`. |
| No secrets | Module reads only public state files; never touches `.env` or provider keys. |
| No raw stdout/stderr | `batch-launch.ps1` output is captured and summarized, not streamed. |

---

## File Dependencies

| File | Read/Write | Purpose |
|------|:----------:|---------|
| `.github/ai-state/main-health.json` | Read | Main branch health state |
| `.github/ai-policy/launch-policy.json` | Read | Launch policy (fallback reference) |
| `.github/ai-state/webui-queue-state.json` | Read | Queue entries when no payload tasks |
| `.github/ai-state/running-tasks.json` | Read | Active worker manifest for conflict check |
| `scripts/ai/batch-launch.ps1` | Execute | Batch dispatch script (execute mode only) |

---

## HTTP API

### Preview

```bash
curl -X POST http://127.0.0.1:4179/api/actions/preview \
  -H "Content-Type: application/json" \
  -d '{"actionId":"launch-batch","payload":{"tasks":[...]}}'
```

### Execute

```bash
curl -X POST http://127.0.0.1:4179/api/actions/execute \
  -H "Content-Type: application/json" \
  -d '{"actionId":"launch-batch","payload":{"tasks":[...]},"confirm":true}'
```

---

## References

- [Launch Gate](launch-gate.md) — Gate checker logic and report format.
- [Launch Policy](launch-policy.md) — Machine-readable policy JSON.
- [Gate Result Schema](gate-result-schema.md) — Gate decision output schema.
- [Launch Plan Schema](launch-plan-schema.md) — Compiled launch plan schema.
- [WebUI Action Contract](webui-action-contract.md) — Request/result/audit schemas.
- [Provider Pool WebUI Actions API](provider-pool-webui-actions-api.md) — HTTP endpoints.
