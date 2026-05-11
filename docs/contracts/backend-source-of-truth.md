# Backend Source-of-Truth Contract

Declares `lian-nest-server` as the explicit backend source of truth and defines
how legacy backend references may be used during migration.

> **Issue:** #298 | **Scope:** Contract docs only. No runtime changes.
> **Reference:** [orchestration-ownership.md](../ai-native/orchestration-ownership.md)
> for orchestration ownership, [lian-platform-server-orchestration-retirement.md](../migration/lian-platform-server-orchestration-retirement.md)
> for the legacy retirement path.

---

## Source-of-Truth Declaration

**`lian-nest-server`** is the sole backend source of truth for the LIAN platform.

This means:

| Domain | Source of Truth | Legacy Reference |
|--------|-----------------|------------------|
| API endpoint behavior | `docs/contracts/` in this repo | `lian-platform-server` code (read-only) |
| Module design decisions | `docs/architecture/` in this repo | `lian-platform-server` code (read-only) |
| Database schema | `prisma/schema.prisma` in this repo | `lian-platform-server` schema (read-only) |
| Authentication logic | `src/auth/` in this repo | `lian-platform-server` auth (read-only) |
| Orchestration tooling | `ops/` in this repo | `lian-platform-server` scripts (frozen) |

Any new backend work — features, bug fixes, refactors, schema changes — MUST
target `lian-nest-server`. The legacy backend is a read-only reference, not a
dependency.

---

## Legacy Reference Usage During Migration

During migration, `lian-platform-server` code may be consulted under strict
conditions. This section defines what is permitted and what is forbidden.

### Permitted Uses

| Use Case | How to Reference | Constraint |
|----------|------------------|------------|
| Understand existing behavior | Read legacy source code | Do not copy blindly; verify against contracts |
| Parity verification | Compare legacy output with nest output | Use `docs/contracts/` as the behavioral spec |
| Schema migration | Read legacy schema for field definitions | Prisma schema in this repo is authoritative |
| Route discovery | Read legacy route definitions | Add discovered routes to `docs/contracts/route-inventory.md` |
| Test fixture creation | Capture legacy response shapes | Store in `docs/contracts/` parity fixtures |

### Forbidden Uses

| Pattern | Why It's Forbidden |
|---------|-------------------|
| Import legacy code as a dependency | Creates a runtime coupling to frozen code |
| Copy legacy logic without adaptation | Introduces legacy patterns into nest codebase |
| Treat legacy behavior as authoritative | Contracts in this repo define correct behavior |
| Reference legacy for new feature design | New features design against contracts, not legacy |
| Use legacy schema as source of truth | `prisma/schema.prisma` is authoritative |

### Decision Rule: Contract Wins

When legacy behavior and `docs/contracts/` disagree, the contract is correct.
Legacy code may contain bugs, undocumented behavior, or NodeBB-specific quirks
that are not part of the intended API surface.

---

## Documentation Authority Hierarchy

For backend decisions, documentation authority flows as follows:

```
docs/contracts/          (behavioral source of truth — what endpoints do)
  ↓ supersedes
docs/architecture/       (design rationale — why modules are structured this way)
  ↓ supersedes
docs/migration/          (operational guidance — how to implement migration slices)
  ↓ supersedes
Legacy code              (read-only reference — what the old system did)
```

When a migration doc and a contract doc cover the same endpoint, the contract
is authoritative. Migration docs describe *how* to build; contracts define
*what* the endpoint must do.

---

## Enforcement

### Documentation Guard

The `check-docs-authority` guard detects documentation that incorrectly treats
`lian-platform-server` as the source of truth for new work. See
[docs-authority-map.md](../ai-native/docs-authority-map.md#legacy-source-of-truth-drift-guard)
for drift patterns and worker guidance.

### Review Gate

PRs that reference `lian-platform-server` as an authority for new work must be
redirected. Permitted references must use retirement or legacy context framing.

### Worker Task Contract

Worker tasks must not specify `lian-platform-server` files in `allowedFiles`
unless the task explicitly involves migration audit or retirement tracking.

---

## Cross-Reference

| Document | Relationship |
|----------|--------------|
| [orchestration-ownership.md](../ai-native/orchestration-ownership.md) | Orchestration ownership declaration |
| [lian-platform-server-orchestration-retirement.md](../migration/lian-platform-server-orchestration-retirement.md) | Legacy orchestration retirement path |
| [docs-authority-map.md](../ai-native/docs-authority-map.md) | Documentation folder authority rules |
| [legacy-freeze-rules.md](../migration/legacy-freeze-rules.md) | General legacy freeze policy |
| [legacy-shutdown-matrix.md](../migration/legacy-shutdown-matrix.md) | Endpoint-level shutdown tracking |

---

## Decision Log

| Date | Decision | Issue |
|------|----------|-------|
| 2026-05-11 | `lian-nest-server` declared sole backend source of truth | #298 |
