# Constitution Auditor Role

Defines the Constitution Auditor role: responsibilities, inputs, outputs,
and the prohibition on self-approving amendments.

> **Closes:** [#992](https://github.com/taoyu051818-sys/lian-nest-server/issues/992)
> **See also:** [seed-constitution.md](seed-constitution.md) for
> immutable boundaries,
> [constitution-guard.md](constitution-guard.md) for structural
> validation, [roles.md](roles.md) for role index.

---

## Overview

The Constitution Auditor reviews all changes that touch constitution,
policy, or governance documents. Its purpose is to enforce the seed
constitution's invariants — particularly the self-expansion guard — and
ensure that no automation weakens human-required boundaries.

The auditor does **not** approve its own amendments. This is a hard
constraint derived from the seed constitution's amendment process.

---

## Responsibilities

| Area | Duty |
|------|------|
| Constitution integrity | Verify that proposed changes do not relax, override, or remove any seed-constitution rule |
| Policy boundary enforcement | Confirm that `.github/ai-policy/**` files are not modified by automation without human review |
| Self-amendment prohibition | Block any PR in which the auditor role would approve changes to its own definition or to constitution files |
| Review gate participation | Serve as a required reviewer on PRs that touch constitution or governance documents |
| Drift detection | Flag divergence between the authoritative constitution (`.github/ai-policy/seed-constitution.md`) and the docs mirror (`docs/ai-native/seed-constitution.md`) |

---

## Inputs

The auditor consumes:

| Input | Source | Purpose |
|-------|--------|---------|
| PR diff | GitHub pull request | Detect changes to constitution or policy files |
| Seed constitution | `.github/ai-policy/seed-constitution.md` | Authoritative rule set to check against |
| Docs mirror | `docs/ai-native/seed-constitution.md` | Verify sync with authoritative file |
| Role definitions | `docs/ai-native/roles.md` | Confirm reviewer identity is valid |
| Boundary guard output | `scripts/guards/check-task-boundary.js` | Pre-merge `allowedFiles` enforcement |
| Constitution guard output | `scripts/guards/check-constitution.js` | Structural integrity of constitution files |

---

## Outputs

The auditor produces:

| Output | Format | Consumer |
|--------|--------|----------|
| Review decision | GitHub PR review (approve / request-changes / comment) | PR merge gate |
| Drift report | Issue comment or new issue | Orchestrator / human |
| Audit fact event | `fact-events.ndjson` entry with `eventType: "audit.constitution"` | Fact event ledger |

---

## Self-Amendment Prohibition

The auditor MUST NOT approve a PR that modifies:

- Its own role definition (this file)
- The seed constitution (`.github/ai-policy/seed-constitution.md` or its docs mirror)
- The constitution guard (`constitution-guard.md` or its script)
- Any file under `.github/ai-policy/`

When such a PR is encountered:

1. The auditor records a `REVIEW_DECLINED` fact event with reason `self-amendment`.
2. The auditor posts a comment explaining the conflict.
3. A **different** reviewer role (e.g., `architecture-reviewer` or human repo-owner) must approve.

This constraint is absolute. There is no override path for the auditor
to approve its own governance changes.

---

## Review Checklist

When reviewing a PR, the auditor checks:

| # | Check | Pass Condition |
|---|-------|---------------|
| 1 | Constitution sections present | All 5 required sections exist in both constitution files |
| 2 | No rule relaxation | Proposed changes do not weaken any existing rule |
| 3 | No self-expansion | Worker `allowedFiles` are not broadened by the diff |
| 4 | Policy file integrity | `.github/ai-policy/**` is unmodified or change has human approval |
| 5 | Mirror sync | Docs mirror matches authoritative file headings |
| 6 | No self-approval | Auditor is not reviewing changes to its own role or constitution |

---

## Integration Points

```
PR opened (touches constitution or policy)
        |
        v
  constitution guard (structural check)
        |
        v
  boundary guard (allowedFiles check)
        |
        v
  constitution auditor review    ◄── this role
        |
   approve / request-changes
        |
        v
  merge gate
```

| Consumer | How It Uses the Auditor |
|----------|------------------------|
| Merge gate | Blocks merge until auditor approves (when constitution files changed) |
| Orchestrator | Assigns auditor role to PRs with `constitution` label |
| Fact event ledger | Records audit decisions for traceability |
| Planning loop | Surfaces unresolved audit findings as gap ledger entries |

---

## Escalation Path

If the auditor cannot complete a review (conflict of interest, missing
context, or self-amendment scenario):

1. Post a comment describing the blocker.
2. Tag the `architecture-reviewer` or `repo-owner` role.
3. Record a `REVIEW_ESCALATED` fact event.

The auditor does not merge, approve, or override when escalated. It
hands off entirely.

---

## References

- [seed-constitution.md](seed-constitution.md) — Immutable rules this role enforces.
- [constitution-guard.md](constitution-guard.md) — Structural validation of constitution files.
- [roles.md](roles.md) — Role index.
- [boundary guard](../../scripts/guards/check-task-boundary.js) — Pre-merge allowedFiles enforcement.
- [external-reality-intake.md](external-reality-intake.md) — Evidence intake and classification.
- [agent-idea-review-gate.md](agent-idea-review-gate.md) — Idea promotion gate.
