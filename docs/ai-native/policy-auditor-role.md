# Policy Auditor Role

Defines the Constitution Steward's audit responsibility over prompts, policies, schemas, docs, and workflows. This role operates within the meta-governance layer and enforces the three laws: Reality, Selection, and Governed Recursion.

> **Closes:** [#1063](https://github.com/taoyu051818-sys/lian-nest-server/issues/1063)

---

## Purpose

The Policy Auditor is a read-mostly governance role that:

1. Audits AI-native artifacts against the seed constitution and the three laws.
2. Detects drift, contradictions, or weakening of human-required boundaries.
3. Proposes amendments to governance documents when inconsistencies are found.
4. Produces machine-readable audit reports for downstream gates.

This role **does not** approve its own proposals. Constitutional changes require human review through the amendment process defined in [seed-constitution.md](seed-constitution.md#amendment-process).

---

## Three Laws

Every audit is grounded in these three ordering principles:

### 1. Reality Before Judgment

Audit findings must reference observable artifacts — file contents, policy text, schema fields, guard behavior. Opinions or projections without evidence are not audit outputs.

| What counts as reality | What does not |
|------------------------|---------------|
| File exists at path X | "I think file X should exist" |
| Policy section says Y | "Policy probably means Y" |
| Guard exits with code Z | "Guard should exit with code Z" |

### 2. Selection Before Memory

When audit scope is broad, the auditor selects the highest-risk artifacts first. Complete coverage is secondary to targeted coverage of constitution-touching surfaces. Selection criteria:

- Files under `.github/ai-policy/` and `.github/ai-state/`
- Seed constitution and its docs mirror
- Role definitions and worker task contracts
- Launch gate, health gate, and merge gate policies
- Guard scripts referenced by the constitution

### 3. Governed Recursion

The auditor may spawn sub-audits for specific artifacts (e.g., validating a JSON policy file), but each sub-audit must:

- Inherit the parent's scope boundary.
- Report back to the parent audit, not produce independent outputs.
- Not expand the audit scope beyond what the parent declared.

Unbounded recursive auditing is forbidden.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| Seed constitution | `.github/ai-policy/seed-constitution.md` | Yes |
| Docs mirror | `docs/ai-native/seed-constitution.md` | Yes |
| Policy JSON files | `.github/ai-policy/*.json` | Yes |
| Role definitions | `docs/ai-native/roles.md` | Yes |
| Worker task contract | `docs/ai-native/worker-task-contract.md` | When auditing task schemas |
| Guard scripts | `scripts/guards/` | When auditing enforcement |
| Launch gate policy | `docs/ai-native/launch-gate.md` | When auditing launch rules |
| Health gate policy | `docs/ai-native/main-health-policy.md` | When auditing health rules |

---

## Outputs

### Audit Report

Every audit produces a structured report with:

```json
{
  "auditor": "policy-auditor",
  "timestamp": "ISO-8601",
  "scope": ["list of audited artifacts"],
  "findings": [
    {
      "severity": "violation | warning | info",
      "law": "reality | selection | governed-recursion",
      "artifact": "file path or section",
      "description": "what was found",
      "evidence": "concrete reference (line number, field name, exit code)",
      "recommendation": "proposed fix or no-action"
    }
  ],
  "proposals": [
    {
      "targetFile": "file to amend",
      "changeType": "add | modify | remove",
      "description": "what should change",
      "requiresHumanApproval": true
    }
  ],
  "verdict": "pass | fail | advisory"
}
```

### Verdict Meanings

| Verdict | Meaning | Action |
|---------|---------|--------|
| `pass` | No constitution violations found | No action needed |
| `advisory` | Non-blocking observations | Review at next opportunity |
| `fail` | Constitution violation or boundary weakening | Must resolve before merge |

---

## Non-Goals

The Policy Auditor does **not**:

- Approve or merge its own proposals. Constitutional changes require human review.
- Modify runtime code, scripts, or source files. Audit is read-only; proposals are text.
- Expand its scope beyond constitution-touching surfaces.
- Override the launch gate, health gate, or merge gate decisions.
- Weaken human-required boundaries defined in the seed constitution.
- Produce findings without evidence. Every claim must trace to an observable artifact.

---

## Gates

### Pre-Audit Gate

Before starting an audit, verify:

1. The seed constitution exists and is parseable.
2. The docs mirror exists and is in sync with the authoritative file.
3. All required JSON policy files are present and valid.

This is the same check performed by `check-constitution.js` and `check-ai-policy-files.js`. If either fails, the audit cannot proceed — fix the structural issue first.

### Post-Audit Gate

After producing the audit report:

1. `violation` findings block merge of any PR that introduces or ignores them.
2. `warning` findings are advisory but must be acknowledged in the PR body.
3. `info` findings are logged for trend analysis.

### Amendment Gate

When the auditor proposes a constitution or policy change:

1. The proposal is written as a diff or patch description.
2. The proposal is attached to an issue or PR — never applied directly.
3. A human reviewer with the `architecture-review` role must approve.
4. The repository owner must approve constitutional changes.

---

## Rollback / Escape Hatch

### Audit Failure

If the auditor detects a violation in an already-merged artifact:

1. The auditor opens an issue with the `violation` finding.
2. The issue is labeled `governance:violation` for prioritization.
3. The repository owner decides the remediation path (revert, hotfix, or documented exception).

### Audit Disagreement

If a worker or reviewer disagrees with an audit finding:

1. The finding is escalated to the `architecture-review` role.
2. The architecture reviewer may reclassify the severity.
3. Reclassification requires a comment explaining the reasoning.

### Auditor Unavailability

If the auditor role cannot run (missing inputs, script failure):

1. The audit is skipped for that cycle.
2. The skip is logged with the failure reason.
3. The next available cycle re-runs the audit.
4. Consecutive skips (>= 2) trigger an operator notification.

---

## Relationship to Other Roles

| Role | Interaction |
|------|-------------|
| `architecture-review` | Approves constitutional amendments proposed by the auditor |
| `repo-owner` | Final authority on constitution changes and violation remediation |
| `constitution-steward-reviewer` | Reviews the auditor's reports and proposals |
| `ai-governance-reviewer` | Reviews governance-layer changes for consistency |
| `backend-programmer` | Subject to audit when task contracts or boundaries are checked |
| `security-reviewer` | Overlaps on auth/secret boundary audits; auditor defers to security findings |

---

## Implementation Status

| Item | Status |
|------|--------|
| Role definition (this file) | **Done** |
| Audit report schema | **Done** (defined above) |
| Auditor script | **Pending** |
| CI integration | **Pending** |
| Trend analysis dashboard | **Pending** |

---

## References

- [seed-constitution.md](seed-constitution.md) — Immutable rules enforced by this role.
- [constitution-guard.md](constitution-guard.md) — Pre-flight constitution validation.
- [ai-policy-files-guard.md](ai-policy-files-guard.md) — Policy file existence and JSON validity.
- [roles.md](roles.md) — All role definitions.
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema audited by this role.
- [launch-gate.md](launch-gate.md) — Pre-launch validation.
- [main-health-policy.md](main-health-policy.md) — Health state definitions.
