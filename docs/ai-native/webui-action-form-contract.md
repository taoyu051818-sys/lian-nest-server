# WebUI Action Form Schema Contract and Submit Flow

Contract for how the WebUI operation console renders action forms,
submits them through preview/execute stages, validates inputs, and
redacts secrets. Complements the existing schema helpers and registry
docs with the end-to-end flow the UI must follow.

> **Closes:** [#814](https://github.com/taoyu051818-sys/lian-nest-server/issues/814)

---

## Scope

This doc covers:

1. Form schema shape the UI consumes
2. Preview-then-execute submit flow
3. Validation boundaries (client, registry, runner, wire format)
4. Secret-safe behavior at every layer

It does **not** re-document the action registry or form schema helper
APIs — see References below.

---

## 1. Form Schema Contract

The UI calls `buildFormSchema(actionId)` (from `action-form-schema.js`)
to get a frozen descriptor for each action. The shape:

```
{
  actionId,           // string — dot-delimited id (e.g. "provider.cooldown.reset")
  title,              // string — human-readable action name
  description,        // string — one-line purpose
  category,           // "view" | "provider" | "worker" | "resources" | "queue" | "settings"
  risk,               // "low" | "medium" | "high" | "critical"
  riskBadge,          // { level, color, label, cssClass }
  privileged,         // boolean
  readOnly,           // boolean — true means submit label is "View", no preview needed
  defaultPreview,     // boolean — true for ALL mutating actions
  fields[],           // array of field descriptors (see below)
  hasConfirmMessage,  // boolean
  submitLabel,        // "View" | "Execute" | "Execute (Privileged)"
  previewLabel        // always "Preview"
}
```

### Field descriptors

Each field in `fields[]`:

```
{
  name,              // string — param key (e.g. "providerId")
  type,              // "text" | "number"
  label,             // human-readable label
  placeholder,       // example value
  required,          // always true
  autocomplete?,     // "provider" | "worker" | "off" (optional)
  min?, step?        // present when type is "number"
}
```

Known fields (`providerId`, `workerId`, `target`, `value`, `field`,
`title`, `gapKey`, `labels`) get typed descriptors from `FIELD_TYPES`.
Unknown fields default to `type: "text"` with a humanized label.

---

## 2. Submit Flow

The UI follows a two-stage flow: **Preview → Execute**. No action
bypasses preview unless it is `readOnly`.

```
┌──────────────────────────────────────────────────────────┐
│  Operator fills form, clicks "Preview"                   │
│                                                          │
│  POST /api/actions/preview                               │
│  { actionId, payload }                                   │
│         │                                                │
│         ▼                                                │
│  Server: resolveAction(actionId)                         │
│         → module.preview(payload) — no side effects      │
│         → sanitizeObject(result)                         │
│         → return { actionId, preview, dryRun: true }     │
│                                                          │
│  UI shows preview result + "Execute" button              │
└──────────────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────┐
│  Operator clicks "Execute" (dangerous actions: confirm)  │
│                                                          │
│  POST /api/actions/execute                               │
│  { actionId, payload, confirm: true }                    │
│         │                                                │
│         ▼                                                │
│  Server checks module.dangerous flag:                    │
│    - dangerous && confirm !== true → 409 Conflict        │
│    - otherwise → module.execute(payload)                 │
│         → write audit entry                              │
│         → sanitizeObject(result)                         │
│         → return { ok: true, auditId, result }           │
└──────────────────────────────────────────────────────────┘
```

### Confirmation escalation by risk level

| Risk | Confirmation required |
|------|----------------------|
| `low` | None |
| `medium` | Single confirmation dialog |
| `high` | Dialog with effect preview |
| `critical` | Typed confirmation (e.g. type "FORCE MERGE") |

### Dangerous action gate

Dynamic action modules (`tools/provider-pool-webui/actions/`) export a
`dangerous` boolean. The server returns **409 Conflict** if
`dangerous === true` and `confirm !== true` in the execute request.

---

## 3. Validation Boundaries

Validation occurs at four layers, each catching different failure modes.

### Layer 1: Field validation (action-registry.js)

`validateFields(actionId, fields)` checks all `requiredFields` are
present and non-null. Returns `{ valid: false, missing: [...] }` on
failure. Runs before any action dispatch.

### Layer 2: Allowlist check (action-runner.js)

Only 5 actions are in the runner allowlist:

- `disable-provider`
- `enable-provider`
- `reset-cooldown`
- `adjust-max-concurrency`
- `adjust-global-max-workers`

Anything not in this set returns `mode: "rejected"`.

### Layer 3: Params validation (action-runner.js)

`validateParams(actionId, params)` performs per-action type checks
(e.g. `providerId` must be a string, `value` must be a positive
integer). Runs after allowlist check.

### Layer 4: Wire-format validation (JSON Schema)

Three JSON Schemas (`schemas/webui-action-*.schema.json`) enforce the
formal contract:

| Schema | Purpose | Key constraints |
|--------|---------|-----------------|
| `webui-action-request` | Request envelope | `mode: "execute"` requires `allowlist` + `reason`; `riskLevel: "high"/"critical"` requires `humanRequired: true` |
| `webui-action-result` | Result envelope | `outcome` is one of `success`, `blocked`, `error`, `skipped`; error messages must not contain secrets |
| `webui-action-audit` | Audit entry (NDJSON) | Append-only; every request produces exactly one entry |

### Layer 5: State validation (action handlers)

Each handler validates preconditions (e.g. provider must exist, must
not already be in the desired state). Failures return `outcome: "skipped"`
or `outcome: "blocked"`.

---

## 4. Secret-Safe Behavior

Secrets are stripped at every layer. The UI never sees raw credentials.

### Action runner (action-runner.js)

- `sanitizeProvider()` strips `secret`, `sourcePath`, `secretSources`
  keys from provider objects.
- `sanitizeParams()` strips any key whose lowercase name contains
  `secret`, `token`, `key`, or `password`.

### Result normalizer (action-result-normalizer.js)

- **Key redaction**: keys matching
  `api_key|token|secret|password|credential|auth|private_key` are
  replaced with `[redacted]`.
- **Value redaction**: GitHub tokens (`ghp_*`), Bearer tokens, Basic
  auth, AWS keys (`AKIA*`), JWTs, long base64 strings (40+ chars),
  and private key headers are all replaced with `[redacted-*]` markers.
- **Output capping**: strings at 500 chars, arrays at 50 items, objects
  at 30 keys.

### Action registry (action-registry.js)

- `describeAction()` strips `script` paths from API responses — only
  `hasScript: boolean` is exposed.

### Form schema (action-form-schema.js)

- Returns frozen objects only.
- Never exposes script paths or secrets in field descriptors.

### Wire format (JSON Schemas)

- `webui-action-result` requires: error `message` must not contain
  secrets or tokens.
- `webui-action-audit` `targetSummary` field is capped at 500 chars
  and must never contain secrets.

---

## 5. Result Envelope

Every action response follows the normalized result shape:

```
{
  schemaVersion: 1,
  normalizedAt,       // ISO-8601 timestamp
  status,             // "success" | "error" | "preview" | "executed"
                      //   | "rejected" | "confirmation-required" | "unknown"
  severity,           // mirrors risk level
  ok,                 // boolean
  mode,               // "preview" | "execute"
  error?,             // { code, message } — message is secret-safe
  changes?,           // array of { target, description, before?, after? }
  summary?,           // human-readable one-liner
  audit?              // { auditId, requestId, ... }
}
```

---

## References

- [WebUI Action Form Schema Helpers](webui-action-form-schema.md) —
  field type inference, risk badges, form schema shape
- [WebUI Action Registry](webui-action-registry.md) — registered
  actions, privilege model, preview defaults
- [Provider Pool WebUI Security](provider-pool-webui-security.md) —
  loopback binding, admin token, worker isolation
- `schemas/webui-action-request.schema.json` — request wire format
- `schemas/webui-action-result.schema.json` — result wire format
- `schemas/webui-action-audit.schema.json` — audit wire format
