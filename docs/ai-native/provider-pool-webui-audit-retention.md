# Provider Pool WebUI — Audit Retention Policy

> **Closes:** [#736](https://github.com/taoyu051818-sys/lian-nest-server/issues/736)

---

## Overview

The WebUI action audit log (`webui-action-audit.jsonl`) records every
`/api/actions/execute` call as a sanitized JSONL entry. This document
defines the retention policy that keeps the log bounded, safe, and
operationally useful over time.

The audit store is **append-only** — entries are never modified after
writing. Retention is enforced at **read time** by filtering entries
older than the retention window.

---

## Retention Constants

| Constant             | Value    | Purpose                                      |
|----------------------|----------|----------------------------------------------|
| `RETENTION_DAYS`     | 30       | Entries older than this are excluded at read  |
| `MAX_ENTRIES_SOFT`   | 10,000   | Soft cap; triggers operator review            |
| `MAX_ENTRY_BYTES`    | 4,096    | Per-entry size guard (post-sanitization)      |
| `MAX_STRING_LENGTH`  | 500      | All string fields truncated to this length    |

---

## How Retention Works

### Read-Time Filtering

The audit store does not delete old entries from the file. Instead,
consumers filter by `capturedAt` at read time:

```js
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

const retained = entries.filter((e) => {
  if (!e.capturedAt) return false;
  return new Date(e.capturedAt) >= cutoff;
});
```

This preserves the append-only invariant: the JSONL file is never
truncated, rotated, or modified by reads.

### Why Append-Only

- **Audit integrity** — entries are immutable once written; no process
  can silently alter history.
- **Simplicity** — no file locking, rotation, or compaction needed.
- **Local-only scope** — the WebUI runs on `127.0.0.1`; the file is
  not exposed to the network, so size growth is a local concern.

---

## Size Controls

### Per-Entry Bounding

Every entry passes through `sanitizeString` which truncates strings to
500 characters. Raw stdout/stderr content is rejected entirely (replaced
with a `_warning` field). This prevents any single entry from growing
unbounded.

### File-Level Growth

With a 30-day retention window and typical usage (tens of actions per
day), the audit file stays well under the 10,000-entry soft cap. If the
soft cap is exceeded, the operator should:

1. Review the entries for unexpected activity.
2. Manually archive and truncate the file if needed.
3. Investigate the root cause (e.g., a runaway automation loop).

---

## Security Properties

| Property               | Enforcement                                         |
|------------------------|-----------------------------------------------------|
| No secrets in entries  | `sanitizeString` redacts tokens, keys, passwords    |
| No raw process output  | `looksLikeRawProcessOutput` rejects ANSI/stdout     |
| No unbounded strings   | `MAX_STRING_LENGTH` caps all string fields          |
| Append-only            | File is never modified by read operations           |
| Local-only             | Server binds to `127.0.0.1`                         |

---

## Retention Workflow

```
  Action executed
       │
       ▼
  buildEntry() ── sanitize all fields
       │
       ▼
  appendEntry() ── append JSONL line
       │
       ▼
  (file grows over time)
       │
       ▼
  readEntries() ── consumer reads full file
       │
       ▼
  filterByAge(entries, RETENTION_DAYS)
       │
       ▼
  Only recent entries are returned
```

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
cp .github/ai-state/webui-action-audit.jsonl .github/ai-state/webui-action-audit-archive-$(date +%Y%m%d).jsonl
> .github/ai-state/webui-action-audit.jsonl
```

---

## Test Fixture

The retention policy is validated by:

```
node tools/provider-pool-webui/audit-retention.test.js
```

This test suite verifies:
- Entry size stays within bounds
- Sanitization prevents log bloat from raw output
- Read operations preserve the append-only invariant
- Retention boundary correctly identifies old vs. recent entries
- Missing/empty files are handled gracefully
- No secrets survive sanitization in the audit file

---

## Non-Goals

- No automatic file rotation or compaction (manual archive is sufficient
  for local-only logs).
- No cursor-based pagination (offset-based limit is adequate for local
  audit volumes).
- No real-time retention enforcement (read-time filtering is sufficient).
- No remote audit shipping or centralized logging.
- No changes to the audit store module itself — retention is a consumer-
  level concern applied on read.

---

## Cross-References

- [Audit Store](provider-pool-webui-api.md) — underlying append-only store
- [Audit Filtering API](provider-pool-webui-audit-filtering.md) — query parameters for `GET /api/audit`
- [WebUI Control Map](webui-control-map.md) — audit trail section
- [WebUI Security](provider-pool-webui-security.md) — secret scrubbing rules
