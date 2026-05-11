# WebUI Action Audit Store

Append-only sanitized JSONL audit helper for the Provider Pool WebUI.

## Purpose

Records WebUI control-console actions (provider enable/disable, worker launches, policy changes) in a tamper-evident, append-only log. All entries are sanitized before writing to prevent secret leakage.

## Location

- **Module**: `tools/provider-pool-webui/lib/audit-store.js`
- **Tests**: `tools/provider-pool-webui/audit-store.test.js`
- **Default log**: `.github/ai-state/webui-action-audit.jsonl`

## Security Invariants

1. **Append-only**: The audit file is only appended to. Trimming is the sole exception (see Retention).
2. **Sanitized**: All string fields pass through secret redaction before writing.
3. **No raw output**: Raw stdout/stderr content (ANSI codes, process output markers, single lines >2000 chars) is rejected.
4. **Dry-run default**: The store defaults to preview mode; explicit `dryRun: false` is required to write.

## Retention Contract

- **Max entries**: 5000 (default). Configurable via `maxEntries` option on `createAuditStore`.
- **Auto-trim**: After every live `record()` call, the file is trimmed to the most recent `maxEntries` lines. Oldest entries are discarded first.
- **Manual trim**: `store.trim()` forces a trim and returns the number of entries removed.
- **String truncation**: All string field values are truncated to 500 characters (`MAX_STRING_LENGTH`).

### Persistence Boundaries

| Boundary | Behavior |
|----------|----------|
| File location | `.github/ai-state/webui-action-audit.jsonl` (relative to repo root) |
| Format | One JSON object per line (JSONL) |
| Directory creation | Parent directory is created automatically on first write |
| Missing file | `read()` and `count()` return empty/zero; no error thrown |
| Malformed lines | Silently skipped during `read()` |
| Dry-run mode | No file is created or modified |

## Secret Redaction Patterns

| Pattern | Replacement |
|---------|-------------|
| `ghp_*` tokens | `[redacted-gh-token]` |
| `gho_*` tokens | `[redacted-gh-oauth]` |
| `ghu_*/ghs_*/ghr_*` tokens | `[redacted-gh-app]` |
| `Bearer <token>` | `Bearer [redacted]` |
| `Basic <encoded>` | `Basic [redacted]` |
| `password=`, `secret=`, `token=`, `api_key=` values | `key=[redacted]` |
| AWS keys (`AKIA*`, `ASIA*`) | `[redacted-aws-key]` |
| JWT tokens | `[redacted-jwt]` |
| Private key blocks | `[redacted-private-key]` |
| Long base64-like strings (40+ chars) | `[redacted-token]` |

## API

### `createAuditStore(options)`

Creates an audit store instance.

**Options:**
- `filePath` (string): Path to JSONL file. Default: `.github/ai-state/webui-action-audit.jsonl`
- `dryRun` (boolean): If `true`, preview without writing. Default: `true`
- `maxEntries` (number): Max entries to retain. Default: `5000`. Oldest entries are trimmed on append.

**Returns:** Store instance with methods below.

### `store.record(entry)`

Record an action in the audit log.

**Entry fields:**
- `action` (string, required): The action being audited (max 200 chars)
- `actor` (string): Who performed the action
- `target` (string): What was acted upon
- `details` (object): Additional context (will be sanitized)
- `outcome` (string): Result of the action

**Returns:** `{ ok, entry?, error?, dryRun }`

### `store.read()`

Read all entries from the audit log. Returns `object[]`.

### `store.count()`

Count entries in the audit log. Returns `number`.

### `store.trim()`

Manually trim the audit file to `maxEntries`. Returns `number` of entries removed.

### `store.getMaxEntries()`

Get the configured max entries limit. Returns `number`.

### `store.getPath()`

Get the configured file path.

### `store.isDryRun()`

Check if running in dry-run mode.

## JSONL Entry Schema

```json
{
  "auditVersion": 1,
  "capturedAt": "2026-05-11T22:00:00.000Z",
  "action": "provider.enable",
  "actor": "admin",
  "target": "openai",
  "details": { "reason": "manual override" },
  "outcome": "success"
}
```

## Usage Examples

```js
const { createAuditStore } = require('./lib/audit-store');

// Dry-run preview (default)
const preview = createAuditStore();
const result = preview.record({ action: 'test', actor: 'dev' });
console.log(result.entry); // Preview only, no file written

// Live recording
const store = createAuditStore({ dryRun: false });
store.record({
  action: 'provider.enable',
  actor: 'admin',
  target: 'openai',
  details: { reason: 'quota reset' },
  outcome: 'success',
});

// Read back
const entries = store.read();
console.log(`Audit log has ${entries.length} entries`);
```

## Testing

```bash
node tools/provider-pool-webui/audit-store.test.js
```

Tests cover:
- Secret redaction for all pattern types
- Append-only invariant (read operations don't modify file)
- Dry-run mode (no file created)
- Live mode (entries written and readable)
- Validation (required fields, length limits)
- Raw output rejection (ANSI codes, process markers, >2000 char single lines)
- Auto-trim on append (retains most recent N entries)
- String truncation (500 char max per field)
- Edge cases (missing files, malformed JSONL lines)
