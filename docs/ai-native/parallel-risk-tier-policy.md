# Parallelism by Risk Tier

Defines how parallel concurrency limits vary by task risk tier. Each tier
maps to a maximum concurrency, required validation, and escalation boundary.

> **Closes:** [#1035](https://github.com/taoyu051818-sys/lian-nest-server/issues/1035)
>
> **Reference:** [Parallel Work Policy](parallel-work-policy.md) for conflict
> group rules, [Resource Slot Scheduling](resource-slot-scheduling.md) for
> slot allocation, [Worker Task Contract](worker-task-contract.md) for task
> JSON schema.

---

## Problem

The existing parallel work policy defines conflict groups and serial/parallel
execution rules, but does not vary concurrency limits by task risk. A docs-only
edit and a database migration are governed by the same parallelism model, which
either over-constrains low-risk work or under-constrains high-risk work.

Risk-tier parallelism adds a layer on top of conflict groups: even when two
tasks are in different conflict groups and have no file overlap, their risk
tier determines whether they may run concurrently and what validation is
required.

## Goals

- Map each task risk tier to a concurrency limit and validation requirement.
- Define human-required escalation boundaries for high-risk tiers.
- Keep the model compatible with existing conflict groups and slot scheduling.
- Provide a clear decision flow for the launcher to gate parallel dispatch.

## Non-Goals

- No changes to `package.json`, Prisma schema, or Nest runtime modules.
- No implementation of risk-tier enforcement scripts (planning doc only).
- No bypass of existing conflict group or shared lock rules.

---

## Risk Tiers

| Tier | Label | Max Parallel | Validation | Human Gate |
|------|-------|-------------|------------|------------|
| 1 | Docs | Unlimited | `npm run check` | No |
| 2 | Test | 4 | `npm run check` | No |
| 3 | Fixture | 3 | `npm run check` + fixture consistency | No |
| 4 | Runtime | 2 | `npm run check` + `npm run build` | Reviewer required |
| 5 | High-Risk | 1 | `npm run check` + `npm run build` + full health gate | Human approval required |

### Tier Definitions

#### Tier 1: Docs

Tasks whose `allowedFiles` are exclusively under `docs/`. Pure documentation
changes with no runtime effect.

- **Concurrency:** Unlimited within slot availability.
- **Validation:** `npm run check` only.
- **Escalation:** None — auto-merge eligible after review.
- **writeSet:** `docs/**` only.
- **sharedLocks:** May claim `docs-index` lock.

#### Tier 2: Test

Tasks whose `allowedFiles` are exclusively under `test/`, `__tests__/`, or
`*.spec.ts` / `*.test.ts` patterns. Test-only changes that do not affect
production code.

- **Concurrency:** Up to 4 parallel workers.
- **Validation:** `npm run check`.
- **Escalation:** None — auto-merge eligible after review.
- **writeSet:** `test/**`, `__tests__/**/*.spec.ts`, `__tests__/**/*.test.ts`.
- **sharedLocks:** None expected.

#### Tier 3: Fixture

Tasks whose `allowedFiles` include fixture files, seed data, mock data, or
test helpers, but do not touch runtime source or database schema.

- **Concurrency:** Up to 3 parallel workers.
- **Validation:** `npm run check` + fixture consistency check (no duplicate
  fixture keys, no stale references).
- **Escalation:** None — auto-merge eligible after review.
- **writeSet:** `fixtures/**`, `seeds/**`, `mocks/**`, `**/*.fixture.ts`.
- **sharedLocks:** May claim `docs-index` lock if docs are co-changed.

#### Tier 4: Runtime

Tasks whose `allowedFiles` include files under `src/` that are NOT auth,
database migration, or public API surface. Standard feature and bugfix work.

- **Concurrency:** Up to 2 parallel workers (must be in different conflict
  groups).
- **Validation:** `npm run check` + `npm run build`.
- **Escalation:** Requires at least one reviewer approval before merge.
- **writeSet:** `src/**` (excluding auth, migrations, public API).
- **sharedLocks:** Must declare all shared locks (`app-module`, `package`,
  `prisma-schema`) if applicable.

#### Tier 5: High-Risk

Tasks whose `allowedFiles` include auth modules, database migrations, public
API surface, or security-sensitive code. Changes that affect data integrity,
authentication, or external API contracts.

- **Concurrency:** 1 (serialized, no parallel workers).
- **Validation:** `npm run check` + `npm run build` + full health gate
  (`scripts/post-merge-health-gate.js --full`).
- **Escalation:** Requires human approval from designated role
  (`security-reviewer`, `migration-auditor`, or `architect`).
- **writeSet:** `src/modules/auth/**`, `prisma/migrations/**`,
  `src/modules/**/dto/*.dto.ts` (public API), security middleware.
- **sharedLocks:** Must declare all shared locks. May not auto-merge.

---

## writeSet and sharedLocks

Each tier constrains the write set — the set of files a worker may modify.
The launcher validates that the task's `allowedFiles` fall within the tier's
`writeSet` boundaries before dispatch.

sharedLocks extend the conflict group model for files that multiple tasks
need to touch but cannot be safely written concurrently. The tier determines
which locks are mandatory:

| Tier | Required Locks | Optional Locks |
|------|---------------|----------------|
| Docs | — | `docs-index` |
| Test | — | — |
| Fixture | — | `docs-index` |
| Runtime | `app-module`, `package`, `prisma-schema` (if applicable) | `docs-index` |
| High-Risk | All applicable | None — must declare all |

If a worker's declared `sharedLocks` conflict with another active worker's
locks, the launch gate blocks dispatch regardless of slot availability.

---

## Decision Flow

```
Task arrives for dispatch
       │
       ▼
  Determine risk tier from task.risk + allowedFiles
       │
       ├── Tier 5 (High-Risk)
       │     ├── Check: no other Tier 5 worker active
       │     ├── Check: human approval present
       │     ├── Validate: npm run check + build + full health gate
       │     └── DISPATCH or BLOCK
       │
       ├── Tier 4 (Runtime)
       │     ├── Check: < 2 Tier 4 workers active in different groups
       │     ├── Check: sharedLocks do not conflict
       │     ├── Validate: npm run check + build
       │     └── DISPATCH or BLOCK
       │
       ├── Tier 3 (Fixture)
       │     ├── Check: < 3 Tier 3 workers active
       │     ├── Validate: npm run check + fixture consistency
       │     └── DISPATCH or BLOCK
       │
       ├── Tier 2 (Test)
       │     ├── Check: < 4 Tier 2 workers active
       │     ├── Validate: npm run check
       │     └── DISPATCH or BLOCK
       │
       └── Tier 1 (Docs)
             ├── Check: slot availability only
             ├── Validate: npm run check
             └── DISPATCH or BLOCK
```

---

## Tier Assignment Rules

1. A task's tier is the **highest** tier that matches any file in its
   `allowedFiles`. A task touching both `docs/` and `src/` is Tier 4 or 5,
   not Tier 1.
2. If `allowedFiles` intersect with High-Risk patterns, the task is Tier 5
   regardless of other files.
3. Tasks with empty `allowedFiles` or research-only tasks default to Tier 1.
4. The task JSON may override tier via a `riskTier` field; the launcher
   validates that the declared tier is not lower than the computed tier.

---

## Rollback by Tier

| Tier | Rollback Strategy |
|------|-------------------|
| Docs | Revert commit — no runtime effect |
| Test | Revert commit — no runtime effect |
| Fixture | Revert commit — verify test suite still passes |
| Runtime | Revert commit + re-run health gate + notify on-call if main is red |
| High-Risk | Revert commit + full health gate + incident review + human confirmation |

High-risk rollbacks require human confirmation because the revert itself may
need coordinated changes (e.g., reverting a migration requires a
counter-migration).

---

## Interaction with Existing Policies

### Parallel Work Policy

Risk tiers add a concurrency cap on top of conflict groups. Two tasks in
different conflict groups may still be limited by their tier's max parallel
count. Conflict group serialization is always respected first.

### Resource Slot Scheduling

The slot model determines how many workers the machine can run. Risk tiers
determine how many workers of a given tier may run. Both constraints must be
satisfied:

```
effectiveWorkers = min(slotAvailability, tierMaxParallel, conflictGroupEligible)
```

### Controlled Auto-Merge

Only Tier 1 (Docs) and Tier 2 (Test) tasks are eligible for auto-merge.
Tier 3+ tasks require reviewer approval. Tier 5 tasks require human approval
from a designated role.

### Launch Gate

The launch gate validates tier assignment, sharedLock conflicts, and
concurrency caps before dispatch. A task that exceeds its tier's parallel
limit is blocked until a slot frees.

---

## Monitoring

The launcher should emit a tier utilization record after each dispatch cycle:

```json
{
  "capturedAt": "2026-05-12T09:00:00Z",
  "tiers": {
    "docs": { "active": 3, "max": "unlimited" },
    "test": { "active": 2, "max": 4 },
    "fixture": { "active": 1, "max": 3 },
    "runtime": { "active": 1, "max": 2 },
    "highRisk": { "active": 0, "max": 1 }
  },
  "blocked": []
}
```

---

## References

- [Parallel Work Policy](parallel-work-policy.md) — Conflict group rules
- [Resource Slot Scheduling](resource-slot-scheduling.md) — Slot allocation model
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Launch Gate](launch-gate.md) — Pre-dispatch validation
- [Controlled Auto-Merge](controlled-auto-merge.md) — Auto-merge eligibility
- [PR Review Gate](pr-review-gate.md) — Review criteria
