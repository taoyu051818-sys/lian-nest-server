# Provider Pool WebUI — Read-Only Mode

Defines the safe read-only mode for the first WebUI rollout. In this mode,
API keys and launch mutations are not editable through the interface.

> **Closes:** [#560](https://github.com/taoyu051818-sys/lian-nest-server/issues/560)

---

## Problem

The provider pool WebUI needs a safe initial rollout mode. A full read-write
UI would expose mutation surfaces (credential editing, provider enable/disable,
launch overrides) before the backend guard rails are battle-tested. A read-only
mode lets operators observe pool state without risking accidental misconfiguration.

## Goals

- Display provider pool status, concurrency, and cooldown state.
- Show provider policy details (ids, limits, capabilities) without editing.
- Prevent API key, token, or credential exposure in the UI.
- Prevent launch mutations (dispatch, cancel, override) through the UI.
- Provide a clear upgrade path to read-write mode after guard validation.

## Non-Goals

- No commit of API keys, tokens, or credentials to the repo.
- No bypass of the provider pool guard or launch gate.
- No backend runtime changes — this is documentation of the UI contract only.
- No authentication or authorization model for the WebUI itself (future work).

---

## Read-Only Mode Contract

### What the UI Displays

| Section | Data Source | Editable |
|---------|-----------|:--------:|
| Provider list | `provider-pool.json` state | No |
| Provider status | `provider-pool.json` status field | No |
| Concurrency counts | `provider-pool.json` current/max | No |
| Cooldown timers | `provider-pool.json` cooldownExpiresAt | No |
| Failure classification | `provider-pool.json` lastFailureClass | No |
| Global limits | `provider-pool.json` global section | No |
| Policy definitions | `provider-pool-policy.json` | No |
| Guard check results | `check-provider-pool.js --json` | No |

### What the UI Does NOT Display

| Artifact | Reason |
|----------|--------|
| API keys, tokens | Never exposed — secrets stay in local sources |
| Raw provider responses | May contain account details |
| Local file paths (`~/.claude`) | Security boundary |
| Environment variable values | May contain secrets |

### What the UI Does NOT Allow

| Action | Blocked Reason |
|--------|---------------|
| Edit provider credentials | Secrets boundary |
| Enable/disable providers | Launch mutation |
| Override concurrency limits | Launch mutation |
| Trigger worker dispatch | Launch mutation |
| Cancel running workers | Launch mutation |
| Modify cooldown timers | State mutation |
| Edit policy file | Policy mutation |

---

## UI Layout (Read-Only)

### Dashboard View

```
┌─────────────────────────────────────────────────────────────┐
│  Provider Pool Status                          [Read-Only]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Providers                                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ provider-default          ● available                 │  │
│  │   Concurrency: 0 / 3     Cooldown: —                 │  │
│  │   Last failure: none                                  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Global                                                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Active workers: 0      Global max: 3                  │  │
│  │ Available providers: 1  Exhausted: 0  Disabled: 0     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Policy                                                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Strategy: least-loaded    Fallback: block             │  │
│  │ Block when all exhausted: true                        │  │
│  │ Block when at capacity: true                          │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Guard Status                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ ✓ Ready    Violations: 0    Warnings: 0               │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Provider Detail View

```
┌─────────────────────────────────────────────────────────────┐
│  provider-default                              [Read-Only]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Status: ● available                                        │
│  Capabilities: claude-code, print-mode                      │
│  Max concurrency: 3                                         │
│  Current concurrency: 0                                     │
│  Cooldown expires: —                                        │
│  Last failure class: none                                   │
│                                                             │
│  [No edit controls available in read-only mode]             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Flow

```
provider-pool.json (sanitized state)
       │
       ▼
  check-provider-pool.js --json (guard results)
       │
       ▼
  WebUI read-only dashboard
       │
       ▼
  Operator observes state (no mutations)
```

The UI reads two data sources:

1. **State file** — `.github/ai-state/provider-pool.json` — sanitized, no secrets.
2. **Guard output** — `check-provider-pool.js --json` — structural and readiness validation.

Both are read-only inputs. The UI never writes to either file.

---

## Security Boundaries

### Secret Isolation

| Boundary | Enforcement |
|----------|-------------|
| No API keys in UI | Keys are in local sources, never in state files |
| No tokens in UI | Tokens are injected at worker runtime, not stored |
| No credential paths | State file uses provider ids, not secret locations |
| No mutation endpoints | Read-only mode has no write API surface |

### Why Read-Only Is Safe for First Rollout

1. **No write surface** — the UI cannot modify state, so it cannot cause
   provider misconfiguration.
2. **Sanitized data** — the state file never contains secrets, so the UI
   cannot leak them.
3. **Guard integration** — the UI displays guard results, helping operators
   detect issues before they cause problems.
4. **Audit trail** — state changes happen through scripts, not the UI,
   preserving the existing audit trail.

---

## Upgrade Path to Read-Write

The read-only mode is the first phase. A future read-write mode would add:

| Phase | Capabilities | Guard Rails Required |
|-------|-------------|---------------------|
| Phase 1 (current) | View only | None (read-only) |
| Phase 2 | View + provider enable/disable | Guard validation before mutation |
| Phase 3 | View + credential management | Secret manager integration, guard validation |
| Phase 4 | View + launch overrides | Full guard integration, audit logging |

Each phase requires additional guard validation before the UI mutation is
applied. The guard (`check-provider-pool.js`) is the single source of truth
for whether a mutation is safe.

---

## Integration

### Provider Pool Guard

The UI calls `check-provider-pool.js --json` to display readiness status.
The guard output is shown as-is — the UI does not interpret or modify it.

### Provider Pool State

The UI reads `provider-pool.json` directly. The state file is updated by
`scripts/ai/update-provider-state.ps1` (planned), not the UI.

### Provider Pool Policy

The UI reads `provider-pool-policy.json` to display configuration. The policy
file is edited manually or by automation, not the UI.

---

## References

- [Provider Pool](provider-pool.md) — full architecture and planning doc
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch validation tool
- [Launch Gate](launch-gate.md) — pre-launch health and conflict validation
- [Worker Permissions](worker-permissions.md) — provider-pool worker class
