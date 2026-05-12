# Constitutional Drift Taxonomy

Classifies the ways the AI control plane can drift from the seed
constitution. Used by the Constitution Steward layer to audit prompts,
policies, schemas, docs, and workflows against the three laws: Reality,
Selection, and Governed Recursion.

> **Status:** Normative reference. Workers and reviewers use this
> taxonomy to identify, classify, and escalate drift.
>
> **Authority:** This document is advisory. It proposes classifications
> but cannot self-approve constitutional changes. Amendments to the seed
> constitution require a human-authored PR reviewed by the
> architecture-review role (see
> [seed-constitution.md](seed-constitution.md#amendment-process)).

---

## Purpose

Define a shared vocabulary for constitutional drift so that:

1. Audits produce consistent, comparable findings.
2. Severity maps to a clear response (auto-fix, propose amendment,
   escalate to human).
3. The three laws are testable against observable artifacts.

---

## Three Laws

| Law | Principle | Drift Test |
|-----|-----------|------------|
| **Reality** | Artifacts must reflect actual system state. | Does a doc, policy, or schema match what the code actually does? |
| **Selection** | The system must choose which rules apply before relying on memory of past rules. | Is a rule being applied because it is current, or because it was previously correct? |
| **Governed Recursion** | Self-referential processes must have external oversight. | Can a process modify the rules that govern it without human approval? |

---

## Drift Categories

### 1. Document-Reality Drift

A document claims behavior that the system does not implement, or omits
behavior that the system does implement.

| Signal | Example |
|--------|---------|
| Doc says gate blocks on X, code allows X | Health policy doc says RED blocks all workers; launch gate permits recovery workers |
| Doc lists 5 required sections; guard checks 4 | Constitution guard schema out of sync with seed constitution headings |
| Task contract example uses deprecated field | Worker task contract doc references a field removed from the schema |

**Detection:** Compare doc claims against code behavior. The constitution
guard (`check-constitution.js`) catches structural mismatches; semantic
mismatches require human review.

**Severity:** Warning. Does not block workers, but must be resolved
before the next wave.

---

### 2. Policy-Selection Drift

An outdated policy is applied because the system cached or remembered it
after the authoritative source changed.

| Signal | Example |
|--------|---------|
| Launch gate uses old health state | Health marker file is stale; gate reads a green state that is no longer current |
| Worker reads outdated task contract | Task JSON was compiled before a schema update; worker follows old field semantics |
| Review gate applies retired role | PR review gate references a role that was merged into another role |

**Detection:** Compare the timestamp or hash of the applied policy
against the authoritative source. State reconciler
(`state-reconciler.ps1`) catches some of these; others require manual
audit.

**Severity:** Medium. May cause workers to operate under incorrect
constraints.

---

### 3. Scope-Expansion Drift

A worker or process expands its own boundaries, violating the No Worker
Scope Expansion rule.

| Signal | Example |
|--------|---------|
| Worker edits files outside `allowedFiles` | Boundary guard catches at pre-merge |
| Worker modifies its own task JSON | Task JSON immutability check fails |
| Orchestrator spawns unapproved sub-workers | Worker heartbeat shows child processes not in the launch plan |
| Worker edits `.github/ai-policy/` without authorization | Boundary guard catches; constitution guard catches structural changes |

**Detection:** Boundary guard (`check-task-boundary.js`) at pre-merge.
Task JSON immutability at runtime.

**Severity:** High. Blocks the PR. Requires human investigation.

---

### 4. Governance-Recursion Drift

A process modifies the rules that govern it without external oversight.

| Signal | Example |
|--------|---------|
| Automation edits the seed constitution | Constitution guard detects section count mismatch |
| Worker modifies its own `allowedFiles` in task JSON | Task immutability check fails |
| Script changes the launch gate logic | Diff touches `scripts/ai/check-launch-gate.ps1` without human review |
| Policy file edited by a worker whose `allowedFiles` includes `.github/ai-policy/**` | Task contract must explicitly exclude policy files unless human-approved |

**Detection:** Constitution guard + boundary guard. Any change to
`.github/ai-policy/**`, `.github/ai-state/**`, or constitution-adjacent
scripts must be human-authored.

**Severity:** Critical. Blocks the PR. Triggers immediate human review.
Constitutional amendment process must be followed.

---

### 5. Human-Boundary Erosion

A process that should require human approval is automated without
authorization.

| Signal | Example |
|--------|---------|
| Auto-merge applied to high-risk PR | Controlled auto-merge script blocks `src/**` and `prisma/**` |
| Worker force-pushes to main | Seed constitution prohibits; git hooks enforce |
| Dependency change merged without repo-owner review | PR review gate requires specific role |
| Auth/database cutover automated | Loop model reserves these for human decision |

**Detection:** PR review gate, controlled auto-merge guards, boundary
guard. Any high-risk boundary crossing must surface to a human.

**Severity:** Critical. Blocks the PR. May require rollback.

---

### 6. Enforcement-Reality Drift

The enforcement mechanism itself diverges from the rule it claims to
enforce.

| Signal | Example |
|--------|---------|
| Guard script has a bug that allows violations | Boundary check regex does not match a new file pattern |
| Health gate reports green when main is broken | Post-merge health gate script has a false-pass condition |
| Launch gate permits a task it should block | Health policy matrix has a missing entry |
| Constitution guard checks wrong section names | Guard hardcodes old heading text |

**Detection:** Fixture-based testing (dry-run fixtures), manual audit of
guard scripts against the rules they enforce.

**Severity:** High. Undermines the entire control plane. Fix the guard
first, then re-audit recent merges.

---

## Severity and Response Matrix

| Severity | Response | Owner |
|----------|----------|-------|
| **Warning** | Log finding. Fix in next docs wave. | Constitution Steward |
| **Medium** | Propose fix. Human reviews before merge. | Constitution Steward + reviewer |
| **High** | Block affected PRs. Human investigates root cause. | Human (architecture-review) |
| **Critical** | Block all workers. Trigger human escalation. Follow rollback if needed. | Human (repository owner) |

---

## Inputs

The Constitution Steward reads these artifacts during an audit:

| Artifact | Source | What It Reveals |
|----------|--------|-----------------|
| Seed constitution | `.github/ai-policy/seed-constitution.md` | Authoritative rules |
| Docs mirror | `docs/ai-native/seed-constitution.md` | Doc-reality sync |
| Constitution guard output | `check-constitution.js --json` | Structural integrity |
| Boundary guard output | `check-task-boundary.js` | Scope compliance |
| Launch gate output | `check-launch-gate.ps1` | Pre-launch policy |
| State reconciler output | `state-reconciler.ps1` | Issue/PR drift |
| Task JSON contracts | `.ai/task-manifest.json` | Worker boundaries |
| PR review gate results | PR body validation | Handoff completeness |

---

## Outputs

An audit produces:

1. **Drift findings** — each classified by category and severity.
2. **Proposed amendments** — if a rule needs updating (human must
   approve).
3. **Guard fix recommendations** — if an enforcement mechanism is
   broken.

The Constitution Steward may propose but cannot self-approve any change
to the seed constitution or its enforcement.

---

## Non-Goals

- This taxonomy does **not** define new rules. It classifies drift from
  existing rules.
- This taxonomy does **not** override the seed constitution. Where
  conflict exists, the seed constitution is authoritative.
- This taxonomy does **not** authorize self-expansion. The Constitution
  Steward cannot widen its own audit scope.

---

## Gates

| Gate | Trigger | Blocks |
|------|---------|--------|
| Constitution guard | Any PR touching constitution-adjacent files | Merge if structural drift detected |
| Boundary guard | Any PR | Merge if scope violation detected |
| Launch gate | Before worker dispatch | Launch if health or policy drift detected |
| State reconciler | Pre-cycle | Does not block; reports findings |

---

## Rollback and Escape Hatches

| Scenario | Action |
|----------|--------|
| Drift taxonomy itself is outdated | Human-authored PR to update this file; constitution guard verifies structural integrity |
| Guard produces false positives | Fix the guard script (human review required for `scripts/ai/**`) |
| Audit finds critical drift mid-wave | Pause wave. Human investigates. Recovery worker may be launched per main-health-policy |
| Constitution Steward disagrees with a rule | File an issue. Cannot self-amend. |

---

## References

- [seed-constitution.md](seed-constitution.md) — Authoritative rules.
- [constitution-guard.md](constitution-guard.md) — Structural validation.
- [worker-task-contract.md](worker-task-contract.md) — Task boundary schema.
- [controlled-auto-merge.md](controlled-auto-merge.md) — Merge safety guards.
- [main-health-policy.md](main-health-policy.md) — Health states and launch permissions.
- [loop-model.md](loop-model.md) — Self-cycle runner and human-owned decisions.
