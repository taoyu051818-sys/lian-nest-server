# Provider Pool State JSON Schema

Formal JSON Schema for `.github/ai-state/provider-pool.json`, the sanitized
projection of API provider pool availability consumed by the launch gate,
provider selector, state reconciler, and monitoring.

> **Schema file:** [`schemas/provider-pool.schema.json`](../../schemas/provider-pool.schema.json)
> **Closes:** [#461](https://github.com/taoyu051818-sys/lian-nest-server/issues/461)

---

## Overview

The provider pool state file is a single JSON snapshot that records the current
availability, concurrency, and cooldown status of each API provider in the pool.
It is the canonical source of truth for whether a new worker can be dispatched
to a given provider.

| Aspect | Value |
|--------|-------|
| Schema version | `stateVersion: 1` |
| JSON Schema draft | `draft-07` |
| Writer | `scripts/ai/update-provider-state.ps1` |
| Path | `.github/ai-state/provider-pool.json` |
| Secrets | **Never stored** — provider ids are opaque labels |

---

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `stateVersion` | `integer` (const `1`) | yes | Schema version. Increment when the shape changes. |
| `providers` | `Provider[]` | yes | Per-provider runtime state. |
| `global` | `GlobalSummary` | yes | Aggregate metrics for launch gate consumption. |

---

## Provider Entry

Each entry in `providers` represents a single API provider's sanitized runtime
state. The `id` must match a provider defined in
`.github/ai-policy/provider-pool-policy.json`.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Provider identifier (e.g. `provider-default`). Opaque label — never a secret. |
| `status` | `string` enum | Current availability. See [Provider Statuses](#provider-statuses). |
| `currentConcurrency` | `integer` (min 0) | Workers currently assigned to this provider. |
| `maxConcurrency` | `integer` (min 0) | Maximum concurrent workers. Must match the policy entry. |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `lastHealthCheckAt` | `string` (ISO-8601) or `null` | Last health probe timestamp. Null if never checked. |
| `lastFailureClass` | `string` enum or `null` | Classification of the last failure. See [Failure Classes](#failure-classes). |
| `cooldownExpiresAt` | `string` (ISO-8601) or `null` | When the cooldown ends. Null when not in cooldown. |
| `consecutiveFailures` | `integer` (min 0) | Consecutive failure count. Reset on successful recovery. |
| `totalQuotaEvents` | `integer` (min 0) | Lifetime quota exhaustion event count for this provider. |

---

## Provider Statuses

| Status | Meaning | Auto-Recovery | Cooldown |
|--------|---------|:-------------:|----------|
| `available` | Has capacity, no active cooldown. | — | — |
| `exhausted` | Quota or rate limit hit. Cooling down. | Yes, after `cooldownExpiresAt` | 15 min (429) or 60 min (quota) |
| `disabled` | Auth failure or manual disable. | No | None — requires manual intervention |

Status transitions:

```
available  ──[429/quota]──►  exhausted  ──[cooldown expires]──►  available
available  ──[auth fail]──►  disabled   ──[manual fix]─────────►  available
exhausted  ──[auth fail]──►  disabled
```

---

## Failure Classes

| Class | Meaning | Triggers | Severity |
|-------|---------|----------|----------|
| `exhaustion` | Quota or rate limit constraint | HTTP 429, "quota exceeded", "rate limit" | yellow |
| `auth` | Credential rejected | HTTP 401/403, "invalid api key" | red |
| `runtime` | Transient provider error | timeout, 500, 502, 503 | yellow |

Key distinction: `exhaustion` is a **resource constraint**, not a code bug. The
launch gate treats exhaustion and runtime failures differently — only exhaustion
marks a provider as unavailable.

---

## Global Summary

The `global` object provides aggregate metrics for fast launch gate evaluation
without iterating providers.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `totalActiveWorkers` | `integer` (min 0) | Sum of `currentConcurrency` across all providers. |
| `globalMaxWorkers` | `integer` (min 0) | Hard ceiling on total concurrent workers. Must match policy. |
| `availableProviders` | `integer` (min 0) | Count of providers with `status=available`. |
| `exhaustedProviders` | `integer` (min 0) | Count of providers with `status=exhausted`. |
| `disabledProviders` | `integer` (min 0) | Count of providers with `status=disabled`. |
| `lastUpdatedBy` | `string` | Identifier of the writing process (e.g. `update-provider-state.ps1`). |
| `capturedAt` | `string` (ISO-8601) | When this state snapshot was written. |

---

## Cross-Validation with Policy

The guard script (`scripts/guards/check-provider-pool.js`) enforces these
consistency rules between the state file and
`.github/ai-policy/provider-pool-policy.json`:

| Rule | Enforcement |
|------|-------------|
| Every provider id in state exists in policy (and vice versa) | Hard fail |
| `globalMaxWorkers` matches between state and policy | Hard fail |
| Per-provider `maxConcurrency` matches between state and policy | Hard fail |
| Exhausted provider with expired `cooldownExpiresAt` | Warning |

The JSON Schema enforces structural correctness (types, enums, patterns) but
does not encode cross-file consistency rules. Those are enforced by the guard
script at launch time.

---

## Examples

### Single Provider — Available

```json
{
  "stateVersion": 1,
  "providers": [
    {
      "id": "provider-default",
      "status": "available",
      "currentConcurrency": 0,
      "maxConcurrency": 1,
      "lastHealthCheckAt": "2026-05-11T12:00:00Z",
      "lastFailureClass": null,
      "cooldownExpiresAt": null,
      "consecutiveFailures": 0,
      "totalQuotaEvents": 0
    }
  ],
  "global": {
    "totalActiveWorkers": 0,
    "globalMaxWorkers": 3,
    "availableProviders": 1,
    "exhaustedProviders": 0,
    "disabledProviders": 0,
    "lastUpdatedBy": "update-provider-state.ps1",
    "capturedAt": "2026-05-11T12:00:00Z"
  }
}
```

### Exhausted Provider with Cooldown

```json
{
  "stateVersion": 1,
  "providers": [
    {
      "id": "provider-default",
      "status": "exhausted",
      "currentConcurrency": 0,
      "maxConcurrency": 1,
      "lastHealthCheckAt": "2026-05-11T12:30:00Z",
      "lastFailureClass": "exhaustion",
      "cooldownExpiresAt": "2026-05-11T12:45:00Z",
      "consecutiveFailures": 1,
      "totalQuotaEvents": 3
    }
  ],
  "global": {
    "totalActiveWorkers": 0,
    "globalMaxWorkers": 3,
    "availableProviders": 0,
    "exhaustedProviders": 1,
    "disabledProviders": 0,
    "lastUpdatedBy": "update-provider-state.ps1",
    "capturedAt": "2026-05-11T12:30:00Z"
  }
}
```

### Multi-Provider — Mixed States

```json
{
  "stateVersion": 1,
  "providers": [
    {
      "id": "provider-default",
      "status": "available",
      "currentConcurrency": 1,
      "maxConcurrency": 2,
      "lastHealthCheckAt": "2026-05-11T12:00:00Z",
      "lastFailureClass": null,
      "cooldownExpiresAt": null,
      "consecutiveFailures": 0,
      "totalQuotaEvents": 0
    },
    {
      "id": "provider-secondary",
      "status": "exhausted",
      "currentConcurrency": 0,
      "maxConcurrency": 2,
      "lastHealthCheckAt": "2026-05-11T12:15:00Z",
      "lastFailureClass": "exhaustion",
      "cooldownExpiresAt": "2026-05-11T12:30:00Z",
      "consecutiveFailures": 2,
      "totalQuotaEvents": 5
    },
    {
      "id": "provider-tertiary",
      "status": "disabled",
      "currentConcurrency": 0,
      "maxConcurrency": 1,
      "lastHealthCheckAt": null,
      "lastFailureClass": "auth",
      "cooldownExpiresAt": null,
      "consecutiveFailures": 1,
      "totalQuotaEvents": 0
    }
  ],
  "global": {
    "totalActiveWorkers": 1,
    "globalMaxWorkers": 5,
    "availableProviders": 1,
    "exhaustedProviders": 1,
    "disabledProviders": 1,
    "lastUpdatedBy": "update-provider-state.ps1",
    "capturedAt": "2026-05-11T12:15:00Z"
  }
}
```

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **Launch gate** | `providers[].status`, `global` | Block/allow worker dispatch based on availability. |
| **Provider selector** | `providers[]` | Pick a provider with capacity using least-loaded strategy. |
| **State reconciler** | `lastFailureClass`, `cooldownExpiresAt` | Detect expired cooldowns, trigger auto-recovery. |
| **Monitoring** | `global.capturedAt` | Detect stale state snapshots. |
| **Worker launcher** | `providers[].id` | Assign provider id via `LIAN_PROVIDER_ID` env var. |

---

## Design Decisions

- **No secrets** — provider ids are opaque labels, not API keys or tokens.
- **Snapshot, not log** — each write replaces the entire file (idempotent).
- **`stateVersion`** — enables schema evolution without breaking consumers.
- **Cross-validation** — structural correctness is schema-enforced; policy-state
  consistency is guard-enforced at launch time.
- **Cooldown timestamps** — ISO-8601 with timezone, allowing the guard to
  detect stale cooldowns without clock synchronization assumptions.

---

## References

- [Provider Pool](provider-pool.md) — full architecture and planning doc
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch validation tool
- [Provider Pool Policy](../../.github/ai-policy/provider-pool-policy.json) — policy configuration
- [Health State Schema](health-state-schema.md) — comparable state file schema
- [ai-state/README.md](../../.github/ai-state/README.md) — state marker overview
