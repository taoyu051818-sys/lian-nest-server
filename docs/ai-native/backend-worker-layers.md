# Backend Worker Layer Model

Defines the canonical layering, launch order, and parallelism policy for
backend workers in `lian-nest-server`. This document turns the discussion
from [#96](https://github.com/taoyu051818-sys/lian-mobile-web/issues/96)
into actionable governance.

> **Reference:** [SOP.md](SOP.md) for lifecycle flow,
> [worker-task-contract.md](worker-task-contract.md) for the task JSON schema,
> [parallel-work-policy.md](parallel-work-policy.md) for conflict group rules.

---

## Worker Layers

Every backend worker task belongs to exactly one layer. Layers are ordered by
dependency: a layer's workers may only launch after all blocking layers are
stable (merged or confirmed green).

| # | Layer | Purpose | Examples |
|---|-------|---------|----------|
| 1 | **Contract / Planning** | Define interfaces, schemas, migration plans, worker architecture docs. No runtime code. | Endpoint contracts, DB schema plans, this doc |
| 2 | **Runtime Foundation** | Unblock minimal runtime: Prisma client, DatabaseModule, RedisModule, core DI. | Prisma generated client fix, PrismaService bootstrap |
| 3 | **Health / Diagnostic** | Make failures classifiable and recoverable: health gates, failure classifiers, CI diagnostics. | Post-merge health gate, Prisma failure classifier |
| 4 | **Feature / Repository** | Business module work: endpoints, services, repositories, adapters. | Posts CRUD, feed endpoint, NodeBB adapter |
| 5 | **Review / Audit** | Cross-cutting review, parity checks, security audit, migration audit. | Legacy parity audit, OWASP review |
| 6 | **Merge / Release** | Merge queue management, release prep, final integration validation. | Merge queue assistant, release branch cut |

---

## Launch Order

```
1. Contract / Planning
       |
       v
2. Runtime Foundation
       |
       v
3. Health / Diagnostic
       |
       v
4. Feature / Repository  --+--> 5. Review / Audit
                            |
                            +--> 6. Merge / Release
```

### Rules

1. **Layer 1 before all others.** Contract/planning workers define boundaries
   that all subsequent layers depend on. Skipping this layer risks rework.

2. **Layer 2 before Layer 3.** Health gates need a running runtime to test
   against. If the runtime is broken, diagnostic checks cannot validate
   anything meaningful.

3. **Layer 3 before Layer 4.** Feature workers should operate on a system
   where failures are classifiable. Without health gates, a feature worker
   cannot distinguish its own bugs from infrastructure failures.

4. **Layer 4 after Layers 1-3 are stable.** Feature work proceeds only when
   the foundation is green and failures are diagnosable.

5. **Layer 5 can run in parallel with Layer 4.** Review/audit workers examine
   existing code and do not modify runtime behavior. They may run alongside
   feature workers, provided no file overlap exists.

6. **Layer 6 runs after Layer 4.** Merge/release work depends on feature
   completion.

---

## Parallelism Policy

### Within a Layer

Workers in the same layer MAY run in parallel if:

- Their `allowedFiles` do not intersect (check `conflictGroup`).
- They are based on the same `main` commit.
- Neither depends on the other's output.

**Exception:** Layer 2 (Runtime Foundation) workers are typically serial.
Foundation changes are tightly coupled and rarely decompose into independent
file sets.

### Across Layers

| Combination | Parallel? | Condition |
|-------------|-----------|-----------|
| Layer 1 + Layer 1 | Yes | No file overlap |
| Layer 2 + Layer 2 | No | Foundation changes are coupled |
| Layer 3 + Layer 3 | Yes | No file overlap |
| Layer 4 + Layer 4 | Yes | No file overlap, different conflict groups |
| Layer 4 + Layer 5 | Yes | No file overlap |
| Layer 1 + Layer 2 | No | Layer 2 depends on Layer 1 |
| Layer 2 + Layer 3 | No | Layer 3 depends on Layer 2 |
| Layer 3 + Layer 4 | No | Layer 4 depends on Layer 3 |

---

## When Main Is Red

When `main` is failing (CI red, health gate red), only certain worker layers
are permitted to launch:

| Main Status | Allowed Layers | Rationale |
|-------------|---------------|-----------|
| Green | All (1-6) | Normal operation |
| Red (runtime) | Layer 1, Layer 2 | Fix the foundation first |
| Red (health gate) | Layer 1, Layer 2, Layer 3 | Diagnose and classify before feature work |
| Red (feature test) | Layer 1, Layer 2, Layer 3, Layer 5 | Audit the failure; feature workers blocked |

**Hard rule:** When main is red, Layer 4 (Feature / Repository) workers MUST
NOT launch. Feature work on a broken foundation wastes review cycles and
obscures root causes.

---

## Worker Task JSON: Layer Field

Every backend worker task contract SHOULD include a `layer` field to make
the layer explicit:

```json
{
  "taskType": "execution",
  "layer": "health-diagnostic",
  "conflictGroup": "health-gate",
  "risk": "low",
  "allowedFiles": ["docs/ai-native/**"],
  "forbiddenFiles": ["src/**", "prisma/**", "scripts/**"]
}
```

Valid `layer` values:

- `contract-planning`
- `runtime-foundation`
- `health-diagnostic`
- `feature-repository`
- `review-audit`
- `merge-release`

---

## Blocked-By Relationships

| Worker Layer | Blocked By | Reason |
|-------------|------------|--------|
| Contract / Planning | Nothing | First layer |
| Runtime Foundation | Contract / Planning | Needs defined interfaces |
| Health / Diagnostic | Runtime Foundation | Needs running runtime to test |
| Feature / Repository | Runtime Foundation, Health / Diagnostic | Needs green foundation + diagnosable failures |
| Review / Audit | Nothing (parallel with Layer 4) | Read-only, no runtime dependency |
| Merge / Release | Feature / Repository | Needs completed features |

---

## Orchestrator Checklist

Before launching a backend worker, the orchestrator MUST verify:

1. **Layer is assigned** — The task JSON includes a valid `layer` value.
2. **Blocking layers are green** — All layers listed in Blocked-By are merged
   or confirmed passing.
3. **Main status allows the layer** — Check the "When Main Is Red" table.
4. **Conflict group is clear** — No other worker in the same conflict group
   is in-flight.
5. **File boundaries are validated** — `allowedFiles` do not intersect with
   any in-flight worker's `allowedFiles`.

---

## Related

- [#96 — Discussion: LIAN backend worker layer model](https://github.com/taoyu051818-sys/lian-mobile-web/issues/96)
- [parallel-work-policy.md](parallel-work-policy.md) — Conflict group rules
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema
- [worker-acceptance-checklist.md](worker-acceptance-checklist.md) — PR acceptance criteria
