# Groups Migration Decomposition Example

Concrete decomposition of the GROUPS feature migration into
independent fact-change tasks governed by DAG ordering, writeSet,
and sharedLocks.

> **Closes:** [#1045](https://github.com/taoyu051818-sys/lian-nest-server/issues/1045)
>
> **Cross-references:**
> [parallel-task-decomposition-policy.md](parallel-task-decomposition-policy.md)
> for the decomposition model and concurrency rules,
> [task-dag-scheduling-policy.md](task-dag-scheduling-policy.md) for
> the six-stage pipeline DAG,
> [fact-change-task-template.md](fact-change-task-template.md) for
> the reusable task template,
> [backend-task-json-examples.md](backend-task-json-examples.md) for
> tier-specific JSON examples,
> [orchestration.md](orchestration.md) for the AppModule shared-lock
> pattern.

---

## Audience

Orchestrators and architects who need to decompose a feature migration
into governed, parallel-safe tasks. This example demonstrates how to
apply fact-change decomposition, DAG ordering, writeSet boundaries,
sharedLocks, and risk tiers to a concrete NestJS module migration.

---

## GROUPS Feature Scope

The GROUPS feature family provides four endpoints:

| Endpoint | Method | Auth required |
|----------|--------|---------------|
| `/api/groups` | GET | No |
| `/api/groups/:slug` | GET | No |
| `/api/groups/:slug/join` | POST | Yes |
| `/api/groups/:slug/leave` | DELETE | Yes |

Module path: `src/groups/` (GroupsModule). Depends on AUTH for the
join/leave guards. Listed as NOT_STARTED in the migration matrix,
Wave 3, priority P3.

---

## Decomposition

The migration is decomposed into seven independent fact-change tasks
following the six-stage pipeline DAG:

```
contract → fixture → provider → runtime → test → matrix-update
```

AppModule wiring is an additional runtime task serialized via
`sharedLocks: ["app-module"]`.

### DAG Diagram

```
Level 0:  [groups-contract]
              │
              ▼
Level 1:  [groups-fixture] ∥ [groups-provider]     ← parallel
              │                   │
              ▼                   ▼
Level 2:  [groups-runtime]                           ← waits for both
              │
              ├──────────────────┐
              ▼                  ▼
Level 3:  [groups-test]  ∥ [groups-appmodule-wire]   ← parallel*
              │                  │
              ▼                  ▼
Level 4:  [groups-matrix-update]                     ← waits for both

* test and appmodule-wire are parallel ONLY if writeSets are disjoint.
  appmodule-wire holds sharedLocks: ["app-module"] so it serializes
  with any other module-wiring task in the same batch.
```

---

## Task 1: Contract

**Stage:** contract | **Level:** 0 | **Risk:** low

Defines the groups endpoint contract — response shapes, error codes,
and slug format rules. No runtime code. Produces the foundational fact
that all downstream tasks depend on.

```json
{
  "taskType": "execution",
  "workerClass": "fact-change-worker",
  "risk": "low",
  "conflictGroup": "groups-contract",
  "targetIssue": null,
  "targetPR": null,
  "issues": [],
  "expectedPR": true,
  "allowedFiles": [
    "docs/contracts/groups-contract.md",
    "docs/ai-native/groups-contract.md"
  ],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    ".env",
    "**/.env",
    "node_modules/**",
    "dist/**",
    "llm_io_logs/**",
    "C:/Users/LENOVO/.claude/**",
    "package.json",
    "package-lock.json"
  ],
  "writeSet": [
    "docs/contracts/groups-contract.md"
  ],
  "sharedLocks": [
    "docs-index"
  ],
  "validation": [
    "npm run check"
  ],
  "dependsOnFacts": [],
  "producesFacts": [
    {
      "factId": "fact:groups:contract-defined",
      "description": "Groups endpoint contract defines list, single, join, and leave response shapes",
      "confidence": "definite"
    }
  ],
  "actorRole": "fact-change-worker",
  "roleDescription": "Define the groups API contract with response shapes, error codes, and slug format rules.",
  "requiredReviewRoles": ["ai-architecture-reviewer"],
  "acceptanceOwner": "taoyu051818-sys",
  "budget": {
    "maxFiles": 2,
    "maxLinesChanged": 200,
    "softTimeMinutes": 20,
    "hardTimeMinutes": 40
  },
  "rollbackPlan": {
    "strategy": "git-revert",
    "notes": "Docs-only change. Revert commit to roll back."
  },
  "telemetry": {
    "emitHeartbeat": true,
    "heartbeatIntervalSeconds": 120,
    "logLevel": "normal",
    "tags": ["groups-migration", "contract", "low-risk"]
  }
}
```

---

## Task 2: Fixture

**Stage:** fixture | **Level:** 1 | **Risk:** low

Creates test fixtures for groups — sample group data, slug formats,
and membership records. No runtime code.

**Parallel-safe with Task 3 (provider):** disjoint writeSets, no
fact dependency between them, both low-risk.

```json
{
  "taskType": "execution",
  "workerClass": "fact-change-worker",
  "risk": "low",
  "conflictGroup": "groups-fixture",
  "targetIssue": null,
  "targetPR": null,
  "issues": [],
  "expectedPR": true,
  "allowedFiles": [
    "tests/fixtures/groups/**"
  ],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    ".env",
    "**/.env",
    "node_modules/**",
    "dist/**",
    "llm_io_logs/**",
    "C:/Users/LENOVO/.claude/**",
    "package.json",
    "package-lock.json"
  ],
  "writeSet": [
    "tests/fixtures/groups/groups.fixture.ts",
    "tests/fixtures/groups/memberships.fixture.ts"
  ],
  "sharedLocks": [],
  "validation": [
    "npm run check"
  ],
  "dependsOnFacts": [
    {
      "factId": "fact:groups:contract-defined",
      "description": "Groups endpoint contract must exist before creating matching fixtures",
      "source": "Task 1 (groups-contract)"
    }
  ],
  "producesFacts": [
    {
      "factId": "fact:groups:fixtures-ready",
      "description": "Groups test fixtures cover list, single, join, and leave scenarios",
      "confidence": "definite"
    }
  ],
  "actorRole": "fact-change-worker",
  "roleDescription": "Create groups test fixtures matching the contract response shapes.",
  "requiredReviewRoles": ["ai-architecture-reviewer"],
  "acceptanceOwner": "taoyu051818-sys",
  "budget": {
    "maxFiles": 3,
    "maxLinesChanged": 200,
    "softTimeMinutes": 20,
    "hardTimeMinutes": 40
  },
  "rollbackPlan": {
    "strategy": "git-revert",
    "notes": "Fixture-only change. Revert commit to roll back."
  },
  "telemetry": {
    "emitHeartbeat": true,
    "heartbeatIntervalSeconds": 120,
    "logLevel": "normal",
    "tags": ["groups-migration", "fixture", "low-risk"]
  }
}
```

---

## Task 3: Provider

**Stage:** provider | **Level:** 1 | **Risk:** low

Registers the groups provider pool config and defines auth guard
requirements for the join/leave endpoints.

**Parallel-safe with Task 2 (fixture):** disjoint writeSets, no
fact dependency between them, both low-risk.

```json
{
  "taskType": "execution",
  "workerClass": "fact-change-worker",
  "risk": "low",
  "conflictGroup": "groups-provider",
  "targetIssue": null,
  "targetPR": null,
  "issues": [],
  "expectedPR": true,
  "allowedFiles": [
    "docs/migration/groups-provider-config.md"
  ],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    ".env",
    "**/.env",
    "node_modules/**",
    "dist/**",
    "llm_io_logs/**",
    "C:/Users/LENOVO/.claude/**",
    "package.json",
    "package-lock.json"
  ],
  "writeSet": [
    "docs/migration/groups-provider-config.md"
  ],
  "sharedLocks": [
    "docs-index"
  ],
  "validation": [
    "npm run check"
  ],
  "dependsOnFacts": [
    {
      "factId": "fact:groups:contract-defined",
      "description": "Groups contract must exist before defining provider config referencing it",
      "source": "Task 1 (groups-contract)"
    }
  ],
  "producesFacts": [
    {
      "factId": "fact:groups:provider-config",
      "description": "Groups provider pool config defines auth guard requirements for join/leave",
      "confidence": "definite"
    }
  ],
  "actorRole": "fact-change-worker",
  "roleDescription": "Define groups provider pool config and auth guard requirements for join/leave endpoints.",
  "requiredReviewRoles": ["ai-architecture-reviewer"],
  "acceptanceOwner": "taoyu051818-sys",
  "budget": {
    "maxFiles": 1,
    "maxLinesChanged": 150,
    "softTimeMinutes": 15,
    "hardTimeMinutes": 30
  },
  "rollbackPlan": {
    "strategy": "git-revert",
    "notes": "Docs-only change. Revert commit to roll back."
  },
  "telemetry": {
    "emitHeartbeat": true,
    "heartbeatIntervalSeconds": 120,
    "logLevel": "normal",
    "tags": ["groups-migration", "provider", "low-risk"]
  }
}
```

---

## Task 4: Runtime

**Stage:** runtime | **Level:** 2 | **Risk:** high

Implements the GroupsModule — controller, service, DTOs, and auth
guards for join/leave. This is the core runtime task. Touches `src/**`
and requires AUTH integration.

**Serialized:** Depends on both fixture and provider. High-risk —
only one high-risk task in-flight at a time.

```json
{
  "taskType": "execution",
  "workerClass": "backend-runtime",
  "risk": "high",
  "conflictGroup": "groups-runtime",
  "targetIssue": null,
  "targetPR": null,
  "issues": [],
  "expectedPR": true,
  "allowedFiles": [
    "src/groups/**"
  ],
  "forbiddenFiles": [
    "prisma/**",
    ".env",
    "**/.env",
    "node_modules/**",
    "dist/**",
    "llm_io_logs/**",
    "C:/Users/LENOVO/.claude/**",
    "package.json",
    "package-lock.json"
  ],
  "writeSet": [
    "src/groups/groups.controller.ts",
    "src/groups/groups.service.ts",
    "src/groups/dto/group-response.dto.ts",
    "src/groups/groups.module.ts"
  ],
  "sharedLocks": [
    "prisma-schema"
  ],
  "validation": [
    "npm run check",
    "npm run build"
  ],
  "dependsOnFacts": [
    {
      "factId": "fact:groups:contract-defined",
      "description": "Endpoint shapes must be defined before implementing controllers",
      "source": "Task 1 (groups-contract)"
    },
    {
      "factId": "fact:groups:fixtures-ready",
      "description": "Fixtures must exist for runtime to validate against expected shapes",
      "source": "Task 2 (groups-fixture)"
    },
    {
      "factId": "fact:groups:provider-config",
      "description": "Auth guard requirements must be defined before implementing join/leave guards",
      "source": "Task 3 (groups-provider)"
    }
  ],
  "producesFacts": [
    {
      "factId": "fact:groups:module-implemented",
      "description": "GroupsModule implements list, single, join, and leave endpoints with auth guards",
      "confidence": "definite"
    }
  ],
  "actorRole": "backend-runtime",
  "roleDescription": "Implement GroupsModule with controller, service, DTOs, and auth guards for join/leave.",
  "requiredReviewRoles": ["backend-programmer", "architect"],
  "acceptanceOwner": "taoyu051818-sys",
  "budget": {
    "maxFiles": 8,
    "maxLinesChanged": 500,
    "softTimeMinutes": 45,
    "hardTimeMinutes": 90
  },
  "rollbackPlan": {
    "strategy": "git-revert",
    "notes": "Self-contained module. Revert commit removes GroupsModule entirely. No shared file changes."
  },
  "telemetry": {
    "emitHeartbeat": true,
    "heartbeatIntervalSeconds": 120,
    "logLevel": "normal",
    "tags": ["groups-migration", "runtime", "high-risk"]
  }
}
```

---

## Task 5: Test

**Stage:** test | **Level:** 3 | **Risk:** medium

Integration tests for all four groups endpoints. Tests auth guards
on join/leave, slug validation, and error cases.

**Parallel-safe with Task 6 (appmodule-wire):** disjoint writeSets
(test writes `tests/`, appmodule writes `src/app.module.ts`). Both
depend on the runtime fact. Medium-risk can parallel with low-risk.

```json
{
  "taskType": "execution",
  "workerClass": "fact-change-worker",
  "risk": "medium",
  "conflictGroup": "groups-test",
  "targetIssue": null,
  "targetPR": null,
  "issues": [],
  "expectedPR": true,
  "allowedFiles": [
    "tests/groups/**"
  ],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    ".env",
    "**/.env",
    "node_modules/**",
    "dist/**",
    "llm_io_logs/**",
    "C:/Users/LENOVO/.claude/**",
    "package.json",
    "package-lock.json"
  ],
  "writeSet": [
    "tests/groups/groups.controller.spec.ts",
    "tests/groups/groups.service.spec.ts"
  ],
  "sharedLocks": [],
  "validation": [
    "npm run check",
    "npm run test -- --testPathPattern=groups"
  ],
  "dependsOnFacts": [
    {
      "factId": "fact:groups:module-implemented",
      "description": "GroupsModule must exist before writing integration tests against it",
      "source": "Task 4 (groups-runtime)"
    }
  ],
  "producesFacts": [
    {
      "factId": "fact:groups:tests-pass",
      "description": "Groups integration tests pass for list, single, join, and leave endpoints",
      "confidence": "definite"
    }
  ],
  "actorRole": "fact-change-worker",
  "roleDescription": "Write integration tests for all four groups endpoints including auth guard coverage.",
  "requiredReviewRoles": ["ai-architecture-reviewer", "control-plane-reviewer"],
  "acceptanceOwner": "taoyu051818-sys",
  "budget": {
    "maxFiles": 4,
    "maxLinesChanged": 400,
    "softTimeMinutes": 30,
    "hardTimeMinutes": 60
  },
  "rollbackPlan": {
    "strategy": "git-revert",
    "notes": "Test-only change. Revert commit to roll back."
  },
  "telemetry": {
    "emitHeartbeat": true,
    "heartbeatIntervalSeconds": 120,
    "logLevel": "normal",
    "tags": ["groups-migration", "test", "medium-risk"]
  }
}
```

---

## Task 6: AppModule Wiring

**Stage:** runtime (wiring) | **Level:** 3 | **Risk:** medium

Wires GroupsModule into `app.module.ts`. Holds the `app-module`
shared lock — serialized with any other module-wiring task in the
same batch (e.g., SearchModule, TopicsModule).

**Serialized via sharedLocks:** If the batch contains other
`appmodule-wire-*` tasks, they dispatch one at a time. Within this
batch, it can parallel with Task 5 (test) because their writeSets
are disjoint.

```json
{
  "taskType": "execution",
  "workerClass": "fact-change-worker",
  "risk": "medium",
  "conflictGroup": "appmodule-wire-groups",
  "targetIssue": null,
  "targetPR": null,
  "issues": [],
  "expectedPR": true,
  "allowedFiles": [
    "src/app.module.ts"
  ],
  "forbiddenFiles": [
    "prisma/**",
    ".env",
    "**/.env",
    "node_modules/**",
    "dist/**",
    "llm_io_logs/**",
    "C:/Users/LENOVO/.claude/**",
    "package.json",
    "package-lock.json"
  ],
  "writeSet": [
    "src/app.module.ts"
  ],
  "sharedLocks": [
    "app-module"
  ],
  "validation": [
    "npm run check",
    "npm run build"
  ],
  "dependsOnFacts": [
    {
      "factId": "fact:groups:module-implemented",
      "description": "GroupsModule must exist before wiring it into AppModule",
      "source": "Task 4 (groups-runtime)"
    }
  ],
  "producesFacts": [
    {
      "factId": "fact:groups:appmodule-wired",
      "description": "GroupsModule is imported in app.module.ts",
      "confidence": "definite"
    }
  ],
  "actorRole": "fact-change-worker",
  "roleDescription": "Wire GroupsModule into app.module.ts. Serialized via app-module shared lock.",
  "requiredReviewRoles": ["backend-programmer", "architect"],
  "acceptanceOwner": "taoyu051818-sys",
  "budget": {
    "maxFiles": 1,
    "maxLinesChanged": 20,
    "softTimeMinutes": 10,
    "hardTimeMinutes": 20
  },
  "rollbackPlan": {
    "strategy": "git-revert",
    "notes": "Single-file change. Revert removes the GroupsModule import from app.module.ts."
  },
  "telemetry": {
    "emitHeartbeat": true,
    "heartbeatIntervalSeconds": 120,
    "logLevel": "normal",
    "tags": ["groups-migration", "appmodule-wire", "medium-risk"]
  }
}
```

---

## Task 7: Matrix Update

**Stage:** matrix-update | **Level:** 4 | **Risk:** low

Updates the migration matrix to mark GROUPS as complete. Records
which endpoints are implemented, tested, and wired.

**Serialized:** Depends on both test (hard edge) and appmodule-wire
(soft edge). Waits for both to merge.

```json
{
  "taskType": "execution",
  "workerClass": "fact-change-worker",
  "risk": "low",
  "conflictGroup": "groups-matrix",
  "targetIssue": null,
  "targetPR": null,
  "issues": [],
  "expectedPR": true,
  "allowedFiles": [
    "docs/migration/migration-matrix.md"
  ],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    ".env",
    "**/.env",
    "node_modules/**",
    "dist/**",
    "llm_io_logs/**",
    "C:/Users/LENOVO/.claude/**",
    "package.json",
    "package-lock.json"
  ],
  "writeSet": [
    "docs/migration/migration-matrix.md"
  ],
  "sharedLocks": [
    "docs-index"
  ],
  "validation": [
    "npm run check"
  ],
  "dependsOnFacts": [
    {
      "factId": "fact:groups:tests-pass",
      "description": "Tests must pass before marking GROUPS as complete in the matrix",
      "source": "Task 5 (groups-test)"
    },
    {
      "factId": "fact:groups:appmodule-wired",
      "description": "AppModule wiring must be merged before marking GROUPS as complete",
      "source": "Task 6 (groups-appmodule-wire)"
    }
  ],
  "producesFacts": [
    {
      "factId": "fact:groups:migration-complete",
      "description": "GROUPS family marked as COMPLETE in migration matrix with all 4 endpoints verified",
      "confidence": "definite"
    }
  ],
  "actorRole": "fact-change-worker",
  "roleDescription": "Update migration matrix to mark GROUPS as complete with endpoint status.",
  "requiredReviewRoles": ["ai-architecture-reviewer"],
  "acceptanceOwner": "taoyu051818-sys",
  "budget": {
    "maxFiles": 1,
    "maxLinesChanged": 50,
    "softTimeMinutes": 10,
    "hardTimeMinutes": 20
  },
  "rollbackPlan": {
    "strategy": "git-revert",
    "notes": "Docs-only change. Revert commit to roll back."
  },
  "telemetry": {
    "emitHeartbeat": true,
    "heartbeatIntervalSeconds": 120,
    "logLevel": "normal",
    "tags": ["groups-migration", "matrix-update", "low-risk"]
  }
}
```

---

## Concurrency Analysis

### writeSet Overlap Matrix

| Task | writeSet | Overlaps with |
|------|----------|---------------|
| 1. groups-contract | `docs/contracts/groups-contract.md` | None |
| 2. groups-fixture | `tests/fixtures/groups/*.ts` | None |
| 3. groups-provider | `docs/migration/groups-provider-config.md` | None |
| 4. groups-runtime | `src/groups/*.ts` | None |
| 5. groups-test | `tests/groups/*.ts` | None |
| 6. groups-appmodule-wire | `src/app.module.ts` | Any other `appmodule-wire-*` |
| 7. groups-matrix | `docs/migration/migration-matrix.md` | Any other `*-matrix` |

No two tasks in this batch have overlapping writeSets (except
Task 6 with other module-wiring tasks, which is handled by
sharedLocks).

### sharedLock Contention

| Task | sharedLocks | Contention |
|------|-------------|------------|
| 1. groups-contract | `docs-index` | Shared — concurrent reads OK |
| 2. groups-fixture | (none) | — |
| 3. groups-provider | `docs-index` | Shared — concurrent reads OK |
| 4. groups-runtime | `prisma-schema` | Shared — concurrent reads OK |
| 5. groups-test | (none) | — |
| 6. groups-appmodule-wire | `app-module` | **Exclusive** — serializes with other wiring tasks |
| 7. groups-matrix | `docs-index` | Shared — concurrent reads OK |

### Parallel Dispatch Summary

| Wave | Tasks | Parallel? | Constraint |
|------|-------|-----------|------------|
| Level 0 | 1. groups-contract | Solo | — |
| Level 1 | 2. groups-fixture + 3. groups-provider | **Yes** | Disjoint writeSets, both low-risk |
| Level 2 | 4. groups-runtime | Solo | High-risk serialization |
| Level 3 | 5. groups-test + 6. groups-appmodule-wire | **Yes** | Disjoint writeSets; appmodule-wire serializes with other wiring tasks |
| Level 4 | 7. groups-matrix | Solo | — |

**Total parallel waves:** 5 (down from 7 if fully serialized).
**Parallelizable pairs:** fixture+provider, test+appmodule-wire.

---

## Scheduling Narrative

1. **Dispatch Task 1 (contract).** No dependencies. Produces
   `fact:groups:contract-defined`.
2. **After Task 1 merges:** Dispatch Tasks 2 (fixture) and 3
   (provider) in parallel. Both depend only on the contract fact.
   Their writeSets are disjoint and both are low-risk.
3. **After Tasks 2 and 3 merge:** Dispatch Task 4 (runtime). It
   depends on all three upstream facts. High-risk — only this task
   runs. No other high-risk task may be in-flight.
4. **After Task 4 merges:** Dispatch Tasks 5 (test) and 6
   (appmodule-wire) in parallel. Both depend on
   `fact:groups:module-implemented`. Their writeSets are disjoint.
   Task 6 holds `sharedLocks: ["app-module"]` so it serializes with
   any other `appmodule-wire-*` task in a larger batch.
5. **After Tasks 5 and 6 merge:** Dispatch Task 7 (matrix-update).
   It depends on both `fact:groups:tests-pass` and
   `fact:groups:appmodule-wired`. Low-risk docs-only change.
6. **After Task 7 merges:** GROUPS migration is complete.

---

## Non-Goals

- No changes to `package.json`, Prisma schema, or Nest runtime
  modules outside `src/groups/`
- No implementation of the DAG scheduler (planning doc only)
- No bypass of the launch gate or human approval requirement for
  high-risk tasks
- No modification of the AUTH module — groups depends on AUTH but
  does not change it

---

## References

- [Parallel Task Decomposition Policy](parallel-task-decomposition-policy.md) — Decomposition model and concurrency rules
- [Task DAG Scheduling Policy](task-dag-scheduling-policy.md) — Six-stage pipeline DAG
- [Fact-Change Task Template](fact-change-task-template.md) — Reusable task template
- [Backend Task JSON Examples](backend-task-json-examples.md) — Tier-specific examples
- [Orchestration](orchestration.md) — AppModule shared-lock pattern
- [Migration Matrix](../migration/migration-matrix.md) — GROUPS status tracking
- [Route Parity CI Rollout](../migration/route-parity-ci-rollout.md) — GROUPS endpoint definitions
