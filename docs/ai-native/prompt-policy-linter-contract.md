# Prompt Policy Linter Contract

Defines how the Constitution Steward layer audits prompts, policies,
schemas, docs, and workflows against the three foundational laws.

> **Closes:** [#1069](https://github.com/taoyu051818-sys/lian-nest-server/issues/1069)
>
> **Cross-references:**
> [seed-constitution.md](seed-constitution.md) for immutable rules,
> [constitution-guard.md](constitution-guard.md) for structural
> validation,
> [ai-policy-files-guard.md](ai-policy-files-guard.md) for policy
> file presence checks,
> [worker-task-contract.md](worker-task-contract.md) for task JSON
> schema.

---

## Audience

Constitution stewards, orchestrators, and architects who need to verify
that prompts, policies, schemas, docs, and workflows conform to the
three foundational laws before they enter the control plane.

---

## Overview

The prompt policy linter is a meta-governance tool. It audits artifacts
against three laws and produces a machine-readable verdict. It may
propose amendments but **cannot self-approve** constitutional changes.

```
  artifact (prompt, policy, schema, doc, workflow)
          │
          ▼
  ┌───────────────────────────┐
  │  prompt policy linter     │ ◄── this document
  │                           │
  │  1. Reality check         │
  │  2. Selection check       │
  │  3. Governed Recursion    │
  └──────────┬────────────────┘
             │
             ▼
       verdict (pass | warn | fail)
             │
             ▼
       proposal (if amendment needed)
             │
             ▼
       human review gate
```

---

## The Three Laws

### 1. Reality

Artifacts must describe the system as it is, not as it was or as
someone hopes it will be.

| Check | What It Verifies |
|-------|-----------------|
| Stale references | File paths, script names, and URLs that no longer exist |
| Phantom features | Claims about capabilities not present in the codebase |
| Drift from source-of-truth | Policy statements that contradict the seed constitution or authoritative schemas |
| Undocumented assumptions | Implicit dependencies not declared in `knowledgeRefs` or `sourceOfTruthDocs` |

### 2. Selection

Artifacts must choose the smallest viable scope. Overbroad policies,
catch-all globs, and blanket permissions violate selection.

| Check | What It Verifies |
|-------|-----------------|
| Scope breadth | `allowedFiles` globs wider than necessary (e.g., `**` or `*`) |
| Blanket permissions | Policies that grant universal access without category restriction |
| Redundant overlap | Multiple policies governing the same artifact with conflicting rules |
| Missing exclusion | `forbiddenFiles` omitting standard high-risk patterns |

### 3. Governed Recursion

Any process that modifies governance artifacts must itself be governed.
No linter, worker, or orchestrator may expand its own authority.

| Check | What It Verifies |
|-------|-----------------|
| Self-expansion | Scripts or policies that modify their own permissions or scope |
| Unbounded delegation | Chains of authority with no terminal human gate |
| Amendment without review | Changes to seed constitution, policy files, or guard scripts without required review roles |
| Recursive loops | Workflows that trigger themselves without a termination condition |

---

## Input

The linter accepts one or more artifacts to audit.

### Artifact Types

| Type | Examples | Source |
|------|----------|--------|
| Prompt | Role prompts in `ops/agent-prompts/` | Worker prompt templates |
| Policy | JSON files in `.github/ai-policy/` | Policy-as-code directory |
| Schema | Task JSON, manifest JSON, signal JSON | Control-plane schemas |
| Doc | Markdown in `docs/ai-native/` | Process documentation |
| Workflow | Scripts in `scripts/ai/`, `scripts/guards/` | Orchestration scripts |

### Required Metadata

Each artifact must provide:

| Field | Description |
|-------|-------------|
| `artifactType` | One of: `prompt`, `policy`, `schema`, `doc`, `workflow` |
| `artifactPath` | Relative path from repo root |
| `lastModifiedCommit` | Git SHA of last change (for staleness checks) |

---

## Output

The linter emits a verdict and optional proposal.

### Verdict Schema

```json
{
  "status": "pass | warn | fail",
  "artifactPath": "docs/ai-native/example.md",
  "checks": [
    {
      "law": "reality | selection | governed-recursion",
      "name": "check-name",
      "pass": true,
      "message": "human-readable description",
      "severity": "info | warn | fail"
    }
  ],
  "violations": [
    {
      "law": "reality",
      "check": "stale-references",
      "message": "references non-existent file scripts/old-script.ps1",
      "location": "line 42"
    }
  ],
  "warnings": [
    {
      "law": "selection",
      "check": "scope-breadth",
      "message": "allowedFiles uses ** glob; consider narrowing"
    }
  ],
  "summary": {
    "realityChecks": 4,
    "selectionChecks": 3,
    "governedRecursionChecks": 3,
    "violationCount": 0,
    "warningCount": 0,
    "mode": "enforce"
  }
}
```

### Status Values

| Status | Meaning |
|--------|---------|
| `pass` | All checks passed; artifact conforms to the three laws |
| `warn` | Non-blocking issues found; artifact may proceed with review |
| `fail` | Blocking violations found; artifact must be corrected |

### Amendment Proposals

When a violation requires a constitutional change, the linter emits a
proposal alongside the verdict:

```json
{
  "proposalType": "amendment",
  "targetFile": ".github/ai-policy/seed-constitution.md",
  "currentText": "...",
  "proposedText": "...",
  "reason": "reality check: policy references deprecated script",
  "requiredReviewRoles": ["architecture-review"],
  "cannotSelfApprove": true
}
```

The proposal is **always** a suggestion. It requires human-authored PR
review per the seed constitution amendment process.

---

## Non-Goals

The prompt policy linter does **not**:

1. **Enforce runtime behavior.** It audits static artifacts, not live
   worker execution. Runtime enforcement is the boundary guard's job.
2. **Replace the constitution guard.** The constitution guard validates
   structural integrity of the seed constitution. The linter validates
   semantic conformance to the three laws.
3. **Auto-fix violations.** The linter reports and proposes; it does not
   modify artifacts. All fixes require human action.
4. **Audit external inputs.** External signals, API responses, and
   third-party data are outside scope. The external source trust
   scoring system handles those.
5. **Self-approve amendments.** The linter may propose changes to the
   seed constitution, policy files, or guard scripts, but it cannot
   approve them. This is a hard boundary.

---

## Gates

### Pre-Audit Gate

Before running, the linter verifies:

1. The artifact path exists and is readable.
2. The artifact type is recognized.
3. The seed constitution is present (required reference for reality
   checks).

If any prerequisite fails, the linter exits with code 2 and does not
emit a partial verdict.

### Verdict Gate

The verdict drives downstream behavior:

| Verdict | Downstream Action |
|---------|------------------|
| `pass` | Artifact proceeds to merge or deployment |
| `warn` | Artifact proceeds; warnings logged for review |
| `fail` | Artifact blocked; must be corrected before proceeding |

### Amendment Gate

Amendment proposals are subject to:

1. **Human review** — a human must author the PR (not automation).
2. **Architecture review role** — the `architecture-review` role must
   approve.
3. **Repository owner approval** — final authority rests with the owner.
4. **Dual-file update** — both the authoritative file and its docs
   mirror must be updated together.

---

## Rollback and Escape Hatches

### Rollback

If a linter change introduces false positives or blocks valid artifacts:

1. Revert the linter change via standard git revert.
2. Re-run the linter on the affected artifact to confirm the revert
   resolves the false positive.
3. No data migration is needed — the linter is stateless.

### Escape Hatch

When the linter blocks an artifact and the violation is a known false
positive or acceptable deviation:

1. The operator adds an explicit override comment in the artifact:
   `<!-- linter-override: <check-name> — <reason> — <date> -->`.
2. The linter skips overridden checks and logs the override as a
   warning.
3. Overrides expire after 30 days. Expired overrides are treated as
   violations.
4. Overrides on seed constitution or policy files require architecture
   review approval.

### Emergency Bypass

In emergencies where the linter itself is broken and blocking all
artifacts:

1. Run the linter with `--dry-run` to produce a verdict without
   enforcing the gate.
2. Fix the linter issue.
3. Re-run in enforce mode.

---

## Integration

The linter is designed to be called from:

| Consumer | When | Mode |
|----------|------|------|
| CI pipeline | On PR touching `docs/`, `.github/ai-policy/`, `ops/agent-prompts/` | Enforce |
| Constitution steward worker | During meta-governance audits | Report |
| Self-cycle runner | Pre-launch artifact validation | Enforce |
| Merge batch script | With `-RunGuards` flag | Enforce |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All checks passed |
| 1 | Violations found (fail verdict) |
| 2 | Prerequisite failure (missing artifact, missing constitution) |
| 3 | Warnings only (warn verdict, no violations) |

---

## References

- [Seed Constitution](seed-constitution.md) — Immutable rules audited by the linter
- [Constitution Guard](constitution-guard.md) — Structural validation of the seed constitution
- [AI Policy Files Guard](ai-policy-files-guard.md) — Policy file presence checks
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema audited by the linter
- [Launch Gate](launch-gate.md) — Pre-launch validation that consumes linter verdicts
- [Seed Constitution (authoritative)](../../.github/ai-policy/seed-constitution.md) — Source of truth
