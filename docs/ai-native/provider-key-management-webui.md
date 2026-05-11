# Provider Key Management WebUI Design

Design for managing Claude API key visibility, health, and rotation
through the local-only provider pool WebUI. All key material stays
outside the UI — this surface manages metadata, status, and operator
workflows only.

> **Closes:** [#733](https://github.com/taoyu051818-sys/lian-nest-server/issues/733)

---

## Overview

The provider pool WebUI already shows provider status, concurrency,
and cooldown state. This design extends it with a **Provider Settings**
panel that surfaces per-provider key health indicators and guides
operators through rotation workflows — all without ever displaying,
logging, or transmitting actual credentials.

```
┌─────────────────────────────────────────────────────────────┐
│  [Dashboard]  [Operation Console]  [Provider Settings]       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Provider Credentials                                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ provider-default                                      │  │
│  │  Status: ● available                                  │  │
│  │  Key health: ✦ valid (last checked 2 min ago)         │  │
│  │  Source: env-var → ANTHROPIC_API_KEY                  │  │
│  │  Last auth event: success (2026-05-12T00:25:00Z)      │  │
│  │  ┌──────────────┐ ┌─────────────────┐                 │  │
│  │  │ Test Key     │ │ Rotate Key      │                 │  │
│  │  │ [LOW]        │ │ [HIGH] ⚠ Human  │                 │  │
│  │  └──────────────┘ └─────────────────┘                 │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  provider-secondary                                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Status: ● disabled                                   │  │
│  │  Key health: ✗ auth-failure (401 at 2026-05-11T15:30) │  │
│  │  Source: credential-manager → lian-claude-secondary   │  │
│  │  Last auth event: failure (2026-05-11T15:30:00Z)      │  │
│  │  ┌──────────────┐ ┌─────────────────┐                 │  │
│  │  │ Test Key     │ │ Rotate Key      │                 │  │
│  │  │ [LOW]        │ │ [HIGH] ⚠ Human  │                 │  │
│  │  └──────────────┘ └─────────────────┘                 │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Rotation Log                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 2026-05-11T15:35:00Z  provider-secondary  auth-fail   │  │
│  │ 2026-05-11T12:00:00Z  provider-default    rotated     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Design Principles

1. **No secrets in the UI.** The panel displays health indicators,
   source pointers, and timestamps — never API keys or tokens.
2. **Preview-first.** Every mutation shows a preview before execution.
   The "Test Key" action is read-only; "Rotate Key" requires typed
   confirmation.
3. **Operator-guided rotation.** The UI does not auto-rotate keys. It
   detects auth failures, presents the rotation workflow, and requires
   human confirmation at each step.
4. **Audit everything.** All key-management actions write to the
   existing audit trail with sanitized payloads.

---

## Provider Settings Panel

### Key Health Indicators

Each provider row displays a health badge derived from the most recent
auth event:

| Badge | State | Meaning |
|-------|-------|---------|
| ✦ valid | Green | Last auth check succeeded |
| ✗ auth-failure | Red | Last auth attempt returned 401/403 |
| ○ unknown | Gray | No auth check recorded yet |
| ⟳ testing | Blue (pulse) | Auth check in progress |

Health is derived from `provider-pool.json` fields — the UI never
queries the provider API directly.

### Displayed Fields

| Field | Source | Contains Secrets? |
|-------|--------|:-----------------:|
| Provider id | `provider-pool.json` | No |
| Label | `provider-pool-policy.json` | No |
| Status | `provider-pool.json` | No |
| Key health badge | Derived from `lastFailureClass` | No |
| Source type | `provider-pool-policy.json` → `source` | No |
| Source key (masked) | `provider-pool-policy.json` → `secretRefKey` | No — pointer only |
| Last auth event | `provider-pool.json` → history | No |
| Cooldown | `provider-pool.json` → `cooldownExpiresAt` | No |

**Never displayed:** raw API keys, token values, settings file contents,
environment variable values, credential manager passwords.

---

## Actions

### Test Key (Low Risk)

Verifies that the configured credential can authenticate without making
a billable API call.

| Property | Value |
|----------|-------|
| Action ID | `provider.testKey` |
| Risk | Low |
| Confirmation | `TEST` |
| Side effects | None (read-only check) |
| Endpoint | `POST /api/actions/preview` then `POST /api/actions/execute` |

**Preview output:**

```json
{
  "providerId": "provider-default",
  "sourceType": "env-var",
  "sourceKey": "ANTHROPIC_*",
  "checkType": "lightweight-auth-probe",
  "expectedSideEffects": "none"
}
```

**Execute behavior:**
1. Resolve the credential from the configured source (env var,
   credential manager, or settings file).
2. Make a minimal API call (e.g., `GET /v1/models` or a zero-token
   completion) to verify the key is valid.
3. Record the result in provider state history.
4. Return success/failure without exposing the credential.

**Result payload:**

```json
{
  "providerId": "provider-default",
  "result": "valid",
  "checkedAt": "2026-05-12T00:30:00Z",
  "latencyMs": 245
}
```

### Rotate Key (High Risk — Human Required)

Guides the operator through a credential rotation workflow.

| Property | Value |
|----------|-------|
| Action ID | `provider.rotateKey` |
| Risk | High |
| Confirmation | `ROTATE` + typed provider id |
| Human required | Yes |
| Endpoint | `POST /api/actions/preview` then `POST /api/actions/execute` |

**Preview output:**

```json
{
  "providerId": "provider-secondary",
  "currentStatus": "disabled",
  "currentFailureClass": "auth",
  "rotationSteps": [
    "1. Revoke old key at provider console",
    "2. Generate new key at provider console",
    "3. Update local secret source",
    "4. Confirm rotation to reset provider state"
  ],
  "secretSourceType": "credential-manager",
  "secretSourceKey": "lian-claude-secondary"
}
```

**Execute behavior:**
1. Validate that the provider is in a rotatable state (`disabled` with
   `auth` failure class).
2. Display the rotation checklist (preview steps above).
3. Wait for operator confirmation that the local secret has been updated.
4. On confirmation, reset the provider state to `available` with
   `currentConcurrency: 0`.
5. Run a lightweight auth probe to verify the new key.
6. Log the rotation event to the audit trail.

**Important:** The UI never accepts, stores, or transmits the new key.
The operator updates the secret in the local source (env var, credential
manager, or settings file) outside the UI. The UI only resets the
provider state after the operator confirms the local update is done.

---

## Rotation Workflow

```
Auth failure detected (401/403)
       │
       ▼
Provider marked disabled in state
       │
       ▼
WebUI shows ✗ auth-failure badge
       │
       ▼
Operator clicks "Rotate Key"
       │
       ▼
Preview: show rotation checklist + source info
       │
       ▼
Operator types "ROTATE" + provider id
       │
       ▼
UI shows: "Update your local credential, then confirm"
       │
       ▼
Operator updates key OUTSIDE the UI (env var / credman / settings)
       │
       ▼
Operator clicks "Confirm Rotation"
       │
       ▼
Server: reset provider state → available
       │
       ▼
Server: run auth probe
       │
       ├── Success → provider stays available, log rotation event
       │
       └── Failure → provider re-disabled, show error (key still invalid)
```

---

## Key Health Check Details

The lightweight auth probe used by "Test Key" and post-rotation
verification:

| Property | Value |
|----------|-------|
| API call | `GET /v1/models` (or equivalent zero-cost endpoint) |
| Timeout | 10 seconds |
| Retries | None (single attempt) |
| Credential injection | From local source, same as worker dispatch |
| Result recorded | `valid`, `auth-failure`, `timeout`, `network-error` |
| Secret in response | Never — result is status-only |

The probe uses the same credential resolution path as the provider key
router (`provider-key-router.md`). It does not introduce a new
credential access pattern.

---

## State Schema Extensions

The provider settings panel reads from existing state files. No new
state files are required. The following fields are used:

### From `provider-pool.json`

| Field | Used For |
|-------|----------|
| `providers[].id` | Provider identification |
| `providers[].status` | Status badge |
| `providers[].lastFailureClass` | Health badge derivation |
| `providers[].cooldownExpiresAt` | Cooldown display |
| `providers[].history[]` | Last auth event timestamp |

### From `provider-pool-policy.json`

| Field | Used For |
|-------|----------|
| `providers[].label` | Display name |
| `providers[].source` | Source type display |
| `providers[].secretRefKey` | Masked source key display |

### New History Event Types

The existing `history[]` array in provider state is extended with:

| Event | Meaning |
|-------|---------|
| `auth-probe-success` | Lightweight auth probe succeeded |
| `auth-probe-failure` | Lightweight auth probe failed |
| `key-rotated` | Operator completed rotation workflow |

---

## Integration with Existing Systems

### Provider UI Policy

All actions comply with the provider UI policy (`provider-ui-policy.md`):

- Secrets are never displayed (masked source keys only).
- Mutations require confirmation.
- High-risk actions require human gate.
- Audit trail records all actions.

### Operation Console

The Provider Settings panel is a third tab alongside Dashboard and
Operation Console. It shares the same guard validation, audit trail,
and preview-first model.

### Provider Key Router

The auth probe uses the same credential resolution as the key router.
No new credential access patterns are introduced.

### WebUI Security

All requests go through the existing security model:

- Localhost-only binding.
- Bearer token authentication.
- `sanitizeObject` on all payloads.
- Rate limiting on failed attempts.

---

## Non-Goals

- No direct secret display, input, or storage through the WebUI.
- No automatic key rotation — all rotations require human confirmation.
- No server-side credential generation or management.
- No changes to the provider key router or worker dispatch logic.
- No new state files or schema changes (uses existing provider state).
- No external API calls beyond the lightweight auth probe.
- No changes to Prisma, auth modules, or deployment behavior.

---

## Security Invariants

| Invariant | Enforcement |
|-----------|-------------|
| No secrets in UI | All fields sourced from sanitized state files |
| No secrets in audit | `sanitizeObject` scrubs credential-shaped fields |
| No auto-rotation | `provider.rotateKey` requires human gate |
| No credential input | UI never accepts key values from the operator |
| Localhost only | Existing WebUI binding to `127.0.0.1` |
| Probe uses existing resolution | Same path as provider key router, no new access |

---

## Schema Reference

The provider key pool state is formally defined by
[`schemas/provider-key-pool-state.schema.json`](../schemas/provider-key-pool-state.schema.json).
This schema extends the base `provider-pool.schema.json` with three
additional `$defs` for the Provider Settings panel:

### `keyHealth`

Badge-based health indicator derived from recent auth events:

| Field | Type | Description |
|-------|------|-------------|
| `badge` | enum | `valid`, `auth-failure`, `unknown`, `testing` |
| `lastCheckedAt` | date-time or null | When the last auth probe ran |
| `lastProbeLatencyMs` | integer or null | Probe latency in ms |

### `secretSource`

Sanitized pointer to the credential source — never the credential itself:

| Field | Type | Description |
|-------|------|-------------|
| `type` | enum | `env-var`, `credential-manager`, `local-settings` |
| `maskedKey` | string | Masked reference (e.g. `ANTHROPIC_*`, `lian-claude-*`) |
| `label` | string | Human-readable label from policy |

### `authEvent`

Individual entry in the provider's auth history:

| Field | Type | Description |
|-------|------|-------------|
| `type` | enum | `auth-probe-success`, `auth-probe-failure`, `key-rotated`, `mark-exhausted`, `mark-disabled`, `retry` |
| `timestamp` | date-time | When the event occurred |
| `result` | enum | Probe result for probe events: `valid`, `auth-failure`, `timeout`, `network-error` |
| `latencyMs` | integer or null | Probe latency for probe events |
| `reason` | string | Optional human-readable reason |

### Sanitization Rules

The schema enforces that no secret values appear in any field:

- `id` is an opaque label, not a key value.
- `maskedKey` uses glob-style masking (`*` suffix) — never the full key name.
- `authEvent.result` is a status enum, not error text that might leak details.
- `authEvent.reason` is a free-text field but must pass through
  `sanitizeObject` before reaching the UI or audit log.

---

## References

- [Provider Pool WebUI API](provider-pool-webui-api.md) — API contract
- [Provider Pool WebUI Operation Console](provider-pool-webui-operation-console.md) — action console
- [Provider UI Policy](provider-ui-policy.md) — display and mutation rules
- [Provider Local Secret Store](provider-local-secret-store.md) — credential storage
- [Provider Key Router](provider-key-router.md) — routing and credential resolution
- [Provider Rotation Local Secrets](provider-rotation-local-secrets.md) — rotation runbook
- [WebUI Control Map](webui-control-map.md) — action risk gates
- [Provider Pool WebUI Security](provider-pool-webui-security.md) — security model
