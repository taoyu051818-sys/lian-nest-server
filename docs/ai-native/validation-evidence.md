# Validation Evidence Format

Every PR must include structured validation evidence. This proves the worker ran the required checks and the results are acceptable.

## Format

Validation evidence is included in the PR body under the `## Validation` section.

```
## Validation
- npm run build: PASS (exit 0, no warnings)
- npm run check: PASS (0 errors)
- manual docs review: PASS (all links resolve, formatting correct)
```

## Structure

Each line item follows:

```
- <command or check name>: <PASS|FAIL> (<details>)
```

- **PASS**: Check succeeded. Include brief details (exit code, counts).
- **FAIL**: Check failed. Include error summary. PR should not be opened with FAIL results unless the failure is pre-existing and documented.

## Required Evidence by Task Type

### execution

- All `validationCommands` from the task contract, with output.
- Build/type-check when code files changed.
- Manual review notes for docs-only changes.

### research

- Summary of findings.
- References to files or code examined.

### review

- Checklist of review criteria with pass/fail for each.
- Specific findings with file paths and line numbers.

## Evidence Retention

- Evidence lives in the PR body, not in separate files.
- Evidence is versioned with the PR (edits are visible in PR history).
- Reviewers verify evidence before approving.

## Example PR Body

```markdown
## Summary
- Added worker task contract documentation
- Defined JSON schema with field descriptions

## Linked Issues
Closes #2

## Non-goals
- No runtime code changes
- No package dependency changes

## Validation
- manual docs review: PASS (all internal links resolve, consistent formatting)
- check links/paths are internally consistent: PASS (all relative paths verified)

## Changed files
- docs/ai-native/worker-task-contract.md (new)
- docs/ai-native/SOP.md (updated links)

## Risk / rollback
Risk: low. Docs-only change. Revert commit to rollback.
```
