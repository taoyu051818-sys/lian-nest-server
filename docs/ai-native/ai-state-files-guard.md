---
owner: taoyu
status: current
topic: ai-state-files-guard
---

# AI State Files Guard

Non-destructive guard that verifies `.github/ai-state` projection files exist
where expected and parse without requiring live worker state.

> **Closes:** [#391](https://github.com/taoyu051818-sys/lian-nest-server/issues/391)

---

## Purpose

The AI control plane reads several JSON projection files from
`.github/ai-state/` at dispatch, merge, and monitoring time. If any file is
missing or contains invalid JSON, downstream automation fails in opaque ways.
This guard surfaces those problems early with clear error messages.

---

## Checked Files

| File | Version Field | Required Keys |
|------|:-------------:|---------------|
| `launch-locks.json` | `markerVersion` | `markerVersion`, `capturedAt`, `locks` |
| `main-health.json` | `markerVersion` | `markerVersion`, `state`, `capturedAt` |
| `provider-pool.json` | `stateVersion` | `stateVersion`, `providers`, `global` |
| `worker-trust.json` | `markerVersion` | `markerVersion`, `capturedAt`, `workerClasses` |
| `active-workers.json` | `markerVersion` | `markerVersion`, `capturedAt`, `workers` |
| `meta-signals.json` | `snapshotVersion` | `snapshotVersion`, `signals` |

---

## Checks

| # | Check | Severity | Description |
|---|-------|----------|-------------|
| 1 | **Existence** | Error | File must be present in `.github/ai-state/`. |
| 2 | **Parseable** | Error | File must be valid JSON. |
| 3 | **Version field** | Error | File must contain its expected version key. |
| 4 | **Required keys** | Error | File must contain all required top-level keys. |
| 5 | **Staleness** | Warning | `capturedAt` / `calculatedAt` must be within threshold (default 48h). |

Errors block; warnings do not.

---

## Usage

```bash
# Standard run (checks all files, human-readable output)
node scripts/guards/check-ai-state-files.js

# JSON summary output
node scripts/guards/check-ai-state-files.js --json

# Dry run (show which files would be checked)
node scripts/guards/check-ai-state-files.js --dry-run

# Custom staleness threshold (hours)
node scripts/guards/check-ai-state-files.js --stale-threshold-hours 72

# Show help
node scripts/guards/check-ai-state-files.js --help
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All state files valid |
| 1 | Violations found |
| 2 | Bad arguments |

---

## Self-Tests

```bash
node scripts/guards/check-ai-state-files.test.js
```

Tests use temp directories and do not modify the real `.github/ai-state/`
files. Coverage includes:

- Missing file detection
- Invalid JSON detection
- Missing version field detection
- Missing required keys detection
- Staleness warning (fresh and stale timestamps)
- Full `run()` against the real state directory
- Full `run()` against temp directories with various fault conditions

---

## Integration

This guard fits alongside existing boundary and docs guards:

```
npm run check
  ├── check-task-boundary.js
  ├── check-docs-authority.js
  ├── check-ai-state-files.js   ◄── this guard
  └── ...
```

### CI Workflow

```yaml
- name: Check AI state files
  run: node scripts/guards/check-ai-state-files.js --json
```

---

## Design Decisions

- **Non-destructive.** The guard only reads files; it never writes.
- **No external dependencies.** Uses only Node.js built-ins.
- **Staleness is a warning.** Stale timestamps flag operational drift but do
  not block, because the projection may legitimately be older than the
  threshold (e.g. during low-activity periods).
- **Schema checks are structural, not deep.** The guard verifies top-level
  keys and version fields, not the full nested schema. Deep validation is
  delegated to JSON Schema files in `schemas/` where they exist.
- **Dir override for testing.** All check functions accept an optional
  directory parameter so tests can run against temp fixtures.

---

## References

- [ai-state/README.md](../../.github/ai-state/README.md) — Marker file conventions
- [health-state-schema.md](health-state-schema.md) — main-health.json schema
- [launch-locks-state.md](launch-locks-state.md) — launch-locks.json spec
- [provider-pool.md](provider-pool.md) — provider-pool.json spec
- [worker-trust.md](worker-trust.md) — worker-trust.json spec
- [meta-signals.md](meta-signals.md) — meta-signals.json spec
