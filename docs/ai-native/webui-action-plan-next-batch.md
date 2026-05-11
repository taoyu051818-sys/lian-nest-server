# WebUI Action — Plan Next Batch

Action module that previews the next worker batch by matching queued issues
to available provider capacity, respecting conflict groups.

> **Module:** [`tools/provider-pool-webui/actions/plan-next-batch.js`](../../tools/provider-pool-webui/actions/plan-next-batch.js)
> **Test:** [`tools/provider-pool-webui/action-modules.test.js`](../../tools/provider-pool-webui/action-modules.test.js)
> **Closes:** [#677](https://github.com/taoyu051818-sys/lian-nest-server/issues/677)

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
