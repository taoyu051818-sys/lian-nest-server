# Constitution Steward Layer

Defines the non-execution governance layer that upholds the seed
constitution across all AI-native control-plane activity. Agents may
**propose** policy changes but may **not self-approve** high-risk or
constitutional changes. This layer is advisory and observational — it
produces signals, markers, and audit records but never executes actions.

> **Closes:** [#990](https://github.com/taoyu051818-sys/lian-nest-server/issues/990)
> **Authority:** [seed-constitution.md](../../.github/ai-policy/seed-constitution.md)
> — immutable boundaries this layer enforces.

---

## Principle

The AI-native control plane is organized around three pillars:

| Pillar | Layer | Role |
|--------|-------|------|
| **Reality** | [External Reality Intake](external-reality-intake.md) | Ingests, classifies, and sanitizes external evidence. No external input is ever executed as a command. |
| **Selection** | [Agent Idea Review Gate](agent-idea-review-gate.md) + [Bounded Experiment Policy](bounded-experiment-policy.md) | Evaluates candidate ideas against feasibility, novelty, and scope criteria before promotion to issues. |
| **Governed Recursion** | [Self-Cycle Runner](self-cycle-runner.md) + [Launch Gate](launch-gate.md) | Orchestrates the worker dispatch loop with health gates, conflict checks, and validation requirements. |

The Constitution Steward Layer sits **across** all three pillars as a
cross-cutting concern. It does not participate in the intake, selection,
or execution pipeline. Instead, it observes, validates, and blocks when
constitution boundaries are at risk.

```
  ┌─────────────────────────────────────────────────────┐
  │           Constitution Steward Layer                 │
  │    (non-execution, advisory, observational)          │
  │                                                     │
  │  ┌───────────┐  ┌───────────┐  ┌────────────────┐  │
  │  │ Proposal  │  │ Audit     │  │ Boundary       │  │
  │  │ Review    │  │ Trail     │  │ Enforcement    │  │
  │  └─────┬─────┘  └─────┬─────┘  └───────┬────────┘  │
  └────────┼──────────────┼────────────────┼────────────┘
           │              │                │
     ┌─────┴──────┐  ┌───┴────┐   ┌──────┴──────┐
     │  Reality   │  │Selection│   │  Governed   │
     │  (intake)  │  │ (gate)  │   │  Recursion  │
     └────────────┘  └────────┘   └─────────────┘
```

---

## Steward Roles

The Constitution Steward Layer is operated by roles that exist purely
for governance — they do not write code, edit files, or launch workers.

| Role | Responsibility | Authority |
|------|---------------|-----------|
| **constitution-auditor** | Reviews PRs and issues for constitution compliance. Flags violations. Cannot approve or merge. | Read-only on all files. May comment on issues and PRs. |
| **ai-architecture-reviewer** | Reviews policy and architecture changes for alignment with the seed constitution. | Read-only on all files. May approve or request changes on PRs. |
| **control-plane-reviewer** | Reviews control-plane metadata, task JSON, and orchestration scripts for contract compliance. | Read-only on control-plane files. May approve or request changes on PRs. |
| **Human constitutional owner** (repo-owner) | Final authority on constitution amendments, high-risk boundary overrides, and policy changes. | Full authority. No automation may act as this role. |

### Role Enforcement

1. **No self-approval.** An agent worker MUST NOT approve its own PR
   when the PR touches constitution or policy boundaries.
2. **No role escalation.** A worker MUST NOT claim a steward role in
   its task JSON or PR body. Steward roles are assigned at the
   orchestrator level or by the repo-owner.
3. **Human override required.** Even when all automated reviews pass,
   constitution amendments require explicit human approval from the
   constitutional owner.

---

## Non-Execution Boundaries

The steward layer **observes** and **signals** but does not **execute**.
The following activities are explicitly outside its scope:

| Activity | Owner | Steward Role |
|----------|-------|--------------|
| Merging PRs | repo-owner | Reviews constitution compliance pre-merge |
| Launching workers | Orchestrator (batch-launch.ps1) | Validates launch-gate decisions |
| Creating issues | pm-gate or issue-to-task compiler | Reviews CONTROL APPENDIX for boundary compliance |
| Amending the constitution | Human-authored PR only | Audits the amendment, does not draft or approve it |
| Overriding a block | repo-owner with documented justification | Records the override in the audit trail |

The steward layer produces the following **signals** (never actions):

| Signal | Format | Consumer |
|--------|--------|----------|
| Constitution violation marker | Fact event (`constitution.violation`) | Audit trail, orchestrator |
| Amendment proposal flag | Issue label `constitution:proposed` | Human constitutional owner |
| Boundary risk warning | PR review comment | PR author, repo-owner |
| Scope expansion block | Fact event (`constitution.scope-block`) | Worker, orchestrator |

## Relationship to the Seed Constitution

The seed constitution
([.github/ai-policy/seed-constitution.md](../../.github/ai-policy/seed-constitution.md))
defines **what** the boundaries are. The Constitution Steward Layer
defines **how** those boundaries are observed, signaled, and enforced
across the control plane.

### Mapping: Constitution Rules to Steward Responsibilities

| Constitution Section | Steward Layer Responsibility |
|---------------------|------------------------------|
| 1. High-Risk Human-Required Boundaries | Flag any worker diff that touches high-risk files. Block automated approval. |
| 2. Explicit Merge Allowlists | Validate that worker `allowedFiles` does not self-expand. Audit scope drift. |
| 3. Main-Red Launch Stop | Observe health state. Signal when a launch is attempted during red state. |
| 4. Legacy Backend Read-Only Policy | Flag any worker diff that modifies legacy files. Block automated approval. |
| 5. No Worker Scope Expansion | Detect transitive expansion, orchestration self-promotion, and policy modification attempts. |

### What the Steward Layer Does NOT Do

1. **Does not draft policy.** Policy changes are human-authored.
2. **Does not approve constitution amendments.** Only the repo-owner
   and architecture-review role may approve.
3. **Does not modify `allowedFiles`.** Task boundaries are immutable
   after launch (constitution rule 5).
4. **Does not bypass blocks.** There is no override mechanism in the
   steward layer. Overrides live with the repo-owner.
5. **Does not execute validation commands.** Workers run validation;
   the steward layer observes results.

---

## Governance of Agent Policy Proposals

Agents may encounter situations where they believe a policy change would
improve the system. The steward layer governs how these proposals flow:

```
  Agent identifies policy gap
          │
          ▼
  ┌──────────────────────┐
  │ Proposal Review Gate  │
  │                       │
  │  1. Is this a policy  │
  │     or constitution   │──Yes──▶ Record as issue label
  │     change?           │         `constitution:proposed`
  │                       │         Block worker execution.
  │  2. Is this within    │
  │     the worker's      │──No───▶ Comment blocker on issue.
  │     allowedFiles?     │
  │                       │
  │  3. Is this a low-    │
  │     risk doc change?  │──Yes──▶ Allow within scope.
  └──────────────────────┘
```

### Proposal Rules

1. **Agents may propose.** An agent MAY identify a policy gap and
   create an issue or issue comment describing the gap.
2. **Agents may not self-approve.** Even if the proposal is trivial,
   the agent MUST NOT merge a policy change without human review.
3. **Constitution changes are always high-risk.** Any change to
   `.github/ai-policy/**` or the seed constitution mirror requires
   the full amendment process defined in the seed constitution.
4. **Low-risk doc clarifications** (typo fixes, link updates, section
   reordering that does not change meaning) MAY be included in a
   worker's PR if the doc is within `allowedFiles`, but still require
   human review if the doc is governance-level.

---

## Integration Points

| Consumer | How It Uses the Steward Layer |
|----------|-------------------------------|
| Boundary guard (`check-task-boundary.js`) | Enforces `allowedFiles` at merge time — steward layer provides audit context |
| Launch gate (`check-launch-gate.ps1`) | Blocks launches during red state — steward layer observes and records |
| PR review gate | Steward roles review PRs for constitution compliance |
| Fact event ledger | Steward signals (violations, blocks, warnings) are recorded as fact events |
| Planning console | Displays constitution compliance status for in-flight work |
| Orchestrator | Reads steward signals to decide whether to dispatch workers |

---

## Marker and Event Types

The steward layer emits events in the fact event ledger
(`.github/ai-state/fact-events.ndjson`):

| Event Type | Trigger | Severity |
|------------|---------|----------|
| `constitution.violation` | Worker diff touches a high-risk boundary without human approval | Error |
| `constitution.scope-block` | Worker attempts to edit files outside `allowedFiles` | Error |
| `constitution.amendment-proposed` | Agent or human proposes a change to `.github/ai-policy/**` | Info |
| `constitution.override` | Repo-owner overrides a block with documented justification | Warning |
| `constitution.review-requested` | Steward role requests review of a PR or issue | Info |

---

## Implementation Status

| Component | Status |
|-----------|--------|
| Steward role definitions | **Defined** — this doc |
| Non-execution boundary rules | **Defined** — this doc |
| Proposal review flow | **Defined** — this doc |
| Integration with Reality, Selection, Governed Recursion | **Defined** — this doc |
| Steward role enforcement script | **Pending** — follow-up issue |
| Constitution violation detection | **Pending** — follows from boundary guard enhancements |
| Proposal gate automation | **Pending** — follows from enforcement script |

---

## References

- [Seed Constitution](../../.github/ai-policy/seed-constitution.md) — Immutable boundaries this layer enforces (docs mirror: [seed-constitution.md](seed-constitution.md))
- [Constitution Guard](constitution-guard.md) — Pre-flight validation that the constitution is intact
- [External Reality Intake](external-reality-intake.md) — Reality pillar: evidence ingestion
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Selection pillar: idea evaluation
- [Bounded Experiment Policy](bounded-experiment-policy.md) — Selection pillar: scoping rules
- [Self-Cycle Runner](self-cycle-runner.md) — Governed Recursion pillar: orchestrator
- [Launch Gate](launch-gate.md) — Governed Recursion pillar: pre-launch validation
