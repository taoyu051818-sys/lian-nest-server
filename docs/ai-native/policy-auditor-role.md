# Policy Auditor Role

Defines the Policy Auditor role for the AI-native control plane.
The auditor performs read-only compliance checks against the risk, launch,
merge, worker permissions, telemetry budget, and generated-code policies.

> **Closes:** [#993](https://github.com/taoyu051818-sys/lian-nest-server/issues/993)
> **See also:** [roles.md](roles.md) for all role definitions,
> [seed-constitution.md](seed-constitution.md) for immutable boundaries.

---

## Overview

The Policy Auditor validates that workers, PRs, and orchestrator decisions
comply with the repository's governance policies. The auditor is strictly
**read-only** — it may block or flag but never modify source, policy, or
state files.

The auditor runs at three lifecycle points:

1. **Pre-launch** — validates a task JSON against risk and permissions
   policies before the launch gate dispatches a worker.
2. **Pre-merge** — validates a PR's changed files, telemetry records,
   and generated-code diffs against merge and budget policies.
3. **Post-merge** — validates that merged output still conforms to
   generated-code and telemetry policies.

```
  task JSON / PR / merged output
              │
              ▼
  ┌────────────────────────────┐
  │     Policy Auditor         │  ◄── this document
  │                            │
  │  - Risk policy checks      │
  │  - Launch policy checks    │
  │  - Merge policy checks     │
  │  - Permission checks       │
  │  - Telemetry budget checks │
  │  - Generated-code checks   │
  └────────────┬───────────────┘
               │
      ┌────────┼────────┐
      v        v        v
    pass     warn     block
      │        │        │
      v        v        v
  proceed   proceed   halt
             w/ note   & escalate
```

---

## Authority

| Aspect | Value |
|--------|-------|
| **Read** | All policy files, state files, PR diffs, telemetry records |
| **Write** | None — auditor is read-only |
| **Block** | May flag PRs and tasks that violate policy |
| **Escalate** | Must escalate to `repo-owner` or `architect` when a violation requires a code or policy change |
| **Override** | Cannot override any policy; only `repo-owner` may override auditor findings |

The auditor MUST NOT:

- Edit source code, policy files, or state files.
- Self-approve high-risk or constitutional changes.
- Weaken human-required boundaries defined in the seed constitution.
- Grant itself or any worker new authority beyond existing policy.

---

## Check Categories

### 1. Risk Policy Checks

Validates that tasks and PRs respect the
[risk policy](risk-policy.md) categories and merge gates.

| Check | Source | Pass Condition |
|-------|--------|---------------|
| File-area risk classification | `risk-policy.json` categories | Changed files match the declared risk level |
| Merge gate requirement | `risk-policy.json` merge gates | High-risk PRs have architect review approval |
| Launch restriction | `risk-policy.json` launch restrictions | Worker type matches the restriction for the file area |
| Destructive change dry-run | `risk-policy.json` `architect-review-plus-dry-run` | Destructive data changes include dry-run evidence |

**Block reason:** `RISK_GATE_UNMET` — PR touches a high-risk area without
the required merge gate.

**Block reason:** `LAUNCH_RESTRICTION_VIOLATED` — worker type does not
meet the file area's launch restriction.

### 2. Launch Policy Checks

Validates tasks against the
[launch gate](launch-gate.md) and
[launch policy](launch-policy.md).

| Check | Source | Pass Condition |
|-------|--------|---------------|
| Health state permission | `main-health.json` + permission matrix | Worker type is allowed in current health state |
| Conflict group uniqueness | Task batch JSON | No two tasks share a `conflictGroup` |
| Shared lock overlap | Task batch JSON | No two tasks claim the same `sharedLocks` entry |
| Running worker conflict | Active worker manifest | Task's `conflictGroup` does not match an active worker |
| Straggler timeout | Task JSON budgets | Task is not past its hard timeout without published progress |

**Block reason:** `HEALTH_BLOCKS_LAUNCH` — main health state blocks this
worker type.

**Block reason:** `CONFLICT_GROUP_DUPLICATE` — two tasks in the batch
share a conflict group.

**Warn reason:** `STRAGGLER_DETECTED` — task has exceeded its soft timeout
and may need orchestrator intervention.

### 3. Merge Policy Checks

Validates PRs against the
[merge policy](merge-policy.md) before merge.

| Check | Source | Pass Condition |
|-------|--------|---------------|
| Explicit allowlist | Merge script `-PRs` or `-AllowlistFile` | PR number is in the allowlist |
| Non-draft state | GitHub API | PR is not a draft |
| Clean merge state | GitHub API | PR is `MERGEABLE` with no failed checks |
| Health gate marker | `.github/ai-state/main-health.json` | State is `green` or `yellow` |
| Forbidden files | PR diff | No changes to `.env`, `dist/`, `node_modules/`, `package.json`, `package-lock.json` |
| Secret scan | PR diff | No hardcoded secrets, tokens, or credentials |
| PR handoff sections | PR body | All seven required sections are present and non-empty |

**Block reason:** `MERGE_FORBIDDEN_FILES` — PR modifies files in the
forbidden set.

**Block reason:** `MERGE_SECRET_DETECTED` — PR diff contains hardcoded
secrets or tokens.

**Block reason:** `MERGE_HANDOFF_INCOMPLETE` — PR body is missing required
handoff sections.

### 4. Worker Permission Checks

Validates tasks and PRs against the
[worker permissions](worker-permissions.md) policy.

| Check | Source | Pass Condition |
|-------|--------|---------------|
| Allowed file boundary | Worker class definition | All changed files are within the worker class's `allowedFileClasses` |
| Forbidden file boundary | Worker class definition | No changed files are in the worker class's `forbiddenFileClasses` |
| Scope expansion | Task JSON immutability | Worker did not modify its own `allowedFiles`, `conflictGroup`, or `sharedLocks` |
| Human escalation triggers | Worker class `humanEscalation` rules | Encountered triggers are documented as blockers, not silently bypassed |

**Block reason:** `PERMISSION_BOUNDARY_VIOLATED` — changed file is outside
the worker class boundary.

**Block reason:** `SCOPE_SELF_EXPANSION` — worker modified its own task
contract fields.

### 5. Telemetry Budget Checks

Validates worker telemetry records against the
[telemetry budget policy](telemetry-budget-policy.md).

| Check | Source | Pass Condition |
|-------|--------|---------------|
| Wall-clock soft limit | Telemetry record + policy defaults | `elapsedMs` <= soft limit for task type |
| Wall-clock hard limit | Telemetry record + policy defaults | `elapsedMs` <= hard limit for task type |
| Token input budget | Telemetry record + policy defaults | `inputTokens` <= max for task type |
| Token output budget | Telemetry record + policy defaults | `outputTokens` <= max for task type |
| Cost warning threshold | Telemetry record + pricing reference | Estimated cost < 80% of budget |
| Cost critical threshold | Telemetry record + pricing reference | Estimated cost < 100% of budget |
| Cost hard-stop threshold | Telemetry record + pricing reference | Estimated cost < 150% of budget |
| Confidence level | Telemetry record | Confidence is `medium` or `high` for budget-influencing decisions |

**Warn reason:** `BUDGET_WARNING` — cost or token usage at 80%+ of budget.

**Block reason:** `BUDGET_OVERRUN` — cost or token usage exceeds 100% of
budget. Worker must be paused or budget increased.

**Block reason:** `BUDGET_HARD_STOP` — cost exceeds 150% of budget.
Worker must be force-stopped.

### 6. Generated-Code Checks

Validates against the
[generated code policy](generated-code-policy.md).

| Check | Source | Pass Condition |
|-------|--------|---------------|
| No hand-edits to generated files | PR diff + `src/generated/prisma/**` | Generated files are not directly modified by a worker |
| Schema co-change | PR diff | If `src/generated/prisma/**` changed, `prisma/schema.prisma` also changed |
| No unexpected additions | PR diff | Generated diff is explainable by the schema change |
| CLI version consistency | `package.json` | `prisma` and `@prisma/client` versions match |
| Regeneration evidence | Validation commands | `prisma generate` was run and output is current |

**Block reason:** `GENERATED_HAND_EDIT` — worker directly modified a file
under `src/generated/prisma/**`.

**Block reason:** `GENERATED_SCHEMA_DRIFT` — generated files changed
without a corresponding schema change.

**Warn reason:** `GENERATED_UNEXPECTED_DIFF` — generated diff contains
changes not explained by the schema change. Escalate to architect.

---

## Integration Points

```
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │  Pre-launch   │   │  Pre-merge   │   │ Post-merge   │
  │              │   │              │   │              │
  │  task JSON   │   │  PR diff     │   │  merged state│
  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
         │                  │                  │
         └──────────────────┼──────────────────┘
                            │
                            v
                   ┌────────────────┐
                   │ Policy Auditor │
                   └────────┬───────┘
                            │
            ┌───────────────┼───────────────┐
            v               v               v
       launch gate      merge gate     health gate
```

| Lifecycle Point | Trigger | Output |
|-----------------|---------|--------|
| Pre-launch | `check-launch-gate.ps1` | Launch report with risk/permission verdicts |
| Pre-merge | `merge-clean-pr-batch.ps1` guards | Merge eligibility report |
| Post-merge | `post-merge-health-gate.js` | Health gate result with telemetry/generated-code verdicts |

### Guard Scripts

The auditor's checks map to existing and planned guard scripts:

| Guard Script | Check Category | Status |
|--------------|---------------|--------|
| `check-task-boundary.js` | Worker Permissions | Implemented |
| `check-telemetry-budget.js` | Telemetry Budget | Implemented |
| `check-ai-policy-files.js` | Merge Policy (forbidden files) | Implemented |
| `check-docs-authority.js` | Merge Policy (docs authority) | Implemented |
| `check-pr-handoff.js` | Merge Policy (PR body) | Implemented |
| Risk policy checker | Risk Policy | Planned |
| Generated-code freshness checker | Generated Code | Planned |
| Launch restriction checker | Launch + Risk | Planned |

---

## Escalation Rules

When the auditor detects a violation, it follows this escalation path:

| Severity | Action | Recipient |
|----------|--------|-----------|
| **Warn** | Attach warning to PR comment. PR may proceed. | Worker, reviewer |
| **Block** | Request changes on PR. PR cannot merge until resolved. | Worker, reviewer, architect |
| **Critical** | Comment on issue with blocker. Halt worker dispatch. | Orchestrator, repo-owner |
| **Constitution violation** | Halt immediately. Comment on issue. Do not proceed. | Human constitutional owner |

### Constitution Violations

The auditor MUST halt and escalate when it detects:

- A worker attempting to self-expand its scope.
- A worker modifying `.github/ai-policy/`, `.github/ai-state/`, or
  `docs/ai-native/` outside its `allowedFiles`.
- A worker editing the seed constitution or policy files.
- An override attempt without documented `repo-owner` justification.
- A high-risk or constitutional change proposed without human approval.

These are absolute boundaries. No flag, environment variable, or script
parameter bypasses them.

---

## Worker Behavior

When operating as a Policy Auditor worker:

1. **Read all referenced policies before checking.** Do not rely on
   cached or assumed policy values.
2. **Produce structured output.** Every check produces a pass/warn/block
   verdict with a reason code and message.
3. **Never modify the audited artifact.** The auditor inspects and reports;
   it does not fix.
4. **Record all findings.** Even passing checks should be recorded for
   traceability.
5. **Escalate, do not workaround.** If a policy is ambiguous or missing,
   escalate to the architect rather than making an assumption.

---

## Decision Log

| Date | Decision | Issue |
|------|----------|-------|
| 2026-05-12 | Initial Policy Auditor role defined with six check categories | #993 |

---

## References

- [Risk Policy](risk-policy.md) — File-area risk classification and merge gates
- [Launch Gate](launch-gate.md) — Pre-launch validation checker
- [Launch Policy](launch-policy.md) — Machine-readable launch policy
- [Merge Policy](merge-policy.md) — Merge eligibility and guard checks
- [Worker Permissions](worker-permissions.md) — Allowed/forbidden file boundaries per worker class
- [Telemetry Budget Policy](telemetry-budget-policy.md) — Wall-clock, token, and cost limits
- [Telemetry Budget Guard](telemetry-budget-guard.md) — Guard script for budget validation
- [Generated Code Policy](generated-code-policy.md) — Generated artifact ownership rules
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
- [Roles](roles.md) — All role definitions
- [PR Review Gate](pr-review-gate.md) — PR review checklist
- [Post-Merge Health Gate](post-merge-health-gate.md) — Post-merge validation
- [External Reality Intake](external-reality-intake.md) — Evidence classification and reliability
