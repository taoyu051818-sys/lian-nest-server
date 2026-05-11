# WebUI Action — Plan Next Batch

Action module that previews the next worker batch by matching queued issues
to available provider capacity, respecting conflict groups.

> **Module:** [`tools/provider-pool-webui/actions/plan-next-batch.js`](../../tools/provider-pool-webui/actions/plan-next-batch.js)
> **Test:** [`tools/provider-pool-webui/action-modules.test.js`](../../tools/provider-pool-webui/action-modules.test.js)
> **Closes:** [#677](https://github.com/taoyu051818-sys/lian-nest-server/issues/677), [#881](https://github.com/taoyu051818-sys/lian-nest-server/issues/881)

---

## Overview

The `plan.next.batch` action reads provider pool state and queue state to
compute which queued issues could be launched in the next worker batch. It
is a preview-first action — the default mode is dry-run with no mutations.

| Aspect | Value |
|--------|-------|
| Action ID | `plan.next.batch` |
| Risk | low (preview) / medium (execute) |
| Default mode | preview (dry-run) |
| Dangerous | `false` (execute requires server-level `confirm: true`) |
| State reads | provider-pool.json, webui-queue-state.json |
| State writes | webui-batch-plan.json (execute only) |

---

## API

### Preview

```
POST /api/actions/preview
{
  "actionId": "plan.next.batch",
  "payload": {}
}
```

Response:

```json
{
  "actionId": "plan.next.batch",
  "label": "Plan Next Batch",
  "description": "...",
  "dryRun": true,
  "preview": {
    "ok": true,
    "dryRun": true,
    "plan": [
      {
        "issueNumber": 600,
        "providerId": "provider-default",
        "conflictGroup": "webui-action-plan-next-batch",
        "actorRole": "webui-control-console-worker"
      }
    ],
    "skipped": [],
    "capacity": {
      "availableProviders": 2,
      "queuedIssues": 3,
      "planned": 1,
      "skippedCount": 2
    },
    "timestamp": "2026-05-12T00:00:00.000Z"
  }
}
```

### Execute

```
POST /api/actions/execute
{
  "actionId": "plan.next.batch",
  "confirm": true,
  "payload": {
    "allowlist": [600, 601],
    "reason": "Batch launch for wave18"
  }
}
```

Execute requires:
- `confirm: true` (server-level guard)
- `allowlist` — array of issue numbers the plan may include
- `reason` — human-readable justification

If any planned issue is not in the allowlist, the execute is blocked.

---

## Output Contract

### Preview output

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `boolean` | Always `true` on success. |
| `dryRun` | `boolean` | Always `true` in preview mode. |
| `plan` | `array` | Planned entries — one per issue that can be launched. |
| `skipped` | `array` | Rejected entries — issues that could not be planned, with a reason. |
| `capacity` | `object` | Summary counts (see below). |
| `timestamp` | `string` | ISO 8601 timestamp. |

`capacity` fields: `availableProviders`, `queuedIssues`, `planned`, `skippedCount`.

### Plan entry schema

Each entry in `plan` has exactly four keys. Missing optional fields default to `null`.

| Field | Type | Description |
|-------|------|-------------|
| `issueNumber` | `number` | GitHub issue number. |
| `providerId` | `string` | Assigned provider identifier. |
| `conflictGroup` | `string \| null` | Conflict group name, or `null` if none. |
| `actorRole` | `string \| null` | Worker actor role, or `null` if none. |

### Skipped entry schema

Each entry in `skipped` explains why an issue was rejected from the plan.

| Field | Type | Description |
|-------|------|-------------|
| `issueNumber` | `number` | GitHub issue number. |
| `reason` | `string` | Rejection reason. |

Known reason values:
- `"No provider capacity remaining"` — all providers exhausted.
- `"Conflict group already scheduled: <group>"` — duplicate conflict group detected.

### Execute output

Returns the same `plan` and `skipped` arrays plus:

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `boolean` | `true` on success. |
| `reason` | `string` | Caller-provided justification. |
| `batchPath` | `string` | Always `"written"` on success. |
| `timestamp` | `string` | ISO 8601 timestamp. |

Execute also writes a batch plan file to `.github/ai-state/webui-batch-plan.json`:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "reason": "Batch launch for wave18",
  "plan": [],
  "skipped": []
}
```

### Error output

All error responses set `ok: false` and include an `error` message. Known errors:

| Error | Extra fields |
|-------|-------------|
| `"Execute requires an explicit allowlist array"` | — |
| `"Execute requires a non-empty reason string"` | — |
| `"Cannot read provider pool state"` | `statePath` |
| `"Cannot read queue state"` | `queuePath` |
| `"Plan includes issues not in allowlist"` | `blocked` (array of issue numbers) |

An empty plan is **not** an error — it returns `ok: true`, `plan: []`, and a `message: "No issues to batch"`.

### No direct launch

`plan.next.batch` is a **preview-only planning action**. It reads provider pool
and queue state to compute which issues *could* be launched, but it **never
launches workers**. Actual dispatch requires a separate `launch-batch` action
with `confirm: true`.

---

## Planning Algorithm

1. Read provider pool state; filter to providers with `status: "available"`
   and `headroom > 0` (maxConcurrency - currentConcurrency).
2. Read queue state; filter to entries with `state: "queued"`.
3. For each queued entry in order:
   - If no provider capacity remains, skip with reason.
   - If the entry's conflict group is already scheduled, skip.
   - Otherwise assign to the next provider with headroom.
4. Return the plan and skipped list.

---

## Safety

- **Preview is read-only.** No files are written, no GitHub mutations occur.
- **Execute validates allowlist.** Every planned issue must be in the caller's
  allowlist or the action is blocked.
- **No secrets.** Provider secrets, tokens, and source paths are stripped
  from state before planning. Output contains only public identifiers.
- **No raw logs.** The module returns structured JSON; no stdout/stderr is
  included in responses.
- **Audit trail.** Execute writes a batch plan file and the server appends
  an audit entry.

---

## Files

| File | Purpose |
|------|---------|
| `tools/provider-pool-webui/actions/plan-next-batch.js` | Action module implementation |
| `tools/provider-pool-webui/action-modules.test.js` | Tests for all action modules |
| `docs/ai-native/webui-action-plan-next-batch.md` | This document |

---

## References

- [WebUI Queue State Schema](webui-queue-state-schema.md) — Queue entry lifecycle and fields.
- [WebUI Action Contract](webui-action-contract.md) — Action request/result/audit schemas.
- [WebUI Action Registry](webui-action-registry.md) — Static action metadata.
- [Provider Pool WebUI Actions API](provider-pool-webui-actions-api.md) — Server-side action module loading.
