# AI-Native Development SOP

Complete standard operating procedure for issue-driven, AI-worker-based development in this repository.

## Source of Truth

- GitHub issues define work scope.
- Pull requests carry implementation, validation, and review evidence.
- Worker tasks must stay inside their allowed file set.
- Legacy backend behavior is a reference contract, not the target architecture.

## Roles

See [roles.md](roles.md) for full role definitions and [../../ops/agent-prompts/](../../ops/agent-prompts/) for executable prompts.

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
See [merge-closure-sop.md](merge-closure-sop.md) for the controlled merge
closure procedure (steps 7 onward: merge queue, health gate, next wave).

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

---

## Completion Does Not Auto-Launch Next Wave

### Current limitation

When a worker finishes (transitions to `agent:done`), the launcher monitor
audits the PR and updates labels. **It does not generate or launch follow-up
waves.** This is a deliberate design choice, not a bug:

- Wave dependencies are often non-obvious until the prior wave's diff is reviewed.
- Launching blindly risks scope drift or duplicate work across parallel workers.
- Human review between waves catches architectural mismatches early.

### What happens after `agent:done`

1. Monitor audits validation output and labels the PR.
2. Worker comment writeback is attempted (see below).
3. **No automatic next-wave trigger fires.**
4. A human or orchestrator must explicitly decide and launch the next wave.

### Why this matters

If you expect a chain of waves to run unattended, it will stall after the
first wave completes. The SOP requires an explicit continuation decision at
each wave boundary.

See [Next-Wave Policy](../../ops/agent-prompts/next-wave-policy.md) for
continuation options.

---

## Required GitHub Token Scopes for Worker Writeback

Workers post PR comments and update labels via the GitHub API. The token
used by the worker determines what succeeds silently and what fails
silently.

### Minimum scopes

| Scope | Purpose |
|-------|---------|
| `repo` | Full control of private repositories (required for PR comments on private repos) |
| `public_repo` | Control of public repositories (use instead of `repo` for public repos) |

### What breaks without write scope

| Operation | Without write scope |
|-----------|-------------------|
| PR comment | 403 silently swallowed; audit still passes |
| Label update | 403 silently swallowed; PR stays in prior state |
| PR review | 403 silently swallowed; no review object created |

### How to detect a token scope problem

1. Check the worker's audit log for HTTP 403 responses from `api.github.com`.
2. Compare the worker's `GH_TOKEN` scopes (run `curl -H "Authorization: token $GH_TOKEN" -I https://api.github.com/user` and inspect `X-OAuth-Scopes`).
3. If the PR is missing expected comments but audit passed, token scope is the most likely cause.

**Never embed token values in docs, issues, or PR bodies.**

---

## Detecting Missing PR Comments Despite Audit Pass

Audit success validates that the worker ran commands and produced output.
It does **not** verify that the worker successfully wrote comments to the PR.

### Symptoms

- Worker logs show `agent:done` but the PR has no worker comment.
- Audit label is green but the PR body or comment thread is empty.
- Reviewers have no context for what the worker did or why.

### Detection checklist

- [ ] PR has at least one comment from the worker bot/user.
- [ ] Comment contains the expected summary or output excerpt.
- [ ] Worker log shows 2xx response for the comment POST call.
- [ ] `X-OAuth-Scopes` header on the token includes `repo` or `public_repo`.

If any item fails, the writeback is missing. Do not rely on audit labels
alone to confirm that comments landed.

---

## Manual Continuation SOP

After a wave completes (`agent:done`), follow this procedure to launch
the next wave.

### Option A: Manual orchestrator

1. Review the completed PR diff and audit output.
2. Draft the next wave's issue with bounded scope, allowed files, and validation commands.
3. Launch a new worker targeting the next issue.
4. This is the default and safest option.

### Option B: Router-driven

1. A router worker reads the completed PR and generates follow-up issues.
2. Each generated issue is reviewed by a human before worker launch.
3. Use when the next wave's scope is predictable from the current diff.

### Option C: Serial aggregator

1. A single worker receives a queue of issues in order.
2. The worker processes one issue at a time, opening a PR for each.
3. A human reviews each PR before the worker proceeds to the next.
4. Use for tightly coupled sequences where inter-wave context matters.

### Choosing an approach

| Factor | Manual orchestrator | Router-driven | Serial aggregator |
|--------|-------------------|---------------|-------------------|
| Human involvement | High | Medium | Medium |
| Parallelism | Full | Full | None |
| Context carry-over | Manual | Automatic | Automatic |
| Risk of scope drift | Low | Medium | Low |

When in doubt, use **manual orchestrator**. It keeps a human in the loop at
every wave boundary and is the easiest to audit.

---

## Issue and PR Checklist Additions

When creating issues or PRs in this workflow, include:

- [ ] Worker writeback confirmed (PR comment exists from worker).
- [ ] Token scopes verified if writeback is missing.
- [ ] Next-wave decision documented (manual / router / serial).
- [ ] Continuation issue linked (if applicable).

These items make missing writeback visible during review instead of
requiring a separate audit pass.
