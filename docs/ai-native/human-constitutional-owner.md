# Human Constitutional Owner

Defines the single human role with final authority over constitutional
boundaries, seed-constitution amendments, and meta-governance policy in
`lian-nest-server`.

> **Closes:** [#1066](https://github.com/taoyu051818-sys/lian-nest-server/issues/1066)

---

## Purpose

The Human Constitutional Owner is the escalation point for any change
that touches the constitution or the meta-governance layer. No worker,
orchestrator, or automation may self-approve a constitutional change.
This role exists because:

1. **Reality before judgment.** Constitutional rules encode production
   constraints learned from incidents. Removing or weakening them
   requires human assessment of whether the underlying reality has
   changed.
2. **Selection before memory.** The constitution is a curated set of
   boundaries, not a log of every decision. Changes must be selected
   for inclusion by a human who can weigh blast radius.
3. **Governed recursion.** The constitution governs the workers that
   operate under it. Allowing workers to modify their own governing
   rules breaks the recursion guard.

---

## Role Definition

| Field | Value |
|-------|-------|
| **Who** | Repository owner (GitHub account with admin access) |
| **Scope** | Seed constitution, `.github/ai-policy/**`, meta-governance docs |
| **Authority** | Final approval on constitutional amendments |
| **Delegation** | May delegate review to `architecture-review` role but retains final sign-off |

### Responsibilities

1. Review and approve PRs that modify the seed constitution or
   `.github/ai-policy/**` files.
2. Resolve disputes when a worker or reviewer contests a boundary.
3. Decide whether a proposed boundary change reflects a genuine shift
   in production reality or a worker attempting scope expansion.
4. Approve new human-required boundaries when risk factors change.
5. Maintain the list of trusted reviewers in the `architecture-review`
   role.

### Non-Goals

The Human Constitutional Owner does **not**:

- Approve day-to-day worker PRs (that is the review gate's job).
- Manage provider pool, worker dispatch, or health gates.
- Write worker task contracts or role prompts.
- Override the launch gate or health gate for operational convenience.

---

## Gates

Every constitutional change must pass all three gates before merge:

| Gate | Enforced By | Blocking |
|------|-------------|----------|
| Human-authored PR | PR author check (no `agent:*` author) | Yes |
| Architecture review | `architecture-review` role approval | Yes |
| Owner sign-off | Human Constitutional Owner approval | Yes |
| Docs authority sync | `check-docs-authority.js` (mirror consistency) | Warning |
| Constitution guard | `check-constitution.js` (section integrity) | Yes |

A PR that fails any blocking gate MUST NOT be merged. The constitution
guard verifies that the five required sections remain present and that
the docs mirror stays in sync with the authoritative file.

---

## Inputs

The Human Constitutional Owner uses these sources to make decisions:

| Input | Source | Purpose |
|-------|--------|---------|
| Seed constitution | `.github/ai-policy/seed-constitution.md` | Current boundaries |
| Docs mirror | `docs/ai-native/seed-constitution.md` | Consistency check |
| Boundary guard logs | Pre-merge validation output | Violation patterns |
| Incident history | Git log, issue tracker | Whether a boundary was added due to a real incident |
| Worker task contracts | `docs/ai-native/worker-task-contract.md` | Understanding worker scope |

---

## Outputs

| Output | Format | Consumer |
|--------|--------|----------|
| Approved constitutional PR | Merged commit | All workers, orchestrators, guards |
| Boundary decision | PR comment or issue comment | Requesting worker or reviewer |
| Reviewer delegation | Config or docs update | `architecture-review` role members |

---

## Escape Hatch

If the Human Constitutional Owner is unavailable and a blocking
constitutional issue arises:

1. **Do not bypass the gate.** The constitution remains in force.
2. **Comment on the issue** documenting the urgency and the specific
   boundary involved.
3. **Tag the owner** on the PR or issue with `@<owner>`.
4. **Wait.** The constitution's immutability is a feature, not a bug.
   An unavailable owner does not create an opening for automation to
   self-approve.

If the owner is permanently unavailable (e.g., leaves the project),
the repository admin MUST appoint a successor before any further
constitutional changes can merge. The appointment itself is a
constitutional change and follows the same gate process.

---

## Rollback

If a constitutional change introduces a regression:

1. Revert the merged commit.
2. The constitution guard re-validates on the next CI run.
3. The owner reviews whether the reverted boundary should be
   re-proposed with corrections or abandoned.
4. No worker action is required — the reverted constitution takes
   effect immediately on merge.

---

## Relationship to Other Roles

| Role | Relationship |
|------|-------------|
| Constitution Steward worker | Audits constitution against reality; proposes amendments; cannot self-approve |
| `architecture-review` | Reviews constitutional PRs; may approve but owner retains final sign-off |
| Workers (all types) | Operate under the constitution; must comment on issues when boundaries are hit |
| Orchestrator | Enforces constitution via launch gate and boundary guard; cannot modify it |
| Repository admin | Appoints owner successor; does not override constitutional decisions |

---

## Enforcement

```
Constitutional change proposed (PR)
    │
    ├── Author is human?
    │   ├── No  → Block: "constitutional changes must be human-authored"
    │   └── Yes → Continue
    │
    ├── Architecture review approved?
    │   ├── No  → Block: "requires architecture-review approval"
    │   └── Yes → Continue
    │
    ├── Owner sign-off?
    │   ├── No  → Block: "requires Human Constitutional Owner approval"
    │   └── Yes → Continue
    │
    ├── Constitution guard passes?
    │   ├── No  → Block: "constitution integrity check failed"
    │   └── Yes → Continue
    │
    └── Merge allowed
```

---

## References

- [seed-constitution.md](seed-constitution.md) — The constitution itself.
- [constitution-guard.md](constitution-guard.md) — Pre-merge integrity check.
- [worker-task-contract.md](worker-task-contract.md) — Worker scope boundaries.
- [webui-human-required-boundaries.md](webui-human-required-boundaries.md) — Human-required action boundaries.
- [loop-model.md](loop-model.md) — Human-owned decisions in the loop.
- [codex-retirement-runbook.md](codex-retirement-runbook.md) — Human-owned decisions list.
