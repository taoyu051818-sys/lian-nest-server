# Validation Retry Loop Investigation

Investigation of the edit-lint-fix-loop pattern from Aider and SWE-agent,
and its applicability to LIAN worker validation. Closes #1443.

## Source Pattern

Aider (base_coder.py) implements an in-process loop:

```
edit file -> run linter -> if fail, feed error to LLM -> LLM fixes -> re-run linter
```

SWE-agent has a similar reproduce-fix-verify workflow:

```
attempt fix -> run test -> if fail, feed error to LLM -> LLM fixes -> re-run test
```

Both operate **within a single LLM session**. The loop is bounded by a
retry cap (typically 3-5 iterations). The LLM sees the validation error
output and produces a fix in-context — no new worker is spawned.

## Current LIAN Behavior

Workers receive `validationCommands` in the task contract and must run
them before opening a PR. The execution model is **linear and single-pass**:

```
edit files -> run validationCommands -> if pass, commit and open PR
                                       -> if fail, report failure
```

Key documents governing this:

- `worker-behavior-policy.md` Principle 4: run all validationCommands before PR
- `worker-acceptance-checklist.md`: validation commands must exit 0
- `worker-task-contract.md`: validationCommands is a required field
- `validation-evidence.md`: structured PASS/FAIL in PR body

When validation fails, the current recovery path is **out-of-band**:

1. Worker reports failure (PR with FAIL evidence or issue comment)
2. `classify-self-cycle-failure.js` classifies the error
3. `self-healing.md` pipeline creates follow-up issues for recovery workers
4. A new worker is dispatched in a future cycle

There is no in-process retry. The gap is documented in
`self-cycle-runner.md` future work: "Retry/continue from a specific step."

## The Distinction: In-Process vs Out-of-Process Retry

| Aspect | In-Process (Aider pattern) | Out-of-Process (LIAN current) |
|--------|---------------------------|-------------------------------|
| Scope | Single worker session | New worker launch |
| Context | LLM retains edit history | Fresh LLM session |
| Cost | Cheap (same API call) | Expensive (new worktree, new session) |
| Latency | Seconds | Minutes (launch gate, worktree setup) |
| Risk | Bounded (same allowedFiles) | Bounded (new task contract) |
| Policy | Not covered by "no auto-retry" | Explicitly forbidden by guarded-autopilot |

The "no auto-retry" policy in `guarded-autopilot-execute-policy.md` applies
to **worker re-launch**, not to in-process validation loops. A worker that
runs lint, sees an error, and fixes it within its session is not "retrying"
in the policy sense — it is doing its job (Principle 4: goal-driven execution).

## Gap Analysis

What LIAN lacks for in-process validation retry:

1. **No retry budget in task contract.** The contract defines
   `validationCommands` but has no `validationRetryCap` field. Workers
   have no guidance on how many fix-and-revalidate attempts are permitted.

2. **No error feedback structure.** `validation-evidence.md` defines the
   output format but not how to feed validation errors back to the LLM
   for correction. Workers currently capture output once and report it.

3. **No scope guard on retry edits.** If a worker retries validation and
   needs to edit files, the edit must stay within `allowedFiles`. The
   current policy has no explicit statement that retry edits are bounded
   by the same constraint.

4. **No cost ceiling.** Each retry iteration consumes API tokens. Without
   a cap, a worker could loop indefinitely on a hard-to-fix lint error.

## Proposed Design

A bounded in-process validation retry loop, added to the worker behavior
policy and task contract. No new scripts required — this is a policy and
prompt-level change.

### Task Contract Extension

```json
{
  "validationCommands": ["npm run check"],
  "validationRetryCap": 3
}
```

- `validationRetryCap`: max number of fix-and-revalidate iterations.
  Default 0 (no retry, current behavior). Max 5. Omit for research tasks.

### Worker Behavior Policy Addition

Add to Principle 4 (Goal-Driven Execution):

> **Validation retry loop.** If a `validationCommands` entry exits
> non-zero, the worker MAY attempt to fix the error and re-run the
> command, subject to these constraints:
>
> 1. Retry count does not exceed `validationRetryCap`.
> 2. All edits remain within `allowedFiles` and outside `forbiddenFiles`.
> 3. Each retry must produce a distinct fix — repeating the same edit
>    is a loop violation and the worker must stop.
> 4. The worker includes all retry iterations in validation evidence
>    (attempt #, error output, fix applied, re-run result).
> 5. If retries are exhausted, the worker reports the final failure
>    with full error history and proceeds to the straggler policy.

### Validation Evidence Format Extension

```markdown
## Validation

- npm run check: PASS (attempt 2/3)
  - Attempt 1: FAIL — lint error in foo.ts:42
  - Fix: removed unused import
  - Attempt 2: PASS
```

### Scope Guard

Retry edits are governed by the same `allowedFiles` / `forbiddenFiles`
boundary as initial edits. No special carve-out. If the fix requires
editing a forbidden file, the worker must stop and report a blocker —
same as the initial edit path.

## Constraints and Risks

| Risk | Mitigation |
|------|-----------|
| Infinite loop on unfixable error | `validationRetryCap` hard cap |
| Scope creep during retry | Same `allowedFiles` boundary |
| Cost explosion | Cap at 5 retries; each retry is one validation run + one fix |
| Masking systemic issues | All attempts recorded in evidence; reviewer sees full history |
| Conflict with "no auto-retry" policy | In-process loop is not a worker re-launch; policy scope is distinct |

## Recommendation

Adopt the proposed design as a policy change to `worker-behavior-policy.md`
and `worker-task-contract.md`. The change is small, bounded, and does not
require new scripts. Workers already have the capability to run commands
and edit files — the missing piece is explicit permission and a retry
budget.

For the initial rollout, limit to `research` task type excluded (no retry
for read-only tasks) and `risk: low` tasks only. Escalate to medium/high
risk after observing the pattern in practice.

## References

- `worker-behavior-policy.md` — Principle 4: Goal-Driven Execution
- `worker-task-contract.md` — validationCommands field
- `validation-evidence.md` — PR body evidence format
- `guarded-autopilot-execute-policy.md` — no auto-retry (worker re-launch)
- `self-healing.md` — out-of-process recovery pipeline
- `classify-self-cycle-failure.js` — failure classification with safeToRetry
- `failure-taxonomy-policy.md` — validation-failed category
- Aider base_coder.py — edit-lint-fix-loop source pattern
