# Local Resource JSON Schema

Formal JSON Schema for `.github/ai-state/local-resource.json`, the local
resource projection that enumerates scripts, docs, schemas, policies, and
state files available on the local machine.

> **Schema file:** [`schemas/local-resource.schema.json`](../../schemas/local-resource.schema.json)
> **Closes:** [#523](https://github.com/taoyu051818-sys/lian-nest-server/issues/523)

---

## Overview

The local resource file is a sanitized inventory of files the orchestration
system depends on. It lets the context bundle generator, launch gate, and
orchestrator verify resource availability before dispatching workers — without
scanning the filesystem at decision time.

| Aspect | Value |
|--------|-------|
| Schema version | `schemaVersion: 1` |
| JSON Schema draft | `draft-07` |
| Path | `.github/ai-state/local-resource.json` |
| Contains secrets | Never |

---

## Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | `integer` (const `1`) | Schema version. Consumers reject other values. |
| `capturedAt` | `string` (ISO-8601) | Timestamp when this resource projection was captured. |
| `resources` | `object` | Resource inventory grouped by category. |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `summary` | `ResourceSummary` | Aggregate counts and health of the inventory. |

---

## Resource Categories

The `resources` object contains five category arrays:

| Category | Directory | Contents |
|----------|-----------|----------|
| `scripts` | `scripts/ai/` | Automation scripts (PowerShell, Node.js) |
| `docs` | `docs/ai-native/` | Documentation markdown files |
| `schemas` | `schemas/` | JSON schema files (`*.schema.json`) |
| `policies` | `.github/ai-policy/` | Machine-readable policy JSON files |
| `state` | `.github/ai-state/` | Runtime state projection JSON files |

Each category is an array of `ResourceEntry` objects.

---

## ResourceEntry

A single local resource file.

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `path` | `string` | yes | Relative path from the repository root (forward slashes). |
| `exists` | `boolean` | yes | Whether the file exists on disk at capture time. |
| `category` | `string` enum | yes | One of `scripts`, `docs`, `schemas`, `policies`, `state`. |
| `sizeBytes` | `integer` or `null` | no | File size in bytes. Null when the file does not exist. |
| `lastModifiedAt` | `date-time` or `null` | no | ISO-8601 last-modified timestamp. Null when missing. |
| `description` | `string` or `null` | no | Human-readable description of the resource purpose. |

### Example Entry

```json
{
  "path": "schemas/health-state.schema.json",
  "exists": true,
  "category": "schemas",
  "sizeBytes": 3200,
  "lastModifiedAt": "2026-05-11T10:00:00Z",
  "description": "JSON schema for main branch health state projection"
}
```

---

## ResourceSummary

Aggregate counts and health of the local resource inventory.

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `totalFiles` | `integer` >= 0 | yes | Total resource entries across all categories. |
| `existingFiles` | `integer` >= 0 | yes | Entries where `exists` is `true`. |
| `missingFiles` | `integer` >= 0 | yes | Entries where `exists` is `false`. |
| `totalBytes` | `integer` or `null` | no | Sum of `sizeBytes` across all existing resources. |
| `perCategory` | `object` | no | Per-category file counts (keys: `scripts`, `docs`, `schemas`, `policies`, `state`). |

### Derived Metrics

- **Resource coverage:** `existingFiles / totalFiles`
- **Missing ratio:** `missingFiles / totalFiles`
- **Category balance:** compare `perCategory` values to detect gaps

---

## Example: Full Resource Projection

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-11T12:00:00Z",
  "resources": {
    "scripts": [
      {
        "path": "scripts/ai/write-main-health-state.ps1",
        "exists": true,
        "category": "scripts",
        "sizeBytes": 4500,
        "lastModifiedAt": "2026-05-10T08:00:00Z",
        "description": "Writes the main branch health state marker"
      },
      {
        "path": "scripts/ai/select-api-provider.ps1",
        "exists": false,
        "category": "scripts",
        "sizeBytes": null,
        "lastModifiedAt": null,
        "description": "Provider selection script (planned)"
      }
    ],
    "docs": [
      {
        "path": "docs/ai-native/orchestration.md",
        "exists": true,
        "category": "docs",
        "sizeBytes": 8200,
        "lastModifiedAt": "2026-05-09T14:00:00Z",
        "description": "Full orchestration flow documentation"
      }
    ],
    "schemas": [
      {
        "path": "schemas/health-state.schema.json",
        "exists": true,
        "category": "schemas",
        "sizeBytes": 3200,
        "lastModifiedAt": "2026-05-10T10:00:00Z",
        "description": "JSON schema for main branch health state"
      }
    ],
    "policies": [
      {
        "path": ".github/ai-policy/provider-pool-policy.json",
        "exists": true,
        "category": "policies",
        "sizeBytes": 1800,
        "lastModifiedAt": "2026-05-10T12:00:00Z",
        "description": "API provider pool configuration policy"
      }
    ],
    "state": [
      {
        "path": ".github/ai-state/active-workers.json",
        "exists": true,
        "category": "state",
        "sizeBytes": 250,
        "lastModifiedAt": "2026-05-11T11:30:00Z",
        "description": "Active worker registry"
      }
    ]
  },
  "summary": {
    "totalFiles": 5,
    "existingFiles": 4,
    "missingFiles": 1,
    "totalBytes": 17950,
    "perCategory": {
      "scripts": 2,
      "docs": 1,
      "schemas": 1,
      "policies": 1,
      "state": 1
    }
  }
}
```

---

## Security Model

The local resource file is a **sanitized projection**. It never contains:

| Artifact | Status |
|----------|--------|
| API keys, tokens, credentials | Never included |
| `.env` contents | Never included |
| `C:\Users\LENOVO\.claude\` contents | Never included |
| Raw file contents | Never included — only paths and metadata |

The file records **what exists**, not **what it contains**. This allows
the orchestrator to verify resource availability without exposing secrets.

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **Context bundle generator** | `resources`, `summary` | Verify scan targets exist before generating bundles. |
| **Launch gate** | `resources.scripts`, `resources.schemas` | Confirm required scripts and schemas are present before dispatch. |
| **Orchestrator** | `summary.missingFiles` | Detect resource gaps that would cause worker failures. |
| **Monitoring** | `capturedAt`, `summary` | Detect stale projections and missing resource trends. |

---

## Validation Rules

The writer script enforces these constraints at write time:

| Rule | Enforcement |
|------|-------------|
| `schemaVersion` must be `1` | Hard fail |
| `capturedAt` must be valid ISO-8601 | Hard fail |
| `resources` must contain all five categories | Hard fail |
| `path` entries must use forward slashes | Hard fail |
| `sizeBytes` must be null when `exists` is false | Hard fail |
| `lastModifiedAt` must be null when `exists` is false | Hard fail |

The JSON Schema enforces structural correctness (types, enums, patterns)
but does not encode cross-field consistency rules (e.g. sizeBytes-null-when-missing).
Those are enforced by the writer script.

---

## Relationship to Other Schemas

| Schema | Purpose |
|--------|---------|
| `schemas/local-resource.schema.json` | Local resource inventory — what files exist. |
| `schemas/health-state.schema.json` | Main branch health — is the branch safe. |
| `schemas/launch-plan.schema.json` | Launch plan — which tasks are dispatched. |
| `schemas/worker-telemetry.schema.json` | Worker telemetry — what a task cost. |

The local resource projection complements the health state: health tracks
whether checks pass, while local resources tracks whether the files those
checks depend on are present.

---

## References

- [context-bundles.md](context-bundles.md) — Context bundle generator that consumes resource data.
- [context-bundle-fact-projection.md](context-bundle-fact-projection.md) — Fact projection that extends bundles with policies, state, and schemas.
- [provider-pool.md](provider-pool.md) — Provider pool state projection (similar pattern).
- [orchestration.md](orchestration.md) — Full orchestration flow.
- [launch-gate.md](launch-gate.md) — Pre-launch validation logic.
