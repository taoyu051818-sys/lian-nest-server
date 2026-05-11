# Constitution Guard

Pre-flight validation that verifies the seed constitution is present and
structurally correct. Exposes a machine-readable pass/fail result for
integration into future gate stacks.

> **Closes:** [#395](https://github.com/taoyu051818-sys/lian-nest-server/issues/395)

---

## Overview

The constitution guard checks that:

1. The authoritative constitution exists at
   `.github/ai-policy/seed-constitution.md`.
2. The docs mirror exists at `docs/ai-native/seed-constitution.md`.
3. Both files contain the 5 required constitution sections.
4. Section headings are in sync between the authoritative file and the
   mirror.

This guard does **not** enforce constitution rules on worker diffs (that
is the boundary guard's job). It validates that the constitution itself is
intact and readable.

---

## Usage

```bash
# Standard run — exits 1 on violations
node scripts/guards/check-constitution.js

# Machine-readable JSON output
node scripts/guards/check-constitution.js --json

# Preview mode — reports checks without failing
node scripts/guards/check-constitution.js --dry-run

# Show help
node scripts/guards/check-constitution.js --help
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Pass (or `--dry-run`) |
| 1 | Violation found |
| 2 | Usage error |

---

## JSON Output Schema

When run with `--json`, the guard emits:

```json
{
  "status": "pass | fail",
  "checks": [
    { "name": "authoritative-exists", "pass": true, "message": "..." },
    { "name": "docs-mirror-exists", "pass": true, "message": "..." },
    { "name": "authoritative-sections", "pass": true, "message": "...", "headings": [...], "missing": [] },
    { "name": "mirror-sections", "pass": true, "message": "...", "headings": [...], "missing": [] },
    { "name": "section-sync", "pass": true, "message": "..." }
  ],
  "violations": [],
  "warnings": [],
  "summary": {
    "authoritativeExists": true,
    "mirrorExists": true,
    "requiredSections": 5,
    "violationCount": 0,
    "warningCount": 0,
    "mode": "enforce"
  }
}
```

---

## Required Sections

The guard expects these 5 H2 headings in both constitution files:

1. `## High-Risk Human-Required Boundaries`
2. `## Explicit Merge Allowlists`
3. `## Main-Red Launch Stop`
4. `## Legacy Backend Read-Only Policy`
5. `## No Worker Scope Expansion`

---

## Integration

The guard is designed to be called from CI or orchestration scripts. It
has no external dependencies and reads only two files. The `--json` flag
makes it easy to parse results programmatically.

---

## References

- [seed-constitution.md](seed-constitution.md) — Docs mirror of the constitution.
- [seed-constitution.md (authoritative)](../../.github/ai-policy/seed-constitution.md) — Single source of truth.
- [check-task-boundary.js](../../scripts/guards/check-task-boundary.js) — Boundary guard that enforces constitution rules on diffs.
