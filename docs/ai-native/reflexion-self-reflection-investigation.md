# Reflexion Self-Reflection Investigation

Investigation of the Reflexion agent pattern (Shinn et al., 2023) against LIAN's self-improvement pipeline.
Tracks [issue #1407](https://github.com/taoyu051818-sys/lian-nest-server/issues/1407).

> **Source:** [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2308.11432)
> **Source reliability:** medium
> **Captured:** 2026-05-13

---

## Reflexion Pattern Summary

Reflexion agents improve through a three-component loop:

1. **Actor** — executes the task in an environment.
2. **Evaluator** — scores the outcome (success/failure).
3. **Self-Reflection** — generates a natural-language critique of *why* the failure occurred and *what to do differently*. The critique is stored in episodic memory and retrieved on subsequent attempts.

The key insight: the agent learns from its own mistakes without weight updates. Reflections are verbal (text), stored persistently, and retrieved contextually when the same or similar task recurs.

---

## Mapping to LIAN

| Reflexion Component | LIAN Equivalent | Status |
|---------------------|-----------------|--------|
| Actor | Worker dispatch via `batch-launch.ps1` + `run-claude-print.ps1` | Implemented |
| Evaluator | Health gate (`post-merge-health-gate.js`) + validation commands | Implemented |
| Self-Reflection (classification) | `classify-self-cycle-failure.js` — 9 error classes, regex-based | **Implemented** |
| Self-Reflection (critique generation) | No structured self-critique output | **Missing** |
| Episodic Memory (storage) | Gap ledger (`gap-ledger.ndjson`) stores `worker-failed` events but not reflections | **Partial** |
| Episodic Memory (retrieval) | Meta-signals `topPain` provides aggregate category, not per-failure lessons | **Partial** |
| Feedback loop (reflection → next attempt) | Planner demotes tasks in `topPain` category, but has no memory of *what was tried* | **Partial** |

---

## Identified Gap

`classify-self-cycle-failure.js` produces a one-shot classification result:

```json
{
  "failedStep": "batch-launch",
  "errorClass": "WORKTREE_STALE",
  "humanSummary": "A git worktree is stale, locked, or has diverged...",
  "likelyCause": "A previous worker run left a worktree that was not cleaned up...",
  "recommendedAction": "Run worktree-janitor.ps1...",
  "safeToRetry": true,
  "matchedPatterns": ["worktree.*stale"],
  "confidence": "medium"
}
```

This output is **not persisted** — it is consumed by the caller and discarded. There is no mechanism to:

1. Record a self-critique after each classified failure.
2. Store that critique in episodic memory (e.g., the gap ledger).
3. Retrieve past reflections when the same error class recurs.
4. Escalate when the same failure repeats across cycles despite the recommended action.
5. Adjust strategy based on accumulated failure knowledge.

### Current Data Flow

```
Worker fails
  → classify-self-cycle-failure.js  (classification produced, output to stdout)
  → [consumed and discarded — no persistence]
  → create-health-followup.js       (reads health state, not classification output)
  → calculate-meta-signals.js       (aggregate counts only — topPain)
  → plan-next-batch.ps1             (demotes topPain category, no per-failure memory)
```

### What's Missing

The gap ledger already stores `worker-failed` events with `severity`, `description`, and `meta` fields. The `meta` field is an arbitrary object — it could carry structured reflection data. But today it does not.

The meta-signals calculator produces `topPain` as a category-level aggregate. It knows *what* is failing most often, but not *why* or *whether the recommended fix was attempted*.

---

## Prior Work

Two PRs addressed this exact gap for a related issue (#1366) but their changes are **not present on main**:

- **PR #1375** (merged): `docs(ai): reflexion self-reflection investigation for #1366` — research doc.
- **PR #1393** (merged): `feat(ai): reflexion investigation and failure reflection generator` — added `generate-failure-reflection.js` and gap ledger `meta.reflection` schema.

The commits from these PRs are orphaned (no branch contains them). The proposed `generate-failure-reflection.js` script and the `meta.reflection` gap ledger schema do not exist on main.

---

## Recommendation

A bounded, deterministic reflection step can be added without new infrastructure:

1. **`generate-failure-reflection.js`** — a new script that reads `classify-self-cycle-failure.js` output and produces a structured self-critique:
   - `critique`: human-readable lesson (e.g., "Worktree cleanup was not run after the previous stale failure").
   - `rootCause`: maps to the error class's `likelyCause`.
   - `nextAction`: the `recommendedAction` from classification.
   - `repeatCount`: queries gap ledger for prior occurrences of the same error class.

2. **Gap ledger `meta.reflection` field** — the reflection is stored in the existing gap ledger entry's `meta` object. No new file format or schema required.

3. **Planner integration** — `plan-next-batch.ps1` can read reflections from the gap ledger to make informed decisions beyond simple category demotion.

This approach requires:
- 1 new script in `scripts/ai/`
- 1 new doc in `docs/ai-native/`
- No changes to `src/`, `prisma/`, or `package.json`

### Expected Impact

- **Repeat failure rate**: Currently unknown. Target: measurable reduction within 2 cycles of deployment.
- **Root cause visibility**: Operators can see *why* a failure recurs, not just *that* it recurs.
- **Escalation**: If the same error class fires 3+ times with the same recommended action, the reflection can flag that the recommended action is insufficient.

---

## Decision

This investigation finds a clear, actionable gap with a bounded fix path. The recommendation is to proceed with implementing `generate-failure-reflection.js` as a follow-up experiment (see conflict group `opportunity-a1b2c3d4-004` in external intake proposals).

If the experiment shows no measurable reduction in repeat failures, the reflection step should be removed and this issue closed with a summary of findings.
