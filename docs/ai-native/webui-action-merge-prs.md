# WebUI Action: merge-prs

Action module for merging an explicit allowlist of PRs through the WebUI
control console. Wraps `webui-merge-control.ps1` with enforced safety
defaults.

> **Closes:** [#681](https://github.com/taoyu051818-sys/lian-nest-server/issues/681)
> **Addresses:** [#879](https://github.com/taoyu051818-sys/lian-nest-server/issues/879)

---

## Purpose

Provides a WebUI action entry point for controlled PR merges. The module
is loaded by the server from `tools/provider-pool-webui/actions/` and
exposed via the standard action API (`/api/actions/preview` and
`/api/actions/execute`).

Key safety properties:

- **Dangerous** — execute requires `confirm: true`
- **Explicit allowlist only** — never discovers or guesses PRs
- **Preview-first** — dry-run mode shows what would happen
- **Health gate** — post-merge health check runs by default
- **Sanitized output** — no raw stdout/stderr or secrets in responses

---

## Module Contract

```js
{
  id: "merge-prs",
  label: "Merge PRs",
  description: "Merge an explicit allowlist of PRs with health gate and guard checks.",
  dangerous: true,
  preview(payload) { ... },
  execute(payload) { ... },
}
```

---

## Payload

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prNumbers` | `number[]` | yes | Array of positive integer PR numbers |
| `repo` | `string` | no | Repository in `OWNER/NAME` format (falls back to `GH_REPO` env) |

### Validation

- `prNumbers` must be a non-empty array of positive integers
- `repo` must match `OWNER/NAME` format if provided
- If `repo` is omitted, `GH_REPO` environment variable is used

### Allowlist Rules

- Each PR number is validated individually — no wildcard discovery
- No `*` or `all` keyword — any attempt to merge all PRs is rejected
- Empty `prNumbers` array is rejected
- Negative numbers, zero, floats, and non-integer values are rejected
- No upper bound on the count; 100+ entries are accepted

---

## Preview

`POST /api/actions/preview`

```json
{
  "actionId": "merge-prs",
  "payload": {
    "prNumbers": [42, 45],
    "repo": "owner/repo"
  }
}
```

Runs `webui-merge-control.ps1` in dry-run mode (no `-Execute` flag).
Returns what would happen without performing any merges.

**Response:**

```json
{
  "actionId": "merge-prs",
  "label": "Merge PRs",
  "description": "...",
  "preview": {
    "ok": true,
    "mode": "preview",
    "prNumbers": [42, 45],
    "repository": "owner/repo",
    "healthGate": "skipped",
    "guards": "skipped",
    "manifest": { ... },
    "message": "Dry-run preview completed. No PRs were merged. Pass confirm:true to execute."
  },
  "dryRun": true
}
```

---

## Execute

`POST /api/actions/execute`

```json
{
  "actionId": "merge-prs",
  "payload": {
    "prNumbers": [42, 45],
    "repo": "owner/repo"
  },
  "confirm": true
}
```

Runs `webui-merge-control.ps1` with `-Execute -Force`. The `confirm: true`
flag is required because the module is marked `dangerous`.

**Response (success):**

```json
{
  "ok": true,
  "auditId": "audit-...",
  "result": {
    "ok": true,
    "mode": "execute",
    "prNumbers": [42, 45],
    "repository": "owner/repo",
    "healthGate": "pass",
    "guards": "pass",
    "manifest": { ... },
    "message": "Merge batch completed for PRs: 42, 45"
  }
}
```

**Response (failure):**

```json
{
  "ok": true,
  "auditId": "audit-...",
  "result": {
    "ok": false,
    "mode": "execute",
    "prNumbers": [42, 45],
    "repository": "owner/repo",
    "error": "Merge failed",
    "manifest": { ... }
  }
}
```

**Response (missing confirmation — HTTP 409):**

```json
{
  "error": "This action is marked dangerous. Set confirm: true to proceed.",
  "actionId": "merge-prs",
  "dangerous": true
}
```

---

## Underlying Script

The module calls `scripts/ai/webui-merge-control.ps1` via `pwsh`:

- **Preview mode:** `pwsh -File webui-merge-control.ps1 -PRs 42,45 -Repo owner/repo -Force`
- **Execute mode:** `pwsh -File webui-merge-control.ps1 -PRs 42,45 -Repo owner/repo -Force -Execute`

The `-Force` flag skips the interactive confirmation prompt (the WebUI
handles confirmation via the `confirm: true` payload field).

---

## Security

| Rule | Enforcement |
|------|-------------|
| Dangerous flag | `dangerous: true` — server rejects execute without `confirm: true` |
| Explicit allowlist | Module validates PR numbers; no wildcard discovery |
| No raw stderr | Error messages are sanitized; raw stderr is never returned |
| No secrets | Module source and output contain no API keys or tokens |
| Audit trail | Server logs all executions with sanitized payloads |
| Manifest extraction | Only structured JSON manifest is returned, not raw script output |

---

## Gate Markers

The manifest includes two gate fields with four possible values each:

| Field | Values | Meaning |
|-------|--------|---------|
| `healthGate` | `"skipped"` | Preview mode or health gate disabled |
| | `"pass"` | All health checks passed |
| | `"fail"` | One or more health checks failed |
| | `"unknown"` | Health gate result could not be determined |
| `guards` | `"skipped"` | Preview mode or guards disabled |
| | `"pass"` | All blocking guards passed |
| | `"fail"` | One or more blocking guards failed |
| | `"unknown"` | Guard result could not be determined |
| `mode` | `"dry-run"` | Preview mode — no merges performed |
| | `"execute"` | Execute mode — merges performed |
| | `"aborted"` | Execution aborted (e.g. confirmation refused) |

---

## Guard Inventory

Seven guards run during execute mode. Blocking guards fail-closed; non-blocking emit warnings only.

| Guard | Blocking | Required Input |
|-------|----------|----------------|
| Explicit allowlist | Yes | `-PRs` or `-AllowlistFile` |
| Task boundary | Yes | `.ai/task-manifest.json` |
| PR handoff | Yes | PR body |
| Generated Prisma freshness | Yes | PR changed files |
| Secret scan | Yes | PR changed files |
| Forbidden files | Yes | PR changed files |
| Docs authority | No (warn) | `docs/` directory |

Guards are skipped silently when their required inputs are missing.

---

## Health Gate

The health gate runs automatically in execute mode (skipped in preview).

**Quick mode** (default):

1. `npm run check` — TypeScript type-check
2. `npm run build` — NestJS build
3. `npx prisma validate` — only if `prisma/schema.prisma` exists

**Full mode** adds:

4. `npm run test:boundary` — only if boundary script exists
5. `npm test -- --runInBand` — full Jest test suite

Each check has a 120-second timeout. The pwsh subprocess itself has a 60-second timeout.

---

## Human-Required Boundaries

### Confirmation Gate

The module is `dangerous: true`. The server rejects execute calls without `confirm: true` (HTTP 409). When running without `-Force`, the script requires typing the literal string `yes` and states the action is IRREVERSIBLE.

### Agent Refusal Conditions

Agents must not:

- Execute without `confirm: true`
- Skip the interactive confirmation prompt
- Override health gate failures
- Merge PRs not in the explicit allowlist
- Bypass blocking guard checks unless explicitly instructed by a human operator

### High-Risk Paths

PRs touching these paths are classified `risk: "high"` and blocked from auto-merge:

- `src/**` — runtime code
- `prisma/**` — database schema
- `src/modules/auth/**` — auth/security
- `package.json`, `package-lock.json` — dependencies
- `scripts/merge-queue-assistant.js`, `scripts/post-merge-health-gate.js` — infrastructure

---

## Non-Goals

- No automatic PR discovery or search
- No wildcard PR merging
- No modification of the underlying merge script
- No client-side UI changes

---

## References

- [WebUI Merge Control](webui-merge-control.md) — underlying PowerShell wrapper
- [Provider Pool WebUI Actions API](provider-pool-webui-actions-api.md) — action module contract
- [WebUI Action Runner](webui-action-runner.md) — runner safety patterns
- [Merge Policy](merge-policy.md) — guard inventory, risk classification, gate markers
- [Post-Merge Health Gate](post-merge-health-gate.md) — health check details and failure categories
- [WebUI Merge Queue Action Policy](webui-merge-queue-action-policy.md) — allowlist rules and human-required boundaries
