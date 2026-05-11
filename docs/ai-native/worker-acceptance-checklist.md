# Worker Acceptance Checklist

Defines the acceptance criteria that every AI worker PR must satisfy before it
can be merged. This checklist is the contract between the orchestrator, the
worker, and the reviewer.

> **Reference:** [worker-task-contract.md](worker-task-contract.md) for the
> full task JSON schema, [SOP.md](SOP.md) for the lifecycle flow,
> [roles.md](roles.md) for review role definitions.

---

## Pre-Flight Checks

Before opening a PR, the worker must verify:

- [ ] **Branch is based on latest `main`** — `git rebase main` or `git merge main`
      completed without conflicts.
- [ ] **Only allowed files changed** — `git diff main --name-only` shows no files
      outside the task's `allowedFiles` list.
- [ ] **No forbidden files touched** — `git diff main --name-only` intersects
      empty with the task's `forbiddenFiles` list.
- [ ] **Validation commands pass** — Every command in the task's
      `validationCommands` array exits with code 0.

---

## File Boundary Contract

Every task defines `allowedFiles` and `forbiddenFiles`. The worker MUST NOT
violate these boundaries.

| Check | Command | Expected Result |
|-------|---------|-----------------|
| Allowed files only | `git diff main --name-only` | All files appear in `allowedFiles` |
| No forbidden files | `git diff main --name-only` | No file matches a `forbiddenFiles` glob |
| No runtime source | `git diff main -- src/ prisma/` | Empty diff |
| No config changes | `git diff main -- package.json package-lock.json` | Empty diff |
| No workflow changes | `git diff main -- .github/` | Empty diff |

If any check fails, the worker MUST stop and report the blocker. Do not attempt
to work around the boundary.

---

## Validation Requirements

Each task specifies `validationCommands` in the worker task contract. The
worker must run every command and capture the output as evidence.

| Validation | When to Run | Evidence Location |
|------------|-------------|-------------------|
| `git diff --check` | Before commit | Inline in PR body |
| `npm run check` | Before PR (if code changed) | Inline in PR body |
| `npm run build` | Before PR (if code changed) | Inline in PR body |
| `npm run verify` | Before PR (if applicable) | Inline in PR body |
| Custom commands | As specified in task | Inline in PR body |

---

## PR Body Template

Every worker PR must include the following sections:

```markdown
## Summary
<1-3 sentences: what changed and why>

## Linked Issues
Closes #<issue-number>

## Non-Goals
<what was explicitly out of scope>

## Validation Commands and Result
| Command | Result |
|---------|--------|
| git diff --check | PASS |
| npm run check | PASS |
| npm run build | PASS |

## Risk / Rollback
<Risk level and rollback plan>
```

---

## Review Gate

PRs require review from the roles specified in the task's
`reviewAndAcceptance.requiredReviewRoles`.

| Role | Reviews For | Authority |
|------|-------------|-----------|
| `architect` | Design correctness, boundary adherence | Can request changes |
| `repo-owner` | Merge decision, branch hygiene | Can merge or block |
| `qa-contract-reviewer` | Test coverage, parity evidence | Can request changes |
| `security-reviewer` | Security implications | Can block merge |

The `acceptanceOwner` (typically `codex-orchestrator-gate`) performs the final
merge decision after all required reviewers approve.

---

## Complexity and Budget Compliance

The worker must respect the task's budget constraints:

| Budget | Constraint | Check |
|--------|------------|-------|
| `maxFiles` | Maximum files touched | `git diff main --name-only \| wc -l` |
| `maxLinesChanged` | Maximum lines added + removed | `git diff main --stat` |
| `softTimeMinutes` | Target completion time | Worker self-reports |
| `hardTimeMinutes` | Maximum allowed time | Orchestrator enforces |

If a budget would be exceeded, the worker MUST stop and report rather than
overrun silently.

---

## Straggler Handling

If a worker cannot complete within its `hardTimeMinutes` budget: commit partial
progress, comment on the issue per the task's straggler policy (typically
`open_pr_or_comment_blocker`), and never abandon silently.

---

## Completion Sign-Off

A PR is considered accepted when:

- [ ] All pre-flight checks pass.
- [ ] File boundaries are respected (no forbidden files, only allowed files).
- [ ] All validation commands pass with captured evidence.
- [ ] PR body includes all required sections.
- [ ] Required reviewers have approved.
- [ ] Acceptance owner has performed final merge decision.

