# WebUI Console End-to-End Smoke Test

End-to-end smoke test for the full WebUI console — dashboard, planning-loop
endpoints, action preview/execute flow, audit trail, and secret isolation.

> **Closes:** #696, #886

---

## Purpose

Validates that the WebUI console is operationally ready: the server starts,
all API endpoints are reachable, the dashboard renders, planning-loop data
is visible, action preview works without mutations, execute refusal blocks
unconfirmed actions, and no secrets leak through any endpoint.

Runs as a standalone Node.js script with no external test framework.

---

## What is tested

### Dashboard

| Assertion | Description |
|---|---|
| `GET /` returns 200 | Dashboard serves HTML |
| Content-Type is text/html | Correct MIME type |
| Contains "Provider Pool Dashboard" | Title renders |
| Contains `fetch('/api/state')` | Client-side JS hits state API |
| `GET /index.html` returns 200 | Alias works |

### Health

| Assertion | Description |
|---|---|
| `GET /api/health` returns 200 | Health endpoint responds |
| `ok: true` | Server is healthy |
| `uptime` is a number | Uptime is tracked |
| Minimal fields (<=3) | No extra data leaked |

### Planning loop visibility

| Endpoint | Key assertions |
|---|---|
| `GET /api/state` | JSON object with `providers` array and `global` summary |
| `GET /api/workers` | `workers` array, `summary.totalActive` count |
| `GET /api/resources` | `concurrency`, `utilization.percentage`, valid `level` |
| `GET /api/queue` | `entries` array, `summary.queued` count |
| `GET /api/policy` | Secrets stripped (`sourcePath`, `secretSources` removed) |

### Action registry

| Assertion | Description |
|---|---|
| `GET /api/actions` returns 200 | Actions list endpoint works |
| Actions array present | Response has `actions` array |
| Action shape valid | Each action has `id`, `label`, `description`, `dangerous` |

### Action preview (dry-run)

| Input | Expected status | Description |
|---|---|---|
| Missing `actionId` | 400 | Error: "Missing actionId" |
| Unknown `actionId` | 404 | Error: "not found" |
| Invalid JSON body | 400 | Malformed request rejected |

### Execute refusal

| Input | Expected status | Description |
|---|---|---|
| Missing `actionId` | 400 | Error: "Missing actionId" |
| Unknown `actionId` | 404 | Error: "not found" |

### Audit trail

| Assertion | Description |
|---|---|
| `GET /api/audit` returns 200 | Audit endpoint responds |
| `entries` array present | Response has entries array |
| `total` is a number | Count is numeric |

### Audit filters

| Query | Expected status | Description |
|---|---|---|
| `?actionId=provider-rotation` | 200 | Filter by action ID |
| `?status=success` | 200 | Filter by status |
| `?limit=5` | 200 | Limit result count |
| `?limit=abc` | 400 | Invalid limit rejected |
| `?actionId=compile-tasks&status=success&limit=10` | 200 | Combined filters; response includes `filters` object echoing `actionId`, `status`, `limit` |

### Planning endpoint

| Assertion | Description |
|---|---|
| `GET /api/planning` returns 200 or 503 | Planning endpoint responds |
| Returns JSON object | Valid response shape |
| If `launchPlan` present: `selectedTasks` is array or undefined | Launch plan shape |
| If `launchPlan` present: `rejectedTasks` is array or undefined | Rejected tasks shape |
| If `launchPlan` present: `locksAcquired` is array or undefined | Locks shape |
| If `launchPlan` present: `allAllowed` is boolean or undefined | All-allowed flag |

### Secret isolation

All endpoints are scanned for patterns that should never appear:

- `sk-ant-*` (Anthropic API keys)
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (env var names)
- `ghp_*` / `gho_*` (GitHub tokens)
- `Bearer <token>` patterns
- `-----BEGIN.*PRIVATE KEY-----` (private keys)

Endpoints checked: health, state, policy, workers, resources, queue, actions, planning, audit, dashboard HTML.

### Security headers

| Header | Expected value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `Access-Control-Allow-Origin` | `http://127.0.0.1` (not `*`) |

### Localhost binding

Server responds on `127.0.0.1` — confirms loopback-only binding.

### Unknown route

`GET /api/nonexistent` returns 404 with `{ error: "Not found" }`.

### Confirmation copy enhancement

Reads static source files from disk to verify the confirmation warning UI infrastructure:

**`public/app.js` checks:**

| Assertion | Description |
|---|---|
| Contains `RISK_DESCRIPTIONS` map | Risk descriptions for dangerous actions |
| Contains `confirmationWarningBanner` function | Warning banner rendering |
| References `confirm-warning` CSS class | CSS class linkage |
| References `execute-confirm__reason` classes | Reason input styling |
| `RISK_DESCRIPTIONS` includes `provider.retry`, `provider.disable`, `queue.clearStale`, `global.refreshState` | Key risk entries present |
| Prompt includes `"to confirm execution of"` | Action label context in confirmation |
| Has `needsReason` validation logic | Reason input required for some actions |
| Has `validateConfirm` function | Confirmation validation |

**`public/styles.css` checks:**

| Assertion | Description |
|---|---|
| Contains `confirm-warning--high` style | High-risk visual treatment |
| Contains `confirm-warning--medium` style | Medium-risk visual treatment |
| Contains `confirm-warning__body` style | Banner body layout |
| Contains `confirm-warning__notice` style | Notice text styling |
| Contains `execute-confirm__reason` style | Reason input styling |
| Contains `confirm-warning__icon` style | Icon styling |

### Console readiness

All 9 API endpoints (`health`, `state`, `policy`, `workers`, `resources`, `queue`, `actions`, `audit`, `planning`) respond with 200 or 503 — none return unexpected error codes.

---

## Running

```bash
node tools/provider-pool-webui/console-smoke.test.js
```

Exit code 0 = all tests pass. Exit code 1 = one or more failures.

---

## Architecture

```
console-smoke.test.js
  |
  +-- Start server on ephemeral port
  |
  +-- 1. Dashboard
  |     GET / and /index.html
  |
  +-- 2. Health
  |     GET /api/health
  |
  +-- 3. Planning loop visibility
  |     GET /api/state
  |     GET /api/workers
  |     GET /api/resources
  |     GET /api/queue
  |     GET /api/policy
  |
  +-- 4. Action registry
  |     GET /api/actions
  |
  +-- 5. Action preview
  |     POST /api/actions/preview (missing/unknown/bad JSON)
  |
  +-- 6. Execute refusal
  |     POST /api/actions/execute (missing/unknown)
  |
  +-- 7. Audit trail
  |     GET /api/audit
  |
  +-- 8. Audit filters
  |     GET /api/audit?actionId=...
  |     GET /api/audit?status=...
  |     GET /api/audit?limit=... (valid + invalid)
  |     GET /api/audit?combined filters
  |
  +-- 9. Planning endpoint
  |     GET /api/planning
  |
  +-- 10. Secret isolation
  |     Scan all endpoint responses for secret patterns
  |
  +-- 11. Security headers
  |     X-Content-Type-Options, CORS
  |
  +-- 12. Localhost binding
  |     Verify 127.0.0.1 responds
  |
  +-- 13. Unknown route
  |     GET /api/nonexistent -> 404
  |
  +-- 14. Confirmation copy enhancement
  |     Verify app.js risk descriptions + styles.css classes
  |
  +-- 15. Console readiness
  |     All 9 endpoints reachable (200 or 503)
  |
  +-- Stop server, print summary
```

---

## Design decisions

- **No external test framework**: follows the self-contained `*.test.js` pattern used across the project.
- **Spawned server process**: `server.js` has no exports and auto-binds on import, so it must be tested as a child process.
- **Ephemeral port**: avoids `EADDRINUSE` when multiple test runners execute concurrently.
- **Tolerates missing data files**: `/api/state`, `/api/policy`, `/api/workers`, `/api/resources` accept both 200 and 503 so the test runs in any environment.
- **No mutations**: all action tests use preview/missing-id paths; no execute calls are made with valid actionIds.
- **Secret pattern scanning**: validates that no endpoint response contains known secret patterns, not just that specific fields are stripped.

---

## References

- [Provider Pool WebUI Smoke Test](provider-pool-webui-smoke-test.md) — base server smoke test
- [Provider Pool WebUI Action Smoke Tests](provider-pool-webui-action-smoke-tests.md) — action module smoke tests
- [Provider Pool WebUI Operation Console](provider-pool-webui-operation-console.md) — console design
- [Provider Pool WebUI API](provider-pool-webui-api.md) — API contract
- [Provider Pool WebUI Security](provider-pool-webui-security.md) — security model
