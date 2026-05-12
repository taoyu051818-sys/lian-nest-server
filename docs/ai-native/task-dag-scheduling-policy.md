# Task DAG Scheduling Policy

Defines the directed acyclic graph (DAG) for task pipeline stages,
which edges permit parallel execution, and how governed parallel
decomposition applies to independent fact changes.

> **Closes:** [#1033](https://github.com/taoyu051818-sys/lian-nest-server/issues/1033)

---

## Pipeline DAG

The canonical task pipeline forms a six-stage DAG:

```
contract → fixture → provider → runtime → test → matrix-update
```

### Stage Definitions

| Stage | Output | writeSet | Risk |
|-------|--------|----------|------|
| contract | Task JSON, worker contract docs | `docs/ai-native/*.md`, task JSON files | low |
| fixture | Test fixtures, mock data | `tests/fixtures/**`, `__mocks__/**` | low |
| provider | Provider pool config, credential rotation | `.github/ai-state/provider-pool.json`, policy files | medium |
| runtime | NestJS modules, services, controllers | `src/**` | high |
| test | Integration/unit test files | `tests/**`, `src/**/*.spec.ts` | medium |
| matrix-update | Migration matrix, source matrix | `docs/migration/**`, `docs/ai-native/*-matrix*.md` | low |

### Edge Rules

```
contract ──→ fixture      (hard edge: fixture depends on contract shape)
contract ──→ provider     (hard edge: provider config references contract)
fixture  ──→ runtime      (hard edge: runtime imports fixture types)
provider ──→ runtime      (hard edge: runtime uses provider credentials)
runtime  ──→ test         (hard edge: test imports runtime modules)
runtime  ──→ matrix-update (soft edge: matrix can update from partial runtime)
test     ──→ matrix-update (hard edge: matrix marks tested endpoints)
```

A **hard edge** means the downstream stage MUST wait for the upstream
stage to merge before launching. A **soft edge** means the downstream
stage MAY launch before the upstream merges, but MUST re-validate after.

---

## Parallel Decomposition

### Independent Fact Changes

Two stages can run in parallel when their `writeSet` files do not
intersect and neither has a hard edge to the other.

| Pair | Parallel? | Reason |
|------|-----------|--------|
| contract + provider | NO | provider reads contract shape |
| fixture + provider | YES | disjoint writeSets, no hard edge |
| fixture + matrix-update | YES | disjoint writeSets |
| provider + test | NO | test may depend on provider state |
| runtime + matrix-update | NO | soft edge; matrix-update re-validates |

### writeSet and sharedLocks

Each stage declares its `writeSet` — the set of files it modifies. The
launch gate uses writeSet intersection to detect conflicts:

```
writeSet(A) ∩ writeSet(B) ≠ ∅  →  A and B cannot run in parallel
```

Stages that touch shared resources (e.g., `app.module.ts`, `package.json`)
declare `sharedLocks` to force serialization even when writeSets are
otherwise disjoint. See [Parallel Work Policy](parallel-work-policy.md)
Rule 5.

### Risk-Tier Concurrency

Concurrency is further gated by risk tier:

| Risk | Concurrency rule |
|------|-----------------|
| low | May run in parallel with any other low-risk stage |
| medium | May run in parallel with low-risk; serial with medium/high |
| high | Always serial; requires dedicated worker slot |

This prevents two medium-risk stages from racing on overlapping
resources while still allowing low-risk doc/fixture work to proceed
concurrently.

---

## DAG Traversal Strategy

The orchestrator traverses the DAG using a topological sort with
parallelism constraints:

1. **Level 0** — `contract` (no upstream dependencies)
2. **Level 1** — `fixture`, `provider` (both depend only on contract;
   can run in parallel if writeSets are disjoint)
3. **Level 2** — `runtime` (depends on fixture + provider; launches
   only after both merge)
4. **Level 3** — `test` (depends on runtime)
5. **Level 4** — `matrix-update` (depends on test; soft edge from
   runtime allows early launch with re-validation)

```
Level 0:  [contract]
              │
              ▼
Level 1:  [fixture] ∥ [provider]     ← parallel if writeSets disjoint
              │            │
              ▼            ▼
Level 2:  [runtime]                   ← waits for both
              │
              ▼
Level 3:  [test]
              │
              ▼
Level 4:  [matrix-update]
```

### Re-validation After Soft-Edge Merge

When a soft-edge downstream stage completes before its upstream merges,
the orchestrator MUST:

1. Rebase the downstream branch on the new `main` (now containing the
   upstream merge).
2. Re-run `npm run check` and the stage's validation commands.
3. If validation fails, comment a blocker on the downstream issue and
   pause the stage.

---

## Validation Per Stage

| Stage | Validation commands | Gate policy |
|-------|-------------------|-------------|
| contract | `npm run check` | `gate-docs-only` |
| fixture | `npm run check` | `gate-docs-only` |
| provider | `npm run check` | `gate-docs-only` |
| runtime | `npm run check`, `npm run build` | `gate-all` |
| test | `npm run check`, `npm run test` | `gate-all` |
| matrix-update | `npm run check` | `gate-docs-only` |

---

## Rollback

Each stage is a single PR. Rollback is a revert commit. When a
downstream stage fails after a soft-edge re-validation:

1. Revert the downstream PR.
2. The upstream merge remains valid (no rollback needed).
3. Re-launch the downstream stage with the corrected context.

When a hard-edge upstream fails:

1. Revert the upstream PR.
2. All downstream stages are blocked until the upstream re-merges.
3. The orchestrator pauses the downstream conflict groups.

---

## Integration Points

| Component | Role in DAG scheduling |
|-----------|----------------------|
| [Launch Gate](launch-gate.md) | Validates health policy and conflict groups before each stage launch |
| [Parallel Work Policy](parallel-work-policy.md) | Defines conflict groups and shared lock rules |
| [Resource Slot Scheduling](resource-slot-scheduling.md) | Allocates worker slots across resource dimensions |
| [Worker Task Contract](worker-task-contract.md) | Defines the task JSON schema each stage emits |
| [Orchestration](orchestration.md) | Batch launcher that traverses the DAG |

---

## See Also

- [Parallel Work Policy](parallel-work-policy.md) — Conflict groups and parallelism rules
- [Resource Slot Scheduling](resource-slot-scheduling.md) — Four-dimension slot model
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Launch Gate](launch-gate.md) — Pre-launch validation
- [Controlled Auto-Merge](controlled-auto-merge.md) — Batch merge script
- [#1033](https://github.com/taoyu051818-sys/lian-nest-server/issues/1033) — This feature
