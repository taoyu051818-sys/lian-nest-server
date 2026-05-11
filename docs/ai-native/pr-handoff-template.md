# PR Handoff Template Policy

Standardizes worker PR body content so the next loop (or human reviewer) can
consume PR results reliably. Every worker PR must follow this template.

> **Cross-references:**
> - [pr-review-gate.md](pr-review-gate.md) — merge gate checklist and role-based reviews
> - [worker-acceptance-checklist.md](worker-acceptance-checklist.md) — pre-flight and completion sign-off
> - [validation-evidence.md](validation-evidence.md) — evidence format and retention rules

---

## Required PR Body Sections

Every worker PR must include **all** of the following sections. Missing or
empty sections are grounds for rejection.

| # | Section | Purpose |
|---|---------|---------|
| 1 | **Summary** | 1–3 bullet points: what changed and why |
| 2 | **Linked Issues** | `Closes #N` (or `Refs #N` for partial work) |
| 3 | **Non-Goals** | What this PR intentionally does NOT do |
| 4 | **Validation** | Commands run, their results (PASS/FAIL), and evidence |
| 5 | **Changed Files** | List of files modified, matching `git diff --name-only` |
| 6 | **Risk / Rollback** | Risk level (low/medium/high) and how to revert |
| 7 | **Follow-up Handoff** | What the next worker or loop needs to know |

---

## Section Definitions

### Summary

1–3 bullet points. Each bullet names the artifact changed and the reason.
Avoid restating the issue title; instead describe the concrete delta.

### Linked Issues

Must close or reference the issue that authorized the work. Use `Closes #N`
when the PR fully resolves the issue; use `Refs #N` when the issue requires
multiple PRs.

### Non-Goals

State what was explicitly out of scope. This prevents reviewers from flagging
intentional omissions as gaps. Draw from the issue's scope and the task
contract's `forbiddenFiles`.

### Validation

List every validation command from the task contract plus any additional checks
run. Format each line as:

```
- <command or check>: <PASS|FAIL> (<details>)
```

See [validation-evidence.md](validation-evidence.md) for full format rules.

### Changed Files

List every file touched by the PR. This must match `git diff main --name-only`.
Group by category (docs, source, config) when the list exceeds five files.

### Risk / Rollback

State the risk level and the rollback plan:

- **Low** — docs-only or config-only; revert the commit.
- **Medium** — touches runtime code but is isolated; revert the commit and
  re-run validation.
- **High** — affects auth, data, or shared infrastructure; revert, verify
  downstream consumers, and notify the team.

### Follow-up Handoff

Tell the next worker or loop what to do next. Include:

- **Blocked on** — anything this PR depends on that is not yet merged.
- **Next step** — the immediate follow-up action (e.g., "implement the
  mutation endpoint defined in this contract").
- **Context for next worker** — file paths, branch names, or design decisions
  the next worker needs.
- **Open questions** — unresolved decisions that need input before proceeding.

If there is no follow-up (the issue is fully resolved), write `None — issue
fully resolved by this PR.`

---

## Review Rejection Criteria

A reviewer **must request changes** if any of the following are true:

| # | Condition | Rationale |
|---|-----------|-----------|
| 1 | Any required section is missing or empty | Template is a contract; omitting a section breaks the handoff |
| 2 | `Linked Issues` does not reference an issue | PR cannot be traced to authorized work |
| 3 | `Validation` shows a FAIL result without justification | Unresolved failures block merge |
| 4 | `Changed Files` list does not match `git diff --name-only` | Undisclosed changes are a scope violation |
| 5 | `Follow-up Handoff` is missing when the issue is not fully resolved | Next worker will lack context |
| 6 | `Risk / Rollback` is missing for medium- or high-risk changes | Reviewers cannot assess blast radius |
| 7 | Forbidden files appear in the diff | Hard boundary violation |

---

## Examples

### Docs-Only PR

```markdown
## Summary
- Added PR handoff template policy documentation
- Updated review gate with follow-up handoff checklist

## Linked Issues
Closes #101

## Non-Goals
- No runtime or script changes
- No package dependency changes

## Validation
- git diff --check: PASS (no whitespace errors)
- manual docs review: PASS (all internal links resolve, consistent formatting)

## Changed files
- docs/ai-native/pr-handoff-template.md (new)
- docs/ai-native/pr-review-gate.md (updated — added follow-up handoff section)

## Risk / rollback
Risk: low. Docs-only change. Revert commit to rollback.

## Follow-up handoff
None — issue fully resolved by this PR.
```

### Foundation PR

```markdown
## Summary
- Defined the Prisma schema for the `Post` model
- Added seed script with sample data

## Linked Issues
Closes #42

## Non-Goals
- No API endpoints (handled in #43)
- No frontend integration

## Validation
- npx prisma validate: PASS (schema is valid)
- npx prisma migrate dev --name init: PASS (migration generated)
- npm run build: PASS (exit 0)

## Changed files
- prisma/schema.prisma (new model)
- prisma/seed.ts (new)
- package.json (added prisma seed script)

## Risk / rollback
Risk: medium. Adds database migration. Revert migration with
`npx prisma migrate resolve --rolled-back <migration_name>`, then revert commit.

## Follow-up handoff
- **Blocked on:** None.
- **Next step:** Implement the Post CRUD API endpoint (#43).
- **Context for next worker:** The `Post` model is in `prisma/schema.prisma`;
  seed data is in `prisma/seed.ts`. Run `npx prisma migrate dev` before
  starting.
- **Open questions:** Should `authorId` be required or optional?
```

### Feature PR

```markdown
## Summary
- Implemented `GET /api/posts/:id` endpoint with read-only contract
- Added parity fixtures for NodeBB adapter validation
- Added contract test for response shape

## Linked Issues
Closes #74

## Non-Goals
- No write endpoints (read-only contract)
- No caching layer (deferred to #80)

## Validation
- npm run check: PASS (0 errors)
- npm run build: PASS (exit 0)
- npm run verify: PASS (all contract tests pass)

## Changed files
- src/modules/posts/posts.controller.ts (new endpoint)
- src/modules/posts/posts.service.ts (new service method)
- src/modules/posts/__tests__/posts.contract.spec.ts (new test)
- contracts/fixtures/posts-detail.json (new fixture)

## Risk / rollback
Risk: low. Additive endpoint with no existing behavior changed. Revert commit
to rollback.

## Follow-up handoff
- **Blocked on:** None.
- **Next step:** Implement the feed list endpoint (#73) — it reuses the same
  `PostsService.findById` method added here.
- **Context for next worker:** The service method is at
  `src/modules/posts/posts.service.ts:findPostById`. The fixture format is in
  `contracts/fixtures/posts-detail.json`.
- **Open questions:** None.
```
