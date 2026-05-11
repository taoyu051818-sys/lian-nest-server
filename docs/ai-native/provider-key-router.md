# Provider Key Router Contract

Defines the local-only routing contract that maps parallel workers to provider
credentials based on availability, capability matching, cooldown state, and
failover policy. This is the final control-loop layer that ties provider pool
state, secret references, and assignment decisions into a single routing
decision point.

> **Schema file:** [`schemas/provider-key-router.schema.json`](../../schemas/provider-key-router.schema.json)
> **Closes:** [#597](https://github.com/taoyu051818-sys/lian-nest-server/issues/597)
>
> **Cross-references:**
> [provider-pool.md](provider-pool.md) for pool architecture,
> [provider-secret-ref-schema.md](provider-secret-ref-schema.md) for secret pointers,
> [provider-quota-rotation.md](provider-quota-rotation.md) for cooldown rules,
> [provider-assignment-state-schema.md](provider-assignment-state-schema.md) for active assignments.

---

## Overview

The provider key router is the decision layer that sits between task dispatch
and provider selection. When the launcher is ready to dispatch a worker, the
key router:

1. Reads the current provider pool state (`.github/ai-state/provider-pool.json`).
2. Reads secret references to determine which credentials are available.
3. Evaluates each route's eligibility based on status, concurrency, and cooldown.
4. Selects a provider using the configured selection strategy.
5. Returns the routing decision — the provider id and secret source — without
   exposing the actual credential value.

The router never sees, stores, or transmits raw API keys, tokens, or
credentials. It works exclusively with opaque provider ids and secret reference
pointers.

| Aspect | Value |
|--------|-------|
| Schema version | `schemaVersion: 1` |
| JSON Schema draft | `draft-07` |
| Default mode | `dryRun: true` |
| Purpose | Route workers to provider credentials without secret exposure |

---

## Problem

The existing provider pool tracks provider status and assignment state, but
there is no single contract that defines *how* a routing decision is made and
*what* state that decision depends on. The key router fills this gap by
providing:

- A machine-readable snapshot of all routing eligibility at dispatch time.
- A failover chain that defines provider ordering when the primary is
  exhausted.
- Cooldown awareness so the router never dispatches to a cooling-down provider.
- A dry-run default so all routing automation is safe by default.

---

## Fields

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|:---:|-------------|
| `schemaVersion` | `integer` (const `1`) | Yes | Schema version. |
| `capturedAt` | `string` (ISO-8601) | Yes | When this routing snapshot was captured. |
| `selectionStrategy` | `string` enum | Yes | Algorithm for provider selection. See [Selection Strategies](#selection-strategies). |
| `dryRun` | `boolean` (default `true`) | No | When true, computes routing but does not dispatch. |
| `routes` | `Route[]` (min 1) | Yes | Active routing entries. |
| `failoverChain` | `string[]` | No | Ordered provider ids for failover mode. |
| `global` | `GlobalRoutingSummary` | Yes | Aggregate routing metrics. |

### Route Fields

| Field | Type | Required | Description |
|-------|------|:---:|-------------|
| `providerId` | `string` (pattern `^provider-[a-z0-9-]+$`) | Yes | Provider identifier matching pool policy. |
| `secretRefSource` | `string` enum | Yes | Where the credential lives locally. |
| `secretRefKey` | `string` (1-256 chars) | Yes | Lookup key — a pointer, never a value. |
| `isRoutable` | `boolean` | Yes | Whether this route can accept new tasks. |
| `unroutableReason` | `string` enum or `null` | No | Why the route is not routable. |
| `priority` | `integer` (1-100) | Yes | Failover ordering. Lower = tried first. |
| `capabilities` | `string[]` enum | Yes | API capabilities this credential supports. |
| `currentConcurrency` | `integer` (min 0) | No | Workers currently routed here. |
| `maxConcurrency` | `integer` (min 0) | No | Max concurrent workers for this route. |
| `cooldownExpiresAt` | `string` (ISO-8601) or `null` | No | When cooldown ends. |
| `lastFailureClass` | `string` enum or `null` | No | Last failure classification. |
| `consecutiveFailures` | `integer` (min 0) | No | Failure streak counter. |
| `lastRoutedAt` | `string` (ISO-8601) or `null` | No | Last time a task was routed here. |

### Global Routing Summary Fields

| Field | Type | Required | Description |
|-------|------|:---:|-------------|
| `totalRoutable` | `integer` (min 0) | Yes | Routes where `isRoutable` is true. |
| `totalRoutes` | `integer` (min 0) | Yes | Total routing entries. |
| `totalActiveWorkers` | `integer` (min 0) | Yes | Sum of `currentConcurrency` across routes. |
| `globalMaxWorkers` | `integer` (min 0) | Yes | Hard ceiling on concurrent workers. |
| `lastUpdatedBy` | `string` | Yes | Process that last wrote this file. |

---

## Selection Strategies

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `least-loaded` | Pick the route with the most remaining capacity (`maxConcurrency - currentConcurrency`). | Default for balanced load across providers. |
| `round-robin` | Rotate through available routes in order. | Even distribution when all providers have equal capacity. |
| `failover` | Try providers in `failoverChain` priority order; fall through on exhaustion. | When a primary provider should absorb all load until it fails. |
| `manual` | Operator explicitly selects the provider. | Debugging, credential rotation, or one-off overrides. |

---

## Unroutable Reasons

| Reason | Meaning | Recovery |
|--------|---------|----------|
| `exhausted` | Quota or rate limit hit (429) | Automatic after cooldown expires |
| `disabled` | Manual disable or permanent auth issue | Human re-enables after credential fix |
| `at-capacity` | `currentConcurrency >= maxConcurrency` | Automatic when a worker finishes |
| `cooldown` | Waiting for cooldown timer | Automatic when `cooldownExpiresAt` passes |
| `auth-failure` | Credential rejected (401/403) | Human must rotate or fix credential |

---

## Cooldown Rules

| Trigger | Duration | Source |
|---------|----------|--------|
| HTTP 429 (rate limit) | 15 minutes | provider-quota-rotation.md |
| Quota exhaustion | 60 minutes | provider-quota-rotation.md |
| Auth failure (401/403) | Indefinite (disabled) | provider-quota-rotation.md |

When a route enters cooldown:
1. `isRoutable` is set to `false`.
2. `unroutableReason` is set to `cooldown` or `exhausted`.
3. `cooldownExpiresAt` is set to `now + duration`.
4. The route is skipped by the selection strategy.
5. After cooldown expires, the state updater restores `isRoutable` to `true`.

---

## Routing Decision Flow

```
Task ready for dispatch
       │
       ▼
Read provider-key-router state
       │
       ▼
Filter routes: isRoutable == true
       │
       ▼
Match task capabilities to route capabilities
       │
       ▼
Apply selection strategy (least-loaded / round-robin / failover / manual)
       │
       ▼
┌──────────────────────────────────────┐
│ dryRun == true?                      │
│   YES → Log decision, do not dispatch│
│   NO  → Resolve secret from source,  │
│          inject into worker env,     │
│          dispatch worker             │
└──────────────────────────────────────┘
```

---

## Security Model

### What This Contract Records

- Provider ids (opaque labels from the pool policy)
- Secret source types and lookup keys (pointers, not values)
- Routing eligibility, cooldown state, and failure classifications
- Concurrency counts and selection strategy

### What This Contract Never Records

- Actual API keys, tokens, or credentials
- Cookie values or session tokens
- Environment variable values
- Contents of `~/.claude/settings.json` or Windows Credential Manager
- Any secret that could authenticate against an external service

The `secretRefKey` field is a **pointer**, not a value. It tells the router
"look up `ANTHROPIC_API_KEY` in the environment" — it does not contain the
key itself. The router resolves the secret at dispatch time and immediately
injects it into the worker's environment without writing it to any file.

### Dry-Run Default

All write-capable routing automation defaults to `dryRun: true`. This means:
- Routing decisions are computed and logged.
- No workers are actually dispatched.
- No secrets are resolved or injected.
- An operator must explicitly set `dryRun: false` to enable live dispatch.

---

## Examples

### Least-Loaded Routing (Two Providers)

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T14:30:00Z",
  "selectionStrategy": "least-loaded",
  "dryRun": true,
  "routes": [
    {
      "providerId": "provider-default",
      "secretRefSource": "env-var",
      "secretRefKey": "ANTHROPIC_API_KEY",
      "isRoutable": true,
      "unroutableReason": null,
      "priority": 1,
      "capabilities": ["claude-code", "print-mode", "batch"],
      "currentConcurrency": 1,
      "maxConcurrency": 4,
      "cooldownExpiresAt": null,
      "lastFailureClass": null,
      "consecutiveFailures": 0,
      "lastRoutedAt": "2026-05-11T14:25:00Z"
    },
    {
      "providerId": "provider-secondary",
      "secretRefSource": "credential-manager",
      "secretRefKey": "lian-claude-secondary",
      "isRoutable": true,
      "unroutableReason": null,
      "priority": 2,
      "capabilities": ["claude-code", "print-mode"],
      "currentConcurrency": 0,
      "maxConcurrency": 2,
      "cooldownExpiresAt": null,
      "lastFailureClass": null,
      "consecutiveFailures": 0,
      "lastRoutedAt": null
    }
  ],
  "failoverChain": ["provider-default", "provider-secondary"],
  "global": {
    "totalRoutable": 2,
    "totalRoutes": 2,
    "totalActiveWorkers": 1,
    "globalMaxWorkers": 6,
    "lastUpdatedBy": "provider-key-router.ps1"
  }
}
```

### Failover Mode with One Provider in Cooldown

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T15:00:00Z",
  "selectionStrategy": "failover",
  "dryRun": true,
  "routes": [
    {
      "providerId": "provider-default",
      "secretRefSource": "env-var",
      "secretRefKey": "ANTHROPIC_API_KEY",
      "isRoutable": false,
      "unroutableReason": "cooldown",
      "priority": 1,
      "capabilities": ["claude-code", "print-mode", "batch"],
      "currentConcurrency": 0,
      "maxConcurrency": 4,
      "cooldownExpiresAt": "2026-05-11T15:15:00Z",
      "lastFailureClass": "exhaustion",
      "consecutiveFailures": 1,
      "lastRoutedAt": "2026-05-11T14:50:00Z"
    },
    {
      "providerId": "provider-secondary",
      "secretRefSource": "credential-manager",
      "secretRefKey": "lian-claude-secondary",
      "isRoutable": true,
      "unroutableReason": null,
      "priority": 2,
      "capabilities": ["claude-code", "print-mode"],
      "currentConcurrency": 2,
      "maxConcurrency": 2,
      "cooldownExpiresAt": null,
      "lastFailureClass": null,
      "consecutiveFailures": 0,
      "lastRoutedAt": "2026-05-11T14:58:00Z"
    }
  ],
  "failoverChain": ["provider-default", "provider-secondary"],
  "global": {
    "totalRoutable": 1,
    "totalRoutes": 2,
    "totalActiveWorkers": 2,
    "globalMaxWorkers": 6,
    "lastUpdatedBy": "provider-key-router.ps1"
  }
}
```

### All Providers Exhausted (Blocked State)

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T16:00:00Z",
  "selectionStrategy": "failover",
  "dryRun": true,
  "routes": [
    {
      "providerId": "provider-default",
      "secretRefSource": "env-var",
      "secretRefKey": "ANTHROPIC_API_KEY",
      "isRoutable": false,
      "unroutableReason": "exhausted",
      "priority": 1,
      "capabilities": ["claude-code", "print-mode", "batch"],
      "currentConcurrency": 0,
      "maxConcurrency": 4,
      "cooldownExpiresAt": "2026-05-11T17:00:00Z",
      "lastFailureClass": "exhaustion",
      "consecutiveFailures": 3,
      "lastRoutedAt": "2026-05-11T15:45:00Z"
    },
    {
      "providerId": "provider-secondary",
      "secretRefSource": "credential-manager",
      "secretRefKey": "lian-claude-secondary",
      "isRoutable": false,
      "unroutableReason": "auth-failure",
      "priority": 2,
      "capabilities": ["claude-code"],
      "currentConcurrency": 0,
      "maxConcurrency": 2,
      "cooldownExpiresAt": null,
      "lastFailureClass": "auth",
      "consecutiveFailures": 1,
      "lastRoutedAt": "2026-05-11T15:30:00Z"
    }
  ],
  "failoverChain": ["provider-default", "provider-secondary"],
  "global": {
    "totalRoutable": 0,
    "totalRoutes": 2,
    "totalActiveWorkers": 0,
    "globalMaxWorkers": 6,
    "lastUpdatedBy": "provider-key-router.ps1"
  }
}
```

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **Launcher** | `routes[]`, `selectionStrategy`, `dryRun` | Select provider and dispatch worker. |
| **Provider selector** | `routes[].isRoutable`, `routes[].capabilities`, `failoverChain` | Filter eligible providers for a task. |
| **Launch gate** | `global.totalRoutable`, `global.globalMaxWorkers` | Block launches when no routes are available. |
| **State updater** | `routes[].cooldownExpiresAt`, `routes[].lastFailureClass` | Manage cooldown expiry and recovery. |
| **Monitoring** | `global.*`, `routes[].consecutiveFailures` | Track routing health and failure trends. |
| **Telemetry** | `routes[].providerId`, `routes[].lastRoutedAt` | Record routing decisions (never secrets). |

---

## Validation Rules

| Rule | Enforcement |
|------|-------------|
| `secretRefKey` must not contain actual secret values | Human review / policy guard |
| `providerId` must match entries in pool policy and secret refs | Cross-file validation |
| `failoverChain` entries must exist in `routes` | Schema-level cross-reference |
| `schemaVersion` must be `1` | Schema const enforcement |
| `priority` values must be unique when strategy is `failover` | Runtime validation |
| `dryRun` must default to `true` | Schema default / policy enforcement |
| `capabilities` must match secret ref capabilities | Cross-file validation |

---

## Integration with Existing Provider Ecosystem

```
provider-pool-policy.json          Defines allowed providers and limits
         │
         ▼
provider-pool.json                 Tracks runtime provider status
         │
         ▼
provider-secret-ref.schema.json    Points to local credentials
         │
         ▼
┌─────────────────────────────────────────────────┐
│  provider-key-router.schema.json                 │
│  (THIS CONTRACT)                                 │
│                                                  │
│  Combines pool state + secret refs + failover    │
│  policy into a single routing decision snapshot  │
└─────────────────────────────────────────────────┘
         │
         ▼
provider-assignment-state.schema.json   Records which route was chosen
         │
         ▼
Worker dispatched with LIAN_PROVIDER_ID (no secret in env)
```

---

## Human-Required Boundaries

The following actions always require human intervention:

| Action | Why Human-Owned |
|--------|-----------------|
| Setting `dryRun` to `false` | Enables live dispatch with secret resolution |
| Changing `selectionStrategy` to `manual` | Requires explicit provider selection |
| Re-enabling a route with `unroutableReason: auth-failure` | Credential rotation has security implications |
| Modifying `failoverChain` ordering | Affects all future routing decisions |
| Adding new routes | Involves secret management decisions |

---

## References

- [Provider Pool](provider-pool.md) — Pool architecture, policy, and state.
- [Provider Secret Reference Schema](provider-secret-ref-schema.md) — Secret pointer format.
- [Provider Quota Rotation](provider-quota-rotation.md) — Cooldown rules and exhaustion handling.
- [Provider Assignment State Schema](provider-assignment-state-schema.md) — Active assignment records.
- [Provider Pool Guard](provider-pool-guard.md) — Pre-launch validation tool.
- [Provider Local Secret Store](provider-local-secret-store.md) — Credential storage and resolution.

---

## Design Decisions

- **Dry-run default:** All routing automation defaults to non-destructive mode. An operator must explicitly enable live dispatch. This prevents accidental worker dispatch during development or debugging.
- **Pointers, not values:** The `secretRefKey` field is a lookup key, never a secret value. The router resolves the actual credential at dispatch time and never writes it to any file.
- **Failover chain as explicit ordering:** Rather than inferring priority from provider status, the failover chain is an explicit ordered list. This makes routing behavior predictable and auditable.
- **Capability matching:** The router filters routes by task capability requirements before applying selection strategy. This prevents routing a `batch` task to a provider that only supports `claude-code`.
- **Cooldown as a first-class field:** Cooldown state is tracked per-route with an explicit expiry timestamp, not inferred from provider status. This allows the router to make precise decisions about when a route will become available again.
- **No auto-recovery for auth failures:** Routes with `unroutableReason: auth-failure` require human intervention. Automatic retry on auth failures would mask credential issues and potentially trigger account lockouts.
