# AI-Native Development SOP

Complete standard operating procedure for issue-driven, AI-worker-based development in this repository.

## Source of Truth

- GitHub issues define work scope.
- Pull requests carry implementation, validation, and review evidence.
- Worker tasks must stay inside their allowed file set.
- Legacy backend behavior is a reference contract, not the target architecture.

## Roles

See [roles.md](roles.md) for full role definitions and [../ops/agent-prompts/](../ops/agent-prompts/) for executable prompts.

| Role | Responsibility |
|------|---------------|
| repo-owner | Repository health, branch policy, merge decisions |
| pm-gate | Issue triage, scope control, acceptance criteria |
| architect | Module boundaries, dependency rules, migration strategy |
| backend-programmer | NestJS implementation within bounded scope |
| nodebb-owner | NodeBB integration module ownership |
| qa-contract-reviewer | Validation evidence and contract compliance |
| security-reviewer | OWASP checks, auth, injection, secrets |
| migration-auditor | Legacy parity, data migration safety |

## Lifecycle

```
issue (OPEN) -> triage -> worker launch -> PR opened -> review gate -> merge decision
```

1. **Issue creation**: Bounded scope, acceptance criteria, labels assigned.
2. **Triage (pm-gate)**: Validates scope, assigns priority and wave.
3. **Worker launch**: Worker receives JSON task contract with allowed files, validation commands, role, risk level.
4. **Implementation**: Worker edits only allowed files, runs validation, commits with evidence.
5. **PR opened**: Worker opens PR linked to issue, includes summary, validation results, changed files.
6. **Review gate**: Automated and role-based reviews check scope, validation, security, architecture.
7. **Merge decision**: repo-owner merges, requests changes, or blocks.

See [issue-lifecycle.md](issue-lifecycle.md) for labels and transitions.

## Worker Task Contract

Workers receive a JSON contract specifying exact boundaries. See [worker-task-contract.md](worker-task-contract.md).

## PR Review Gate

Every PR must pass the review gate before merge. See [pr-review-gate.md](pr-review-gate.md).

## Validation Evidence

Workers must attach structured evidence of validation. See [validation-evidence.md](validation-evidence.md).

## Hard Rules

- No new legacy backend code.
- No direct NodeBB calls outside the NodeBB module.
- No direct storage access outside repositories.
- No silent fallback without diagnostics.
- Keep PRs small enough to review.
- Workers must not edit files outside their allowed set.
- Every PR must link to an issue.
- Every PR must include validation evidence.

## Batch Execution

When running Claude Code batches:

1. Each batch maps to exactly one issue and one branch.
2. The worker prompt includes the full task contract as a control appendix.
3. The worker must produce a PR or comment a blocker on the issue.
4. Partial progress is published; never silently abandoned.
