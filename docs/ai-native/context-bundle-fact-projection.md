# Context Bundle Fact Projection

Extends the context bundle generator (`scripts/ai/generate-context-bundle.js`)
to include machine-readable policy, runtime state, and JSON schema files
alongside the existing documentation scan.

> **Closes:** [#405](https://github.com/taoyu051818-sys/lian-nest-server/issues/405)

## Overview

Workers need more than prose docs to make guard decisions. This projection
adds three new categories to the bundle manifest:

| Category | Directory | Extension | Purpose |
|----------|-----------|-----------|---------|
| **Policies** | `.github/ai-policy/` | `*.json` | Machine-readable rules (launch, merge, risk, failure taxonomy, permissions, budget, provider pool) |
| **State** | `.github/ai-state/` | `*.json` | Runtime projections (active workers, launch locks, meta-signals, provider pool, worker trust) |
| **Schemas** | `schemas/` | `*.schema.json` | JSON schemas for task-v2, telemetry, launch plan, gate result, health state, merge manifest |

The existing scans (docs and scripts/ai schemas) are preserved.

## Manifest v2

The manifest version bumps from `1` to `2`. New fields:

| Field | Type | Description |
|-------|------|-------------|
| `summary.policyCount` | integer | Number of policy files included |
| `summary.stateCount` | integer | Number of state files included |
| `policies` | string[] | Relative paths to policy JSON files |
| `state` | string[] | Relative paths to state JSON files |

Existing fields (`docs`, `schemas`, `summary.docCount`, `summary.schemaCount`,
`summary.totalBytes`) are unchanged.

## Usage

```bash
# Show help (includes scan directory listing)
node scripts/ai/generate-context-bundle.js --help

# Dry-run — prints manifest with all five scan categories
node scripts/ai/generate-context-bundle.js --issue 405

# Self-test — validates all scan directories and manifest structure
node scripts/ai/generate-context-bundle.js --self-test

# Execute — writes bundle file
node scripts/ai/generate-context-bundle.js --issue 405 --execute
```

## Self-Test

The `--self-test` flag validates:

1. Each scan directory resolves (missing directories are non-fatal).
2. Files are discovered with the expected extension.
3. A sample manifest builds with all required keys (`version`, `issue`,
   `generatedAt`, `dryRun`, `summary`, `docs`, `schemas`, `policies`, `state`).
4. Manifest version is `2`.

Exit code `0` means all checks passed.

## Design Decisions

- **Backwards compatible**: existing `docs` and `schemas` fields are
  unchanged. Consumers that don't read `policies` or `state` are unaffected.
- **Graceful on missing dirs**: if `.github/ai-policy/` or `.github/ai-state/`
  don't exist the manifest includes empty arrays rather than failing.
- **No secrets**: policy and state files are machine-readable control-plane
  data, not credentials. The generator does not read `.env` or secrets.
- **No runtime behavior change**: this is a tooling/script change only.
