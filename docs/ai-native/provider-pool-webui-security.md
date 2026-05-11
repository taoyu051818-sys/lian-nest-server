# Provider Pool WebUI Security Model

Defines the security boundaries for the provider pool local WebUI:
localhost-only binding, admin token authentication, no-secret-logging
rules, and worker secret isolation.

> **Closes:** [#533](https://github.com/taoyu051818-sys/lian-nest-server/issues/533)

---

## Overview

The provider pool WebUI is a local-only administrative interface for
viewing and managing provider pool state. It is never exposed to the
network, never logs secrets, and enforces strict isolation between
worker secret sources and the UI layer.

```
┌─────────────────────────────────────────────────────────┐
│  Local Machine (127.0.0.1)                              │
│                                                         │
│  ┌──────────────────┐    ┌────────────────────────────┐ │
│  │  WebUI Server     │    │  Worker Processes          │ │
│  │  :3210 (loopback) │    │                            │ │
│  │                   │    │  Each worker has its own   │ │
│  │  admin token gate │    │  secret source — never     │ │
│  │  no secret logs   │    │  shared with WebUI         │ │
│  └──────┬───────────┘    └────────────────────────────┘ │
│         │                                               │
│         ▼                                               │
│  ┌──────────────────┐                                   │
│  │  Provider State   │                                   │
│  │  (sanitized)      │                                   │
│  │  no secrets       │                                   │
│  └──────────────────┘                                   │
└─────────────────────────────────────────────────────────┘
```

---

## Localhost Binding

The WebUI server MUST bind exclusively to the loopback interface.

| Requirement | Value | Rationale |
|-------------|-------|-----------|
| Bind address | `127.0.0.1` | Not reachable from network or LAN |
| IPv6 fallback | `::1` | Loopback-only if IPv6 is enabled |
| Default port | `3210` | Non-privileged, avoids common ports |
| Allowed overrides | `WEBUI_HOST` env var | Must still resolve to loopback |

### Enforcement

- The server MUST reject any bind attempt on `0.0.0.0`, `*`, or a
  non-loopback address at startup.
- If `WEBUI_HOST` is set to a non-loopback address, the server MUST
  exit with an error and a clear message.
- The server SHOULD log the bound address at startup for operator
  verification.

```
[webui] Listening on http://127.0.0.1:3210 (loopback only)
```

### Firewall is Not Sufficient

Binding to loopback is a **code-level** guarantee. It does not depend
on firewall rules, which can be changed independently. The security
boundary is enforced in the application itself.

---

## Admin Token Authentication

All WebUI endpoints require a valid admin token. There is no anonymous
access.

### Token Source

| Source | Priority | Notes |
|--------|:--------:|-------|
| `PROVIDER_POOL_ADMIN_TOKEN` env var | 1 (highest) | Standard env injection |
| `.github/ai-state/.webui-token` file | 2 | Generated at startup if not env-provided |

The token MUST NOT be hardcoded, committed to the repo, or derivable
from public information.

### Token Validation

```
Request arrives
    │
    ├── Authorization header present?
    │   ├── Yes → extract Bearer token
    │   └── No  → 401 Unauthorized
    │
    ├── Token matches stored admin token?
    │   ├── Yes → proceed to endpoint
    │   └── No  → 403 Forbidden
    │
    └── Log: "admin request accepted" (never log the token)
```

### Token Rotation

- On each WebUI server start, if no `PROVIDER_POOL_ADMIN_TOKEN` env
  var is set, a random 32-character token is generated and written to
  `.github/ai-state/.webui-token`.
- The token file is gitignored and MUST NOT be committed.
- Rotating the token requires restarting the WebUI server.

### Rate Limiting

The WebUI SHOULD apply a simple rate limit to the authentication
endpoint:

| Limit | Window | Action |
|-------|--------|--------|
| 10 failed attempts | 5 minutes | Block source IP for 15 minutes |

Since the server is loopback-only, "source IP" is always `127.0.0.1`.
The rate limit protects against local process abuse, not network attacks.

---

## No-Secret-Logging Rules

The WebUI MUST NEVER log, display, or transmit secrets.

### Forbidden Log Content

| Data | Status | Example of Violation |
|------|--------|---------------------|
| API keys | NEVER logged | `ANTHROPIC_API_KEY=sk-ant-...` |
| Admin tokens | NEVER logged | `token: abc123...` |
| Provider credentials | NEVER logged | `using credential for provider-X` |
| Raw provider responses with account info | NEVER logged | Response headers with `x-ratelimit-*` |
| `.env` file contents | NEVER logged | `loading .env: KEY=VALUE` |
| Worker secret sources | NEVER logged | `secret from C:\Users\...` |

### Allowed Log Content

| Data | Status | Example |
|------|--------|---------|
| Provider id | OK to log | `provider-default selected` |
| Provider status | OK to log | `provider-default: available (0/1)` |
| Request path | OK to log | `GET /api/providers 200` |
| Auth result (no token) | OK to log | `admin auth failed (invalid token)` |
| Aggregated counts | OK to log | `pool: 2 available, 1 exhausted` |

### Log Scrubbing

If a log message might contain a secret (e.g., from a provider error
response), the WebUI MUST scrub it before writing:

```
raw:  "Provider error: invalid api key sk-ant-abc123..."
safe: "Provider error: invalid api key [REDACTED]"
```

---

## Worker Secret Isolation

Workers and the WebUI use completely separate secret paths. There is no
shared secret state between them.

### Isolation Model

```
Worker A                    WebUI                    Worker B
    │                         │                         │
    ├── reads its own         ├── reads admin token     ├── reads its own
    │   secret source         │   (never worker         │   secret source
    │   (env var or           │    secrets)             │   (env var or
    │    credential mgr)      │                         │    credential mgr)
    │                         │                         │
    ├── uses secret for       ├── displays sanitized    ├── uses secret for
    │   API calls             │   provider state        │   API calls
    │                         │                         │
    ├── records provider id   ├── records provider id   ├── records provider id
    │   in telemetry (safe)   │   in UI logs (safe)     │   in telemetry (safe)
    │                         │                         │
    └── NEVER exposes         └── NEVER reads           └── NEVER exposes
        secret to WebUI           worker secrets             secret to WebUI
```

### Guarantees

| Guarantee | Enforcement |
|-----------|-------------|
| WebUI cannot read worker secrets | WebUI only accesses `provider-pool.json` (sanitized state) and admin token |
| Workers cannot read admin token | Workers receive `LIAN_PROVIDER_ID` env var, not the admin token |
| No shared secret file | Workers read from credential manager / env; WebUI reads from its own token source |
| Secret never crosses boundary | Even on error, worker secret is not passed to WebUI error handler |

### Failure Isolation

If a worker fails due to a secret/credential issue (401, 403):

1. The worker records the failure class (`auth`) in telemetry.
2. The state updater marks the provider as `disabled`.
3. The WebUI displays the provider as `disabled` with no credential details.
4. The admin sees "provider-X: disabled (auth failure)" — never the
   failing key or token.

---

## Deployment Checklist

Before running the WebUI in any environment:

- [ ] `PROVIDER_POOL_ADMIN_TOKEN` is set as an env var (or auto-generation is accepted)
- [ ] No secrets are present in `provider-pool.json` or `provider-pool-policy.json`
- [ ] The WebUI port (3210) is not forwarded or proxied to external interfaces
- [ ] `.github/ai-state/.webui-token` is gitignored
- [ ] Log output is directed to a local file or stdout, not a shared log aggregator

---

## Threat Model

| Threat | Mitigation | Residual Risk |
|--------|------------|---------------|
| Network exposure | Loopback-only binding | None (code-enforced) |
| Brute-force admin token | Rate limiting + random 32-char token | Low (local process only) |
| Secret leak in logs | No-secret-logging policy + scrubbing | Low (requires code review) |
| Worker secret theft via WebUI | Complete isolation of secret paths | None (no shared state) |
| Token committed to repo | Gitignore + CI check for `.webui-token` | Low (human error) |
| Local process reads token file | File permissions (owner-only read) | Low (single-user machine) |

---

## References

- [Provider Pool](provider-pool.md) — full architecture and planning doc
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch validation
- [Worker Permissions](worker-permissions.md) — provider-pool worker class
- [Worker Trust](worker-trust.md) — trust score model for scheduling
- [Self-Cycle Provider Pool Preflight](self-cycle-provider-pool-preflight.md) — pre-cycle availability check
