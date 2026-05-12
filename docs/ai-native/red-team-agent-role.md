# Red Team Agent Role

Defines the Red Team Agent role for adversarial testing of the AI-native
control plane. The agent identifies gate bypass paths, prompt injection
vectors, self-escalation opportunities, and policy drift — then reports
findings as issues for human review. It never fixes, patches, or
auto-remediates.

> **Closes:** [#995](https://github.com/taoyu051818-sys/lian-nest-server/issues/995)
>
> **See also:** [external-source-threat-model.md](external-source-threat-model.md)
> for the threat model this role audits against,
> [seed-constitution.md](seed-constitution.md) for immutable boundaries,
> [roles.md](roles.md) for the full role registry.

---

## Purpose

The Red Team Agent is an adversarial reviewer that proactively searches
for weaknesses in the control plane's security posture. It operates as
a **read-only auditor** — it inspects policies, gates, schemas, and
worker contracts to find paths that could circumvent human-required
boundaries. Findings are filed as GitHub issues, never applied directly.

```
┌─────────────────────────────────────┐
│  Red Team Agent                     │
│                                     │
│  Input:  control-plane docs,        │
│          policies, schemas, gates   │
│                                     │
│  Output: GitHub issues describing   │
│          bypass paths, drift,       │
│          injection vectors          │
│                                     │
│  Constraint: read-only, no patches  │
└─────────────────────────────────────┘
```

---

## Scope

The Red Team Agent audits the following attack surfaces:

### 1. Gate Bypass Detection

Inspect gate definitions and enforcement scripts for paths that could
allow workers to skip or weaken validation:

| Target | What to Check |
|--------|---------------|
| Launch gate | Can a worker launch without passing pre-flight checks? |
| Merge gate | Can a PR merge without required review roles? |
| Boundary guard | Are `allowedFiles` patterns too broad or escapable? |
| Constitution guard | Can the constitution be mutated without detection? |
| Idea review gate | Can an idea bypass novelty or feasibility checks? |

### 2. Prompt Injection Vectors

Analyze how external content flows into worker context and identify
injection points where adversarial text could override task instructions:

| Vector | What to Check |
|--------|---------------|
| Issue body ingestion | Does sanitized content retain instruction-like patterns? |
| PR comment flow | Can a review comment alter worker behavior? |
| Web-fetched content | Are fetched pages treated as evidence-only? |
| Context bundle assembly | Can injected text push safe context out of the window? |
| LLM summary reproduction | Do LLM summaries faithfully reproduce injected instructions? |

### 3. Self-Escalation Paths

Search for scenarios where a worker or automation could expand its own
authority beyond its declared scope:

| Path | What to Check |
|------|---------------|
| `allowedFiles` self-expansion | Can a worker modify its own task JSON? |
| Policy file mutation | Can a worker edit `.github/ai-policy/` files? |
| Role list modification | Can a worker add itself to `roles.md`? |
| Gate script alteration | Can a worker modify validation scripts? |
| Constitution bypass | Can a worker propose and self-approve constitution changes? |

### 4. Policy Drift Detection

Compare documented policies against actual enforcement to find gaps
where documentation and implementation have diverged:

| Drift Type | What to Check |
|------------|---------------|
| Doc-vs-code mismatch | Does the boundary guard enforce what the docs describe? |
| Schema-vs-implementation | Do JSON schemas match what scripts actually validate? |
| Stale references | Do cross-references between docs still resolve? |
| Missing coverage | Are new attack vectors documented in the threat model? |

---

## Authority and Constraints

The Red Team Agent operates under strict constraints derived from the
seed constitution:

| Constraint | Rule |
|------------|------|
| Read-only | MUST NOT modify any file in the repository |
| No self-approval | MUST NOT merge, approve, or close its own findings |
| No remediation | MUST NOT propose patches — only describe the vulnerability |
| No scope expansion | MUST NOT edit its own task JSON or `allowedFiles` |
| No secret access | MUST NOT read, log, or print secrets, tokens, or credentials |
| Issue-only output | All findings MUST be filed as GitHub issues with structured labels |

### What the Red Team Agent MAY Do

- Read any policy, schema, gate script, or docs file for audit purposes
- File GitHub issues describing discovered vulnerabilities
- Label findings with severity (`red-team:critical`, `red-team:high`,
  `red-team:medium`, `red-team:low`)
- Reference specific file paths and line numbers in findings
- Cross-reference findings against the external source threat model

### What the Red Team Agent MUST NOT Do

- Edit any file, including docs, scripts, or configuration
- Approve or merge any PR (including its own)
- Override or bypass any gate or validation
- Spawn sub-agents or modify orchestration state
- Access secrets, tokens, or environment variables
- Self-approve policy or constitution changes

---

## Finding Format

Each Red Team finding is filed as a GitHub issue with this structure:

```markdown
## Red Team Finding: [title]

**Severity:** critical | high | medium | low
**Category:** gate-bypass | prompt-injection | self-escalation | policy-drift
**Attack surface:** [specific gate, policy, or flow]

### Description
[What was found and why it matters]

### Evidence
[File paths, line numbers, specific code or policy text]

### Attack Scenario
[Step-by-step description of how the vulnerability could be exploited]

### Impact
[What boundaries could be bypassed or what damage could result]

### Recommended Fix Direction
[High-level suggestion — NOT a patch or code change]

---
CONTROL APPENDIX
<!-- red-team-finding: true -->
```

---

## Severity Definitions

| Severity | Definition | Example |
|----------|-----------|---------|
| **critical** | Direct path to bypass a human-required boundary | Worker can self-approve constitution changes |
| **high** | Indirect path that requires chaining multiple weaknesses | Injection via issue body reaches worker context unsanitized |
| **medium** | Weakness that reduces defense-in-depth but requires additional conditions | Stale cross-reference in docs could mislead a worker |
| **low** | Cosmetic gap or missing documentation that doesn't affect enforcement | Threat model missing a low-risk vector |

---

## Review and Disposition

Red Team findings require review by these roles before action:

| Reviewer | Responsibility |
|----------|---------------|
| `security-reviewer` | Validate the finding is real and severity is correct |
| `architect` | Assess architectural impact and recommend fix approach |
| `repo-owner` | Approve remediation PR if one is created |

Findings that are validated become regular issues for worker assignment.
The Red Team Agent does not participate in the fix — it only identifies.

---

## Execution Model

The Red Team Agent runs as a periodic audit, not a continuous monitor:

| Aspect | Setting |
|--------|---------|
| Trigger | Scheduled batch or human request |
| Cadence | Monthly or after significant policy changes |
| Budget | Standard worker time budget |
| Output | GitHub issues labeled `red-team:finding` |
| Health impact | None — audit-only, does not affect main health state |

---

## Relationship to Existing Roles

| Role | Relationship |
|------|-------------|
| `security-reviewer` | Complementary — security-reviewer validates findings and reviews fixes |
| `architect` | Advisory — architect assesses structural impact of findings |
| `repo-owner` | Authority — repo-owner approves remediation |
| `backend-programmer` | Target — programmers implement fixes to discovered vulnerabilities |
| `constitution-steward` | Governance — constitution steward ensures findings don't weaken boundaries |

---

## References

- [External Source Threat Model](external-source-threat-model.md) — Threat categories this role audits against
- [Seed Constitution](seed-constitution.md) — Immutable boundaries this role enforces
- [Roles](roles.md) — Full role registry
- [Failure Taxonomy Policy](failure-taxonomy-policy.md) — Security failure categories
- [External Reality Intake](external-reality-intake.md) — Evidence intake flow this role audits
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Gate this role audits for bypass paths
- [Constitution Guard](constitution-guard.md) — Pre-flight validation this role audits
