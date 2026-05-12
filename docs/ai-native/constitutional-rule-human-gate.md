# Constitutional Rule Human Gate

Defines the boundary where the Constitution Steward must stop and request
human approval. The Steward audits prompts, policies, schemas, docs, and
workflows against Reality, Selection, and Governed Recursion — but it
cannot self-approve constitutional changes.

> **Closes:** [#1074](https://github.com/taoyu051818-sys/lian-nest-server/issues/1074)
>
> **Cross-references:**
> [seed-constitution.md](seed-constitution.md) for immutable boundaries,
> [constitution-guard.md](constitution-guard.md) for pre-flight validation,
> [external-intake-human-gate.md](external-intake-human-gate.md) for intake
> human gate.

---

## Purpose

The Constitution Steward layer audits the control plane against three
laws: Reality, Selection, and Governed Recursion. It may propose
amendments to prompts, policies, schemas, docs, and workflows — but it
**cannot self-approve** those amendments. This document defines the gate
that enforces that boundary.

The gate ensures that:

1. Constitutional changes always pass through a human decision point.
2. The Steward's audit output is structured for human review.
3. No automation can relax, override, or bypass the gate.

---

## Three Laws

The Constitution Steward evaluates all control-plane artifacts against
three laws. Understanding these laws is necessary to understand what
the gate protects.

### Law 1: Reality

Artifacts must describe what exists, not what is wished to exist.
Claims about system behavior must be verifiable against actual code,
configuration, or runtime state. The Steward flags aspirational
statements that lack evidence.

### Law 2: Selection

Not all valid changes are worth making. The Steward evaluates whether
a proposed change improves the control plane's fitness for purpose.
Selection considers blast radius, reversibility, and alignment with
current wave priorities.

### Law 3: Governed Recursion

The Steward may audit its own outputs and propose changes to its own
governance rules — but those proposals require the same human gate as
any other constitutional change. No self-approval loop is permitted.

---

## Gate Boundaries

The Constitution Steward MUST stop for human review when its output
matches **any** of the following boundaries.

### 1. Seed Constitution Amendment

Proposals to modify the seed constitution at
`.github/ai-policy/seed-constitution.md` or its docs mirror.

| Boundary | Why |
|----------|-----|
| Adding or removing a constitution section | Alters fundamental guardrails |
| Changing high-risk boundary definitions | Expands or contracts human-required scope |
| Modifying the amendment process itself | Self-expansion guard |

**Gate code:** `CONSTITUTION_AMENDMENT`

**Override:** None. Seed constitution changes require `architecture-review`
and `repo-owner` approval per the amendment process.

---

### 2. Policy File Changes

Proposals to modify files under `.github/ai-policy/` that are not the
seed constitution.

| Boundary | Why |
|----------|-----|
| Changing intake classification rules | Evidence integrity |
| Modifying launch gate or health gate policies | Control-plane integrity |
| Altering role definitions or authorization rules | Access control |
| Changing conflict group or parallelism policies | Concurrency safety |

**Gate code:** `POLICY_CHANGE`

**Override:** Requires a `repo-owner` comment with documented rationale.

---

### 3. Guard Script Changes

Proposals to modify guard scripts under `scripts/guards/`.

| Boundary | Why |
|----------|-----|
| Changing boundary guard logic | Enforcement integrity |
| Modifying constitution guard checks | Constitution integrity |
| Altering docs authority guard rules | Docs consistency |
| Changing generated code guard behavior | Prisma freshness |

**Gate code:** `GUARD_SCRIPT_CHANGE`

**Override:** Requires a `repo-owner` comment with test evidence.

---

### 4. Worker Contract Schema Changes

Proposals to modify the worker task contract schema or its documentation.

| Boundary | Why |
|----------|-----|
| Adding or removing required task JSON fields | Worker compatibility |
| Changing `allowedFiles` or `forbiddenFiles` semantics | Boundary integrity |
| Modifying budget or straggler policy fields | Worker lifecycle |
| Altering role packet or review acceptance definitions | Review integrity |

**Gate code:** `CONTRACT_SCHEMA_CHANGE`

**Override:** Requires a `repo-owner` comment confirming backward
compatibility or migration plan.

---

### 5. Governed Recursion Self-Modification

Proposals where the Steward modifies its own audit rules, gate
definitions, or evaluation criteria.

| Boundary | Why |
|----------|-----|
| Changing what the Steward audits | Audit scope integrity |
| Modifying gate boundary definitions | Gate integrity |
| Altering the three laws or their interpretation | Constitutional integrity |
| Adding new self-approval paths | Self-expansion guard |

**Gate code:** `SELF_MODIFICATION`

**Override:** None. Self-modification of governance rules is always
human-required.

---

## Gate Evaluation

When the Constitution Steward produces an audit result that includes a
proposed amendment, the gate evaluates the proposal against the
boundaries above.

```
Constitution Steward audit
      |
      v
amendment proposed?
      |
  ┌───┴───┐
  no     yes
  |       |
  v       v
pass   constitutional rule human gate
         |
      ┌──┴──┐
      v     v
    pass   blocked
      |      |
      v      v
   apply   human review
            required
```

### Evaluation Order

Check boundaries in order. Stop on first match.

1. **Seed Constitution Amendment** — does the proposal touch the
   seed constitution?
2. **Policy File Changes** — does the proposal modify `.github/ai-policy/`?
3. **Guard Script Changes** — does the proposal modify `scripts/guards/`?
4. **Worker Contract Schema Changes** — does the proposal modify the
   task contract?
5. **Governed Recursion Self-Modification** — does the proposal modify
   the Steward's own rules?

### Gate Result

When a boundary matches, the gate produces a block result:

```json
{
  "schemaVersion": 1,
  "gateType": "constitutional-rule-human-gate",
  "decision": "block",
  "severity": "warning",
  "markerId": "crhg-<hash>",
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "targetIssue": null,
  "targetPR": null,
  "factsRead": [],
  "blockers": [
    {
      "code": "CONSTITUTION_AMENDMENT",
      "message": "Proposal modifies seed-constitution.md — requires human approval."
    }
  ],
  "warnings": [],
  "producedFacts": [
    { "key": "constitutional-rule-human-gate", "value": "CONSTITUTION_AMENDMENT" }
  ]
}
```

---

## Non-Goals

The following are explicitly **not** within this gate's scope:

1. **Auditing worker diffs.** The boundary guard handles file-level
   enforcement. This gate only applies to constitutional-level changes.
2. **Blocking the Steward from auditing.** The Steward may always audit.
   It is the *approval* of changes that requires the gate.
3. **Evaluating non-constitutional docs.** Regular docs changes under
   `docs/ai-native/` that do not touch governance rules flow through
   the normal PR review process.
4. **Replacing the seed constitution amendment process.** This gate is
   additive. The amendment process in seed-constitution.md remains
   authoritative.

---

## Inputs

The gate consumes:

| Input | Source | Format |
|-------|--------|--------|
| Amendment proposal | Constitution Steward audit output | Structured proposal with target file, change description, and rationale |
| Target file path | Proposal metadata | Glob or exact path |
| Gate boundary definitions | This document | Human-authored policy |

---

## Outputs

The gate produces:

| Output | Format | Consumer |
|--------|--------|----------|
| Gate result (pass/block) | JSON marker | PR review, orchestration |
| Block reason | Gate code + message | Human reviewer |
| Fact event | JSON fact event | Fact event ledger |

---

## Rollback and Escape Hatch

### Rollback

If a constitutional change is merged and later found to be incorrect:

1. Revert the PR that introduced the change.
2. Re-run the constitution guard to verify integrity.
3. Open an issue documenting the rollback reason.

### Escape Hatch

There is no escape hatch for this gate. The Steward cannot self-approve
constitutional changes. This is a deliberate design constraint from the
Governed Recursion law.

If the Steward identifies an urgent constitutional fix (e.g., a broken
gate that blocks all workers), it must:

1. Comment on the relevant issue with the gate code and urgency.
2. Tag `repo-owner` for expedited review.
3. Wait for human approval before applying the fix.

---

## Integration with Constitution Steward

The Constitution Steward's audit workflow includes this gate as a
mandatory checkpoint:

```
Constitution Steward receives audit target
      |
      v
audit against Reality, Selection, Governed Recursion
      |
      v
amendments proposed?
      |
  ┌───┴───┐
  no     yes
  |       |
  v       v
log    constitutional rule human gate
audit     |
result  ┌─┴─┐
        v   v
      pass  block
        |     |
        v     v
     apply  human review
             required
```

The Steward logs all audit results regardless of gate outcome. Blocked
proposals remain in the audit log with their gate code for human
follow-up.

---

## References

- [Seed Constitution](seed-constitution.md) — Immutable boundaries and
  amendment process.
- [Constitution Guard](constitution-guard.md) — Pre-flight validation
  of constitution integrity.
- [External Intake Human Gate](external-intake-human-gate.md) — Human
  gate for external intake proposals.
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
  that this gate protects.
- [Launch Gate](launch-gate.md) — Pre-launch validation.
