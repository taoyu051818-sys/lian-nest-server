# Worker Behavior Policy

Defines the behavioral principles every LIAN worker must follow during
task execution. Derived from established AI-agent engineering practices
(Andrej Karpathy's Codex worker guidelines) and adapted to LIAN's
task JSON contract, gate stack, and knowledge writeback requirements.

> **Closes:** [#1210](https://github.com/taoyu051818-sys/lian-nest-server/issues/1210)
>
> **See also:**
> [worker-task-contract.md](worker-task-contract.md) for the task JSON
> schema, [backend-worker-layers.md](backend-worker-layers.md) for the
> layer model, [knowledge-driven-scaling.md](knowledge-driven-scaling.md)
> for verifiable value rules, [launch-gate.md](launch-gate.md) for
> pre-launch validation.

---

## Purpose

Workers that follow the task JSON boundaries but ignore behavioral
principles produce technically valid but practically poor PRs: bloated
diffs, unnecessary abstractions, changes that wander from the acceptance
criteria, or over-engineered solutions to simple problems. This policy
closes that gap by defining *how* workers should think, not just *what*
they may touch.

---

## Principles

### 1. Read Before Writing

**Rule:** A worker MUST read the full semantic context before modifying
any file. Context includes, in priority order:

1. GitHub issue body (`sourceIssue`) — acceptance criteria, business
   rules, and the definition of done.
2. Source-of-truth docs (`knowledgeRefs`) — contracts, architecture
   decisions, and SOPs the issue references.
3. Existing code in the target area — understand current patterns
   before introducing new ones.
4. Task JSON `attentionAreas` — focus constraints and known blindspots.

**How it maps to task JSON:**

| Field | Role in this principle |
|-------|----------------------|
| `sourceIssue` | Primary semantic source — always read first |
| `knowledgeRefs` | Secondary sources — contracts, architecture docs |
| `attentionAreas.focus` | Constraint reminders — what to keep in mind |
| `attentionAreas.knownBlindspots` | Pitfall warnings — what to actively avoid |

**Violation signals:**

- Worker modifies a file it never read.
- PR description does not reference the issue acceptance criteria.
- Worker introduces a pattern that contradicts an existing contract in
  `knowledgeRefs`.

---

### 2. Simplest Viable Change

**Rule:** A worker MUST prefer the simplest solution that satisfies the
acceptance criteria. Complexity must earn its cost.

| Complexity level | Allowed when |
|-----------------|-------------|
| Single-file fix | Default — always try this first |
| Multi-file, same module | Acceptance criteria require it |
| Cross-module change | Issue explicitly requires it and `risk` is `medium` or `high` |
| New abstraction or pattern | No existing pattern works AND issue documents why |

**How it maps to task JSON:**

| Field | Role in this principle |
|-------|----------------------|
| `budgets.maxFiles` | Hard cap on file count — simplicity enforced structurally |
| `budgets.maxLinesChanged` | Hard cap on diff size — prevents bloated changes |
| `risk` | Higher risk demands simpler solutions, not more elaborate ones |
| `complexityAssessment` | Pre-assessed complexity — worker should not exceed it without cause |

**Violation signals:**

- Worker uses 5 files when the task could be done in 2.
- Worker introduces a new abstraction (factory, strategy, decorator)
  when a direct implementation satisfies the criteria.
- Worker's diff exceeds `maxLinesChanged` without the acceptance
  criteria requiring it.
- Worker refactors unrelated code "while they're at it."

---

### 3. Surgical Scope

**Rule:** A worker MUST stay within its `allowedFiles` boundary and
touch only files directly required by the acceptance criteria. Changes
to files outside the stated scope require the worker to stop and report
a blocker.

| Boundary | Behavior |
|----------|---------|
| `allowedFiles` | Worker edits only files matching these globs |
| `forbiddenFiles` | Worker never touches these, even if the fix seems to require it |
| `conflictGroup` | Worker avoids files that overlap with in-flight workers |
| Unrelated files in scope | Worker does not refactor, clean up, or "improve" them |

**How it maps to task JSON:**

| Field | Role in this principle |
|-------|----------------------|
| `allowedFiles` | Surgical boundary — the worker's edit perimeter |
| `forbiddenFiles` | Hard exclusion — never crossed |
| `conflictGroup` | Parallelism guard — avoids interference with other workers |

**Violation signals:**

- Worker edits a file not listed in `allowedFiles`.
- Worker modifies a file in `forbiddenFiles`.
- Worker's PR includes changes to files unrelated to the acceptance
  criteria (formatting fixes, import reordering, comment cleanup).
- Worker does not report a blocker when the fix requires out-of-scope
  changes.

---

### 4. Goal-Driven Execution

**Rule:** A worker MUST orient every decision toward the acceptance
criteria in the issue body. The worker is done when the criteria are
met and validation passes — not when the worker runs out of ideas or
feels the code is "clean enough."

| Behavior | Standard |
|----------|---------|
| Acceptance criteria | Read from `sourceIssue` — the definition of done |
| Validation | Run `validationCommands` — prove the criteria are met |
| Scope creep | Do not add features, refactors, or improvements beyond the criteria |
| Partial progress | Publish via `stragglerPolicy` rather than over-engineer a partial fix |

**How it maps to task JSON:**

| Field | Role in this principle |
|-------|----------------------|
| `sourceIssue` | Acceptance criteria source — read it, follow it |
| `validationCommands` | Proof of completion — run all, capture output |
| `expectedPR` | Whether a PR is the expected deliverable |
| `stragglerPolicy` | Publish partial progress before `hardTimeMinutes` rather than chase perfection |
| `budgets.softTimeMinutes` | Target — aim to finish here, not at the hard cutoff |

**Violation signals:**

- Worker does not run all `validationCommands` before opening PR.
- Worker adds functionality not described in the acceptance criteria.
- Worker reaches `hardTimeMinutes` without opening a PR or commenting
  a blocker.
- Worker's PR body does not include validation command output.

---

### 5. Verifiable Evidence

**Rule:** Every worker output must be verifiable by a consumer that
did not produce it. The PR body is the worker's evidence file — it
must contain enough information for a reviewer to confirm the
acceptance criteria are met without reading every changed file.

**Required evidence in PR body:**

| Evidence | Format |
|----------|--------|
| Validation command output | Copy-pasted terminal output or summary |
| Acceptance criteria mapping | Which criteria are addressed by which changes |
| Blocker documentation | Any unmet criteria with explanation |

**How it maps to task JSON:**

| Field | Role in this principle |
|-------|----------------------|
| `validationCommands` | Source of validation evidence |
| `mainHealthPolicy` | Determines which health gates must pass |
| `expectedPR` | If `true`, PR body is the required evidence surface |

**Violation signals:**

- PR body has no validation output.
- PR body claims "all tests pass" without showing output.
- PR does not map changes to acceptance criteria.

---

## Anti-Patterns

Workers MUST NOT:

| Anti-Pattern | Why it violates this policy |
|-------------|---------------------------|
| Refactor unrelated code | Violates surgical scope (Principle 3) |
| Add abstractions "for future use" | Violates simplest viable change (Principle 2) |
| Skip reading the issue body | Violates read before writing (Principle 1) |
| Chase perfection past `softTimeMinutes` | Violates goal-driven execution (Principle 4) |
| Open PR without validation output | Violates verifiable evidence (Principle 5) |
| Edit `forbiddenFiles` to make tests pass | Violates surgical scope — report a blocker instead |
| Add dependencies not in the issue | Violates simplest viable change and goal-driven execution |
| Self-approve or bypass gates | Violates the seed constitution — this is absolute |

---

## Relationship to Existing Policies

| Policy | Interaction |
|--------|------------|
| [Worker Task Contract](worker-task-contract.md) | This policy governs *how* workers behave within the contract boundaries |
| [Knowledge-Driven Scaling](knowledge-driven-scaling.md) | Principle 5 (verifiable evidence) aligns with the verifiable value rule |
| [Backend Worker Layers](backend-worker-layers.md) | Principle 3 (surgical scope) reinforces layer ordering boundaries |
| [Launch Gate](launch-gate.md) | Principle 1 (read before writing) includes reading gate results |
| [Seed Constitution](seed-constitution.md) | All principles are subordinate to constitutional boundaries |

---

## Enforcement

This policy is **advisory** — it defines expected behavior, not
automated gates. Enforcement happens through:

1. **PR review** — Reviewers check for anti-pattern violations.
2. **Attention areas** — Task JSON `attentionAreas` can reference
   specific principles when the issue warrants it.
3. **Knowledge writeback** — Workers that repeatedly violate principles
   produce gap ledger entries via the knowledge-driven scaling rule.

Future automation may add lint-based checks (e.g., diff size vs.
`maxLinesChanged`, file count vs. `maxFiles`), but the current
enforcement is review-based.

---

## References

- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Knowledge-Driven Scaling](knowledge-driven-scaling.md) — Verifiable value rule
- [Backend Worker Layers](backend-worker-layers.md) — Layer model
- [Launch Gate](launch-gate.md) — Pre-launch validation
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
- [Command Steward Agent](command-steward-agent.md) — Human-facing control plane
- [#1210](https://github.com/taoyu051818-sys/lian-nest-server/issues/1210) — This policy
