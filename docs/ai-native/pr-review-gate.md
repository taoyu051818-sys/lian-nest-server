# PR Review Gate

Every PR must pass this gate before merge. The gate is a checklist of automated and role-based checks.

## Automated Checks

| Check | Pass condition |
|-------|---------------|
| Issue linked | PR body references an issue number |
| Validation evidence | PR body includes validation command output |
| Scope compliance | Changed files are within issue's allowed set |
| No forbidden files | No changes to `.env`, `dist/`, `node_modules/`, etc. |
| Build passes | `npm run build` succeeds (when applicable) |
| Type check passes | `npm run check` succeeds (when applicable) |

## Role-Based Reviews

Each PR requires reviews from the roles specified in the worker task contract's `requiredReviewRoles`.

### pm-gate Review

- [ ] PR scope matches issue scope
- [ ] Acceptance criteria are met
- [ ] No scope creep

### architect Review

- [ ] Module boundaries respected
- [ ] No unauthorized cross-module dependencies
- [ ] API contracts preserved

### qa-contract-reviewer Review

- [ ] Validation evidence is present and passing
- [ ] Test coverage is adequate
- [ ] Contract behavior is correct

### security-reviewer Review

- [ ] No hardcoded secrets
- [ ] Auth flows are correct
- [ ] No injection vectors
- [ ] Input validation present at boundaries

### migration-auditor Review

- [ ] Legacy behavior parity maintained (when applicable)
- [ ] Data migration path is safe (when applicable)

## PR Template

Every PR must use this structure:

```markdown
## Summary
1-3 bullet points describing what changed and why.

## Linked Issues
Closes #N

## Non-goals
What this PR intentionally does NOT do.

## Validation
Commands run and their results (PASS/FAIL).

## Changed files
List of files modified.

## Risk / rollback
Risk level and how to revert if needed.
```

## Gate Decision

| Outcome | Condition |
|---------|-----------|
| **Merge** | All automated checks pass, all required reviews approve |
| **Request changes** | Any reviewer requests changes |
| **Block** | Security concern or architectural violation |
| **Override** | repo-owner can override with documented justification |
