# Main Health Writer Fixture Coverage

Documents the schema fixture test suite for `write-main-health-state.ps1`.

> **Test script:** [`scripts/ai/write-main-health-state.schema.test.ps1`](../../scripts/ai/write-main-health-state.schema.test.ps1)
> **Closes:** [#455](https://github.com/taoyu051818-sys/lian-nest-server/issues/455)

---

## Purpose

The fixture test exercises every code path in the main health state writer's
validation logic without writing files. Each fixture invokes the writer in
`-ValidateOnly` mode and asserts the expected exit code.

This provides regression coverage for the schema validation contract defined in
[`schemas/health-state.schema.json`](../../schemas/health-state.schema.json)
and the procedural checks in
[`write-main-health-state.ps1`](../../scripts/ai/write-main-health-state.ps1).

---

## Fixture Categories

### State Coverage (expect exit 0)

| Fixture | State | Description |
|---------|-------|-------------|
| `green: minimal valid marker` | green | Smallest valid green marker |
| `green: all checks pass, empty failedChecks` | green | Explicit empty failedChecks |
| `green: with reason` | green | Optional reason field populated |
| `green: explicit allowedWorkerClasses=all` | green | Explicit worker class override |
| `green: 40-char SHA (max length)` | green | Maximum commitSha length |
| `green: 7-char SHA (min length)` | green | Minimum commitSha length |
| `yellow: single failed check` | yellow | One check fails, default worker classes |
| `yellow: default allowedWorkerClasses` | yellow | Verifies default yellow classes |
| `yellow: explicit allowedWorkerClasses=fix-only,docs` | yellow | Explicit class override |
| `yellow: with reason` | yellow | Reason field populated |
| `red: multiple failed checks` | red | Two checks fail |
| `red: empty allowedWorkerClasses` | red | Empty worker class array |
| `red: with reason` | red | Reason field populated |
| `black: unrecoverable state` | black | All checks fail |
| `black: empty checks and failedChecks` | black | Empty arrays (manual intervention) |

### Validation Failure Fixtures (expect exit 1)

| Fixture | Rule Violated |
|---------|---------------|
| `reject: invalid SHA (too short)` | commitSha must be 7-40 hex |
| `reject: invalid SHA (non-hex)` | commitSha hex pattern |
| `reject: invalid SHA (too long)` | commitSha max length |
| `reject: failedCheck not in checks` | failedChecks subset of checks |
| `reject: failedChecks provided but checks empty` | checks required with failedChecks |
| `reject: invalid allowedWorkerClass` | allowedWorkerClasses enum |

### DryRun Mode Fixtures (expect exit 0)

| Fixture | Description |
|---------|-------------|
| `dryrun: green state prints JSON` | DryRun prints JSON without writing |
| `dryrun: red state prints JSON` | DryRun with failed checks |

---

## Schema Constraints Covered

| Constraint | Source | Fixtures |
|-----------|--------|----------|
| `markerVersion` const 1 | schema | All valid fixtures |
| `state` enum | schema + ValidateSet | All state fixtures |
| `commitSha` 7-40 hex | schema + Assert-ValidSha | SHA min/max/reject fixtures |
| `capturedAt` non-empty | schema | All valid fixtures |
| `checks` array of strings | schema | All valid fixtures |
| `failedChecks` array of strings | schema | All valid fixtures |
| `allowedWorkerClasses` enum | schema + procedural | Worker class fixtures |
| `reason` non-empty if present | schema | Reason fixtures |
| failedChecks subset of checks | procedural | Consistency reject fixture |
| checks required with failedChecks | procedural | Empty checks reject fixture |
| green + failedChecks warning | procedural | Green fixtures |

---

## Execution

```powershell
pwsh ./scripts/ai/write-main-health-state.schema.test.ps1
```

The script prints a per-fixture `[PASS]`/`[FAIL]` line and a summary at the
end. Exit code 0 = all fixtures passed, 1 = at least one failure.

---

## References

- [health-state-schema.md](health-state-schema.md) — Field-level schema documentation
- [main-health-schema-validation.md](main-health-schema-validation.md) — Validation layers
- [main-health-policy.md](main-health-policy.md) — State semantics and worker permission matrix
- [write-main-health-state.ps1](../../scripts/ai/write-main-health-state.ps1) — Writer script
- [schemas/health-state.schema.json](../../schemas/health-state.schema.json) — Formal JSON Schema
