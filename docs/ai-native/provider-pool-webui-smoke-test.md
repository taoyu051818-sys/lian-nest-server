# Provider Pool WebUI Smoke Test

Smoke test for the local-only Provider Pool WebUI server (`tools/provider-pool-webui/server.js`).

> **Closes:** #609

---

## Purpose

Validates that the WebUI server starts, responds correctly on all endpoints, handles errors gracefully, and does not leak secrets. Runs as a standalone Node.js script with no external test framework.

---

## What is tested

### CLI behaviour

| Input | Expected exit code | Assertion |
|---|---|---|
| `--help` | 0 | Prints usage, mentions `--port`, `--help`, and endpoints |
| `--unknown-flag` | 2 | stderr includes "unknown flag" |
| `--port not-a-number` | 2 | stderr includes "valid port" |
| `--port 0` | 2 | Port out of range |
| `--port 99999` | 2 | Port out of range |
| port already in use | 1 | stderr includes "already in use" |

### HTTP endpoints

| Endpoint | Expected status | Key assertions |
|---|---|---|
| `GET /` | 200 | Content-Type text/html, contains "Provider Pool Dashboard" |
| `GET /index.html` | 200 | Alias for `/` |
| `GET /api/health` | 200 | `{ ok: true, uptime: <number> }` |
| `GET /api/state` | 200 or 503 | 200: JSON with `providers` array; 503: when state file missing |
| `GET /api/policy` | 200 or 503 | 200: `sourcePath` and `secretSources` stripped; 503: when policy file missing |
| `GET /api/unknown` | 404 | `{ error: "Not found" }` |

### Security headers

All responses include:
- `X-Content-Type-Options: nosniff`
- `Access-Control-Allow-Origin` header present

---

## Running

```bash
node tools/provider-pool-webui/server.test.js
```

Exit code 0 = all tests pass. Exit code 1 = one or more failures.

---

## Architecture

```
server.test.js
  |
  +-- CLI tests (execSync, no server process needed)
  |     |-- --help flag
  |     |-- --unknown-flag
  |     |-- invalid port values
  |
  +-- EADDRINUSE test
  |     |-- binds a port with net.createServer
  |     |-- starts server.js on same port
  |     |-- asserts exit code 1
  |
  +-- HTTP tests (starts server on ephemeral port)
        |-- GET /
        |-- GET /index.html
        |-- GET /api/health
        |-- GET /api/state
        |-- GET /api/policy
        |-- GET unknown route
        |-- security headers
```

Uses ephemeral ports (`port: 0`) to avoid collisions in parallel CI runs.

---

## Design decisions

- **No external test framework**: follows the self-contained `*.test.js` pattern used by all 18 existing test scripts under `scripts/`.
- **Spawned server process**: `server.js` has no exports and auto-binds on import, so it must be tested as a child process.
- **Ephemeral port**: avoids `EADDRINUSE` when multiple test runners execute concurrently.
- **Tolerates missing data files**: `/api/state` and `/api/policy` accept both 200 (file exists) and 503 (file missing) so the test runs in any environment.

---

## References

- [provider-pool-webui-server.md](provider-pool-webui-server.md) — server implementation doc
- [provider-pool-webui-security.md](provider-pool-webui-security.md) — security model
- [provider-pool-webui-api.md](provider-pool-webui-api.md) — API contract
