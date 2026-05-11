# Seed Constitution

Immutable rules for the AI development control plane. No automation,
worker, orchestrator, or script may self-expand, override, or relax
these boundaries. Changes require a human-authored PR reviewed by the
architecture-review role.

> **Authority:** This file is the single source of truth for control-plane
> invariants. All other policy documents derive from and must not contradict
> these rules.

---

## 1. High-Risk Human-Required Boundaries

The following operations MUST NOT be performed by any AI worker or
automation without explicit human approval in the issue or PR:

| Boundary | Why |
|----------|-----|
| Deleting or rotating secrets, tokens, or credentials | Irreversible exposure risk |
| Modifying `.env`, `.env.*`, or CI/CD pipeline definitions | Production blast radius |
| Changing Prisma schema or running migrations | Data integrity |
| Force-pushing to `main` or protected branches | History loss |
| Modifying `package.json` dependencies (add/remove) | Supply chain risk |
| Altering this constitution file | Self-expansion guard |
| Modifying `.github/ai-policy/**` | Policy integrity |
| Changing the launch gate, health gate, or batch launcher scripts | Control-plane integrity |

Workers encountering a task that touches any of these boundaries MUST
comment on the issue requesting human intervention. They MUST NOT
proceed, even if `allowedFiles` technically includes the path.

---

## 2. Explicit Merge Allowlists

Workers may only merge PRs that touch files within their declared
`allowedFiles` boundary. The boundary guard enforces this at validation
time.

### Allowlist Rules

1. **No implicit broadening.** A worker assigned `src/auth/**` may not
   also fix a typo in `src/posts/**`, even if the fix is trivial.
2. **No self-granted extensions.** A worker MUST NOT edit its task JSON
   or control-plane metadata to widen its own `allowedFiles`.
3. **Shared locks are explicit.** Access to shared resources (AppModule,
   package.json, Prisma schema) requires a declared `sharedLocks` entry
   in the task contract. See
   [parallel-work-policy.md](../../docs/ai-native/parallel-work-policy.md).
4. **Docs-only tasks stay in docs.** A task whose `allowedFiles` are
   exclusively under `docs/` MUST NOT edit source, scripts, or config
   files.

---

## 3. Main-Red Launch Stop

When the main branch health state is **red** (build broken, type-check
fails, Prisma schema invalid):

1. **No new feature or runtime workers may launch.** Only foundation-fix
   and health-repair workers are permitted.
2. **In-flight workers MUST be paused.** See
   [main-health-policy.md](../../docs/ai-native/main-health-policy.md)
   for the in-flight handling matrix.
3. **Recovery takes priority.** The orchestrator MUST dispatch a recovery
   worker before resuming any deferred work.
4. **No override.** The red-state block is absolute. There is no flag,
   environment variable, or script parameter that bypasses it.

This rule exists because merging code on a broken base compounds
failures and makes root-cause analysis impossible.

---

## 4. Legacy Backend Read-Only Policy

The legacy backend (`src/legacy/**`, `backend/**`, or any path
explicitly marked as legacy in the migration matrix) is **read-only**
for AI workers:

1. Workers MAY read legacy code to understand patterns or migration
   targets.
2. Workers MUST NOT modify, refactor, or delete legacy files.
3. Migration work requires a dedicated migration task with explicit
   human approval and a migration-specific `allowedFiles` boundary.
4. The migration matrix updater (if active) is the only automation
   that may propose legacy file changes — and even those require
   human review.

This prevents automated refactors from destabilizing the production
backend while migration is in progress.

---

## 5. No Worker Scope Expansion

A worker's scope is defined at task-launch time and is immutable for
the duration of that task:

1. **No self-expansion.** A worker MUST NOT modify its task JSON,
   `allowedFiles`, `conflictGroup`, or `sharedLocks` after launch.
2. **No transitive expansion.** Discovering a dependency on a file
   outside `allowedFiles` is a blocker, not an invitation to expand
   scope. The worker comments the blocker on the issue.
3. **No orchestration self-promotion.** A worker MUST NOT spawn
   sub-workers, create new tasks, or modify the orchestrator's
   scheduling state.
4. **No policy modification.** A worker MUST NOT edit any file under
   `.github/ai-policy/`, `.github/ai-state/`, or `docs/ai-native/`
   unless those paths are explicitly in its `allowedFiles`.

If a task cannot be completed within its declared boundaries, the
worker stops and documents the blocker. The orchestrator or a human
decides next steps.

---

## Enforcement

| Rule | Enforced By | When |
|------|-------------|------|
| High-risk boundaries | Boundary guard + worker honor system | Pre-merge validation |
| Merge allowlists | Boundary guard (`allowedFiles` check) | Pre-merge validation |
| Main-red launch stop | Launch gate (`check-launch-gate.ps1`) | Pre-launch |
| Legacy read-only | Boundary guard + migration matrix | Pre-merge validation |
| No scope expansion | Worker contract + task JSON immutability | Runtime |

Workers that violate these rules MUST have their PRs blocked. Repeated
violations trigger a review of the worker's task assignments.

---

## Amendment Process

These rules may only be changed by:

1. A human-authored PR (not generated by automation).
2. Review by the `architecture-review` role.
3. Approval by the repository owner.
4. A corresponding update to the docs mirror at
   [seed-constitution.md](../../docs/ai-native/seed-constitution.md).

No automation may propose, draft, or merge amendments to this file.

---

## References

- [main-health-policy.md](../../docs/ai-native/main-health-policy.md) — Health states and launch permissions.
- [parallel-work-policy.md](../../docs/ai-native/parallel-work-policy.md) — Conflict groups and shared locks.
- [worker-task-contract.md](../../docs/ai-native/worker-task-contract.md) — Task JSON schema.
- [launch-gate.md](../../docs/ai-native/launch-gate.md) — Pre-launch validation.
- [orchestration.md](../../docs/ai-native/orchestration.md) — Worker lifecycle.
