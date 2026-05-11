# Provider Pool WebUI Architecture

Local-only web dashboard for monitoring and managing the provider pool,
worker concurrency, and launch readiness from a browser.

> **Closes:** [#531](https://github.com/taoyu051818-sys/lian-nest-server/issues/531)

---

## Problem

The provider pool system operates through JSON policy/state files and
PowerShell guard scripts. Operators must read raw JSON or run CLI guards
to check provider status, cooldown timers, and launch readiness. There
is no visual surface for at-a-glance monitoring or quick state changes.

## Goals

- Display live provider pool status (available, exhausted, disabled).
- Show per-provider concurrency utilization against max limits.
- Surface cooldown timers with countdown for exhausted providers.
- Visualize global worker count vs. `globalMaxWorkers` cap.
- Indicate launch readiness (ready/blocked) with blocking reasons.
- Keep the WebUI local-only — no secrets, no remote access.

## Non-Goals

- No production deployment or hosted service.
- No authentication/authorization layer (local-only tool).
- No secret management or credential editing through the UI.
- No mutation of provider pool state from the browser (read-only v1).
- No modification of runtime Nest modules or package dependencies.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (localhost)                      │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Provider Pool Dashboard (static HTML/JS)             │  │
│  │                                                       │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐  │  │
│  │  │ Provider     │ │ Concurrency  │ │ Launch        │  │  │
│  │  │ Status Panel │ │ Gauge Panel  │ │ Readiness     │  │  │
│  │  └─────────────┘ └──────────────┘ └───────────────┘  │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐  │  │
│  │  │ Cooldown    │ │ Worker       │ │ Failure       │  │  │
│  │  │ Timers      │ │ Activity     │ │ Log           │  │  │
│  │  └─────────────┘ └──────────────┘ └───────────────┘  │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │ fetch /api/pool-status            │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│  Local API Server        │  (Node.js, localhost only)       │
│                          │                                  │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │  /api/pool-status                                     │  │
│  │  Reads provider-pool-policy.json + provider-pool.json │  │
│  │  Merges, computes readiness, returns sanitized JSON   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  File Watcher                                         │  │
│  │  Watches .github/ai-state/ and .github/ai-policy/     │  │
│  │  Pushes updates via SSE to connected browsers          │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
              │                           │
              ▼                           ▼
┌─────────────────────────┐  ┌─────────────────────────┐
│  .github/ai-policy/     │  │  .github/ai-state/      │
│  provider-pool-policy   │  │  provider-pool.json     │
│  .json                  │  │  (read-only source)     │
│  (read-only source)     │  │                         │
└─────────────────────────┘  └─────────────────────────┘
```

---

## Components

### Dashboard (Static Frontend)

**Path:** `scripts/webui/provider-pool-dashboard.html`

Single-file or minimal static HTML/JS/CSS served by the local API server.
No build step, no bundler, no external CDN dependencies.

#### Panels

| Panel | Data Source | Refresh |
|-------|------------|---------|
| Provider Status | `providers[].status` from state file | SSE push |
| Concurrency Gauges | `currentConcurrency` / `maxConcurrency` | SSE push |
| Cooldown Timers | `cooldownExpiresAt` from state file | Client countdown |
| Launch Readiness | Computed by API from policy + state | SSE push |
| Worker Activity | `global.activeWorkers` from state file | SSE push |
| Failure Log | `lastFailureClass` + `lastFailureAt` | SSE push |

### Local API Server

**Path:** `scripts/webui/provider-pool-api.js`

Lightweight Node.js HTTP server (no Express dependency — uses built-in
`http` module). Binds to `127.0.0.1` only.

#### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/pool-status` | Merged provider pool status with readiness |
| `GET` | `/api/events` | SSE stream for live state updates |
| `GET` | `/` | Serves the static dashboard HTML |

#### `/api/pool-status` Response Shape

```json
{
  "capturedAt": "2026-05-11T12:00:00.000Z",
  "providers": [
    {
      "id": "provider-default",
      "label": "Primary Claude credential",
      "status": "available",
      "currentConcurrency": 2,
      "maxConcurrency": 5,
      "cooldownExpiresAt": null,
      "lastFailureClass": null,
      "lastFailureAt": null
    }
  ],
  "global": {
    "activeWorkers": 2,
    "globalMaxWorkers": 30,
    "availableProviders": 1,
    "exhaustedProviders": 0,
    "disabledProviders": 0
  },
  "readiness": {
    "ready": true,
    "reasons": []
  }
}
```

The response is derived from committed policy/state files only. No secrets
are ever included or forwarded.

### File Watcher

**Path:** `scripts/webui/provider-pool-watcher.js`

Uses `fs.watch` to monitor changes to:
- `.github/ai-state/provider-pool.json`
- `.github/ai-policy/provider-pool-policy.json`

When a change is detected, the watcher re-reads the files, recomputes
the merged status, and pushes an SSE event to all connected browsers.

---

## Security Boundaries

### Network Binding

The API server MUST bind to `127.0.0.1` (loopback) only. No `0.0.0.0`
binding, no remote access, no port forwarding configuration.

```js
server.listen(PORT, '127.0.0.1', () => { ... });
```

### Secret Exclusion

| Artifact | In UI? | Reason |
|----------|:------:|--------|
| API keys, tokens | No | Never read from secret sources |
| `~/.claude/settings.json` | No | Never accessed by WebUI |
| Provider credentials | No | Only provider ids are read |
| Worker env vars with secrets | No | Not in state/policy files |

The WebUI reads only from `.github/ai-policy/` and `.github/ai-state/`
which contain sanitized, non-secret provider metadata by design
(see [provider-pool.md](provider-pool.md)).

### CORS Policy

No CORS headers. The dashboard is served from the same origin as the API.
Cross-origin requests are rejected by default.

### Mutation Boundary (v1)

Version 1 is **read-only**. The API server does not accept POST/PUT/DELETE
requests. State mutations remain CLI-only through guard scripts.

Future versions may add controlled mutation endpoints with local-only
confirmation flows.

---

## Data Flow

```
1. Operator opens http://127.0.0.1:3847 in browser
                │
                ▼
2. Dashboard loads, calls GET /api/pool-status
                │
                ▼
3. API reads policy + state files from disk
                │
                ▼
4. API merges data, computes readiness
                │
                ▼
5. Dashboard renders panels from response JSON
                │
                ▼
6. Dashboard opens SSE connection to /api/events
                │
                ▼
7. File watcher detects state change → pushes SSE event
                │
                ▼
8. Dashboard re-renders affected panels
```

---

## Readiness Computation

The API server computes launch readiness using the same logic as
`check-provider-pool.js`:

| Condition | Result |
|-----------|--------|
| All providers exhausted or disabled | `ready: false, reason: "all-exhausted"` |
| Global worker count at `globalMaxWorkers` | `ready: false, reason: "at-global-cap"` |
| All available providers at max concurrency | `ready: false, reason: "all-at-capacity"` |
| At least one provider has capacity | `ready: true` |

---

## Port Selection

Default port: `3847` (arbitrary high port, unlikely to collide).

If the port is in use, the server increments until an open port is found.
The actual port is logged to stdout on startup:

```
Provider Pool WebUI running at http://127.0.0.1:3847
```

---

## Running the WebUI

```bash
# Start the dashboard server
node scripts/webui/provider-pool-api.js

# Custom port
node scripts/webui/provider-pool-api.js --port 4000

# Background mode (prints URL, returns control)
node scripts/webui/provider-pool-api.js --daemon
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Clean shutdown |
| `1` | Port binding failure or file read error |
| `2` | Invalid arguments |

---

## Integration with Existing Tools

### Relationship to Guard Script

| Tool | Purpose | Output |
|------|---------|--------|
| `check-provider-pool.js` | CI/guard validation | Exit code + JSON report |
| `provider-pool-api.js` | Live monitoring | HTTP API + SSE stream |

Both read the same policy/state files. The guard is for automation; the
WebUI is for human operators.

### Relationship to Launch Gate

The WebUI surfaces the same readiness information that
`check-launch-gate.ps1` evaluates before dispatch. Operators can check the
dashboard before manually triggering a batch to see if the gate would pass.

---

## Future Enhancements

- [ ] Mutation endpoints: mark provider disabled, trigger cooldown reset
- [ ] Historical charts: concurrency over time, exhaustion frequency
- [ ] Alert banners: flash when a provider transitions to exhausted
- [ ] Multi-pool views: compare across different policy configurations
- [ ] Dark mode / theme support

---

## References

- [Provider Pool](provider-pool.md) — full architecture and planning doc
- [Provider Pool Guard](provider-pool-guard.md) — CLI guard validation
- [Launch Gate](launch-gate.md) — pre-launch health and conflict validation
- [Worker Telemetry Schema](worker-telemetry-schema.md) — telemetry format
