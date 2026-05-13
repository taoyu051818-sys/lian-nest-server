# Scope Bounding Strength

Documents a unique safety strength of the LIAN control plane: the
bounded task contract as the enforced unit of work. This is a core
differentiator from free-form agent frameworks and must be preserved
in any tool registry or graph orchestration extension.

> **Closes:** [#1505](https://github.com/taoyu051818-sys/lian-nest-server/issues/1505)
>
> **Evidence source:** `file://gap-analysis/unique-strengths`
>
> **See also:**
> [worker-task-contract.md](worker-task-contract.md) for the task JSON
> schema, [seed-constitution.md](seed-constitution.md) for immutable
> scope boundaries, [bounded-experiment-policy.md](bounded-experiment-policy.md)
> for experiment scoping rules.

---

## Claim

LIAN task contracts provide more rigorous scope-bounding than
free-form agent tool use (e.g., SWE-agent) or role-goal-backstory
orchestration (e.g., CrewAI). This is a core safety mechanism.

## Evidence

### What LIAN does

Every worker task is defined by a JSON contract that declares:

- **`allowedFiles`** — glob patterns defining the exact file edit boundary
- **`forbiddenFiles`** — glob patterns for paths the worker must never touch
- **`validationCommands`** — commands the worker must run before opening a PR
- **`budgets`** — max files, max lines changed, soft/hard time limits
- **`conflictGroup`** / **`sharedLocks`** — concurrency boundaries

The contract is embedded in the worker prompt as a **control appendix**.
The worker cannot modify its own contract. The boundary guard enforces
`allowedFiles` at runtime. The seed constitution
([seed-constitution.md](seed-constitution.md) §2, §5) makes scope
expansion immutable.

### What free-form agents lack

| Mechanism | SWE-agent | CrewAI | LIAN |
|-----------|-----------|--------|------|
| File edit boundary | None — agent decides | Goal-scoped but not enforced | `allowedFiles` enforced by boundary guard |
| Forbidden paths | None | None | `forbiddenFiles` enforced |
| Validation gate | Agent decides | None | `validationCommands` required |
| Scope expansion | Agent can edit anything | Agent can drift from goal | Immutable after launch (constitution §5) |
| Concurrency control | None | None | `conflictGroup` + `sharedLocks` |

### Why it matters

The bounded task contract is the **trust boundary** between the
orchestrator and the worker. Without it:

1. A worker can silently expand scope to unrelated files
2. Multiple workers can collide on the same file without detection
3. Validation becomes optional — the agent decides what to check
4. Rollback scope is unbounded — a failed agent may have touched anything

With the contract, every change is traceable to a declared boundary,
every validation is mandatory, and every collision is detected before
dispatch.

---

## Preservation Rules

Any extension to the control plane (tool registry, graph orchestration,
new worker type) MUST preserve these invariants:

### 1. The contract is the unit of work

Every task MUST be defined by a JSON contract with `allowedFiles`,
`forbiddenFiles`, and `validationCommands`. No task may execute
without these fields. The compiler rejects tasks missing any of them.

**Enforced by:** `compile-issue-to-task-json.ps1`, task schema
validation.

### 2. Tools are scoped to allowedFiles

Worker tools (Edit, Write) MUST be constrained to the contract's
`allowedFiles`. Tools that operate on files outside the boundary MUST
NOT be available to the worker.

**Enforced by:** `run-claude-print.ps1` tool boundary configuration,
boundary guard at merge time.

### 3. Graph branches must not expand scope

When tasks are composed into a DAG or graph (e.g., fact-to-task
chains, parallel batches), each branch inherits the parent task's
scope. A branch MUST NOT declare broader `allowedFiles` than its
parent contract. Dependencies outside `allowedFiles` are blockers,
not scope extensions.

**Enforced by:** Seed constitution §5 ("No transitive expansion"),
launch gate conflict-group validation.

### 4. The contract is immutable after launch

Once a worker is launched, its `allowedFiles`, `forbiddenFiles`,
`conflictGroup`, and `sharedLocks` are frozen. The worker MUST NOT
modify its own task JSON. Self-expansion is a constitution violation.

**Enforced by:** Seed constitution §5, worker honor system, boundary
guard at merge time.

### 5. New worker types inherit the contract

Any new worker role, agent type, or orchestration node MUST be
governed by a task contract. Free-form agents that bypass the contract
are not permitted in the control plane.

**Enforced by:** Launch gate schema validation, seed constitution §2.

---

## Comparison Matrix

| Dimension | Free-form agent | LIAN bounded contract |
|-----------|----------------|----------------------|
| Scope definition | Implicit (agent decides) | Explicit (`allowedFiles` glob) |
| Scope enforcement | None | Boundary guard + constitution |
| Validation | Optional | Mandatory (`validationCommands`) |
| Concurrency safety | None | `conflictGroup` + `sharedLocks` |
| Scope expansion | Unbounded | Immutable after launch |
| Rollback scope | Unknown | Declared boundary limits blast radius |
| Auditability | Agent trace only | Contract + diff + validation evidence |

---

## Risk: Scope Creep Through Tool Registry

If a tool registry is added to the control plane, each tool MUST
declare which `allowedFiles` patterns it accesses. Tools that operate
on arbitrary files bypass the contract boundary. The registry MUST
enforce that a worker can only invoke tools whose file access is a
subset of the worker's `allowedFiles`.

---

## References

- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Seed Constitution](seed-constitution.md) — Immutable scope rules
- [Bounded Experiment Policy](bounded-experiment-policy.md) —
  Experiment scoping
- [Orchestration](orchestration.md) — Worker lifecycle
- [Parallel Work Policy](parallel-work-policy.md) — Conflict groups
- [Worker Behavior Policy](worker-behavior-policy.md) — Worker
  honor system
