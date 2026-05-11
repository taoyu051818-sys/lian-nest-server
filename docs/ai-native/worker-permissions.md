# Worker Permissions Policy

Defines allowed file classes, forbidden file classes, and human-required escalation
triggers for each role-bounded AI worker class.

> **Machine-readable source:** [`.github/ai-policy/worker-permissions.json`](../../.github/ai-policy/worker-permissions.json)
>
> **Reference:** [backend-worker-layers.md](backend-worker-layers.md) for layer model,
> [roles.md](roles.md) for role definitions,
> [worker-task-contract.md](worker-task-contract.md) for task JSON schema,
> [parallel-work-policy.md](parallel-work-policy.md) for conflict groups.

---

## Purpose

Every AI worker operates within a bounded file set defined by its worker class.
This policy codifies those boundaries so the launcher, orchestrator, and human
reviewers can verify that a worker stayed within scope.

Worker classes are **not** the same as roles. A role (e.g., `backend-programmer`)
defines responsibilities and authority. A worker class (e.g., `runtime-feature`)
defines the file boundary. A single role may map to multiple worker classes
depending on the task.

---

## Worker Classes

### docs

| Aspect | Value |
|--------|-------|
| **Purpose** | Produces and maintains documentation under `docs/` and `ops/`. No runtime code. |
| **Layer** | 1 (Contract / Planning) |
| **Allowed** | `docs/**`, `ops/**`, `README.md` |
| **Forbidden** | `src/**`, `prisma/**`, `scripts/**`, `schemas/**`, `package.json`, `package-lock.json` |
| **Escalate when** | Proposes changes to shared docs outside `docs/` or `ops/`; needs to edit `SOP.md` or `roles.md` that affect other worker classes; encounters links to files that no longer exist |

### tests

| Aspect | Value |
|--------|-------|
| **Purpose** | Writes and maintains test files under `test/`. May read source but not modify it. |
| **Layer** | 4 (Feature / Repository) |
| **Allowed** | `test/**` |
| **Forbidden** | `src/**`, `prisma/**`, `scripts/**`, `schemas/**`, `package.json`, `package-lock.json` |
| **Escalate when** | Test requires a source code change to be testable; test reveals a blocking source bug; needs a new test utility requiring a shared dependency |

### tooling

| Aspect | Value |
|--------|-------|
| **Purpose** | Maintains scripts, CI config, and developer tooling. No application source. |
| **Layer** | 3 (Health / Diagnostic) |
| **Allowed** | `scripts/**`, `.github/**` |
| **Forbidden** | `src/**`, `prisma/**`, `schemas/**`, `package.json`, `package-lock.json` |
| **Escalate when** | Script requires a new npm dependency; CI config change affects merge protection rules; tooling change alters build output or validation behavior |

### runtime-feature

| Aspect | Value |
|--------|-------|
| **Purpose** | Implements business module code under `src/<slice>/`. |
| **Layer** | 4 (Feature / Repository) |
| **Allowed** | `src/**`, `test/**` |
| **Forbidden** | `src/generated/**`, `src/prisma/**`, `prisma/**`, `scripts/**`, `schemas/**`, `package.json`, `package-lock.json` |
| **Escalate when** | Needs to modify Prisma schema or generated client; requires a new NestJS module outside existing feature slices; change affects auth flows; touches shared `AppModule` imports |

### runtime-foundation

| Aspect | Value |
|--------|-------|
| **Purpose** | Resolves runtime blockers: Prisma client bootstrap, `DatabaseModule`, `RedisModule`, core DI. |
| **Layer** | 2 (Runtime Foundation) |
| **Allowed** | `src/prisma/**`, `src/database/**`, `src/common/**` |
| **Forbidden** | `src/generated/**`, `src/**/*.controller.ts`, `src/**/*.module.ts`, `prisma/schema.prisma`, `scripts/**`, `schemas/**`, `package.json`, `package-lock.json` |
| **Escalate when** | Requires modifying `prisma/schema.prisma`; requires changing `package.json` dependencies; foundation change would break existing feature slices; generated client needs regeneration |

### prisma

| Aspect | Value |
|--------|-------|
| **Purpose** | Manages Prisma schema changes and database migrations. May trigger generated client regeneration. |
| **Layer** | 2 (Runtime Foundation) |
| **Allowed** | `prisma/**` |
| **Forbidden** | `src/**`, `scripts/**`, `schemas/**`, `package.json`, `package-lock.json` |
| **Escalate when** | Migration drops a column or table with existing data; schema change affects more than one feature slice; requires a data migration script; migration is not reversible |

### review

| Aspect | Value |
|--------|-------|
| **Purpose** | Cross-cutting review, parity checks, security audit, migration audit. Read-only. |
| **Layer** | 5 (Review / Audit) |
| **Allowed** | `docs/**`, `.github/**` |
| **Forbidden** | `src/**`, `prisma/**`, `scripts/**`, `schemas/**`, `package.json`, `package-lock.json` |
| **Escalate when** | Review finds a security vulnerability requiring immediate source fix; review discovers an architectural violation blocking merge; review requires runtime logs or production data |

### merge

| Aspect | Value |
|--------|-------|
| **Purpose** | Merge queue management, release prep, final integration validation. |
| **Layer** | 6 (Merge / Release) |
| **Allowed** | `docs/ai-native/merge-closure-sop.md`, `docs/ai-native/merge-queue-assistant.md`, `.github/**` |
| **Forbidden** | `src/**`, `prisma/**`, `scripts/**`, `schemas/**`, `package.json`, `package-lock.json` |
| **Escalate when** | Merge conflict cannot be resolved automatically; health gate fails with unclear root cause; release requires cherry-pick or branch management decision |

### state-reconciler

| Aspect | Value |
|--------|-------|
| **Purpose** | Manages AI-native control-plane state files (`ai-state/`, wave tracking, task manifests). |
| **Layer** | Control plane |
| **Allowed** | `.github/ai-state/**`, `docs/ai-native/**` |
| **Forbidden** | `src/**`, `prisma/**`, `scripts/**`, `schemas/**`, `package.json`, `package-lock.json` |
| **Escalate when** | State file references a worker or task that no longer exists; wave tracking is out of sync with actual merge history; reconciliation requires deleting or overwriting a completed task record |

### provider-pool

| Aspect | Value |
|--------|-------|
| **Purpose** | Manages AI provider configuration, model routing, and fallback policies for worker dispatch. |
| **Layer** | Control plane |
| **Allowed** | `.github/ai-policy/**`, `.github/ai-state/**` |
| **Forbidden** | `src/**`, `prisma/**`, `scripts/**`, `schemas/**`, `package.json`, `package-lock.json` |
| **Escalate when** | Adding a new AI provider or model to the pool; changing fallback behavior that affects all workers; modifying rate limits or cost thresholds |

### meta-loop

| Aspect | Value |
|--------|-------|
| **Purpose** | Orchestrates the self-cycle loop, wave planning, and batch scheduling. Top-level control-plane automation. |
| **Layer** | Control plane |
| **Allowed** | `.github/ai-policy/**`, `docs/ai-native/**` |
| **Forbidden** | `src/**`, `prisma/**`, `scripts/**`, `schemas/**`, `package.json`, `package-lock.json` |
| **Escalate when** | Loop detects conflicting wave assignments; batch scheduling requires overriding conflict group rules; self-cycle enters a retry loop exceeding `maxRetries`; wave planning requires splitting a task across multiple workers |

---

## Global Forbidden Files

All worker classes share these forbidden entries regardless of their specific boundaries:

| Pattern | Reason |
|---------|--------|
| `.env`, `.env.*` | Secrets must never appear in worker diffs |
| `node_modules/**` | Ephemeral; managed by `npm install` |
| `dist/**` | Build output; regenerated by `npm run build` |
| `.git/**` | Git internals; never directly edited |

---

## How to Use This Policy

### For the launcher

When constructing a worker task JSON, look up the worker class in
`worker-permissions.json` and set `allowedFiles` / `forbiddenFiles` accordingly.
The launcher MUST NOT dispatch a worker whose effective file set violates its
class boundary.

### For the orchestrator

When assigning a worker class to a task, verify that the task's scope fits within
the class's `allowedFileClasses`. If the task requires files outside the boundary,
either reassign to a broader worker class or split the task.

### For reviewers

When reviewing a PR, verify that all changed files fall within the worker class's
`allowedFileClasses` and none are in `forbiddenFileClasses`. If a file outside the
boundary was changed, request changes and ask the worker to justify the deviation
or escalate per the `humanEscalation` triggers.

### For workers

Read this policy before starting work. If you discover that your task requires
files outside your worker class boundary, stop and comment on the issue with the
blocker. Do not edit forbidden files even if they seem related — escalate instead.

---

## Relationship to Existing Policies

| Existing Policy | How This Policy Extends It |
|-----------------|---------------------------|
| `backend-worker-layers.md` | Maps worker classes to layers; this policy adds the file-level boundary per class |
| `worker-task-contract.md` | Task JSON carries `allowedFiles`/`forbiddenFiles`; this policy is the source of truth for those fields |
| `parallel-work-policy.md` | Conflict groups are orthogonal to worker classes; two workers in the same class can still conflict if they share files |
| `generated-code-policy.md` | `runtime-feature` and `runtime-foundation` forbid `src/generated/**`; `prisma` workers may trigger regeneration |
| `roles.md` | Roles define authority; worker classes define file boundaries. A role may span multiple worker classes |

---

## Adding a New Worker Class

1. Define the class in `.github/ai-policy/worker-permissions.json` with `allowedFileClasses`, `forbiddenFileClasses`, and `humanEscalation`.
2. Add a section to this document.
3. Update the `backend-worker-layers.md` layer table if the class maps to a new or existing layer.
4. Run `npm run check` and `npm run build` to verify no regressions.
5. Open a PR with the change linked to the relevant issue.

---

## Decision Log

| Date | Decision | Issue |
|------|----------|-------|
| 2026-05-11 | Initial worker permissions policy created for 11 worker classes | #358 |
