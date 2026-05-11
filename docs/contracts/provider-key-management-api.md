# Provider Key Management API Contract

Local-only REST API contract for provider key health checks and
rotation workflows. Extends the existing provider pool WebUI API
with safe, secret-free endpoints for credential lifecycle management.

> **Closes:** [#774](https://github.com/taoyu051818-sys/lian-nest-server/issues/774)
> **Scope:** Docs/contract only. No runtime changes.
> **Parent design:** [Provider Key Management WebUI](../ai-native/provider-key-management-webui.md)

---

## Overview

Two new action modules extend the provider pool WebUI with key
management capabilities:

| Action ID | Risk | Label | Purpose |
|-----------|------|-------|---------|
| `provider.testKey` | Low | Test Key | Lightweight auth probe — verify credential without billable call |
| `provider.rotateKey` | High | Rotate Key | Guided rotation workflow — human confirms local secret update |

Both actions route through the existing `/api/actions/preview` and
`/api/actions/execute` endpoints defined in
[provider-pool-webui-api.md](provider-pool-webui-api.md). No new
endpoints are added to the server.

---

## Security Invariants

| Invariant | Enforcement |
|-----------|-------------|
| No secrets in any response | All payloads pass through `sanitizeObject` |
| No secret input accepted | UI never receives raw key values from operator |
| No credential storage | Server never persists, caches, or logs credentials |
| Localhost only | Existing `127.0.0.1` binding, inherited from WebUI server |
| Preview-first | Both actions expose `preview()` before `execute()` |
| Human gate on rotation | `provider.rotateKey` requires typed `ROTATE` + provider id |
| Probe uses existing resolution | Same credential path as provider key router, no new access |

---

## Action: `provider.testKey`

Verifies that the configured credential can authenticate without
making a billable API call.

### Metadata

| Property | Value |
|----------|-------|
| Action ID | `provider.testKey` |
| Risk level | Low |
| `dangerous` | `false` |
| Confirmation | Single click (low-risk default) |
| Side effects | None — read-only probe |
| History event | `auth-probe-success` or `auth-probe-failure` |

### Preview

**Request:**

```json
POST /api/actions/preview
{
  "actionId": "provider.testKey",
  "payload": {
    "providerId": "provider-default"
  }
}
```

**Response:** `200 OK`

```json
{
  "actionId": "provider.testKey",
  "label": "Test Key",
  "description": "Lightweight auth probe for provider credential",
  "preview": {
    "providerId": "provider-default",
    "sourceType": "env-var",
    "sourceKey": "ANTHROPIC_*",
    "checkType": "lightweight-auth-probe",
    "expectedSideEffects": "none"
  },
  "dryRun": true
}
```

### Execute

**Request:**

```json
POST /api/actions/execute
{
  "actionId": "provider.testKey",
  "payload": {
    "providerId": "provider-default"
  },
  "confirm": true,
  "confirmationToken": "TEST"
}
```

**Response:** `200 OK`

```json
{
  "ok": true,
  "auditId": "audit-1715500000000-abc123",
  "result": {
    "providerId": "provider-default",
    "result": "valid",
    "checkedAt": "2026-05-12T00:30:00Z",
    "latencyMs": 245
  }
}
```

### Result Values

| `result` | Meaning |
|----------|---------|
| `valid` | Auth probe succeeded — credential is working |
| `auth-failure` | Probe returned 401/403 — credential invalid or revoked |
| `timeout` | Probe did not respond within 10 seconds |
| `network-error` | Probe could not reach the provider API |

### Probe Behavior

| Property | Value |
|----------|-------|
| API call | `GET /v1/models` or equivalent zero-cost endpoint |
| Timeout | 10 seconds |
| Retries | None (single attempt) |
| Credential injection | From local source, same as worker dispatch via key router |
| Result recorded | In `provider-pool.json` history array |
| Secret in response | Never — result is status-only |

### Errors

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "Missing providerId" }` | `providerId` not in payload |
| 404 | `{ "error": "Provider not found" }` | `providerId` not in pool state |
| 500 | `{ "error": "Probe failed", "details": "..." }` | Internal probe error |

---

## Action: `provider.rotateKey`

Guides the operator through a credential rotation workflow. The UI
never accepts, stores, or transmits the new key — the operator
updates the secret in the local source outside the UI.

### Metadata

| Property | Value |
|----------|-------|
| Action ID | `provider.rotateKey` |
| Risk level | High |
| `dangerous` | `true` |
| `humanRequired` | `true` |
| Confirmation | Type `ROTATE` + exact provider id |
| Side effects | Resets provider state, runs auth probe, writes audit |
| History event | `key-rotated` |

### Preview

**Request:**

```json
POST /api/actions/preview
{
  "actionId": "provider.rotateKey",
  "payload": {
    "providerId": "provider-secondary"
  }
}
```

**Response:** `200 OK`

```json
{
  "actionId": "provider.rotateKey",
  "label": "Rotate Key",
  "description": "Guided provider credential rotation workflow",
  "preview": {
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
    "secretSourceKey": "lian-claude-***"
  },
  "dryRun": true
}
```

### Execute

**Request:**

```json
POST /api/actions/execute
{
  "actionId": "provider.rotateKey",
  "payload": {
    "providerId": "provider-secondary"
  },
  "confirm": true,
  "confirmationToken": "ROTATE provider-secondary"
}
```

**Response:** `200 OK`

```json
{
  "ok": true,
  "auditId": "audit-1715500000001-def456",
  "result": {
    "providerId": "provider-secondary",
    "status": "available",
    "probeResult": "valid",
    "rotatedAt": "2026-05-12T01:00:00Z"
  }
}
```

### Execute Behavior

1. Validate provider is in a rotatable state (`disabled` with
   `auth` failure class, or `exhausted` with expired cooldown).
2. Reset provider state to `available` with `currentConcurrency: 0`.
3. Clear cooldown and failure counters.
4. Run a lightweight auth probe to verify the new key.
5. If probe fails, re-disable the provider and return probe error.
6. Log the rotation event to the audit trail.

### Precondition Checks

| Check | Failure Response |
|-------|-----------------|
| Provider exists | `404` — `"Provider not found"` |
| Provider is rotatable | `409` — `"Provider is not in a rotatable state"` |
| Confirmation matches | `409` — `"Confirmation required"` |

### Errors

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "Missing providerId" }` | `providerId` not in payload |
| 404 | `{ "error": "Provider not found" }` | `providerId` not in pool state |
| 409 | `{ "error": "Provider is not in a rotatable state" }` | Status is `available` or not `auth` failure |
| 409 | `{ "error": "Confirmation required" }` | `confirmationToken` does not match |
| 500 | `{ "error": "Rotation failed", "details": "..." }` | Internal error during state reset or probe |

---

## Confirmation Token Format

| Action | Token Format | Example |
|--------|-------------|---------|
| `provider.testKey` | `TEST` | `TEST` |
| `provider.rotateKey` | `ROTATE <providerId>` | `ROTATE provider-secondary` |

The `provider.rotateKey` token requires the exact provider id to
prevent accidental rotation of the wrong provider.

---

## Audit Trail Integration

Both actions write to the existing audit trail via `/api/audit`.

### `provider.testKey` Audit Entry

```json
{
  "id": "audit-1715500000000-abc123",
  "actionId": "provider.testKey",
  "startedAt": "2026-05-12T00:30:00.000Z",
  "completedAt": "2026-05-12T00:30:01.000Z",
  "status": "success",
  "payload": { "providerId": "provider-default" },
  "result": { "result": "valid", "latencyMs": 245 },
  "confirmationToken": "provided"
}
```

### `provider.rotateKey` Audit Entry

```json
{
  "id": "audit-1715500000001-def456",
  "actionId": "provider.rotateKey",
  "startedAt": "2026-05-12T01:00:00.000Z",
  "completedAt": "2026-05-12T01:00:02.000Z",
  "status": "success",
  "payload": { "providerId": "***" },
  "result": { "status": "available", "probeResult": "valid" },
  "confirmationToken": "provided"
}
```

All `payload` and `result` fields pass through `sanitizeObject`.

---

## Rotation Workflow Sequence

```
Operator opens Provider Settings tab
       │
       ▼
Operator clicks "Rotate Key" on disabled provider
       │
       ▼
Client calls POST /api/actions/preview
  { actionId: "provider.rotateKey", payload: { providerId } }
       │
       ▼
Server returns preview: current status, failure class, rotation steps
       │
       ▼
Client shows preview with blue badge, rotation checklist
       │
       ▼
Operator updates secret OUTSIDE the UI (env var / credman / settings)
       │
       ▼
Operator types "ROTATE <providerId>" in confirmation field
       │
       ▼
Client calls POST /api/actions/execute
  { actionId: "provider.rotateKey", payload: { providerId },
    confirm: true, confirmationToken: "ROTATE <providerId>" }
       │
       ▼
Server: validates state → resets provider → runs auth probe
       │
       ├── Probe success → provider available, audit logged
       │
       └── Probe failure → provider re-disabled, error returned
```

---

## Registered Action Module Table

The two new modules are added to the existing action registry:

| Module | id | dangerous | humanRequired | Description |
|--------|----|-----------|:-------------:|-------------|
| provider-test-key | `provider.testKey` | No | No | Lightweight auth probe for provider credential |
| provider-rotate-key | `provider.rotateKey` | Yes | Yes | Guided provider credential rotation workflow |

Each module exports:

```js
{
  id: 'provider.testKey',
  label: 'Test Key',
  description: 'Lightweight auth probe for provider credential',
  dangerous: false,
  preview(payload) { /* dry-run */ },
  execute(payload) { /* runs probe, writes audit */ }
}
```

---

## Data Sources

| Source | Used By | Fields |
|--------|---------|--------|
| `.github/ai-state/provider-pool.json` | Both actions | Provider id, status, history, cooldown, failure class |
| `.github/ai-policy/provider-pool-policy.json` | Both actions | Label, source type, secret ref key |
| Provider key router | `provider.testKey` probe | Credential resolution (same path as worker dispatch) |

---

## Non-Goals

- No new HTTP endpoints — both actions use existing `/api/actions/*`.
- No secret input, storage, or display through the WebUI.
- No automatic rotation — all rotations require human confirmation.
- No server-side credential generation or management.
- No changes to the provider key router or worker dispatch logic.
- No new state files or schema changes (uses existing provider state).
- No changes to Prisma, auth modules, or production deployment.

---

## Cross-References

- [Provider Key Management WebUI](../ai-native/provider-key-management-webui.md) — full design doc
- [Provider Pool WebUI API](provider-pool-webui-api.md) — base API contract
- [WebUI Control Map](../ai-native/webui-control-map.md) — action risk gates
- [Provider Key Router](../ai-native/provider-key-router.md) — credential resolution
- [Provider Rotation Local Secrets](../ai-native/provider-rotation-local-secrets.md) — rotation runbook
- [WebUI Operation Runbook](../ai-native/webui-operation-runbook.md) — operator procedures
- [Provider Pool WebUI Security](../ai-native/provider-pool-webui-security.md) — security model
