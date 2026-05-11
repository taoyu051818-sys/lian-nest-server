# Provider Pool WebUI — Operation Console

Defines the client-side operation console for preview, execute, and
audit of controlled provider-pool actions.

> **Closes:** [#650](https://github.com/taoyu051818-sys/lian-nest-server/issues/650)

---

## Overview

The operation console adds a tabbed interface to the provider pool WebUI
dashboard. It allows operators to preview and execute controlled actions
against providers, queue entries, and global state. All actions default
to **preview mode**; execute requires typed confirmation and respects
policy guard semantics.

```
┌─────────────────────────────────────────────────────────────┐
│  [Dashboard]  [Operation Console]                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  MODE: PREVIEW (default)  Execute requires typed confirm    │
│                                                             │
│  Provider Actions                                           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ provider-default (available)                          │  │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────────┐           │  │
│  │  │ Retry   │ │ Clear    │ │ Disable      │           │  │
│  │  │ [LOW]   │ │ [MEDIUM] │ │ [HIGH]       │           │  │
│  │  │ Preview │ │ Preview  │ │ ⚠ Human req  │           │  │
│  │  └─────────┘ └──────────┘ └──────────────┘           │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Queue Actions                                              │
│  Global Actions                                             │
│  Audit Log                                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Safety Model

### Preview by Default

All actions render in preview mode first. The preview shows the exact
payload that would be sent for execution, including target, current
state, and expected outcome. No mutations occur until explicit
confirmation.

### Typed Confirmation

Execute requires typing a specific confirmation phrase (e.g., `RETRY`,
`CLEAR`, `DISABLE`). The execute button remains disabled until the
phrase matches exactly. This prevents accidental clicks.

### High-Risk Blockers

Actions with `riskLevel: "high"` or `humanRequired: true` display a
warning banner and cannot be auto-executed through the console. These
require out-of-band human approval.

### Secret Isolation

The console never displays, logs, or transmits secrets. All preview
payloads use sanitized state data from the provider-pool JSON files.
No API keys, tokens, or credentials are referenced.

---

## Action Registry

### Provider Actions

| Action | Risk | Confirm | Applicable When | Description |
|--------|------|---------|-----------------|-------------|
| `provider.retry` | Low | `RETRY` | Provider is exhausted or disabled | Re-enable provider via guard |
| `provider.clearCooldown` | Medium | `CLEAR` | Provider has active cooldown | Remove cooldown timer via guard |
| `provider.disable` | High | `DISABLE` | Provider is available | Manual disable (human required) |

### Queue Actions

| Action | Risk | Confirm | Applicable When | Description |
|--------|------|---------|-----------------|-------------|
| `queue.retryBlocked` | Low | `RETRY` | Blocked queue entries exist | Re-queue blocked tasks via guard |
| `queue.clearStale` | Medium | `CLEAR` | Stale entries (>2h) exist | Remove stale queue entries via guard |

### Global Actions

| Action | Risk | Confirm | Applicable When | Description |
|--------|------|---------|-----------------|-------------|
| `global.refreshState` | Low | `REFRESH` | Always | Force state file refresh |
| `global.exportAudit` | Low | `EXPORT` | Audit log has entries | Download audit log as JSON |

---

## Data Flow

```
provider-pool.json (sanitized state)
       │
       ▼
  WebUI client (app.js)
       │
       ├── Action Registry (client-side)
       │     ├── preview payload generation
       │     └── confirmation gate
       │
       ├── Audit Log (client-side, session-only)
       │
       └── Execute dispatch (requires server guard)
             │
             ▼
       Guard validation (server-side)
             │
             ▼
       Mutation applied (if guard passes)
```

---

## Audit Log

All executed actions are recorded in a client-side audit log. Each entry
includes:

- `timestamp` — ISO 8601 when the action was dispatched
- `action` — action id from the registry
- `riskLevel` — risk classification at time of execution
- `target` — provider id or scope identifier
- `payload` — the preview payload that was confirmed
- `mode` — always `"execute"` (preview actions are not logged)
- `status` — `"dispatched"` (server guard result not tracked client-side)

The audit log is session-only (not persisted to server). The
`global.exportAudit` action allows downloading the log as JSON.

---

## Integration

### Tab Navigation

The operation console is rendered as a second tab alongside the existing
dashboard view. Tab switching is handled client-side with no additional
data fetching.

### Guard Semantics

All mutations pass through the existing provider-pool guard. The client
dispatches a confirmation record; the server guard validates and applies
the mutation. The console never bypasses guard checks.

### State Refresh

The console uses the same state data as the dashboard (provider-pool
JSON, policy JSON, WebUI state JSON). No additional API endpoints are
required.

---

## Non-Goals

- No server-side endpoint changes (purely client-side)
- No persistent audit storage (session-only log)
- No WebSocket real-time updates (polling-based)
- No credential management through the console
- No bypass of policy guard or launch gate

---

## References

- [Provider Pool WebUI API](provider-pool-webui-api.md) — API contract
- [Provider Pool WebUI Security](provider-pool-webui-security.md) — security model
- [Provider Pool WebUI Read-Only Mode](provider-pool-webui-readonly-mode.md) — read-only baseline
- [Provider Pool Guard](provider-pool-guard.md) — guard validation
- [Launch Gate](launch-gate.md) — pre-launch checks
