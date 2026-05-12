# Operational Rule Auto-Change Policy

Defines which operational rules may be auto-proposed by workers and
which require human-authored changes. Establishes the boundary between
automated suggestions and governed amendments.

> **Closes:** [#1072](https://github.com/taoyu051818-sys/lian-nest-server/issues/1072)

---

## Purpose

Workers and orchestrators encounter operational rules during execution —
timeout defaults, conflict group definitions, validation requirements,
and similar parameters. This policy defines when a worker may propose a
change to these rules versus when it must stop and request human
intervention.

The policy prevents two failure modes:

1. **Stale rules** — operational parameters drift from reality because
   no mechanism exists to surface proposed updates.
2. **Constitutional erosion** — workers auto-modify rules that should
   remain human-governed, gradually weakening safety boundaries.

---

## Rule Classification

Operational rules fall into three tiers based on their blast radius
and reversibility.

### Tier 1: Auto-Proposable

Rules that a worker may propose changing via a PR, subject to normal
review gates. These are low-risk, reversible parameters with bounded
blast radius.

| Rule Category | Examples | Why Auto-Proposable |
|---------------|----------|---------------------|
| Timeout defaults | Soft/hard time budgets, extension minutes | Worker has direct evidence of insufficiency |
| Validation commands | Adding or adjusting `validationCommands` | Worker can demonstrate the command is needed |
| Docs cross-references | Internal links, reference lists | Self-contained, no runtime impact |
| Conflict group membership | Adding a new task to an existing group | Bounded scope, existing guard validates |
| Worker type classification | Reclassifying a task's worker type | Launch gate enforces the matrix |

**Constraints for auto-proposals:**

- The proposal MUST include evidence (validation output, timeout logs,
  or failure classification) justifying the change.
- The proposal MUST NOT touch files outside `docs/**` and
  `.github/ai-policy/**` (unless the task's `allowedFiles` permits it).
- The proposal MUST pass all existing guard checks.
- The proposal MUST NOT widen any `forbiddenFiles` glob or relax any
  seed constitution rule.

### Tier 2: Human-Required

Rules that affect safety boundaries, security posture, or architectural
decisions. Workers encountering these must comment on the issue and stop.

| Rule Category | Examples | Why Human-Required |
|---------------|----------|---------------------|
| Risk policy thresholds | `riskCap`, risk classification globs | Security boundary |
| Launch permission matrix | Which worker types run in which health states | Safety-critical scheduling |
| Shared lock definitions | Adding or removing lock names | Concurrency safety |
| Seed constitution sections | Any of the 5 immutable sections | Constitutional integrity |
| High-risk file globs | `src/**`, `prisma/**`, `package.json` boundaries | Blast radius control |
| Health state definitions | Green/yellow/red/black semantics | Recovery behavior |

**Worker behavior when encountering a Tier 2 change need:**

1. Comment on the issue describing the proposed change and its rationale.
2. Label the comment with `human-required:operational-rule`.
3. Do not open a PR for the change.
4. Continue with other non-blocked work if possible.

### Tier 3: Constitution-Protected

Rules governed by the seed constitution amendment process. These cannot
be proposed, modified, or relaxed by any worker or automation.

| Protected Area | Source | Amendment Process |
|----------------|--------|-------------------|
| High-risk human-required boundaries | [seed-constitution.md §1](seed-constitution.md) | Human-authored PR + architecture-review + repo-owner |
| Explicit merge allowlists | [seed-constitution.md §2](seed-constitution.md) | Same as above |
| Main-red launch stop | [seed-constitution.md §3](seed-constitution.md) | Same as above |
| Legacy backend read-only policy | [seed-constitution.md §4](seed-constitution.md) | Same as above |
| No worker scope expansion | [seed-constitution.md §5](seed-constitution.md) | Same as above |

Workers MUST NOT propose changes to Tier 3 rules. Any such proposal
is a contract violation and the constitution guard will reject it.

---

## Auto-Proposal Workflow

```
  ┌──────────┐     ┌──────────────┐     ┌───────────┐     ┌───────────┐
  │  Worker   │────▶│  Evidence    │────▶│  Proposal │────▶│  Review   │
  │  detects  │     │  collected   │     │  PR       │     │  gate     │
  │  drift    │     │              │     │  opened   │     │           │
  └──────────┘     └──────────────┘     └───────────┘     └─────┬─────┘
                                                                │
                                              ┌─────────────────┼────────────────┐
                                              ▼                 ▼                ▼
                                         ┌─────────┐     ┌──────────┐     ┌──────────┐
                                         │ Merged  │     │ Rejected │     │ Escalate │
                                         │         │     │ (revise) │     │ (Tier 2) │
                                         └─────────┘     └──────────┘     └──────────┘
```

### Step 1: Drift Detection

A worker detects that an operational parameter does not match reality.
Examples:

- A timeout consistently expires before the worker finishes.
- A validation command is missing that would have caught a failure.
- A conflict group definition is incomplete.

### Step 2: Evidence Collection

The worker collects evidence to justify the change:

| Evidence Type | Format | Example |
|---------------|--------|---------|
| Timeout log | Worker stdout with elapsed time | `Worker completed in 42 min (soft: 30, hard: 60)` |
| Validation failure | Guard output showing the miss | `check-task-boundary.js: missing validation for generated/` |
| Conflict collision | Launch gate rejection log | `check-launch-gate.ps1: conflict group collision detected` |

### Step 3: Proposal PR

The worker opens a PR that:

1. Modifies only the relevant policy or docs file.
2. Includes the evidence in the PR body under `## Validation`.
3. Follows the standard PR handoff format (all 7 sections).
4. Uses the task's existing `allowedFiles` boundary.

### Step 4: Review Gate

The PR goes through standard review:

- **Guard checks** — boundary guard, docs authority, PR handoff.
- **Review roles** — determined by the changed files (see
  [merge-policy.md](merge-policy.md) risk policy).
- **Constitution guard** — verifies no Tier 3 rules were modified.

---

## Guard Integration

### Boundary Guard

The boundary guard (`check-task-boundary.js`) enforces `allowedFiles`
and `forbiddenFiles` from the task manifest. Auto-proposals that touch
files outside the boundary are blocked.

### Constitution Guard

The constitution guard (`check-constitution.js`) verifies that the seed
constitution sections are present and in sync. Any auto-proposal that
modifies a constitution-protected file fails this check.

### AI Policy Files Guard

The AI policy files guard (`check-ai-policy-files.js`) verifies that
all required `.github/ai-policy/` files exist and JSON files parse
correctly. Auto-proposals that introduce invalid JSON or remove required
files are blocked.

---

## Escalation Path

When a worker identifies a needed change but the rule is Tier 2
(human-required):

1. Worker comments on the issue with the proposal and evidence.
2. The issue is labeled `human-required:operational-rule`.
3. A constitution steward reviewer evaluates the proposal.
4. If approved, a human-authored PR is created.
5. The PR follows the standard amendment process for its tier.

```
Worker detects need → Comment on issue → Label → Steward reviews → Human PR
```

---

## What Workers MUST NOT Do

| Prohibited Action | Why |
|-------------------|-----|
| Auto-modify seed constitution | Constitutional integrity (Tier 3) |
| Auto-modify launch permission matrix | Safety boundary (Tier 2) |
| Auto-modify risk policy thresholds | Security boundary (Tier 2) |
| Auto-widen `forbiddenFiles` globs | Blast radius control (Tier 2) |
| Auto-modify shared lock definitions | Concurrency safety (Tier 2) |
| Open a PR for Tier 2 changes without evidence | Waste reviewer time |
| Bypass the escalation path | Governance integrity |

---

## Relationship to Existing Policies

| Policy | Relationship |
|--------|--------------|
| [seed-constitution.md](seed-constitution.md) | Tier 3 rules are defined here; no auto-change permitted |
| [launch-policy.md](launch-policy.md) | Launch permission matrix is Tier 2; other fields may be Tier 1 |
| [merge-policy.md](merge-policy.md) | Risk thresholds are Tier 2; eligibility checks are Tier 1 |
| [failure-taxonomy-policy.md](failure-taxonomy-policy.md) | Recovery routing is Tier 1; severity/health-impact mapping is Tier 2 |
| [bounded-experiment-policy.md](bounded-experiment-policy.md) | Experiment scoping rules are Tier 1 |
| [worker-task-contract.md](worker-task-contract.md) | Contract schema is Tier 2; example values are Tier 1 |

---

## References

- [seed-constitution.md](seed-constitution.md) — Immutable constitutional rules
- [constitution-guard.md](constitution-guard.md) — Pre-flight constitution validation
- [launch-policy.md](launch-policy.md) — Machine-readable launch policy
- [merge-policy.md](merge-policy.md) — Machine-readable merge policy
- [failure-taxonomy-policy.md](failure-taxonomy-policy.md) — Failure classification
- [bounded-experiment-policy.md](bounded-experiment-policy.md) — Experiment scoping
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema
- [ai-policy-files-guard.md](ai-policy-files-guard.md) — Policy file integrity guard
