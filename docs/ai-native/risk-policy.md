# Risk Policy

Defines high-risk categories that gate AI worker scheduling and merge
decisions. The machine-readable policy lives at
`.github/ai-policy/risk-policy.json` — this document explains the
categories and how they interact with the launch gate and merge flow.

> **Closes:** [#355](https://github.com/taoyu051818-sys/lian-nest-server/issues/355)

---

## Overview

Not all code changes carry equal risk. A typo fix in a doc file is
fundamentally different from a migration that drops a column. This policy
classifies file areas into risk categories so the orchestrator and merge
gates can enforce proportionate controls.

The policy applies two independent controls per category:

1. **Merge gate** — what review is required before a PR may merge.
2. **Launch restriction** — which worker types may be dispatched for tasks
   in that category.

---

## Risk Categories

| Category | Risk | Merge Gate | Launch Restriction |
|----------|------|------------|--------------------|
| Auth / Session | high | architect-review | foundation-fix-or-higher |
| DB / Schema / Migration | high | architect-review | foundation-fix-or-higher |
| NodeBB Auth Mode | high | architect-review | foundation-fix-or-higher |
| Security Policy | high | architect-review | foundation-fix-or-higher |
| Production Deployment Defaults | high | architect-review | foundation-fix-or-higher |
| Destructive Data Changes | high | architect-review-plus-dry-run | foundation-fix-or-higher |
| Legacy Cutover | high | architect-review | foundation-fix-or-higher |
| Automation Policy | high | architect-review | any-worker |

All other file areas default to `low` risk, `auto-merge` gate, and
`any-worker` launch restriction.

---

## Category Definitions

### Auth / Session

**Files:** `src/**/auth/**`, `src/**/session/**`, `src/**/jwt/**`, `src/**/passport/**`, `src/**/guard/**`

Changes to authentication, session management, JWT handling, or guards
affect every authenticated request. A regression here can lock out all
users or create privilege escalation paths.

### DB / Schema / Migration

**Files:** `prisma/**`, `src/generated/prisma/**`, `src/**/migration*/**`

Schema changes and migrations affect all downstream services and the
generated Prisma client. Requires passing `prisma generate` and typecheck
after the change.

### NodeBB Auth Mode

**Files:** `src/**/nodebb/**`, `src/**/forum-auth/**`, `src/**/sso/**`

NodeBB authentication mode changes can break the forum integration and
SSO flow. These areas are tightly coupled to external systems.

### Security Policy

**Files:** `src/**/middleware/**`, `src/**/interceptor/**`, `src/**/filter/**`, `.github/**`

Middleware, interceptors, exception filters, and CI/policy configuration
affect the entire request pipeline and deployment safety net.

### Production Deployment Defaults

**Files:** `src/main.ts`, `src/**/config/**`, `.env.example`, `docker*`, `Dockerfile*`, `docker-compose*`

Bootstrap code, application configuration, and deployment defaults
directly control production behavior. Incorrect defaults can cause
outages or data loss.

### Destructive Data Changes

**Files:** `prisma/migrations/**`

Migration files that drop columns, tables, or alter existing data require
dry-run validation in addition to architect review. This is the only
category with the `architect-review-plus-dry-run` gate.

### Legacy Cutover

**Files:** `src/**/legacy/**`, `src/**/compat/**`, `src/**/v1/**`

Legacy compatibility layers and cutover logic require careful sequencing.
Premature removal breaks backward compatibility; delayed removal blocks
progress.

### Automation Policy

**Files:** `.github/ai-policy/**`, `.github/ai-state/**`, `docs/ai-native/*policy*.md`, `docs/ai-native/*gate*.md`

Policy and automation configuration changes affect all workers in the
fleet. Any worker type may propose changes, but architect review is
required before merge.

---

## Merge Gate Definitions

| Gate | Meaning |
|------|---------|
| `auto-merge` | PR may be auto-merged after passing all CI checks. No explicit human review required. |
| `architect-review` | PR requires explicit approval from a reviewer with the `architecture-review` role before merge. |
| `architect-review-plus-dry-run` | PR requires architect review AND a dry-run validation of the migration or destructive operation. |

---

## Launch Restriction Definitions

| Restriction | Meaning |
|-------------|---------|
| `any-worker` | Any worker type may be dispatched for tasks in this category. |
| `foundation-fix-or-higher` | Only foundation-fix, health-repair, or recovery workers may be dispatched. Runtime feature workers are blocked from touching these areas unless main is green and the task is explicitly approved. |

---

## Integration with Launch Gate

The [launch gate](launch-gate.md) consults `risk-policy.json` when
evaluating tasks. The evaluation order is:

1. Determine the worker type (from `mainHealthPolicy` or heuristic).
2. Check main health state against the
   [main-health-policy](main-health-policy.md) matrix.
3. Match the task's `allowedFiles` against risk category `filePatterns`.
4. If any matched category has a launch restriction tighter than the
   worker type, block the task.

The risk policy adds a layer on top of the main-health matrix. A task may
pass the health check but still be blocked because its file area requires
a higher-privilege worker type.

---

## Integration with Merge Gates

The merge gate system reads the risk categories to determine whether a PR
needs architect review:

1. Compute the union of risk categories matched by the PR's changed files.
2. Take the strictest merge gate across all matched categories.
3. Enforce that gate before allowing merge.

A PR that touches both `docs/` (low risk) and `src/**/auth/**` (high risk)
gets the `architect-review` gate because the auth category is stricter.

---

## JSON Schema

The full machine-readable policy is at
`.github/ai-policy/risk-policy.json`. Key structure:

```json
{
  "version": 1,
  "categories": {
    "<category-id>": {
      "risk": "high",
      "label": "Human-readable name",
      "filePatterns": ["glob patterns"],
      "mergeGate": "architect-review",
      "launchRestriction": "foundation-fix-or-higher",
      "notes": "Explanation"
    }
  },
  "globalDefaults": {
    "defaultRisk": "low",
    "defaultMergeGate": "auto-merge",
    "defaultLaunchRestriction": "any-worker"
  }
}
```

Consumers SHOULD use the `globalDefaults` for files that do not match any
category pattern.

---

## References

- [launch-gate.md](launch-gate.md) — Pre-launch validation checker.
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
- [parallel-work-policy.md](parallel-work-policy.md) — Conflict groups and parallelism rules.
- [generated-code-policy.md](generated-code-policy.md) — Generated artifact ownership.
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema.
