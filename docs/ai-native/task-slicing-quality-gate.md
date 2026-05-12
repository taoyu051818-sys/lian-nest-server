# Task Slicing Quality Gate

Defines the quality gate applied to each task slice before it enters the
parallel scheduling pipeline. A task slice is a single worker task JSON
(v2) produced by the compiler. This gate validates that the slice is
safe for governed parallel decomposition.

> **Closes:** [#1043](https://github.com/taoyu051818-sys/lian-nest-server/issues/1043)

---

## Purpose

Governed parallelism requires every slice to be an independent fact
change with a narrow write scope, clear validation, and no hidden
dependencies on shared state. This gate catches slices that are too
broad, ambiguous, or coupled before they reach the launch gate.

The gate is deterministic — no LLM calls. It runs on the task JSON
after compilation and before scheduling.

---

## Gate Checks

### 1. Single Fact Change

A task slice must produce or update exactly one fact. Slices that
produce zero facts are research tasks (exempt). Slices that produce
more than one fact should be split into separate tasks.

| Condition | Decision | Severity |
|-----------|----------|----------|
| `producesFacts` has 0 entries | `pass` (research task) | `info` |
| `producesFacts` has 1 entry | `pass` | `info` |
| `producesFacts` has 2+ entries | `warn` | `warning` |

**Blocker code:** `MULTI_FACT_SLICE`
**Message:** Slice produces {n} facts — consider splitting into {n} tasks.

---

### 2. Narrow writeSet

The `writeSet` must be a strict subset of `allowedFiles`. Each entry
must be an exact file path or a narrow glob (no `**` wildcards). The
write set must not exceed 5 entries.

| Condition | Decision | Severity |
|-----------|----------|----------|
| `writeSet` is empty | `warn` (no explicit write scope) | `warning` |
| `writeSet` subset of `allowedFiles`, all entries narrow, count <= 5 | `pass` | `info` |
| `writeSet` entry uses `**` wildcard | `block` | `error` |
| `writeSet` count > 5 | `block` | `error` |
| `writeSet` entry not in `allowedFiles` | `block` | `error` |

**Blocker codes:**
- `WRITE_SET_TOO_BROAD` — writeSet entry contains `**` or exceeds 5 entries.
- `WRITE_SET_OUTSIDE_ALLOWED` — writeSet entry falls outside `allowedFiles`.

---

### 3. Clear Validation

The `validation` array must contain at least one command. Each entry
must be a non-empty string.

| Condition | Decision | Severity |
|-----------|----------|----------|
| `validation` has 1+ non-empty entries | `pass` | `info` |
| `validation` is empty or missing | `block` | `error` |
| `validation` entry is empty string | `block` | `error` |

**Blocker code:** `NO_VALIDATION`
**Message:** Task slice has no validation commands — every slice must be verifiable.

---

### 4. Rollback Plan

The `rollbackPlan` field must be present. The `strategy` must be one
of the allowed values.

| Condition | Decision | Severity |
|-----------|----------|----------|
| `rollbackPlan.strategy` is `git-revert`, `manual-fixforward`, or `auto-revert-if-ci-fails` | `pass` | `info` |
| `rollbackPlan` is missing | `block` | `error` |
| `rollbackPlan.strategy` is not a valid enum | `block` | `error` |

**Blocker code:** `NO_ROLLBACK_PLAN`
**Message:** Task slice has no rollback plan — every slice must be reversible.

---

### 5. Risk Tier

The `risk` field must be present and valid. High-risk slices require
a `sharedLocks` declaration if they touch any shared resource file.

| Condition | Decision | Severity |
|-----------|----------|----------|
| `risk` is `low` | `pass` | `info` |
| `risk` is `medium` | `pass` | `info` |
| `risk` is `high` and `sharedLocks` declared for shared resources | `pass` | `info` |
| `risk` is `high` and touches shared resource without `sharedLocks` | `block` | `error` |
| `risk` is missing or invalid | `block` | `error` |

**Blocker code:** `HIGH_RISK_NO_SHARED_LOCKS`
**Message:** High-risk slice touches {file} without declaring a sharedLock.

---

### 6. No Shared Lock Surprise

Every file in `allowedFiles` that matches a known shared resource
pattern must have a corresponding `sharedLocks` entry. This prevents
workers from silently depending on shared state without declaring it.

Known shared resource patterns:

| Pattern | Lock name |
|---------|-----------|
| `package.json`, `package-lock.json` | `package` |
| `prisma/**` | `prisma-schema` |
| `src/app.module.ts` | `app-module` |
| `docs/**/*.md` | `docs-index` |

| Condition | Decision | Severity |
|-----------|----------|----------|
| All shared resource files covered by `sharedLocks` | `pass` | `info` |
| Shared resource file in `allowedFiles` without matching lock | `block` | `error` |
| `sharedLocks` entry references unknown lock name | `warn` | `warning` |

**Blocker code:** `UNDECLARED_SHARED_LOCK`
**Message:** Slice touches {file} (shared resource {lockName}) without declaring sharedLock.

---

## Output Schema

The gate emits a result conforming to the
[Gate Result JSON Schema](gate-result-schema.md):

```json
{
  "schemaVersion": 1,
  "gateType": "task-slicing",
  "decision": "pass | block | warn",
  "severity": "info | warning | error",
  "markerId": "task-<issueN>-slicing",
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "targetIssue": 0,
  "targetPR": null,
  "factsRead": [],
  "blockers": [],
  "warnings": [],
  "producedFacts": []
}
```

### Gate Type Value

| Value | Gate |
|-------|------|
| `task-slicing` | Task slicing quality gate (this doc) |

Add this row to the [Gate Result Schema](gate-result-schema.md) gate
types table when implementing the gate script.

---

## Example: Passing Slice

```json
{
  "taskType": "execution",
  "workerClass": "docs-worker",
  "risk": "low",
  "conflictGroup": "ai-native-docs",
  "allowedFiles": ["docs/ai-native/task-slicing-quality-gate.md"],
  "forbiddenFiles": ["src/**", "prisma/**"],
  "writeSet": ["docs/ai-native/task-slicing-quality-gate.md"],
  "sharedLocks": [],
  "validation": ["npm run check"],
  "rollbackPlan": {
    "strategy": "git-revert",
    "notes": "Docs-only change, revert is safe"
  },
  "producesFacts": [
    {
      "factId": "fact:docs:task-slicing-quality-gate",
      "description": "task-slicing-quality-gate.md exists and defines the gate",
      "confidence": "definite"
    }
  ]
}
```

All six checks pass: single fact, narrow writeSet (1 entry, exact path),
validation present, rollback plan present, low risk, no shared resources.

---

## Example: Failing Slice (Multiple Violations)

```json
{
  "taskType": "execution",
  "risk": "high",
  "allowedFiles": ["src/modules/auth/**", "prisma/schema.prisma"],
  "writeSet": ["src/modules/auth/**"],
  "sharedLocks": [],
  "validation": [],
  "producesFacts": [
    { "factId": "fact:auth:login", "description": "login endpoint" },
    { "factId": "fact:auth:register", "description": "register endpoint" }
  ]
}
```

Violations:
- `MULTI_FACT_SLICE` (warn) — 2 facts, should split.
- `WRITE_SET_TOO_BROAD` (block) — `src/modules/auth/**` uses `**`.
- `NO_VALIDATION` (block) — empty validation array.
- `NO_ROLLBACK_PLAN` (block) — missing rollbackPlan.
- `HIGH_RISK_NO_SHARED_LOCKS` (block) — touches `prisma/schema.prisma` without lock.
- `UNDECLARED_SHARED_LOCK` (block) — `prisma/schema.prisma` requires `prisma-schema` lock.

Result: `decision: "block"`, `severity: "error"`, 5 blockers + 1 warning.

---

## Integration Points

### Compiler

The [opportunity-to-task compiler](opportunity-to-task-compiler-contract.md)
and [LLM-assisted task compiler](llm-assisted-task-compiler.md) should
run this gate on each emitted task JSON before returning it. A `block`
result means the compiler must reject the slice and request a narrower
scope.

### Launch Gate

The [launch gate](launch-gate.md) should consume the slicing gate
result as input. If the slicing gate returned `block`, the launch gate
must also block.

### Gate Result Schema

Add `"task-slicing"` to the `gateType` enum in
`schemas/gate-result.schema.json`.

---

## Non-Goals

- No changes to `package.json`, Prisma schema, or Nest runtime modules.
- No implementation of the gate script (planning doc only).
- No override mechanism — slicing quality is non-negotiable.

---

## See Also

- [Task Schema v2](task-schema-v2.md) — Fields validated by this gate
- [Gate Result Schema](gate-result-schema.md) — Output format
- [Parallel Work Policy](parallel-work-policy.md) — Conflict groups and shared locks
- [Worker Task Contract](worker-task-contract.md) — Base task JSON schema
- [Launch Gate](launch-gate.md) — Downstream consumer of slicing results
- [Opportunity-to-Task Compiler](opportunity-to-task-compiler-contract.md) — Upstream producer
