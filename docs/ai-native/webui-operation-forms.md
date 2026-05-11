# WebUI Operation Forms

Wires the provider pool WebUI operation console to server-side action
modules. Turns the dashboard into a real operation entry point with
form-based inputs, server-validated preview/execute, and merged audit.

> **Closes:** [#686](https://github.com/taoyu051818-sys/lian-nest-server/issues/686)

---

## Architecture

```
  Browser (localhost)
       │
       ├─ GET /api/actions         → discover installed action modules
       ├─ POST /api/actions/preview → dry-run preview (no side effects)
       ├─ POST /api/actions/execute → execute with confirmation
       ├─ GET /api/audit           → server-side audit trail
       │
       ▼
  Action Module Directory
  tools/provider-pool-webui/actions/*.js
```

The WebUI client loads action module metadata from the server on each
refresh cycle. Each module becomes a form card in the Operation Console
tab with structured inputs and server-validated execution.

---

## Operation Console Layout

The Operation Console is organized into sections:

1. **Action Modules (Server)** -- action modules loaded from the server's
   action directory. These are the primary entry points for mutations.
2. **Provider Actions** -- client-side action cards for each provider
   in the current state.
3. **Queue Actions** -- client-side action cards for queue operations.
4. **Global Actions** -- client-side utility actions (refresh, export).
5. **Audit Log** -- merged view of client-side and server-side audit
   entries.

---

## Form Inputs

Each server action card includes:

- **Provider selector** -- dropdown populated from current state,
  auto-shown for provider-scoped actions.
- **JSON payload editor** -- textarea for arbitrary payload parameters.
- **Preview button** -- calls `POST /api/actions/preview` (dry-run).
- **Execute button** -- appears after preview, requires typed
  confirmation (`EXECUTE`).

### Provider Selector

Actions whose `id` matches `/provider|cooldown|retry/i` get a provider
dropdown pre-populated from the current provider pool state. Selecting
a provider sets `providerId` in the payload.

### JSON Payload Editor

For advanced parameters, users can edit raw JSON in the textarea. This
is merged with any structured field values. Invalid JSON is ignored;
the server validates the final payload.

---

## Safety Model

### Preview-First Default

All server action forms default to preview mode. The Execute button
only appears after a successful preview response.

### Typed Confirmation

Execute requires typing `EXECUTE` in a confirmation input. This
prevents accidental mutations.

### Dangerous Actions

Action modules with `dangerous: true` display a warning banner. The
server enforces `confirm: true` for these actions (409 without it).

### Audit Trail

Every execution (success or failure) is recorded in the server's
audit log (`GET /api/audit`). The client also maintains a local audit
log for the session. Both are displayed in the merged audit view.

---

## API Contract

### `GET /api/actions`

Returns available action modules.

```json
{
  "actions": [
    {
      "id": "reset-cooldown",
      "label": "Reset Provider Cooldown",
      "description": "Clear cooldown timer for a provider",
      "dangerous": false
    }
  ]
}
```

### `POST /api/actions/preview`

Dry-run preview. No side effects.

```json
{
  "actionId": "reset-cooldown",
  "payload": { "providerId": "provider-default" }
}
```

### `POST /api/actions/execute`

Execute with confirmation. All payloads/results sanitized.

```json
{
  "actionId": "reset-cooldown",
  "payload": { "providerId": "provider-default" },
  "confirm": true
}
```

---

## Client-Side vs Server-Side Actions

| Aspect | Client-side | Server-side |
|--------|------------|-------------|
| Source | `ACTION_REGISTRY` in app.js | `GET /api/actions` from modules |
| Preview | Local computation | `POST /api/actions/preview` |
| Execute | Client audit log only | `POST /api/actions/execute` |
| Mutation | None (client-only state) | Server-guarded |
| Forms | Pre-built per action | Dynamic from module metadata |

Client-side actions are retained for:
- State refresh (no server call needed)
- Audit export (client-side aggregation)
- Queue/provider inspection (read-only)

---

## Non-Goals

- No bypass of server-side guard validation
- No raw stdout/stderr in action results
- No secrets in form payloads or responses
- No modification of action module contracts
- No remote access -- localhost only

---

## References

- [Actions API](provider-pool-webui-actions-api.md) -- server endpoint contract
- [Action Runner](webui-action-runner.md) -- module execution engine
- [Action Registry](webui-action-registry.md) -- module registration
- [Control Console](webui-control-console.md) -- console architecture
- [Security Model](provider-pool-webui-security.md) -- WebUI security
