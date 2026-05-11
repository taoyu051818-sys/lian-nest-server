# Docs Authority Map

Defines which documentation folder is the source of truth for each domain,
how migration docs expire, and how workers select context without reading
stale or superseded documents.

> **Reference:** [SOP.md](SOP.md) for lifecycle flow,
> [parallel-work-policy.md](parallel-work-policy.md) for conflict groups,
> [worker-task-contract.md](worker-task-contract.md) for task JSON schema.

---

## Folder Authority

| Folder | Owns | Authority Level | Mutability |
|--------|------|-----------------|------------|
| `docs/architecture/` | Design decisions, module contracts, data strategy, integration boundaries | **Canonical** — superseding changes land here first | Stable; changes require architect review |
| `docs/contracts/` | API endpoint shapes, route inventory, parity fixtures, response schemas | **Canonical** for endpoint behavior | Updated when endpoints change; fixtures are append-only |
| `docs/migration/` | Migration plans, shutdown matrix, acceptance criteria, rollout trackers | **Operational** — governs active migration work | Volatile; expires as endpoints reach `LEGACY_DISABLED` |
| `docs/ai-native/` | Process docs: SOP, roles, policies, worker contracts, this map | **Governance** — defines how work happens | Stable; changes require repo-owner approval |

### Rule: Architecture Wins on Conflict

If `docs/architecture/` and `docs/migration/` cover the same topic with
contradictory guidance, the architecture version is canonical. Migration docs
layer operational context *on top of* the architecture decision; they do not
override it.

---

## Duplicate Topic Resolution

Four topics exist in both `docs/architecture/` and `docs/migration/` with
different content. Workers MUST read the correct version for their task type.

| Topic | Architecture Version (canonical) | Migration Version (operational) | When to Read Which |
|-------|----------------------------------|---------------------------------|---------------------|
| AppModule composition | `architecture/app-module-composition-plan.md` | `migration/app-module-composition-plan.md` | Architecture: design reference. Migration: slice implementation guide. |
| Auth slice 2 (guards) | `architecture/auth-slice-2-guards-plan.md` | `migration/auth-slice-2-guards-plan.md` | Architecture: guard design rationale. Migration: step-by-step migration steps. |
| First AppModule slice | `architecture/first-appmodule-composition-slice.md` | `migration/first-appmodule-composition-slice.md` | Architecture: composition pattern. Migration: concrete implementation order. |
| Prisma client lifecycle | `architecture/prisma-client-lifecycle.md` | `migration/prisma-client-lifecycle.md` | Architecture: lifecycle design. Migration: migration-specific notes and caveats. |

**Decision rule:** If your task is a code implementation task (`backend-programmer`
role), read the *migration* version for step-by-step guidance. If your task is
a design review or architecture task (`architect` role), read the *architecture*
version for rationale and constraints.

---

## Migration Doc Lifecycle

Migration docs are operational and become stale as endpoints progress through
the shutdown pipeline defined in
[legacy-shutdown-matrix.md](../migration/legacy-shutdown-matrix.md).

### Lifecycle States

```
ACTIVE  →  SUPERSEDED  →  ARCHIVED
```

| State | Meaning | Worker Action |
|-------|---------|---------------|
| **ACTIVE** | Endpoint is `NOT_STARTED` through `PARITY_TESTED`. Doc is the current plan. | Read and follow. |
| **SUPERSEDED** | Endpoint reached `LEGACY_DISABLED`. Doc served its purpose but may contain historical context. | Do NOT use for new work. Reference only for migration-auditor tasks. |
| **ARCHIVED** | All endpoints in the doc's scope are `LEGACY_DISABLED`. Doc is historical. | Ignore. Flag if encountered in worker context. |

### Expiry Triggers

A migration doc becomes SUPERSEDED when:

1. The endpoint it covers reaches `LEGACY_DISABLED` in the shutdown matrix.
2. A newer version of the plan exists in `docs/architecture/` that supersedes the migration-specific guidance.
3. The doc's own "Status" or "Superseded-by" field points to another document.

Workers MUST check the shutdown matrix before relying on a migration doc for
active implementation work.

---

## Worker Context Selection

Workers receive a task JSON that specifies `allowedFiles`. The worker also
needs domain context from docs. Use this decision tree:

### Step 1: Identify Task Domain

| Task Label / Role | Primary Folder | Secondary Folder |
|-------------------|----------------|------------------|
| Code implementation (`backend-programmer`) | `docs/migration/` | `docs/architecture/` |
| Contract validation (`qa-contract-reviewer`) | `docs/contracts/` | `docs/migration/` |
| Design review (`architect`) | `docs/architecture/` | `docs/contracts/` |
| Process / governance | `docs/ai-native/` | — |
| Migration audit (`migration-auditor`) | `docs/migration/` | `docs/architecture/` |

### Step 2: Check for Duplicates

If a doc filename appears in both `architecture/` and `migration/`, consult the
Duplicate Topic Resolution table above.

### Step 3: Verify Currency

Before reading a migration doc:

1. Check [legacy-shutdown-matrix.md](../migration/legacy-shutdown-matrix.md) for
   the endpoint status.
2. If status is `LEGACY_DISABLED`, skip the doc — it is superseded.
3. If status is `PARITY_TESTED`, read with caution — the doc may be near expiry.

### Step 4: Prefer Contracts Over Plans

When both a contract doc (`docs/contracts/`) and a plan doc
(`docs/migration/` or `docs/architecture/`) cover the same endpoint, the
**contract is the behavioral source of truth**. Plans describe *how* to build;
contracts define *what* the endpoint must do.

---

## Stale Doc Detection

A doc is considered stale if any of the following are true:

| Signal | How to Detect |
|--------|---------------|
| Endpoint superseded | Shutdown matrix shows `LEGACY_DISABLED` for all covered endpoints |
| Duplicate exists with newer date | Compare `git log` timestamps between `architecture/` and `migration/` versions |
| Referenced file deleted | Doc links to a source file that no longer exists in `src/` |
| Plan completed | Migration tracker shows all items as done |

Workers encountering a stale doc MUST:

1. **Not follow it** — stale docs may contain incorrect guidance.
2. **Comment on the issue** — flag the stale doc with the detection signal.
3. **Continue with the canonical source** — fall back to `architecture/` or `contracts/`.

---

## Legacy Source-of-Truth Drift Guard

The `check-docs-authority` guard detects documentation that incorrectly treats
`lian-platform-server` as the source of truth for new work. This prevents
accidental back-references to the frozen legacy repository.

### What Counts as Drift

| Pattern | Example | Verdict |
|---------|---------|---------|
| Authority verb + backtick ref | `` `lian-platform-server` has the auth logic `` | **Drift** — error |
| "See/refer to/in" + ref | `See lian-platform-server for the module` | **Drift** — error |
| "source of truth" mention | `lian-platform-server is the source of truth` | **Drift** — error |
| Retirement/freeze context | `lian-platform-server is frozen and retired` | **Safe** — ignored |
| Migration context | `We are moving away from lian-platform-server` | **Safe** — ignored |
| Legacy/deprecated context | `The legacy lian-platform-server code` | **Safe** — ignored |

### Exempt Files

These files legitimately discuss `lian-platform-server` and are excluded from
drift checks:

- `docs/migration/lian-platform-server-orchestration-retirement.md`
- `docs/ai-native/orchestration-ownership.md`

### Worker Guidance

If the guard flags a file you are editing:

1. **Redirect the reference** — point to `lian-nest-server` instead.
2. **Use retirement context** — if referencing legacy behavior, frame it as
   frozen/retired/legacy, not as authority.
3. **Link to the retirement doc** — use
   [lian-platform-server-orchestration-retirement.md](../migration/lian-platform-server-orchestration-retirement.md)
   for cross-references.

---

## Adding New Docs

When creating a new doc, follow these placement rules:

| Content Type | Correct Folder | NOT |
|--------------|----------------|-----|
| Module design decision | `architecture/` | `migration/` |
| API endpoint shape | `contracts/` | `architecture/` |
| Migration plan for specific slice | `migration/` | `architecture/` |
| Process or policy change | `ai-native/` | `migration/` |
| Runbook or operational checklist | `ai-native/` | `contracts/` |

If unsure, ask the architect role before creating the file. Duplicate docs
across folders create ambiguity — prefer updating the existing canonical doc
over creating a new one in a different folder.
