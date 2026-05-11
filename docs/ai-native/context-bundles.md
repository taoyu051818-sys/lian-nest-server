# Context Bundles

Generates bounded context manifests so workers receive only the docs
relevant to their task, instead of reading stale docs broadly.
The generator script lives at `scripts/ai/generate-context-bundle.js`.

> **Closes:** [#333](https://github.com/taoyu051818-sys/lian-nest-server/issues/333)

## Overview

A context bundle is a JSON manifest that enumerates the documentation
files and schemas a worker should read for a given issue. The generator
scans `docs/ai-native/` and `scripts/ai/*.schema.json`, then emits
a bounded list of file paths with byte-size metadata.

```
Issue number
    │
    ▼
┌──────────────────────────┐
│ generate-context-bundle  │
│  scan docs/ai-native/    │
│  scan scripts/ai/*.json  │
└──────────┬───────────────┘
           │
           ▼
   bundle-<issue>.json
   { docs, schemas, summary }
```

Dry-run is the default mode. No files are written unless `--execute`
is passed explicitly.

## Usage

```bash
# Show help
node scripts/ai/generate-context-bundle.js --help

# Dry-run (default) — prints manifest to stdout
node scripts/ai/generate-context-bundle.js --issue 333

# Custom output directory
node scripts/ai/generate-context-bundle.js --issue 333 --outDir ./bundles

# Execute — writes bundle file to disk
node scripts/ai/generate-context-bundle.js --issue 333 --execute
```

## Manifest Format

The generated manifest conforms to this structure:

| Field | Type | Description |
|-------|------|-------------|
| `version` | integer | Manifest schema version (currently `1`) |
| `issue` | integer | GitHub issue number |
| `generatedAt` | string | ISO-8601 timestamp |
| `dryRun` | boolean | `true` when produced in dry-run mode |
| `summary.docCount` | integer | Number of docs included |
| `summary.schemaCount` | integer | Number of schemas included |
| `summary.totalBytes` | integer | Total size of all included files |
| `docs` | string[] | Relative paths to documentation files |
| `schemas` | string[] | Relative paths to schema files |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success (dry-run or execute) |
| `1` | Validation failure |
| `2` | Invalid arguments |

## Design Decisions

- **Default dry-run** follows the convention established by
  `compile-issue-to-task-json.ps1` and `batch-launch.ps1`.
- **Node.js** is used instead of PowerShell to keep the script
  portable across CI environments.
- **No external dependencies** — only Node.js built-in modules (`fs`, `path`).
- **Skeleton scope** — this script scans and enumerates docs but does not
  yet filter by issue keywords or wire into the launcher. Those capabilities
  are deferred to follow-up issues.
