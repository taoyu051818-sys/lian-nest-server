# Ready Lane Promotion Gap

Root cause analysis of why the ready lane stays empty despite compiled
task contracts existing in `compiled-tasks.json`.

> **See also:**
> [ready-lane-deficit-recovery.md](ready-lane-deficit-recovery.md) for
> deficit detection and recovery flow,
> [task-board-projection.md](task-board-projection.md) for lane state
> definitions,
> [task-board-driven-discovery.md](task-board-driven-discovery.md) for
> gap detection.

---

## Problem

The task board projection reports 0 ready tasks even when
`compiled-tasks.json` contains compiled task contracts. The
`discoverGaps()` function emits an `empty-ready` signal with a deficit
of 3, triggering issue production to fill the gap. But the root cause
is not a lack of issues — it is a missing label promotion step.

## Root Cause

The issue lifecycle has a gap between compilation and queuing:

```
Current flow (broken):

  gh issue create --label "agent:codex-action-needed"
       |
       v
  compile-issues-to-tasks.js
    reads issues with agent:codex-action-needed
    writes compiled-tasks.json
       |
       v
  ???
       |
       v
  Task board projection reads GitHub labels
    agent:queued -> ready
    (but label is still agent:codex-action-needed)
       |
       v
  Ready lane: 0 tasks -> empty-ready signal fires
```

The missing step is label promotion: after compilation, the issue label
must change from `agent:codex-action-needed` to `agent:queued` for the
task board projection to recognize the task as ready.

### Why `agent:codex-action-needed` != ready

The task board projection (`project-task-board.js`) maps GitHub labels
to lane states:

| Label | Mapped State |
|-------|-------------|
| `agent:queued` | `ready` |
| `agent:running` | `running` |
| `agent:blocked` | `blocked` |
| `agent:done` | `done` |

Issues with `agent:codex-action-needed` have no mapped state, so they
do not appear in any lane. The projection sees them as untracked.

### Compiled Tasks vs. Task Board

`compiled-tasks.json` and the task board are separate artifacts:

| Artifact | Source | Purpose |
|----------|--------|---------|
| `compiled-tasks.json` | `compile-issues-to-tasks.js` | Task contracts for batch launcher |
| Task board projection | GitHub labels via `project-task-board.js` | Lane state for gap detection |

The batch launcher reads `compiled-tasks.json` directly, but the task
board reads GitHub labels. If the label is never promoted, the task
board never sees the task as ready.

## Evidence

Observed state on 2026-05-13:

- 21 open issues with `agent:codex-action-needed` label
- 0 issues with `agent:queued` label
- `compiled-tasks.json` contains 13 compiled task contracts
- `discoverGaps()` emits `empty-ready` with deficit 3

## Proposed Fix

Add a promotion step after compilation that changes the GitHub label:

```
Corrected flow:

  gh issue create --label "agent:codex-action-needed"
       |
       v
  compile-issues-to-tasks.js
    reads issues with agent:codex-action-needed
    writes compiled-tasks.json
       |
       v
  promote-compiled-to-ready.js          <-- NEW
    reads compiled-tasks.json
    for each task:
      gh issue edit $N --remove-label "agent:codex-action-needed"
                       --add-label "agent:queued"
       |
       v
  Task board projection reads GitHub labels
    agent:queued -> ready
       |
       v
  Ready lane: N tasks -> deficit resolved
```

### Implementation Constraints

| Constraint | Rationale |
|------------|-----------|
| Only promote issues present in compiled-tasks.json | Avoids promoting uncompiled issues |
| Remove `agent:codex-action-needed` before adding `agent:queued` | Prevents label accumulation |
| Skip issues that already have `agent:queued` | Idempotent operation |
| Log each promotion to audit trail | Accountability |

### Integration Point

The promotion step should run after `compile-issues-to-tasks.js` in the
self-cycle loop:

```
run-self-cycle.ps1
    |
    +-- Step 0.5: Issue production phase
    |   +-- reduce-gaps-to-issues.js
    |   +-- propose-self-cycle-issues.js
    |   +-- compile-issues-to-tasks.js
    |   +-- promote-compiled-to-ready.js   <-- NEW
    |
    +-- Step 1: Plan next batch
    +-- ...
```

## Related Gaps

1. **Stale compiled-tasks.json.** The current compiled-tasks.json
   references issues 1363-1379, but open issues include 1378-1420.
   Re-running `compile-issues-to-tasks.js` would refresh it.

2. **No automated recompilation.** When new issues are created by the
   gap reducer, they are not automatically compiled. The compile step
   must be explicitly run.

3. **Label state drift.** If a worker fails mid-execution, the issue
   may retain `agent:running` instead of reverting to `agent:queued`.
   The state-reconciler handles this but only for stale states.

## Design Decisions

- **Separate compile and promote steps.** Compilation is a read-only
  transform (issue -> task JSON). Promotion mutates GitHub state.
  Keeping them separate allows dry-run compilation without side effects.
- **Promote after compile, not during.** The compiler should remain a
  pure function. Label mutation belongs in a dedicated step.
- **Use compiled-tasks.json as the promotion source.** Only tasks that
  pass the CONTROL APPENDIX validation should be promoted. This
  prevents malformed issues from entering the ready lane.

## References

- [Ready Lane Deficit Recovery](ready-lane-deficit-recovery.md)
- [Task Board Projection](task-board-projection.md)
- [Task Board Driven Discovery](task-board-driven-discovery.md)
- [Compile Issues to Tasks](../scripts/ai/compile-issues-to-tasks.js)
- [Gap-to-Issue Reducer](gap-to-issue-reducer.md)
