# Provider UI Policy

Defines what the provider management UI may display and mutate.
API keys are local-only and never surfaced through any UI surface.

> **Closes:** [#554](https://github.com/taoyu051818-sys/lian-nest-server/issues/554)

---

## Overview

The provider UI policy governs read and write boundaries for any
provider dashboard, CLI tool, or orchestrator surface that exposes
provider pool state. It ensures that:

- Secrets are never displayed, logged, or stored by the UI layer.
- Operational mutations (enable/disable, cooldown reset) are allowed
  with confirmation.
- Policy-level changes (adding providers, modifying failure rules)
  require file-level edits, not UI actions.

---

## Display Rules

### Safe to Display

| Field | Description |
|-------|-------------|
| `provider.id` | Provider identifier |
| `provider.label` | Human-readable label |
| `provider.status` | available / exhausted / disabled |
| `provider.currentConcurrency` | Active workers on this provider |
| `provider.maxConcurrency` | Concurrency cap |
| `provider.cooldownExpiresAt` | Cooldown end timestamp (null if not cooling) |
| `provider.lastFailureClass` | exhaustion / auth / runtime / null |
| `global.globalMaxWorkers` | Global worker ceiling |
| `global.activeWorkers` | Total active workers |
| `global.availableProviders` | Providers with capacity |
| `concurrency.providerSelectionStrategy` | Selection algorithm |
| `exhaustion.triggers` | Trigger conditions and cooldown durations |

### Never Displayed

| Field | Reason |
|-------|--------|
| `provider.secret` | API keys, tokens, credentials |
| `provider.sourcePath` | Local filesystem paths to credential stores |
| `raw-api-response` | May contain account or billing details |
| `env.ANTHROPIC_API_KEY` | Environment variable secrets |

---

## Mutation Rules

### Allowed (with confirmation)

| Action | Target | Notes |
|--------|--------|-------|
| `disable-provider` | `provider.status` | Sets status to disabled. Manual recovery required. |
| `enable-provider` | `provider.status` | Re-enables a disabled provider. Blocked if auth failure. |
| `reset-cooldown` | `provider.cooldownExpiresAt` | Clears cooldown. Provider becomes available immediately. |
| `adjust-max-concurrency` | `provider.maxConcurrency` | Must be positive integer, not exceed globalMaxWorkers. |
| `adjust-global-max-workers` | `concurrency.globalMaxWorkers` | Must be positive integer. |

### Forbidden

| Action | Reason |
|--------|--------|
| `set-secret` | Secrets configured locally only. |
| `modify-source` | Secret source is a policy decision. |
| `add-provider` | Requires policy + state file updates. |
| `remove-provider` | Requires policy file update + orchestrator coordination. |
| `modify-failure-classification` | Policy-level decision. |
| `modify-exhaustion-triggers` | Policy-level decision. |

---

## Security Model

### Secret Handling

The UI follows a **never-display, never-store** model:

1. API keys are injected from local-only sources (env vars, credential
   manager, `~/.claude`).
2. The UI reads state from `.github/ai-state/provider-pool.json`, which
   never contains secrets.
3. Mutation commands are written to the state file or emitted as control
   events — never to the policy file.
4. Secrets are never logged, cached, or transmitted by the UI layer.
5. The UI does not proxy API calls to the provider. Workers handle their
   own API traffic.

### Audit Trail

All mutations are logged to `provider-ui-audit.ndjson`:

```json
{
  "timestamp": "2026-05-11T14:30:00Z",
  "action": "reset-cooldown",
  "target": "provider-default.cooldownExpiresAt",
  "actor": "operator",
  "previousValue": "2026-05-11T15:00:00Z",
  "newValue": null
}
```

Logs never contain secrets.

---

## UI Boundaries

| Direction | Files |
|-----------|-------|
| Reads from | `.github/ai-policy/provider-pool-policy.json`, `.github/ai-state/provider-pool.json` |
| Writes to | `.github/ai-state/provider-pool.json` |
| Never writes to | `.github/ai-policy/provider-pool-policy.json`, `.env`, `.env.*`, `src/**`, `prisma/**`, `package.json` |

The UI is a state consumer and limited state mutator. It never modifies
policy files, source code, or secrets.

---

## References

- [Provider Pool](provider-pool.md) — full architecture and planning
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch validation
- [Provider Pool Policy](../../.github/ai-policy/provider-pool-policy.json) — machine-readable policy
- [Worker Permissions](worker-permissions.md) — provider-pool worker class
