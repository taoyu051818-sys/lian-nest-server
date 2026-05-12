# writeSet and sharedLocks Policy

Defines how the scheduler uses `writeSet` and `sharedLocks` to govern
parallel worker dispatch, conflict detection, and merge decisions.

> **Closes:** [#1034](https://github.com/taoyu051818-sys/lian-nest-server/issues/1034)

---

## Overview

Every worker task declares two scheduling metadata fields:

- **`writeSet`** — the exact file paths the worker intends to write.
- **`sharedLocks`** — named resource locks the worker claims for
  serialized access.

These fields let the launcher detect conflicts at dispatch time and
the merge gate enforce serialization on shared resources.

| Concept | What it is | Granularity | Enforcement |
|---------|-----------|-------------|-------------|
| `writeSet` | Subset of `allowedFiles` — concrete write targets | File path | Soft warning on overlap |
| `sharedLocks` | Named resource lock (e.g. `app-module`) | Resource name | Hard block on overlap |

---

## writeSet

### Definition

`writeSet` is an array of file paths or glob patterns that a worker
is expected to edit. It is a **subset** of `allowedFiles` — the
broader boundary the worker may read. Only files the worker will
actually modify belong in `writeSet`.

### Purpose

- Reduces false-positive conflict warnings by distinguishing files
  the worker reads from files it writes.
- Enables the launch locks projection to record precise write
  targets for overlap detection.
- Supports merge-gate decisions: a PR whose writeSet does not
  intersect held locks can merge without waiting.

### Overlap Detection

| Condition | Result |
|-----------|--------|
| Pending task's `writeSet` intersects a held lock's `writeSet` | WARN — surfaces potential conflict |
| Pending task's `writeSet` intersects a held lock's `sharedLocks` file patterns | BLOCK — shared resource contention |
| Pending task's `writeSet` has no intersection | CLEAR — no conflict |

Write set overlap is a **soft check** — it produces a warning but
does not prevent dispatch when conflict groups differ. The rationale:
two workers editing different sections of the same file (e.g.
different test cases in a test file) may be safe. The warning
signals that human review should confirm no semantic conflict.

### When to Populate

Always populate `writeSet` for execution tasks. Omit only for
research tasks that produce no file changes.

```json
{
  "allowedFiles": ["src/auth/**", "prisma/schema.prisma"],
  "writeSet": ["src/auth/auth.service.ts", "prisma/schema.prisma"]
}
```

In this example, the worker may read any file under `src/auth/` but
only writes `auth.service.ts` and `schema.prisma`.

---

## sharedLocks

### Definition

`sharedLocks` is an array of named resource locks. Each lock name
maps to one or more physical files that must not be edited
concurrently by different workers.

### Purpose

- Prevents last-write-wins conflicts on shared files (e.g.
  `app.module.ts`, `package.json`).
- Extends the conflict group model: tasks with different
  `conflictGroup` values can still conflict if they share a lock.
- Enables fine-grained serialization without forcing unrelated tasks
  into the same conflict group.

### Conflict Detection

Two tasks in the same batch (or one task vs. a held lock) that claim
the same shared lock are **blocked**. The launcher refuses to
dispatch the second task until the first releases its lock.

| Condition | Result |
|-----------|--------|
| Pending task's `sharedLocks` intersects a held lock's `sharedLocks` | BLOCK |
| Pending task's `sharedLocks` has no intersection with any held lock | CLEAR |

This is a **hard check** — unlike writeSet overlap, shared lock
overlap always prevents dispatch.

---

## Supported Lock Names

| Lock name | Files protected | Typical claimants |
|-----------|----------------|-------------------|
| `app-module` | `src/app.module.ts` | Module wiring tasks |
| `package` | `package.json`, `package-lock.json` | Dependency install tasks |
| `prisma-schema` | `prisma/schema.prisma`, `prisma/migrations/**` | Schema migration tasks |
| `docs-index` | `docs/**/*.md` | Docs-authority tasks (additive writes) |
| `route-parity` | `src/**/*controller*.ts`, `src/**/*resolver*.ts` | Route registration tasks |

### Lock Name Conventions

- Lock names are lowercase kebab-case.
- Each name maps to a fixed set of file patterns — workers do not
  define custom patterns.
- New lock names require a PR updating this table and the
  `check-launch-gate.ps1` lock registry.

---

## Per-Resource Policy

### app-module

**Risk tier:** medium

`app.module.ts` is the NestJS root module. Adding a new module to
the `imports[]` array is a positional merge — two concurrent writes
produce last-write-wins, silently losing one import.

**Rule:** Tasks wiring modules into AppModule MUST claim
`sharedLocks: ["app-module"]`. The launcher serializes these tasks
even when their `conflictGroup` values differ.

**Validation:** After merge, `npm run check` must pass. The merged
`app.module.ts` must contain all expected imports.

**Rollback:** Revert the commit. The module is not wired, so no
runtime side effects persist.

### package

**Risk tier:** medium

`package.json` and `package-lock.json` are modified by dependency
install tasks. Concurrent `npm install` invocations produce
non-deterministic lock file merges.

**Rule:** Tasks that run `npm install` or edit `package.json` MUST
claim `sharedLocks: ["package"]`.

**Validation:** `npm ci` must succeed after merge. No unresolved
peer dependencies.

**Rollback:** Revert the commit. Run `npm ci` to restore the
previous lock file.

### prisma-schema

**Risk tier:** high

`prisma/schema.prisma` changes trigger migrations and generated
client updates. Concurrent schema edits produce conflicting
migrations that cannot be auto-resolved.

**Rule:** Tasks that modify the Prisma schema MUST claim
`sharedLocks: ["prisma-schema"]`. These tasks require
`mainHealthPolicy: "gate-all"` and the `migration-auditor` review
role.

**Validation:** `npx prisma validate` must pass. The generated
client must be regenerated (`npx prisma generate`) if the schema
changed.

**Rollback:** Revert the commit AND roll back the migration
(`npx prisma migrate resolve --rolled-back`). Coordinate with any
deployed code that depends on the new schema.

### docs-index

**Risk tier:** low

`docs/**/*.md` files are additive — new docs do not break existing
ones. The `docs-index` lock prevents duplicate H1 titles or
conflicting frontmatter, not content conflicts.

**Rule:** Docs tasks SHOULD claim `sharedLocks: ["docs-index"]`
when adding new files to `docs/`. Existing-file edits within docs
do not require the lock (covered by `conflictGroup`).

**Validation:** `npm run check` must pass. No duplicate H1 titles
across `docs/`.

**Rollback:** Revert the commit. No runtime impact.

### route-parity

**Risk tier:** medium

Controller and resolver files define API routes. Concurrent edits
to route decorators or resolver methods can produce duplicate or
conflicting endpoints.

**Rule:** Tasks that add or modify route registrations MUST claim
`sharedLocks: ["route-parity"]` when touching controller/resolver
files that share a route prefix.

**Validation:** `npm run check` must pass. Route parity guard
(if configured) must report no duplicates.

**Rollback:** Revert the commit. The route is removed, so no
runtime side effects persist.

---

## Merge Decision Matrix

The merge gate uses `writeSet` and `sharedLocks` to decide whether
a PR can merge without waiting for other in-flight tasks.

| Condition | Decision |
|-----------|----------|
| PR's `sharedLocks` are not held by any other in-flight task | ALLOW merge |
| PR's `sharedLocks` overlap with a held lock | BLOCK — wait for lock release |
| PR's `writeSet` overlaps with a held lock's `writeSet` (no shared lock) | WARN — merge with caution, verify no semantic conflict |
| PR has no `writeSet` or `sharedLocks` (research task) | ALLOW merge |

### Merge Ordering

When multiple PRs are ready and share no locks, merge order follows
the parallel work policy: fewest dependents first, then smallest
diff. When PRs share a lock, they merge in lock-acquisition order
(first acquired, first merged).

---

## Risk Tier Summary

| Resource | Lock name | Risk tier | Review role | Health policy |
|----------|-----------|-----------|-------------|---------------|
| AppModule | `app-module` | medium | backend-programmer | gate-all |
| Package deps | `package` | medium | repo-owner | gate-all |
| Prisma schema | `prisma-schema` | high | migration-auditor | gate-all |
| Docs index | `docs-index` | low | ai-architecture-reviewer | gate-docs-only |
| Route parity | `route-parity` | medium | backend-programmer | gate-all |

---

## Validation Checklist

Every task that declares `writeSet` or `sharedLocks` must satisfy:

1. `writeSet` is a subset of `allowedFiles`.
2. `sharedLocks` entries are valid lock names from the supported
   table above.
3. No two tasks in the same batch share a `sharedLocks` entry.
4. The task's `mainHealthPolicy` matches its risk tier.
5. After merge, `npm run check` passes.

---

## Rollback Policy

| Resource | Rollback action | Side effects |
|----------|----------------|-------------|
| AppModule | Revert commit | Module not wired — safe |
| Package deps | Revert commit + `npm ci` | Lock file restored — safe |
| Prisma schema | Revert commit + rollback migration | Requires coordination if migration deployed |
| Docs index | Revert commit | No runtime impact |
| Route parity | Revert commit | Route removed — safe |

For high-risk resources (prisma-schema), the rollback plan MUST be
documented in the task's `rollbackPlan` field before merge.

---

## Integration Points

| Component | How it uses writeSet/sharedLocks |
|-----------|--------------------------------|
| [Launch Gate](launch-gate.md) | Validates shared lock overlap before dispatch |
| [Launch Locks State](launch-locks-state.md) | Records held writeSet and sharedLocks per active worker |
| [Launch Locks Schema](launch-locks-schema.md) | JSON Schema for lock entries |
| [Parallel Work Policy](parallel-work-policy.md) | Rule 5 defines shared lock semantics |
| [Orchestration](orchestration.md) | Batch launcher enforces lock serialization |
| [Worker Task Contract](worker-task-contract.md) | Task JSON schema with writeSet/sharedLocks fields |
| [Controlled Auto-Merge](controlled-auto-merge.md) | Guard checks use writeSet for boundary validation |

---

## See Also

- [Parallel Work Policy](parallel-work-policy.md) — Conflict groups and Rule 5
- [Launch Locks State](launch-locks-state.md) — Lock lifecycle and stale detection
- [Launch Gate](launch-gate.md) — Pre-launch validation
- [Orchestration](orchestration.md) — High-parallel batch strategy
- [#1034](https://github.com/taoyu051818-sys/lian-nest-server/issues/1034) — This feature
