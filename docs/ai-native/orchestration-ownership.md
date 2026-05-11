# Orchestration Ownership

Defines which repository owns AI-native orchestration going forward and the
boundary between active orchestration and legacy reference.

> **Reference:** [SOP.md](SOP.md) for lifecycle flow,
> [roles.md](roles.md) for role definitions,
> [parallel-work-policy.md](parallel-work-policy.md) for conflict groups,
> [lian-platform-server-orchestration-retirement.md](../migration/lian-platform-server-orchestration-retirement.md)
> for the legacy retirement path.

---

## Owner

**`lian-nest-server`** is the sole owner of all future AI orchestration work.

This includes:

- Worker task contracts and validation commands.
- Orchestrator prompts, launcher scripts, and monitor logic.
- Conflict group definitions and parallel work policy.
- Review gates, acceptance criteria, and merge SOPs.
- Health gates, writeback checklists, and next-wave policy.

Any new orchestration feature, policy change, or tooling addition MUST land in
this repository.

---

## Legacy Status: `lian-platform-server`

`lian-platform-server` is a **read-only legacy reference** for orchestration.

| Aspect | Status |
|--------|--------|
| Orchestration scripts | Frozen — no new features |
| Launcher / monitor | Frozen — read-only reference |
| Merge helper | Frozen — read-only reference |
| Health gate | Frozen — read-only reference |
| Bug fixes | Security patches only |
| New orchestration | Forbidden — target `lian-nest-server` |

See the [freeze policy](../migration/lian-platform-server-orchestration-retirement.md#freeze-policy)
for enforcement details.

---

## Decision Log

| Date | Decision | Issue |
|------|----------|-------|
| 2026-05-11 | `lian-nest-server` declared sole orchestration owner | #90 |
