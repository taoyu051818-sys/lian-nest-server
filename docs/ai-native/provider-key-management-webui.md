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

**Per-provider fields:**

| Field | Type | Used For |
|-------|------|----------|
| `providers[].id` | string | Provider identification (matches pool state) |
| `providers[].label` | string | Display name in Provider Settings panel |
| `providers[].source` | enum | Source type display (`local-claude-settings`, `env-var`, `credential-manager`) |
| `providers[].sourcePath` | string | Masked source pointer (UI shows derived `secretRefKey`) |
| `providers[].capabilities` | string[] | Capability badges (`claude-code`, `print-mode`, `batch-mode`) |
| `providers[].maxConcurrency` | integer | Per-provider concurrency cap shown in dashboard |
| `providers[].notes` | string | Operator-visible annotation |

**Concurrency policy:**

| Field | Type | Used For |
|-------|------|----------|
| `concurrency.globalMaxWorkers` | integer | Hard ceiling displayed in dashboard header |
| `concurrency.providerSelectionStrategy` | enum | Strategy label (`least-loaded`, `round-robin`) |
| `concurrency.fallbackStrategy` | enum | Behavior when all providers are exhausted (`fail-closed`) |

**Exhaustion triggers (read by launch gate and displayed in health panel):**

| Field | Type | Used For |
|-------|------|----------|
| `exhaustion.triggers[].condition` | enum | Trigger label (`http-429`, `quota-exhausted`, `auth-failure`) |
| `exhaustion.triggers[].action` | enum | Action taken (`mark-exhausted`, `mark-disabled`) |
| `exhaustion.triggers[].cooldownMinutes` | integer or null | Cooldown duration displayed in provider row |
| `exhaustion.recovery.autoRecoverAfterCooldown` | boolean | Whether provider auto-recovers after cooldown |
| `exhaustion.recovery.healthCheckOnRecovery` | boolean | Whether a probe runs before routing post-cooldown |

**Failure classification (drives health badge derivation):**

| Field | Type | Used For |
|-------|------|----------|
| `failureClassification.*.patterns` | string[] | Error text patterns matched against provider responses |
| `failureClassification.*.category` | enum | Category label (`exhaustion`, `auth`, `runtime`) |
| `failureClassification.*.severity` | enum | Severity color (`yellow`, `red`) |

**Secret source policy (enforced by UI and guards):**

| Field | Type | Used For |
|-------|------|----------|
| `secretSources.allowed` | string[] | Whitelist of permitted credential sources |
| `secretSources.forbidden` | string[] | Blocklist enforced by sanitization guards |

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

## Threat Model

Threats specific to the provider key management surface. For the
broader WebUI security model (localhost binding, admin token, worker
isolation), see
[Provider Pool WebUI Security](provider-pool-webui-security.md).

| Threat | Attack vector | Mitigation | Residual risk |
|--------|--------------|------------|---------------|
| Credential exposure in UI | Render raw key or masked-but-reversible source pointer | All fields sourced from sanitized state files; `secretRefKey` is a pointer, not a value | None |
| Credential leak via audit trail | Action payload or result contains key material | `sanitizeObject` scrubs credential-shaped fields before audit write | Low (requires code review to verify coverage) |
| Auth probe abuse | Repeated "Test Key" calls used as oracle to enumerate valid keys | Probe returns only `valid` / `auth-failure` / `timeout` / `network-error`; no key-specific detail; rate-limited by admin token gate | Low (local-only, token-gated) |
| Automated rotation without human consent | Script or agent calls `provider.rotateKey` without operator present | `ROTATE` + typed provider id confirmation; `dangerous: true` gate; no auto-retry | None (human gate enforced) |
| State file tampering | Direct edit of `provider-pool.json` to falsify health status | State file is source of truth; UI derives badges from it; tampering is detectable via audit trail diff | Low (local file access required) |
| Side-channel via rotation log | Rotation log entries reveal timing or frequency of key changes | Log stores only timestamps, provider id, and event type — no key material | None |

---

## Human Boundaries

Actions in the Provider Settings panel are classified by the degree of
human involvement required. These boundaries are enforced at the action
module level and cannot be bypassed via the API.

### Boundary Definitions

| Boundary | Meaning | Enforcement |
|----------|---------|-------------|
| **Automated** | Action executes without human input after preview | `dangerous: false`, no typed confirmation |
| **Human-gated** | Action requires explicit typed confirmation | `dangerous: true` + `confirm: true` + phrase match |
| **Human-only** | Action describes steps the operator must perform outside the UI; the UI only resets state after confirmation | Multi-step workflow with external action required |

### Classification

| Action | Boundary | Rationale |
|--------|----------|-----------|
| Test Key | Human-gated | Operator initiates; probe runs automatically but result is non-destructive |
| Rotate Key | Human-only | Operator must revoke old key, generate new key, and update local secret source outside the UI before confirming |

### Why Rotate Key Is Human-Only

The rotation workflow is deliberately split across UI and non-UI steps
to prevent automated credential replacement:

```
UI step (preview)          →  Show rotation checklist
Non-UI step (operator)     →  Revoke old key at provider console
Non-UI step (operator)     →  Generate new key at provider console
Non-UI step (operator)     →  Update local secret source
UI step (confirm)          →  Operator confirms local update is done
UI step (execute)          →  Reset provider state, run auth probe
```

The UI never accepts, stores, or transmits the new key. If the auth
probe fails after confirmation, the provider is re-disabled and the
operator must repeat the non-UI steps. This design ensures that:

1. No automated process can rotate credentials without human awareness.
2. The operator verifies the new key works at the provider console
   before the UI accepts it.
3. A compromised UI session cannot inject attacker-controlled keys.

---

## References

- [Provider Key Management API Contract](../contracts/provider-key-management-api.md) — endpoint contract for testKey and rotateKey
- [Provider Pool WebUI API](provider-pool-webui-api.md) — API contract
- [Provider Pool WebUI Operation Console](provider-pool-webui-operation-console.md) — action console
- [Provider UI Policy](provider-ui-policy.md) — display and mutation rules
- [Provider Local Secret Store](provider-local-secret-store.md) — credential storage
- [Provider Key Router](provider-key-router.md) — routing and credential resolution
- [Provider Rotation Local Secrets](provider-rotation-local-secrets.md) — rotation runbook
- [WebUI Control Map](webui-control-map.md) — action risk gates
- [Provider Pool WebUI Security](provider-pool-webui-security.md) — security model
