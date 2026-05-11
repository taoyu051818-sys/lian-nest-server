# WebUI Action Result Normalizer

Normalizes action result payloads for consistent WebUI rendering.
Ensures every action result has a predictable shape regardless of
which action module or handler produced it.

> **Closes:** [#691](https://github.com/taoyu051818-sys/lian-nest-server/issues/691)
>
> **Expanded by:** [#883](https://github.com/taoyu051818-sys/lian-nest-server/issues/883)

---

## Overview

The action result normalizer sits between action handlers and the
WebUI rendering layer. Raw action results from different sources
(action-runner, action modules, direct handlers) may have varying
shapes. The normalizer produces a consistent envelope that the UI
can render without case-by-case handling.

```
  Action Handler / Runner
       │
       ▼
  normalizeResult(raw, context?)
       │
       ▼
  Consistent WebUI envelope
```

---

## Normalized Envelope

Every normalized result has this base shape:

```json
{
  "schemaVersion": 1,
  "normalizedAt": "2026-05-12T00:00:00.000Z",
  "actionId": "disable-provider",
  "label": "Disable Provider",
  "status": "success",
  "severity": "success",
  "ok": true
}
```

### Fields

| Field          | Type     | Always Present | Description                              |
|---------------|----------|----------------|------------------------------------------|
| `schemaVersion` | number  | yes            | Normalizer schema version (currently 1)  |
| `normalizedAt`  | string  | yes            | ISO timestamp of normalization           |
| `actionId`      | string  | no             | Action identifier                        |
| `label`         | string  | no             | Human-readable action label              |
| `status`        | string  | yes            | Normalized status (see below)            |
| `severity`      | string  | yes            | UI severity level (see below)            |
| `ok`            | boolean | no             | Whether the action succeeded             |
| `mode`          | string  | no             | Execution mode (preview/execute/rejected)|
| `error`         | string  | no             | Error message if failed                  |
| `errorCode`     | string/number | no       | Machine-readable error code              |
| `nextAction`    | string  | no             | Suggested next action for the operator   |
| `changes`       | array   | no             | List of state changes                    |
| `summary`       | string  | no             | Human-readable summary                   |
| `timestamp`     | string  | no             | Original action timestamp                |
| `audit`         | object  | no             | Audit trail reference                    |
| `result`        | object  | no             | Action-specific result data              |
| `preview`       | object  | no             | Preview/dry-run data                     |
| `message`       | string  | no             | Informational message                    |

---

## Status Classification

Status is derived from the raw result's `ok` and `mode` fields:

| Raw Input                      | Status                   |
|-------------------------------|--------------------------|
| `ok: true`                     | `success`                |
| `ok: false`                    | `error`                  |
| `mode: "preview"`              | `preview`                |
| `mode: "execute"`              | `executed`               |
| `mode: "rejected"`             | `rejected`               |
| `mode: "confirmation-required"`| `confirmation-required`  |
| `status: "custom"`             | `custom` (passthrough)   |
| (none of the above)            | `unknown`                |

---

## Severity Classification

Severity maps to UI display styling:

| Raw Input                      | Severity    | UI Color   |
|-------------------------------|-------------|------------|
| `ok: true`                     | `success`   | Green      |
| `ok: false`                    | `error`     | Red        |
| `mode: "rejected"`             | `warning`   | Yellow     |
| `mode: "confirmation-required"`| `warning`   | Yellow     |
| `mode: "preview"`              | `info`      | Blue       |
| `mode: "execute"`              | `success`   | Green      |
| (none of the above)            | `info`      | Blue       |

---

## Safety Invariants

### Stable Response Shape

The normalizer guarantees that every output has a predictable envelope.
Six fields are **always present** regardless of input:

| Field            | Source                         | Fallback              |
|------------------|--------------------------------|-----------------------|
| `schemaVersion`  | Constant `1`                   | —                     |
| `normalizedAt`   | `Date.now()` ISO string        | —                     |
| `status`         | `classifyStatus(raw)`          | `"unknown"`           |
| `severity`       | `classifySeverity(raw)`        | `"info"`              |
| `actionId`       | `context.actionId` or `raw.action` | `null`           |
| `label`          | `context.label`                | `null`                |

When the raw input is `null`, `undefined`, or not an object the
normalizer returns:

```json
{
  "ok": false,
  "error": "No result provided",
  "status": "unknown"
}
```

When `normalizeResults` receives a non-array it returns `[]`.

### Error Normalization

Error fields are extracted with the following precedence:

- **`errorCode`** — sourced from `raw.errorCode`, then `raw.code`, then
  `null`. Numeric codes are preserved as numbers.
- **`error`** — sourced from `raw.error`, then `raw.message`. Always a
  string or absent.
- **`ok`** — takes precedence over `mode` when determining status and
  severity. A non-boolean truthy `ok` (e.g. `1`, `"yes"`) is **not**
  treated as `true`; only `true` maps to success status.

### Secret Redaction

Redaction operates in two layers applied sequentially.

**Layer 1 — key-based redaction.** Any object key matching the pattern
`/(?:api[_-]?key|token|secret|password|credential|auth|private[_-]?key)/i`
has its value replaced with `[redacted]`. This applies recursively to
nested objects.

**Layer 2 — value-based redaction.** All string values (including those
inside nested objects and arrays) are scanned with these patterns in
order:

| Pattern                                  | Replacement              |
|------------------------------------------|--------------------------|
| `key=value` / `key:value` pairs where key contains `password`, `secret`, `token`, `api_key`, `auth`, or `credential` | value → `[redacted]` |
| GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` prefix) | `[redacted-gh-token]` |
| `Bearer <token>`                         | `Bearer [redacted]`      |
| `Basic <base64>`                         | `Basic [redacted]`       |
| AWS keys (`AKIA`/`ASIA` + 16 chars)     | `[redacted-aws-key]`    |
| JWT (three dot-separated base64 segments)| `[redacted-jwt]`         |
| Long base64-like strings (40+ chars)     | `[redacted-token]`       |
| PEM private key blocks                   | `[redacted-private-key]` |

### Output Capping

| Type    | Limit          | Behavior when exceeded                     |
|---------|----------------|--------------------------------------------|
| String  | 500 chars      | Truncated with `[truncated, N chars total]`|
| Array   | 50 items       | Truncated with `[N more items truncated]`  |
| Object  | 30 keys        | Truncated with `_truncatedKeys: N`         |

---

## API

### `normalizeResult(raw, context?)`

Normalize a single action result.

```js
const { normalizeResult } = require("./lib/action-result-normalizer");

const result = await runAction("disable-provider", { params: { providerId: "p-1" } });
const normalized = normalizeResult(result, {
  actionId: "disable-provider",
  label: "Disable Provider",
});
// → { schemaVersion: 1, status: "preview", severity: "info", ok: true, ... }
```

### `normalizeResults(results, context?)`

Normalize an array of results. Returns `[]` for non-array input.

### `sanitizeValue(value)`

Sanitize a single value: redact secrets, cap strings.

### `sanitizeObject(obj)`

Sanitize all values in an object: redact secret keys, cap values, limit key count.

### `redactSecrets(text)`

Redact secret-like patterns in a string.

### `capString(text)`

Cap a string to `MAX_STRING_LENGTH` (500).

### `classifyStatus(raw)`

Determine normalized status from raw result.

### `classifySeverity(raw)`

Determine UI severity from raw result.

---

## Non-Goals

- No UI rendering logic (produces data, not DOM)
- No action execution (consumes results, does not run actions)
- No state file modification (read-only normalization)
- No remote API calls

---

## References

- [Provider Pool WebUI Actions API](provider-pool-webui-actions-api.md) — action endpoints
- [Provider Pool WebUI Action Styles](provider-pool-webui-action-styles.md) — UI component styles
- [Provider Pool WebUI Security](provider-pool-webui-security.md) — security model
- [Action Runner](../../tools/provider-pool-webui/lib/action-runner.js) — action execution
- [Audit Store](../../tools/provider-pool-webui/lib/audit-store.js) — audit logging
