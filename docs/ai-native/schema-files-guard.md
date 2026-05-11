# Schema Files Guard

Guard script that verifies `schemas/*.schema.json` files parse as valid JSON and contain required top-level JSON Schema metadata.

> **Closes:** [#392](https://github.com/taoyu051818-sys/lian-nest-server/issues/392)

---

## Location

`scripts/guards/check-schema-files.js`

---

## Purpose

Control-plane schemas define machine-readable contracts for gate results, health state, launch plans, merge manifests, worker tasks, and telemetry. A malformed or incomplete schema file silently breaks downstream consumers.

This guard enforces a baseline validity contract:

1. **Valid JSON** — the file must parse without errors.
2. **Root is an object** — arrays or primitives are not valid schema roots.
3. **Required top-level keys** — `$schema`, `title`, `description`, `type`, `properties` must all be present.
4. **`$schema` references json-schema.org** — ensures the schema declares its draft version.
5. **Root `type` is `"object"`** — all current schemas describe object payloads.

---

## Usage

```bash
# Standard run (enforce mode, exit 1 on violations)
node scripts/guards/check-schema-files.js

# Show help
node scripts/guards/check-schema-files.js --help

# Dry run — list files that would be checked
node scripts/guards/check-schema-files.js --dry-run

# Warn-only — violations reported as warnings, exit 0
node scripts/guards/check-schema-files.js --warn-only

# Machine-readable JSON output
node scripts/guards/check-schema-files.js --json

# Override schemas directory
node scripts/guards/check-schema-files.js --schemas-dir path/to/schemas
```

---

## Options

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show help message and exit 0. |
| `--dry-run` | Report what would be checked without running validations. |
| `--json` | Output machine-readable JSON summary. |
| `--warn-only` | Report violations as warnings (exit 0) instead of errors (exit 1). |
| `--schemas-dir DIR` | Override schemas directory (default: `schemas/`). |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No violations (or `--warn-only` with warnings, or `--help` / `--dry-run`). |
| 1 | Violations found in enforce mode. |
| 2 | Usage error (unknown argument, missing value). |

---

## Checks

| Rule | Severity | Description |
|------|----------|-------------|
| `json-parse` | Error | File contains invalid JSON. |
| `root-type` | Error | Root value is not a JSON object. |
| `missing-key` | Error | A required top-level key is absent. |
| `invalid-schema-ref` | Error | `$schema` does not reference `json-schema.org`. |
| `root-type-value` | Error | Root `type` is not `"object"`. |

---

## Tests

```bash
node scripts/guards/check-schema-files.test.js
```

Self-contained tests using temp directory fixtures. No external dependencies.

---

## Integration

Add to CI or orchestration scripts alongside other guards:

```bash
node scripts/guards/check-schema-files.js --json
```
