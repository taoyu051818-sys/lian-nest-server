# Governed Recursion Strength

Consolidates the governed-recursion principle — the invariant that no
automation may widen its own authority — into a single authoritative
reference. This principle is Law 3 of the Three Laws and a Tier 0 seed
rule. External research confirms it is unique across all surveyed
AI-agent frameworks.

> **Closes:** [#1451](https://github.com/taoyu051818-sys/lian-nest-server/issues/1451)
>
> **Authority:** [seed-constitution.md](seed-constitution.md) Section 5
> ("No Worker Scope Expansion") is the immutable source of truth. This
> document consolidates and references — it does not override.
>
> **Cross-references:**
> [constitution-checker-contract.md](constitution-checker-contract.md)
> for Law 3 in the checker contract,
> [constitutional-rule-tiers.md](constitutional-rule-tiers.md) for tier
> classification,
> [constitutional-rule-human-gate.md](constitutional-rule-human-gate.md)
> for the human gate,
> [constitution-steward-layer.md](constitution-steward-layer.md) for the
> steward architecture,
> [constitutional-drift-taxonomy.md](constitutional-drift-taxonomy.md)
> for recursion overreach detection,
> [meta-governance-review-gate.md](meta-governance-review-gate.md) for
> the meta-governance audit,
> [worker-permissions.md](worker-permissions.md) for file-class
> boundaries.

---

## Why This Matters

Governed recursion means that every agent, worker, script, and
orchestrator in the LIAN control plane is structurally prevented from
expanding its own authority. This is not a soft guideline — it is
enforced at the policy layer, the boundary guard, the constitution
checker, and the human gate.

No other surveyed framework (SWE-agent, LangGraph, MemGPT, AutoGPT,
CrewAI) enforces a comparable invariant. In those systems:

- Agents can modify their own tool configurations.
- Orchestrators can widen the scope of downstream agents.
- Memory systems can store and replay credentials or policy overrides.
- Graph nodes can dynamically add edges that bypass safety checks.

LIAN's governed-recursion constraint prevents all of these by design.

---

## Formal Statement

**Law 3 — Governed Recursion:** No automation may widen its own
authority. Sub-checks must be bounded, declared, and independently
auditable. The checker must not spawn unbounded recursive validation.

This manifests as four hard constraints on every agent in the system:

| Constraint | Policy Field | Required Value | What It Prevents |
|------------|-------------|----------------|------------------|
| No self-approval of constitutional changes | `maySelfApproveConstitutional` | `false` | Agent cannot merge changes to `.github/ai-policy/` or seed constitution |
| No self-approval of high-risk changes | `maySelfApproveHighRisk` | `false` | Agent cannot merge changes to secrets, CI, Prisma, package.json |
| No modification of own file boundaries | `mayModifyOwnAllowedFiles` | `false` | Agent cannot edit its task JSON `allowedFiles` or `forbiddenFiles` |
| No scope expansion | `mayExpandOwnScope` | `false` | Agent cannot add files to its own allowed set or remove forbidden entries |

These four constraints are defined in
`.github/ai-policy/constitution-steward-policy.json` under
`agentConstraints` and verified at runtime by
`scripts/ai/check-constitution-health.js`.

---

## Enforcement Layers

Governed recursion is enforced at every layer of the control plane.
No single enforcement point is sufficient — the strength comes from
defense in depth.

### 1. Policy Layer

`constitution-steward-policy.json` declares `agentConstraints` with all
four fields set to `false`. The constitution health checker
(`check-constitution-health.js`) reads this file and fails with a
`violation` if any field is not `false`.

```
check-constitution-health.js
        │
        ├── reads constitution-steward-policy.json
        ├── reads amendment-policy.json
        │
        ├── maySelfApproveConstitutional === false?  → pass/violation
        ├── maySelfApproveHighRisk === false?        → pass/violation
        ├── mayModifyOwnAllowedFiles === false?      → pass/violation
        └── mayExpandOwnScope === false?             → pass/violation
```

### 2. Boundary Guard Layer

`scripts/guards/check-task-boundary.js` validates that every file in a
worker's diff falls within the declared `allowedFiles` and is not in
`forbiddenFiles`. A worker cannot edit files outside its boundary,
regardless of what it claims in its task JSON.

### 3. Task JSON Immutability

The worker task contract (`worker-task-contract.md`) defines
`allowedFiles` and `forbiddenFiles` at launch time. These fields are
immutable after launch — the worker cannot modify its own task JSON.
If a worker needs broader scope, the orchestrator must terminate it
and dispatch a new worker with a corrected contract.

### 4. Human Gate Layer

`constitutional-rule-human-gate.md` defines five gate boundaries where
automation must stop for human approval:

| Gate Code | Boundary | Override |
|-----------|----------|----------|
| `CONSTITUTION_AMENDMENT` | Seed constitution changes | None |
| `POLICY_CHANGE` | `.github/ai-policy/` changes | Repo-owner comment |
| `GUARD_SCRIPT_CHANGE` | `scripts/guards/` changes | Repo-owner comment + test evidence |
| `CONTRACT_SCHEMA_CHANGE` | Task contract schema changes | Repo-owner comment + migration plan |
| `SELF_MODIFICATION` | Steward modifies its own rules | None |

The `SELF_MODIFICATION` gate has no override — the Steward cannot
self-approve changes to its own audit rules, gate definitions, or
evaluation criteria.

### 5. Tier Classification

Governed recursion is a Tier 0 (Seed) rule:

| Property | Value |
|----------|-------|
| Tier | 0 — Seed (Immutable) |
| Blast radius | Total — control plane becomes untrustworthy |
| Amendment authority | Human-authored PR + architecture-review + repo owner |
| Enforcement | Dual-file sync check (constitution guard) + runtime health checker |
| Escape hatch | None |

Tier 0 has no escape hatch by design. If governed recursion can be
relaxed, the entire tier system collapses.

---

## Detection of Violations

### Runtime Detection

`check-constitution-health.js` runs `checkGovernedRecursion()` which
verifies:

1. `amendment-policy.json` has no amendment class with
   `maySelfApprove: true`
2. `constitution-steward-policy.json` has all four agent constraint
   fields set to `false`
3. Protected policy files (`seed-constitution.md`,
   `constitution-steward-policy.json`, `amendment-policy.json`) exist
   and are unmodified

### Drift Detection

`constitutional-drift-taxonomy.md` classifies "Recursion Overreach" as
the most dangerous drift type (severity: Critical):

| Signal | Detector |
|--------|----------|
| Worker diff touches files outside `allowedFiles` | Boundary guard |
| Task JSON or `conflictGroup` changes in worker commit | Task JSON immutability check |
| Worker creates new tasks or modifies orchestrator state | Orchestrator log audit |
| Scripts modify `.github/ai-policy/` without human task | Constitution guard |

---

## Comparison with Other Frameworks

| Capability | LIAN | SWE-agent | LangGraph | MemGPT |
|------------|------|-----------|-----------|--------|
| Agent cannot self-approve policy changes | Yes (enforced) | No | No | No |
| Agent cannot modify own file boundaries | Yes (enforced) | No | No | No |
| Agent cannot expand own scope | Yes (enforced) | No | N/A | No |
| Memory cannot store credentials | Yes (policy) | No guard | No guard | No guard |
| Graph nodes cannot bypass safety checks | Yes (boundary guard) | N/A | No | N/A |
| Human gate with no escape hatch | Yes (Tier 0) | No | No | No |

This is not a difference in degree — it is a structural difference in
architecture. Other frameworks treat safety as a post-hoc filter. LIAN
treats it as a constitutional invariant enforced at every layer.

---

## Adoption Guidance

When adopting patterns from other frameworks, the governed-recursion
constraints must be preserved at every layer:

### SWE-agent (Pluggable Tools)

Tool plugins must respect `forbiddenFiles`. A tool that reads or writes
files must validate paths against the worker's `allowedFiles` before
executing. Tool registration cannot widen the worker's effective scope.

### LangGraph (Graph Orchestration)

Graph nodes must check scope boundaries before executing. Adding a new
edge to the graph cannot bypass the boundary guard. Graph compilation
must not produce a path that reaches forbidden files.

### MemGPT (Memory)

Memory must not store credentials, tokens, or policy overrides. Memory
entries that reference file paths must be validated against the worker's
`allowedFiles`. Memory recall cannot grant access to files the worker
is forbidden from touching.

---

## References

- [Seed Constitution](seed-constitution.md) Section 5 — No Worker Scope
  Expansion (immutable source of truth)
- [Constitution Checker Contract](constitution-checker-contract.md) —
  Law 3 in the checker contract
- [Constitutional Rule Tiers](constitutional-rule-tiers.md) — Tier 0
  classification
- [Constitutional Rule Human Gate](constitutional-rule-human-gate.md) —
  `SELF_MODIFICATION` gate
- [Constitution Steward Layer](constitution-steward-layer.md) —
  Governed Recursion pillar
- [Constitutional Drift Taxonomy](constitutional-drift-taxonomy.md) —
  Recursion overreach detection
- [Meta-Governance Review Gate](meta-governance-review-gate.md) —
  Self-expansion guard
- [Worker Permissions](worker-permissions.md) — File-class boundaries
- [Knowledge-Driven Scaling Rule](knowledge-driven-scaling-rule.md) —
  Governed recursion in knowledge self-improvement
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- `scripts/ai/check-constitution-health.js` — Runtime enforcement
- `.github/ai-policy/constitution-steward-policy.json` — Policy
  declaration
