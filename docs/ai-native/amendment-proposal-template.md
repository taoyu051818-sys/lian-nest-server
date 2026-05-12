# Amendment Proposal Template

Structured format for proposing changes to the seed constitution. The
Constitution Steward layer may draft proposals but **cannot self-approve**
constitutional changes. Every amendment requires human review and approval.

> **Closes:** [#1070](https://github.com/taoyu051818-sys/lian-nest-server/issues/1070)
>
> **Reference:** [seed-constitution.md](seed-constitution.md) for the
> current constitution, [constitution-guard.md](constitution-guard.md) for
> validation guards.

---

## Purpose

This template standardizes how constitutional amendments are proposed,
reviewed, and applied. It ensures every proposal:

1. States what changes and why.
2. Maps the change to the three constitutional laws.
3. Identifies blast radius and rollback path.
4. Passes through human-required gates before merge.

The template prevents two failure modes:

1. **Underspecified proposals** — amendments that change rules without
   explaining downstream impact on workers, gates, or policies.
2. **Unreviewed self-expansion** — automation broadening its own authority
   through ambiguous or hidden constitutional edits.

---

## Three Laws Check

Every amendment MUST be evaluated against the three constitutional laws
before submission. The proposer completes this table; reviewers verify it.

| Law | Question | Answer |
|-----|----------|--------|
| **Reality** | Does the proposal reflect an observed need grounded in evidence (incidents, audit findings, blocked work)? | yes / no + evidence |
| **Selection** | Is this the minimal change that solves the problem? Are there narrower alternatives? | yes / no + justification |
| **Governed Recursion** | Does the proposal preserve the principle that no actor can expand its own authority? | yes / no + explanation |

A "no" on any law is a blocker. The proposal MUST address the gap before
it enters review.

---

## Proposal Sections

Use this structure when authoring an amendment proposal as an issue body
or PR description.

### 1. Amendment Metadata

```markdown
- **Target file:** .github/ai-policy/seed-constitution.md (authoritative)
- **Mirror file:** docs/ai-native/seed-constitution.md
- **Affected sections:** [list section numbers or headings]
- **Proposal type:** add | modify | remove
- **Proposed by:** [human username or role]
```

### 2. Problem Statement

Describe the gap, incident, or blocked work that motivates the amendment.
Include evidence: issue numbers, audit logs, failed worker runs, or
reviewer feedback.

### 3. Proposed Change

State the exact change. For modifications, show the diff between the
current rule text and the proposed rule text. For additions, write the
full new section or entry. For removals, state what is removed and why
it is no longer needed.

### 4. Impact Assessment

| Dimension | Impact |
|-----------|--------|
| Workers affected | [list worker roles or tiers] |
| Gates affected | [list guard scripts or gate policies] |
| Policies affected | [list docs that reference the changed section] |
| Backward compatibility | Does the change break existing task JSON contracts? yes / no |

### 5. Rollback Plan

State how to revert the amendment if it causes problems after merge.

| Amendment Type | Rollback Method |
|----------------|-----------------|
| Additive (new rule or entry) | Remove the added text from both authoritative and mirror files |
| Modifying (changing existing rule) | Restore the previous rule text from git history |
| Removing (deleting a rule) | Restore the deleted text from git history |

If the rollback is more complex than a `git revert` (e.g., downstream
policies or guards need coordinated changes), document the full sequence.

### 6. Validation

List the validation commands that confirm the amendment is correctly
applied and does not break existing guards.

```bash
# Constitution guard still passes
node scripts/guards/check-constitution.js

# Boundary guard still passes
node scripts/guards/check-task-boundary.js

# No broken references in docs
npm run check
```

---

## Non-Goals

This template does NOT cover:

- **Policy creation** — new policies outside the constitution follow the
  bounded experiment policy ([bounded-experiment-policy.md](bounded-experiment-policy.md)).
- **Worker task changes** — task JSON modifications follow the worker
  task contract ([worker-task-contract.md](worker-task-contract.md)).
- **Operational runbooks** — incident procedures follow the SOP
  ([SOP.md](SOP.md)).

---

## Gates

### Pre-Submission Gate

Before filing the proposal, the proposer MUST verify:

1. The three laws check table is complete with no "no" answers.
2. The impact assessment lists all affected workers, gates, and policies.
3. A rollback plan is defined.
4. Validation commands are listed.

### Review Gate

Constitutional amendments require:

1. **Human-authored PR** — automation MUST NOT create or auto-merge
   amendment PRs.
2. **Architecture-review role** — the PR MUST be reviewed by a human
   with the `architecture-review` role.
3. **Repository owner approval** — the PR MUST be approved by the
   repository owner before merge.
4. **Authoritative + mirror sync** — both `.github/ai-policy/seed-constitution.md`
   and `docs/ai-native/seed-constitution.md` MUST be updated in the same PR.

### Post-Merge Gate

After merge, the constitution guard MUST pass:

```bash
node scripts/guards/check-constitution.js --json
```

If the guard fails, the merge MUST be reverted immediately.

---

## Escape Hatch

If a constitutional amendment is urgently needed and the full review
process cannot complete in time:

1. File the proposal with all sections completed.
2. Tag the PR as `priority:urgent`.
3. The repository owner MAY fast-track approval with a single review.
4. The architecture-review role MUST still complete a post-hoc review
   within 48 hours.
5. If the post-hoc review identifies issues, a follow-up amendment or
   revert PR MUST be filed.

This escape hatch exists for operational emergencies only. Routine
amendments MUST follow the standard review gate.

---

## References

- [seed-constitution.md](seed-constitution.md) — Current constitution (docs mirror)
- [seed-constitution.md (authoritative)](../../.github/ai-policy/seed-constitution.md) — Source of truth
- [constitution-guard.md](constitution-guard.md) — Pre-flight constitution validation
- [bounded-experiment-policy.md](bounded-experiment-policy.md) — Experiment lifecycle
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema
- [controlled-auto-merge.md](controlled-auto-merge.md) — Merge guard rules
