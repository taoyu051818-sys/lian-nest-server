# Fact Event Writer — Test Coverage

Coverage matrix for `scripts/ai/write-fact-event.test.js` against `scripts/ai/write-fact-event.js`.

---

## Test Suites

| # | Suite | What it covers | Type |
|---|-------|---------------|------|
| 1 | dry-run event shape | eventVersion, eventType, subject, capturedAt format | integration |
| 2 | dry-run with facts | JSON facts round-trip through CLI | integration |
| 3 | dry-run minimal event | null optionals (subject, facts, actor) default correctly | integration |
| 4 | dry-run with actor | actor field preserved in output | integration |
| 5 | dry-run output markers | DRY RUN / no-file-modified markers present | integration |
| 6 | redaction: GitHub PATs | `ghp_*` tokens replaced with `[redacted-gh-token]` | unit |
| 7 | redaction: Bearer tokens | `Bearer *` / `bearer *` / `BEARER *` replaced | unit |
| 8 | redaction: base64-like | 40+ char alphanumeric strings replaced; 39-char preserved | unit |
| 9 | redaction: key=value | `password=`, `secret=`, `token=` patterns (case-insensitive) | unit |
| 10 | redaction: integration | end-to-end redaction through CLI dry-run output | integration |
| 11 | sanitizeFacts type preservation | non-string values (number, boolean, null, array) pass through | unit |
| 12 | sanitizeFacts null/undefined | null and undefined input handled gracefully | unit |
| 13 | truncation boundary | 500-char limit enforced; boundary values at 500/501/1000 | unit |
| 14 | CLI: missing --type | exits 2 with `--type is required` message | integration |
| 15 | CLI: unknown argument | exits 2 with `Unknown argument` message | integration |
| 16 | CLI: invalid --facts | exits 2 when --facts is not valid JSON | integration |
| 17 | CLI: --help | exits 0, output contains USAGE section | integration |
| 18 | CLI: -h shorthand | same as --help | integration |
| 19 | built-in --self-test | the script's own self-test passes | integration |
| 20 | live write to temp file | NDJSON line written correctly, content verified | integration |
| 21 | live write appends | second write appends (does not truncate) | integration |
| 22 | redaction pattern isolation | ghp_ precedence, mixed pattern strings | unit |
| 23 | sanitize edge cases | empty string, plain text, single char, non-string passthrough | unit |

---

## Redaction Boundary Coverage

| Pattern | Input example | Expected output | Covered |
|---------|--------------|-----------------|:-------:|
| GitHub PAT | `ghp_abc123` | `[redacted-gh-token]` | yes |
| Bearer header | `Bearer tok123` | `Bearer [redacted]` | yes |
| Bearer (lowercase) | `bearer tok` | `Bearer [redacted]` | yes |
| Bearer (uppercase) | `BEARER tok` | `Bearer [redacted]` | yes |
| Base64 (40 chars) | `aaaa...` (40) | `[redacted-token]` | yes |
| Base64 (39 chars) | `aaaa...` (39) | unchanged | yes |
| Base64 (50 chars) | `aaaa...` (50) | `[redacted-token]` | yes |
| password= | `password=hunter2` | `password=[redacted]` | yes |
| secret: | `secret: myval` | `secret=[redacted]` | yes |
| token= | `token=abc` | `token=[redacted]` | yes |
| SECRET= (caps) | `SECRET=VAL` | `secret=[redacted]` | yes |
| Truncation (500) | 500 chars | 500 chars preserved | yes |
| Truncation (501) | 501 chars | 500 chars | yes |

---

## Event Shape Validation

All fields from the [fact event schema](fact-event-ledger.md) are verified:

| Field | Assertion |
|-------|-----------|
| `eventVersion` | equals `1` |
| `eventType` | matches input string |
| `subject` | matches input or `null` |
| `facts` | matches input object or `null` |
| `capturedAt` | ISO-8601 string ending in `Z` |
| `actor` | matches input string or `null` |

---

## Running

```bash
node scripts/ai/write-fact-event.test.js
```

Exit code 0 = all pass, 1 = failures.
