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
  mode: "rejected",
  error: "Provider not found: nonexistent",
  timestamp: "2026-05-11T14:30:00.000Z"
}
```

### Confirmation-Required Result

```js
{
  ok: false,
  action: "disable-provider",
  mode: "confirmation-required",
  changes: [ ... ],          // what would change
  summary: "Disable provider ...",  // human-readable preview
  error: "Execute mode requires confirm=true",
  timestamp: "2026-05-11T14:30:00.000Z"
}
```

Error responses are sanitized — they never contain secret values from
`params`, even if the caller passed them. State read failures use the
generic message `"Cannot read provider pool state"` rather than exposing
file paths.

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
and does not modify state. The response still includes `changes` and `summary`
so the caller can present what *would* happen before asking for confirmation.

```js
const result = await runAction("disable-provider", {
  dryRun: false,
  params: { providerId: "provider-default" },
});
// result.ok === false
// result.mode === "confirmation-required"
// result.changes → [{ target, field, from, to }]  (what would change)
// result.summary → human-readable description
// State file is NOT modified.
// Audit log is NOT written.
```

All five allowlisted actions are dangerous without confirm — state mutations
are never applied unless `confirm: true` is passed.

### Rejected

Actions not in the allowlist, or with invalid parameters, return
`mode: "rejected"` immediately.

---

## Refusal Paths

Every failure mode returns `ok: false` with a descriptive `error` string.
Error messages never contain secret values, parameter payloads, or internal
file paths (see [Security Constraints](#security-constraints)).

| Trigger | Error | Mode |
|---------|-------|------|
| Action not in `ALLOWED_ACTIONS` | `"Action not allowlisted: <action>"` | `rejected` |
| Missing `params` object | `"params object is required"` | `rejected` |
| Missing `providerId` for provider-scoped action | `"providerId is required"` | `rejected` |
| Missing `value` for adjust actions | `"value is required"` | `rejected` |
| State file unreadable | `"Cannot read provider pool state"` | `rejected` |
| Provider not found | `"Provider not found: <id>"` | `rejected` |
| Provider already disabled (disable-provider) | `"Provider is already disabled"` | `rejected` |
| Provider not disabled (enable-provider) | `"Provider is not disabled (current: <status>)"` | `rejected` |
| No active cooldown (reset-cooldown) | `"Provider has no active cooldown"` | `rejected` |
| Value not positive integer | `"value must be a positive integer"` | `rejected` |
| Concurrency exceeds globalMaxWorkers | `"value (<n>) exceeds globalMaxWorkers (<n>)"` | `rejected` |
| Execute without `confirm: true` | `"Execute mode requires confirm=true"` | `confirmation-required` |
| Operation timeout exceeded | `"Action timed out after <n>ms"` | (thrown error) |

The refusal check order is:
1. Allowlist → 2. Params shape → 3. State file → 4. Handler validation

Steps 1–3 short-circuit before the handler runs. Step 4 runs the
action-specific validation (provider existence, state constraints).

---

## Validation Rules

These are the handler-level validations (step 4 in the refusal chain).
Pre-checks (allowlist, params shape, state file) are documented in
[Refusal Paths](#refusal-paths).

| Action | Constraint | Refusal error |
|--------|-----------|---------------|
| `disable-provider` | Provider must exist and not already be disabled | `"Provider not found"` / `"Provider is already disabled"` |
| `enable-provider` | Provider must exist and be in `disabled` status | `"Provider not found"` / `"Provider is not disabled"` |
| `reset-cooldown` | Provider must exist and have an active `cooldownExpiresAt` | `"Provider not found"` / `"Provider has no active cooldown"` |
| `adjust-max-concurrency` | Value must be positive integer, not exceed `globalMaxWorkers` | `"positive integer"` / `"exceeds globalMaxWorkers"` |
| `adjust-global-max-workers` | Value must be positive integer | `"positive integer"` |

---

## Audit Trail

Every `runAction` call produces an audit entry (returned in `result.audit`).
In execute mode, entries are appended to `provider-ui-audit.ndjson`:

**Preview mode:** The audit entry is returned in `result.audit` but is NOT
written to the audit file. No file is created. This lets callers display
what *would* be logged without side effects.

**Execute mode:** The audit entry is appended to `provider-ui-audit.ndjson`
as a single-line JSON object (NDJSON format). Each subsequent action
appends a new line. The file is created if it does not exist.

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

Audit entry fields:

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 timestamp of the action |
| `action` | The action name |
| `params` | Sanitized parameters (secret/token/key/password keys stripped) |
| `actor` | Who initiated the action (default: `"webui"`) |
| `mode` | `"preview"` or `"execute"` |
| `changes` | Array of `{ target, field, from, to }` |
| `summary` | Human-readable description (never contains secrets) |

---

## Security Constraints

| Constraint | Enforcement |
|-----------|-------------|
| Allowlist only | Actions not in `ALLOWED_ACTIONS` are rejected |
| No secret exposure | `sanitizeProvider()` strips `secret`, `sourcePath`, `secretSources` |
| No secret logging | `sanitizeParams()` strips keys matching secret/token/key/password |
| Error sanitization | Error responses never contain secret param values; state read failures use generic `"Cannot read provider pool state"` |
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
