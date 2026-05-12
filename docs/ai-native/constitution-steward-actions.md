# Constitution Steward Action Boundaries

Defines preview-only and human-required actions for the Constitution
Steward role. The steward may audit, lint, and review policy artifacts
but may never self-approve high-risk or constitutional changes.

> **Closes:** [#1006](https://github.com/taoyu051818-sys/lian-nest-server/issues/1006)
> **See also:** [seed-constitution.md](seed-constitution.md) for
> immutable boundaries,
> [webui-human-required-boundaries.md](webui-human-required-boundaries.md)
> for WebUI action gates.

---

## Overview

The Constitution Steward is a governance role responsible for keeping
policy artifacts consistent, linted, and auditable. It operates under a
strict split: some actions are **preview-only** (read, analyze, report)
while others are **human-required** (propose, amend, approve).

```
┌──────────────────────────────────────────────────────────────┐
│  Constitution Steward Actions                                 │
│                                                               │
│  ┌───────────────────────┐  ┌──────────────────────────────┐ │
│  │ Preview-Only (auto)   │  │ Human-Required               │ │
│  │                       │  │                              │ │
│  │ • constitution audit  │  │ • amendment proposal         │ │
│  │ • prompt lint         │  │ • constitution change        │ │
│  │ • policy audit        │  │ • policy override            │ │
│  │ • drift report        │  │ • amendment approval         │ │
│  │ • section sync check  │  │ • emergency bypass           │ │
│  └───────────────────────┘  └──────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

The steward may propose policy changes but may not self-approve
high-risk or constitutional changes. This constraint is absolute.

---

## Preview-Only Actions

Preview-only actions are read-side operations that produce reports,
lint results, or audit findings. They have no side effects on policy
state and can run without human approval.

### 1. Constitution Audit

Validates that the seed constitution at
`.github/ai-policy/seed-constitution.md` and its docs mirror at
`docs/ai-native/seed-constitution.md` are structurally correct and
in sync.

| Check | Output |
|-------|--------|
| Authoritative file exists | Pass/fail |
| Docs mirror exists | Pass/fail |
| Required sections present (5) | List of missing sections |
| Section headings in sync | Diff of mismatches |

**Side effects:** None. Read-only file comparison.

**Invocation:** Runs as part of the constitution guard
(`check-constitution.js`). May be triggered by the steward on demand
or on a schedule.

---

### 2. Prompt Lint

Checks that worker prompt templates and agent prompt files conform to
policy constraints: no embedded secrets, no injection patterns, no
role-escalation language.

| Check | Output |
|-------|--------|
| No secret patterns (`sk-`, `ghp_`, `Bearer `) | List of violations |
| No command injection (shell metacharacters) | List of violations |
| No role escalation (`I am the repo-owner`) | List of violations |
| Length within bounds (2000 char per field) | List of overflows |

**Side effects:** None. Read-only scan.

**Invocation:** On-demand or before prompt template changes.

---

### 3. Policy Audit

Reviews all files under `.github/ai-policy/` for consistency with the
seed constitution. Checks that no policy file contradicts, weakens, or
implicitly expands constitution boundaries.

| Check | Output |
|-------|--------|
| No contradiction with seed constitution | List of conflicts |
| No implicit boundary expansion | List of expansions |
| No stale references (dead links to removed files) | List of broken refs |
| Amendment process section present | Pass/fail |

**Side effects:** None. Read-only analysis.

**Invocation:** On-demand or after policy file changes.

---

### 4. Drift Report

Compares the docs mirror (`docs/ai-native/seed-constitution.md`)
against the authoritative file
(`.github/ai-policy/seed-constitution.md`) and produces a drift
report showing content differences.

| Check | Output |
|-------|--------|
| Content hash match | Pass/fail |
| Heading structure match | List of divergent headings |
| Table row count match | Count comparison |
| Last-modified timestamp comparison | Older/newer indicator |

**Side effects:** None. Read-only comparison.

**Invocation:** On-demand or as part of CI.

---

### 5. Section Sync Check

Verifies that the five required constitution sections exist in both
files and have matching headings:

1. `## 1. High-Risk Human-Required Boundaries`
2. `## 2. Explicit Merge Allowlists`
3. `## 3. Main-Red Launch Stop`
4. `## 4. Legacy Backend Read-Only Policy`
5. `## 5. No Worker Scope Expansion`

| Check | Output |
|-------|--------|
| All 5 sections present in authoritative | Pass/fail per section |
| All 5 sections present in mirror | Pass/fail per section |
| Heading text matches exactly | Diff per section |

**Side effects:** None. Read-only structural check.

**Invocation:** Runs as part of constitution audit or independently.

---

## Human-Required Actions

Human-required actions involve proposing, modifying, or approving
changes to policy or constitution artifacts. These actions cannot be
performed by the steward alone — they require a human actor with the
appropriate role.

### 1. Amendment Proposal

The steward may draft an amendment proposal as a structured artifact
(recommended change, rationale, impact analysis) but the proposal
MUST NOT be auto-applied.

| Field | Rule |
|-------|------|
| Draft | Steward may generate |
| Rationale | Steward may suggest, human must confirm |
| Impact analysis | Steward may generate |
| Submission | Requires human approval |
| Merge | Requires `architecture-review` role |

**Gate:** The amendment enters a pending state. A human must explicitly
approve before the change is applied to either the authoritative file
or the docs mirror.

**Why human-required:** Constitutional changes have system-wide
blast radius. No automation may self-expand, override, or relax
constitution boundaries (seed constitution rule).

---

### 2. Constitution Change

Any modification to `.github/ai-policy/seed-constitution.md` or
`docs/ai-native/seed-constitution.md` is human-required.

| Operation | Allowed? |
|-----------|----------|
| Steward reads constitution | Yes (preview-only) |
| Steward drafts a change | Yes (pending human approval) |
| Steward applies a change | **No** |
| Steward commits a change | **No** |
| Human applies change | Yes |
| Human approves steward draft | Yes |

**Gate:** The steward generates a diff but does not write it. A human
reviews, approves, and applies the change through a human-authored PR.

---

### 3. Policy Override

If a policy file under `.github/ai-policy/` is found to contradict
the seed constitution, the steward may flag it but may not fix it
without human approval.

| Step | Actor |
|------|-------|
| Detect contradiction | Steward (preview-only) |
| Draft fix | Steward (pending approval) |
| Approve fix | Human (`repo-owner` or `architect`) |
| Apply fix | Human or approved worker |

**Gate:** Contradiction report is emitted as a preview artifact. Fix
requires human sign-off.

---

### 4. Amendment Approval

The final approval for any constitution or policy amendment is
human-owned. The steward may prepare all supporting materials but
cannot close the approval loop.

| Approval Step | Actor |
|---------------|-------|
| Prepare rationale and impact | Steward |
| Review draft | Human (`architecture-review`) |
| Approve and merge | Human (`repo-owner`) |
| Update docs mirror | Human or approved worker |

**Why human-required:** Seed constitution amendment process (section 6)
requires human-authored PR, architecture-review, and repo-owner
approval.

---

### 5. Emergency Bypass

In exceptional circumstances (e.g., constitution file corrupted,
guard script broken), a human may bypass normal process. The steward
MUST NOT initiate or suggest bypasses.

| Operation | Allowed? |
|-----------|----------|
| Steward detects emergency state | Yes (preview-only) |
| Steward suggests bypass | **No** |
| Human initiates bypass | Yes |
| Steward documents bypass | Yes (after the fact) |

**Gate:** Bypass is entirely human-initiated. The steward may only
observe and record.

---

## Boundary Rules

These rules are absolute and apply to all steward actions:

1. **No self-approval.** The steward may draft proposals but may not
   approve, merge, or apply its own changes to policy or constitution
   files.

2. **No boundary weakening.** Steward actions may not relax, override,
   or implicitly expand constitution boundaries. The seed constitution
   is immutable without a human-authored PR.

3. **No policy file writes.** The steward MUST NOT write to files
   under `.github/ai-policy/` or `.github/ai-state/` unless the
   task's `allowedFiles` explicitly includes those paths.

4. **No secret exposure.** Preview reports and audit outputs MUST NOT
   contain secrets, tokens, credentials, or `.env` contents.

5. **No transitive authority.** Discovering a needed fix outside the
   steward's scope is a blocker, not an invitation to expand. The
   steward reports the blocker and stops.

---

## Enforcement

| Rule | Enforced By | When |
|------|-------------|------|
| No self-approval | Worker contract + PR review | Pre-merge |
| No boundary weakening | Constitution guard | Pre-merge |
| No policy file writes | Boundary guard (`allowedFiles` check) | Pre-merge |
| No secret exposure | Prompt lint + CI secret scan | Pre-commit |
| No transitive authority | Worker contract immutability | Runtime |

---

## Action Summary

| Action | Type | Side Effects | Human Required |
|--------|------|:------------:|:--------------:|
| Constitution audit | Preview-only | No | No |
| Prompt lint | Preview-only | No | No |
| Policy audit | Preview-only | No | No |
| Drift report | Preview-only | No | No |
| Section sync check | Preview-only | No | No |
| Amendment proposal | Human-required | Pending approval | Yes |
| Constitution change | Human-required | Yes | Yes |
| Policy override | Human-required | Yes | Yes |
| Amendment approval | Human-required | Yes | Yes |
| Emergency bypass | Human-required | Yes | Yes |

---

## References

- [Seed Constitution](seed-constitution.md) — Immutable boundaries this role enforces
- [Seed Constitution (authoritative)](../../.github/ai-policy/seed-constitution.md) — Single source of truth
- [Constitution Guard](constitution-guard.md) — Pre-flight validation of constitution structure
- [WebUI Human-Required Boundaries](webui-human-required-boundaries.md) — Action gates for the operation console
- [WebUI Action Confirmation Policy](webui-action-confirmation-policy.md) — Confirmation UX for dangerous actions
- [Roles](roles.md) — Role definitions and authority boundaries
