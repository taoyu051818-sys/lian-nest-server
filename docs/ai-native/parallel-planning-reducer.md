# Parallel Planner Reducer Contract

Defines how multiple planner workers output candidate gaps and how a reducer
deduplicates, prioritizes, and compiles them into an ordered task batch.

> **Closes:** [#1039](https://github.com/taoyu051818-sys/lian-nest-server/issues/1039)

---

## Problem

Multiple planner workers may run in parallel — each inspecting a different
slice of the codebase (docs, schema, runtime, tests) and producing candidate
gaps. Without a reducer, the orchestrator receives overlapping, conflicting,
or dependency-violating task proposals that cannot be dispatched safely.

## Goals

- Define the **planner output format** so every worker emits comparable
  candidate gaps.
- Define the **reducer contract** — deduplication, dependency ordering, risk
  gating, and capacity-aware scheduling.
- Enforce governed parallelism: only independent fact changes may run
  concurrently; shared truth and high-risk boundaries remain serialized or
  human-gated.
- Keep the contract local-only — planning doc, no runtime changes.

## Non-Goals

- No changes to `package.json`, Prisma schema, or Nest runtime modules.
- No implementation of the reducer script (contract only).
- No bypass of risk policy or review gates.

---

## Planner Output Format

Each planner worker emits an array of **candidate gaps**. A gap is a proposed
unit of work that the reducer will evaluate, deduplicate, and compile into a
task contract.

### Candidate Gap Schema

```json
{
  "gapId": "string",
  "title": "string",
  "description": "string",
  "sourcePlanner": "string",
  "category": "fact | docs | runtime | schema | test",
  "riskTier": "low | medium | high",
  "writeSet": ["file paths or globs"],
  "sharedLocks": ["lock names"],
  "producesFacts": [
    {
      "factId": "string",
      "description": "string",
      "confidence": "definite | likely | conditional"
    }
  ],
  "dependsOnFacts": [
    {
      "factId": "string",
      "description": "string"
    }
  ],
  "estimatedEffort": "small | medium | large",
  "blockedBy": ["gap IDs or issue numbers"],
  "metadata": {}
}
```

### Field Definitions

| Field | Required | Description |
|-------|----------|-------------|
| `gapId` | Yes | Unique identifier within the planner run (e.g., `gap:docs:001`). |
| `title` | Yes | One-line summary of the gap. |
| `description` | Yes | What is missing and why it matters. |
| `sourcePlanner` | Yes | Which planner worker produced this gap (e.g., `docs-planner`, `schema-planner`). |
| `category` | Yes | Work domain — used for conflict group assignment. |
| `riskTier` | Yes | Maps to the [risk policy](risk-policy.md) categories. Determines review requirements. |
| `writeSet` | Yes | Exact files the resulting task would modify. Used for conflict detection. |
| `sharedLocks` | No | Locks the resulting task would claim. Maps to [parallel work policy](parallel-work-policy.md) Rule 5. |
| `producesFacts` | No | Facts the resulting task commits to establishing. |
| `dependsOnFacts` | No | Facts that must exist before the resulting task can run. |
| `estimatedEffort` | No | Sizing hint for capacity planning. |
| `blockedBy` | No | Explicit prerequisite gap IDs or issue numbers. |
| `metadata` | No | Planner-specific data (e.g., source file, line range, test name). |

---

## Reducer Contract

The reducer receives candidate gaps from all planner workers and produces an
ordered, deduplicated task batch. It operates in five phases.

### Phase 1: Collect

Gather all candidate gaps from all planner workers. Each gap is tagged with
its `sourcePlanner` for traceability.

```
Input:  gap arrays from N planner workers
Output: flat candidate pool with source tags
```

### Phase 2: Deduplicate

Remove duplicate or semantically equivalent gaps.

**Dedup rules:**

| Rule | Condition | Action |
|------|-----------|--------|
| Exact match | Same `gapId` from multiple planners | Keep one, merge `sourcePlanner` tags |
| Write-set overlap | Two gaps with identical `writeSet` and same `category` | Keep the one with higher `riskTier` (conservative) |
| Subsumption | Gap A's `writeSet` is a superset of Gap B's and titles overlap | Keep A, discard B |
| Fact collision | Two gaps produce the same `factId` | Keep the one with `confidence: definite` over `likely` or `conditional` |

```
Input:  candidate pool
Output: deduplicated candidate pool
```

### Phase 3: Build Dependency DAG

Construct a directed acyclic graph from `dependsOnFacts` and `producesFacts`
edges. Also incorporate explicit `blockedBy` edges.

```
For each gap G:
  For each fact F in G.dependsOnFacts:
    Find producer gap P where F in P.producesFacts
    If P exists: add edge P → G
  For each blocker B in G.blockedBy:
    Find gap B' by gapId, or note as external dependency
    If B' exists: add edge B' → G
```

**Validation:**

- If the graph contains a cycle, the reducer flags a **conflict** and halts.
  The planner workers must resolve the circular dependency before proceeding.
- If a `dependsOnFacts` entry has no producer in the pool and no existing
  fact in the registry, the gap is held in **pending** state — it cannot be
  scheduled until the fact is established.

```
Input:  deduplicated candidates + fact registry
Output: DAG of gap dependencies (adjacency list)
```

### Phase 4: Risk Gate and Conflict Assignment

Apply risk policy and conflict group rules to each gap.

**Risk gate:**

| Risk Tier | Review Requirement | Auto-Merge Eligible |
|-----------|-------------------|---------------------|
| `low` | Any worker | Yes |
| `medium` | Feature worker or higher | With review |
| `high` | Architect review required | No — human-gated |

**Conflict group assignment:**

Each gap is assigned to a conflict group based on its `writeSet`:

1. If all files in `writeSet` fall under `docs/`, assign to `docs-<subcategory>`.
2. If `writeSet` intersects `prisma/**`, assign to `prisma-<schema-area>`.
3. If `writeSet` intersects `src/**`, assign to the module name derived from
   the path (e.g., `src/modules/auth/**` → `auth-core`).
4. If the gap declares `sharedLocks`, assign to a group named after the lock
   (e.g., `app-module`).
5. Otherwise, assign to a group derived from the dominant file path.

**Serialization within groups:**

Gaps assigned to the same conflict group are ordered topologically within the
DAG. They will be dispatched sequentially, not in parallel.

```
Input:  DAG + risk policy
Output: DAG annotated with conflict groups and risk tiers
```

### Phase 5: Schedule and Compile

Produce the final ordered task batch, respecting slot capacity and review
gates.

**Scheduling algorithm:**

```
ready = gaps with in-degree 0 in the DAG
scheduled = []
activeGroups = {}

while ready is not empty:
  sort ready by:
    1. risk tier (low first — unblocks more downstream)
    2. estimated effort (small first)
    3. fewer dependents first

  for each gap G in ready:
    group = G.conflictGroup
    if group in activeGroups:
      skip G (serialize within group)
      continue

    if no slot available:
      skip G (capacity bound)
      continue

    compile G into task contract
    add to scheduled
    mark group as active
    remove G from DAG
    update ready set
```

**Compilation — gap to task contract:**

The reducer compiles each gap into a [Task Schema v2](task-schema-v2.md)
contract:

| Gap Field | Task Contract Field |
|-----------|-------------------|
| `gapId` | Embedded in `metadata.gapId` |
| `title` | `promptHandoff` |
| `description` | Appended to `promptHandoff` |
| `sourcePlanner` | `metadata.sourcePlanner` |
| `category` | Informs `workerClass` selection |
| `riskTier` | `risk` |
| `writeSet` | `writeSet` |
| `sharedLocks` | `sharedLocks` |
| `producesFacts` | `producesFacts` |
| `dependsOnFacts` | `dependsOnFacts` |
| `blockedBy` | `blockedBy` |
| `estimatedEffort` | Informs `budget` sizing |

Additional fields are populated from policy defaults:

- `taskType`: `"execution"`
- `conflictGroup`: Assigned in Phase 4
- `allowedFiles`: `writeSet` expanded to include read-only dependencies
- `forbiddenFiles`: Policy defaults (`src/**` forbidden for docs workers, etc.)
- `validation`: Default validation commands for the `category`
- `mainHealthPolicy`: `"gate-all"` for runtime, `"gate-docs-only"` for docs
- `rollbackPlan`: `{ "strategy": "git-revert" }` (default)

```
Input:  annotated DAG + slot availability
Output: ordered array of Task Schema v2 contracts
```

---

## Governed Parallelism

The reducer enforces the principle that **only independent fact changes can
run concurrently**. Shared truth and high-risk boundaries remain serialized
or human-gated.

### Independent Fact Changes — Parallel

Two gaps may be dispatched in parallel when:

1. Their `writeSet` arrays have no intersection.
2. They do not claim the same `sharedLocks`.
3. Neither depends on facts the other produces.
4. They are in different conflict groups.
5. Both are at or below the risk tier that allows auto-merge.

```
Gap A (writeSet: docs/foo.md)     ──┐
                                     ├── parallel dispatch
Gap B (writeSet: src/bar.service.ts) ┘
```

### Shared Truth — Serialized

When two gaps share a write path or lock, the reducer orders them by DAG
topology and dispatches them sequentially.

```
Gap C (sharedLocks: ["app-module"]) ──┐
                                       ├── sequential
Gap D (sharedLocks: ["app-module"]) ──┘
```

### High-Risk Boundaries — Human-Gated

Gaps with `riskTier: "high"` are compiled into tasks with `mainHealthPolicy:
"gate-all"` and `requiredReviewRoles` that include an architect. They are
never auto-merged.

```
Gap E (riskTier: "high", writeSet: src/modules/auth/**)
  → compiled task requires architect review before merge
```

---

## Error Handling

| Condition | Reducer Action |
|-----------|---------------|
| Cycle in dependency DAG | Halt — flag conflict, require planner resolution |
| Missing fact producer | Hold gap in pending state — re-evaluate after next planner run |
| No slots available | Queue gap — retry on next scheduling cycle |
| All gaps in same conflict group | Serialize entire batch — no parallelism |
| Planner emits invalid gap (missing required fields) | Reject gap — log validation error, continue with remaining |

---

## Integration Points

| System | Interaction |
|--------|------------|
| [Task Schema v2](task-schema-v2.md) | Reducer output is an array of v2 task contracts |
| [Parallel Work Policy](parallel-work-policy.md) | Conflict group and shared lock rules govern Phase 4 |
| [Risk Policy](risk-policy.md) | Risk tier classification gates review requirements |
| [Resource Slot Scheduling](resource-slot-scheduling.md) | Slot availability gates Phase 5 dispatch |
| [Worker Task Contract](worker-task-contract.md) | Compiled tasks conform to the contract schema |
| [Controlled Auto-Merge](controlled-auto-merge.md) | Low-risk compiled tasks eligible for auto-merge batch |
| [Issue-to-Task Compiler](issue-to-task-task-v2-mode.md) | Reducer output feeds the same dispatch pipeline |

---

## Example

### Input: Two Planner Workers

**Docs planner** emits:

```json
[
  {
    "gapId": "gap:docs:001",
    "title": "Add parallel planner reducer contract",
    "description": "No contract exists for how planner outputs are reduced into tasks.",
    "sourcePlanner": "docs-planner",
    "category": "docs",
    "riskTier": "low",
    "writeSet": ["docs/ai-native/parallel-planning-reducer.md"],
    "producesFacts": [
      { "factId": "fact:docs:parallel-planning-reducer", "description": "Reducer contract defined", "confidence": "definite" }
    ],
    "dependsOnFacts": [],
    "estimatedEffort": "small"
  }
]
```

**Schema planner** emits:

```json
[
  {
    "gapId": "gap:schema:001",
    "title": "Add gap schema to task-v2 schema",
    "description": "Candidate gap schema is not part of the formal JSON schema.",
    "sourcePlanner": "schema-planner",
    "category": "schema",
    "riskTier": "low",
    "writeSet": ["schemas/task-v2.schema.json"],
    "sharedLocks": [],
    "producesFacts": [
      { "factId": "fact:schema:gap-schema", "description": "Gap schema added to task-v2", "confidence": "definite" }
    ],
    "dependsOnFacts": [
      { "factId": "fact:docs:parallel-planning-reducer", "description": "Reducer contract must be defined first" }
    ],
    "estimatedEffort": "small"
  }
]
```

### Reducer Output

```json
[
  {
    "taskType": "execution",
    "workerClass": "docs-worker",
    "risk": "low",
    "conflictGroup": "ai-native-reducer-docs",
    "writeSet": ["docs/ai-native/parallel-planning-reducer.md"],
    "sharedLocks": [],
    "producesFacts": [
      { "factId": "fact:docs:parallel-planning-reducer", "description": "Reducer contract defined", "confidence": "definite" }
    ],
    "dependsOnFacts": [],
    "mainHealthPolicy": "gate-docs-only",
    "rollbackPlan": { "strategy": "git-revert" },
    "metadata": { "gapId": "gap:docs:001", "sourcePlanner": "docs-planner" }
  },
  {
    "taskType": "execution",
    "workerClass": "schema-task-v2",
    "risk": "low",
    "conflictGroup": "schema-task-v2",
    "writeSet": ["schemas/task-v2.schema.json"],
    "sharedLocks": [],
    "producesFacts": [
      { "factId": "fact:schema:gap-schema", "description": "Gap schema added to task-v2", "confidence": "definite" }
    ],
    "dependsOnFacts": [
      { "factId": "fact:docs:parallel-planning-reducer", "description": "Reducer contract must be defined first" }
    ],
    "blockedBy": ["gap:docs:001"],
    "mainHealthPolicy": "gate-docs-only",
    "rollbackPlan": { "strategy": "git-revert" },
    "metadata": { "gapId": "gap:schema:001", "sourcePlanner": "schema-planner" }
  }
]
```

The schema task is blocked by the docs task (DAG edge). They run sequentially,
not in parallel.

---

## Current State

This is the **planning slice** (issue #1039). The following are defined:

- [x] Planner output (candidate gap) schema
- [x] Reducer five-phase contract (collect, deduplicate, DAG, risk gate, schedule)
- [x] Governed parallelism rules (independent, shared, high-risk)
- [x] Gap-to-task compilation mapping
- [x] Error handling matrix
- [x] Integration points with existing systems

### Future Slices

- [ ] Reducer script implementation (`scripts/ai/reduce-planner-gaps.ps1`)
- [ ] Candidate gap JSON schema (`schemas/candidate-gap.schema.json`)
- [ ] Fact registry integration for `dependsOnFacts` validation
- [ ] Slot-aware scheduling integration with resource slot model
- [ ] Dry-run mode with mock planner outputs

---

## References

- [Task Schema v2](task-schema-v2.md) — Output contract format
- [Parallel Work Policy](parallel-work-policy.md) — Conflict group and shared lock rules
- [Risk Policy](risk-policy.md) — Risk tier classification
- [Resource Slot Scheduling](resource-slot-scheduling.md) — Slot availability model
- [Worker Task Contract](worker-task-contract.md) — Base task JSON schema
- [Controlled Auto-Merge](controlled-auto-merge.md) — Low-risk merge pipeline
- [Issue-to-Task Compiler](issue-to-task-task-v2-mode.md) — Task compilation pipeline
- [#1039](https://github.com/taoyu051818-sys/lian-nest-server/issues/1039) — This feature
