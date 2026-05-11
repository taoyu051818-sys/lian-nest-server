# WebUI Action Contract

Defines the safe action contract for the local control-plane WebUI.
Policy and schema only — no runtime behavior.

> **Schema files:**
> - [`schemas/webui-action-request.schema.json`](../../schemas/webui-action-request.schema.json)
> - [`schemas/webui-action-result.schema.json`](../../schemas/webui-action-result.schema.json)
> - [`schemas/webui-action-audit.schema.json`](../../schemas/webui-action-audit.schema.json)
> **Closes:** [#645](https://github.com/taoyu051818-sys/lian-nest-server/issues/645)

---

## Overview

The WebUI action contract defines how the control-plane WebUI dispatches
mutating actions against the orchestration system. Every action flows through
a three-phase pipeline:

1. **Request** — the WebUI or an agent submits an `WebUIActionRequest`.
2. **Evaluation** — the action handler computes effects and checks policy.
3. **Result + Audit** — a `WebUIActionResult` is returned and a
   `WebUIActionAudit` entry is appended to the audit log.

All mutating actions default to **preview mode**. Execute mode requires
explicit allowlists and a human-readable reason.

| Aspect | Value |
|--------|-------|
| Schema version | `schemaVersion: 1` |
| JSON Schema draft | `draft-07` |
| Runtime handler | Not yet implemented (schema-only) |

---

## Action Types

Each action type has a defined risk profile and required parameters.

| Action Type | Risk | Human Required | Description |
|-------------|------|----------------|-------------|
| `refresh-health` | low | No | Re-read health state without mutation. |
| `retry-worker` | medium | No | Restart a failed or stuck worker. |
| `cancel-worker` | high | Yes | Terminate a running worker. Destructive. |
| `clear-queue-entry` | medium | No | Remove a queue entry (must be terminal or blocked). |
| `adjust-provider-concurrency` | medium | No | Change max concurrency for a provider. |
| `disable-provider` | medium | No | Disable a provider (in-flight workers drain). |
| `enable-provider` | low | No | Re-enable a disabled provider. |
| `pause-orchestration` | high | Yes | Stop launching new workers. In-flight continue. |
| `resume-orchestration` | medium | No | Resume paused orchestration. |
| `override-gate` | critical | Yes | Bypass a gate decision. Requires justification. |
| `force-merge-pr` | critical | Yes | Merge a PR bypassing CI checks. |
| `rebalance-workers` | medium | No | Redistribute workers across providers. |

---

## Modes

### Preview Mode

- Computes the effects the action **would** have without applying them.
- No allowlist or reason required.
- Always safe — read-only.
- Use this to show the user what will happen before they confirm.

### Execute Mode

- Applies the action.
- **Requires** `allowlist` (explicit target list) and `reason` (justification).
- The handler must verify every target is in the allowlist before acting.
- If a target is not in the allowlist, the action is blocked.

---

## Safety Guards

### Allowlist Enforcement

Execute mode requires an explicit `allowlist` array. The handler must reject
any action whose targets are not a subset of the allowlist. This bounds the
blast radius of every action to the declared set.

```
request.allowlist = ["issue:540", "provider:openai-1"]
// Handler may only touch issue 540 and provider openai-1
```

### Human-Required Actions

High and critical risk actions set `humanRequired: true`. These cannot be
dispatched by automated agents — a human must initiate or confirm through
the WebUI.

### Risk Escalation

The WebUI must show escalating confirmation for actions at each risk level:

| Risk Level | UI Behavior |
|------------|-------------|
| `low` | No confirmation needed. |
| `medium` | Single confirmation dialog. |
| `high` | Confirmation dialog with effect preview. |
| `critical` | Confirmation dialog, effect preview, and typed confirmation (e.g. type "FORCE MERGE"). |

---

## Schemas

### WebUIActionRequest

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `1` | Yes | Schema version. |
| `requestId` | `string` | Yes | Idempotency key. |
| `mode` | `preview` / `execute` | Yes | Action mode. |
| `actionType` | `string` enum | Yes | Which action to perform. |
| `riskLevel` | `string` enum | Yes | Risk classification. |
| `humanRequired` | `boolean` | If high/critical | Must be true for high/critical. |
| `targetIssue` | `integer` or `null` | No | GitHub issue target. |
| `targetPR` | `integer` or `null` | No | GitHub PR target. |
| `targetProviderId` | `string` or `null` | No | Provider target. |
| `allowlist` | `string[]` | If execute | Explicit target allowlist. |
| `reason` | `string` | If execute or medium+ | Justification. |
| `params` | `object` | No | Action-specific parameters. |
| `requestedBy` | `string` or `null` | No | Requester identity. |
| `requestedAt` | ISO-8601 | Yes | When requested. |

### WebUIActionResult

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `1` | Yes | Schema version. |
| `requestId` | `string` | Yes | Matches request. |
| `mode` | `preview` / `execute` | Yes | Mode that was run. |
| `actionType` | `string` enum | Yes | Action that was evaluated. |
| `outcome` | `success` / `blocked` / `error` / `skipped` | Yes | Result outcome. |
| `effects` | `Effect[]` | No | Effects produced or applied. |
| `blockers` | `Blocker[]` | No | Policy blockers (if blocked). |
| `errors` | `Error[]` | No | Errors (if error). |
| `capturedAt` | ISO-8601 | Yes | When result was captured. |
| `durationMs` | `integer` or `null` | No | Wall-clock time. |

### WebUIActionAudit

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `1` | Yes | Schema version. |
| `auditId` | `string` | Yes | Unique audit entry id. |
| `requestId` | `string` | Yes | Matches request. |
| `mode` | `preview` / `execute` | Yes | Mode requested. |
| `actionType` | `string` enum | Yes | Action type. |
| `riskLevel` | `string` enum | Yes | Risk level. |
| `humanRequired` | `boolean` | No | Whether human was required. |
| `outcome` | `success` / `blocked` / `error` / `skipped` | Yes | Outcome. |
| `targetSummary` | `string` | No | One-line target summary. |
| `allowlistUsed` | `string[]` | No | Allowlist enforced. |
| `reason` | `string` or `null` | No | Justification provided. |
| `requestedBy` | `string` or `null` | No | Requester identity. |
| `blockerCount` | `integer` | No | Number of blockers. |
| `errorCount` | `integer` | No | Number of errors. |
| `effectCount` | `integer` | No | Number of effects. |
| `requestedAt` | ISO-8601 | Yes | When requested. |
| `capturedAt` | ISO-8601 | Yes | When audit entry was written. |
| `durationMs` | `integer` or `null` | No | Wall-clock time. |

---

## Examples

### Preview Request (Low Risk)

```json
{
  "schemaVersion": 1,
  "requestId": "req-preview-health-001",
  "mode": "preview",
  "actionType": "refresh-health",
  "riskLevel": "low",
  "requestedAt": "2026-05-11T22:00:00Z"
}
```

### Execute Request (High Risk)

```json
{
  "schemaVersion": 1,
  "requestId": "req-cancel-worker-001",
  "mode": "execute",
  "actionType": "cancel-worker",
  "riskLevel": "high",
  "humanRequired": true,
  "targetIssue": 540,
  "allowlist": ["issue:540"],
  "reason": "Worker stuck for 30+ minutes, no heartbeat",
  "requestedBy": "human:taoyu",
  "requestedAt": "2026-05-11T22:05:00Z"
}
```

### Success Result (Preview)

```json
{
  "schemaVersion": 1,
  "requestId": "req-preview-health-001",
  "mode": "preview",
  "actionType": "refresh-health",
  "outcome": "success",
  "effects": [
    {
      "target": "health-state",
      "description": "Would re-read main-health.json and update local cache"
    }
  ],
  "capturedAt": "2026-05-11T22:00:01Z"
}
```

### Blocked Result

```json
{
  "schemaVersion": 1,
  "requestId": "req-cancel-worker-001",
  "mode": "execute",
  "actionType": "cancel-worker",
  "outcome": "blocked",
  "blockers": [
    {
      "code": "ALLOWLIST_MISS",
      "message": "Target issue:540 is not in the provided allowlist"
    }
  ],
  "capturedAt": "2026-05-11T22:05:01Z"
}
```

### Audit Entry

```json
{
  "schemaVersion": 1,
  "auditId": "audit-20260511-220500-cancel-001",
  "requestId": "req-cancel-worker-001",
  "mode": "execute",
  "actionType": "cancel-worker",
  "riskLevel": "high",
  "humanRequired": true,
  "outcome": "success",
  "targetSummary": "issue:540",
  "allowlistUsed": ["issue:540"],
  "reason": "Worker stuck for 30+ minutes, no heartbeat",
  "requestedBy": "human:taoyu",
  "blockerCount": 0,
  "errorCount": 0,
  "effectCount": 1,
  "requestedAt": "2026-05-11T22:05:00Z",
  "capturedAt": "2026-05-11T22:05:02Z",
  "durationMs": 1850
}
```

---

## Design Decisions

- **Preview-first.** All mutating actions default to preview. This prevents accidental execution and lets the user verify effects before committing.
- **Allowlist bounds blast radius.** Execute mode requires an explicit target allowlist. The handler rejects any action whose targets are not in the allowlist. This prevents runaway mutations.
- **Human-required for destructive actions.** High and critical risk actions cannot be dispatched by automated agents. A human must initiate through the WebUI.
- **Audit is append-only.** Every action (preview or execute) produces an audit entry. The audit log is the single source of truth for what happened and why.
- **No secrets.** Schemas contain only public identifiers (issue numbers, PR numbers, provider IDs, role names). The `reason` field is human-written justification, never a token or key.
- **Idempotent by design.** `requestId` and `auditId` are idempotency keys. Retrying a request with the same ID produces the same result without duplicate side effects.

---

## Downstream Consumers

| Consumer | Schema | Purpose |
|----------|--------|---------|
| **WebUI dashboard** | Request, Result | Render action forms, show effect previews, display results. |
| **Action handler** (future) | Request | Validate and dispatch actions against the control plane. |
| **Audit log** | Audit | Append-only record of all action attempts for traceability. |
| **Monitoring** | Audit | Detect unusual action patterns, alert on critical actions. |

---

## References

- [Gate Result Schema](gate-result-schema.md) — Gate evaluation output consumed by override-gate actions.
- [WebUI Queue State Schema](webui-queue-state-schema.md) — Queue state consumed by queue-related actions.
- [Provider WebUI Dashboard State Schema](provider-webui-dashboard-state-schema.md) — Dashboard state for provider actions.
- [Health State Schema](health-state-schema.md) — Health state consumed by refresh-health actions.
- [Launch Gate](launch-gate.md) — Gate policy that override-gate bypasses.
