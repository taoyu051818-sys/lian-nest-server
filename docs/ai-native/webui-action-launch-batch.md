# WebUI Action: launch-batch

WebUI action module that runs the launch gate on queued tasks and produces a
launch plan.  Preview mode returns the plan without side effects; execute mode
dispatches the batch when the gate passes.

> **Closes:** [#680](https://github.com/taoyu051818-sys/lian-nest-server/issues/680)
> **Documents:** [#878](https://github.com/taoyu051818-sys/lian-nest-server/issues/878)

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

## Validation Contract

### Task Field Defaults

Task fields are resolved with these defaults when missing from the payload:

| Field | Default | Notes |
|-------|---------|-------|
| `conflictGroup` | `null` | |
| `risk` | `"medium"` | |
| `taskType` | `"execution"` | |
| `mainHealthPolicy` | `null` | |
| `allowedFiles` | `[]` | Must be an array |
| `sharedLocks` | `[]` | Must be an array |

No schema or type validation is applied to individual field values.

### Health State Resolution

`.github/ai-state/main-health.json` is read to extract `health.state`.
If the file is missing or unreadable, the state defaults to `"green"`.
Unknown states (not in the permission matrix) block all worker types.

### Queue Fallback

When `payload.tasks` is absent or empty, the module reads
`.github/ai-state/webui-queue-state.json` and filters for
`status: "queued"` entries. If `entries` is not an array, the
fallback silently returns no tasks.

### Edge Cases

| Input | Behavior |
|-------|----------|
| `null` / `undefined` payload | Returns `status: "empty"`, `gateReport: null` |
| Empty `tasks` array and no queue file | Returns `status: "empty"`, `gateReport: null` |
| Unknown health state (e.g. `"purple"`) | All worker types blocked with `rule: "health-state-blocked"` |
| Missing `main-health.json` | Defaults to `"green"` (all allowed) |
| Missing `running-tasks.json` | No running-worker conflicts detected |
| `allowedFiles: []` | Classifies as `"health-repair"` (fallback) |
| Docs-only conflict group duplicate | Exempt — two docs tasks may share a `conflictGroup` |
| `mainHealthPolicy: "gate-docs-only"` | Forces `"docs"` type regardless of `allowedFiles` |
| `mainHealthPolicy: "gate-none"` | Forces `"research"` type regardless of `allowedFiles` |

### Conflict Rule Priority

When a task matches multiple blocking rules, only the first applies.
Priority order:

1. `health-state-blocked` — worker type not permitted for current health
2. `conflict-group-duplicate` — non-docs duplicate conflict group in batch
3. `shared-lock-overlap` — lock name already claimed in batch
4. `running-worker-conflict` — conflict group matches an active worker

---

## Preview Response

Preview mode returns the gate report and launch plan without side effects.
The response contract varies by outcome.

### Dry-Run (tasks present)

```json
{
  "status": "preview",
  "mode": "dry-run",
  "mainHealth": {
    "state": "green",
    "source": "/abs/path/.github/ai-state/main-health.json"
  },
  "gateReport": {
    "reportVersion": 1,
    "capturedAt": "2026-05-12T00:15:00.000Z",
    "mainState": "green",
    "taskCount": 1,
    "tasks": [
      {
        "targetIssue": 680,
        "targetPR": null,
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
  "launchPlan": {
    "planVersion": 1,
    "capturedAt": "2026-05-12T00:15:00.000Z",
    "mainHealth": { "state": "green", "capturedAt": "2026-05-12T00:15:00.000Z" },
    "selectedTasks": [],
    "rejectedTasks": [],
    "locksAcquired": [],
    "budgetReservations": {
      "totalMaxFiles": 4,
      "totalMaxLinesChanged": 700,
      "taskCount": 1,
      "softTimeMinutesMax": 45,
      "hardTimeMinutesMax": 90
    },
    "allAllowed": true
  },
  "message": "All 1 task(s) cleared for launch."
}
```

`launchPlan.selectedTasks` contains tasks that passed the gate;
`rejectedTasks` contains blocked tasks. `budgetReservations` aggregates
the `budget` fields from all tasks.

### Dry-Run (blocked tasks)

When any task is blocked, `gateReport.allAllowed` is `false` and
`launchPlan.allAllowed` is `false`. The message changes:

```json
{
  "status": "preview",
  "mode": "dry-run",
  "gateReport": { "...": "..." },
  "launchPlan": { "...": "..." },
  "message": "1 of 2 task(s) blocked."
}
```

### Empty Preview

When no tasks are found from either payload or queue:

```json
{
  "status": "empty",
  "message": "No tasks to evaluate. Provide payload.tasks or queue entries.",
  "gateReport": null
}
```

### Gate Report Task Entry

Each entry in `gateReport.tasks` contains:

| Field | Type | Description |
|-------|------|-------------|
| `targetIssue` | number | Issue number |
| `targetPR` | number/null | PR number if applicable |
| `conflictGroup` | string/null | Conflict group name |
| `risk` | string | `"high"`, `"medium"`, or `"low"` |
| `taskType` | string | `"execution"` or `"research"` |
| `workerType` | string | Classified worker type |
| `mainState` | string | Health state at check time |
| `allowed` | boolean | Whether this task passed the gate |
| `reason` | string/null | Human-readable block reason |
| `rule` | string/null | Rule that blocked, or `null` |

### Conflict Summary Arrays

| Field | Contents |
|-------|----------|
| `duplicateConflictGroups` | Conflict group names that appeared more than once |
| `sharedLockConflicts` | Lock names claimed by multiple tasks |
| `runningWorkerConflicts` | `{ issue, conflictGroup }` for active worker overlaps |

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
