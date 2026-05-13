# Investigation: Reflexion Self-Reflection Pattern

Investigates whether the Reflexion agent pattern (self-critique after failure,
episodic memory storage, reference in subsequent attempts) adds value beyond
LIAN's existing self-improvement mechanisms.

> **Closes:** [#1366](https://github.com/taoyu051818-sys/lian-nest-server/issues/1366)
>
> **Source:** [arxiv.org/abs/2308.11432](https://arxiv.org/abs/2308.11432)
> (Reflexion: Language Agents with Verbal Reinforcement Learning)
>
> **Evidence reliability:** Medium — academic paper, not validated against
> LIAN's production workload.
>
> **See also:**
> [classify-self-cycle-failure.js](../../scripts/ai/classify-self-cycle-failure.js)
> for current failure classification,
> [meta-signals.md](meta-signals.md) for aggregate health signals,
> [organization-memory-policy.md](organization-memory-policy.md) for
> experiment memory,
> [opportunity-loop-runbook.md](opportunity-loop-runbook.md) for the
> feedback cycle,
> [self-healing.md](self-healing.md) for recovery pipeline,
> [external-research-intake-loop.md](external-research-intake-loop.md) for
> how this investigation entered the system.

---

## Summary

LIAN already implements most of the Reflexion pattern through different
mechanisms. The one actionable gap is that `classify-self-cycle-failure.js`
produces a diagnostic classification (error class, regex matches, confidence)
but does **not** generate a natural-language self-critique that captures
*why* the failure happened and *what to do differently*. Adding a structured
reflection step after classification would close this gap without new
infrastructure.

---

## What Reflexion Does

The Reflexion pattern (Shinn et al., 2023) has three components:

1. **Actor** — attempts a task, produces output.
2. **Evaluator** — scores the output (success/failure).
3. **Self-Reflection** — generates a natural-language critique of *why* the
   failure occurred and *what to change* next time. The critique is stored in
   episodic memory and retrieved before the next attempt.

The key insight: the agent improves by learning from its own verbalized
mistakes, not by weight updates. The self-critique is the learning artifact.

---

## What LIAN Already Has

| Reflexion Component | LIAN Equivalent | Gap |
|---------------------|-----------------|-----|
| **Actor** | Worker execution via `batch-launch.ps1` + Claude print | None |
| **Evaluator** | Health gate (`post-merge-health-gate.js`), exit codes, validation commands | None |
| **Self-Reflection (classification)** | `classify-self-cycle-failure.js` — 9 error classes, regex patterns, confidence scoring | Partial — diagnostic but not reflective |
| **Self-Reflection (critique generation)** | *Not implemented* | **Missing** |
| **Episodic Memory (storage)** | Knowledge ledger (`write-knowledge-update.ps1`), gap ledger (`write-gap-ledger.js`) | Partial — stores outcomes, not critiques |
| **Episodic Memory (retrieval)** | Context bundles (`generate-context-bundle.js`), planning loop reads knowledge before batch | Partial — retrieves knowledge entries but not failure-specific critiques |
| **Subsequent attempt reference** | `suggest-next-tasks-from-meta-signals.js`, `propose-self-cycle-issues.js` | Partial — uses aggregate signals, not per-failure lessons |

### Detailed Analysis of Existing Mechanisms

#### classify-self-cycle-failure.js

Current output for a failure:

```json
{
  "failedStep": "batch-launch",
  "errorClass": "WORKTREE_STALE",
  "humanSummary": "A git worktree is stale, locked, or has diverged.",
  "likelyCause": "A previous worker run left a worktree that was not cleaned up.",
  "recommendedAction": "Run worktree-janitor.ps1 to clean stale worktrees.",
  "safeToRetry": true,
  "matchedPatterns": ["worktree.*stale", "worktree.*locked"],
  "confidence": "high",
  "suggestedIssueTitle": "fix(ai): worktree janitor not running",
  "suggestedAllowedFiles": ["scripts/ai/worktree-janitor.ps1"]
}
```

This is a **diagnosis**, not a **reflection**. It answers "what broke" but
not "what should the system learn from this." The `recommendedAction` is a
one-liner, not a structured lesson about prevention.

#### organization-memory-policy.md

Records experiment outcomes as precedent or anti-pattern, but the memory
entries are about *experiments* (bounded changes with hypotheses), not about
*failure patterns*. A WORKTREE_STALE failure is not an experiment — it is an
operational incident. The organization memory policy does not cover
operational failure learning.

#### meta-signals

Aggregates failure counts into scores (failureScore, frictionScore, etc.)
but loses per-failure detail. The `topPain` signal tells you *which category*
has the most failures but not *what to learn* from those failures.

#### opportunity-loop

The detect→compile→write-result cycle is the closest analog to Reflexion's
feedback loop, but it operates at the *task proposal* level, not the
*failure learning* level. A failure in the opportunity loop itself is
classified by `classify-self-cycle-failure.js` but the lesson is not stored
for future reference.

---

## The Gap: Failure-Specific Self-Critiques

LIAN classifies failures well but does not generate structured self-critiques
that answer:

1. **Why did this specific failure happen?** (not just which error class)
2. **What pattern led to it?** (e.g., "worktree janitor was not scheduled
   after the last batch increase")
3. **What should change to prevent recurrence?** (not just "run the janitor"
   but "add worktree-janitor to the post-batch cleanup checklist")
4. **How confident are we in this lesson?** (based on failure frequency,
   classification confidence, and whether similar failures recurred)

### What a Self-Critique Looks Like

For a WORKTREE_STALE failure at step `batch-launch`:

```json
{
  "failureId": "fail-20260513-batch-launch-worktree-stale",
  "errorClass": "WORKTREE_STALE",
  "failedStep": "batch-launch",
  "critique": "The batch launcher dispatched 5 workers but the worktree janitor had not run since the previous batch. Stale worktrees from batch #42 blocked 3 of 5 new workers. Root cause: the post-batch cleanup step is not enforced by the launch gate.",
  "lesson": "Add worktree freshness check to check-launch-gate.ps1. If >3 stale worktrees exist, block launch and run janitor first.",
  "confidence": "high",
  "evidenceCount": 3,
  "relatedFailureIds": ["fail-20260510-batch-launch-worktree-stale"],
  "generatedAt": "2026-05-13T10:00:00Z"
}
```

---

## Recommendation: Add Reflection Step to Failure Pipeline

### Proposed Architecture

```
classify-self-cycle-failure.js  (existing — diagnosis)
        |
        v
generate-failure-reflection.js  (new — self-critique)
        |
        v
knowledge-updates.ndjson        (existing — storage)
        |
        v
generate-context-bundle.js      (existing — retrieval)
```

### New Script: generate-failure-reflection.js

**Purpose:** Takes classification output from `classify-self-cycle-failure.js`
and generates a structured self-critique stored in the knowledge ledger.

**Input:** JSON output from `classify-self-cycle-failure.js` (piped or via
`--file`).

**Output:** A knowledge entry written to `knowledge-updates.ndjson` with:

| Field | Description |
|-------|-------------|
| `category` | `failure-reflection` |
| `summary` | Natural-language critique of why the failure happened |
| `tags` | Error class, failed step, confidence |
| `details` | Structured lesson, prevention strategy, related failures |
| `issueNumber` | Source issue (if available) |

**Behavior:**

1. Read classification result.
2. Check knowledge ledger for recent entries with the same `errorClass` (last
   30 days).
3. If repeat failures exist, escalate the critique severity and note the
   recurrence pattern.
4. Generate a structured critique using the classification's `likelyCause` and
   `recommendedAction` as seeds, enriched with recurrence context.
5. Write to knowledge ledger with category `failure-reflection`.
6. If `--dry-run`, print to stdout instead of writing.

**Boundary:** This script is deterministic. It does not call an LLM to
generate critiques. The critique is assembled from structured fields in the
classification result plus recurrence data from the knowledge ledger.

### Integration Points

| Consumer | How It Uses Reflections |
|----------|------------------------|
| `generate-context-bundle.js` | Include recent failure reflections for the worker's domain in the context bundle |
| `plan-next-batch.ps1` | Check for unresolved failure reflections before proposing tasks in affected areas |
| `propose-self-cycle-issues.js` | Auto-generate improvement issues from high-confidence, recurring failure reflections |
| `suggest-next-tasks-from-meta-signals.js` | Weight suggestions by unresolved failure reflection count per category |

### What This Does NOT Do

- **No LLM calls.** Reflections are assembled from structured data, not
  generated by a language model. This keeps the script deterministic and
  safe to run in the control plane.
- **No new memory surfaces.** Reflections use the existing knowledge ledger.
  No new files, schemas, or state directories.
- **No changes to existing scripts.** The reflection step is additive — it
  reads from `classify-self-cycle-failure.js` output and writes to the
  knowledge ledger. No existing behavior changes.

---

## Mapping to Reflexion Components

| Reflexion | LIAN (Current) | LIAN (Proposed) |
|-----------|---------------|-----------------|
| Actor | Worker execution | No change |
| Evaluator | Health gate + validation | No change |
| Self-Reflection | `classify-self-cycle-failure.js` (diagnosis only) | `classify-self-cycle-failure.js` + `generate-failure-reflection.js` (diagnosis + critique) |
| Episodic Memory | Knowledge ledger (outcomes only) | Knowledge ledger (outcomes + failure reflections) |
| Retrieval | Context bundles (general knowledge) | Context bundles (general knowledge + failure-specific lessons) |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Reflections add noise to knowledge ledger | Category `failure-reflection` is filterable; reflections have a 30-day staleness window |
| Repeat-failure detection is expensive | Knowledge ledger is NDJSON — scan last N entries, not full file |
| Critique quality depends on classification quality | Reflections inherit the classification's confidence level; low-confidence classifications produce low-confidence reflections |
| No new infrastructure required | Uses existing knowledge ledger, existing context bundle pipeline |

---

## Decision

**Actionable: Yes, with bounded scope.** The gap is real but small. LIAN's
existing infrastructure (knowledge ledger, context bundles, meta-signals)
can absorb failure reflections without new surfaces. The proposed
`generate-failure-reflection.js` script is a bounded addition that reads
from an existing output and writes to an existing input.

**Not actionable as a broad refactor.** The Reflexion pattern's other
components (LLM-based self-critique, long-horizon episodic retrieval,
trajectory replay) are either already covered by LIAN or out of scope for
the control plane.

---

## References

- Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning," arXiv:2308.11432, 2023.
- [classify-self-cycle-failure.js](../../scripts/ai/classify-self-cycle-failure.js) — Current failure classifier
- [meta-signals.md](meta-signals.md) — Aggregate health signals
- [organization-memory-policy.md](organization-memory-policy.md) — Experiment memory policy
- [opportunity-loop-runbook.md](opportunity-loop-runbook.md) — Feedback cycle
- [self-healing.md](self-healing.md) — Recovery pipeline
- [external-research-intake-loop.md](external-research-intake-loop.md) — Research intake process
