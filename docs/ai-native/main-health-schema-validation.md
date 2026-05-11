# Main Health Writer Schema Validation

The health state writer (`scripts/ai/write-main-health-state.ps1`) validates
every marker against the constraints defined in
[`schemas/health-state.schema.json`](../../schemas/health-state.schema.json)
before writing to `.github/ai-state/main-health.json`.

> **Closes:** [#404](https://github.com/taoyu051818-sys/lian-nest-server/issues/404)

---

## Validation Layers

The writer enforces validation at two levels:

### 1. Input Validation (pre-construction)

Runs on raw parameters before the marker object is built:

| Check | Behavior |
|-------|----------|
| `state` enum | Hard fail if not `green`, `yellow`, `red`, or `black` (PowerShell `ValidateSet`) |
| `commitSha` format | Hard fail if not 7-40 hex characters |
| `failedChecks` subset of `checks` | Hard fail if any failed check is missing from checks list |
| `checks` required with `failedChecks` | Hard fail if failedChecks is provided but checks is empty |
| `allowedWorkerClasses` enum | Hard fail if any entry is not `all`, `fix-only`, or `docs` |
| `state=green` with failed checks | Warning (non-blocking) |

### 2. Schema Validation (post-construction)

After the full marker object is assembled, it is validated against the schema
constraints via `Test-MarkerAgainstSchema`:

| Constraint | Source |
|-----------|--------|
| `markerVersion` must be `1` | Schema `const` |
| `state` must be valid enum | Schema `enum` |
| `commitSha` must be 7-40 hex | Schema `pattern` |
| `capturedAt` must be non-empty | Schema `format: date-time` |
| `checks` must be array of non-empty strings | Schema `items.minLength` |
| `failedChecks` must be array of non-empty strings | Schema `items.minLength` |
| `allowedWorkerClasses` entries must be valid enum | Schema `items.enum` |
| `reason` if present must be non-empty | Schema `minLength` |

Schema validation runs after construction so it catches any structural
inconsistencies that input validation alone might miss (e.g. a future code
path that sets an invalid `markerVersion`).

---

## Validation Modes

| Mode | Flag | Behavior |
|------|------|----------|
| **Normal** | *(none)* | Validate, print JSON, write file |
| **Dry-run** | `-DryRun` | Validate, print JSON, do not write |
| **Validate-only** | `-ValidateOnly` | Validate, exit 0 on success / 1 on failure |

---

## Usage

### Preview without writing

```powershell
./scripts/ai/write-main-health-state.ps1 -State green -DryRun
```

### Validate only (CI / pre-commit)

```powershell
./scripts/ai/write-main-health-state.ps1 -State yellow -Checks "tsc,build" -FailedChecks "build" -ValidateOnly
```

### Full write with reason

```powershell
./scripts/ai/write-main-health-state.ps1 -State red -Checks "tsc,build" -FailedChecks "tsc,build" -Reason "Type-check and build broken"
```

---

## Error Behavior

All validation failures are **hard errors** (exit code 1):

- Input validation errors are printed as `[fail]` lines before the marker is
  constructed.
- Schema validation errors are printed as a numbered list after construction,
  with each constraint violation on its own line.

Warnings (e.g. green state with failed checks) are printed as `[warn]` lines
but do not block execution.

---

## Relationship to health-state.schema.json

The schema file (`schemas/health-state.schema.json`) is the formal
draft-07 JSON Schema for the marker. The writer's validation mirrors its
constraints as procedural checks because PowerShell lacks a native JSON Schema
validator. If the schema changes (e.g. new enum values, new required fields),
the writer's `Test-MarkerAgainstSchema` function and the constants at the top
of the script must be updated in lockstep.

### Constants to update

| Constant | Schema property |
|----------|----------------|
| `$script:SchemaValidWorkerClasses` | `allowedWorkerClasses.items.enum` |
| `$script:SchemaValidStates` | `state.enum` |
| `$script:SchemaFailureCategories` | `definitions.FailureClassification.properties.category.enum` |
| `$script:SchemaConfidenceLevels` | `definitions.FailureClassification.properties.confidence.enum` |

---

## References

- [health-state-schema.md](health-state-schema.md) -- Field-level schema documentation
- [main-health-policy.md](main-health-policy.md) -- State semantics and worker permission matrix
- [write-main-health-state.ps1](../../scripts/ai/write-main-health-state.ps1) -- Writer script
- [schemas/health-state.schema.json](../../schemas/health-state.schema.json) -- Formal JSON Schema
