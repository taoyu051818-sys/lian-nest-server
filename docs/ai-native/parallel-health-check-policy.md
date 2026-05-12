# Parallel Health Check Policy

Defines which health checks can execute concurrently and how a single
health state decision is composed from independent check results. Applies
governed parallel decomposition: only independent fact changes run
concurrently; shared truth and high-risk boundaries remain serialized.

> **Closes:** [#1047](https://github.com/taoyu051818-sys/lian-nest-server/issues/1047)

---

## Problem

The post-merge health gate runs multiple checks (`tsc`, `build`, `prisma
validate`, boundary guard, tests) sequentially. Some checks are independent
(read-only, no shared mutable state) and can safely run in parallel.
Others share inputs or write side-effects and must remain serialized.
Without a policy, either all checks run serially (slow) or the gate risks
data races from unchecked parallelism.

---

## Check Dependency Graph

```
          ┌──────────┐
          │  npm run  │
          │  check    │
          │  (tsc)    │
          └────┬─────┘
               │ (independent)
          ┌────┴─────┐
          │ npm run   │
          │ build     │
          └────┬─────┘
               │
     ┌─────────┴──────────┐
     │                    │
┌────┴──────┐     ┌──────┴──────┐
│ prisma    │     │ boundary    │
│ validate  │     │ guard       │
└────┬──────┘     └──────┬──────┘
     │ (independent)      │ (independent)
     └─────────┬──────────┘
               │
        ┌──────┴──────┐
        │  npm test   │
        │  (full)     │
        └─────────────┘
```

---

## Parallelism Tiers

Checks are grouped into tiers based on their dependency relationships.
Checks within the same tier may run concurrently; tiers execute
sequentially.

### Tier 1: Type-Check (serialized)

| Check | Command | Depends On | Side Effects |
|-------|---------|------------|--------------|
| TypeScript type-check | `npm run check` | None | None (read-only) |

This check must complete before Tier 2 because both `build` and
downstream checks rely on the type-check succeeding. Running `build`
before `tsc` wastes cycles when types are broken.

**Rationale for serialization:** `build` consumes the same source files
as `tsc`. While `build` does not depend on `tsc` output files, running
them in parallel doubles CPU pressure with no time savings on a
type-error branch.

### Tier 2: Build + Independent Validators (parallel)

| Check | Command | Depends On | writeSet | sharedLocks |
|-------|---------|------------|----------|-------------|
| NestJS build | `npm run build` | Tier 1 pass | `dist/` | None |
| Prisma validate | `npx prisma validate` | None | None | `prisma-schema` |
| Boundary guard | `npm run test:boundary` | None | None | None |

These three checks are independent:
- **build** writes to `dist/` (not read by other checks).
- **prisma validate** reads `prisma/schema.prisma` only; produces no
  output files.
- **boundary guard** reads source tree for import analysis; no writes.

No `sharedLocks` conflict exists because no check writes to a file read
by another.

### Tier 3: Test Suite (serialized after Tier 2)

| Check | Command | Depends On | Side Effects |
|-------|---------|------------|--------------|
| Jest tests | `npm test -- --runInBand` | Tier 2 pass | Test DB writes, temp files |

Tests depend on a successful build (Tier 2) because they import
compiled modules. Tests also write to the test database and temp
directories, so they cannot run in parallel with boundary guard.

---

## writeSet / sharedLocks Model

Each check declares what files it reads and writes. Two checks may run
in parallel only if their write sets are disjoint and no check reads a
file another writes.

| Check | Reads | Writes | Conflict With |
|-------|-------|--------|---------------|
| `tsc` | `src/**`, `tsconfig.json` | None | None |
| `build` | `src/**`, `tsconfig.json`, `nest-cli.json` | `dist/**` | None |
| `prisma validate` | `prisma/schema.prisma` | None | None |
| boundary guard | `src/**`, `docs/**` | None | None |
| Jest tests | `dist/**`, `prisma/**`, `.env.test` | Test DB, temp dirs | Cannot parallel with boundary guard (both read `src/**` but tests also write DB) |

**Conflict rule:** Two checks conflict if `writeSet(A) ∩ reads(B) ≠ ∅`
or `writeSet(B) ∩ reads(A) ≠ ∅`. Same-file reads are safe (no
mutation).

---

## Risk Tiers

Checks are classified by failure impact. Higher-risk checks gate
lower-risk ones.

| Risk Tier | Checks | Failure Impact |
|-----------|--------|---------------|
| Critical | `tsc`, `build`, `prisma validate` | Blocks all downstream work |
| Warning | boundary guard | Does not block merge (warn-only) |
| Informational | guard warnings, telemetry | No merge impact |

Critical-tier failures immediately halt the gate and prevent any further
checks from running (fail-fast). Warning-tier failures are recorded but
do not block the gate exit code.

---

## Gate Execution Flow

```
post-merge-health-gate.js
       │
       ▼
  Tier 1: npm run check (tsc)
       │
       ├── FAIL → exit 1, classify failure
       │
       ▼ PASS
  Tier 2: parallel { npm run build, npx prisma validate, npm run test:boundary }
       │
       ├── ANY FAIL → exit 1, classify failures
       │   (continue remaining Tier 2 checks for full report)
       │
       ▼ ALL PASS
  Tier 3: npm test -- --runInBand (if --full mode)
       │
       ├── FAIL → exit 1, classify failure
       │
       ▼ PASS
  Guard reporting (non-blocking)
       │
       ▼
  exit 0
```

### Fail-Fast vs. Full-Report

| Mode | Tier 1 Failure | Tier 2 Failure | Tier 3 Failure |
|------|---------------|---------------|---------------|
| `--quick` | Stop immediately | Run remaining Tier 2, then stop | Not reached |
| `--full` | Stop immediately | Run remaining Tier 2, then stop | Run to completion, report all |

Tier 1 always fail-fasts because a type error invalidates all subsequent
checks. Within Tier 2, remaining checks continue to completion so the
full report shows all failures at once.

---

## Aggregation and State Decision

The gate composes a single health state from all check results:

1. Collect pass/fail for each check.
2. Classify each failure using the categories in
   [post-merge-health-gate.md](post-merge-health-gate.md).
3. Apply the state decision matrix from
   [main-health-policy.md](main-health-policy.md):
   - Any critical-category failure → **Red**
   - Only warning-category failures → **Yellow**
   - All pass → **Green**
4. Write the health marker via
   [write-main-health-state.ps1](../../scripts/ai/write-main-health-state.ps1).

The aggregation is deterministic: same check results always produce the
same state, regardless of execution order.

---

## Rollback on Health Gate Failure

When the gate detects a failure after a merge batch:

1. The orchestrator reads the failure classifications.
2. If the state is **red**, the orchestrator:
   - Blocks new worker dispatch.
   - Launches a recovery worker matching the failure category.
   - Does NOT revert the merge automatically (revert requires human
     approval for `src/**` changes).
3. If the state is **yellow**, the orchestrator:
   - Logs the warning.
   - Continues dispatching permitted worker types per
     [main-health-policy.md](main-health-policy.md).

---

## Non-Goals

- No changes to `package.json`, Prisma schema, or Nest runtime modules.
- No implementation of the parallel runner script (policy doc only).
- No bypass of existing health gate exit codes or failure categories.

---

## References

- [Post-Merge Health Gate](post-merge-health-gate.md) — Health gate runner and failure categories.
- [Main Health Policy](main-health-policy.md) — Health states and worker permission matrix.
- [Health State Schema](health-state-schema.md) — Health marker JSON schema.
- [Parallel Work Policy](parallel-work-policy.md) — Conflict groups and parallelism rules.
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema.
- [Resource Slot Scheduling](resource-slot-scheduling.md) — Slot model for parallel dispatch.
- [Controlled Auto-Merge](controlled-auto-merge.md) — Post-merge health gate integration.
