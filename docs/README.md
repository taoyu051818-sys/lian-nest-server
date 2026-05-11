# Documentation Index

Central index for all project documentation. Before writing or relying on a
doc, consult the [authority map](ai-native/docs-authority-map.md) to determine
which folder owns the topic and whether the doc is current.

---

## Authority and Governance

| Document | Purpose |
|----------|---------|
| [Docs Authority Map](ai-native/docs-authority-map.md) | Which folder owns which topic, duplicate resolution, migration doc expiry rules, worker context selection |
| [SOP](ai-native/SOP.md) | End-to-end development lifecycle |
| [Roles](ai-native/roles.md) | Role definitions and responsibilities |
| [Worker Task Contract](ai-native/worker-task-contract.md) | Task JSON schema |
| [Worker Acceptance Checklist](ai-native/worker-acceptance-checklist.md) | PR merge criteria |
| [Parallel Work Policy](ai-native/parallel-work-policy.md) | Conflict groups and concurrency rules |

---

## Folders

### `architecture/` — Design Decisions

Canonical source for module boundaries, data strategy, integration patterns,
and API contracts. Changes require architect review.

Key documents: database strategy, module contracts (auth, feed, messages,
posts, profile), NodeBB integration, Prisma lifecycle, repository boundaries.

### `contracts/` — API Endpoint Specifications

Source of truth for endpoint behavior: request/response shapes, route
inventory, parity fixtures. Updated when endpoints change.

Key documents: route inventory, per-module endpoint contracts, readonly route
parity fixtures.

### `migration/` — Active Migration Plans

Operational guidance for migrating legacy endpoints to Nest. Volatile — docs
expire as endpoints reach `LEGACY_DISABLED`. Check the
[shutdown matrix](migration/legacy-shutdown-matrix.md) before relying on a
migration doc.

Key documents: endpoint migration queue, shutdown matrix, acceptance criteria,
route parity tracker, legacy freeze rules.

### `ai-native/` — Process and Policy

Governance docs defining how AI workers operate. Stable; changes require
repo-owner approval.

Key documents: this index, authority map, SOP, roles, worker contracts,
parallel work policy, PR review gate.

---

## Quick Reference

| I need to... | Read this |
|--------------|-----------|
| Understand a module's design | `architecture/<module>-contract.md` |
| Know what an endpoint must return | `contracts/<module>.md` |
| Implement a migration slice | `migration/<slice>.md` (check shutdown matrix first) |
| Know what files I can edit | My task's `allowedFiles` + `ai-native/docs-authority-map.md` |
| Understand the review process | `ai-native/pr-review-gate.md` |
| Check if a migration doc is still valid | `migration/legacy-shutdown-matrix.md` |
| Resolve a duplicate doc topic | `ai-native/docs-authority-map.md` § Duplicate Topic Resolution |
