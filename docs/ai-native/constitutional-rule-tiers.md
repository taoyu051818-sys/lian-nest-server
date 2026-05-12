# Constitutional Rule Tiers

Defines the tiered classification of constitutional rules for the
AI-native control plane. Tiers govern how rules are audited, enforced,
amended, and — when safe — relaxed under bounded conditions.

> **Closes:** [#1062](https://github.com/taoyu051818-sys/lian-nest-server/issues/1062)
>
> **Authority:** [seed-constitution.md](seed-constitution.md) is the
> single source of truth for control-plane invariants. This document
> classifies those invariants into tiers; it does not override them.

---

## Purpose

The Constitution Steward layer audits prompts, policies, schemas, docs,
and workflows. To do this effectively, it needs a structured way to
classify rules by their blast radius, amendment cost, and enforcement
mechanism. This document defines that classification.

The tier system answers three questions for every constitutional rule:

1. **What breaks if this rule is violated?** (blast radius)
2. **Who can change this rule?** (amendment authority)
3. **Is there a safe escape hatch?** (rollback path)

---

## Three Laws

Every tier and every rule within a tier must satisfy these three laws.
They are the meta-governance principles that the Constitution Steward
uses to audit the control plane itself.

### 1. Reality Before Judgment

No rule may be enforced on a claim that has not been verified against
observable state. A worker's `allowedFiles`, the main branch health, and
the task JSON are observable. Rumors, assumptions, and stale cache
entries are not.

**Implication for tiers:** Enforcement actions (blocking merges,
killing workers, triggering recovery) must be grounded in current,
verifiable signals — not in historical state or inferred intent.

### 2. Selection Before Memory

When multiple rules could apply to a situation, the most specific
applicable rule takes precedence. General policies yield to
task-specific contracts. The seed constitution yields to nothing.

**Implication for tiers:** Tier classification follows specificity.
A task-level `allowedFiles` boundary is more specific than a global
`forbiddenFiles` glob. The tier system encodes this hierarchy.

### 3. Governed Recursion

No automation may widen its own authority. A worker cannot edit its task
JSON. An orchestrator cannot relax the launch gate. The Constitution
Steward can propose amendments but cannot self-approve them.

**Implication for tiers:** Every tier must define a clear amendment
authority that is external to the automation proposing the change.

---

## Tier Definitions

### Tier 0 — Seed (Immutable)

Rules that define the control plane's existence. Violating any Tier 0
rule breaks the entire governance model.

| Property | Value |
|----------|-------|
| Blast radius | Total — control plane becomes untrustworthy |
| Amendment authority | Human-authored PR + architecture-review + repo owner |
| Enforcement | Dual-file sync check (constitution guard) |
| Escape hatch | None. No flag, env var, or parameter bypasses Tier 0. |

**Examples:**

- Seed constitution must exist at both authoritative and mirror paths.
- Seed constitution must contain all 5 required sections.
- No automation may self-expand scope.
- No automation may amend the seed constitution.

**Why no escape hatch:** Tier 0 rules are the foundation. If they can
be relaxed, the entire tier system collapses. Recovery requires a human
PR — this is intentional.

---

### Tier 1 — High-Risk Human-Required

Rules that protect irreversible or high-blast-radius operations. These
are the boundaries from the seed constitution's Section 1.

| Property | Value |
|----------|-------|
| Blast radius | High — data loss, supply chain compromise, history rewrite |
| Amendment authority | Human-authored PR + designated reviewer role |
| Enforcement | Boundary guard + worker honor system (pre-merge) |
| Escape hatch | Human override via explicit issue/PR approval |

**Examples:**

- Secrets, tokens, credentials — never automated.
- `.env` and CI/CD pipeline files — production blast radius.
- Prisma schema changes — data integrity.
- `package.json` dependencies — supply chain risk.
- Force-push to protected branches — history loss.

**Why human override is the escape hatch:** These operations are not
inherently wrong — they are dangerous when automated. A human can
approve a Prisma migration or a dependency update; the rule prevents
*unsupervised* execution.

---

### Tier 2 — Scoped Contractual

Rules defined per-task in the worker task contract. These are the
boundaries a specific worker must respect for a specific task.

| Property | Value |
|----------|-------|
| Blast radius | Moderate — one task's scope, one PR's diff |
| Amendment authority | Orchestrator (re-launch with new contract) or human |
| Enforcement | Boundary guard (pre-merge), task JSON immutability (runtime) |
| Escape hatch | Worker reports blocker; human or orchestrator re-scopes |

**Examples:**

- `allowedFiles` glob boundaries.
- `forbiddenFiles` exclusions.
- `conflictGroup` assignments.
- `sharedLocks` declarations.
- `mainHealthPolicy` gate level.
- `generatedCodePolicy` for Prisma artifacts.

**Why re-launch is the escape hatch:** A worker cannot widen its own
scope (Governed Recursion). But the orchestrator can terminate the
worker and dispatch a new one with a broader contract — provided the
new contract still respects Tier 0 and Tier 1 rules.

---

### Tier 3 — Operational Policy

Rules that govern day-to-day behavior but can be adjusted without
constitutional amendment. These are the "soft" rules — guidelines,
defaults, and recommendations.

| Property | Value |
|----------|-------|
| Blast radius | Low — behavioral, not structural |
| Amendment authority | Docs PR reviewed by process-owner role |
| Enforcement | Honor system, lint checks, CI warnings |
| Escape hatch | Configurable via task JSON fields or environment |

**Examples:**

- Max task safety limit (default 10, adjustable via `-MaxTasks`).
- Health gate mode selection (quick vs. full).
- Soft and hard timeout budgets.
- Straggler policy actions.
- Autopilot plan mode behavior.

**Why configurable is the escape hatch:** Tier 3 rules are defaults,
not invariants. They can be overridden per-task or per-run because
violating them does not break the governance model — it changes
operational behavior within a bounded context.

---

## Tier Hierarchy

```
┌─────────────────────────────────────────────────────┐
│                  Tier 0 — Seed                       │
│         (Immutable, no escape hatch)                 │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │            Tier 1 — High-Risk                  │  │
│  │       (Human override required)                │  │
│  │                                                │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │         Tier 2 — Contractual             │  │  │
│  │  │    (Re-launch with new contract)         │  │  │
│  │  │                                          │  │  │
│  │  │  ┌────────────────────────────────────┐  │  │  │
│  │  │  │      Tier 3 — Operational          │  │  │  │
│  │  │  │   (Configurable per-task/run)      │  │  │  │
│  │  │  └────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Selection law in action:** Inner tiers may not contradict outer
tiers. A Tier 2 contract cannot permit what Tier 1 forbids. A Tier 3
default cannot override a Tier 0 invariant.

---

## Inputs

The Constitution Steward reads these sources when classifying a rule:

| Input | Source | Purpose |
|-------|--------|---------|
| Seed constitution | `.github/ai-policy/seed-constitution.md` | Tier 0 and Tier 1 rules |
| Worker task contract | Task JSON at launch time | Tier 2 boundaries |
| Policy docs | `docs/ai-native/*.md` | Tier 3 operational guidance |
| Launch gate result | `check-launch-gate.ps1` output | Enforcement signal |
| Boundary guard result | `check-task-boundary.js` output | Enforcement signal |
| Main health state | `.github/ai-state/main-health.json` | Context for rule applicability |

---

## Outputs

When the Constitution Steward audits the control plane, it produces:

| Output | Format | Consumer |
|--------|--------|----------|
| Tier classification | Structured list per rule | Human reviewer, orchestrator |
| Violation report | Pass/fail per tier per rule | Gate stack, PR review |
| Amendment proposal | Diff + rationale | Human reviewer (never auto-merged) |
| Escape hatch status | Available/used/unavailable per rule | Incident response |

---

## Non-Goals

This document does **not**:

- Replace or override the seed constitution.
- Define new constitutional rules (it classifies existing ones).
- Provide a mechanism for automation to self-approve amendments.
- Relax any Tier 0 or Tier 1 boundary.
- Govern runtime code, database schema, or infrastructure changes.

---

## Gates

The tier system is validated at these points:

| Gate | What It Checks | Blocks On |
|------|---------------|-----------|
| Constitution guard | Tier 0 integrity (both files exist, sections present, in sync) | Any Tier 0 violation |
| Boundary guard | Tier 1 and Tier 2 compliance (files within allowedFiles, not in forbiddenFiles) | Any Tier 1 violation; Tier 2 violation |
| Launch gate | Tier 2 health policy match (main health permits worker type) | Health red + non-recovery worker |
| PR review | All tiers (human reviewer verifies context) | Reviewer judgment |

---

## Rollback and Escape Hatches

| Tier | Escape Hatch | When to Use |
|------|-------------|-------------|
| 0 | None | N/A — requires human PR to fix |
| 1 | Human approval in issue/PR | Legitimate high-risk operation that needs automation assistance |
| 2 | Worker blocker comment + orchestrator re-launch | Task scope too narrow or too broad |
| 3 | Configurable override (flag, env, task field) | Operational tuning within bounded context |

**Governed Recursion in action:** A worker that hits a Tier 1 boundary
does not try to work around it. It stops, documents the blocker, and
waits for human intervention. A worker that hits a Tier 2 boundary
comments the blocker; the orchestrator or human decides whether to
re-launch with a different contract.

---

## References

- [seed-constitution.md](seed-constitution.md) — Authoritative rules (docs mirror).
- [seed-constitution.md (authoritative)](../../.github/ai-policy/seed-constitution.md) — Single source of truth.
- [constitution-guard.md](constitution-guard.md) — Tier 0 validation.
- [worker-task-contract.md](worker-task-contract.md) — Tier 2 contract schema.
- [main-health-policy.md](main-health-policy.md) — Health states and launch permissions.
- [launch-gate.md](launch-gate.md) — Pre-launch validation.
- [controlled-auto-merge.md](controlled-auto-merge.md) — Merge eligibility and guard integration.
