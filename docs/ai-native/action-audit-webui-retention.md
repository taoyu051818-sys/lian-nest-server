# Action Audit — WebUI Retention, Filters & Sanitization

> **Closes:** [#824](https://github.com/taoyu051818-sys/lian-nest-server/issues/824)

---

## Overview

This document consolidates the WebUI action audit retention policy,
available filters, field sanitization rules, and what must never appear
in audit logs. It covers all three audit storage layers used by the
Provider Pool WebUI.

---

## Audit Storage Layers

| Layer | File | Format | Writer |
|-------|------|--------|--------|
| Audit store (primary) | `.github/ai-state/webui-action-audit.jsonl` | JSONL | `audit-store.js` |
| Server audit log | `tools/provider-pool-webui/.audit-log.json` | JSON array | `server.js` |
| Action runner trail | `.github/ai-state/provider-ui-audit.ndjson` | NDJSON | `action-runner.js` |

All three layers sanitize entries before writing.

---

## Retention Policy

| Constant | Value | Enforcement |
|----------|-------|-------------|
| `RETENTION_DAYS` | 30 | Read-time filter on `capturedAt` |
| `MAX_ENTRIES` (hard cap) | 5,000 | Write-time trim after each append |
| `MAX_ENTRIES_SOFT` | 10,000 | Operator review trigger |
| `MAX_ENTRY_BYTES` | 4,096 | Per-entry size guard (post-sanitization) |
| `MAX_STRING_LENGTH` | 500 | All string fields truncated |

**Mechanism:** The JSONL file is append-only. Old entries are excluded
at read time by filtering `capturedAt >= (now - 30 days)`. The hard cap
trims oldest entries on every write.

---

## Filters

### `GET /api/audit` Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `actionId` | string | Exact match on action id |
| `status` | string | `success` or `error` |
| `limit` | number | Max entries returned (capped at 500) |

### WebUI Frontend Filters

The Audit Log section in the WebUI provides:

- **Action** — text input, maps to `actionId` query param
- **Status** — dropdown: All, Success, Error, Blocked
- **Limit** — number input (1-200)
- **Apply / Clear** — fetch filtered data or reset

The UI merges server-side entries (blue-tinted rows) with client-side
in-memory audit entries. A "Refresh Server Audit" button re-fetches
from `/api/audit`.

---

## Sanitized Fields

Every audit entry passes through sanitization before writing.

### Secret Redaction Patterns

| Pattern | Replacement |
|---------|-------------|
| `ghp_*` GitHub PATs | `[redacted-gh-token]` |
| `gho_*` GitHub OAuth tokens | `[redacted-gh-oauth]` |
| `ghu_*/ghs_*/ghr_*` GitHub app tokens | `[redacted-gh-app]` |
| `Bearer <token>` | `Bearer [redacted]` |
| `Basic <encoded>` | `Basic [redacted]` |
| `password=`, `secret=`, `token=`, `api_key=` values | `key=[redacted]` |
| AWS keys (`AKIA*`, `ASIA*`) | `[redacted-aws-key]` |
| JWT tokens (3-dot format) | `[redacted-jwt]` |
| Private key blocks | `[redacted-private-key]` |
| Base64-like strings (40+ chars) | `[redacted-token]` |

### Structural Guards

| Guard | Limit | Behavior |
|-------|-------|----------|
| `MAX_STRING_LENGTH` | 500 chars | Truncate with `...[truncated, N chars total]` |
| `MAX_ARRAY_LENGTH` | 50 items | Truncate with notice |
| `MAX_OBJECT_KEYS` | 30 keys | Truncate with `_truncatedKeys` count |
| Raw output rejection | ANSI / stdout / stderr | Replace with `_warning` field |

### Key-Level Redaction

`action-result-normalizer.js` matches object keys containing `api_key`,
`token`, `secret`, `password`, `credential`, `auth`, or `private_key`
and replaces their values with `[redacted]` regardless of content.

The action runner (`action-runner.js`) drops any parameter key whose
lowercase name contains `secret`, `token`, `key`, or `password`.

---

## What Must Never Be Logged

| Category | Examples | Enforcement |
|----------|----------|-------------|
| Passwords | user passwords, service account passwords | Key-pattern redaction + value-pattern redaction |
| API keys | `sk-*`, `AKIA*`, provider API keys | Value-pattern redaction |
| Tokens | GitHub PATs, OAuth tokens, JWTs, Bearer tokens | Prefix-pattern redaction |
| Private keys | PEM blocks, `-----BEGIN.*PRIVATE KEY-----` | Block-pattern redaction |
| Raw process output | stdout/stderr, ANSI escape codes | `looksLikeRawProcessOutput` rejection |
| Confirmation tokens | Actual token values from `/api/actions/confirm` | Server writes `confirmationToken: "provided"` instead |

---

## Entry Schema

```json
{
  "auditVersion": 1,
  "capturedAt": "2026-05-12T10:00:00.000Z",
  "action": "provider.enable",
  "actor": "admin",
  "target": "openai",
  "details": { "reason": "manual override" },
  "outcome": "success"
}
```

Required fields per `schemas/webui-action-audit.schema.json`:
`schemaVersion`, `auditId`, `requestId`, `mode`, `actionType`,
`riskLevel`, `outcome`, `requestedAt`, `capturedAt`.

---

## Operator Quick Reference

```bash
# Check audit file size
wc -l .github/ai-state/webui-action-audit.jsonl

# Count entries within retention window
node -e "
const { readEntries } = require('./tools/provider-pool-webui/lib/audit-store');
const entries = readEntries('.github/ai-state/webui-action-audit.jsonl');
const cutoff = new Date(Date.now() - 30 * 86400000);
const retained = entries.filter(e => new Date(e.capturedAt) >= cutoff);
console.log('Total:', entries.length, 'Retained:', retained.length);
"

# Archive and reset
cp .github/ai-state/webui-action-audit.jsonl \
   .github/ai-state/webui-action-audit-archive-$(date +%Y%m%d).jsonl
> .github/ai-state/webui-action-audit.jsonl
```

---

## Cross-References

- [Audit Store](webui-action-audit-store.md) — append-only JSONL module
- [Audit Retention Policy](provider-pool-webui-audit-retention.md) — detailed retention mechanics
- [Audit Filtering API](provider-pool-webui-audit-filtering.md) — `GET /api/audit` query parameters
- [WebUI Security](provider-pool-webui-security.md) — secret scrubbing and localhost binding
- [Action Result Normalizer](webui-action-result-normalizer.md) — structural guards and key-level redaction
