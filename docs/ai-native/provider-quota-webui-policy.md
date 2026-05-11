# Provider Quota Exhaustion and Auto-Disable WebUI Policy

Documents how quota exhaustion, auto-disable, manual re-enable, and
provider rotation are surfaced in the provider pool WebUI and enforced
by the underlying control plane.

> **Closes:** [#823](https://github.com/taoyu051818-sys/lian-nest-server/issues/823)

---

## Overview

When an API provider hits a rate limit or quota cap, the system must
display the state accurately in the WebUI, prevent further dispatch to
that provider, and define a clear path to recovery. This doc covers the
full lifecycle: detection, display, auto-disable, manual re-enable, and
rotation safety.

---

## Quota Exhaustion Display

The WebUI surfaces quota exhaustion through the provider status panel
and cooldown timers.

### Provider Status Badge

| Status | Badge | Meaning |
|--------|-------|---------|
| `available` | Green | Has capacity, no active cooldown. |
| `exhausted` | Yellow | Quota or rate limit hit. Cooling down. |
| `disabled` | Red | Auth failure or manual disable. Requires intervention. |

### Cooldown Timer

When a provider enters `exhausted` status, the dashboard displays a
countdown timer derived from `cooldownExpiresAt` in the state file.
The timer shows the remaining wait before the provider auto-recovers.

```
provider-default  [exhausted]  cooldown: 12m 34s
```

The countdown is client-side — the browser computes remaining time from
the ISO-8601 timestamp. If the page is refreshed, the timer resumes
from the server-provided value.

### Failure Class Indicators

| Failure Class | Icon | Meaning |
|---------------|------|---------|
| `exhaustion` | Yellow warning | Quota or rate limit constraint (429, "quota exceeded"). |
| `auth` | Red error | Credential rejected (401/403). |
| `runtime` | Yellow warning | Transient provider error (timeout, 5xx). |

Only `exhaustion` and `auth` affect provider availability. `runtime`
failures are logged but do not block dispatch.

---

## Auto-Disable Semantics

A provider is automatically moved to `exhausted` or `disabled` status
when the state updater detects a qualifying failure.

### Exhaustion (Auto-Recovery)

| Trigger | Status Set | Cooldown Duration | Recovery |
|---------|-----------|-------------------|----------|
| HTTP 429 (rate limit) | `exhausted` | 15 minutes | Automatic after cooldown expires. |
| Quota exceeded | `exhausted` | 60 minutes | Automatic after cooldown expires. |

When the cooldown expires, the state updater restores the provider to
`available`. The WebUI reflects this on the next SSE push or page load.

### Auth Failure (Manual Recovery)

| Trigger | Status Set | Cooldown | Recovery |
|---------|-----------|----------|----------|
| HTTP 401/403 | `disabled` | None (indefinite) | Manual re-enable required. |

Auth failures set `disabled` with no auto-recovery. This is intentional:
automatic retry on auth failures would mask credential issues and could
trigger account lockouts.

### Status Transition Diagram

```
available  ──[429/quota]──►  exhausted  ──[cooldown expires]──►  available
available  ──[auth fail]──►  disabled   ──[manual fix]─────────►  available
exhausted  ──[auth fail]──►  disabled
```

---

## Manual Re-Enable Boundaries

Re-enabling a disabled provider requires human intervention. The WebUI
exposes this through a controlled action with safety gates.

### Re-Enable Action

| Aspect | Value |
|--------|-------|
| Action id | `re-enable-provider` |
| Dangerous | `true` |
| Confirmation required | Yes — operator must type the provider id. |
| Audit logged | Yes — every attempt is recorded. |

### Pre-Conditions

Before re-enabling, the operator must:

1. **Verify the credential is valid** — test the API key outside the
   orchestration system (e.g., direct `curl` or SDK call).
2. **Understand the failure cause** — check the failure log in the
   WebUI or the `lastFailureClass` field in the state file.
3. **Accept the risk** — re-enabling with a bad credential will
   immediately trigger another auth failure and disable.

### What Re-Enable Does

1. Sets provider `status` back to `available`.
2. Clears `lastFailureClass` to `null`.
3. Resets `consecutiveFailures` to `0`.
4. Writes an audit entry with the operator's action.

### What Re-Enable Does NOT Do

- Does not rotate or validate the credential.
- Does not modify the API key or secret reference.
- Does not affect other providers in the pool.

---

## Provider Rotation Safety

When multiple providers are configured, the system uses rotation and
failover to maintain throughput during exhaustion events.

### Selection Strategies

| Strategy | Behavior | When to Use |
|----------|----------|-------------|
| `least-loaded` | Pick the provider with the most remaining capacity. | Default for balanced load. |
| `round-robin` | Rotate through available providers in order. | Equal-capacity providers. |
| `failover` | Try providers in priority order; fall through on exhaustion. | Primary + backup setup. |
| `manual` | Operator explicitly selects the provider. | Debugging or rotation. |

### Failover Chain

The `failoverChain` field in the key router state defines the order in
which providers are tried. When the primary is exhausted, the router
automatically falls through to the next provider.

```
provider-default  (priority 1)  → exhausted → skip
provider-secondary (priority 2) → available → route here
```

### Safety Constraints

| Constraint | Enforcement |
|------------|-------------|
| Never dispatch to a cooling-down provider | Router checks `cooldownExpiresAt` before routing. |
| Never dispatch to a disabled provider | Router checks `isRoutable` flag. |
| Global concurrency cap enforced | Launch gate blocks when `totalActiveWorkers >= globalMaxWorkers`. |
| Dry-run default | All routing automation defaults to `dryRun: true`. |

### All-Exhausted Scenario

When all providers are exhausted or disabled:

1. The launch gate sets `ready: false` with reason `all-exhausted`.
2. The WebUI displays a red "Launch Blocked" banner.
3. No new workers are dispatched until at least one provider recovers.
4. If recovery is automatic (cooldown-based), the system resumes when
   the cooldown expires.
5. If all providers are `disabled`, human intervention is required for
   each one.

---

## WebUI Panels Reference

| Panel | Shows | Refresh |
|-------|-------|---------|
| Provider Status | Status badge per provider (available/exhausted/disabled) | SSE push |
| Cooldown Timers | Countdown per exhausted provider | Client-side countdown |
| Concurrency Gauges | `currentConcurrency` / `maxConcurrency` per provider | SSE push |
| Launch Readiness | Ready/blocked with blocking reasons | SSE push |
| Failure Log | `lastFailureClass` + timestamp per provider | SSE push |
| Worker Activity | Global active worker count vs. cap | SSE push |

---

## Non-Goals

- No automatic credential rotation — credentials are managed externally.
- No quota usage tracking or billing integration.
- No predictive exhaustion alerts (reactive only).
- No remote access — WebUI is localhost-only.
- No modification of NestJS application modules.

---

## References

- [Provider Pool Schema](provider-pool-schema.md) — state file structure and statuses
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch validation
- [Provider Key Router](provider-key-router.md) — routing contract and cooldown rules
- [Provider Pool WebUI Architecture](provider-pool-webui-architecture.md) — dashboard architecture
- [Provider Pool WebUI Actions API](provider-pool-webui-actions-api.md) — action execution and audit
