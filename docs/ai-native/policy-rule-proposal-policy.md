# Policy Rule Proposal Policy

Defines how the Constitution Steward layer proposes new or amended policy
rules, what gates a proposal must pass, and where human authority is
required.

> **Scope:** Meta-governance. This policy governs the proposal process
> itself — not the content of any specific policy.
>
> **Cross-reference:** [seed-constitution.md](seed-constitution.md) for
> immutable rules, [constitution-guard.md](constitution-guard.md) for
> structural validation.

---

## Purpose

The Constitution Steward audits prompts, policies, schemas, docs, and
workflows against three laws: Reality, Selection, and Governed Recursion.
When an audit surfaces a gap, inconsistency, or improvement opportunity,
the Steward produces a **policy rule proposal** — a structured artifact
describing the proposed change and its justification.

This policy ensures that proposals are:

1. **Grounded in observed evidence** (Reality before judgment).
2. **Scoped to a single rule or amendment** (Selection before memory).
3. **Subject to governed review** (Governed Recursion — no self-approval).

The policy prevents three failure modes:

1. **Unbounded policy drift** — proposals that gradually weaken
   constitutional boundaries through incremental changes.
2. **Self-approved expansion** — the Steward approving its own proposals
   without human review.
3. **Vague or unmeasurable proposals** — changes that cannot be evaluated
   against concrete criteria.

---

## Definitions

| Term | Meaning |
|------|---------|
| **Policy rule** | A documented constraint, gate, permission, or boundary in `docs/ai-native/` or `.github/ai-policy/`. |
| **Proposal** | A structured artifact describing a proposed addition, amendment, or removal of a policy rule. |
| **Constitution Steward** | The meta-governance layer that audits and proposes. May NOT self-approve. |
| **Human author** | The person who owns the proposal after the Steward drafts it. Required for all proposals. |
| **Constitutional change** | Any proposal that modifies `seed-constitution.md` or `.github/ai-policy/seed-constitution.md`. |

---

## Inputs

A policy rule proposal requires all of the following inputs:

| Input | Source | Required |
|-------|--------|----------|
| **Evidence** | Audit finding, gap ledger entry, failure taxonomy incident, or human request | Yes |
| **Affected file(s)** | Specific `docs/ai-native/` or `.github/ai-policy/` file(s) | Yes |
| **Three-laws alignment** | Explicit statement of how the proposal aligns with Reality, Selection, and Governed Recursion | Yes |
| **Scope declaration** | Single rule or amendment — not a batch of unrelated changes | Yes |
| **Human author** | Person accepting ownership of the proposal | Yes |

A proposal without evidence is a suggestion, not a proposal. The Steward
MUST NOT produce proposals from assumptions or hypothetical scenarios.

---

## Outputs

A completed proposal consists of:

| Output | Format | Destination |
|--------|--------|-------------|
| **Proposal document** | Markdown following the template below | GitHub issue body or PR description |
| **Evidence summary** | Inline in the proposal | Same issue/PR |
| **Gate checklist** | Inline in the proposal | Same issue/PR |

The proposal document MUST include these sections:

```markdown
## Summary
One-paragraph description of the proposed change.

## Evidence
What audit finding, gap, or incident motivates this proposal.

## Proposed Change
The specific rule addition, amendment, or removal.

## Three-Laws Alignment
- **Reality:** How this is grounded in observed evidence.
- **Selection:** Why this single change was selected over alternatives.
- **Governed Recursion:** How this change remains subject to human review.

## Non-Goals
What this proposal does NOT change.

## Gate Checklist
- [ ] Does not weaken seed constitution boundaries
- [ ] Does not expand Steward self-approval authority
- [ ] Does not modify runtime code
- [ ] Affects only declared files
- [ ] Human author assigned

## Rollback
How to revert if the change causes issues.
```

---

## Non-Goals

This policy does NOT:

1. **Govern proposal approval** — approval is human-owned (see Gates
   section).
2. **Define what policies should exist** — the Steward proposes; humans
   decide.
3. **Override the seed constitution** — constitutional changes follow the
   amendment process in [seed-constitution.md](seed-constitution.md#amendment-process).
4. **Batch proposals** — each proposal addresses one rule or amendment.
   Multiple proposals may reference the same evidence but must be
   independently reviewable.

---

## Gates

### Pre-Submission Gate (Steward-Enforced)

Before a proposal leaves the Steward layer, it MUST pass all of:

| Gate | Check | Fail Action |
|------|-------|-------------|
| Evidence exists | Proposal cites a specific audit finding, gap entry, or human request | Block — proposal is not grounded |
| Single scope | Proposal changes one rule or amends one section | Block — split into separate proposals |
| Three-laws stated | All three laws explicitly addressed | Block — incomplete alignment |
| No self-approval | Proposal does NOT grant the Steward new approval authority | Block — violates Governed Recursion |
| No boundary weakening | Proposal does NOT relax any seed constitution rule | Block — violates constitutional integrity |
| No runtime code | Proposal does NOT touch `src/**`, `prisma/**`, or runtime scripts | Block — outside Steward scope |

### Review Gate (Human-Owned)

After submission, the proposal enters review:

| Reviewer | Scope | Authority |
|----------|-------|-----------|
| `ai-governance-reviewer` | All proposals | Approve, reject, or request revision |
| `constitution-steward-reviewer` | Constitutional changes | Must co-approve |
| Repository owner | Final approval | Binding decision |

A proposal MUST NOT be merged or acted upon without passing the review
gate. The Steward has no authority to bypass this requirement.

### Constitutional Change Gate

Proposals that modify `seed-constitution.md` or
`.github/ai-policy/seed-constitution.md` have an additional gate:

1. Human-authored PR (not generated by automation).
2. Review by `architecture-review` role.
3. Approval by repository owner.
4. Corresponding update to both the authoritative file and the docs
   mirror.

See [seed-constitution.md § Amendment
Process](seed-constitution.md#amendment-process).

---

## Rollback / Escape Hatch

| Scenario | Action |
|----------|--------|
| Proposal rejected | Steward logs the rejection reason. May re-propose after addressing feedback. |
| Proposal causes policy conflict | Revert the merge commit. Steward re-audits with the conflict as new evidence. |
| Proposal weakens a boundary post-merge | Immediate revert. Incident logged in gap ledger. Steward flagged for re-calibration. |
| Steward produces ungrounded proposal | Human reviewer rejects with evidence requirement. Steward must cite specific finding before re-submitting. |
| Proposal scope creeps during review | Reviewer requests split. Each sub-proposal enters the gate independently. |

---

## Worker Responsibilities

Workers operating as Constitution Steward MUST:

1. **Cite evidence** — every proposal traces back to a specific finding.
2. **Stay in scope** — proposals affect only declared files, never
   runtime code or the seed constitution without the constitutional gate.
3. **Not self-approve** — proposals are drafts until a human approves.
4. **Accept rejection** — rejected proposals are logged, not re-submitted
   without addressing the rejection reason.

---

## Relationship to Existing Policies

| Policy | Interaction |
|--------|------------|
| [seed-constitution.md](seed-constitution.md) | Immutable rules. This policy cannot weaken them. |
| [constitution-guard.md](constitution-guard.md) | Validates constitution structure. Proposals that break structure are blocked. |
| [bounded-experiment-policy.md](bounded-experiment-policy.md) | Policy proposals are scoped experiments with explicit rollback. |
| [evidence-reliability-policy.md](evidence-reliability-policy.md) | Audit evidence follows the same reliability tiers. |
| [failure-taxonomy-policy.md](failure-taxonomy-policy.md) | Failed proposals map to `policy-proposal-rejected` or `policy-conflict`. |
| [docs-authority-map.md](docs-authority-map.md) | `docs/ai-native/` is the governance authority folder. |

---

## References

- [seed-constitution.md](seed-constitution.md) — Immutable constitutional rules.
- [constitution-guard.md](constitution-guard.md) — Structural validation of the constitution.
- [bounded-experiment-policy.md](bounded-experiment-policy.md) — Experiment scoping and lifecycle.
- [evidence-reliability-policy.md](evidence-reliability-policy.md) — Evidence tier classification.
- [docs-authority-map.md](docs-authority-map.md) — Folder authority definitions.
