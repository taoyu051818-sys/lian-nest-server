# WebUI Audit Retention and Filtering Policy

Defines the retention, filtering, redaction, and export policy for all
WebUI audit trails. This is the single policy reference; implementation
details live in the linked technical docs.

> **Closes:** [#1154](https://github.com/taoyu051818-sys/lian-nest-server/issues/1154)
>
> **Scope:** Policy doc only. No runtime changes.

---

## Scope

This policy covers every audit trail exposed through the WebUI:

| Trail | Source | Entry Point |
|-------|--------|-------------|
| Action audit store | `.github/ai-state/webui-action-audit.jsonl` | `GET /api/audit` |
| Command Steward audit | Session-scoped, in-memory | Steward console Audit Trail panel |
| Provider Pool audit | `tools/provider-pool-webui/.audit-log.json` | Provider UI audit tab |

All three layers share the same redaction, retention, and export rules
defined below.

---

## Local-Only Storage

| Rule | Enforcement |
|------|-------------|
| No remote shipping | Audit entries never leave the local machine |
| Loopback binding | Server binds to `127.0.0.1`; audit endpoints are not network-accessible |
| No cloud sync | No telemetry, analytics, or external logging integration |
| Local filesystem only | Audit files are written to the repo's `.github/ai-state/` directory |

The WebUI is a local operator tool. Audit data stays on the machine
where the server runs.

---

## Redaction

Every audit entry is sanitized before writing. No exceptions.

### Secret Patterns

| Pattern | Replacement |
|---------|-------------|
| `ghp_*` GitHub PATs | `[redacted-gh-token]` |
| `gho_*/ghu_*/ghs_*/ghr_*` GitHub tokens | `[redacted-gh-oauth]` / `[redacted-gh-app]` |
| `Bearer <token>` | `Bearer [redacted]` |
| `Basic <encoded>` | `Basic [redacted]` |
| AWS keys (`AKIA*`, `ASIA*`) | `[redacted-aws-key]` |
| JWT tokens (3-dot format) | `[redacted-jwt]` |
| Private key blocks | `[redacted-private-key]` |
| Base64-like strings (40+ chars) | `[redacted-token]` |

### Key-Level Redaction

Object keys matching `api_key`, `token`, `secret`, `password`,
`credential`, `auth`, or `private_key` have their values replaced with
`[redacted]` regardless of content.

### Structural Guards

| Guard | Limit | Behavior |
|-------|-------|----------|
| Max string length | 500 chars | Truncate with `[truncated]` suffix |
| Max array length | 50 items | Truncate with notice |
| Max object keys | 30 keys | Truncate with `_truncatedKeys` count |
| Raw output rejection | ANSI / stdout / stderr | Replaced with `_warning` field |
| Per-entry size | 4,096 bytes | Enforced post-sanitization |

### Never Logged

| Category | Examples |
|----------|----------|
| Passwords | Service account, user, or system passwords |
| API keys | Provider keys, `sk-*` prefixed strings |
| Tokens | PATs, OAuth tokens, JWTs, Bearer tokens |
| Private keys | PEM blocks, key file contents |
| Raw process output | stdout, stderr, ANSI escape sequences |
| Credential paths | `.env` file paths, local credential store paths |

---

## Retention Limits

| Constant | Value | Enforcement |
|----------|-------|-------------|
| `RETENTION_DAYS` | 30 | Read-time filter on `capturedAt` |
| `MAX_ENTRIES` (hard cap) | 5,000 | Write-time trim after each append |
| `MAX_ENTRIES_SOFT` | 10,000 | Operator review trigger |
| `MAX_ENTRY_BYTES` | 4,096 | Per-entry size guard |
| `MAX_STRING_LENGTH` | 500 | All string fields truncated |

### Mechanism

- The JSONL audit file is **append-only**. Entries are never modified
  after writing.
- Old entries are excluded at **read time** by filtering
  `capturedAt >= (now - 30 days)`.
- The hard cap (5,000) trims oldest entries on every write.
- The soft cap (10,000) triggers operator review — no automatic action.

### Why Read-Time Filtering

- Preserves the append-only invariant: the file is never truncated or
  modified by reads.
- Keeps audit integrity: entries are immutable once written.
- Adequate for local-only scope where file size growth is bounded.

---

## Filter Semantics

### `GET /api/audit` Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `actionId` | string | — | Exact match on action ID |
| `status` | string | — | `success` or `error` |
| `limit` | number | 20 | Max entries returned (hard cap: 500) |

### Command Steward Console Filters

The Steward console Audit Trail panel provides the same filters through
the `/api/audit` endpoint. The panel shows:

- **Timestamp** — when the action executed
- **Action** — the action ID
- **Status** — success or error
- **Target** — what was acted upon
- **Result** — outcome summary

### Filter Behavior

| Rule | Detail |
|------|--------|
| Filters are combinable | `actionId` + `status` + `limit` may be used together |
| Limit is hard-capped | Server rejects `limit > 500` |
| No cursor pagination | Offset-based limit is sufficient for local volumes |
| Entries returned in log order | Most recent first (reverse chronological) |
| `unfilteredTotal` always reported | Lets consumers know total log size regardless of filters |

---

## Export Boundaries

### Client-Side Export

The WebUI provides a **client-side JSON export** of the current
session's audit entries. This export:

- Downloads the full session audit log as a JSON file
- Requires no additional API call beyond the existing `/api/audit` read
- Includes only entries visible to the current operator session

### Export Constraints

| Constraint | Rule |
|------------|------|
| No secret leakage | All exported entries are already sanitized at write time |
| No credential paths | `.env` paths, local credential stores never appear in entries |
| No raw output | stdout/stderr content is rejected before writing |
| Session-scoped | Steward console exports cover only the current session's actions |
| Manual trigger only | Export requires explicit operator click; no automatic export |

### What Export Does NOT Do

- No server-side file generation or staging
- No upload to external services
- No email or notification integration
- No persistent export artifacts beyond the downloaded file

---

## Operator Guide

### Check audit file size

```bash
wc -l .github/ai-state/webui-action-audit.jsonl
```

### Count entries within retention window

```bash
node -e "
const { readEntries } = require('./tools/provider-pool-webui/lib/audit-store');
const entries = readEntries('.github/ai-state/webui-action-audit.jsonl');
const cutoff = new Date(Date.now() - 30 * 86400000);
const retained = entries.filter(e => new Date(e.capturedAt) >= cutoff);
console.log('Total:', entries.length, 'Retained:', retained.length);
"
```

### Archive and reset (manual)

```bash
cp .github/ai-state/webui-action-audit.jsonl \
   .github/ai-state/webui-action-audit-archive-$(date +%Y%m%d).jsonl
> .github/ai-state/webui-action-audit.jsonl
```

---

## Non-Goals

- No automatic file rotation or compaction (manual archive suffices
  for local-only logs).
- No cursor-based pagination (offset-based limit is adequate for local
  audit volumes).
- No real-time retention enforcement (read-time filtering is sufficient).
- No remote audit shipping or centralized logging.
- No changes to the audit store module itself — this document defines
  policy; implementation lives in the linked technical docs.

---

## Cross-References

- [Action Audit — WebUI Retention, Filters & Sanitization](action-audit-webui-retention.md) — consolidated technical reference
- [WebUI Action Audit Store](webui-action-audit-store.md) — append-only JSONL module
- [Provider Pool WebUI — Audit Retention Policy](provider-pool-webui-audit-retention.md) — detailed retention mechanics
- [Provider Pool WebUI — Audit Filtering API](provider-pool-webui-audit-filtering.md) — `GET /api/audit` query parameters
- [WebUI Command Steward Console](webui-command-steward-console.md) — Steward console audit trail section
- [Command Steward Agent](command-steward-agent.md) — audit visibility authority
