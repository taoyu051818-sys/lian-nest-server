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

## Failure Categories

When checks fail, the script groups failures by worker category:

| Category | Meaning |
|---|---|
| `dependency/generate` | Missing or stale dependencies, Prisma generate needed |
| `boundary guard` | Repository boundary violations (data-store imports outside `src/repositories/`) |
| `test env` | Test failures, missing environment variables |
| `conflict refresh` | TypeScript conflicts after merge, rebase needed |
| `runtime compile` | Build or compilation errors in source files |

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
