# Constitution Amendment Protocol

Defines the full lifecycle for proposing, reviewing, ratifying, and
rolling back amendments to the seed constitution. Expands the terse
amendment rules in [seed-constitution.md](seed-constitution.md) into an
auditable, step-by-step protocol.

> **Closes:** [#1061](https://github.com/taoyu051818-sys/lian-nest-server/issues/1061)
> **Status:** Defined
> **Authority level:** Constitutional — same as the seed constitution itself.

---

## Purpose

The seed constitution is the highest-authority document in the control
plane. Its amendment process must be:

- **Auditable** — every amendment has a traceable proposal, review, and
  ratification record.
- **Human-gated** — no automation may self-approve constitutional
  changes.
- **Bounded** — the Constitution Steward may propose and audit, but
  cannot ratify.
- **Reversible** — every amendment can be rolled back to the prior
  state.

---

## Overview

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Proposal   │───▶│  Review Gate │───▶│  Ratification│
│              │    │              │    │              │
│  human or    │    │ architecture │    │ repo owner   │
│  steward     │    │ -review role │    │ approval     │
│  (advisory)  │    │              │    │              │
└──────────────┘    └──────────────┘    └──────┬───────┘
                                               │
                                               ▼
                                        ┌──────────────┐
                                        │ Mirror Sync  │
                                        │              │
                                        │ both files   │
                                        │ updated      │
                                        └──────────────┘
```

An amendment moves through four stages. Each stage has a gate that must
pass before the next stage begins.

---

## Roles

| Role | May Propose | May Review | May Ratify | May Roll Back |
|------|-------------|------------|------------|---------------|
| Repository owner | Yes | Yes | Yes | Yes |
| Human contributor | Yes | No | No | No |
| `architecture-review` role | No | Yes | No | No |
| Constitution Steward (automation) | Advisory only | No | No | No |
| Any AI worker | No | No | No | No |

The Constitution Steward may audit the constitution and produce advisory
proposals, but it cannot open a PR, approve a PR, or merge a PR that
touches the constitution. This is a hard boundary — see
[No Worker Scope Expansion](seed-constitution.md#5-no-worker-scope-expansion).

---

## Stage 1: Proposal

### Who May Propose

- **Human contributors** — open a PR that modifies the constitution
  files.
- **Constitution Steward** — comment an advisory proposal on an issue.
  The proposal is informational; a human must convert it into a PR.

### Proposal Requirements

Every amendment proposal (PR or advisory comment) MUST include:

| Field | Required | Description |
|-------|----------|-------------|
| Affected section | Yes | Which section number and heading is changed |
| Current text | Yes | The exact text being modified (or "new section") |
| Proposed text | Yes | The exact replacement text |
| Rationale | Yes | Why the amendment is needed |
| Impact assessment | Yes | Which workers, guards, or policies are affected |
| Rollback plan | Yes | How to revert if the amendment causes issues |

### Proposal Format (PR)

```markdown
## Amendment Proposal

**Section:** <section number>. <section heading>
**Type:** modify | add | remove

### Current Text
> <exact current text>

### Proposed Text
<exact proposed text>

### Rationale
<why this change is needed>

### Impact Assessment
- Workers affected: <list or "none">
- Guards affected: <list or "none">
- Policies affected: <list or "none">

### Rollback Plan
<how to revert>
```

### Advisory Proposal Format (Constitution Steward comment)

The Constitution Steward may post advisory proposals as issue comments.
These use the same fields but are explicitly marked as non-binding:

```
[Constitution Steward Advisory Proposal]
This is an informational proposal. A human must convert it to a PR.

Section: <section number>. <section heading>
...
```

---

## Stage 2: Review Gate

### Review Requirements

1. The PR MUST be reviewed by the `architecture-review` role.
2. The reviewer MUST verify:
   - The proposal follows the format above.
   - The rationale is sound and the impact assessment is complete.
   - The amendment does not weaken high-risk boundaries (section 1) or
     worker scope immutability (section 5) without extraordinary
     justification.
   - The rollback plan is viable.
3. The reviewer MUST NOT be the same person as the proposer (separation
   of duties).

### Review Outcomes

| Outcome | Next Step |
|---------|-----------|
| Approved | Proceed to Stage 3: Ratification |
| Changes requested | Proposer updates the PR; re-enters Stage 2 |
| Rejected | PR closed; rationale documented in the PR |

---

## Stage 3: Ratification

### Requirements

1. The repository owner MUST approve the PR.
2. The owner MUST verify the `architecture-review` approval is present.
3. The owner is the final authority — no override mechanism exists.

### Ratification Record

When the owner approves, the PR becomes the ratification record. The
merge commit SHA is the amendment's version identifier.

---

## Stage 4: Mirror Sync

After ratification, the amendment MUST be applied to both files:

| File | Role | Who Updates |
|------|------|-------------|
| `.github/ai-policy/seed-constitution.md` | Authoritative source of truth | Same PR |
| `docs/ai-native/seed-constitution.md` | Docs mirror | Same PR |

Both files MUST be updated in the same PR. A constitutional amendment
that updates only one file is invalid and MUST be blocked.

The [constitution-guard](constitution-guard.md) enforces that both files
exist, contain the 5 required sections, and have matching section
headings.

---

## Emergency Amendments

In rare cases where main health is red and a constitutional rule is
blocking recovery, an emergency amendment may bypass the standard review
timeline:

| Step | Requirement |
|------|-------------|
| 1 | Repository owner declares the emergency in the PR body |
| 2 | PR must state why the standard timeline is insufficient |
| 3 | `architecture-review` review is still required but may be expedited |
| 4 | The amendment MUST be narrowly scoped to unblock recovery |
| 5 | A follow-up PR MUST be opened within 48 hours to formalize the change through the standard process |

Emergency amendments that are not formalized within 48 hours MUST be
reverted.

---

## Rollback

Every amendment can be rolled back by reverting the merge commit. The
rollback procedure:

1. Revert the merge commit that ratified the amendment.
2. Verify both constitution files are in sync (run the constitution
   guard).
3. If the rollback affects workers in flight, pause them per the
   [Main-Red Launch Stop](seed-constitution.md#3-main-red-launch-stop)
   policy.

Rollback does not require the full amendment protocol — it is a
restoration to a known-good state.

---

## Non-Goals

- **No voting or consensus mechanism.** The repository owner has final
  authority. There is no multi-party vote.
- **No versioning schema.** Amendment history is tracked via git commit
  history and PR references.
- **No automation-initiated amendments.** The Constitution Steward may
  advise, but a human always initiates and ratifies.
- **No partial amendments.** An amendment must update both the
  authoritative file and the docs mirror in a single PR.
- **No retroactive amendments.** Amendments apply from the merge commit
  forward; they do not rewrite history.

---

## Enforcement

| Gate | Enforced By | When |
|------|-------------|------|
| Proposal format | PR template + `architecture-review` review | Stage 2 |
| Human-authored | PR author must be a human account | Stage 1 |
| Architecture review | Required reviewer on the PR | Stage 2 |
| Owner ratification | Required approval on the PR | Stage 3 |
| Mirror sync | Constitution guard (`check-constitution.js`) | Pre-merge |
| Emergency formalization | Manual tracking (48-hour follow-up) | Post-merge |

---

## References

- [seed-constitution.md](seed-constitution.md) — The constitution and
  its current amendment rules.
- [constitution-guard.md](constitution-guard.md) — Pre-flight validation
  of constitution files.
- [external-intake-docs-authority.md](external-intake-docs-authority.md)
  — Authority hierarchy placing the constitution at the top.
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema
  (workers cannot self-expand scope).
- [main-health-policy.md](main-health-policy.md) — Health states and
  launch permissions.
