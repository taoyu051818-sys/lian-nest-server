# Provider Pool WebUI

Local-only dashboard for monitoring the API provider pool used by parallel
Claude Code workers.

> **Status:** Planning — no runtime code yet. This README defines scope and
> security boundaries for a future WebUI slice.

---

## Purpose

The provider pool manages multiple Claude/API credentials so parallel workers
can route across them. When one credential hits a quota or rate limit (HTTP
429), the system marks it exhausted with a cooldown, then routes subsequent
workers to other available credentials.

This WebUI will provide a local-only view of:

- Provider availability and status (available / exhausted / disabled)
- Active worker counts per provider
- Cooldown timers and recovery status
- Recent exhaustion and failure events

---

## Non-Goals

- **No production runtime changes.** This is a local orchestration tool only.
- **No committed secrets.** API keys, tokens, and credentials are never stored
  in the repo, task JSON, issue bodies, PR bodies, or telemetry logs.
- **No remote access.** The dashboard runs on localhost only and is not
  exposed to the network.
- **No provider management.** Adding or removing providers is done by editing
  the policy and state files directly — the WebUI is read-only.

---

## Security Boundaries

### Secrets

| Artifact | Status |
|----------|--------|
| API keys, tokens, credentials | Never committed |
| `C:\Users\LENOVO\.claude\settings.json` | Never committed |
| Raw provider responses with account details | Never committed |
| Provider secrets in issue/PR bodies | Never committed |
| Secrets in telemetry logs | Never committed |

### Safe to Commit

| Artifact | Location |
|----------|----------|
| Provider policy (ids, limits, rules) | `.github/ai-policy/provider-pool-policy.json` |
| Provider state (status, cooldown, counts) | `.github/ai-state/provider-pool.json` |
| Provider id in telemetry | `worker-telemetry.ndjson` |

Secret injection happens at the launcher level via `LIAN_PROVIDER_ID` env var.
Workers receive only the provider id, never the raw secret.

---

## Local Usage

The WebUI reads from two JSON files that are already part of the provider pool
architecture:

| File | Purpose |
|------|---------|
| `.github/ai-policy/provider-pool-policy.json` | Provider definitions, concurrency limits, exhaustion rules |
| `.github/ai-state/provider-pool.json` | Current provider status, cooldowns, active worker counts |

To run locally (once implemented):

```bash
# From the repo root
cd tools/provider-pool-webui
npm install
npm start
# Opens at http://localhost:3001 (or configured port)
```

The dashboard should only read state files — it must never write to them.

---

## Provider Status Reference

| Status | Meaning | Auto-Recovery |
|--------|---------|:---:|
| `available` | Has capacity, no cooldown | — |
| `exhausted` | Quota or rate limit hit; cooling down | Yes, after cooldown |
| `disabled` | Auth failure or manual disable | No |

### Exhaustion Triggers

| Trigger | Action | Cooldown |
|---------|--------|----------|
| HTTP 429 | `mark-exhausted` | 15 min |
| Quota exhausted | `mark-exhausted` | 60 min |
| Auth failure (401/403) | `mark-disabled` | None (manual fix required) |
| Transient error (5xx) | No state change | — |

---

## Architecture Context

```
.github/ai-policy/provider-pool-policy.json   (allowed providers, limits)
              │
              ▼
       Provider Selector
       (select-api-provider.ps1)
              │
              ├── all exhausted/disabled? → block launch (fail-closed)
              ▼
       pick provider (least-loaded strategy)
              │
              ▼
       set LIAN_PROVIDER_ID env var for worker
              │
              ▼
       worker reads LIAN_PROVIDER_ID, injects secret from local source
```

The WebUI visualizes this flow but does not participate in it.

---

## References

- [Provider Pool Architecture](../../docs/ai-native/provider-pool.md) — full design doc
- [Provider Pool Guard](../../docs/ai-native/provider-pool-guard.md) — CI validation
- [Provider Pool Policy](../../.github/ai-policy/provider-pool-policy.json) — provider config
- [Provider Pool State](../../.github/ai-state/provider-pool.json) — runtime state
