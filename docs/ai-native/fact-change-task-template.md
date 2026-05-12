# Fact-Change Task Template

Reusable task template for workers that modify, produce, or consume
control-plane facts. Applies the task schema v2 fields for governed
parallel decomposition: independent fact changes run concurrently;
shared truth and high-risk boundaries remain serialized and
human-gated.

> **Closes:** [#1044](https://github.com/taoyu051818-sys/lian-nest-server/issues/1044)
>
> **Cross-references:**
> [task-schema-v2.md](task-schema-v2.md) for the full v2 JSON schema,
> [parallel-work-policy.md](parallel-work-policy.md) for conflict
> group and shared-lock rules,
> [opportunity-to-task-compiler-contract.md](opportunity-to-task-compiler-contract.md)
> for how signals compile into tasks,
> [worker-task-contract.md](worker-task-contract.md) for the base
> contract,
> [resource-slot-scheduling.md](resource-slot-scheduling.md) for
> slot-based dispatch.

---

## What Is a Fact-Change Task

A fact-change task is a worker that reads existing facts (via
`dependsOnFacts`), performs a bounded change, and produces new facts
(via `producesFacts`). Facts are assertions recorded in the
control-plane ledgers — fact events, external facts, task lifecycle,
gap entries, or knowledge updates.

Fact-change tasks are the unit of governed parallelism. The
orchestrator schedules them based on their dependency graph and file
boundaries, not by ad-hoc ordering.

---

## Concurrency Model

### Independent Fact Changes (Parallel)

Two fact-change tasks may run concurrently when:

1. **No fact dependency** — neither task's `dependsOnFacts` contains a
   fact the other produces.
2. **No file overlap** — `allowedFiles` and `writeSet` are disjoint.
3. **No shared-lock contention** — `sharedLocks` do not conflict (two
   tasks may hold the same shared lock, but neither may hold an
   exclusive write on a shared-locked file).

```
Task A: produces fact:a, writes docs/x.md
Task B: produces fact:b, writes docs/y.md
         → parallel (no dependency, no file overlap)
```

### Serialized Fact Changes (Sequential)

Tasks must run sequentially when:

1. **Fact dependency** — Task B's `dependsOnFacts` references a fact
   that Task A produces.
2. **File overlap** — `allowedFiles` or `writeSet` intersect.
3. **Shared truth boundary** — both tasks write to the same
   authoritative source (e.g., `docs/ai-native/*.md` index,
   `schemas/*.json`).
4. **High-risk gate** — either task has `risk: "high"` or touches
   forbidden-high-risk patterns (`src/**`, `prisma/**`, auth code).

```
Task A: produces fact:x, writes schemas/foo.schema.json
Task B: dependsOn fact:x, writes docs/foo.md
         → sequential (fact dependency + shared truth)
```

### Conflict Group Assignment

Every fact-change task declares a `conflictGroup`. Rules:

| Scenario | Conflict Group |
|----------|---------------|
| Tasks writing to the same ledger file | Same group |
| Tasks writing to the same docs directory | Same group |
| Tasks with a fact dependency chain | Same group |
| Tasks with disjoint files and no fact dependency | Different groups |

---

## Template Fields

### Required Fields

```json
{
  "taskType": "execution",
  "workerClass": "fact-change-worker",
  "risk": "low | medium | high",
  "conflictGroup": "<module-or-ledger-name>",
  "targetIssue": "<number>",
  "targetPR": null,
  "issues": ["<number>"],
  "expectedPR": true,
  "allowedFiles": ["<glob patterns>"],
  "forbiddenFiles": ["<glob patterns>"],
  "writeSet": ["<subset of allowedFiles>"],
  "sharedLocks": ["<read-only shared files>"],
  "validation": ["<commands>"],
  "dependsOnFacts": [],
  "producesFacts": [],
  "actorRole": "fact-change-worker",
  "roleDescription": "<what this task does>",
  "requiredReviewRoles": ["<role-name>"],
  "acceptanceOwner": "<owner>",
  "budget": {},
  "rollbackPlan": {},
  "telemetry": {}
}
```

### dependsOnFacts

Array of facts that must exist before this task can run. Each entry:

```json
{
  "factId": "fact:<namespace>:<identifier>",
  "description": "Human-readable assertion the fact makes",
  "source": "optional — task or issue that produced the fact"
}
```

If any referenced fact is missing from the fact registry, the launcher
holds the task in pending state until the producing task completes.

### producesFacts

Array of facts this task commits to producing. Each entry:

```json
{
  "factId": "fact:<namespace>:<identifier>",
  "description": "What the fact will assert after this task completes",
  "confidence": "definite | likely | conditional"
}
```

Downstream tasks reference these in their `dependsOnFacts`. If a task
completes without producing its declared facts, the launcher flags a
contract violation.

### writeSet

Subset of `allowedFiles` — the exact files or narrow globs the worker
will modify. The launcher logs a warning if the worker touches files
outside `writeSet` but inside `allowedFiles`. This catches scope creep
early.

### sharedLocks

Files this task reads but does not write. Multiple tasks may hold the
same shared lock concurrently. No task may hold an exclusive write on a
shared-locked file while other tasks hold the lock.

### validation

Commands the worker must run. At minimum:

1. `npm run check` — type checking
2. One task-specific validation (e.g., `npm run build`, schema
   validation, link check)

### rollbackPlan

```json
{
  "strategy": "git-revert | manual-fixforward | auto-revert-if-ci-fails",
  "notes": "Additional guidance for the reviewer"
}
```

---

## Risk Tiers

### Low Risk

Docs-only, config-only, or isolated ledger changes. Standard health
check. Can run in parallel with other low-risk tasks if file boundaries
are disjoint.

```json
{
  "risk": "low",
  "mainHealthPolicy": "gate-docs-only",
  "requiredReviewRoles": ["ai-architecture-reviewer"],
  "budget": {
    "maxFiles": 4,
    "maxLinesChanged": 200,
    "softTimeMinutes": 20,
    "hardTimeMinutes": 40
  }
}
```

### Medium Risk

Cross-module changes, schema modifications, or shared-lock writes.
Health check plus conflict-group collision check. May serialize with
tasks that share locks or fact dependencies.

```json
{
  "risk": "medium",
  "mainHealthPolicy": "gate-all",
  "requiredReviewRoles": ["ai-architecture-reviewer", "control-plane-reviewer"],
  "budget": {
    "maxFiles": 8,
    "maxLinesChanged": 400,
    "softTimeMinutes": 30,
    "hardTimeMinutes": 60
  }
}
```

### High Risk

Auth, data migration, public API surface, or shared authority files.
Full health check plus explicit owner approval. Always serialized — no
concurrent execution with any task that touches overlapping facts or
files.

```json
{
  "risk": "high",
  "mainHealthPolicy": "gate-all",
  "requiredReviewRoles": ["ai-architecture-reviewer", "control-plane-reviewer", "security-reviewer"],
  "budget": {
    "maxFiles": 10,
    "maxLinesChanged": 500,
    "softTimeMinutes": 45,
    "hardTimeMinutes": 90
  }
}
```

---

## Standard Forbidden Files

Every fact-change task includes these forbidden patterns:

```json
{
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
  ]
}
```

Tasks that legitimately touch `src/**` or `prisma/**` are high-risk and
require explicit allowlist override with human approval.

---

## Examples

### Example 1: Low-Risk Docs Fact Change

A worker that adds a new architecture doc and produces a fact about it.

```json
{
  "taskType": "execution",
  "workerClass": "fact-change-worker",
  "risk": "low",
  "conflictGroup": "ai-native-docs",
  "targetIssue": 1044,
  "targetPR": null,
  "issues": [1044],
  "expectedPR": true,
  "allowedFiles": [
    "docs/ai-native/fact-change-task-template.md"
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
    "docs/ai-native/fact-change-task-template.md"
  ],
  "sharedLocks": [
    "docs/ai-native/worker-task-contract.md",
    "docs/ai-native/task-schema-v2.md",
    "docs/ai-native/parallel-work-policy.md"
  ],
  "validation": [
    "npm run check",
    "npm run check"
  ],
  "dependsOnFacts": [],
  "producesFacts": [
    {
      "factId": "fact:docs:fact-change-task-template",
      "description": "fact-change-task-template.md exists and follows v2 schema conventions",
      "confidence": "definite"
    }
  ],
  "actorRole": "fact-change-worker",
  "roleDescription": "Add fact-change task template for governed parallel decomposition",
  "requiredReviewRoles": ["ai-architecture-reviewer", "control-plane-reviewer"],
  "acceptanceOwner": "codex orchestrator",
  "budget": {
    "maxFiles": 1,
    "maxLinesChanged": 220,
    "softTimeMinutes": 20,
    "hardTimeMinutes": 60
  },
  "rollbackPlan": {
    "strategy": "git-revert",
    "notes": "Docs-only change. Revert commit to roll back."
  },
  "telemetry": {
    "emitHeartbeat": true,
    "heartbeatIntervalSeconds": 120,
    "logLevel": "normal",
    "tags": ["wave31", "fact-change", "docs"]
  }
}
```

### Example 2: Medium-Risk Schema Fact Change

A worker that updates a JSON schema and produces a validation fact.
Depends on a prior task's fact.

```json
{
  "taskType": "execution",
  "workerClass": "fact-change-worker",
  "risk": "medium",
  "conflictGroup": "schema-updates",
  "targetIssue": 980,
  "targetPR": null,
  "issues": [980],
  "expectedPR": true,
  "allowedFiles": [
    "schemas/external-facts.schema.json",
    "docs/ai-native/external-facts-schema.md"
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
    "schemas/external-facts.schema.json",
    "docs/ai-native/external-facts-schema.md"
  ],
  "sharedLocks": [
    "docs/ai-native/fact-event-schema.md"
  ],
  "validation": [
    "npm run check",
    "npm run build"
  ],
  "dependsOnFacts": [
    {
      "factId": "fact:schema:external-facts-entry-version",
      "description": "external-facts.schema.json has entryVersion field defined",
      "source": "issue #891"
    }
  ],
  "producesFacts": [
    {
      "factId": "fact:schema:external-facts-meta-field",
      "description": "external-facts.schema.json includes optional meta field",
      "confidence": "definite"
    }
  ],
  "actorRole": "fact-change-worker",
  "roleDescription": "Add meta field to external-facts schema and update docs",
  "requiredReviewRoles": ["ai-architecture-reviewer", "control-plane-reviewer"],
  "acceptanceOwner": "taoyu051818-sys",
  "budget": {
    "maxFiles": 2,
    "maxLinesChanged": 150,
    "softTimeMinutes": 30,
    "hardTimeMinutes": 60
  },
  "rollbackPlan": {
    "strategy": "git-revert",
    "notes": "Schema additive change. Revert safe; no downstream consumers depend on meta field yet."
  },
  "telemetry": {
    "emitHeartbeat": true,
    "heartbeatIntervalSeconds": 120,
    "logLevel": "normal",
    "tags": ["wave31", "fact-change", "schema"]
  }
}
```

### Example 3: Parallel Independent Fact Changes

Two tasks that can run concurrently because they have no fact
dependency and no file overlap.

**Task A** — writes to `docs/ai-native/foo.md`:

```json
{
  "conflictGroup": "ai-native-docs-foo",
  "allowedFiles": ["docs/ai-native/foo.md"],
  "writeSet": ["docs/ai-native/foo.md"],
  "dependsOnFacts": [],
  "producesFacts": [
    {
      "factId": "fact:docs:foo-exists",
      "description": "foo.md exists",
      "confidence": "definite"
    }
  ]
}
```

**Task B** — writes to `docs/ai-native/bar.md`:

```json
{
  "conflictGroup": "ai-native-docs-bar",
  "allowedFiles": ["docs/ai-native/bar.md"],
  "writeSet": ["docs/ai-native/bar.md"],
  "dependsOnFacts": [],
  "producesFacts": [
    {
      "factId": "fact:docs:bar-exists",
      "description": "bar.md exists",
      "confidence": "definite"
    }
  ]
}
```

These two tasks have different conflict groups, disjoint files, and no
fact dependency. The orchestrator may dispatch them in parallel.

### Example 4: Serialized Chain

Three tasks that must run in sequence due to fact dependencies.

```
Task A (produces fact:x) → Task B (dependsOn fact:x, produces fact:y) → Task C (dependsOn fact:y)
```

The orchestrator dispatches A first. When A completes and fact:x is
registered, B becomes eligible. When B completes and fact:y is
registered, C becomes eligible.

---

## Orchestrator Decision Flow

```
1. Build fact dependency graph from dependsOnFacts / producesFacts
2. Identify tasks with no unresolved dependencies → eligible set
3. For each eligible task:
   a. Check conflictGroup against running tasks
   b. Check file overlap (allowedFiles ∩ writeSet) against running tasks
   c. Check sharedLock contention
   d. If all clear → allocate slot and dispatch
4. When a task completes:
   a. Register produced facts in the fact registry
   b. Re-evaluate pending tasks that depended on those facts
   c. Free the resource slot
5. Repeat until all tasks complete or a blocker is hit
```

---

## Review Acceptance

Every fact-change PR must include:

| Section | Source |
|---------|--------|
| Summary | What facts changed and why |
| Linked Issues | `Closes #N` |
| Non-Goals | What was explicitly out of scope |
| Validation | Commands run and results |
| Changed Files | Must match `git diff --name-only` |
| Risk / Rollback | Risk level and revert plan |
| Follow-up Handoff | Next steps for downstream tasks |

See [pr-handoff-template.md](pr-handoff-template.md) for full
template details and rejection criteria.

---

## See Also

- [Task Schema v2](task-schema-v2.md) — Full v2 JSON schema
- [Worker Task Contract](worker-task-contract.md) — Base contract definition
- [Parallel Work Policy](parallel-work-policy.md) — Conflict groups and shared locks
- [Resource Slot Scheduling](resource-slot-scheduling.md) — Slot-based dispatch
- [Opportunity-to-Task Compiler](opportunity-to-task-compiler-contract.md) — Signal-to-task compilation
- [Fact Event Schema](fact-event-schema.md) — Internal fact event format
- [External Facts Schema](external-facts-schema.md) — External fact entry format
- [PR Handoff Template](pr-handoff-template.md) — PR body requirements
- [#1044](https://github.com/nicholasxsxs/lian-nest-server/issues/1044) — This feature
