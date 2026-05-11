# WebUI Action Registry

Allowlisted action metadata for the provider pool WebUI control console.
Every action the UI can invoke is registered with explicit id, risk level,
preview defaults, required fields, and privilege markers.

> **Closes:** [#647](https://github.com/taoyu051818-sys/lian-nest-server/issues/647)

---

## Overview

The action registry is the single source of truth for what the WebUI is
allowed to do. It enforces:

- **Explicit allowlist** — only registered action ids are accepted. No
  wildcards, no catch-all patterns.
- **Preview default** — every mutating action defaults to dry-run mode.
  The caller must explicitly opt out of preview to execute.
- **Privileged markers** — destructive or sensitive actions (kill worker,
  rotate key, update policy) are flagged as privileged and require
  elevated confirmation.
- **Risk metadata** — each action carries a risk level (low/medium/high/
  critical) for UI rendering and audit logging.
- **Required fields** — actions declare which fields the caller must
  supply; validation fails fast if any are missing.

```
┌─────────────────────────────────────────────────────────────┐
│  WebUI (browser)                                            │
│                                                             │
│  Operator selects action ──► UI calls /api/actions/:id      │
│                                     │                       │
└─────────────────────────────────────┼───────────────────────┘
                                      │
┌─────────────────────────────────────┼───────────────────────┐
│  Action Registry                    ▼                       │
│                                                             │
│  1. isAllowlisted(id)?  ─── No  ──► 403 Forbidden          │
│         │                                                   │
│        Yes                                                  │
│         │                                                   │
│  2. validateFields(id, fields)?                             │
│         │                                                   │
│     No ─┴──► 400 Missing fields                            │
│         │                                                   │
│        Yes                                                  │
│         │                                                   │
│  3. isPrivileged(id)?                                       │
│         │                                                   │
│        Yes ──► require confirmation + allowlist check       │
│         │                                                   │
│        No                                                   │
│         │                                                   │
│  4. defaultPreview?                                         │
│         │                                                   │
│     Yes ─┴──► return preview (dry-run) result               │
│         │                                                   │
│     explicitExecute=true ──► run script                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Registered Actions

### Read-Only (low risk, no preview needed)

| ID | Label | Description |
|----|-------|-------------|
| `view.provider.status` | View Provider Status | Display status, concurrency, cooldown |
| `view.worker.status` | View Worker Status | Display active worker assignments |
| `view.queue.status` | View Queue Status | Display pending queue depth |
| `view.resources` | View Resource Utilization | Display concurrency headroom and pressure |
| `view.policy` | View Policy | Display policy with secrets stripped |

### Provider Management (medium risk, preview default)

| ID | Label | Privileged | Required Fields |
|----|-------|:----------:|-----------------|
| `provider.cooldown.reset` | Reset Provider Cooldown | No | `providerId` |
| `provider.enable` | Enable Provider | No | `providerId` |
| `provider.disable` | Disable Provider | No | `providerId` |

### Worker Management (high risk, privileged, preview default)

| ID | Label | Required Fields |
|----|-------|-----------------|
| `worker.kill` | Kill Worker | `workerId` |
| `worker.drain` | Drain Worker | `workerId` |

### Resource / Queue Management (high risk, privileged, preview default)

| ID | Label | Required Fields |
|----|-------|-----------------|
| `concurrency.update` | Update Concurrency Limit | `target`, `value` |
| `queue.clear` | Clear Queue | *(none)* |

### Settings / Policy (critical risk, privileged, preview default)

| ID | Label | Required Fields |
|----|-------|-----------------|
| `settings.key.rotate` | Rotate Admin Token | *(none)* |
| `policy.update` | Update Policy | `field`, `value` |

---

## Risk Levels

| Level | Meaning | UI Indicator |
|-------|---------|-------------|
| `low` | Read-only, no side effects | Green |
| `medium` | Reversible mutation, low blast radius | Yellow |
| `high` | Destructive or hard to reverse | Orange |
| `critical` | Security-sensitive, system-wide impact | Red |

---

## Privilege Model

An action is **privileged** if it can cause irreversible damage or touches
security-sensitive state. Privileged actions:

1. Are flagged with `privileged: true` in the registry.
2. Require a confirmation message before execution.
3. Must be explicitly allowlisted in the caller's permission set.
4. Always default to preview mode (`defaultPreview: true`).

Current privileged actions:

- `worker.kill` — terminates a running process
- `worker.drain` — graceful but disruptive
- `concurrency.update` — changes system-wide limits
- `queue.clear` — drops pending work
- `settings.key.rotate` — invalidates current admin token
- `policy.update` — modifies system configuration

---

## Preview / Dry-Run Mode

All mutating actions default to **preview mode**. In preview mode:

- The action is validated (id allowlisted, fields present).
- The confirmation message is rendered.
- No script is executed, no state is changed.
- The response includes what *would* happen.

To execute for real, the caller must pass `explicitExecute: true` along
with a valid confirmation token. This two-step flow prevents accidental
mutations from the UI.

---

## API Usage

### `getAction(id)`

Look up an action by id. Returns `undefined` if not allowlisted.

### `isAllowlisted(id)`

Check whether an action id is in the allowlist.

### `isPrivileged(id)`

Check whether an action requires elevated confirmation.

### `isReadOnly(id)`

Check whether an action never mutates state.

### `getDefaultPreview(id)`

Return the default preview mode for an action. `null` for unknown ids.

### `validateFields(id, fields)`

Validate that all required fields are present. Returns
`{ valid: true }` or `{ valid: false, missing: [...] }`.

### `renderConfirmMessage(id, fields)`

Render the confirmation message with field placeholders substituted.
Returns `null` for read-only or unknown actions.

### `listActions(category?)`

Return all actions, optionally filtered by category.

### `describeAction(id)`

Return a sanitized descriptor for API responses. Strips script paths
to avoid leaking internal file structure.

### `registryMeta()`

Return registry metadata (schema version, counts, risk levels,
categories).

---

## Script Mapping

Each mutable action maps to a script that performs the actual work.
The registry stores the path but `describeAction()` strips it from
API responses. Scripts are executed by the server, never by the browser.

| Action | Script |
|--------|--------|
| `provider.cooldown.reset` | `scripts/ai/reset-provider-cooldown.ps1` |
| `provider.enable` | `scripts/ai/enable-provider.ps1` |
| `provider.disable` | `scripts/ai/disable-provider.ps1` |
| `worker.kill` | `scripts/ai/kill-worker.ps1` |
| `worker.drain` | `scripts/ai/drain-worker.ps1` |
| `concurrency.update` | `scripts/ai/update-concurrency.ps1` |
| `queue.clear` | `scripts/ai/clear-queue.ps1` |
| `settings.key.rotate` | `scripts/ai/rotate-webui-token.ps1` |
| `policy.update` | `scripts/ai/update-policy.ps1` |

---

## Security Constraints

| Constraint | Enforcement |
|------------|-------------|
| No wildcard actions | Every action id is explicit; no glob/prefix matching |
| Preview default | All mutations default to dry-run |
| Privileged confirmation | Privileged actions require confirm message rendering |
| No script path leaks | `describeAction()` strips paths from API responses |
| Field validation | Missing required fields are rejected before execution |
| Frozen registry | `ACTIONS` and `RISK` are `Object.freeze()`d |

---

## Non-Goals

- No runtime action registration (registry is static).
- No dynamic privilege escalation.
- No script execution from the browser — scripts run server-side only.
- No integration with the NestJS application modules.

---

## References

- [Provider Pool WebUI Security](provider-pool-webui-security.md) — security model
- [Provider Pool WebUI Read-Only Mode](provider-pool-webui-readonly-mode.md) — read-only contract
- [Provider Pool WebUI API](provider-pool-webui-api.md) — API surface
- [Provider Pool WebUI Architecture](provider-pool-webui-architecture.md) — system design
