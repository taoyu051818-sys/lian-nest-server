# Constitution Checker Contract

Defines the bounded contract for the Constitution Steward layer's
checking responsibilities. The constitution checker audits prompts,
policies, schemas, docs, and workflows against the three governance
laws. It may propose amendments but cannot self-approve constitutional
changes.

> **Closes:** [#1068](https://github.com/taoyu051818-sys/lian-nest-server/issues/1068)
>
> **Cross-references:**
> [constitution-guard.md](constitution-guard.md) for the structural
> seed-constitution validator,
> [seed-constitution.md](seed-constitution.md) for the immutable
> boundaries,
> [worker-task-contract.md](worker-task-contract.md) for the task JSON
> schema,
> [loop-model.md](loop-model.md) for the automated loop lifecycle.

---

## Audience

Constitution stewards, orchestrators, and architects who need to
understand what the constitution checker validates, how it produces
verdicts, and where its authority ends.

---

## Purpose

The constitution checker is a meta-governance component that:

1. Validates that artifacts (docs, policies, schemas, workflows, task
   JSON) comply with the seed constitution and the three laws.
2. Emits machine-readable verdicts for integration into the gate stack.
3. Proposes amendments when drift is detected, but **never**
   self-approves them.

---

## Three Laws

Every check runs against these governance laws. A violation of any law
is a hard fail.

### Law 1: Reality Before Judgment

The checker must observe actual file state before forming a verdict. It
reads authoritative sources on disk — not cached assumptions, not
planned states, not human intent expressed in chat. If the file says X,
the verdict is based on X.

| Principle | Implication |
|-----------|-------------|
| Read before judging | No verdict without reading the target file |
| Trust on-disk state | Git HEAD is the source of truth, not task JSON claims |
| No phantom checks | A check against a non-existent file is a violation, not a pass |

### Law 2: Selection Before Memory

The checker selects which artifacts to audit based on the current task
scope and conflict group. It does not carry forward verdicts from prior
runs or assume compliance from historical data.

| Principle | Implication |
|-----------|-------------|
| Scope-driven | Only audit artifacts reachable from the current `allowedFiles` |
| No inherited compliance | A passing verdict from wave N does not apply to wave N+1 |
| Explicit selection | Every audited file must be listed in the check manifest |

### Law 3: Governed Recursion

The checker may call sub-checks (e.g., `check-constitution.js`,
`check-task-boundary.js`) but each sub-check must be bounded, declared,
and independently auditable. The checker must not spawn unbounded
recursive validation.

| Principle | Implication |
|-----------|-------------|
| Declared sub-checks | Every sub-check is listed in the checker manifest |
| Bounded depth | Maximum recursion depth: 2 (checker → sub-check → file read) |
| No self-amendment | The checker cannot modify its own rules or the constitution |

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| Seed constitution (authoritative) | `.github/ai-policy/seed-constitution.md` | Yes |
| Seed constitution (docs mirror) | `docs/ai-native/seed-constitution.md` | Yes |
| Task JSON | `tasks/issue-<N>.json` | For task-scoped checks |
| PR diff | `git diff main...HEAD` | For diff-scoped checks |
| Checker manifest | Inline or config file | Declares sub-checks and scope |

---

## Outputs

### Verdict Schema

```json
{
  "status": "pass | fail | warn",
  "laws": {
    "reality": { "pass": true, "message": "..." },
    "selection": { "pass": true, "message": "..." },
    "governedRecursion": { "pass": true, "message": "..." }
  },
  "checks": [
    {
      "name": "constitution-structure",
      "pass": true,
      "message": "...",
      "law": "reality"
    }
  ],
  "violations": [],
  "warnings": [],
  "proposals": []
}
```

### Proposal Schema

When drift is detected, the checker emits a proposal (not an action):

```json
{
  "type": "amendment-proposal",
  "target": "docs/ai-native/seed-constitution.md",
  "section": "High-Risk Human-Required Boundaries",
  "description": "Section heading mismatch between authoritative and mirror",
  "current": "...",
  "proposed": "...",
  "requiresHumanApproval": true
}
```

---

## Non-Goals

The constitution checker explicitly does **not**:

1. **Enforce constitution rules on worker diffs.** That is the boundary
   guard's job (`check-task-boundary.js`).
2. **Self-approve constitutional changes.** All proposals require a
   human-authored PR reviewed by `architecture-review`.
3. **Modify runtime code.** The checker is read-only against source
   files.
4. **Broaden worker scope.** The checker cannot expand `allowedFiles`
   or weaken forbidden boundaries.
5. **Persist verdicts across waves.** Each check run is independent
   (Law 2).

---

## Gates

### Pre-Check Gate

Before running, the checker validates its own inputs:

| Gate | Condition | Failure Behavior |
|------|-----------|-----------------|
| Constitution exists | Both authoritative and mirror files present | Hard fail — abort check |
| Constitution intact | Both files contain all 5 required sections | Hard fail — abort check |
| Section sync | Headings match between authoritative and mirror | Warn — continue with warning |

### Post-Check Gate

After running, the checker's verdict integrates into the gate stack:

| Verdict | Gate Behavior |
|---------|---------------|
| `pass` | Proceed to next gate |
| `warn` | Proceed with logged warning; reviewer sees warning in PR |
| `fail` | Block merge; violation details in verdict JSON |

---

## Sub-Checks

The checker delegates to these bounded sub-checks:

| Sub-Check | Script | Purpose | Law |
|-----------|--------|---------|-----|
| Constitution structure | `check-constitution.js` | Validates file presence and section integrity | Reality |
| Task boundary | `check-task-boundary.js` | Validates worker diffs against `allowedFiles` | Selection |
| AI policy files | `check-ai-policy-files.js` | Validates `.github/ai-policy/` integrity | Reality |
| AI state files | `check-ai-state-files.js` | Validates `.github/ai-state/` structure | Reality |
| Docs authority | `check-docs-authority.js` | Validates docs mirror sync | Reality |

Each sub-check is invoked at most once per run. The checker does not
re-invoke a sub-check on failure.

---

## Rollback and Escape Hatches

### Checker Failure

If the checker itself fails (crash, timeout, unhandled error):

1. The verdict is treated as `fail` (safe default).
2. The merge is blocked.
3. A human must investigate the checker failure before proceeding.

### False Positive

If a checker `fail` verdict is determined to be a false positive:

1. The human reviewer may override by approving the PR with a comment
   explaining the override.
2. The override is logged in the PR review thread.
3. The checker does not learn from overrides (Law 2 — no inherited
   compliance).

### Constitution Drift

If the checker detects drift between authoritative and mirror:

1. A proposal is emitted (not auto-applied).
2. The PR is not blocked for drift alone (warning, not violation).
3. A human must create a follow-up PR to resolve the drift.

---

## Integration

The constitution checker is designed to be called from CI or the
self-cycle orchestrator. It has no external dependencies beyond the
sub-check scripts.

```
self-cycle runner
        │
        ▼
  constitution checker    ◄── this document
        │
        ├── check-constitution.js
        ├── check-task-boundary.js
        ├── check-ai-policy-files.js
        ├── check-ai-state-files.js
        └── check-docs-authority.js
        │
        ▼
  verdict (pass / warn / fail)
        │
        ▼
  gate stack
```

---

## Key Files

| Path | Purpose |
|------|---------|
| `.github/ai-policy/seed-constitution.md` | Authoritative constitution |
| `docs/ai-native/seed-constitution.md` | Docs mirror |
| `scripts/guards/check-constitution.js` | Structural validator |
| `scripts/guards/check-task-boundary.js` | Diff boundary validator |

---

## References

- [Constitution Guard](constitution-guard.md) — Structural seed-constitution validator
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Loop Model](loop-model.md) — Automated loop lifecycle
- [Controlled Auto-Merge](controlled-auto-merge.md) — Batch merge safety
- [Self-Cycle Runner](self-cycle-runner.md) — Top-level orchestrator
