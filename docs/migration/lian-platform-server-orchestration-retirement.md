# lian-platform-server Orchestration Retirement

Defines the retirement path for orchestration tooling that currently lives in
`lian-platform-server`. All orchestration is moving to `lian-nest-server`;
this document tracks the freeze, migration checklist, and eventual removal.

> **Owner document:** [orchestration-ownership.md](../ai-native/orchestration-ownership.md)
> establishes `lian-nest-server` as the sole orchestration owner.
> **Backend source of truth:** [backend-source-of-truth.md](../contracts/backend-source-of-truth.md)
> declares `lian-nest-server` as the explicit backend source of truth.
> **Reference:** [legacy-freeze-rules.md](legacy-freeze-rules.md) for general
> legacy freeze policy, [legacy-shutdown-matrix.md](legacy-shutdown-matrix.md)
> for endpoint-level shutdown tracking.

---

## Freeze Policy

Effective immediately, `lian-platform-server` orchestration is frozen.

| Rule | Detail |
|------|--------|
| No new features | Orchestration scripts, prompts, and tooling must not receive new capabilities. |
| No refactors | Code quality improvements target `lian-nest-server` instead. |
| Security patches only | Critical fixes (auth bypass, secret leak, injection) may be patched. |
| Read-only reference | Existing code may be read to understand behavior; it is not a dependency. |
| New work forbidden | Any orchestration change that is not a security patch MUST target `lian-nest-server`. |

Violations are caught by review gate — PRs adding orchestration features to
`lian-platform-server` must be rejected or redirected.

---

## Migration Checklist

Each component below must be migrated to `lian-nest-server` before the legacy
copy can be considered retired. Track progress in the table.

| Component | Purpose | Migration Status | Target Location | Notes |
|-----------|---------|-----------------|-----------------|-------|
| Launcher | Batch worker dispatch, issue-to-worker mapping | `NOT_STARTED` | `ops/launcher/` | Core orchestration entrypoint |
| Monitor | Post-PR audit, label updates, writeback verification | `NOT_STARTED` | `ops/monitor/` | Runs after worker marks `agent:done` |
| Publisher | Issue creation from wave definitions | `NOT_STARTED` | `ops/publisher/` | Generates bounded issues for workers |
| Merge helper | Merge queue management, rebase automation | `NOT_STARTED` | `ops/merge-helper/` | Coordinates parallel PR merges |
| Health gate | Post-merge CI validation, rollback trigger | `NOT_STARTED` | `ops/health-gate/` | Must integrate with existing `post-merge-health-gate.md` |

### Status Definitions

| Status | Meaning |
|--------|---------|
| `NOT_STARTED` | No `lian-nest-server` equivalent exists yet. |
| `IN_PROGRESS` | Active development in `lian-nest-server`. |
| `PARITY` | Feature-complete; legacy and nest versions produce identical results. |
| `RETIRED` | Legacy copy removed or disabled; `lian-nest-server` is the sole handler. |

---

## Migration Order

Components should be migrated in dependency order:

```
Launcher (no deps)
  → Monitor (depends on launcher output format)
  → Publisher (depends on launcher issue format)
  → Merge helper (depends on monitor completion signals)
  → Health gate (depends on merge helper for post-merge trigger)
```

Parallel migration is acceptable if two components share no runtime interface.

---

## Retirement Criteria

A component advances to `RETIRED` when **all** of the following are true:

1. **`lian-nest-server` implementation live** — component exists and is functional.
2. **Parity confirmed** — output matches legacy behavior for representative inputs.
3. **No legacy callers** — nothing in CI or automation invokes the legacy copy.
4. **Rollback plan** — documented way to re-enable legacy component on regression.
5. **This document updated** — checklist row shows `RETIRED`.

---

## How to Update This Document

1. Begin migrating a component → update status from `NOT_STARTED` to `IN_PROGRESS`.
2. Reach feature parity → advance to `PARITY`. Attach parity evidence in PR.
3. All retirement criteria met → advance to `RETIRED`. Record in the Retirement Log.

---

## Retirement Log

| Date | Component | Issue | PR | Notes |
|------|-----------|-------|----|-------|
| — | — | — | — | No retirements yet |

---

> **Note:** This document covers orchestration tooling only. Endpoint migration
> is tracked separately in [legacy-shutdown-matrix.md](legacy-shutdown-matrix.md).
