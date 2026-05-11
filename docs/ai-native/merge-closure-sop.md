# Controlled Merge Closure SOP

Standard procedure for merging worker PRs, verifying post-merge health,
and closing the loop back to the next wave.

This document fills the gap between "merge decision" (step 7 in the
[SOP lifecycle](SOP.md#lifecycle)) and "next wave launched."

---

## Ready-to-Merge Criteria

A PR is eligible for merge when **all** of the following are true:

| Criterion | How to check |
|-----------|-------------|
| Status checks pass (CLEAN) | `gh pr checks <PR>` -- all green |
| Not a draft | `gh pr view <PR> --json isDraft` -- `false` |
| Approved review, no "request changes" | `gh pr view <PR> --json reviewDecision` -- `APPROVED` |
| No `duplicate` label | Labels do not include `duplicate` |
| No `blocked` label | Labels do not include `blocked` |
| No merge conflicts | `gh pr view <PR> --json mergeable` -- `MERGEABLE` |
| Validation evidence present | PR body or worker comment includes validation output |
| Linked issue exists | PR body references an issue (`Closes #N` or `Refs #N`) |
| Allowed file set respected | `git diff main...HEAD --name-only` contains only files in the worker contract |

**If any criterion fails, the PR must not be merged.** Fix the failing
item or request changes on the PR.

### Operator command: check readiness

```bash
# Replace <PR> with the PR number
gh pr view <PR> --json isDraft,reviewDecision,mergeable,labels,state,statusCheckRollup \
  | jq '{draft: .isDraft, review: .reviewDecision, mergeable: .mergeable, labels: [.labels[].name], state: .state}'
```

Expected output for a ready PR:

```json
{
  "draft": false,
  "review": "APPROVED",
  "mergeable": "MERGEABLE",
  "labels": ["agent:review"],
  "state": "OPEN"
}
```

---

## Guard Fixtures

Guard fixtures are example files for testing the controlled auto-merge
guard behavior. Use them to verify that the allowlist, boundary, and
handoff guards work correctly before merging real PRs.

### Print fixture templates

```powershell
.\scripts\ai\merge-clean-pr-batch.ps1 -ShowFixtures
```

This outputs:
- A safe `task-manifest.json` (allowlist-only, no forbidden overlap)
- A high-risk `task-manifest.json` (forbidden overlap — always blocked)
- A PR body template with all seven required handoff sections

### Using fixtures for testing

1. Copy the safe `task-manifest.json` to `.ai/task-manifest.json`.
2. Use the PR body template in your PR description.
3. Run a dry-run with guards:

```powershell
.\scripts\ai\merge-clean-pr-batch.ps1 -PRs <N> -Repo owner/name -RunGuards
```

The guard output will show CHECKING/PASS/SKIPPED status for each guard.
If any guard fails, the dry-run reports the failure reason.

### Allowlist safety

The controlled auto-merge enforces explicit allowlist safety:

- **Script-level**: Only PRs in `-PRs` or `-AllowlistFile` are processed.
- **Guard-level**: Changed files must stay inside `allowedFiles` and
  outside `forbiddenFiles` globs from the task manifest.
- **Policy-level**: High-risk PRs (`src/**`, `prisma/**`, `package.json`,
  auth/security) are always human-required — guards block these
  regardless of the allowlist.

If any PR touches forbidden files or falls outside the allowlist, the
entire batch is aborted. No partial merges.

---

## Merge Queue Assistant

The merge queue assistant finds eligible PRs and produces merge commands.
It is a script under `scripts/` (see [#59](https://github.com/nicholasxsxs/lian-nest-server/issues/59)
for implementation status).

### Dry-run flow (default)

The assistant scans open PRs and outputs those that meet all
ready-to-merge criteria. No merges are performed.

```bash
# List eligible PRs and their merge commands (dry-run)
node scripts/merge-queue-assistant.js
```

**Output:** A table of eligible PRs with copyable `gh pr merge` commands,
ordered by dependency (foundation PRs first, feature PRs second).

Example output:

```
Eligible PRs (dry-run):
  #42  feat: DatabaseModule         -> gh pr merge 42 --squash --delete-branch
  #45  feat: AuthModule skeleton    -> gh pr merge 45 --squash --delete-branch
```

**The operator copies and runs the commands manually.** This is the
default safe mode -- no merge happens without an explicit human step.

### Execute flow (opt-in)

When the operator wants the assistant to perform merges directly:

```bash
# Merge all eligible PRs in order (requires confirmation)
node scripts/merge-queue-assistant.js --execute
```

**Behavior with `--execute`:**

1. Re-checks all criteria immediately before each merge.
2. Merges PRs one at a time in dependency order.
3. Stops on the first failure (conflict, check failure, or criteria change).
4. Prints a summary of what was merged and where it stopped.

**Safety:** The `--execute` flag requires a `YES` confirmation prompt.
It never force-pushes. It never merges into a red main.

### If the merge queue script does not exist yet

If [#59](https://github.com/nicholasxsxs/lian-nest-server/issues/59) is
not merged, use the manual procedure:

```bash
# 1. List open PRs with review status
gh pr list --state open --json number,title,isDraft,reviewDecision,mergeable \
  | jq '.[] | select(.isDraft == false and .reviewDecision == "APPROVED" and .mergeable == "MERGEABLE") | {number, title}'

# 2. For each eligible PR, run checks then merge
gh pr checks <PR>
gh pr merge <PR> --squash --delete-branch
```

---

## Post-Merge Health Gate

After merging a PR into `main`, verify the branch is still healthy
before launching the next wave. The health gate is a script under
`scripts/` (see [#60](https://github.com/nicholasxsxs/lian-nest-server/issues/60)
for implementation status).

### Flow

```bash
# Run the health gate on main after a merge
node scripts/post-merge-health-gate.js
```

**What it checks:**

1. `npm install` succeeds (dependencies resolve).
2. `npx prisma validate` succeeds (schema is valid).
3. `npm run build` succeeds (TypeScript compiles).
4. `npm run check` succeeds (lint and type checks pass).
5. Test suite passes (if available).

**Exit codes:**

- `0` -- main is healthy. Safe to launch next wave.
- Non-zero -- main is broken. Do not launch next wave.

**Output on failure:** A summary of which check failed, the error
output, and a suggested worker issue category (e.g., "fix build
breakage", "fix schema drift").

### If the health gate script does not exist yet

If [#60](https://github.com/nicholasxsxs/lian-nest-server/issues/60) is
not merged, run checks manually:

```bash
# Switch to main and pull latest
git checkout main && git pull

# Run each check
npm install
npx prisma validate
npm run build
npm run check
```

If any command fails, do not proceed to the next wave. Fix the failure
first (see "Handling a Red Main" below).

---

## Handling Failures

### Conflict on PR

A PR that was `MERGEABLE` may become conflicted after another PR merges.

1. Do not force-merge a conflicted PR.
2. Comment on the PR: `@worker conflict detected, rebase required`.
3. The worker (or a human) rebases onto `main` and pushes.
4. Re-run ready-to-merge checks after rebase.

```bash
# Worker rebase (run in the worker's branch)
git fetch origin main
git rebase origin/main
# Resolve conflicts, then:
git push --force-with-lease
```

### Duplicate PR

If two PRs target the same issue or overlap in scope:

1. Label the duplicate PR with `duplicate`.
2. Comment: `Closing as duplicate of #<original>`.
3. Close the duplicate PR.
4. The original PR proceeds through the normal flow.

```bash
gh pr close <DUPLICATE_PR> --comment "Closing as duplicate of #<ORIGINAL>"
gh pr edit <DUPLICATE_PR> --add-label "duplicate"
```

### Red Main After Merge

If the post-merge health gate fails:

1. **Do not launch the next wave.**
2. Identify the failing check from the health gate output.
3. Create a fix issue with:
   - Category: `bug` + `hotfix`
   - Scope: minimal fix for the specific failure
   - Allowed files: only those needed for the fix
4. Launch a fix worker on the issue.
5. After the fix merges, re-run the health gate.
6. Only proceed to the next wave when the health gate passes.

```bash
# Example: build broke after merge
# 1. Check what failed
git checkout main && git pull
npm run build 2>&1 | tail -20

# 2. Create fix issue (example)
gh issue create --title "Fix: build breakage after #<MERGED_PR>" \
  --label "bug,hotfix" \
  --body "Build failed after #<MERGED_PR> merged. Fix the compilation error."

# 3. After fix PR merges, re-run health gate
node scripts/post-merge-health-gate.js  # or manual checks
```

---

## Worker Labels and Comments

Workers interacting with the merge closure flow must follow these
label and comment conventions.

### Labels

| Label | When to apply | Who applies |
|-------|--------------|-------------|
| `agent:review` | PR is ready for human review | Worker or monitor |
| `agent:merge-ready` | PR meets all ready-to-merge criteria | Merge queue assistant or operator |
| `agent:merged` | PR has been merged | Merge queue assistant or operator |
| `agent:health-fail` | Post-merge health gate failed | Health gate script or operator |
| `agent:conflict` | PR has merge conflicts | Merge queue assistant or operator |
| `duplicate` | PR is a duplicate | Operator |

### Worker comment expectations

When a worker completes a PR, the worker comment must include:

1. **Summary** of what was done (1-3 sentences).
2. **Changed files** list.
3. **Validation evidence** -- command output or a link to CI results.
4. **Linked issue** reference (`Closes #N` or `Refs #N`).

Example worker comment:

```
## Summary
Added AuthModule skeleton with DTOs, usecases, controller, and unit tests.

## Changed files
- src/modules/auth/auth.module.ts
- src/modules/auth/dto/login.dto.ts
- src/modules/auth/usecases/login.usecase.ts

## Validation
npm run check: PASS
npm run build: PASS
npm run test: PASS (3 tests)

Closes #32
```

### Merge queue assistant comments

When the merge queue assistant processes a PR, it should comment:

- **Dry-run:** `Eligible for merge. Run: gh pr merge <N> --squash --delete-branch`
- **Execute (merged):** `Merged successfully. Post-merge health gate: PASS/FAIL`
- **Execute (stopped):** `Merge stopped: <reason>. Remaining PRs unaffected.`

---

## End-to-End Procedure

```
1. Worker completes PR -> agent:done label, worker comment posted
2. Review gate passes -> agent:review label
3. Human approves PR -> reviewDecision = APPROVED
4. Merge queue assistant (dry-run) -> lists eligible PRs
5. Operator runs merge commands (or --execute)
6. Post-merge health gate runs on main
7. If health gate PASS -> launch next wave (see next-wave-policy.md)
8. If health gate FAIL -> fix issue, re-run gate
```

---

## See Also

- [SOP](./SOP.md) -- Full development lifecycle
- [PR Review Gate](./pr-review-gate.md) -- Review criteria
- [Next-Wave Policy](../../ops/agent-prompts/next-wave-policy.md) -- Continuation after merge
- [Writeback Checklist](../../ops/agent-prompts/writeback-checklist.md) -- Worker comment verification
- [#59](https://github.com/nicholasxsxs/lian-nest-server/issues/59) -- Merge queue assistant script (pending)
- [#60](https://github.com/nicholasxsxs/lian-nest-server/issues/60) -- Post-merge health gate script (pending)
