# Context Bundle Fact Projection Fixtures

Fixture-based test coverage for the context bundle generator's policy,
state, and schema fact projection. Tests live at
`scripts/ai/generate-context-bundle.facts.test.js`.

> **Closes:** [#456](https://github.com/taoyu051818-sys/lian-nest-server/issues/456)

## Overview

The context bundle generator (`scripts/ai/generate-context-bundle.js`) scans
five directories to build a manifest. The fact projection fixture tests validate
this scanning logic under controlled temp-directory fixtures, independent of
the real repo file set.

```
Fixture temp dir
    ├── docs/ai-native/*.md
    ├── schemas/*.schema.json
    ├── scripts/ai/*.schema.json
    ├── .github/ai-policy/*.json
    └── .github/ai-state/*.json
         │
         ▼
    buildManifest() assertion
```

## Test Categories

| Category | Tests | What is validated |
|----------|-------|-------------------|
| Manifest structure | 1-2 | All required keys present (version, issue, summary, etc.) |
| Empty repo | 3 | Zero counts and empty arrays when no files exist |
| Policy projection | 4, 15-16 | `.github/ai-policy/*.json` files enumerated correctly |
| State projection | 5, 16 | `.github/ai-state/*.json` files enumerated correctly |
| Schema projection | 6-8, 14, 17 | `.schema.json` from `schemas/` and `scripts/ai/` merged |
| Doc projection | 9 | `docs/ai-native/*.md` files enumerated |
| All categories | 10-11 | Five categories populated simultaneously, totalBytes sum |
| Sorting | 12 | Files sorted alphabetically within each category |
| Extension filtering | 13-14 | Non-matching extensions ignored, `.json` vs `.schema.json` |
| Missing directories | 15-17 | Graceful empty arrays when directories are absent |
| Path normalization | 18 | Relative paths use forward slashes |
| Timestamp | 19 | `generatedAt` is valid ISO-8601 |
| Real repo | 20-23 | Actual repo file counts match expectations |
| Subprocess | 24-25 | `--self-test` and `--dry-run` produce correct output |

## Running

```bash
# Run the fixture tests
node scripts/ai/generate-context-bundle.facts.test.js

# Run the generator self-test
node scripts/ai/generate-context-bundle.js --self-test
```

## Design Decisions

- **Self-contained**: no external test framework. Uses `assert()` + pass/fail
  counter, matching the pattern in `scripts/guards/*.test.js`.
- **Temp directory fixtures**: each test creates a controlled file tree in
  `os.tmpdir()`, runs assertions, then cleans up in `try/finally`.
- **Real repo validation**: a subset of tests validate against the actual repo
  directory to catch regressions in the live file set.
- **Subprocess tests**: the `--self-test` and `--issue` dry-run flags are
  exercised via `execSync` to validate the CLI interface end-to-end.
