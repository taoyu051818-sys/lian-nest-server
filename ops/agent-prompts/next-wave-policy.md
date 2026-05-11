# Next-Wave Automation Policy

## Purpose

This document defines how work continues after a worker wave completes.
It closes the gap between "audit passed" and "next wave is running."

## Current behavior

The launcher monitor:

1. Detects `agent:done` on the worker.
2. Audits validation output.
3. Transitions labels (e.g., `agent:done` -> `agent:review`).
4. Attempts comment writeback to the PR.
5. **Stops.** No next wave is launched.

This is intentional. Wave boundaries are review checkpoints.

## Continuation options

### 1. Manual orchestrator (default)

A human reviews the completed wave, drafts the next issue, and launches
a new worker.

**When to use:** Always safe. Use when the next wave depends on review
of the current diff.

**Procedure:**

```
1. Read the completed PR diff.
2. Read the audit output.
3. Decide if a follow-up wave is needed.
4. If yes, create a new issue with:
   - Bounded scope (what changes, what does not)
   - Allowed files list
   - Validation commands
   - Role, risk, acceptance owner
5. Launch a worker on the new issue.
```

### 2. Router-driven

A router worker reads the completed PR and generates candidate follow-up
issues. A human approves or rejects each before launch.

**When to use:** The next wave's scope is predictable from the current
diff (e.g., "if file X changed, issue Y is next").

**Procedure:**

```
1. Router reads PR diff and labels.
2. Router generates issue candidates.
3. Human reviews candidates.
4. Approved issues are queued for worker launch.
```

### 3. Serial aggregator

A single worker processes a queue of issues in sequence, opening one PR
per issue, waiting for human review between each.

**When to use:** Tightly coupled issues where context carry-over between
steps matters (e.g., schema migration followed by API update).

**Procedure:**

```
1. Aggregator receives ordered issue list.
2. Aggregator processes issue 1, opens PR.
3. Human reviews PR.
4. On merge, aggregator proceeds to issue 2.
5. Repeat until queue is empty.
```

## Decision matrix

| Scenario | Recommended option |
|----------|-------------------|
| Independent features | Manual orchestrator |
| Predictable follow-up from diff | Router-driven |
| Sequential dependent steps | Serial aggregator |
| Unknown next step | Manual orchestrator |
| High-risk changes | Manual orchestrator |

## Why no auto-launch

- **Scope drift:** A blind follow-up may target the wrong files or goals.
- **Duplicate work:** Parallel workers may overlap if launched without coordination.
- **Review gap:** The wave boundary is the last safe checkpoint before more
  code is written.
- **Audit false positives:** A green audit does not mean the diff is correct;
  it means validation commands passed.

## Required labels

| Label | Meaning |
|-------|---------|
| `agent:queued` | Worker is queued, not yet started |
| `agent:running` | Worker is actively working |
| `agent:done` | Worker finished, audit complete |
| `agent:review` | PR is ready for human review |
| `agent:blocked` | Worker cannot proceed (missing dependency, scope issue) |

## Missing writeback detection

If a worker reaches `agent:done` but the PR has no worker comment:

1. Check token scopes (see [writeback checklist](./writeback-checklist.md)).
2. Check worker logs for 403 responses.
3. Do not rely on audit labels to confirm comment writeback.
4. Add a comment manually if needed for reviewer context.

## See also

- [SOP](../../docs/ai-native/SOP.md) - Full development SOP
- [Writeback Checklist](./writeback-checklist.md) - Token and comment verification
