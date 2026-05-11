# WebUI Action Modules Test Suite

Integration tests verifying the WebUI server's action module loading, preview/execute
endpoints, dangerous-action confirmation flow, audit trail, and secret sanitization.

> **Closes:** #685

---

## Purpose

The WebUI server loads action modules from `tools/provider-pool-webui/actions/` at
startup and exposes them via `/api/actions`, `/api/actions/preview`, and
`/api/actions/execute`. These tests confirm that:

- Modules are discovered and validated (must export `id` and `label`)
- Broken and invalid modules are silently skipped
- Preview returns dry-run results without side effects
- Execute performs mutations and writes audit entries
- Dangerous actions require explicit `confirm: true`
- Secrets in action results are redacted before response or audit
- Non-`.js` files in the actions directory are ignored

---

## What is tested

### Module discovery

| Check | Assertion |
|-------|-----------|
| Valid modules loaded | 5 fixture modules discovered |
| Broken module skipped | `throw` on require is silently ignored |
| Missing `id` skipped | Module without `id` not included |
| Missing `label` skipped | Module without `label` not included |
| Non-`.js` file ignored | `.txt` file in actions dir not loaded |

### Module shape

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique identifier |
| `label` | string | Human-readable name |
| `description` | string | May be empty |
| `dangerous` | boolean | Requires confirmation if true |

### Preview endpoint (`POST /api/actions/preview`)

| Scenario | Status | Key assertion |
|----------|--------|---------------|
| Safe action | 200 | `dryRun: true`, preview data returned |
| Dangerous action | 200 | Preview works without confirmation |
| No preview function | 200 | `preview: null`, message explains |
| Missing actionId | 400 | Error message |
| Unknown actionId | 404 | Error message |
| Invalid JSON body | 400 | Error message |

### Execute endpoint (`POST /api/actions/execute`)

| Scenario | Status | Key assertion |
|----------|--------|---------------|
| Safe action | 200 | `ok: true`, result returned, audit written |
| Dangerous without confirm | 409 | `dangerous: true` in response |
| Dangerous with confirm | 200 | `ok: true`, proceeds |
| No execute function | 400 | Error explains |
| Missing actionId | 400 | Error message |
| Unknown actionId | 404 | Error message |

### Sanitization

| Check | Assertion |
|-------|-----------|
| `apiKey` in preview | Redacted to `***REDACTED***` |
| `apiKey` in execute | Redacted to `***REDACTED***` |
| Raw key in response body | Absent |
| Raw key in audit log | Absent |

### Audit trail

| Check | Assertion |
|-------|-----------|
| Execute writes entry | Entry present after execute |
| Entry shape | Has `id`, `actionId`, `status`, `startedAt`, `completedAt` |
| Preview does not write | No entry after preview |
| Secret in audit payload | Redacted |

---

## Fixture modules

The test creates temporary fixture modules in `tools/provider-pool-webui/actions/`
and cleans them up after the run.

| File | `id` | Purpose |
|------|------|---------|
| `test-safe-action.js` | `test.safe.action` | Safe action with preview + execute |
| `test-dangerous-action.js` | `test.dangerous.action` | Dangerous action (requires confirm) |
| `test-preview-only.js` | `test.preview.only` | Has `preview()` only, no `execute()` |
| `test-execute-only.js` | `test.execute.only` | Has `execute()` only, no `preview()` |
| `test-secret-action.js` | `test.secret.action` | Returns `apiKey` for redaction testing |
| `test-broken.js` | — | Throws on require (skipped) |
| `test-no-id.js` | — | No `id` export (skipped) |
| `test-no-label.js` | — | No `label` export (skipped) |
| `test-readme.txt` | — | Non-`.js` file (ignored) |

---

## Running

```bash
node tools/provider-pool-webui/action-modules.test.js
```

Exit code 0 = all tests pass. Exit code 1 = one or more failures.

**Note:** This test creates and removes `tools/provider-pool-webui/actions/` at runtime.
Run it before `server.test.js` (which expects the actions directory to be absent or empty).

---

## Architecture

```
action-modules.test.js
  |
  +-- Setup: create fixture modules in actions/ dir
  |
  +-- Module discovery tests
  |     |-- GET /api/actions: 5 valid modules loaded
  |     |-- Broken/invalid modules silently skipped
  |     |-- Non-.js files ignored
  |
  +-- Preview endpoint tests
  |     |-- Safe action: 200, dryRun: true, preview data
  |     |-- Dangerous action: 200, no confirmation needed
  |     |-- No preview function: 200, null preview
  |     |-- Error handling: 400/404 for bad requests
  |
  +-- Execute endpoint tests
  |     |-- Safe action: 200, ok: true, audit entry
  |     |-- Dangerous without confirm: 409
  |     |-- Dangerous with confirm: 200
  |     |-- No execute function: 400
  |     |-- Error handling: 400/404 for bad requests
  |
  +-- Sanitization tests
  |     |-- apiKey redacted in preview response
  |     |-- apiKey redacted in execute response
  |     |-- No raw secrets in response bodies
  |
  +-- Audit trail tests
  |     |-- Execute writes audit entry with correct shape
  |     |-- Preview does NOT write audit entry
  |     |-- Secrets in audit payload are redacted
  |
  +-- Cleanup: remove fixture modules and audit log
```

---

## Design decisions

- **Fixture-based**: test creates real `.js` modules in the actions directory rather
  than mocking `require()`, so it exercises the full server loading path.
- **Cleanup in finally**: fixtures and audit log are always cleaned up, even on failure.
- **Pre-cleanup**: any leftover fixtures from a previous failed run are removed before setup.
- **No real mutations**: fixture `execute()` functions return static objects; they do not
  touch state files or run scripts.
- **Same test pattern**: uses the same `assert`/`passed`/`failed` pattern as all other
  `*.test.js` scripts in the WebUI directory.

---

## References

- [provider-pool-webui-action-smoke-tests.md](provider-pool-webui-action-smoke-tests.md) — read-only smoke tests
- [provider-pool-webui-api.md](provider-pool-webui-api.md) — API contract
- [provider-pool-webui-security.md](provider-pool-webui-security.md) — security model
- [provider-pool-webui-architecture.md](provider-pool-webui-architecture.md) — architecture overview
