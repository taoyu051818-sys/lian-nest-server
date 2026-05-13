# Reflexion Self-Reflection Investigation

Investigates the applicability of Reflexion-style self-reflection to LIAN's
self-cycle failure recovery. Based on Shinn et al. 2023 (arXiv:2308.11432).

> **Closes:** [#1407](https://github.com/taoyu051818-sys/lian-nest-server/issues/1407)
>
> **Source reliability:** Medium (`external-doc`, Tier B)
>
> **Cross-references:**
> [classify-self-cycle-failure.js](../../scripts/ai/classify-self-cycle-failure.js),
> [calculate-meta-signals.js](../../scripts/ai/calculate-meta-signals.js),
> [gap-ledger.md](gap-ledger.md),
> [failure-taxonomy.md](failure-taxonomy.md),
> [knowledge-driven-scaling.md](knowledge-driven-scaling.md),
> [external-research-intake-loop.md](external-research-intake-loop.md)

---

## Summary

LIAN's self-cycle classifies failures but does not generate or persist
actionable self-critiques for future cycles. Reflexion agents improve
specifically through this missing step: after a failure, the agent produces
a verbal reflection, stores it in episodic memory, and references it in
subsequent attempts. Three concrete gaps were identified, each with a
bounded fix that fits inside existing infrastructure.

**Verdict: Actionable.** The gap is real, the fix is bounded, and existing
LIAN infrastructure (gap ledger, fact events, meta-signals) can absorb the
change without new modules.

---

## Reflexion Pattern Summary

The Reflexion loop has four components:

```
Actor → Environment → Evaluator → Self-Reflection → [episodic memory] → Actor
```

| Component | Reflexion | LIAN Equivalent | Gap |
|-----------|-----------|-----------------|-----|
| Actor | LLM agent | Claude worker | None |
| Environment | Task execution | Self-cycle pipeline | None |
| Evaluator | Success/failure signal | `classify-self-cycle-failure.js` | Partial — classifies but does not persist |
| Self-Reflection | Verbal critique of what went wrong and what to try next | **Missing** | **Critical gap** |
| Episodic Memory | Stored reflections referenced in future prompts | **Missing** (gap ledger stores events, not reflections) | **Critical gap** |

The key insight: Reflexion does not require weight updates. It uses
language-based self-critique stored as text, which the agent reads before
its next attempt. This maps directly to LIAN's file-based state model.

---

## Gap Analysis

### Gap 1: Classification Output Is Ephemeral

`classify-self-cycle-failure.js` produces structured JSON (errorClass,
likelyCause, recommendedAction, confidence) but the output is never
persisted. `wait-parallel-workers.ps1` attaches it to an in-memory worker
object that is discarded after the batch completes.

**Impact:** The system cannot learn from past failures because no record
exists. The repeated-failure-escalation rule in knowledge-driven-scaling
(gapType fires 3+ times in 7 days) can only trigger if gap entries exist,
but failure classifications never become gap entries.

**Evidence:** `wait-parallel-workers.ps1` line 53 calls
`Invoke-FailureClassifier($Worker)` — no `write-fact-event.js` or gap
ledger write follows.

### Gap 2: No Self-Critique Generation

The classifier identifies *what* failed (error class, matched patterns)
but not *why* it matters for the next attempt. A Reflexion-style critique
would be:

> "The task contract was missing `allowedFiles` because
> compile-issue-to-task-json.ps1 regex matched content from the FORBIDDEN
> section. Next attempt: validate that allowedFiles is non-empty before
> dispatch."

The classifier's `recommendedAction` field is the closest analog, but it
is a static template string per error class — not derived from the
specific failure context.

### Gap 3: No Reflect Phase in Self-Cycle Loop

The self-cycle runner (`run-self-cycle.ps1`) has five steps:
Reconcile → Health → Gate → Launch → Summary. There is no Reflect step
between a worker failure and the next cycle. The Symphony
reason-act-observe-reflect pattern (captured as external fact
`ext-symphony-dynamic-solver`) identifies this same gap.

---

## Proposed Bounded Experiments

### Experiment 1: Persist Classification Output to Gap Ledger

**Hypothesis:** If `wait-parallel-workers.ps1` writes failure
classification results to `.github/ai-state/gap-ledger.ndjson` after
each worker failure, then the repeated-failure-escalation rule will
activate for recurring patterns, reducing repeat failures.

**Scope:**
- `scripts/ai/wait-parallel-workers.ps1` — add gap ledger write after
  classification
- No schema changes needed — gap ledger already accepts arbitrary
  `gapType` and `description` fields

**Acceptance criteria:**
- After a worker failure, a gap entry appears in gap-ledger.ndjson with
  `gapType: "worker-failed"` and the classification JSON in `metadata`
- The repeated-failure-escalation rule (3+ same gapType in 7 days)
  triggers for a synthetic test case

**Risk:** Low. Gap ledger is append-only; writes are idempotent.

### Experiment 2: Generate Failure Reflections

**Hypothesis:** If `classify-self-cycle-failure.js` is extended with a
`--reflect` flag that produces a structured self-critique (problem,
root cause, next-attempt guidance), then workers that read prior
reflections before retrying will avoid repeating the same failure.

**Scope:**
- `scripts/ai/classify-self-cycle-failure.js` — add `--reflect` output
  mode
- New output field: `reflection` object with `problem`, `rootCause`,
  `nextAttemptGuidance`, `confidence`

**Reflection template (per error class):**

| Error Class | Problem | Root Cause | Next-Attempt Guidance |
|-------------|---------|------------|----------------------|
| TASK_CONTRACT_INVALID | Task JSON invalid | compile script or hand-edit | Re-compile; validate schema before dispatch |
| ISSUE_BODY_PARSE_BLEED | Wrong content extracted | Regex matched wrong section | Check CONTROL APPENDIX delimiters |
| RUNNER_STRICT_MODE_VARIABLE | Null variable in PS script | Optional field not guarded | Add Has-Prop guard to script |
| BATCH_SINGLE_TASK_MISMATCH | Batch/single dispatch error | batch-launch.ps1 extraction | Write single-task temp file |
| PROVIDER_UNAVAILABLE | No providers available | Cooldown or credentials | Check provider-pool.json; wait |
| DISK_PRESSURE | Resource exhaustion | Too many workers or disk full | Clean worktrees; reduce batch |
| WORKTREE_STALE | Stale/locked worktree | Previous run not cleaned | Run worktree-janitor.ps1 |
| HUMAN_REQUIRED | Gate needs human | Policy or health block | Review gate report |
| UNKNOWN_CONTROL_PLANE_FAILURE | Unrecognized failure | New pattern | Review and add to classifier |

**Acceptance criteria:**
- `--reflect` flag produces a `reflection` object in JSON output
- Reflection text is specific enough to be actionable (not generic)

**Risk:** Low. Read-only extension to existing script.

### Experiment 3: Store Reflections in Fact Event Ledger

**Hypothesis:** If failure reflections are written to
`.github/ai-state/fact-events.ndjson` as `reflection.generated` events,
then future planning cycles can query past reflections to avoid known
failure patterns.

**Scope:**
- `scripts/ai/wait-parallel-workers.ps1` — after classification with
  `--reflect`, write a fact event
- `scripts/ai/write-fact-event.js` — add `reflection.generated` type
  (if not already supported)

**Acceptance criteria:**
- After a worker failure, a `reflection.generated` fact event appears
  in fact-events.ndjson
- The event includes the error class, reflection text, and issue number

**Risk:** Low. Fact event ledger is append-only.

---

## What This Does NOT Propose

- **No new modules or domains.** All changes fit inside existing scripts
  and state files.
- **No new ndjson files.** Reflections reuse gap-ledger and fact-events.
- **No changes to the self-cycle runner pipeline.** Reflection storage
  happens in `wait-parallel-workers.ps1`, not in the runner.
- **No changes to src/ or prisma/.** All work is in scripts/ai/.

The Hermes Curator pattern (background knowledge consolidation) and
MemGPT-style structured memory are out of scope for this investigation.
They are captured as separate opportunity signals.

---

## Relationship to Existing Opportunity Signals

| Signal | Status | Overlap |
|--------|--------|---------|
| `opp-a1b2c3d4-004` (failure reflection step) | validated | Direct — this investigation confirms and scopes the signal |
| `opp-a1b2c3d4-002` (MemGPT relevance scoring) | validated | Indirect — reflections could feed relevance scoring |
| Symphony reason-act-observe-reflect | external fact only | Direct — confirms the missing Reflect phase |
| Hermes Curator | external fact only | Out of scope — post-hoc consolidation, not inline reflection |

---

## Recommendation

Proceed with Experiment 1 (persist classifications) as the highest-value,
lowest-risk change. It unblocks the existing repeated-failure-escalation
mechanism with minimal code. Experiments 2 and 3 can follow in sequence.

If Experiments 1-3 validate, the Reflexion loop becomes:

```
Actor → Environment → Evaluator → Self-Reflection → [gap-ledger + fact-events] → Actor
```

This is the verbal self-reflection loop from Reflexion, implemented
entirely within LIAN's existing file-based state model.

---

## References

- Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement
  Learning," arXiv:2308.11432, 2023.
- [classify-self-cycle-failure.js](../../scripts/ai/classify-self-cycle-failure.js) — Current classifier
- [calculate-meta-signals.js](../../scripts/ai/calculate-meta-signals.js) — Meta-signals calculator
- [gap-ledger.md](gap-ledger.md) — Gap ledger schema
- [failure-taxonomy.md](failure-taxonomy.md) — Failure classification categories
- [knowledge-driven-scaling.md](knowledge-driven-scaling.md) — Repeated failure escalation rule
- [external-research-intake-loop.md](external-research-intake-loop.md) — Intake loop stages
