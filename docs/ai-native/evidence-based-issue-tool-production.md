# Evidence-Based Issue and Tool Production

## Overview

Issue production and tool creation in the AI self-cycle must be evidence-based, not threshold-hardcoded. The system lets the agent reason from facts, current project state, and comparable open-source project practices before deciding whether to create an issue, tool, script, or gate.

## Core Principle

Do not hardcode numeric thresholds or rigid escalation rules unless they are directly backed by evidence and can be overridden by agent reasoning. The agent decides based on current repository facts, self-cycle state, issue pool depth, active worker state, PR and branch state, task surface independence, conflictGroup overlap, allowedFiles overlap, sharedLocks, humanRequired boundaries, prior failure history, open-source project patterns, and cost analysis.

## Decision Model

Each proposed issue or tool includes a reasoning section with 7 questions:

1. **Facts observed** — What facts from the current state triggered this candidate?
2. **Relevant pattern** — What open-source or established engineering pattern is relevant?
3. **Why this action** — Why is agent judgment sufficient, or why is a tool needed?
4. **Risk if manual** — What would go wrong if this remains manual or agent-judged?
5. **Risk if over-tooled** — What would go wrong if this is over-tooled?
6. **Seed boundary** — Which Seed Constitution boundary applies?
7. **Self-bootstrap necessary** — Is this action necessary for self-bootstrap now?

## Classification

Each candidate is classified into one of four categories:

### agent-judgment-only
Low-risk tasks with no recorded evidence and no acceptance criteria. Agent judgment is sufficient — no issue tracking needed. Example: a trivial documentation fix with no downstream impact.

### issue-worthy
Tasks with documented evidence and bounded scope. Worthy of issue tracking for accountability. Example: refreshing a stale state file based on observed TTL expiration.

### tool-worthy
Tasks with evidence of recurrence and multiple validation commands. A tool would make this more reliable and verifiable. Example: a recurring data transformation with multiple verification steps.

### gate-worthy
High-risk tasks or tasks touching forbidden file scopes. Requires human gate review before execution. Example: changes to `src/**` or `prisma/**`.

## Thresholds

Thresholds in the system are derived from current facts, not hardcoded:

### Meta-signal thresholds
- **Failure score**: Compared against the current trust score. A failure score exceeding the trust score indicates reliability degradation.
- **Friction score**: Compared against half the trust score. Friction exceeding this threshold indicates worker stalls.

### Issue-production thresholds
- **Gap ratio**: The gap between ready issues and requested workers is expressed as a percentage of requested parallelism. A gap > 50% is "critical"; otherwise it's "thin".

### Parallelism recommendations
Parallelism recommendations explain task-surface independence rather than relying only on global risk labels. The system analyzes:
- **conflictGroup independence** — Do active workers share conflict groups?
- **allowedFiles overlap** — Do workers touch the same files?
- **sharedLocks** — Are there active locks on the same conflict groups?
- **risk category** — What is the risk level of each task?
- **humanRequired flag** — Does the task require human approval?
- **affected subsystem** — Which subsystems are involved?
- **rollback difficulty** — How hard is it to revert?
- **test coverage** — Are there tests for the affected code?

If tasks are independent by facts, they may be candidates for parallel execution even if both are medium risk. If tasks overlap by files, locks, policy, or human-required boundary, they should serialize even if nominally low risk.

## Implementation

### propose-self-cycle-issues.js
- Each candidate includes a `reasoning` object with the 7 decision model fields.
- Each candidate includes a `classification` field (agent-judgment-only, issue-worthy, tool-worthy, gate-worthy).
- The `buildIssueBody` function includes the reasoning section in the generated issue body.
- The `applyPolicyGate` function sets classification based on risk and file scope.

### produce-issues.js
- The `classifyProposal` function classifies each proposal based on evidence, risk, and validation commands.
- Quality scoring includes a classification check (7th point).
- Proposals include `classification` and `classificationReason` fields.

### emit-command-steward-brief.js
- Meta-signal blockers compare failure/friction scores against trust scores (not fixed thresholds).
- Issue-production blockers use gap ratio (percentage of requested parallelism) instead of fixed gap count.
- Parallelism summary includes task-surface independence analysis.
- Recommendations explain their reasoning from current facts.

## Acceptance Criteria

- `propose-self-cycle-issues` candidates include an evidence-based reasoning section.
- `produce-issues` preview explains why each candidate is agent-judgment-only, issue-worthy, tool-worthy, or gate-worthy.
- `emit-command-steward-brief` recommendations avoid fixed numeric thresholds unless derived from current facts or explicit policy.
- Parallelism recommendations explain task-surface independence instead of relying only on global risk labels.
- Existing tests pass.
- No runtime backend or Prisma files are touched.

## Constraints

- Do not weaken Seed Constitution.
- Do not weaken launch gate.
- Do not weaken merge policy.
- Do not bypass human-required boundaries.
- Do not modify `.github/ai-policy/**` unless explicitly approved by a human.
- Do not touch `src/**`.
- Do not touch `prisma/**`.
- Do not modify `package.json` or `package-lock.json`.
