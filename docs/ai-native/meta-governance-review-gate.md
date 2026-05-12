# Meta-Governance Review Gate

Constitution Steward layer that audits prompts, policies, schemas, docs, and
workflows against the three constitutional laws. Proposes amendments when drift
is detected. Cannot self-approve constitutional changes — all amendments require
human ratification.

> **Closes:** [#1071](https://github.com/taoyu051818-sys/lian-nest-server/issues/1071)

---

## Purpose

The meta-governance review gate ensures that every artifact governing AI worker
behavior remains consistent with the three constitutional laws:

1. **Reality** — Artifacts must reflect observed system behavior, not assumed
   or aspirational state. Policies derived from stale or incorrect premises
   are flagged.
2. **Selection** — Constraints must be selected by deliberate human choice,
   not accumulated by accident or drift. Orphaned rules and dead policies are
   surfaced for removal.
3. **Governed Recursion** — The steward may audit and propose but must not
   expand its own powers. Self-referential changes (gate modifies its own
   approval criteria) are blocked.

---

## Inputs

| Input | Source | Description |
|-------|--------|-------------|
| Prompts | `ops/agent-prompts/**/*.md` | Worker role prompts and attention areas |
| Policies | `docs/ai-native/*.md` | Gate docs, contracts, SOPs, health policies |
| Schemas | `docs/ai-native/worker-task-contract.md` | Task JSON contract and field definitions |
| Workflows | `scripts/ai/*.ps1`, `scripts/ai/*.js` | Launcher, gate, and orchestrator scripts |
| PR artifacts | PR body, diff, labels | Live artifacts under review |
| Issue metadata | GitHub issue body | CONTROL APPENDIX and acceptance criteria |

---

## Outputs

| Output | Format | Consumer |
|--------|--------|----------|
| Audit report | Structured text or JSON | Human reviewer, orchestrator |
| Amendment proposals | Markdown diff or issue comment | Constitution steward reviewer |
| Gate decision | `pass` / `warn` / `block` | PR review gate, self-cycle runner |

---

## Non-Goals

The meta-governance gate does **not**:

- Modify runtime code (`src/**`, `prisma/**`).
- Approve its own constitutional amendments.
- Weaken existing high-risk gates (auth, database, security).
- Touch Claude settings, secrets, or environment files.
- Broaden its scope beyond auditing and proposing.
- Override human-required merge decisions.
- Generate new worker tasks or issue batches.

---

## Three Laws

### Law 1: Reality Before Judgment

Every policy claim must trace to an observed fact: a test result, a script
behavior, a production incident, or a documented human decision. The steward
flags:

- Policies referencing scripts, files, or fields that no longer exist.
- Claims about system behavior that contradict test output or build results.
- Documentation that describes aspirational state as though it were current.

**Example violation:** A gate doc claims "all workers must pass `npm run check`"
but the validation commands in the task contract skip the check for research
tasks. The steward flags the inconsistency — the doc overstates reality.

### Law 2: Selection Before Memory

Constraints exist because a human chose them, not because they accumulated over
time. The steward surfaces:

- Orphaned rules with no traceable origin (no issue, no PR, no human decision).
- Duplicated constraints across multiple docs (selection by copy-paste is not
  deliberate selection).
- Policies that reference deprecated labels, scripts, or workflows.

**Example violation:** Two docs define overlapping review requirements. The
steward proposes consolidating them so the human can make one deliberate choice.

### Law 3: Governed Recursion

The steward audits its own boundaries. It may **not**:

- Modify this file's approval criteria.
- Add new powers to the constitution steward role.
- Remove or weaken its own constraints.
- Bypass the human ratification requirement.

If a proposed change would alter the steward's own scope, the steward must flag
it as requiring explicit human approval and stop.

---

## Gate Behavior

### Per-PR Audit

When attached to a PR review, the steward checks:

1. **Scope fidelity** — Changed files match the issue's `allowedFiles` and do
   not touch `forbiddenFiles`.
2. **Law consistency** — New or modified docs, prompts, and schemas do not
   contradict existing constitutional constraints.
3. **No self-expansion** — The PR does not grant new powers to the steward
   role or weaken existing human-required gates.

### Periodic Audit

When run on the full artifact set (not scoped to a single PR), the steward
produces a drift report:

- Stale references (files, scripts, or fields that no longer exist).
- Contradictions between docs.
- Orphaned policies with no traceable origin.

### Gate Decision

| Outcome | Condition | Human action required |
|---------|-----------|----------------------|
| **pass** | No constitutional drift detected | None |
| **warn** | Drift detected, no blocking violation | Review advisory; may merge |
| **block** | Constitutional violation or self-expansion | Amendment required before merge |

A **block** result means the PR cannot be auto-merged. The steward proposes
an amendment in the PR comments, but only a human with the
`constitution-steward-reviewer` or `ai-governance-reviewer` role may approve
or reject the proposal.

---

## Rollback and Escape Hatches

### Amendment Rollback

If a ratified amendment introduces regressions, revert the commit that modified
the affected artifact. The steward re-audits on the next pass and flags the
regression.

### Steward Override

The `constitution-steward-reviewer` role can override a **block** decision with
documented justification. The override is logged in the PR comments.

### Emergency Bypass

If the steward itself is broken (script error, malformed output), the
orchestrator falls back to the standard PR review gate without meta-governance
checks. This is logged as a deviation and requires post-incident review.

---

## Review and Acceptance

| Role | Scope |
|------|-------|
| `constitution-steward-reviewer` | Approves or rejects steward amendments |
| `ai-governance-reviewer` | Final acceptance on constitutional changes |
| `repo-owner` | Emergency override with documented justification |

No steward amendment merges without at least one human approval from a required
review role.

---

## References

- [Loop Model](loop-model.md) — Self-cycle runner phases and boundaries.
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema and field definitions.
- [PR Review Gate](pr-review-gate.md) — Per-PR automated and role-based checks.
- [Launch Gate](launch-gate.md) — Pre-launch validation policy.
- [Controlled Auto-Merge](controlled-auto-merge.md) — Batch merge safety and guard integration.
- [#1071](https://github.com/taoyu051818-sys/lian-nest-server/issues/1071) — This feature.
