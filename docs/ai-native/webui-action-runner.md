# WebUI Action Runner

Safe execution layer for allowlisted provider pool mutations through the
WebUI control console. Actions default to preview mode and require explicit
confirmation for execution.

> **Closes:** [#648](https://github.com/taoyu051818-sys/lian-nest-server/issues/648)

---

## Overview

The action runner is the controlled mutation surface for the provider pool
WebUI. It wraps every state change behind:

1. An allowlist — only policy-defined actions are accepted.
2. Preview default — every call returns a dry-run summary first.
3. Confirmation gate — execute mode requires `confirm: true`.
4. Audit trail — every action (preview and execute) is logged.
5. Timeout — operations are bounded to prevent hangs.
6. Sanitization — no secrets appear in summaries, audit logs, or errors.

---

## Allowed Actions

| Action | Description | Required Params |
|--------|-------------|-----------------|
| `disable-provider` | Set provider status to disabled | `providerId` |
| `enable-provider` | Re-enable a disabled provider | `providerId` |
| `reset-cooldown` | Clear cooldown, set status to available | `providerId` |
| `adjust-max-concurrency` | Change provider concurrency cap | `providerId`, `value` (positive int) |
| `adjust-global-max-workers` | Change global worker ceiling | `value` (positive int) |

All other actions (set-secret, modify-source, add-provider, remove-provider,
modify-failure-classification, modify-exhaustion-triggers) are rejected at the
allowlist boundary.

---

## API

```js
const { runAction, ALLOWED_ACTIONS } = require("./lib/action-runner");

const result = await runAction("disable-provider", {
  params: { providerId: "provider-default" },
  dryRun: true,      // default: true (preview only)
  confirm: false,     // must be true for execute mode
  actor: "webui",     // who initiated (for audit)
  timeoutMs: 5000,    // operation timeout
  statePath: "...",   // override for testing
  policyPath: "...",  // override for testing
  auditPath: "...",   // override for testing
});
```

### Result Shape

```js
{
  ok: true,
  action: "disable-provider",
  mode: "preview",           // "preview" | "execute" | "rejected" | "confirmation-required"
  changes: [
    { target: "provider-default", field: "status", from: "available", to: "disabled" }
  ],
  summary: "Disable provider provider-default (was available)",
  audit: { ... },            // audit entry object
  timestamp: "2026-05-11T14:30:00.000Z"
}
```

### Error Result

```js
{
  ok: false,
  action: "disable-provider",
  mode: "rejected",          // or "confirmation-required"
  error: "Provider not found: nonexistent",
  timestamp: "2026-05-11T14:30:00.000Z"
}
```

---

## Modes

### Preview (default)

```js
const result = await runAction("disable-provider", {
  params: { providerId: "provider-default" },
});
// result.mode === "preview"
// State file is NOT modified.
// Audit log is NOT written.
```

### Execute

```js
const result = await runAction("disable-provider", {
  dryRun: false,
  confirm: true,
  params: { providerId: "provider-default" },
  actor: "operator-1",
});
// result.mode === "execute"
// State file IS modified.
// Audit entry IS appended.
```

Execute mode without `confirm: true` returns `mode: "confirmation-required"`
and does not modify state.

### Rejected

Actions not in the allowlist, or with invalid parameters, return
`mode: "rejected"` immediately.

---

## Validation Rules

| Action | Constraint |
|--------|-----------|
| `disable-provider` | Provider must exist and not already be disabled |
| `enable-provider` | Provider must exist and be in `disabled` status |
| `reset-cooldown` | Provider must exist and have an active `cooldownExpiresAt` |
| `adjust-max-concurrency` | Value must be positive integer, not exceed `globalMaxWorkers` |
| `adjust-global-max-workers` | Value must be positive integer |

---

## Audit Trail

Every `runAction` call produces an audit entry (returned in `result.audit`).
In execute mode, entries are appended to `provider-ui-audit.ndjson`:

```json
{
  "timestamp": "2026-05-11T14:30:00Z",
  "action": "disable-provider",
  "params": { "providerId": "provider-default" },
  "actor": "webui",
  "mode": "execute",
  "changes": [
    { "target": "provider-default", "field": "status", "from": "available", "to": "disabled" }
  ],
  "summary": "Disable provider provider-default (was available)"
}
```

Audit entries never contain secrets. Parameters with keys containing
`secret`, `token`, `key`, or `password` are stripped before logging.

---

## Security Constraints

| Constraint | Enforcement |
|-----------|-------------|
| Allowlist only | Actions not in `ALLOWED_ACTIONS` are rejected |
| No secret exposure | `sanitizeProvider()` strips `secret`, `sourcePath`, `secretSources` |
| No secret logging | `sanitizeParams()` strips keys matching secret/token/key/password |
| Preview by default | `dryRun` defaults to `true` |
| Confirmation required | Execute mode needs explicit `confirm: true` |
| Timeout bounded | Default 5s, configurable via `timeoutMs` |
| No shell execution | All operations are filesystem read/write, no child processes |
| State-only writes | Only `.github/ai-state/provider-pool.json` is modified, never policy |

---

## Integration

### With Provider Pool Server

The action runner is consumed by the WebUI server's POST endpoints (planned).
The server validates the admin token, then delegates to `runAction()`.

### With Provider UI Policy

The allowlist is derived from [provider-ui-policy.md](provider-ui-policy.md)
mutation rules. Changes to the policy require updating both the doc and the
`ALLOWED_ACTIONS` set.

### With Guard Scripts

The action runner does not call guard scripts directly. After a mutation,
the guard (`check-provider-pool.js`) should be re-run to validate the new
state. This is the caller's responsibility.

---

## Files

| File | Purpose |
|------|---------|
| `tools/provider-pool-webui/lib/action-runner.js` | Action runner module |
| `tools/provider-pool-webui/action-runner.test.js` | Self-contained test suite |
| `docs/ai-native/webui-action-runner.md` | This document |

---

## References

- [Provider UI Policy](provider-ui-policy.md) — mutation rules and audit format
- [Read-Only Mode](provider-pool-webui-readonly-mode.md) — Phase 1 read-only contract
- [Provider Pool Security](provider-pool-webui-security.md) — security model
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch validation
