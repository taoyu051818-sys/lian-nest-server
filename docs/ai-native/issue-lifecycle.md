# Issue Lifecycle

## States

```
OPEN -> IN_PROGRESS -> IN_REVIEW -> MERGED / CLOSED
                  \-> BLOCKED --------^
```

| State | Meaning | Who sets |
|-------|---------|----------|
| `OPEN` | Ready for triage or worker pickup | Author |
| `IN_PROGRESS` | Worker is actively implementing | Worker automation |
| `IN_REVIEW` | PR opened, under review gate | Worker automation |
| `BLOCKED` | Blocked by dependency or decision | Worker or reviewer |
| `MERGED` | PR merged, issue resolved | repo-owner |
| `CLOSED` | Won't do or duplicate | pm-gate |

## Labels

### Agent Labels

| Label | Meaning |
|-------|---------|
| `agent:queued` | Issue is in the worker queue |
| `agent:running` | Worker is actively working |
| `agent:blocked` | Worker hit a blocker |
| `agent:done` | Worker completed, PR opened |

### Type Labels

| Label | Meaning |
|-------|---------|
| `type:feature` | New functionality |
| `type:bug` | Defect fix |
| `type:refactor` | Code restructuring |
| `type:docs` | Documentation only |
| `type:infra` | Build, CI, tooling |
| `type:migration` | Legacy parity or data migration |

### Priority Labels

| Label | Meaning |
|-------|---------|
| `priority:critical` | Blocks other work |
| `priority:high` | Current wave |
| `priority:medium` | Next wave |
| `priority:low` | Backlog |

### Area Labels

| Label | Meaning |
|-------|---------|
| `ai-native` | Process, docs, prompts |
| `architecture` | Module boundaries, design |
| `nodebb` | NodeBB integration |
| `legacy-parity` | Legacy backend reference |

## Transitions

1. **OPEN -> OPEN (queued)**: pm-gate triages and approves issue, sets `agent:queued`.
2. **OPEN -> IN_PROGRESS**: Worker picks up queued issue, sets `agent:running`.
3. **IN_PROGRESS -> IN_REVIEW**: Worker opens PR, sets `agent:done`.
4. **IN_PROGRESS -> BLOCKED**: Worker cannot proceed, comments blocker, sets `agent:blocked`.
5. **BLOCKED -> IN_PROGRESS**: Blocker resolved, worker resumes, sets `agent:running`.
6. **IN_REVIEW -> MERGED**: Review gate passes, repo-owner merges.
7. **IN_REVIEW -> CLOSED**: Review gate rejects, pm-gate closes.
8. **OPEN -> CLOSED**: pm-gate closes as won't-do or duplicate.

## Publisher Label Normalization

The [result publisher](result-publishing.md) can enforce label transitions
after posting a result comment. When `-StatusLabel` is passed, the
publisher:

1. Removes all existing `agent:*` labels from the issue.
2. Applies the specified label.

This ensures the issue ends up with exactly one `agent:*` label matching
the worker's final state. The behavior is **opt-in** — no label mutation
occurs unless the caller explicitly passes `-StatusLabel`.

### Typical publisher-driven transitions

| Worker outcome | StatusLabel | Result |
|---------------|-------------|--------|
| PR opened | `agent:done` | `agent:running` removed, `agent:done` applied |
| Blocked | `agent:blocked` | `agent:running` removed, `agent:blocked` applied |
| Re-queued | `agent:queued` | `agent:running` removed, `agent:queued` applied |

See [result-publishing.md](result-publishing.md) for full usage and
constraints.

## Issue Template

Every issue must include:

```markdown
## Goal
What the issue accomplishes.

## Scope
Bounded description of what is included.

## Acceptance
How to verify the issue is complete.

## Constraints
What must NOT be done.
```
