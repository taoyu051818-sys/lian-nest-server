# Constitution Amendment Protocol

Defines the formal process for proposing, reviewing, approving, rolling
out, and rolling back changes to the seed constitution. All amendments
MUST flow through human governance — no automation may self-approve,
bypass review, or compress gates.

> **Closes:** [#991](https://github.com/taoyu051818-sys/lian-nest-server/issues/991)
>
> **Reference:** [seed-constitution.md (authoritative)](../../.github/ai-policy/seed-constitution.md)
> for the current rules, [seed-constitution.md](seed-constitution.md) for
> the docs mirror, [constitution-guard.md](constitution-guard.md) for
> integrity validation, [bounded-experiment-policy.md](bounded-experiment-policy.md)
> for experiment scoping.

---

## Purpose

The seed constitution defines immutable boundaries for the AI development
control plane. Changes to these boundaries carry systemic risk — a bad
amendment can weaken human gates, introduce contradictions, or open attack
surfaces across every worker and orchestrator in the pipeline.

This protocol ensures every amendment is:

1. **Proposed with evidence** — grounded in a concrete problem, not speculation.
2. **Adversarially reviewed** — red-teamed before human approval.
3. **Human-approved** — no amendment merges without explicit human sign-off.
4. **Gradually rolled out** — enforcement changes deploy in phases.
5. **Observable** — telemetry confirms the amendment behaves as intended.
6. **Reversible** — every amendment has a defined rollback path.

---

## Amendment Lifecycle

```
  ┌──────────┐     ┌──────────────┐     ┌───────────┐     ┌───────────┐
  │ Proposal │────▶│ Red-Team     │────▶│ Human     │────▶│ Limited   │
  │ (draft)  │     │ Review       │     │ Approval  │     │ Rollout   │
  └──────────┘     └──────────────┘     └───────────┘     └─────┬─────┘
                                                                │
                                                    ┌───────────┴───────────┐
                                                    ▼                       ▼
                                             Telemetry              ┌──────────┐
                                             Observation            │ Rollback │
                                                    │               │ (revert) │
                                                    ▼               └──────────┘
                                             ┌───────────┐
                                             │ Accepted  │
                                             │ (merged)  │
                                             └───────────┘
```

| Phase | Owner | Gate |
|-------|-------|------|
| Proposal | Human or agent (draft only) | Proposal template completeness |
| Red-Team Review | Independent reviewer (human or agent) | Adversarial findings report |
| Human Approval | `architecture-review` role + repo owner | Explicit sign-off on PR |
| Limited Rollout | Orchestrator | Phased enforcement deployment |
| Telemetry Observation | Orchestrator + steward | Observation window with zero incidents |
| Rollback | Any authorized actor | Revert commit + audit event |

---

## 1. Proposal Requirements

Every amendment proposal MUST include:

| Element | Required | Description |
|---------|:--------:|-------------|
| Problem statement | Yes | What gap, risk, or failure motivated this amendment |
| Proposed change | Yes | Exact section and text being modified, with diff |
| Risk assessment | Yes | Impact on existing workers, gates, and boundaries |
| Red-team review plan | Yes | Who will review and what adversarial checks apply |
| Rollback plan | Yes | How to revert if the amendment causes harm |
| Human approval assignment | Yes | Named `architecture-review` reviewer + repo owner |

### Proposal Constraints

1. **Narrow scope.** An amendment SHOULD modify the fewest sections
   necessary. Bundled amendments (multiple unrelated changes in one PR)
   MUST be split.
2. **No silent broadening.** Amendments MUST NOT relax boundaries without
   explicit justification in the risk assessment.
3. **Mirror parity.** Every amendment to the authoritative constitution
   MUST include a corresponding change to the docs mirror, and vice versa.
4. **Section preservation.** The five required constitution sections
   (High-Risk Boundaries, Merge Allowlists, Main-Red Launch Stop, Legacy
   Read-Only, No Scope Expansion) MUST remain present. An amendment may
   modify their content but MUST NOT remove them.

---

## 2. Red-Team Review

Every amendment MUST pass an adversarial review before human approval.
The red-team reviewer evaluates the proposal from an attacker's
perspective.

### Reviewer Requirements

| Requirement | Rule |
|-------------|------|
| Independence | Reviewer MUST NOT be the proposal author |
| Role | Human in `architecture-review` role, or agent with explicit red-team assignment |
| Scope | Reviewer evaluates the amendment in isolation AND in context of the full constitution |

### Adversarial Checklist

The red-team reviewer MUST evaluate all of the following:

| Check | Question |
|-------|----------|
| Gate weakening | Does this amendment reduce the set of operations requiring human approval? |
| Scope expansion | Does this amendment create a new path for workers to self-expand boundaries? |
| Contradiction | Does this amendment contradict any existing constitution section? |
| Enforcement gap | Does this amendment create a gap where a boundary was previously enforced? |
| Attack surface | Does this amendment introduce a new vector for prompt injection or automation abuse? |
| Rollback feasibility | If this amendment is deployed and found harmful, can it be cleanly reverted? |

### Review Output

The red-team review produces a findings report attached as a PR comment:

```jsonc
{
  "reviewType": "red-team",
  "reviewer": "<actor>",
  "reviewedAt": "<ISO-8601>",
  "checks": [
    {
      "check": "gate-weakening",
      "result": "pass | fail | warn",
      "finding": "Description of finding (empty if pass)"
    }
  ],
  "recommendation": "approve | reject | request-changes",
  "summary": "One-paragraph adversarial assessment"
}
```

| Recommendation | Meaning |
|----------------|---------|
| `approve` | No adversarial findings; amendment is safe to proceed to human approval |
| `reject` | Critical finding; amendment MUST NOT proceed without fundamental redesign |
| `request-changes` | Non-critical finding; amendment needs revision before re-review |

---

## 3. Human Approval Gates

Human approval is the primary defense against constitution degradation.
These gates are absolute — no flag, environment variable, or script
parameter bypasses them.

### Required Approvals

| Amendment Type | Required Approvers | Minimum Approvals |
|----------------|-------------------|:-----------------:|
| Any constitution change | `architecture-review` role + repo owner | 2 |
| Enforcement behavior change (audit → block) | `architecture-review` role + repo owner + security steward | 3 |
| New boundary addition | `architecture-review` role + repo owner | 2 |
| Boundary relaxation | `architecture-review` role + repo owner + security steward | 3 |

### Approval Rules

1. **No blanket approval.** Each approval MUST reference the specific
   commit SHA and diff being approved. Approving a PR title without
   reviewing the diff is not valid.
2. **No self-approval.** The proposal author MUST NOT be an approver.
3. **No retroactive approval.** Approval MUST occur before merge, not after.
4. **No automation approval.** An agent MAY NOT approve an amendment PR,
   even if the agent holds the `architecture-review` role. Agent approval
   is limited to the red-team review phase.

---

## 4. Limited Rollout

Amendments that change enforcement behavior MUST NOT go from proposal to
full enforcement in a single step. The rollout protocol phases in
enforcement to detect false positives before they block workers.

### Rollout Phases

| Phase | Behavior | Duration | Exit Criteria |
|-------|----------|----------|---------------|
| 1. Audit-Only | Log violations without blocking | 48 hours minimum | Zero unexplained violations |
| 2. Warn | Emit warnings in orchestrator output | 24 hours minimum | Zero false-positive warnings |
| 3. Enforce | Full enforcement (block on violation) | Permanent | N/A — this is the target state |

### Phase Transitions

```
  ┌────────────┐     ┌────────────┐     ┌────────────┐
  │ Audit-Only │────▶│   Warn     │────▶│  Enforce   │
  └────────────┘     └────────────┘     └────────────┘
       │                    │
       │ (violations)       │ (false positives)
       ▼                    ▼
  ┌────────────┐     ┌────────────┐
  │  Rollback  │     │  Rollback  │
  └────────────┘     └────────────┘
```

1. **Audit-Only phase.** The amendment is deployed in observation mode.
   Violations are logged to the fact event ledger but do not block worker
   progress. This phase MUST last at least 48 hours.
2. **Warn phase.** Violations are surfaced as warnings in orchestrator
   output and PR comments. Workers may proceed but are alerted. This
   phase MUST last at least 24 hours.
3. **Enforce phase.** Full enforcement. Violations block merges and
   worker launches as defined by the amended rule.

### Exemptions from Limited Rollout

| Amendment Type | Rollout Required |
|----------------|:----------------:|
| Docs-only (no enforcement change) | No |
| New boundary (additive) | Yes — starts at Phase 1 |
| Boundary relaxation | Yes — starts at Phase 1 |
| Enforcement tightening | Yes — starts at Phase 1 |
| Constitutional restructuring (no behavioral change) | No |

---

## 5. Telemetry Observation

After an amendment enters the rollout pipeline, telemetry MUST confirm
it behaves as intended before marking it as accepted.

### Observation Window

| Rollout Phase | Minimum Window | Signals Monitored |
|---------------|:--------------:|-------------------|
| Audit-Only | 48 hours | Violation count, false-positive rate, worker health |
| Warn | 24 hours | Warning count, false-positive rate, worker throughput |
| Enforce | 72 hours | Block rate, worker health, orchestrator stability |

### Telemetry Signals

| Signal | Source | Threshold for Concern |
|--------|--------|----------------------|
| Violation count | Fact event ledger (`amendment.violation`) | > 10 per hour |
| False-positive rate | Manual review of flagged violations | > 5% of violations |
| Worker health impact | Health state markers | Any yellow-to-red transition |
| Orchestrator stability | Orchestrator heartbeat | Any missed heartbeat |

### Observation Outcomes

| Outcome | Condition | Action |
|---------|-----------|--------|
| **Pass** | Observation window completes with zero threshold breaches | Mark amendment as accepted |
| **Extend** | Threshold breach observed but root cause is external | Reset observation window after external issue resolves |
| **Fail** | Threshold breach attributed to the amendment | Initiate rollback |

---

## 6. Rollback

Every amendment MUST have a defined rollback path. Rollback is the
safety net that makes experimentation with constitution boundaries
acceptable.

### Rollback Triggers

| Trigger | Severity | Immediate Action |
|---------|----------|------------------|
| Telemetry threshold breach | High | Revert to previous phase (enforce → warn, warn → audit) |
| False-positive rate > 10% | Critical | Full rollback to pre-amendment state |
| Worker health regression | Critical | Full rollback + recovery worker dispatch |
| Contradiction discovered post-merge | Critical | Full rollback + constitution guard re-run |

### Rollback Procedure

1. **Revert the PR.** `git revert` the amendment commit.
2. **Re-run constitution guard.** Verify the reverted state passes
   `check-constitution.js`.
3. **Log the rollback.** Record a fact event:
   ```jsonc
   {
     "eventType": "amendment.rollback",
     "facts": {
       "amendmentPR": "<PR number>",
       "revertPR": "<revert PR number>",
       "reason": "<rollback trigger>",
       "rolledBackAt": "<ISO-8601>"
     }
   }
   ```
4. **Investigate root cause.** Determine whether a revised amendment
   should enter the proposal process again.
5. **Update the proposal issue.** Comment on the original issue with
   the rollback reason and next steps.

### Rollback Scope

| Amendment Type | Rollback Method |
|----------------|-----------------|
| Docs-only | `git revert` the PR commit |
| Enforcement change (audit phase) | `git revert` — no runtime state affected |
| Enforcement change (warn/enforce phase) | Revert PR + re-run constitution guard + health gate check |
| New boundary (additive) | `git revert` — workers unaffected (boundary not yet enforced) |
| Boundary relaxation | `git revert` + health gate check + worker audit |

---

## Risk Classification

| Amendment Type | Risk Level | Required Scrutiny |
|----------------|:----------:|-------------------|
| Constitutional rule change | High | Full protocol — all gates and phases |
| Enforcement behavior change | Medium-High | Full protocol — all gates and phases |
| Docs clarification (no behavioral change) | Low | Proposal + single human approval |
| New boundary (additive) | Medium | Proposal + red-team + human approval + limited rollout |
| Boundary relaxation | High | Full protocol + security steward approval |

---

## Agent Boundaries

Agents MAY:

- Draft amendment proposals (as issue body or PR body)
- Perform red-team review if explicitly assigned
- Collect and report telemetry signals during observation

Agents MUST NOT:

- Approve an amendment PR
- Merge an amendment PR
- Edit the constitution file directly (unless `allowedFiles` explicitly includes it)
- Weaken or bypass any human gate defined in this protocol
- Propose amendments that expand their own authority or `allowedFiles`
- Skip or compress any phase of the limited rollout
- Override a rollback decision

---

## References

- [seed-constitution.md (authoritative)](../../.github/ai-policy/seed-constitution.md) — Single source of truth for control-plane invariants.
- [seed-constitution.md](seed-constitution.md) — Docs mirror of the constitution.
- [constitution-guard.md](constitution-guard.md) — Pre-flight integrity validation.
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema and boundary definitions.
- [bounded-experiment-policy.md](bounded-experiment-policy.md) — Experiment scoping and rollback.
- [external-reality-intake.md](external-reality-intake.md) — Evidence intake and classification.
- [failure-taxonomy-policy.md](failure-taxonomy-policy.md) — Failure classification for rollback routing.
- [fact-event-ledger.md](fact-event-ledger.md) — Append-only event log for amendment audit trail.
