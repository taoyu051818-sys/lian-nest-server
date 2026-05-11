# Provider Pool WebUI

Local-only dashboard for monitoring the API provider pool and executing
controlled operations for parallel Claude Code workers.

> **Status:** Operational — server, action modules, audit, and console
> are live. See [Operation Console](#operation-console) for entry points.

---

## Purpose

The provider pool manages multiple Claude/API credentials so parallel workers
can route across them. When one credential hits a quota or rate limit (HTTP
429), the system marks it exhausted with a cooldown, then routes subsequent
workers to other available credentials.

This WebUI provides a local-only view of:

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

To run locally:

```bash
# From the repo root
npm run ops:webui
# Opens at http://localhost:3000 (localhost-only)
```

The dashboard reads state files and executes controlled actions via the
Operation Console. All mutating actions require preview + typed confirmation.

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

## Operation Console

The Operation Console tab exposes action modules for controlled mutations.
Every action follows the **preview-first, confirmation-gated** lifecycle:

```
Preview  →  Confirm  →  Execute  →  Audit
```

### Available Actions

| Action ID | Label | Risk | Description |
|-----------|-------|------|-------------|
| `compile-tasks` | Compile Tasks | Low | Compile issue JSON into worker task contracts |
| `plan.next.batch` | Plan Next Batch | Low | Preview next batch matched to provider capacity |
| `create-issues` | Create Issues | High | Propose and create GitHub issues from gap analysis |
| `issue-state` | Issue State Control | High | Reconcile issue labels/PRs and close done issues |
| `launch-batch` | Launch Batch | High | Run launch gate and dispatch queued tasks |
| `merge-prs` | Merge PRs | High | Merge explicit PR allowlist with guard checks |
| `provider-rotation` | Provider Key Rotation | High | Reset provider to available; clears cooldown |
| `worker.control` | Worker Control | High | List or stop workers with explicit targeting |

### Confirmation Phrases

| Action | Phrase |
|--------|--------|
| `provider-rotation` | `RETRY` |
| `queue.retryBlocked` | `RETRY` |
| `queue.clearStale` | `CLEAR` |
| `provider.disable` | `DISABLE` |
| `global.refreshState` | `REFRESH` |
| `global.exportAudit` | `EXPORT` |

### Visual Signals

| Signal | Meaning |
|--------|---------|
| Blue border/badge | Preview mode — no mutation |
| Red border/badge | Execute mode — state will change |
| Green border/badge | Safe / read-only action |
| 45% opacity | Disabled — action unavailable |
| Pulsing red dot | Confirmation needed |

### Safety Guarantees

- **Preview-first:** All actions dry-run before mutation via `/api/actions/preview`.
- **Typed confirmation:** High-risk actions require exact phrase match before execute.
- **Sanitized payloads:** `sanitizeObject` scrubs secret-shaped fields on all I/O.
- **Audit trail:** Every execute writes a persistent audit entry via `GET /api/audit`.
- **Localhost-only:** Server binds to `127.0.0.1`; no remote access.

For the full action map, risk gate chain, and rollback procedures, see:
- [WebUI Control Map](../../docs/ai-native/webui-control-map.md)
- [WebUI Operation Runbook](../../docs/ai-native/webui-operation-runbook.md)

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
- [WebUI Control Map](../../docs/ai-native/webui-control-map.md) — action-to-endpoint mapping
- [WebUI Operation Runbook](../../docs/ai-native/webui-operation-runbook.md) — step-by-step operator guide
