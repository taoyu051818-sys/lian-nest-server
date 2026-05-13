# Edit-Lint-Fix Retry Loop

Research findings on adopting Aider's automatic lint-fix-test retry pattern
for LIAN worker validation.

> **Closes:** [#1497](https://github.com/taoyu051818-sys/lian-nest-server/issues/1497)
>
> **Cross-references:**
> [worker-task-contract.md](worker-task-contract.md) for validationCommands,
> [failure-taxonomy-policy.md](failure-taxonomy-policy.md) for failure
> categories,
> [validation-evidence.md](validation-evidence.md) for PR evidence format,
> [classify-self-cycle-failure.js](../../scripts/ai/classify-self-cycle-failure.js)
> for the failure classifier.

---

## Background

External research (Aider, SWE-agent) shows that tight edit-verify-fix loops
catch errors before commit:

- **Aider** runs lint after every edit. If lint fails, it feeds the error
  back to the LLM for an automatic fix. Same for tests: run, fail, feed
  errors, retry. This loops up to N times before giving up.
- **SWE-agent** has a reproduce-fix-verify workflow where the agent
  reproduces the bug, applies a fix, then verifies the fix works.

Both create a closed feedback loop: **edit → validate → on failure, analyze
error → fix → re-validate**.

---

## Current State in LIAN

### How validation works today

Validation commands are defined in the task JSON contract
(`validationCommands` field) and embedded into the worker prompt by
`run-claude-print.ps1`. The worker (Claude Code) is instructed to run them
and capture output. The launcher never executes the commands itself.

```
Task JSON                    Worker Prompt                   PR
┌──────────────┐            ┌──────────────┐           ┌──────────┐
│ validation   │──embed───▶ │ "Run these   │──run───▶  │ Validation│
│ Commands:    │  into      │  commands"   │  and      │ Evidence  │
│ ["npm run    │  prompt    │              │  capture  │ section   │
│  check"]     │            │              │           │           │
└──────────────┘            └──────────────┘           └──────────┘
```

### What happens on failure

| Layer | Behavior | Retry? |
|-------|----------|--------|
| Worker prompt | Worker runs validation; if it fails, worker may attempt to fix and re-run (implicit, not enforced) | No guarantee |
| `batch-launch.ps1` | Records Claude process exit code; does not inspect validation results | No |
| `wait-parallel-workers.ps1` | Classifies control-plane failures via `classify-self-cycle-failure.js` | No |
| `check-worker-behavior-policy.js` | Post-hoc check: were validation commands and output present in PR? | No |
| Failure taxonomy | Defines `validation-failed` (critical/red) with "fix failures" recovery | No implementation |

### Existing retry infrastructure

The system has several retry-adjacent mechanisms, but none form a closed
validation retry loop:

| Mechanism | What it does | Gap |
|-----------|-------------|-----|
| `safeToRetry` flag in classifier | Marks infrastructure failures as retryable | No consumer reads this flag to trigger retries |
| `generate-failure-reflection.js` | Produces Reflexion-style self-critiques after failure | Learning only, not retry execution |
| `dispatch-recovery-worker.js` | Proposes re-dispatch for stale workers | Proposals only, dry-run by default |
| `retry-failed` dashboard action | Signals that retries are available | Dashboard signal only |
| Worktree retry in `batch-launch.ps1` | Retries worktree creation on git failure | Infrastructure only |

---

## Gap Analysis

The system trusts the worker to self-correct, but provides no mechanism for
the orchestrator to detect validation failures mid-execution and trigger
re-edits. Specifically:

1. **No validation retry instruction in the worker prompt.** The prompt says
   "run the listed validation commands" but does not instruct the worker to
   loop on failure.

2. **No max-retry budget in the task contract.** There is no field to
   control how many retry attempts a worker should make.

3. **No validation-failure classification in the failure classifier.**
   `classify-self-cycle-failure.js` only detects control-plane failures
   (task contract issues, provider exhaustion, disk pressure). It has no
   patterns for `npm run check` failures, TypeScript errors, or test
   failures.

4. **No orchestrator-level retry trigger.** Even if the worker reports
   validation failure, no script reads that signal and re-dispatches the
   worker.

---

## Proposed Design

An Aider-style retry loop can be adopted in two layers:

### Layer 1: Worker-level retry (prompt instruction)

Add an explicit retry instruction to the worker prompt. This is the
highest-leverage, lowest-cost change. The worker already runs validation
commands; adding a "fix and re-validate on failure" instruction closes the
loop within a single worker execution.

**Changes required:**

- `scripts/ai/run-claude-print.ps1`: Add retry instruction to prompt text
  after the validation commands section. Instruct the worker to:
  1. Run each validation command
  2. If any fail, analyze the error output
  3. Fix the issue within allowedFiles
  4. Re-run the failed validation command
  5. Repeat up to N times (default 3)
  6. Report final validation status in PR body

- `docs/ai-native/worker-task-contract.md`: Document the retry behavior
  as part of the validationCommands contract.

**Example prompt addition:**

```
Validation retry loop:
- Run each validation command listed above.
- If a command fails, analyze the error output, fix the issue within
  your allowed files, and re-run the command.
- Repeat up to 3 times per command.
- If still failing after retries, report the final error in your PR
  body under ## Validation with FAIL status.
```

### Layer 2: Task contract extension (optional)

Add an optional `validationRetryMax` field to the task JSON contract for
tasks that need a different retry budget.

```json
{
  "validationCommands": ["npm run check"],
  "validationRetryMax": 3
}
```

Default: 3 if not specified. Set to 0 to disable retry (strict mode for
research tasks).

### Layer 3: Failure classifier extension (future)

Extend `classify-self-cycle-failure.js` to detect validation command
failures as a distinct error class:

```
VALIDATION_FAILED: {
  humanSummary: 'Worker ran validation commands but one or more failed.',
  likelyCause: 'Code change introduced lint, type, or test errors.',
  recommendedAction: 'Worker should auto-fix and retry. If persistent,
    reduce task scope.',
  safeToRetry: true,
}
```

Patterns: `exit code 1`, `npm ERR!`, `tsc` error output, test failure
output.

This is lower priority because the worker-level retry (Layer 1) handles
most cases. The classifier extension helps when the worker exhausts its
retries and the orchestrator needs to decide whether to re-dispatch.

---

## Implementation Priority

| Layer | Effort | Impact | Priority |
|-------|--------|--------|----------|
| 1. Prompt instruction | Low (one script edit + one doc update) | High — closes the loop for all workers | **Do first** |
| 2. Contract extension | Low (schema doc + optional field in compile script) | Medium — enables per-task tuning | Do second |
| 3. Classifier extension | Medium (new error class + patterns) | Low — only needed for orchestrator-level retry | Do if Layer 1 proves insufficient |

---

## Risk Assessment

- **Risk: infinite fix loops.** Mitigated by the retry budget (default 3).
  Workers already have time budgets (`hardTimeMinutes`) that provide an
  additional backstop.
- **Risk: worker changes files outside allowedFiles.** The worker prompt
  already includes allowedFiles boundaries. The retry instruction
  explicitly says "fix within your allowed files."
- **Risk: worker makes validation pass by weakening checks.** The
  validation commands are defined by the task contract, not the worker.
  The worker cannot change the commands themselves.

---

## References

- [Worker Task Contract](worker-task-contract.md) — validationCommands field
- [Validation Evidence Format](validation-evidence.md) — PR body format
- [Failure Taxonomy Policy](failure-taxonomy-policy.md) — validation-failed category
- [Self-Cycle Failure Classifier](../../scripts/ai/classify-self-cycle-failure.js) — error classification
- [Failure Reflection Generator](../../scripts/ai/generate-failure-reflection.js) — Reflexion-style learning
- [Recovery Worker Dispatcher](../../scripts/ai/dispatch-recovery-worker.js) — recovery proposals
- [Worker Behavior Policy](worker-behavior-policy.md) — validation evidence checks
