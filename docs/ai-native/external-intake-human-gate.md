# External Intake Human Gate

Defines which external-intake ideas must stop for human review before
promotion to tasks. Sits between the agent idea review gate and issue
creation — every idea that matches a human-gate boundary is blocked
until a human explicitly approves.

> **Closes:** [#984](https://github.com/taoyu051818-sys/lian-nest-server/issues/984)
>
> **Cross-references:**
> [external-intake-executable-loop.md](external-intake-executable-loop.md) for
> the full intake pipeline,
> [external-reality-intake.md](external-reality-intake.md) for evidence
> classification and reliability tiers,
> [agent-idea-review-gate.md](agent-idea-review-gate.md) for idea
> promotion criteria,
> [seed-constitution.md](seed-constitution.md) for immutable boundaries.

---

## Purpose

The external intake pipeline classifies, scores, and routes external
evidence into opportunity signals, risk signals, or runtime signals.
Most signals can flow through the automated pipeline. Some categories
carry enough blast radius or ambiguity that an automated gate is
insufficient — a human must review before the idea becomes a task.

This document defines those categories.

---

## Human-Gate Boundaries

An idea candidate MUST stop for human review when it matches **any** of
the following boundaries.

### 1. High-Risk Changes

Ideas that touch irreversible or high-blast-radius operations.

| Boundary | Why | Examples |
|----------|-----|----------|
| Deleting or rotating secrets, tokens, or credentials | Irreversible exposure risk | Rotate API key, remove `.env` entry |
| Modifying `.env`, `.env.*`, or CI/CD pipeline definitions | Production blast radius | Change deploy target, alter workflow triggers |
| Changing Prisma schema or running migrations | Data integrity | Add column, rename table, drop index |
| Force-pushing to `main` or protected branches | History loss | Rebase main, reset hard |
| Modifying `package.json` dependencies | Supply chain risk | Add new dependency, upgrade major version |
| Altering seed constitution or `.github/ai-policy/**` | Policy integrity | Edit constitution rules, change intake policy |

**Gate code:** `HIGH_RISK`

**Override:** Requires a `repo-owner` comment with documented justification.

---

### 2. Policy Changes

Ideas that modify the rules governing how the control plane operates.

| Boundary | Why | Examples |
|----------|-----|----------|
| Changing launch gate, health gate, or batch launcher scripts | Control-plane integrity | Modify `check-launch-gate.ps1`, alter health thresholds |
| Modifying role definitions or authorization rules | Access control | Edit `roles.md`, change permission boundaries |
| Altering intake classification or reliability tiers | Evidence integrity | Change source class rules, adjust tier weights |
| Changing conflict group or parallelism policies | Concurrency safety | Modify lock rules, adjust batch limits |

**Gate code:** `POLICY_CHANGE`

**Override:** Requires a `repo-owner` comment explaining the policy rationale.

---

### 3. Auth / DB / Security Scope

Ideas that touch authentication, authorization, database access, or
security-sensitive code paths.

| Boundary | Why | Examples |
|----------|-----|----------|
| Auth module changes (`src/modules/auth/**`) | Authentication bypass risk | Modify login flow, change token validation |
| Authorization guard or middleware changes | Access control bypass | Edit `RolesGuard`, modify permission checks |
| Database query or schema changes outside migrations | Data integrity | Raw SQL, ORM query modifications |
| Security-sensitive API endpoints | Injection or exposure risk | Change input validation, alter CORS policy |
| Dependency version changes in security-critical packages | Vulnerability surface | Upgrade `passport`, `bcrypt`, `jsonwebtoken` |

**Gate code:** `AUTH_DB_SECURITY`

**Override:** Requires a `repo-owner` comment with security review acknowledgment.

---

### 4. Broad Product Direction

Ideas that shift the product's scope, architecture, or user-facing
behavior beyond a single bounded task.

| Boundary | Why | Examples |
|----------|-----|----------|
| New module or domain boundary creation | Architectural commitment | Create `src/modules/payments/**`, add new Prisma model group |
| Cross-module refactoring | Blast radius across boundaries | Rename shared types, move utilities between modules |
| User-facing behavior changes without explicit issue | Product direction | Alter API response format, change pagination semantics |
| Ideas with `allowedFiles` broader than `src/modules/<name>/**` | Scope too broad for single worker | `src/**`, multiple module directories |
| Ideas combining feature work with refactoring or migration | Mixed concerns | Feature + refactor in same task |

**Gate code:** `BROAD_DIRECTION`

**Override:** Requires a `repo-owner` comment confirming product intent.

---

## Gate Evaluation

When the agent idea review gate evaluates a candidate, it checks the
human-gate boundaries **after** the standard five criteria pass. The
human gate is additive — a candidate that fails the idea review gate
never reaches the human gate.

```
idea candidate
      |
      v
agent idea review gate (5 criteria)
      |
  promote? ──no──> block/defer/reject
      |
     yes
      |
      v
┌─────────────────────────┐
│  external intake human  │  ◄── this document
│  gate                   │
│                         │
│  - high-risk check      │
│  - policy change check  │
│  - auth/db/security     │
│  - broad direction      │
└───────────┬─────────────┘
      |
   ┌──┴──┐
   v     v
pass   blocked
   |      |
   v      v
issue  human review
create  required
```

### Evaluation Order

Check boundaries in order. Stop on first match.

1. **High-Risk** — does the idea touch any high-risk file or operation?
2. **Policy Change** — does the idea modify control-plane rules?
3. **Auth / DB / Security** — does the idea touch security-sensitive scope?
4. **Broad Direction** — does the idea exceed single-task boundaries?

### Gate Result

When a boundary matches, the gate produces a block result with the gate
code:

```json
{
  "schemaVersion": 1,
  "gateType": "human-gate",
  "decision": "block",
  "severity": "warning",
  "markerId": "hg-<hash>",
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "targetIssue": null,
  "targetPR": null,
  "factsRead": [],
  "blockers": [
    {
      "code": "AUTH_DB_SECURITY",
      "message": "Idea touches src/modules/auth/** — requires human review."
    }
  ],
  "warnings": [],
  "producedFacts": [
    { "key": "human-gate-boundary", "value": "AUTH_DB_SECURITY" }
  ]
}
```

---

## Override Protocol

A `repo-owner` can override any human-gate block. Override requires:

1. A comment on the issue with the gate code and justification.
2. The comment actor must be in `roles.md` for the `repo-owner` role.
3. The override is recorded as a fact event:

```json
{
  "eventType": "evidence.promoted",
  "subject": "human-gate override for issue #N",
  "facts": {
    "gateCode": "AUTH_DB_SECURITY",
    "overrideJustification": "Human-supplied reason",
    "overriddenBy": "actor-handle"
  }
}
```

---

## Integration with Intake Pipeline

```
external evidence
      |
      v
classify + score + sanitize
      |
      v
fact event recorded
      |
      v
signal routed (opportunity / risk / runtime)
      |
      v
agent idea review gate
      |
      v
external intake human gate  ◄── this document
      |
      v
issue created (or blocked for human review)
```

The human gate does not replace the agent idea review gate — it extends
it. Ideas that match a human-gate boundary are blocked regardless of how
well they score on the standard criteria.

---

## References

- [External Intake Executable Loop](external-intake-executable-loop.md) — Full intake pipeline
- [External Reality Intake](external-reality-intake.md) — Evidence classification and tiers
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Idea promotion criteria
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
- [External Intake Policy](../.github/ai-policy/external-intake-policy.json) — Machine-readable policy
- [Main Health Policy](main-health-policy.md) — Health states and worker permissions
- [Launch Gate](launch-gate.md) — Pre-launch validation
