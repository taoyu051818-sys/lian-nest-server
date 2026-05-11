# Provider Pool WebUI Local Server

Local-only HTTP server for viewing provider pool state and policy through a
browser dashboard.

> **Closes:** [#539](https://github.com/taoyu051818-sys/lian-nest-server/issues/539)

---

## Overview

A zero-dependency Node.js server (built-in modules only) that reads the
provider pool policy and state files and serves them as a dashboard plus JSON
API endpoints. The server binds to `127.0.0.1` only — it is not accessible
from the network.

---

## Usage

```bash
# Start with defaults (port 4179)
node tools/provider-pool-webui/server.js

# Custom port
node tools/provider-pool-webui/server.js --port 8080

# Help
node tools/provider-pool-webui/server.js --help
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | Normal shutdown |
| `1`  | Port already in use |
| `2`  | Usage error (bad arguments) |

---

## Endpoints

| Method | Path | Content-Type | Description |
|--------|------|-------------|-------------|
| GET | `/` | `text/html` | Dashboard (single-page HTML) |
| GET | `/api/state` | `application/json` | Sanitized provider pool state |
| GET | `/api/policy` | `application/json` | Policy with secrets stripped |
| GET | `/api/health` | `application/json` | Server health check |

### `/api/state`

Returns the contents of `.github/ai-state/provider-pool.json` as-is. This file
is already sanitized (no secrets).

### `/api/policy`

Returns the contents of `.github/ai-policy/provider-pool-policy.json` with
`sourcePath` and `secretSources` fields removed. The raw policy file may
contain local filesystem paths that should not be exposed.

### `/api/health`

```json
{ "ok": true, "uptime": 123.456 }
```

---

## Security Model

| Constraint | Enforcement |
|------------|------------|
| Local-only binding | Server listens on `127.0.0.1`, not `0.0.0.0` |
| No secrets served | Policy endpoint strips `sourcePath` and `secretSources` |
| State file is pre-sanitized | `provider-pool.json` never contains secrets by design |
| Read-only | No POST/PUT/DELETE endpoints |

---

## Dashboard

The HTML dashboard at `/` shows:

- Summary cards: available, exhausted, disabled providers, active workers,
  global max
- Provider table: id, status, concurrency, failure count, cooldown expiry

The dashboard fetches `/api/state` on load and renders inline — no external
CDN dependencies.

---

## Files

| File | Purpose |
|------|---------|
| `tools/provider-pool-webui/server.js` | Server implementation |
| `docs/ai-native/provider-pool-webui-server.md` | This document |
| `.github/ai-policy/provider-pool-policy.json` | Provider policy (read-only) |
| `.github/ai-state/provider-pool.json` | Provider state (read-only) |

---

## References

- [Provider Pool](provider-pool.md) — full architecture
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch validation
