# Post-Merge Health Gate

Automated health check runner for validating repository state after merging PRs.

## Quick Start

```bash
# Fast checks (default): type-check, build, prisma validate
node scripts/post-merge-health-gate.js --quick

# Full checks: quick + boundary guard + tests
node scripts/post-merge-health-gate.js --full

# Help
node scripts/post-merge-health-gate.js --help
```

## Modes

### `--quick` (default)

Runs fast, non-destructive checks:

1. `npm run check` — TypeScript type-check (`tsc --noEmit`)
2. `npm run build` — NestJS build
3. `npx prisma validate` — Prisma schema validation (if `prisma/schema.prisma` exists)

### `--full`

Includes everything in `--quick`, plus:

4. `npm run test:boundary` — Repository boundary guard (if script exists)
5. `npm test -- --runInBand` — Full Jest test suite

## When to Use Each Mode

Use this table to pick the right mode after a merge or batch closure.
When in doubt, default to `--quick`.

| Scenario | Mode | Why |
|---|---|---|
| Docs-only or scripts-only batch | `--quick` | No runtime code changed; fast checks are sufficient |
| Single low-risk PR merge | `--quick` | Standard post-merge verification |
| Batch touching `src/**` (rare, requires human approval) | `--full` | Boundary guard and test suite catch cross-module regressions |
| Batch with 3+ PRs merged in sequence | `--full` | Higher interaction risk; tests catch ordering side-effects |
| Red-main recovery after a fix PR | `--full` | Confirm the fix didn't introduce new failures |
| Explicit operator request for thorough validation | `--full` | Per-operator judgment |

### Batch Closure Evidence

When closing a batch, record the health gate mode and result in the
merge batch manifest (written by `merge-clean-pr-batch.ps1`). The
manifest's `healthGate` field records `pass` or `fail`; append the
mode used to the PR closure comment for traceability:

```
Post-merge health gate: --quick PASS
```

or

```
Post-merge health gate: --full PASS
```

This makes the closure evidence self-documenting without relying on
session memory.

## Failure Categories

When checks fail, the script groups failures by worker category:

| Category | Meaning |
|---|---|
| `dependency/generate` | Missing or stale dependencies, Prisma generate needed, unresolved `@prisma/client` or `prisma/config` modules |
| `database foundation` | Prisma schema/migration issues, missing database baseline |
| `boundary guard` | Repository boundary violations (data-store imports outside `src/repositories/`) |
| `test env` | Test failures, missing environment variables |
| `conflict refresh` | TypeScript conflicts after merge, rebase needed |
| `runtime compile` | Build or compilation errors in source files |

### Prisma Generated-Client Error Detection

The script inspects check output for known Prisma client error patterns and
re-classifies failures as `dependency/generate` regardless of which check
originally produced them. Detected patterns include:

- `@prisma/client has no exported member PrismaClient`
- `Cannot find module '@prisma/client'`
- `Cannot find module 'prisma/config'`
- `Property '$connect' does not exist` / `Property '$disconnect' does not exist`
- Type mismatches involving `PrismaClient`

When `dependency/generate` is detected, the suggested next steps are:

1. `npm install`
2. `npx prisma generate`
3. `npx prisma validate`
4. If `PrismaClient` is still unresolved, issue or fix a database baseline migration

## Guard Reporting (Non-Blocking)

After health checks complete, the gate runs available guard scripts in **warning mode**. Guard results are informational only and never affect the exit code.

| Guard | Script | Inputs Required | Purpose |
|---|---|---|---|
| task boundary | `scripts/guards/check-task-boundary.js` | `.ai/task-manifest.json` | Verifies changed files are within allowed boundaries |
| pr handoff | `scripts/guards/check-pr-handoff.js` | `.ai/pr-body.md` | Checks PR body has required sections |
| docs authority | `scripts/guards/check-docs-authority.js` | `docs/` directory | Scans docs for duplicate/stale content |

Guards are skipped automatically when their required inputs are missing. The health gate reports which guards were skipped.

### Guard Output

Guard violations appear in a `GUARD WARNINGS (non-blocking)` section after the failure summary:

```
==================================================
GUARD WARNINGS (non-blocking)
==================================================

  [task boundary] — violations detected (warning only)
    - src/forbidden-file.ts

  Skipped (missing inputs): pr handoff
```

### Design Decisions

- Guards run in `--warn-only` / warning mode by default.
- Guards are skipped (not errors) when inputs are missing.
- Guard violations do not change the exit code.
- Guard output is parsed as JSON when available for structured reporting.

## Exit Codes

- `0` — All checks passed
- `1` — One or more checks failed
- `2` — Invalid arguments

## CI Integration

```yaml
# Example GitHub Actions step
- name: Post-merge health gate
  run: node scripts/post-merge-health-gate.js --quick
```

## Design Decisions

- No secrets or env values are printed in output.
- Timeout per check: 120 seconds.
- Only checks that are available in the current repo are run (auto-detected).
