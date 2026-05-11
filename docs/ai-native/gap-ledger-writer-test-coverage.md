# Gap Ledger Writer Test Coverage

Self-tests for `scripts/ai/write-gap-ledger.js` covering dry-run output,
append entry shape, required field validation, and edge cases.

> **Test file:** `scripts/ai/write-gap-ledger.test.js`
> **Run:** `node scripts/ai/write-gap-ledger.test.js`
> **Framework:** Node.js built-in test runner (`node:test`)

## Test Suites

### Dry-run

| Test | Asserts |
|------|---------|
| prints entry JSON without writing to disk | exit 0, stdout contains `[dry-run]`, file not created |
| dry-run entry contains valid JSON | parsed JSON has correct gapType, severity, description |

### Append entry shape

| Test | Asserts |
|------|---------|
| appends a valid NDJSON line with required fields | file exists, `entryVersion=1`, correct gapType/severity/description, valid ISO 8601 `recordedAt` |
| appends exactly one line per invocation | 2 invocations produce 2 lines with correct types |
| includes optional fields when provided | issue, pr, branch, commit, severity, meta all present |
| omits optional fields when not provided | no issue/pr/branch/commit/meta keys in output |

### Required field validation

| Test | Asserts |
|------|---------|
| rejects missing --type | exit 2, stderr matches `--type is required` |
| rejects missing --desc | exit 2, stderr matches `--desc is required` |
| rejects invalid gap type | exit 2, stderr matches `--type must be one of:` |
| rejects invalid severity | exit 2, stderr matches `--severity must be one of:` |
| rejects non-numeric --issue | exit 2, stderr matches `--issue must be a number` |
| rejects non-numeric --pr | exit 2, stderr matches `--pr must be a number` |
| rejects --type without value | exit 2, stderr matches `--type requires a value` |
| rejects --desc without value | exit 2, stderr matches `--desc requires a value` |

### Commit format validation

| Test | Asserts |
|------|---------|
| accepts valid 7-char hex commit | exit 0, commit field present |
| accepts valid 40-char hex commit | exit 0 |
| rejects commit shorter than 7 chars | exit 2 |
| rejects commit longer than 40 chars | exit 2 |
| rejects commit with non-hex characters | exit 2 |

### Meta JSON validation

| Test | Asserts |
|------|---------|
| accepts valid JSON meta | exit 0, meta parsed correctly |
| rejects invalid JSON meta | exit 2, stderr matches `--meta must be valid JSON` |

### Severity default

| Test | Asserts |
|------|---------|
| defaults severity to medium when omitted | entry.severity === 'medium' |

### All gap types accepted

| Test | Asserts |
|------|---------|
| accepts each of the 6 gap types | exit 0, gapType matches for each type |

### Unknown arguments

| Test | Asserts |
|------|---------|
| rejects unknown flags | exit 2, stderr matches `Unknown argument` |

### Help flag

| Test | Asserts |
|------|---------|
| prints help and exits 0 with --help | exit 0, stdout contains USAGE/--type/--dry-run |

## Coverage Summary

- **30 tests** across 8 describe blocks
- Covers all 6 gap types, all 4 severity levels
- Covers all optional fields (issue, pr, branch, commit, meta)
- Covers exit code 0 (success) and exit code 2 (validation failure)
- Tests are isolated: each write test uses a temp file cleaned up after the test
