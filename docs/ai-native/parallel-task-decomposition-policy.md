# Parallel Task Decomposition Policy

Defines how issues and opportunity signals are decomposed into
independent, concurrently executable tasks governed by fact
dependencies, write sets, shared locks, and risk tiers.

> **Closes:** [#1032](https://github.com/taoyu051818-sys/lian-nest-server/issues/1032)
>
> **Cross-references:**
> [parallel-work-policy.md](parallel-work-policy.md) for conflict
> groups and shared lock rules,
> [worker-task-contract.md](worker-task-contract.md) for the task
> JSON schema,
> [task-schema-v2.md](task-schema-v2.md) for `writeSet`,
> `sharedLocks`, `dependsOnFacts`, and `producesFacts` fields,
> [resource-slot-scheduling.md](resource-slot-scheduling.md) for
> slot-based concurrency limits,
> [controlled-auto-merge.md](controlled-auto-merge.md) for
> merge isolation and guard enforcement,
> [opportunity-to-task-compiler-contract.md](opportunity-to-task-compiler-contract.md)
> for signal-to-task field mapping.

---

## Audience

Orchestrators, architects, and compiler authors who need to decide
when two tasks can run in parallel, when they must serialize, and
how to bound each task so that concurrent execution is safe.

---

## Core Principle

**Only independent fact changes can run concurrently.** Shared truth
and high-risk boundaries remain serialized or human-gated.

A task is safe to parallelize when its `writeSet` does not overlap
another running task's `writeSet`, its `dependsOnFacts` are all
satisfied, and its risk tier permits concurrent dispatch.

---

## Decomposition Model

### Independent Fact Change

A task is an **independent fact change** when it satisfies all of:

| Criterion | Field | Rule |
|-----------|-------|------|
| Bounded writes | `writeSet` | Narrower than or equal to `allowedFiles`; no entry overlaps another running task's `writeSet` |
| Declared dependencies | `dependsOnFacts` | Every prerequisite fact is either already established or produced by a task that will complete before this task starts |
| Declared outputs | `producesFacts` | The task commits to producing specific facts that downstream tasks can reference |
| Isolated validation | `validation` | All validation commands can run without reading another concurrent task's uncommitted output |
| Isolated rollback | `rollbackPlan` | The task can be reverted independently without cascading to unrelated tasks |

### What Is NOT Independent

A task is **not** independent when:

- It writes to a file another running task also writes (write set overlap)
- It reads a file another running task is actively modifying without a shared lock
- Its `dependsOnFacts` include a fact that has not yet been produced
- Its rollback strategy requires reverting another task first

---

## DAG Dependencies

Tasks form a directed acyclic graph (DAG) through `dependsOnFacts`
and `producesFacts`.

```
Task A                          Task B
  producesFacts:                  dependsOnFacts:
    fact:prisma-schema:User         fact:prisma-schema:User
        │                               │
        └───────────────────────────────┘
                fact is the edge
```

### DAG Rules

| Rule | Enforcement |
|------|-------------|
| No cycles | The compiler MUST reject a batch where any `producesFacts` / `dependsOnFacts` chain forms a cycle |
| Fact must exist before use | The launcher MUST NOT dispatch a task whose `dependsOnFacts` contains a fact not yet in the fact registry |
| Fact produced exactly once | Two tasks in the same batch MUST NOT declare the same `factId` in `producesFacts` |
| Missing production is a contract violation | If a task completes without producing its declared `producesFacts`, the launcher flags a violation |

### DAG Traversal for Scheduling

The batch scheduler walks the DAG in topological order:

1. Emit tasks with zero unmet `dependsOnFacts` (roots)
2. When a root task completes and produces its facts, unlock dependent tasks
3. Repeat until all tasks are dispatched or blocked

Tasks at the same DAG depth (same number of unmet dependencies)
are candidates for parallel dispatch, subject to write set and
risk constraints below.

---

## Write Set and Shared Locks

### writeSet

`writeSet` is the subset of `allowedFiles` that the worker is
expected to modify. It is narrower than `allowedFiles` and is the
primary signal for parallel safety.

| Condition | Result |
|-----------|--------|
| Two tasks' `writeSet` entries are disjoint | Safe to parallelize |
| Two tasks' `writeSet` entries overlap | MUST serialize (same conflict group) |
| One task's `writeSet` overlaps another's `sharedLocks` | Safe — shared lock grants read-only access |

### sharedLocks

`sharedLocks` declare files a task reads but does not write.
Multiple tasks may hold shared locks on the same file concurrently.

| Lock holder combination | Result |
|------------------------|--------|
| Task A: `sharedLocks: ["prisma/schema.prisma"]`, Task B: `sharedLocks: ["prisma/schema.prisma"]` | Safe — concurrent reads |
| Task A: `writeSet: ["src/app.module.ts"]`, Task B: `sharedLocks: ["src/app.module.ts"]` | Safe — A writes, B reads |
| Task A: `writeSet: ["src/app.module.ts"]`, Task B: `writeSet: ["src/app.module.ts"]` | BLOCK — exclusive write conflict |

### Shared Lock Names

Predefined lock names map to file patterns (see
[parallel-work-policy.md](parallel-work-policy.md)):

| Lock name | Files |
|-----------|-------|
| `package` | `package.json`, `package-lock.json` |
| `prisma-schema` | `prisma/**` |
| `app-module` | `src/app.module.ts` |
| `docs-index` | `docs/**/*.md` |

---

## Risk-Aware Concurrency

Not all tasks may run concurrently even when their write sets are
disjoint. Risk tier gates concurrency independently of file overlap.

| Risk tier | Concurrency rule |
|-----------|-----------------|
| `low` | May run in parallel with any other `low`-risk task (subject to write set check) |
| `medium` | May run in parallel with `low`-risk tasks; MUST NOT run concurrently with another `medium` or `high` task in the same module boundary |
| `high` | MUST serialize. Only one `high`-risk task may be in-flight at a time. Requires explicit owner approval before dispatch |

### High-Risk Serialization Rationale

High-risk tasks touch auth, data migrations, or public API surfaces.
Concurrent high-risk tasks create compounding failure modes where
rollback of one may invalidate the other. Serialization ensures each
high-risk change is independently validated and revertable.

### Risk Escalation

A `low`-risk task is escalated to `medium` when:

- It claims a shared lock that a `medium`-risk task also claims
- Its `writeSet` is adjacent to (one file removed from) a `high`-risk task's `writeSet`

The launcher applies escalation automatically; the worker does not
need to self-classify.

---

## Concurrency Decision Flow

The scheduler evaluates these checks in order before dispatching
a task alongside already-running tasks:

```
pending task
     │
     ▼
  DAG check: dependsOnFacts all satisfied?
     │
     ├── No  → HOLD (wait for producing task)
     │
     ▼ (Yes)
  writeSet overlap with any active task?
     │
     ├── Yes → SERIALIZE (same conflict group)
     │
     ▼ (No)
  sharedLock overlap with active exclusive lock?
     │
     ├── Yes → SERIALIZE
     │
     ▼ (No)
  Risk tier check: high-risk already in-flight?
     │
     ├── Yes → HOLD (serialize high-risk)
     │
     ▼ (No)
  Module boundary overlap with another medium task?
     │
     ├── Yes → SERIALIZE
     │
     ▼ (No)
  Resource slot available?
     │
     ├── No  → HOLD (resource exhausted)
     │
     ▼ (Yes)
  DISPATCH
```

---

## Merge Isolation

Each task produces an independent PR that can be merged without
coordinating with other concurrent tasks.

### Merge Isolation Requirements

| Requirement | Enforcement |
|-------------|-------------|
| No cross-PR dependencies at merge time | PR A must not require PR B to merge first, unless A's `dependsOnFacts` include a fact only B produces |
| Independent rollback | Reverting PR A must not break PR B's changes |
| Independent validation | `npm run check` and other validation commands must pass on each PR individually, not only when multiple PRs are merged together |
| Conflict group serialization at merge | PRs in the same conflict group merge sequentially (fewest-dependents first) |

### Merge Order

When multiple parallel PRs are ready to merge:

1. Sort by DAG depth — roots merge first
2. On equal depth, sort by number of dependents — fewer dependents first
3. On equal dependents, sort by diff size — smaller first
4. After each merge, rebase remaining PRs on new `main` and re-validate

### Post-Merge Fact Registry Update

When a PR merges, the launcher:

1. Records the produced facts in the fact registry
2. Unlocks any tasks whose `dependsOnFacts` are now fully satisfied
3. Triggers the next DAG wave for dispatch

---

## Example: Decomposed Batch

An issue to "add user search with caching" is decomposed into three
independent fact changes:

```json
[
  {
    "taskType": "execution",
    "risk": "medium",
    "conflictGroup": "user-search",
    "writeSet": ["src/modules/search/**"],
    "allowedFiles": ["src/modules/search/**"],
    "dependsOnFacts": [],
    "producesFacts": [
      { "factId": "fact:search:endpoint-exists", "description": "GET /api/search/users endpoint returns results" }
    ],
    "sharedLocks": ["prisma-schema"],
    "validation": ["npm run check", "npm run build"]
  },
  {
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "user-search-cache",
    "writeSet": ["src/modules/search/cache/**"],
    "allowedFiles": ["src/modules/search/cache/**"],
    "dependsOnFacts": [
      { "factId": "fact:search:endpoint-exists", "description": "Search endpoint must exist before adding cache layer" }
    ],
    "producesFacts": [
      { "factId": "fact:search:cache-layer", "description": "Cache layer with 60s TTL wraps search endpoint" }
    ],
    "sharedLocks": [],
    "validation": ["npm run check", "npm run build"]
  },
  {
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "user-search-docs",
    "writeSet": ["docs/api/search.md"],
    "allowedFiles": ["docs/api/search.md"],
    "dependsOnFacts": [
      { "factId": "fact:search:endpoint-exists", "description": "Endpoint must exist before documenting it" }
    ],
    "producesFacts": [],
    "sharedLocks": ["docs-index"],
    "validation": ["npm run check"]
  }
]
```

**Scheduling:**

- Task 1 (endpoint) dispatches first — no dependencies
- Tasks 2 (cache) and 3 (docs) both depend on `fact:search:endpoint-exists`
- Once Task 1 merges and produces its fact, Tasks 2 and 3 dispatch in parallel — their `writeSet` entries are disjoint and both are `low` risk

---

## Non-Goals

- No changes to `package.json`, Prisma schema, or Nest runtime modules
- No implementation of the DAG scheduler script (planning doc only)
- No bypass of the launch gate or human approval requirement

---

## References

- [Parallel Work Policy](parallel-work-policy.md) — Conflict groups and shared lock rules
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Task Schema v2](task-schema-v2.md) — `writeSet`, `sharedLocks`, `dependsOnFacts`, `producesFacts`
- [Resource Slot Scheduling](resource-slot-scheduling.md) — Slot-based concurrency limits
- [Controlled Auto-Merge](controlled-auto-merge.md) — Merge isolation and guard enforcement
- [Opportunity-to-Task Compiler Contract](opportunity-to-task-compiler-contract.md) — Signal-to-task field mapping
- [Launch Gate](launch-gate.md) — Pre-launch validation
- [Orchestration](orchestration.md) — Full orchestration flow
