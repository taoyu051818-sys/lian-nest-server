# AI Policy Files Guard

Non-destructive guard that verifies required `.github/ai-policy` files exist and JSON policy files parse correctly.

## Purpose

The policy-as-code directory `.github/ai-policy/` contains JSON policy files and the seed constitution that govern AI-native orchestration behavior. This guard ensures:

1. All required policy files are present.
2. All JSON policy files are valid JSON (strict parse).
3. The seed constitution markdown file exists.

## Required Files

| File | Type |
|------|------|
| `failure-taxonomy.json` | JSON policy |
| `launch-policy.json` | JSON policy |
| `merge-policy.json` | JSON policy |
| `provider-pool-policy.json` | JSON policy |
| `risk-policy.json` | JSON policy |
| `telemetry-budget-policy.json` | JSON policy |
| `worker-permissions.json` | JSON policy |
| `seed-constitution.md` | Markdown |

## Usage

```bash
# Standard check (exit 1 on failure)
node scripts/guards/check-ai-policy-files.js

# JSON output for CI integration
node scripts/guards/check-ai-policy-files.js --json

# Dry-run: report issues without failing
node scripts/guards/check-ai-policy-files.js --dry-run

# Help
node scripts/guards/check-ai-policy-files.js --help
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All required files present and JSON valid |
| 1 | Missing files or invalid JSON detected |
| 2 | Bad arguments or policy directory not found |

## JSON Output Schema

When run with `--json`, the output is:

```json
{
  "ok": true,
  "dirExists": true,
  "missing": [],
  "invalidJson": [],
  "checked": 8
}
```

- `ok` – overall pass/fail
- `dirExists` – whether `.github/ai-policy/` directory was found
- `missing` – list of missing required file names
- `invalidJson` – list of `{ file, error }` for files that failed JSON parse
- `checked` – number of files successfully found (out of total required)

## Self-Tests

```bash
node scripts/guards/check-ai-policy-files.test.js
```

Tests cover:
- All files present (happy path)
- Missing directory
- Missing individual files (each JSON file and seed-constitution.md)
- Invalid JSON in one or more files
- Combined missing and invalid scenarios
- Edge cases: empty JSON objects/arrays, BOM-prefixed JSON
- Dry-run behavior
- Checked count accuracy
