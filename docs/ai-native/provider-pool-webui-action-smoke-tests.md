# Provider Pool WebUI Action Smoke Tests

Smoke tests verifying the WebUI server correctly refuses all write operations,
redacts secrets from responses, and binds to localhost only.

> **Closes:** #657

---

## Purpose

The provider pool WebUI is a read-only dashboard. These smoke tests confirm
that no action/mutation endpoint exists and that all write HTTP methods
(POST, PUT, DELETE) are refused with 404. They also verify audit redaction
(no secrets in responses) and localhost-only binding.

---

## What is tested

### Action list (write method refusal)

| Method | Path | Expected | Rationale |
|--------|------|----------|-----------|
| `POST` | `/api/actions` | 404 | No action list endpoint |
| `POST` | `/api/actions/preview` | 404 | No preview endpoint |
| `POST` | `/api/actions/execute` | 404 | No execute endpoint |

### Preview refusal (POST to read-only routes)

| Method | Path | Expected | Rationale |
|--------|------|----------|-----------|
| `POST` | `/` | 404 | Dashboard is read-only |
| `POST` | `/api/state` | 404 | State is read-only |
| `POST` | `/api/policy` | 404 | Policy is read-only |
| `POST` | `/api/queue` | 404 | Queue is read-only |

### Execute confirmation requirements

| Method | Path | Expected | Rationale |
|--------|------|----------|-----------|
| `PUT` | `/api/resources/limits` | 404 | No resource write endpoint |
| `DELETE` | `/api/workers/:id` | 404 | No worker delete endpoint |
| `POST` | `/api/assignments` | 404 | No assignment creation endpoint |
| `POST` | `/api/state` | 404 | No state mutation |
| `POST` | `/api/policy` | 404 | No policy mutation |
| `POST` | `/api/health` | 404 | No health mutation |
| `POST` | `/api/workers` | 404 | No worker mutation |
| `POST` | `/api/resources` | 404 | No resource mutation |
| `POST` | `/api/queue` | 404 | No queue mutation |

### Audit redaction

| Check | Condition | Assertion |
|-------|-----------|-----------|
| `sourcePath` stripped | Policy file present | No provider exposes `sourcePath` |
| `secretSources` stripped | Policy file present | Top-level `secretSources` absent |
| No raw API keys | Policy file present | `sk-ant-` pattern absent from response |
| No env var names | Policy file present | `ANTHROPIC_API_KEY` absent from response |
| No API keys in state | State file present | `sk-ant-` and `apiKey` absent |
| No token in state | State file present | No `token` field (except cooldown timers) |
| Health leaks nothing | Always | Only `ok` and `uptime` fields present |

### Localhost-only binding

| Check | Assertion |
|-------|-----------|
| CORS origin | `http://127.0.0.1` (not `*`) |
| Server responds on loopback | `GET /api/health` returns 200 on `127.0.0.1` |

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
  |
  +-- EADDRINUSE test
  |
  +-- HTTP endpoint tests (starts server on ephemeral port)
  |     |-- GET /, /index.html, /api/health, /api/state, /api/policy
  |     |-- GET unknown route
  |     |-- security headers
  |
  +-- Action API smoke tests
  |     |-- POST /api/actions, /api/actions/preview, /api/actions/execute
  |     |-- POST to all read-only routes
  |     |-- PUT /api/resources/limits
  |     |-- DELETE /api/workers/:id
  |     |-- POST /api/assignments
  |     |-- POST to all API routes (bulk write refusal)
  |
  +-- Audit redaction smoke tests
  |     |-- Policy response: no sourcePath, secretSources, sk-ant-, ANTHROPIC_API_KEY
  |     |-- State response: no sk-ant-, apiKey, token
  |     |-- Health response: only ok/uptime fields
  |
  +-- Localhost-only binding smoke tests
        |-- CORS origin is http://127.0.0.1 (not *)
        |-- Server responds on loopback address
```

---

## Design decisions

- **No server behavior changes**: tests verify existing read-only contract of server.js.
- **Write methods hit 404**: server.js only registers GET routes; POST/PUT/DELETE fall through to the 404 catch-all.
- **Audit redaction tolerance**: when state or policy files are missing (503), redaction checks are skipped gracefully.
- **No external dependencies**: uses the same self-contained test pattern as all other `*.test.js` scripts.

---

## References

- [provider-pool-webui-smoke-test.md](provider-pool-webui-smoke-test.md) — base smoke test doc
- [provider-pool-webui-readonly-mode.md](provider-pool-webui-readonly-mode.md) — read-only mode contract
- [provider-pool-webui-security.md](provider-pool-webui-security.md) — security model
- [provider-pool-webui-api.md](provider-pool-webui-api.md) — API contract
