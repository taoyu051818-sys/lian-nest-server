# WebUI Action: Provider Rotation

WebUI action module for provider key rotation via the dry-run settings bridge.
Enables operators to preview and execute credential rotation from the local
control console.

> **Closes:** [#684](https://github.com/taoyu051818-sys/lian-nest-server/issues/684),
> [#877](https://github.com/taoyu051818-sys/lian-nest-server/issues/877)
>
> **Module:** [`tools/provider-pool-webui/actions/provider-rotation.js`](../../tools/provider-pool-webui/actions/provider-rotation.js)
> **Tests:** [`tools/provider-pool-webui/action-modules.test.js`](../../tools/provider-pool-webui/action-modules.test.js)
>
> **Cross-references:**
> [provider-rotation bridge](claude-settings-provider-rotation.md) for the
> underlying PowerShell rotation script,
> [provider-pool.md](provider-pool.md) for pool architecture,
> [provider-pool-webui-actions-api.md](provider-pool-webui-actions-api.md) for
> the action module contract.

---

## Overview

The provider-rotation action module exposes credential rotation as a WebUI
control-console operation.  When a provider's credential is compromised,
expired, or quota-exhausted, the operator can:

1. **Preview** the rotation plan (dry-run, no state changes).
2. **Execute** the rotation with explicit confirmation.

The module operates entirely on provider pool state and policy metadata.
It never reads, prints, stores, or commits actual API keys, tokens, or
credential values.

---

## Module Contract

| Field | Value |
|-------|-------|
| `id` | `provider-rotation` |
| `label` | Provider Key Rotation |
| `dangerous` | `true` (requires `confirm: true` from the server) |
| `preview(payload)` | Returns rotation plan without modifying state |
| `execute(payload)` | Applies rotation to the state file |

---

## API

### Preview (Dry-Run)

```json
POST /api/actions/preview
{
  "actionId": "provider-rotation",
  "payload": { "providerId": "provider-default" }
}
```

**Response:**

```json
{
  "actionId": "provider-rotation",
  "label": "Provider Key Rotation",
  "preview": {
    "status": "preview",
    "providerId": "provider-default",
    "plan": {
      "providerId": "provider-default",
      "currentState": {
        "status": "exhausted",
        "currentConcurrency": 0,
        "maxConcurrency": 2,
        "cooldownExpiresAt": "2099-12-31T23:59:59Z",
        "consecutiveFailures": 3,
        "totalQuotaEvents": 5
      },
      "targetState": {
        "status": "available",
        "cooldownExpiresAt": null,
        "consecutiveFailures": 0
      },
      "providerSource": {
        "type": "env-var",
        "key": "ANTHROPIC_API_KEY",
        "available": true
      },
      "validationChecks": [
        { "check": "provider-exists-in-policy", "passed": true },
        { "check": "provider-exists-in-state", "passed": true },
        { "check": "state-file-writable", "passed": true },
        { "check": "secret-source-exists", "passed": true }
      ],
      "canRotate": true,
      "blockReason": "",
      "dryRun": true,
      "capturedAt": "2026-05-12T00:15:00Z"
    },
    "dryRun": true,
    "timestamp": "2026-05-12T00:15:00Z"
  },
  "dryRun": true
}
```

### Execute

```json
POST /api/actions/execute
{
  "actionId": "provider-rotation",
  "payload": {
    "providerId": "provider-default",
    "reason": "key compromised"
  },
  "confirm": true
}
```

**Response:**

```json
{
  "ok": true,
  "auditId": "audit-1683812400000-x7k9m2",
  "result": {
    "status": "rotated",
    "providerId": "provider-default",
    "changes": [
      { "field": "status", "from": "exhausted", "to": "available" },
      { "field": "cooldownExpiresAt", "from": "2099-12-31T23:59:59Z", "to": null },
      { "field": "consecutiveFailures", "from": 3, "to": 0 }
    ],
    "summary": "Rotated provider provider-default — status=available, cooldown cleared, failures reset",
    "reason": "key compromised",
    "dryRun": false,
    "timestamp": "2026-05-12T00:15:01Z"
  }
}
```

---

## Rotation Effects

| Current Status | Effect |
|:--------------:|--------|
| `available` | Resets failure counters, preserves concurrency |
| `exhausted` | Clears cooldown, resets failures, re-enables |
| `disabled` | Re-enables provider, clears cooldown |

Rotation is always possible regardless of current status — the module is
designed to be the "fix and re-enable" path.

### State Changes

| Field | Before | After |
|-------|--------|-------|
| `status` | `exhausted` / `disabled` | `available` |
| `cooldownExpiresAt` | any timestamp | `null` |
| `consecutiveFailures` | any integer | `0` |
| `global.availableProviders` | stale count | recalculated |
| `global.exhaustedProviders` | stale count | recalculated |
| `global.disabledProviders` | stale count | recalculated |

---

## Safety Model

### Preview-First

All calls default to preview mode.  The preview function computes and
returns the rotation plan without modifying any state files.  No confirmation
is needed for preview.

### Dangerous Gate

The module sets `dangerous: true`.  The server's action execution endpoint
requires `confirm: true` in the request body before calling `execute()`.
Without confirmation, the server returns `409 Conflict`.

### No Secret Exposure

The module checks secret source *existence* only:

| Source Type | Check Performed |
|-------------|----------------|
| `env-var` | `process.env[key] !== undefined` — checks existence, not value |
| `claude-settings` | `fs.existsSync(~/.claude/settings.json)` — checks file exists |

The `providerSource` object in the preview plan reports `type` and
`available` only — never the actual key value, path contents, or any
`sk-`-prefixed string.

No secret value is ever read, printed, logged, or returned in API responses.

### Secret Source Availability

When the secret source for a provider is not detected (env var missing,
settings file absent), the plan sets a `blockReason` string describing the
issue.  Rotation remains possible (`canRotate: true`) — the blockReason is
advisory, not a gate — because the module is the "fix and re-enable" path
and the operator may supply credentials out-of-band.

### Atomic Write

When executing rotation, the state file is updated atomically:

1. Write updated state to a temporary file (`state.json.tmp.<timestamp>`).
2. Rename temp file over the original (`fs.renameSync`).
3. On failure, clean up the temp file.

Preview never writes temp files — the state file is read-only during
dry-run.  The test suite verifies no `.tmp.*` files remain after both
preview and execute.

### Sanitization

All payloads and results pass through the server's `sanitizeObject()` before
storage in the audit log or return in API responses.  Fields matching
`api_key`, `token`, `secret`, `password`, `credential` are redacted.

---

## Error Handling

| Scenario | Error |
|----------|-------|
| Missing `providerId` | `providerId is required` |
| Provider not in state | `Provider not found: <id>` |
| Provider not in policy | `Provider not found in policy: <id>` |
| State file unreadable | `Cannot read provider pool state` |
| Policy file unreadable | `Cannot read provider pool policy` |
| State write failure | `State write failed: <reason>` |

All errors are thrown (not returned) so the server can catch them and write
an error audit entry.

---

## Payload Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `providerId` | string | yes | Provider to rotate |
| `reason` | string | no | Human-readable reason (execute only) |
| `statePath` | string | no | Override state file path (testing) |
| `policyPath` | string | no | Override policy file path (testing) |

---

## Integration

```
provider-pool-policy.json          Defines allowed providers and limits
         │
         ▼
provider-pool.json                 Tracks runtime provider status
         │
         ▼
┌─────────────────────────────────────────────────┐
│  provider-rotation.js (THIS MODULE)              │
│                                                  │
│  Validates provider, builds rotation plan,       │
│  transitions state, atomic write                 │
└─────────────────────────────────────────────────┘
         │
         ▼
provider-pool.json                 Updated state (available, failures reset)
         │
         ▼
WebUI Audit Log                    Record of rotation action
```

---

## Tests

Run the dedicated test suite:

```
node tools/provider-pool-webui/actions/provider-rotation.test.js
```

Or the shared action-module suite (covers all modules):

```
node tools/provider-pool-webui/action-modules.test.js
```

### Test Categories

| Category | What It Verifies |
|----------|-----------------|
| Module contract | `id`, `label`, `description`, `dangerous`, `preview`, `execute` exports |
| Secret isolation | Source has no literal API key or token patterns; preview/execute output omits `apiKey`, `token`, `password` fields |
| Preview mode | Returns `status: "preview"`, `dryRun: true`; state file unchanged after preview; plan reflects current and target state |
| Execute mode | Returns `status: "rotated"`, `dryRun: false`; state file updated to `available`; cooldown cleared, failures reset |
| Input validation | Throws on missing, empty, or null `providerId` for both preview and execute |
| Provider not found | Throws when provider absent from state or policy |
| File missing | Throws on unreadable state or policy file path |
| Validation checks | Plan includes 4 checks: `provider-exists-in-policy`, `provider-exists-in-state`, `state-file-writable`, `secret-source-exists` |
| Atomic write safety | No `.tmp.*` files left after successful execute |
| Preview temp file safety | Preview leaves no temp files; state file remains valid JSON and unchanged |
| Reason handling | Default reason is `""`; explicit empty reason preserved; custom reason preserved verbatim; reason field contains no secret patterns |
| Changes array structure | Exhausted provider produces 3 changes (`status`, `cooldownExpiresAt`, `consecutiveFailures`) with correct `from`/`to` values |
| Disabled provider | Disabled provider rotates to `available`; global counts updated; `lastUpdatedBy` set to `webui-provider-rotation` |
| Secret source blockReason | When env-var secret source is unavailable, `blockReason` is non-empty but `canRotate` remains `true` |
| providerSource safety | `providerSource` reports `type` and `available` only — never contains `sk-` prefix or API key patterns |
| Global count preservation | Execute on already-available provider preserves all global counts unchanged |

---

## Files

| File | Purpose |
|------|---------|
| `tools/provider-pool-webui/actions/provider-rotation.js` | Action module |
| `tools/provider-pool-webui/actions/provider-rotation.test.js` | Dedicated test suite |
| `tools/provider-pool-webui/action-modules.test.js` | Shared action-module test suite |
| `docs/ai-native/webui-action-provider-rotation.md` | This document |

---

## References

- [Claude Settings Provider Rotation Bridge](claude-settings-provider-rotation.md) — PowerShell rotation script
- [Provider Pool](provider-pool.md) — Pool architecture
- [Provider Pool WebUI Actions API](provider-pool-webui-actions-api.md) — Action module contract
- [Provider Pool WebUI Security](provider-pool-webui-security.md) — Security model
