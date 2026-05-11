# Provider Pool UI State Model

Documents the provider pool state fields rendered by the WebUI, how they
map to data sources, and the display/sanitization boundaries that keep
secrets off-screen.

> **Closes:** [#816](https://github.com/taoyu051818-sys/lian-nest-server/issues/816)

---

## Overview

The provider pool WebUI renders two primary data sources:

| Source | Path | Required |
|--------|------|----------|
| Provider pool state | `.github/ai-state/provider-pool.json` | Yes |
| WebUI state projection | `.github/ai-state/provider-pool-webui.json` | No (graceful fallback) |

The state file is the canonical source of truth. The WebUI projection adds
worker assignments, queue depth, and pre-computed pressure indicators.

---

## Provider Display Fields

Each provider card in the WebUI grid renders these fields:

| UI Field | State Field | Display Format | Notes |
|----------|------------|----------------|-------|
| Provider ID | `id` | Plain text, monospace | Opaque label, never a secret |
| Label | `label` | Human-readable text | From policy file, surfaced via state |
| Status | `status` | Badge with color | See [Status Indicators](#status-indicators) |
| Concurrency | `currentConcurrency / maxConcurrency` | Fraction (e.g. "2 / 5") | Current vs. cap |
| Cooldown | `cooldownExpiresAt` | Relative time or "none" | See [Cooldown Display](#cooldown-display) |
| Last Failure | `lastFailureClass` | Badge or "none" | See [Failure Class Display](#failure-class-display) |

### Status Indicators

| Status | Badge Color | Label | Meaning |
|--------|------------|-------|---------|
| `available` | Green | Available | Has capacity, ready for dispatch |
| `exhausted` | Yellow | Exhausted | Quota/rate limit hit, cooling down |
| `disabled` | Red | Disabled | Auth failure or manual disable |

Status transitions displayed in the UI:

```
available ──[quota/429]──► exhausted ──[cooldown]──► available
available ──[auth fail]──► disabled  ──[manual]───► available
exhausted ──[auth fail]──► disabled
```

---

## Cooldown Display

The `cooldownExpiresAt` field drives the cooldown timer in the UI.

| State | Display |
|-------|---------|
| `null` | "none" — no active cooldown |
| Future timestamp | Countdown timer: "Xm Ys" (minutes, seconds) |
| Past timestamp | "expired" — provider should transition to available on next poll |

The UI polls every 10 seconds. On each refresh the countdown recalculates
against the current time. When the countdown reaches zero, the status badge
flashes briefly then reverts to `available` on the next poll cycle.

---

## Failure Class Display

The `lastFailureClass` field appears as a small badge below the status:

| Class | Badge | Color | Description |
|-------|-------|-------|-------------|
| `null` | — | — | No recent failure |
| `exhaustion` | Exhaustion | Yellow | Quota or rate limit constraint |
| `auth` | Auth | Red | Credential rejected (401/403) |
| `runtime` | Runtime | Yellow | Transient provider error (500/502/503) |

The badge disappears when the provider recovers (status returns to
`available`) and `lastFailureClass` is cleared to `null`.

---

## Quota & Concurrency Display

### Per-Provider Concurrency Bar

The concurrency bar visualizes `currentConcurrency / maxConcurrency`:

| Utilization | Bar Color | Threshold |
|-------------|-----------|-----------|
| 0–59% | Green | Normal load |
| 60–89% | Yellow | Elevated load |
| 90–100% | Red | Near capacity |

### Global Pool Summary

Rendered above the provider grid:

| UI Element | Source Field | Description |
|------------|-------------|-------------|
| Active workers | `global.totalActiveWorkers` | Sum across all providers |
| Max workers | `global.globalMaxWorkers` | System-wide ceiling |
| Available providers | `global.availableProviders` | Green count |
| Exhausted providers | `global.exhaustedProviders` | Yellow count |
| Disabled providers | `global.disabledProviders` | Red count |

### Resource Pressure Gauge

From the WebUI projection (`pressure` section):

| Level | Indicator | Condition |
|-------|-----------|-----------|
| `normal` | Green gauge | utilizationPct < 60 and no exhausted providers |
| `elevated` | Yellow gauge | utilizationPct >= 60 or any provider exhausted |
| `critical` | Red gauge | utilizationPct >= 90 or all providers exhausted/disabled |

The gauge shows `utilizationPct` as a percentage bar with the color-coded
fill. `nearestCooldownExpiry` displays as a timestamp or "none".

---

## Display Boundaries (Sanitization)

### Always Displayed

| Field | Why Safe |
|-------|----------|
| `id` | Opaque label, not a credential |
| `label` | Human-readable name from policy |
| `status` | Operational state enum |
| `currentConcurrency`, `maxConcurrency` | Integer counts |
| `cooldownExpiresAt` | Timestamp, no secret material |
| `lastFailureClass` | Categorical enum |
| `global.*` | Aggregate integers |

### Never Displayed

| Artifact | Why Blocked |
|----------|-------------|
| API keys, tokens, credentials | Secret material |
| Local secret source paths | Reveals credential storage |
| Raw API responses | May contain billing/account data |
| `.claude/settings.json` contents | Machine config, not operator data |
| Environment variables (secrets) | `ANTHROPIC_API_KEY`, etc. |

The `providerId` is a logical identifier only — it does not reveal the
underlying secret or its storage location. This boundary is enforced at
the API layer: the `/providers` endpoint strips all credential fields
before returning data to the WebUI.

---

## State Polling Behavior

| Aspect | Value |
|--------|-------|
| Poll interval | 10 seconds |
| Cache strategy | `cache: 'no-store'` on all fetches |
| Stale detection | Compare `capturedAt` to current time; flag if > 60s old |
| Fallback | If WebUI projection unavailable, render provider grid only |

When the projection is stale (> 60s since `capturedAt`), the dashboard
shows a yellow "stale data" banner. The provider grid continues to render
from the last-known state.

---

## References

- [Provider Pool WebUI State Contract](provider-pool-webui-state-contract.md) — full JSON schema
- [Provider Pool Schema](provider-pool-schema.md) — state file schema
- [Provider Pool WebUI API](provider-pool-webui-api.md) — REST endpoints
- [Provider UI Policy](provider-ui-policy.md) — display and mutation rules
- [Provider Pool WebUI Worker View](provider-pool-webui-worker-view.md) — worker dashboard
